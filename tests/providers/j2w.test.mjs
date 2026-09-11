// tests/providers/j2w.test.mjs — j2w provider contract.
//
// These providers are EXPLICIT-CONFIG, not careers_url-sniffing: detect() fires
// only on the `j2w` key in portals.yml, so a board is never claimed by
// accident and there is no careers_url parsing surface to attack. The tests
// below pin that contract — a future refactor that made detect() sniff the URL
// would start silently claiming other vendors' boards.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — j2w');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/j2w.mjs')).href);
  const provider = mod.default;

  if (provider.id === 'j2w') pass('j2w.id is "j2w"');
  else fail(`j2w.id is ${JSON.stringify(provider.id)}`);

  const hit = provider.detect({ name: 'Acme', j2w: { host: 'careers.example.com' } });
  if (hit && hit.url === 'https://careers.example.com/search/') pass('j2w.detect() builds the endpoint from the configured host');
  else fail(`j2w.detect() returned ${JSON.stringify(hit)}`);

  if (provider.detect({ name: 'Acme', careers_url: 'https://careers.example.com/careers' }) === null) {
    pass('j2w.detect() ignores careers_url — config key only, so it never claims another vendor\'s board');
  } else {
    fail('j2w.detect() should not fire on careers_url alone');
  }

  if (provider.detect({ name: 'Acme' }) === null) pass('j2w.detect() returns null with no config');
  else fail('j2w.detect() should return null with no config');

  if (typeof provider.fetch === 'function') pass('j2w.fetch() is callable');
  else fail('j2w.fetch() is not a function');

  // Every fetch this provider makes must refuse redirects: a compromised or
  // misconfigured tenant could otherwise bounce the scanner to an internal
  // address and have the response parsed as job data.
  const src = (await import('fs')).readFileSync(join(ROOT, 'providers/j2w.mjs'), 'utf-8');
  if (/redirect:\s*'error'/.test(src)) pass('j2w passes redirect:"error" (SSRF via redirect)');
  else fail('j2w does not pass redirect:"error" on its fetches');
  // A health probe passes ctx.maxPages=1; walking the whole board to answer
  // "does this host answer?" is the difference between one request and hundreds.
  let pagesRequested = 0;
  const probeCtx = { transport: 'http', maxPages: 1,
    fetchJson: async () => { pagesRequested++; return {}; },
    fetchText: async () => { pagesRequested++; return ''; } };
  await provider.fetch({ name: 'Acme', j2w: { host: 'careers.example.com' } }, probeCtx).catch(() => []);
  if (pagesRequested <= 1) pass('j2w honors ctx.maxPages (health probe costs one request)');
  else fail(`j2w requested ${pagesRequested} pages for a maxPages=1 probe`);

} catch (e) {
  fail(`j2w provider tests threw: ${e.message}`);
}
