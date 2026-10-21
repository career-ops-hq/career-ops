// tests/providers/consider.test.mjs — direct provider-contract tests (PR #825).
// Consider boards take their origin from a config-driven careers_url, so the
// host guard is the security boundary here: detect() and fetch() must both
// reject non-https, IP-literal, loopback, link-local, and internal-suffix hosts
// before any request goes out. Also covers the redirect:'error' guard and
// malformed-payload tolerance.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — consider');

try {
  const consider = (await import(pathToFileURL(join(ROOT, 'providers/consider.mjs')).href)).default;

  if (consider.id === 'consider') pass('consider.id is "consider"');
  else fail(`consider.id is ${JSON.stringify(consider.id)}`);

  const okEntry = { name: 'Founderful', consider_board: 'wingman', careers_url: 'https://jobs.founderful.com/jobs' };
  const hit = consider.detect(okEntry);
  if (hit && hit.url === 'https://jobs.founderful.com/api-boards/search-jobs') pass('consider.detect() claims a valid https board');
  else fail(`consider.detect() returned ${JSON.stringify(hit)}`);

  if (consider.detect({ name: 'X', careers_url: 'https://jobs.founderful.com/jobs' }) === null) {
    pass('consider.detect() returns null without consider_board');
  } else {
    fail('consider.detect() must require consider_board');
  }

  // SSRF: non-https + IP-literal + loopback/internal hosts are all rejected.
  const considerEvil = [
    ['http://jobs.founderful.com/jobs', 'non-https'],
    ['https://127.0.0.1/jobs', 'IPv4 loopback'],
    ['https://169.254.169.254/jobs', 'cloud metadata IPv4'],
    ['https://[::1]/jobs', 'IPv6 loopback'],
    ['https://localhost/jobs', 'localhost'],
    ['https://stuff.internal/jobs', '.internal suffix'],
    ['https://box.local/jobs', '.local suffix'],
  ];
  let considerBlocked = 0;
  for (const [url, label] of considerEvil) {
    if (consider.detect({ name: 'Evil', consider_board: 'x', careers_url: url }) === null) considerBlocked++;
    else fail(`consider.detect() should reject unsafe host (${label}): ${url}`);
  }
  if (considerBlocked === considerEvil.length) pass(`consider host guard rejects ${considerEvil.length} unsafe hosts (SSRF)`);

  // Shared no-op stub: prevents acquireCsrfHandshake from touching the network
  // in unit tests. Tests that verify CSRF behaviour supply their own stub below.
  const noHandshake = async () => ({ cookie: null, csrfToken: null });

  // fetch() passes redirect:'error' on the happy path.
  let considerOpts = null;
  const considerJobs = await consider.fetch(okEntry, {
    _acquireHandshake: noHandshake,
    fetchJson: async (_url, opts) => {
      considerOpts = opts;
      return { jobs: [{ title: 'AI Eng', url: 'https://jobs.founderful.com/x', companyName: 'Acme', locations: ['Remote'], timeStamp: '2026-01-02' }] };
    },
  });
  if (considerOpts?.redirect === 'error') pass('consider.fetch() passes redirect:"error"');
  else fail(`consider.fetch() should pass redirect:"error", got ${JSON.stringify(considerOpts)}`);
  if (considerJobs.length === 1 && considerJobs[0].company === 'Acme') pass('consider.fetch() normalizes a job row');
  else fail(`consider.fetch() row = ${JSON.stringify(considerJobs[0])}`);

  // postedAt is derived from timeStamp — both the ISO and epoch-ms shapes.
  if (considerJobs[0].postedAt === Date.parse('2026-01-02')) pass('consider.fetch() maps an ISO timeStamp to postedAt');
  else fail(`consider.fetch() postedAt = ${JSON.stringify(considerJobs[0].postedAt)}`);

  // A non-positive stamp is treated as missing, not as 1970 (which would read
  // as permanently stale to the freshness filter).
  const considerZeroStamp = await consider.fetch(okEntry, {
    _acquireHandshake: noHandshake,
    fetchJson: async () => ({ jobs: [{ title: 'T', url: 'https://jobs.founderful.com/y', companyName: 'Acme', timeStamp: 0 }] }),
  });
  if (considerZeroStamp[0]?.postedAt == null) pass('consider.fetch() treats a 0 timeStamp as missing, not epoch 0');
  else fail(`consider.fetch() postedAt for timeStamp=0 = ${JSON.stringify(considerZeroStamp[0]?.postedAt)}`);

  // fetch() refuses an unsafe host BEFORE touching the network.
  let considerThrew = false;
  try {
    await consider.fetch(
      { name: 'Evil', consider_board: 'x', careers_url: 'https://169.254.169.254/jobs' },
      { fetchJson: async () => { throw new Error('SSRF! should not reach here'); } },
    );
  } catch (e) { considerThrew = /public host|https/.test(e.message); }
  if (considerThrew) pass('consider.fetch() rejects unsafe host before fetch');
  else fail('consider.fetch() must throw on an unsafe host without fetching');

  // Malformed / empty payloads → empty array, no crash.
  const considerEmpty = await consider.fetch(okEntry, { _acquireHandshake: noHandshake, fetchJson: async () => ({}) });
  const considerNoUrl = await consider.fetch(okEntry, { _acquireHandshake: noHandshake, fetchJson: async () => ({ jobs: [{ title: 'No URL' }] }) });
  if (Array.isArray(considerEmpty) && considerEmpty.length === 0 && Array.isArray(considerNoUrl) && considerNoUrl.length === 0) {
    pass('consider.fetch() tolerates malformed/empty payloads');
  } else {
    fail(`consider.fetch() malformed handling: ${JSON.stringify({ considerEmpty, considerNoUrl })}`);
  }
  // ── CSRF handshake ──────────────────────────────────────────────────────────

  // The handshake must be called with the board origin (not the full careers_url).
  let handshakeOrigin = null;
  await consider.fetch(okEntry, {
    _acquireHandshake: async (origin) => { handshakeOrigin = origin; return { cookie: null, csrfToken: null }; },
    fetchJson: async () => ({ jobs: [] }),
  });
  if (handshakeOrigin === 'https://jobs.founderful.com') pass('consider.fetch() passes board origin to the handshake');
  else fail(`consider.fetch() handshake origin = ${JSON.stringify(handshakeOrigin)}`);

  // When the handshake returns a cookie, it must appear in the POST headers.
  let postHeadersWithCookie = null;
  await consider.fetch(okEntry, {
    _acquireHandshake: async () => ({ cookie: 'session=abc; session.sig=xyz', csrfToken: null }),
    fetchJson: async (_url, opts) => { postHeadersWithCookie = opts.headers; return { jobs: [] }; },
  });
  if (postHeadersWithCookie?.cookie === 'session=abc; session.sig=xyz') pass('consider.fetch() forwards cookie to the POST');
  else fail(`consider.fetch() POST cookie header = ${JSON.stringify(postHeadersWithCookie?.cookie)}`);

  // When the handshake returns a csrfToken, it must appear as x-csrf-token.
  let postHeadersWithCsrf = null;
  await consider.fetch(okEntry, {
    _acquireHandshake: async () => ({ cookie: null, csrfToken: 'tok123abc' }),
    fetchJson: async (_url, opts) => { postHeadersWithCsrf = opts.headers; return { jobs: [] }; },
  });
  if (postHeadersWithCsrf?.['x-csrf-token'] === 'tok123abc') pass('consider.fetch() forwards x-csrf-token to the POST');
  else fail(`consider.fetch() POST x-csrf-token = ${JSON.stringify(postHeadersWithCsrf?.['x-csrf-token'])}`);

  // When both cookie and csrfToken are returned, both must be in the POST.
  let postHeadersBoth = null;
  await consider.fetch(okEntry, {
    _acquireHandshake: async () => ({ cookie: 'session=s1; session.sig=s2', csrfToken: 'token-full' }),
    fetchJson: async (_url, opts) => { postHeadersBoth = opts.headers; return { jobs: [] }; },
  });
  if (postHeadersBoth?.cookie === 'session=s1; session.sig=s2' && postHeadersBoth?.['x-csrf-token'] === 'token-full') {
    pass('consider.fetch() forwards both cookie and x-csrf-token when handshake succeeds');
  } else {
    fail(`consider.fetch() POST headers (both) = ${JSON.stringify(postHeadersBoth)}`);
  }

  // When the handshake returns null for both, no cookie/x-csrf-token must appear.
  let postHeadersNone = null;
  await consider.fetch(okEntry, {
    _acquireHandshake: async () => ({ cookie: null, csrfToken: null }),
    fetchJson: async (_url, opts) => { postHeadersNone = opts.headers; return { jobs: [] }; },
  });
  if (!('cookie' in postHeadersNone) && !('x-csrf-token' in postHeadersNone)) {
    pass('consider.fetch() omits cookie and x-csrf-token when handshake returns null');
  } else {
    fail(`consider.fetch() POST headers (null handshake) = ${JSON.stringify(postHeadersNone)}`);
  }

  // A failed handshake (null/null) must not prevent the POST from being attempted.
  let degradedPostCalled = false;
  await consider.fetch(okEntry, {
    _acquireHandshake: async () => ({ cookie: null, csrfToken: null }),
    fetchJson: async () => { degradedPostCalled = true; return { jobs: [] }; },
  });
  if (degradedPostCalled) pass('consider.fetch() attempts the POST even when the handshake returns null');
  else fail('consider.fetch() must not skip the POST when handshake fails');

  // ── Real acquireCsrfHandshake path (ctx.fetchResponse stub) ────────────────
  // The tests above stub _acquireHandshake and never exercise the actual GET
  // /jobs logic. These leave it unset so the real function runs, and verify
  // that the cookie and csrfToken it extracts reach the POST.
  //
  // The handshake must go out through ctx.fetchResponse, not bare fetch: the
  // provider DNS guard only covers requests made by the ctx helpers, so a bare
  // fetch is a hop whose resolved address nothing validates. globalThis.fetch
  // is replaced with a recorder for the whole block to prove it is never used.
  {
    const realFetch = globalThis.fetch;
    const bareFetchCalls = [];
    globalThis.fetch = async (url) => { bareFetchCalls.push(String(url)); throw new TypeError('bare fetch'); };

    const handshakeResponse = (status, cookies, html) => {
      const headers = new Headers({ 'content-type': 'text/html' });
      for (const c of cookies) headers.append('set-cookie', c);
      return new Response(html, { status, headers });
    };

    try {
      let handshakeUrl = null;
      let handshakeOpts = null;
      let realHandshakePostHeaders = null;
      await consider.fetch(okEntry, {
        // No _acquireHandshake — exercises the real acquireCsrfHandshake.
        fetchResponse: async (url, opts) => {
          handshakeUrl = url;
          handshakeOpts = opts;
          return handshakeResponse(200,
            ['session=s1; Path=/; HttpOnly', 'session.sig=sig1; Path=/'],
            `<script>window.__cfg={"csrfToken":"handshake-token-ok"}</script>`);
        },
        fetchJson: async (_url, opts) => {
          realHandshakePostHeaders = opts.headers;
          return { jobs: [] };
        },
      });

      if (handshakeUrl === 'https://jobs.founderful.com/jobs') {
        pass('acquireCsrfHandshake GETs {origin}/jobs through ctx.fetchResponse');
      } else {
        fail(`acquireCsrfHandshake GET url = ${JSON.stringify(handshakeUrl)}`);
      }
      if (handshakeOpts?.redirect === 'error') {
        pass('acquireCsrfHandshake uses redirect:"error" (SSRF guard)');
      } else {
        fail(`acquireCsrfHandshake redirect = ${JSON.stringify(handshakeOpts?.redirect)}`);
      }
      if (Number.isFinite(handshakeOpts?.timeoutMs) && handshakeOpts.timeoutMs < 20_000) {
        pass('acquireCsrfHandshake passes its own (shorter) timeout budget');
      } else {
        fail(`acquireCsrfHandshake timeoutMs = ${JSON.stringify(handshakeOpts?.timeoutMs)}`);
      }
      if (realHandshakePostHeaders?.cookie === 'session=s1; session.sig=sig1') {
        pass('acquireCsrfHandshake extracts Set-Cookie and forwards it to the POST');
      } else {
        fail(`acquireCsrfHandshake cookie = ${JSON.stringify(realHandshakePostHeaders?.cookie)}`);
      }
      if (realHandshakePostHeaders?.['x-csrf-token'] === 'handshake-token-ok') {
        pass('acquireCsrfHandshake extracts csrfToken from HTML and forwards it to the POST');
      } else {
        fail(`acquireCsrfHandshake x-csrf-token = ${JSON.stringify(realHandshakePostHeaders?.['x-csrf-token'])}`);
      }

      // A redirect on GET /jobs (e.g. redirect to a private IP) must cause the
      // handshake to degrade gracefully — the POST is still attempted.
      let redirectDegradedPostCalled = false;
      await consider.fetch(okEntry, {
        fetchResponse: async () => { throw new TypeError('fetch failed'); },
        fetchJson: async () => { redirectDegradedPostCalled = true; return { jobs: [] }; },
      });
      if (redirectDegradedPostCalled) {
        pass('acquireCsrfHandshake degrades gracefully on redirect (redirect:"error" throws) — POST still attempted');
      } else {
        fail('acquireCsrfHandshake must not swallow a redirect error into a full abort');
      }

      // Non-2xx from GET /jobs (e.g. 403, 500) must degrade to null/null and
      // still attempt the POST. The real ctx.fetchResponse throws on a non-2xx
      // (the catch branch above); this covers a ctx that hands the response
      // back instead, which the `!res.ok` guard has to refuse.
      //
      // The stub returns deceptive cookies and a csrfToken in the body. If the
      // `!res.ok` guard is removed, acquireCsrfHandshake would scrape them and
      // forward credentials to the POST — the "no cookie/no x-csrf-token"
      // assertion below would then fail, making this test mutation-resistant.
      // An empty stub would yield null/null either way and cannot distinguish
      // the guarded path.
      let notOkGetUrl = null;
      let notOkPostHeaders = null;
      let notOkPostCalled = false;
      await consider.fetch(okEntry, {
        fetchResponse: async (url) => {
          notOkGetUrl = url;
          return handshakeResponse(403,
            ['session=s_leaked; Path=/; HttpOnly', 'session.sig=sig_leaked; Path=/'],
            `<script>window.__cfg={"csrfToken":"leaked-token-403"}</script>`);
        },
        fetchJson: async (_url, opts) => {
          notOkPostCalled = true;
          notOkPostHeaders = opts.headers;
          return { jobs: [] };
        },
      });
      if (notOkGetUrl === 'https://jobs.founderful.com/jobs') {
        pass('acquireCsrfHandshake !res.ok: GET /jobs was attempted before the guard evaluated res.ok');
      } else {
        fail(`acquireCsrfHandshake !res.ok: expected GET https://jobs.founderful.com/jobs, got ${JSON.stringify(notOkGetUrl)}`);
      }
      if (notOkPostCalled) {
        pass('acquireCsrfHandshake !res.ok (403): POST still attempted (graceful degrade, not abort)');
      } else {
        fail('acquireCsrfHandshake !res.ok must not abort the POST');
      }
      if (!notOkPostHeaders?.cookie && !notOkPostHeaders?.['x-csrf-token']) {
        pass('acquireCsrfHandshake !res.ok: POST carries no cookie and no x-csrf-token (guard blocks scraping the 403 body)');
      } else {
        fail(`acquireCsrfHandshake !res.ok: guard missing — leaked cookie=${notOkPostHeaders?.cookie} csrf=${notOkPostHeaders?.['x-csrf-token']}`);
      }

      // A ctx with no fetchResponse (older embedder, minimal stub) has no
      // guarded way to read Set-Cookie. The handshake degrades to null/null and
      // the POST still goes out — it must not reach for bare fetch instead.
      let noHelperPostHeaders = null;
      await consider.fetch(okEntry, {
        fetchJson: async (_url, opts) => { noHelperPostHeaders = opts.headers; return { jobs: [] }; },
      });
      if (noHelperPostHeaders && !noHelperPostHeaders.cookie && !noHelperPostHeaders['x-csrf-token']) {
        pass('acquireCsrfHandshake degrades (POST without credentials) when ctx has no fetchResponse');
      } else {
        fail(`acquireCsrfHandshake without ctx.fetchResponse: POST headers = ${JSON.stringify(noHelperPostHeaders)}`);
      }

      if (bareFetchCalls.length === 0) {
        pass('acquireCsrfHandshake never calls bare fetch');
      } else {
        fail(`acquireCsrfHandshake called bare fetch for ${JSON.stringify(bareFetchCalls)} — that hop skips the provider DNS guard`);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  // ── The handshake runs under the provider DNS guard ────────────────────────
  // The point of routing through ctx: with the REAL transport context, the GET
  // /jobs must execute inside providerFetchContext, which is what makes the
  // patched dns.lookup validate the address the board host resolves to. The
  // network layer is the only thing stubbed here — _http.mjs calls the global
  // fetch from inside the context, so the stub can read the store.
  {
    const { makeHttpCtx } = await import(pathToFileURL(join(ROOT, 'providers/_http.mjs')).href);
    const { providerFetchContext } = await import(pathToFileURL(join(ROOT, 'providers/_ip-guard.mjs')).href);
    const realFetch = globalThis.fetch;
    const guardedHosts = {};
    globalThis.fetch = async (url) => {
      const path = new URL(String(url)).pathname;
      guardedHosts[path] = providerFetchContext.getStore()?.targetHost ?? null;
      if (path === '/jobs') {
        return new Response(`<script>window.__cfg={"csrfToken":"guarded-token-ok"}</script>`, {
          status: 200,
          headers: { 'content-type': 'text/html', 'set-cookie': 'session=g1; Path=/' },
        });
      }
      return new Response(JSON.stringify({ jobs: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      await consider.fetch(okEntry, makeHttpCtx());
    } finally {
      globalThis.fetch = realFetch;
    }
    if (guardedHosts['/jobs'] === 'jobs.founderful.com') {
      pass('consider handshake GET runs inside providerFetchContext (resolved address is validated)');
    } else {
      fail(`consider handshake GET ran outside the provider DNS guard (context host = ${JSON.stringify(guardedHosts['/jobs'])})`);
    }
    if (guardedHosts['/api-boards/search-jobs'] === 'jobs.founderful.com') {
      pass('consider POST runs inside providerFetchContext');
    } else {
      fail(`consider POST context host = ${JSON.stringify(guardedHosts['/api-boards/search-jobs'])}`);
    }
  }
} catch (e) {
  fail(`consider provider tests crashed: ${e.message}`);
}
