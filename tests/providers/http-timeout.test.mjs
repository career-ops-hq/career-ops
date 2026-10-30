// tests/providers/http-timeout.test.mjs — the abort timeout must cover the
// BODY read, not just the header phase. A server that sends headers and then
// stalls the body used to hang fetchJson forever, which could silently freeze
// a full-directory sweep partway through with no error output.
import { createServer } from 'node:http';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT, withLocalServerAs } from '../helpers.mjs';

console.log('\nProvider — _http timeout');

const { fetchJson, fetchText } = await import(pathToFileURL(join(ROOT, 'providers/_http.mjs')).href);

// Independent upper bound: if the mechanism under test regresses and the call
// never settles, this makes the test fail fast (hitting the elapsed assertion)
// instead of reintroducing the very silent hang this suite guards against.
// Set well above the 300ms request timeout but bounded far below a real hang.
function hardTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: hard test timeout after ${ms}ms — regression suspected`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));  // else the loser keeps the loop alive to `ms`
}

// Bounded allowance over the 300ms request timeout: loose enough for a slow CI
// runner, tight enough that a multi-second stalled-body regression still fails.
const MAX_ABORT_MS = 1_500;

const sockets = new Set();
const server = createServer((req, res) => {
  if (req.url === '/stall') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"jobs": [');   // headers + partial body, then silence forever
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');
});
server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
// The provider guard refuses a loopback destination, so the requests go to a
// public-looking origin and the transport is pointed at the local server.
const base = 'http://stalls.example.test';
const viaLocal = (fn) => withLocalServerAs(base, `http://127.0.0.1:${server.address().port}`, fn);
// A refusal by the guard is an error too, and the two stalled-body checks
// below pass on ANY rejection. Make sure what they time is the abort.
const isAbort = (err) => { const e = err?.cause ?? err; return e?.name === 'AbortError' || e?.name === 'TimeoutError' || /abort|timed? ?out/i.test(String(err?.message ?? '')); };

// 1. Stalled body must abort within the timeout window, not hang.
{
  const t0 = Date.now();
  try {
    await hardTimeout(viaLocal(() => fetchJson(`${base}/stall`, { timeoutMs: 300 })), 8_000, 'fetchJson /stall');
    fail('fetchJson resolved on a stalled body');
  } catch (err) {
    const elapsed = Date.now() - t0;
    if (!isAbort(err)) fail(`fetchJson /stall failed for another reason than the abort: ${err?.message}`);
    else if (elapsed < MAX_ABORT_MS) pass(`fetchJson aborted stalled body read in ${elapsed}ms`);
    else fail(`fetchJson took ${elapsed}ms to abort a stalled body (timeout not covering body read)`);
  }
}

// 2. Same for fetchText.
{
  const t0 = Date.now();
  try {
    await hardTimeout(viaLocal(() => fetchText(`${base}/stall`, { timeoutMs: 300 })), 8_000, 'fetchText /stall');
    fail('fetchText resolved on a stalled body');
  } catch (err) {
    const elapsed = Date.now() - t0;
    if (!isAbort(err)) fail(`fetchText /stall failed for another reason than the abort: ${err?.message}`);
    else if (elapsed < MAX_ABORT_MS) pass(`fetchText aborted stalled body read in ${elapsed}ms`);
    else fail(`fetchText took ${elapsed}ms to abort a stalled body`);
  }
}

// 3. Happy path still works after the refactor.
{
  const ok = await viaLocal(() => fetchJson(`${base}/ok`, { timeoutMs: 2_000 }));
  if (ok && ok.ok === true) pass('fetchJson still parses a completed body');
  else fail(`fetchJson happy path broken: ${JSON.stringify(ok)}`);
}

// 4. CAREER_OPS_HTTP_TIMEOUT_MS overrides the default budget.
// A board that returns its whole catalogue in one response can outlast the 10s
// default, and the abort surfaces as an unreachable portal rather than as a
// timeout — so the board reads as broken instead of slow. Raising the budget is
// a deployment concern, so it is an env var; an unusable value must fall back
// rather than fail a scan at request time.
{
  const { resolveDefaultTimeoutMs } = await import(pathToFileURL(join(ROOT, 'providers/_http.mjs')).href);
  const eq = (label, actual, expected) => {
    if (actual === expected) pass(label);
    else fail(`${label} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  };

  // Every unusable shape falls back to the documented 10s default.
  //
  // Sub-millisecond and 32-bit-overflow values are unusable for the same reason
  // rather than an arithmetic one: setTimeout rewrites any delay below 1ms or
  // above 2_147_483_647ms to 1ms, so such a value would abort every request
  // almost immediately — the exact failure this env var exists to prevent,
  // reached by a typo instead of a slow board.
  for (const [raw, label] of [
    [undefined, 'unset'], [null, 'null'], ['', 'empty string'], ['   ', 'whitespace'],
    ['abc', 'non-numeric'], ['0', 'zero'], ['-5', 'negative'],
    ['Infinity', 'Infinity'], ['NaN', 'NaN'],
    ['0.5', 'sub-millisecond'], ['2147483648', 'timer overflow'],
  ]) {
    eq(`CAREER_OPS_HTTP_TIMEOUT_MS ${label} → 10s default`, resolveDefaultTimeoutMs(raw), 10_000);
  }

  // The bounds are inclusive: both edges are delays setTimeout honors as written.
  eq('1ms — the smallest delay setTimeout does not rewrite', resolveDefaultTimeoutMs('1'), 1);
  eq('2147483647ms — the largest delay setTimeout does not rewrite', resolveDefaultTimeoutMs('2147483647'), 2_147_483_647);

  eq('a valid numeric string overrides the default', resolveDefaultTimeoutMs('30000'), 30_000);
  eq('a valid number overrides the default', resolveDefaultTimeoutMs(45_000), 45_000);
  eq('an explicit fallback is honored when the value is unusable', resolveDefaultTimeoutMs('nope', 7_000), 7_000);
}

// 5. The env var reaches the real request budget, not just the helper.
// The default is read once at module load, so load a fresh instance with the
// variable set and stall a request that passes no timeoutMs. If the env read
// is ever disconnected (e.g. DEFAULT_TIMEOUT_MS hardcoded back to 10_000), the
// request waits out the 10s default and the hard timeout below fails the test.
{
  const prev = process.env.CAREER_OPS_HTTP_TIMEOUT_MS;
  process.env.CAREER_OPS_HTTP_TIMEOUT_MS = '300';
  try {
    const fresh = await import(`${pathToFileURL(join(ROOT, 'providers/_http.mjs')).href}?env-timeout`);
    const t0 = Date.now();
    try {
      await hardTimeout(viaLocal(() => fresh.fetchJson(`${base}/stall`)), 4_000, 'fetchJson /stall with env budget');
      fail('fetchJson resolved on a stalled body under CAREER_OPS_HTTP_TIMEOUT_MS');
    } catch (err) {
      const elapsed = Date.now() - t0;
      if (!isAbort(err)) fail(`CAREER_OPS_HTTP_TIMEOUT_MS=300 did not set the request budget: ${err?.message}`);
      else if (elapsed < MAX_ABORT_MS) pass(`CAREER_OPS_HTTP_TIMEOUT_MS=300 aborted a request with no timeoutMs in ${elapsed}ms`);
      else fail(`CAREER_OPS_HTTP_TIMEOUT_MS=300 took ${elapsed}ms to abort (env budget not applied)`);
    }
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_HTTP_TIMEOUT_MS;
    else process.env.CAREER_OPS_HTTP_TIMEOUT_MS = prev;
  }
}

for (const s of sockets) s.destroy();
server.close();
