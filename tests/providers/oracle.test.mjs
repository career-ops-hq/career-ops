// tests/providers/oracle.test.mjs — oracle provider contract.
//
// These providers are EXPLICIT-CONFIG, not careers_url-sniffing: detect() fires
// only on the `oracle` key in portals.yml, so a board is never claimed by
// accident and there is no careers_url parsing surface to attack. The tests
// below pin that contract — a future refactor that made detect() sniff the URL
// would start silently claiming other vendors' boards.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — oracle');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/oracle.mjs')).href);
  const provider = mod.default;

  if (provider.id === 'oracle') pass('oracle.id is "oracle"');
  else fail(`oracle.id is ${JSON.stringify(provider.id)}`);

  const hit = provider.detect({ name: 'Acme', oracle: { host: 'egug.fa.us2.oraclecloud.com' } });
  if (hit && hit.url === 'https://egug.fa.us2.oraclecloud.com') pass('oracle.detect() builds the endpoint from the configured host');
  else fail(`oracle.detect() returned ${JSON.stringify(hit)}`);

  if (provider.detect({ name: 'Acme', careers_url: 'https://egug.fa.us2.oraclecloud.com/careers' }) === null) {
    pass('oracle.detect() ignores careers_url — config key only, so it never claims another vendor\'s board');
  } else {
    fail('oracle.detect() should not fire on careers_url alone');
  }

  if (provider.detect({ name: 'Acme' }) === null) pass('oracle.detect() returns null with no config');
  else fail('oracle.detect() should return null with no config');

  if (typeof provider.fetch === 'function') pass('oracle.fetch() is callable');
  else fail('oracle.fetch() is not a function');

  // Every fetch this provider makes must refuse redirects: a compromised or
  // misconfigured tenant could otherwise bounce the scanner to an internal
  // address and have the response parsed as job data.
  const src = (await import('fs')).readFileSync(join(ROOT, 'providers/oracle.mjs'), 'utf-8');
  if (/redirect:\s*'error'/.test(src)) pass('oracle passes redirect:"error" (SSRF via redirect)');
  else fail('oracle does not pass redirect:"error" on its fetches');
  // A health probe passes ctx.maxPages=1; walking the whole board to answer
  // "does this host answer?" is the difference between one request and hundreds.
  let pagesRequested = 0;
  const probeCtx = { transport: 'http', maxPages: 1,
    fetchJson: async () => { pagesRequested++; return {}; },
    fetchText: async () => { pagesRequested++; return ''; } };
  await provider.fetch({ name: 'Acme', oracle: { host: 'egug.fa.us2.oraclecloud.com' } }, probeCtx).catch(() => []);
  if (pagesRequested <= 1) pass('oracle honors ctx.maxPages (health probe costs one request)');
  else fail(`oracle requested ${pagesRequested} pages for a maxPages=1 probe`);

} catch (e) {
  fail(`oracle provider tests threw: ${e.message}`);
}
