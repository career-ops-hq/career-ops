// tests/providers/uber.test.mjs — uber provider contract.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

console.log('\nProvider — uber');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/uber.mjs')).href);
  const provider = mod.default;

  if (provider.id === 'uber') pass('uber.id is "uber"');
  else fail(`uber.id is ${JSON.stringify(provider.id)}`);

  const hit = provider.detect({ name: 'X', careers_url: 'https://www.uber.com/us/en/careers/list/' });
  if (hit && hit.url) pass('uber.detect() resolves its careers host to an endpoint');
  else fail(`uber.detect() returned ${JSON.stringify(hit)}`);

  // The host must be compared exactly. A substring match would let
  // https://evil.example.com/www.uber.com/ and https://www.uber.com.evil.example.com/
  // both claim this provider and point the scanner at an attacker's server.
  const pathHijack = provider.detect({ name: 'X', careers_url: 'https://evil.example.com/www.uber.com/careers' });
  const suffixHijack = provider.detect({ name: 'X', careers_url: 'https://www.uber.com.evil.example.com/careers' });
  if (pathHijack === null && suffixHijack === null) {
    pass('uber.detect() compares the host exactly (path and suffix hijacks rejected)');
  } else {
    fail(`uber.detect() hijackable: path=${JSON.stringify(pathHijack)} suffix=${JSON.stringify(suffixHijack)}`);
  }

  if (provider.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('uber.detect() returns null for an unrelated host');
  } else {
    fail('uber.detect() should return null for an unrelated host');
  }

  if (provider.detect({ name: 'X', careers_url: null }) === null && provider.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('uber.detect() treats a non-string careers_url as missing');
  } else {
    fail('uber.detect() should treat a non-string careers_url as missing');
  }

  if (typeof provider.fetch === 'function') pass('uber.fetch() is callable');
  else fail('uber.fetch() is not a function');

  // Following a redirect lets a compromised host bounce the scanner to an
  // internal address and have the response parsed as job data.
  const src = readFileSync(join(ROOT, 'providers/uber.mjs'), 'utf-8');
  const fetches = (src.match(/ctx\.fetch(Json|Text)\(/g) || []).length;
  const guards = (src.match(/redirect:\s*'error'/g) || []).length;
  if (guards >= 1 && guards >= fetches) pass('uber passes redirect:"error" on every fetch');
  else fail(`uber: {fetches}=${fetches} guarded=${guards}`);
} catch (e) {
  fail(`uber provider tests threw: ${e.message}`);
}
