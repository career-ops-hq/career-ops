// tests/providers/atlassian.test.mjs — atlassian provider contract.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

console.log('\nProvider — atlassian');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/atlassian.mjs')).href);
  const provider = mod.default;

  if (provider.id === 'atlassian') pass('atlassian.id is "atlassian"');
  else fail(`atlassian.id is ${JSON.stringify(provider.id)}`);

  const hit = provider.detect({ name: 'X', careers_url: 'https://www.atlassian.com/company/careers/all-jobs' });
  if (hit && hit.url) pass('atlassian.detect() resolves its careers host to an endpoint');
  else fail(`atlassian.detect() returned ${JSON.stringify(hit)}`);

  // The host must be compared exactly. A substring match would let
  // https://evil.example.com/www.atlassian.com/ and https://www.atlassian.com.evil.example.com/
  // both claim this provider and point the scanner at an attacker's server.
  const pathHijack = provider.detect({ name: 'X', careers_url: 'https://evil.example.com/www.atlassian.com/careers' });
  const suffixHijack = provider.detect({ name: 'X', careers_url: 'https://www.atlassian.com.evil.example.com/careers' });
  if (pathHijack === null && suffixHijack === null) {
    pass('atlassian.detect() compares the host exactly (path and suffix hijacks rejected)');
  } else {
    fail(`atlassian.detect() hijackable: path=${JSON.stringify(pathHijack)} suffix=${JSON.stringify(suffixHijack)}`);
  }

  if (provider.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('atlassian.detect() returns null for an unrelated host');
  } else {
    fail('atlassian.detect() should return null for an unrelated host');
  }

  if (provider.detect({ name: 'X', careers_url: null }) === null && provider.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('atlassian.detect() treats a non-string careers_url as missing');
  } else {
    fail('atlassian.detect() should treat a non-string careers_url as missing');
  }

  if (typeof provider.fetch === 'function') pass('atlassian.fetch() is callable');
  else fail('atlassian.fetch() is not a function');

  // Following a redirect lets a compromised host bounce the scanner to an
  // internal address and have the response parsed as job data.
  const src = readFileSync(join(ROOT, 'providers/atlassian.mjs'), 'utf-8');
  const fetches = (src.match(/ctx\.fetch(Json|Text)\(/g) || []).length;
  const guards = (src.match(/redirect:\s*'error'/g) || []).length;
  if (guards >= 1 && guards >= fetches) pass('atlassian passes redirect:"error" on every fetch');
  else fail(`atlassian: {fetches}=${fetches} guarded=${guards}`);
} catch (e) {
  fail(`atlassian provider tests threw: ${e.message}`);
}
