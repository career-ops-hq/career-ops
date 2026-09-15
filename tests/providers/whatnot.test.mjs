// tests/providers/whatnot.test.mjs — whatnot provider contract.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

console.log('\nProvider — whatnot');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/whatnot.mjs')).href);
  const provider = mod.default;

  if (provider.id === 'whatnot') pass('whatnot.id is "whatnot"');
  else fail(`whatnot.id is ${JSON.stringify(provider.id)}`);

  const hit = provider.detect({ name: 'X', careers_url: 'https://jobs.whatnot.com/' });
  if (hit && hit.url) pass('whatnot.detect() resolves its careers host to an endpoint');
  else fail(`whatnot.detect() returned ${JSON.stringify(hit)}`);

  // The host must be compared exactly. A substring match would let
  // https://evil.example.com/jobs.whatnot.com/ and https://jobs.whatnot.com.evil.example.com/
  // both claim this provider and point the scanner at an attacker's server.
  const pathHijack = provider.detect({ name: 'X', careers_url: 'https://evil.example.com/jobs.whatnot.com/careers' });
  const suffixHijack = provider.detect({ name: 'X', careers_url: 'https://jobs.whatnot.com.evil.example.com/careers' });
  if (pathHijack === null && suffixHijack === null) {
    pass('whatnot.detect() compares the host exactly (path and suffix hijacks rejected)');
  } else {
    fail(`whatnot.detect() hijackable: path=${JSON.stringify(pathHijack)} suffix=${JSON.stringify(suffixHijack)}`);
  }

  if (provider.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('whatnot.detect() returns null for an unrelated host');
  } else {
    fail('whatnot.detect() should return null for an unrelated host');
  }

  if (provider.detect({ name: 'X', careers_url: null }) === null && provider.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('whatnot.detect() treats a non-string careers_url as missing');
  } else {
    fail('whatnot.detect() should treat a non-string careers_url as missing');
  }

  if (typeof provider.fetch === 'function') pass('whatnot.fetch() is callable');
  else fail('whatnot.fetch() is not a function');

  // Following a redirect lets a compromised host bounce the scanner to an
  // internal address and have the response parsed as job data.
  const src = readFileSync(join(ROOT, 'providers/whatnot.mjs'), 'utf-8');
  const fetches = (src.match(/ctx\.fetch(Json|Text)\(/g) || []).length;
  const guards = (src.match(/redirect:\s*'error'/g) || []).length;
  if (guards >= 1 && guards >= fetches) pass('whatnot passes redirect:"error" on every fetch');
  else fail(`whatnot: {fetches}=${fetches} guarded=${guards}`);
} catch (e) {
  fail(`whatnot provider tests threw: ${e.message}`);
}
