// tests/providers/google.test.mjs — google provider contract.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

console.log('\nProvider — google');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/google.mjs')).href);
  const provider = mod.default;

  if (provider.id === 'google') pass('google.id is "google"');
  else fail(`google.id is ${JSON.stringify(provider.id)}`);

  if (provider.detect({ name: 'X' }) === null) pass('google.detect() returns null with no config');
  else fail('google.detect() should return null with no config');

  if (provider.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('google.detect() ignores careers_url — config key only');
  } else {
    fail('google.detect() should not fire on careers_url alone');
  }

  if (typeof provider.fetch === 'function') pass('google.fetch() is callable');
  else fail('google.fetch() is not a function');

  // Following a redirect lets a compromised host bounce the scanner to an
  // internal address and have the response parsed as job data.
  const src = readFileSync(join(ROOT, 'providers/google.mjs'), 'utf-8');
  const fetches = (src.match(/ctx\.fetch(Json|Text)\(/g) || []).length;
  const guards = (src.match(/redirect:\s*'error'/g) || []).length;
  if (guards >= 1 && guards >= fetches) pass('google passes redirect:"error" on every fetch');
  else fail(`google: {fetches}=${fetches} guarded=${guards}`);
} catch (e) {
  fail(`google provider tests threw: ${e.message}`);
}
