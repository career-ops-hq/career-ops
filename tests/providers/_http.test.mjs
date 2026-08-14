// tests/providers/_http.test.mjs — direct coverage of isRetryableError() and
// fetchJsonWithRetry(), previously only exercised indirectly through
// consumer providers' tests.
//
// Main case: a refused redirect (redirect:'error' meeting a 3xx — mandatory
// on every provider, #1440) surfaces as a bare TypeError with no .status, the
// same shape as a transient network error, but it's deterministic and must
// NOT be retried.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — _http retry helpers');

const { isRetryableError, fetchJsonWithRetry, fetchResponse } =
  await import(pathToFileURL(join(ROOT, 'providers/_http.mjs')).href);

// isRetryableError() — status-based classification.
if (isRetryableError({ status: 429 }) === true) pass('isRetryableError(429) is true');
else fail('isRetryableError(429) should be true');

if (isRetryableError({ status: 500 }) === true && isRetryableError({ status: 503 }) === true) {
  pass('isRetryableError(5xx) is true');
} else {
  fail('isRetryableError(5xx) should be true');
}

if (isRetryableError({ status: 400 }) === false && isRetryableError({ status: 404 }) === false) {
  pass('isRetryableError(other 4xx) is false');
} else {
  fail('isRetryableError(other 4xx) should be false');
}

if (isRetryableError(new Error('network down')) === true) {
  pass('isRetryableError(generic no-status network error) is true');
} else {
  fail('isRetryableError(generic no-status network error) should be true');
}

// The refused-redirect shape: a bare TypeError with err.cause.message set to
// undici's REDIRECT_REFUSAL_CAUSE_MESSAGE (see providers/_http.mjs). Hardcoded
// here rather than imported — the whole point of pinning it is to catch a
// typo/drift in the production constant, not compare it to itself. Must be
// classified as non-retryable, unlike a plain network error above.
const UNEXPECTED_REDIRECT_CAUSE_MESSAGE = 'unexpected redirect';
const redirectRefusal = Object.assign(new TypeError('fetch failed'), {
  cause: { message: UNEXPECTED_REDIRECT_CAUSE_MESSAGE },
});
if (isRetryableError(redirectRefusal) === false) {
  pass('isRetryableError(refused redirect) is false');
} else {
  fail('isRetryableError(refused redirect) should be false — it will never succeed on retry');
}

// Node <18.5 reports cause===undefined for a refused redirect too — falls
// through to the old (retryable) classification.
const oldNodeShape = Object.assign(new TypeError('fetch failed'), { cause: undefined });
if (isRetryableError(oldNodeShape) === true) {
  pass('isRetryableError(cause===undefined, old-Node fallback) is true');
} else {
  fail('isRetryableError(cause===undefined) should fall back to retryable');
}

// A non-TypeError error carrying the same cause.message by coincidence must
// NOT be treated as a redirect refusal — only fetch()'s own TypeError shape
// is trusted, since the message string alone isn't a reliable signal.
const nonTypeErrorLookalike = Object.assign(new Error('boom'), {
  cause: { message: UNEXPECTED_REDIRECT_CAUSE_MESSAGE },
});
if (isRetryableError(nonTypeErrorLookalike) === true) {
  pass('isRetryableError(non-TypeError with matching cause.message) is true');
} else {
  fail('isRetryableError(non-TypeError with matching cause.message) should stay retryable');
}

// End-to-end: fetchJsonWithRetry must call ctx.fetchJson exactly once on a
// redirect-refusal error, not retries+1 times.
{
  let calls = 0;
  const ctx = {
    fetchJson: async () => { calls++; throw redirectRefusal; },
    sleep: async () => {},
  };
  try {
    await fetchJsonWithRetry(ctx, 'https://example.com/jobs', {});
    fail('fetchJsonWithRetry should rethrow on a redirect refusal');
  } catch (e) {
    if (calls === 1 && e === redirectRefusal) {
      pass('fetchJsonWithRetry calls ctx.fetchJson exactly once on a redirect refusal (no wasted retries)');
    } else {
      fail(`fetchJsonWithRetry redirect refusal: calls=${calls}, error=${e?.message}`);
    }
  }
}

// ── fetchResponse() ─────────────────────────────────────────────────────────
// Regression: fetchResponse() previously called the internal fetchWithTimeout
// WITHOUT its required `consume` callback, so every call threw
// "consume is not a function". It had no callers, so nothing caught it until
// csod.mjs needed Set-Cookie off the bootstrap response. These tests pin the
// contract it is meant to provide.
{
  const realFetch = globalThis.fetch;
  const stub = (body, init) => { globalThis.fetch = async () => new Response(body, init); };
  try {
    // Repeated Set-Cookie must survive — this is the whole reason the helper
    // exists, and a naive header copy collapses them into one comma-joined value.
    const headers = new Headers();
    headers.append('set-cookie', 'ASP.NET_SessionId=abc; path=/; HttpOnly');
    headers.append('set-cookie', 'tenant=kln; Secure');
    stub('{"token":"tok"}', { status: 200, headers });
    const res = await fetchResponse('https://example.com/home');
    const cookies = res.headers.getSetCookie();
    if (cookies.length === 2 && cookies[0].startsWith('ASP.NET_SessionId=abc')) {
      pass('fetchResponse() preserves repeated Set-Cookie headers');
    } else {
      fail(`fetchResponse() set-cookie wrong: ${JSON.stringify(cookies)}`);
    }
    if (await res.text() === '{"token":"tok"}') pass('fetchResponse() body is still readable by the caller');
    else fail('fetchResponse() body should be readable');

    // A null-body status must not blow up the Response reconstruction.
    stub(null, { status: 204 });
    const empty = await fetchResponse('https://example.com/empty');
    if (empty.status === 204) pass('fetchResponse() handles null-body statuses (204) without throwing');
    else fail(`fetchResponse() 204 wrong: status=${empty.status}`);
  } catch (e) {
    fail(`fetchResponse() threw: ${e.message}`);
  } finally {
    globalThis.fetch = realFetch;
  }
}
