// tests/providers/apple.test.mjs — apple provider contract.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

console.log('\nProvider — apple');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/apple.mjs')).href);
  const provider = mod.default;

  if (provider.id === 'apple') pass('apple.id is "apple"');
  else fail(`apple.id is ${JSON.stringify(provider.id)}`);

  const hit = provider.detect({ name: 'X', careers_url: 'https://jobs.apple.com/en-us/search' });
  if (hit && hit.url) pass('apple.detect() resolves its careers host to an endpoint');
  else fail(`apple.detect() returned ${JSON.stringify(hit)}`);

  // The host must be compared exactly. A substring match would let
  // https://evil.example.com/jobs.apple.com/ and https://jobs.apple.com.evil.example.com/
  // both claim this provider and point the scanner at an attacker's server.
  const pathHijack = provider.detect({ name: 'X', careers_url: 'https://evil.example.com/jobs.apple.com/careers' });
  const suffixHijack = provider.detect({ name: 'X', careers_url: 'https://jobs.apple.com.evil.example.com/careers' });
  if (pathHijack === null && suffixHijack === null) {
    pass('apple.detect() compares the host exactly (path and suffix hijacks rejected)');
  } else {
    fail(`apple.detect() hijackable: path=${JSON.stringify(pathHijack)} suffix=${JSON.stringify(suffixHijack)}`);
  }

  if (provider.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('apple.detect() returns null for an unrelated host');
  } else {
    fail('apple.detect() should return null for an unrelated host');
  }

  if (provider.detect({ name: 'X', careers_url: null }) === null && provider.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('apple.detect() treats a non-string careers_url as missing');
  } else {
    fail('apple.detect() should treat a non-string careers_url as missing');
  }

  if (typeof provider.fetch === 'function') pass('apple.fetch() is callable');
  else fail('apple.fetch() is not a function');

  // Following a redirect lets a compromised host bounce the scanner to an
  // internal address and have the response parsed as job data.
  const src = readFileSync(join(ROOT, 'providers/apple.mjs'), 'utf-8');
  const fetches = (src.match(/ctx\.fetch(Json|Text)\(/g) || []).length;
  const guards = (src.match(/redirect:\s*'error'/g) || []).length;
  if (guards >= 1 && guards >= fetches) pass('apple passes redirect:"error" on every fetch');
  else fail(`apple: {fetches}=${fetches} guarded=${guards}`);
} catch (e) {
  fail(`apple provider tests threw: ${e.message}`);
}
