// tests/providers/meta.test.mjs — meta provider contract.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

console.log('\nProvider — meta');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/meta.mjs')).href);
  const provider = mod.default;

  if (provider.id === 'meta') pass('meta.id is "meta"');
  else fail(`meta.id is ${JSON.stringify(provider.id)}`);

  if (provider.detect({ name: 'X' }) === null) pass('meta.detect() returns null with no config');
  else fail('meta.detect() should return null with no config');

  if (provider.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('meta.detect() ignores careers_url — config key only');
  } else {
    fail('meta.detect() should not fire on careers_url alone');
  }

  if (typeof provider.fetch === 'function') pass('meta.fetch() is callable');
  else fail('meta.fetch() is not a function');

  // Following a redirect lets a compromised host bounce the scanner to an
  // internal address and have the response parsed as job data.
  const src = readFileSync(join(ROOT, 'providers/meta.mjs'), 'utf-8');
  const fetches = (src.match(/ctx\.fetch(Json|Text)\(/g) || []).length;
  const guards = (src.match(/redirect:\s*'error'/g) || []).length;
  if (guards >= 1 && guards >= fetches) pass('meta passes redirect:"error" on every fetch');
  else fail(`meta: {fetches}=${fetches} guarded=${guards}`);
} catch (e) {
  fail(`meta provider tests threw: ${e.message}`);
}
