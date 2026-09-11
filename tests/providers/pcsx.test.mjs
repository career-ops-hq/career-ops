// tests/providers/pcsx.test.mjs — pcsx provider contract.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

console.log('\nProvider — pcsx');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/pcsx.mjs')).href);
  const provider = mod.default;

  if (provider.id === 'pcsx') pass('pcsx.id is "pcsx"');
  else fail(`pcsx.id is ${JSON.stringify(provider.id)}`);

  if (provider.detect({ name: 'X' }) === null) pass('pcsx.detect() returns null with no config');
  else fail('pcsx.detect() should return null with no config');

  if (provider.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('pcsx.detect() ignores careers_url — config key only');
  } else {
    fail('pcsx.detect() should not fire on careers_url alone');
  }

  if (typeof provider.fetch === 'function') pass('pcsx.fetch() is callable');
  else fail('pcsx.fetch() is not a function');

  // Following a redirect lets a compromised host bounce the scanner to an
  // internal address and have the response parsed as job data.
  const src = readFileSync(join(ROOT, 'providers/pcsx.mjs'), 'utf-8');
  const fetches = (src.match(/ctx\.fetch(Json|Text)\(/g) || []).length;
  const guards = (src.match(/redirect:\s*'error'/g) || []).length;
  if (guards >= 1 && guards >= fetches) pass('pcsx passes redirect:"error" on every fetch');
  else fail(`pcsx: {fetches}=${fetches} guarded=${guards}`);
} catch (e) {
  fail(`pcsx provider tests threw: ${e.message}`);
}
