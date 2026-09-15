// tests/providers/careers-home.test.mjs — careers-home provider contract.
//
// These providers are EXPLICIT-CONFIG, not careers_url-sniffing: detect() fires
// only on the `careershome` key in portals.yml, so a board is never claimed by
// accident and there is no careers_url parsing surface to attack. The tests
// below pin that contract — a future refactor that made detect() sniff the URL
// would start silently claiming other vendors' boards.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — careers-home');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/careers-home.mjs')).href);
  const provider = mod.default;

  if (provider.id === 'careers-home') pass('careers-home.id is "careers-home"');
  else fail(`careers-home.id is ${JSON.stringify(provider.id)}`);

  const hit = provider.detect({ name: 'Acme', careershome: { host: 'careers.example.com' } });
  if (hit && hit.url === 'https://careers.example.com/api/jobs') pass('careers-home.detect() builds the endpoint from the configured host');
  else fail(`careers-home.detect() returned ${JSON.stringify(hit)}`);

  if (provider.detect({ name: 'Acme', careers_url: 'https://careers.example.com/careers' }) === null) {
    pass('careers-home.detect() ignores careers_url — config key only, so it never claims another vendor\'s board');
  } else {
    fail('careers-home.detect() should not fire on careers_url alone');
  }

  if (provider.detect({ name: 'Acme' }) === null) pass('careers-home.detect() returns null with no config');
  else fail('careers-home.detect() should return null with no config');

  if (typeof provider.fetch === 'function') pass('careers-home.fetch() is callable');
  else fail('careers-home.fetch() is not a function');

  // Every fetch this provider makes must refuse redirects: a compromised or
  // misconfigured tenant could otherwise bounce the scanner to an internal
  // address and have the response parsed as job data.
  const src = (await import('fs')).readFileSync(join(ROOT, 'providers/careers-home.mjs'), 'utf-8');
  if (/redirect:\s*'error'/.test(src)) pass('careers-home passes redirect:"error" (SSRF via redirect)');
  else fail('careers-home does not pass redirect:"error" on its fetches');
  // A health probe passes ctx.maxPages=1; walking the whole board to answer
  // "does this host answer?" is the difference between one request and hundreds.
  let pagesRequested = 0;
  const probeCtx = { transport: 'http', maxPages: 1,
    fetchJson: async () => { pagesRequested++; return {}; },
    fetchText: async () => { pagesRequested++; return ''; } };
  await provider.fetch({ name: 'Acme', careershome: { host: 'careers.example.com' } }, probeCtx).catch(() => []);
  if (pagesRequested <= 1) pass('careers-home honors ctx.maxPages (health probe costs one request)');
  else fail(`careers-home requested ${pagesRequested} pages for a maxPages=1 probe`);

} catch (e) {
  fail(`careers-home provider tests threw: ${e.message}`);
}
