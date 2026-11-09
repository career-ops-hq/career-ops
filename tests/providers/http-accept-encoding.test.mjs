// tests/providers/http-accept-encoding.test.mjs — every provider request must
// pin accept-encoding to codecs undici decodes correctly. Left unset, Node's
// fetch negotiates zstd, and amazon.jobs' zstd response arrives truncated at
// exactly 1024 bytes with a 200 status — so the failure surfaces as
// "Unterminated string in JSON at position 1024" rather than a transport error.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — _http accept-encoding');

const { fetchJson, fetchText } = await import(pathToFileURL(join(ROOT, 'providers/_http.mjs')).href);

const realFetch = globalThis.fetch;
let seen = null;
globalThis.fetch = async (_url, init) => {
  seen = new Headers(init?.headers);
  return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
};

// The exact contract, not just "non-empty and no zstd": a narrowed set (say
// 'gzip' alone) would also avoid zstd but silently drop brotli and deflate.
const PINNED = 'gzip, deflate, br';

try {
  // 1. Default: exactly the pinned set, which never offers zstd.
  await fetchJson('https://example.com/jobs.json');
  const enc = seen?.get('accept-encoding') ?? '';
  if (enc === PINNED) pass(`fetchJson pins accept-encoding to exactly "${PINNED}"`);
  else fail(`fetchJson accept-encoding should be exactly "${PINNED}", got "${enc}"`);

  // 2. Same exact default on the text path.
  await fetchText('https://example.com/jobs.html');
  const textEnc = seen?.get('accept-encoding') ?? '';
  if (textEnc === PINNED) pass(`fetchText pins accept-encoding to exactly "${PINNED}"`);
  else fail(`fetchText accept-encoding should be exactly "${PINNED}", got "${textEnc}"`);

  // 3. A caller's explicit header still wins.
  await fetchJson('https://example.com/jobs.json', { headers: { 'accept-encoding': 'identity' } });
  if (seen?.get('accept-encoding') === 'identity') pass('a caller-supplied accept-encoding overrides the default');
  else fail(`caller override lost: got "${seen?.get('accept-encoding')}"`);

  // 4. Pinning must not displace the default user-agent.
  if (seen?.get('user-agent')) pass('default user-agent is still sent alongside the pinned encoding');
  else fail('user-agent header went missing');

  // 5. Header names are case-insensitive, so a capitalized override must
  // REPLACE the default. Before, it sat beside the lowercase default key and
  // fetch joined the two into "gzip, deflate, br, identity".
  await fetchJson('https://example.com/jobs.json', { headers: { 'Accept-Encoding': 'identity' } });
  if (seen?.get('accept-encoding') === 'identity') pass('a capitalized Accept-Encoding override replaces the default');
  else fail(`capitalized Accept-Encoding override merged instead of replacing: got "${seen?.get('accept-encoding')}"`);

  // 6. Same for User-Agent. Several providers pass a capitalized
  // 'User-Agent': BROWSER_LIKE_USER_AGENT, which was being joined onto the
  // default career-ops agent rather than sent on its own.
  await fetchText('https://example.com/jobs.html', { headers: { 'User-Agent': 'Mozilla/5.0 (test)' } });
  if (seen?.get('user-agent') === 'Mozilla/5.0 (test)') pass('a capitalized User-Agent override replaces the default');
  else fail(`capitalized User-Agent override merged instead of replacing: got "${seen?.get('user-agent')}"`);

  // 7. A Headers instance is accepted as-is. Spreading one yields {}, which
  // silently dropped every header the caller set.
  await fetchJson('https://example.com/jobs.json', { headers: new Headers({ accept: 'application/json' }) });
  if (seen?.get('accept') === 'application/json' && seen?.get('accept-encoding') === enc) {
    pass('a Headers instance keeps its entries and still gets the pinned encoding');
  } else {
    fail(`Headers instance mishandled: accept="${seen?.get('accept')}", accept-encoding="${seen?.get('accept-encoding')}"`);
  }
} catch (e) {
  fail(`accept-encoding test threw: ${e.message}`);
} finally {
  globalThis.fetch = realFetch;
}
