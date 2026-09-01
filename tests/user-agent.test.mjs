// tests/user-agent.test.mjs — the shared User-Agent constants must be stable
// (no package-version churn: a UA that moves on every release is an
// unintended fingerprint variable introduced into every scan without anyone
// deciding it should be there — see PR #2536 review) and must actually be
// the header value sent on the wire.
import { createServer } from 'node:http';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nShared User-Agent constants');

const { DEFAULT_USER_AGENT, BROWSER_LIKE_USER_AGENT } = await import(pathToFileURL(join(ROOT, 'user-agent.mjs')).href);
const { fetchJson } = await import(pathToFileURL(join(ROOT, 'providers/_http.mjs')).href);

// 1. Pinned to a literal, not derived from package.json — the exact
// regression this test guards. The trailing /1.0 is a UA-format version
// (Googlebot/2.1-style), bumped by hand only if this identifier's shape
// changes — it must never track the release version.
const EXPECTED_UA = 'Mozilla/5.0 (compatible; career-ops/1.0; +https://github.com/career-ops-hq/career-ops)';
if (DEFAULT_USER_AGENT === EXPECTED_UA) pass('DEFAULT_USER_AGENT matches the pinned literal');
else fail(`DEFAULT_USER_AGENT drifted from the pinned literal: got ${DEFAULT_USER_AGENT}`);

const EXPECTED_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
if (BROWSER_LIKE_USER_AGENT === EXPECTED_BROWSER_UA) pass('BROWSER_LIKE_USER_AGENT matches the pinned literal');
else fail(`BROWSER_LIKE_USER_AGENT drifted from the pinned literal: got ${BROWSER_LIKE_USER_AGENT}`);

// 2. The header that actually goes out on the wire matches the constant —
// checks 1 above only inspect the exported string in isolation, which
// wouldn't catch it if _http.mjs's internal fetchWithTimeout (not exported,
// so not importable here directly) stopped applying it or applied a mutated
// copy. Drive it through fetchJson, the public entry point that wraps it.
{
  let receivedUA = null;
  const server = createServer((req, res) => {
    receivedUA = req.headers['user-agent'];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    await fetchJson(base, { timeoutMs: 2_000 });
  } finally {
    await new Promise((r) => server.close(r));
  }

  if (receivedUA === DEFAULT_USER_AGENT) pass('fetchJson sends DEFAULT_USER_AGENT verbatim as the User-Agent header');
  else fail(`fetchJson sent an unexpected User-Agent: ${receivedUA}`);
}
