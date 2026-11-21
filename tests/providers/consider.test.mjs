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

  const okEntry = { name: 'Acme Ventures', consider_board: 'acme-portfolio', careers_url: 'https://jobs.acmevc.example/jobs' };
  const hit = consider.detect(okEntry);
  if (hit && hit.url === 'https://jobs.acmevc.example/api-boards/search-jobs') pass('consider.detect() claims a valid https board');
  else fail(`consider.detect() returned ${JSON.stringify(hit)}`);

  if (consider.detect({ name: 'X', careers_url: 'https://jobs.acmevc.example/jobs' }) === null) {
    pass('consider.detect() returns null without consider_board');
  } else {
    fail('consider.detect() must require consider_board');
  }

  // SSRF: non-https + IP-literal + loopback/internal hosts are all rejected.
  const considerEvil = [
    ['http://jobs.acmevc.example/jobs', 'non-https'],
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
      return { jobs: [{ title: 'AI Eng', url: 'https://jobs.acmevc.example/x', companyName: 'Acme', locations: ['Remote'], timeStamp: '2026-01-02' }] };
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
    fetchJson: async () => ({ jobs: [{ title: 'T', url: 'https://jobs.acmevc.example/y', companyName: 'Acme', timeStamp: 0 }] }),
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
  if (handshakeOrigin === 'https://jobs.acmevc.example') pass('consider.fetch() passes board origin to the handshake');
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

  // ── Board id: consider_board, else the board page ──────────────────────────
  const autoEntry = { name: 'Acme Ventures', careers_url: 'https://jobs.acmevc.example/jobs' };
  const postedBoard = async (entry, handshake) => {
    let board = null;
    await consider.fetch(entry, {
      _acquireHandshake: async () => handshake,
      fetchJson: async (_url, opts) => { board = JSON.parse(opts.body).board; return { jobs: [] }; },
    });
    return board;
  };

  {
    const board = await postedBoard(autoEntry, { cookie: null, csrfToken: null, board: { id: 'acme-portfolio', isParent: false } });
    if (board?.id === 'acme-portfolio' && board.isParent === false) pass('consider.fetch() posts the board the page names, isParent included, without consider_board');
    else fail(`consider.fetch() page board = ${JSON.stringify(board)}`);
  }

  {
    let posted = false;
    let error = null;
    try {
      await consider.fetch(autoEntry, {
        _acquireHandshake: noHandshake,
        fetchJson: async () => { posted = true; return { jobs: [] }; },
      });
    } catch (err) {
      error = err;
    }
    if (error && /consider_board/.test(error.message) && !posted) pass('consider.fetch() throws before the POST, naming consider_board, when the page names no board');
    else fail(`consider.fetch() with no board id: error=${error?.message}, posted=${posted}`);
  }

  {
    const board = await postedBoard({ ...autoEntry, consider_board: 'manual-board' }, { cookie: null, csrfToken: null, board: { id: 'acme-portfolio', isParent: false } });
    if (board?.id === 'manual-board' && board.isParent === true) pass('consider.fetch() lets consider_board win over the page board');
    else fail(`consider.fetch() override = ${JSON.stringify(board)}`);
  }

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
            `<script>\n  window.serverInitialData = {"csrfToken":"handshake-token-ok"};\n</script>`);
        },
        fetchJson: async (_url, opts) => {
          realHandshakePostHeaders = opts.headers;
          return { jobs: [] };
        },
      });

      if (handshakeUrl === 'https://jobs.acmevc.example/jobs') {
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

      // The board object as a live board page embeds it, next to the token.
      let pageBoardPosted = null;
      await consider.fetch({ name: 'Acme Ventures', careers_url: 'https://jobs.acmevc.example/jobs' }, {
        fetchResponse: async () => handshakeResponse(200, [],
          `<script>\n  window.shouldHydrate = true;\n  window.serverInitialData = {"fixedBoard":"acme-portfolio","csrfToken":"handshake-token-ok","board":{"id":"acme-portfolio","isParent":true},"clientConfig":{"id":"acme-portfolio"}};\n</script>`),
        fetchJson: async (_url, opts) => { pageBoardPosted = JSON.parse(opts.body).board; return { jobs: [] }; },
      });
      if (pageBoardPosted?.id === 'acme-portfolio' && pageBoardPosted.isParent === true) {
        pass('acquireCsrfHandshake reads the board object from window.serverInitialData');
      } else {
        fail(`acquireCsrfHandshake board = ${JSON.stringify(pageBoardPosted)}`);
      }

      // The same state with the closing tag on its line, as a minified page has it.
      let sameLineBoard = null;
      await consider.fetch({ name: 'Acme Ventures', careers_url: 'https://jobs.acmevc.example/jobs' }, {
        fetchResponse: async () => handshakeResponse(200, [],
          `<script>window.serverInitialData = {"csrfToken":"handshake-token-ok","board":{"id":"acme-portfolio","isParent":true}};</script><script>window.other = {"board":{"id":"other"}};</script>`),
        fetchJson: async (_url, opts) => { sameLineBoard = JSON.parse(opts.body).board; return { jobs: [] }; },
      });
      if (sameLineBoard?.id === 'acme-portfolio') pass('acquireCsrfHandshake reads window.serverInitialData followed by </script> on the same line');
      else fail(`acquireCsrfHandshake same-line board = ${JSON.stringify(sameLineBoard)}`);

      // "csrfToken" and "board" keys in any other script are not picked up:
      // only the top level of window.serverInitialData counts.
      let strayPosted = false;
      let strayError = null;
      try {
        await consider.fetch({ name: 'Acme Ventures', careers_url: 'https://jobs.acmevc.example/jobs' }, {
          fetchResponse: async () => handshakeResponse(200, [],
            `<script>window.widgetConfig = {"csrfToken":"stray-token-123","board":{"id":"stray-board","isParent":true}};</script>\n` +
            `<script>\n  window.serverInitialData = {"clientConfig":{"board":{"id":"nested-board"},"csrfToken":"nested-token-456"}};\n</script>`),
          fetchJson: async () => { strayPosted = true; return { jobs: [] }; },
        });
      } catch (err) {
        strayError = err;
      }
      if (strayError && /consider_board/.test(strayError.message) && !strayPosted) {
        pass('acquireCsrfHandshake ignores csrfToken / board keys outside the top level of window.serverInitialData');
      } else {
        fail(`acquireCsrfHandshake picked up a stray key: error=${strayError?.message}, posted=${strayPosted}`);
      }

      // The stray token is not sent either, for an entry that sets its board.
      let strayTokenHeaders = null;
      await consider.fetch(okEntry, {
        fetchResponse: async () => handshakeResponse(200, [],
          `<script>window.widgetConfig = {"csrfToken":"stray-token-123"};</script>`),
        fetchJson: async (_url, opts) => { strayTokenHeaders = opts.headers; return { jobs: [] }; },
      });
      if (strayTokenHeaders && !strayTokenHeaders['x-csrf-token']) pass('acquireCsrfHandshake sends no token found outside window.serverInitialData');
      else fail(`acquireCsrfHandshake sent a stray token: ${strayTokenHeaders?.['x-csrf-token']}`);

      // A redirect on GET /jobs (e.g. redirect to a private IP) must cause the
      // handshake to degrade gracefully — the POST is still attempted.
      let redirectDegradedPostCalled = false;
      await consider.fetch(okEntry, {
        sleep: async () => {},
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
            `<script>\n  window.serverInitialData = {"csrfToken":"leaked-token-403"};\n</script>`);
        },
        fetchJson: async (_url, opts) => {
          notOkPostCalled = true;
          notOkPostHeaders = opts.headers;
          return { jobs: [] };
        },
      });
      if (notOkGetUrl === 'https://jobs.acmevc.example/jobs') {
        pass('acquireCsrfHandshake !res.ok: GET /jobs was attempted before the guard evaluated res.ok');
      } else {
        fail(`acquireCsrfHandshake !res.ok: expected GET https://jobs.acmevc.example/jobs, got ${JSON.stringify(notOkGetUrl)}`);
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
        return new Response(`<script>\n  window.serverInitialData = {"csrfToken":"guarded-token-ok"};\n</script>`, {
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
    if (guardedHosts['/jobs'] === 'jobs.acmevc.example') {
      pass('consider handshake GET runs inside providerFetchContext (resolved address is validated)');
    } else {
      fail(`consider handshake GET ran outside the provider DNS guard (context host = ${JSON.stringify(guardedHosts['/jobs'])})`);
    }
    if (guardedHosts['/api-boards/search-jobs'] === 'jobs.acmevc.example') {
      pass('consider POST runs inside providerFetchContext');
    } else {
      fail(`consider POST context host = ${JSON.stringify(guardedHosts['/api-boards/search-jobs'])}`);
    }
  }

  // ── Retry ──────────────────────────────────────────────────────────────────
  const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });
  const oneJob = { jobs: [{ title: 'T', url: 'https://jobs.acmevc.example/r', companyName: 'Acme' }] };

  let postAttempts = 0;
  const retriedPost = await consider.fetch(okEntry, {
    _acquireHandshake: noHandshake,
    sleep: async () => {},
    fetchJson: async () => {
      postAttempts++;
      if (postAttempts === 1) throw httpError(500);
      return oneJob;
    },
  });
  if (postAttempts === 2 && retriedPost.length === 1) pass('consider.fetch() retries a POST that answers 500 and keeps the board');
  else fail(`consider.fetch() POST retry: ${postAttempts} attempts, ${retriedPost.length} jobs`);

  let refusedAttempts = 0;
  let refusedStatus = null;
  try {
    await consider.fetch(okEntry, {
      _acquireHandshake: noHandshake,
      sleep: async () => {},
      fetchJson: async () => { refusedAttempts++; throw httpError(412); },
    });
  } catch (e) { refusedStatus = e.status; }
  if (refusedAttempts === 1 && refusedStatus === 412) pass('consider.fetch() does not retry a 412 and still throws it');
  else fail(`consider.fetch() 412: ${refusedAttempts} attempts, status ${refusedStatus}`);

  let handshakeAttempts = 0;
  let retriedHandshakeHeaders = null;
  await consider.fetch(okEntry, {
    sleep: async () => {},
    fetchResponse: async () => {
      handshakeAttempts++;
      if (handshakeAttempts === 1) throw httpError(503);
      return new Response('<script>\n  window.serverInitialData = {"csrfToken":"token-after-retry"};\n</script>', { status: 200 });
    },
    fetchJson: async (_url, opts) => { retriedHandshakeHeaders = opts.headers; return { jobs: [] }; },
  });
  if (handshakeAttempts === 2 && retriedHandshakeHeaders?.['x-csrf-token'] === 'token-after-retry') {
    pass('consider.fetch() retries the board page GET and uses its token');
  } else {
    fail(`consider.fetch() handshake retry: ${handshakeAttempts} attempts, headers ${JSON.stringify(retriedHandshakeHeaders)}`);
  }

  let probeGets = 0;
  let probePosts = 0;
  let probeThrew = false;
  try {
    await consider.fetch(okEntry, {
      maxPages: 1,
      sleep: async () => {},
      fetchResponse: async () => { probeGets++; throw httpError(503); },
      fetchJson: async () => { probePosts++; throw httpError(500); },
    });
  } catch { probeThrew = true; }
  if (probeGets === 1 && probePosts === 1 && probeThrew) pass('consider.fetch() does not retry under a ctx.maxPages probe');
  else fail(`consider.fetch() probe: ${probeGets} GETs, ${probePosts} POSTs, threw ${probeThrew}`);

  // ── consider_size ──────────────────────────────────────────────────────────
  // Runs one fetch with `rows` rows and the board's `total`, and returns the size
  // the POST asked for and the warnings printed.
  const sizeRun = async (consider_size, { rows, total, maxPages } = {}) => {
    const warnings = [];
    const realConsoleError = console.error;
    console.error = (...args) => { warnings.push(args.join(' ')); };
    let requested = null;
    try {
      await consider.fetch({ ...okEntry, ...(consider_size ? { consider_size } : {}) }, {
        _acquireHandshake: noHandshake,
        ...(maxPages ? { maxPages } : {}),
        fetchJson: async (_url, opts) => {
          requested = JSON.parse(opts.body).meta.size;
          const jobs = Array.from({ length: rows }, (_, i) => ({ title: `T${i}`, url: `https://jobs.acmevc.example/j${i}`, companyName: 'Acme' }));
          return { jobs, ...(total === undefined ? {} : { total }) };
        },
      });
    } finally {
      console.error = realConsoleError;
    }
    return { requested, warnings };
  };

  const clamped = await sizeRun(5000, { rows: 1, total: 1 });
  const atMaximum = await sizeRun(1000, { rows: 1, total: 1 });
  const byDefault = await sizeRun(undefined, { rows: 1, total: 1 });
  if (clamped.requested === 1000 && atMaximum.requested === 1000 && byDefault.requested === 500) {
    pass('consider.fetch() clamps consider_size to 1000 and defaults to 500');
  } else {
    fail(`consider.fetch() size: clamped ${clamped.requested}, at maximum ${atMaximum.requested}, default ${byDefault.requested}`);
  }

  // ── Pagination ─────────────────────────────────────────────────────────────
  // Walks a board of `pages` full pages of two rows, each answering the cursor
  // `s{page}`. `shape(page)` overrides a page's response; a thrown value fails it.
  const walkRun = async (entryExtra, { pages = 3, total = 6, maxPages, shape } = {}) => {
    const warnings = [];
    const realConsoleError = console.error;
    console.error = (...args) => { warnings.push(args.join(' ')); };
    const metas = [];
    const delays = [];
    let jobs = null;
    let thrown = null;
    try {
      jobs = await consider.fetch({ ...okEntry, consider_size: 2, ...entryExtra }, {
        _acquireHandshake: noHandshake,
        ...(maxPages ? { maxPages } : {}),
        sleep: async (ms) => { delays.push(ms); },
        fetchJson: async (_url, opts) => {
          const { meta } = JSON.parse(opts.body);
          const page = meta.sequence ? Number(meta.sequence.slice(1)) : 0;
          metas.push(meta);
          const row = (i) => ({ title: `T${page}-${i}`, url: `https://jobs.acmevc.example/j${page}-${i}`, companyName: 'Acme' });
          const response = { jobs: [row(0), row(1)], total, meta: page + 1 < pages ? { sequence: `s${page + 1}` } : {} };
          return shape ? shape(page, response, row) : response;
        },
      });
    } catch (e) {
      thrown = e;
    } finally {
      console.error = realConsoleError;
    }
    return { jobs, thrown, metas, delays, warnings };
  };

  const fullWalk = await walkRun({});
  if (fullWalk.jobs?.length === 6 && fullWalk.warnings.length === 0
      && JSON.stringify(fullWalk.metas) === JSON.stringify([{ size: 2 }, { size: 2, sequence: 's1' }, { size: 2, sequence: 's2' }])) {
    pass('consider.fetch() follows meta.sequence to the end of the board without a warning');
  } else {
    fail(`consider.fetch() walk: ${JSON.stringify({ rows: fullWalk.jobs?.length, metas: fullWalk.metas, warnings: fullWalk.warnings })}`);
  }
  if (JSON.stringify(fullWalk.delays) === JSON.stringify([250, 250])) pass('consider.fetch() waits 250 ms between pages and not before the first one');
  else fail(`consider.fetch() page delays: ${JSON.stringify(fullWalk.delays)}`);

  const shortPage = await walkRun({}, { shape: (page, response, row) => ({ ...response, jobs: [row(0)], meta: { sequence: `s${page + 1}` } }) });
  if (shortPage.metas.length === 1 && shortPage.warnings.length === 0) pass('consider.fetch() stops at a short page even when it carries a cursor');
  else fail(`consider.fetch() short page: ${shortPage.metas.length} requests, ${JSON.stringify(shortPage.warnings)}`);

  const stuckCursor = await walkRun({}, { shape: (_page, response) => ({ ...response, meta: { sequence: 's1' } }) });
  if (stuckCursor.metas.length === 2 && stuckCursor.warnings.length === 0) pass('consider.fetch() stops when the cursor does not move');
  else fail(`consider.fetch() stuck cursor: ${stuckCursor.metas.length} requests, ${JSON.stringify(stuckCursor.warnings)}`);

  const capped = await walkRun({ max_pages: 2 }, { pages: 5, total: 10 });
  if (capped.metas.length === 2 && capped.jobs?.length === 4 && capped.warnings.length === 1
      && capped.warnings[0].includes('Acme Ventures truncated at max_pages=2 (4 of 10 jobs) — raise max_pages on this entry for more')) {
    pass('consider.fetch() warns when max_pages ends the walk with a cursor left');
  } else {
    fail(`consider.fetch() max_pages: ${JSON.stringify({ requests: capped.metas.length, warnings: capped.warnings })}`);
  }

  const endsAtCap = await walkRun({ max_pages: 2 }, { pages: 2, total: 4 });
  if (endsAtCap.metas.length === 2 && endsAtCap.warnings.length === 0) pass('consider.fetch() does not warn when the board ends exactly at max_pages');
  else fail(`consider.fetch() board ending at max_pages: ${JSON.stringify(endsAtCap.warnings)}`);

  const hardCap = await walkRun({ max_pages: 5000 }, { pages: 200, total: 400 });
  if (hardCap.metas.length === 100 && hardCap.warnings.length === 1
      && hardCap.warnings[0].includes('truncated at max_pages=100 (200 of 400 jobs) — the 100-page hard cap')
      && !hardCap.warnings[0].includes('raise max_pages')) {
    pass('consider.fetch() clamps max_pages to the hard cap and does not advise raising it there');
  } else {
    fail(`consider.fetch() hard cap: ${JSON.stringify({ requests: hardCap.metas.length, warnings: hardCap.warnings })}`);
  }

  const failing = (rejection) => (page, response) => { if (page === 1) throw rejection; return response; };
  const laterFailure = await walkRun({}, { shape: failing(httpError(429)) });
  if (laterFailure.jobs?.length === 2 && laterFailure.metas.length === 4 && laterFailure.warnings.length === 1
      && laterFailure.warnings[0].includes('Acme Ventures truncated at page 2 of 10 after 3 attempts (2 jobs): HTTP 429')) {
    pass('consider.fetch() keeps the rows read and warns when a later page fails after its retries');
  } else {
    fail(`consider.fetch() later page failure: ${JSON.stringify({ rows: laterFailure.jobs?.length, requests: laterFailure.metas.length, warnings: laterFailure.warnings })}`);
  }

  const notObject = await walkRun({}, { shape: failing('plain string rejection') });
  if (notObject.warnings[0]?.includes('truncated at page 2 of 10 after an unknown number of attempts (2 jobs): plain string rejection')) {
    pass('consider.fetch() says the attempts are unknown when a later page rejects with a non-object');
  } else {
    fail(`consider.fetch() non-object rejection: ${JSON.stringify(notObject.warnings)}`);
  }

  const probeWalk = await walkRun({}, { maxPages: 1 });
  if (probeWalk.metas.length === 1 && probeWalk.warnings.length === 0) pass('consider.fetch() sends one list request under a ctx.maxPages probe, without a warning');
  else fail(`consider.fetch() probe walk: ${probeWalk.metas.length} requests, ${JSON.stringify(probeWalk.warnings)}`);

  const probeLaterFailure = await walkRun({}, { maxPages: 2, shape: failing(httpError(500)) });
  if (probeLaterFailure.thrown?.status === 500 && probeLaterFailure.metas.length === 2) pass('consider.fetch() passes a later page rejection to a probe unchanged');
  else fail(`consider.fetch() probe later failure: ${JSON.stringify({ thrown: probeLaterFailure.thrown?.message, requests: probeLaterFailure.metas.length })}`);
} catch (e) {
  fail(`consider provider tests crashed: ${e.message}`);
}
