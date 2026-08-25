// tests/providers/csod.test.mjs — moved verbatim from test-all.mjs (#1549).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — csod (Cornerstone OnDemand career-site API)');
try {
  const csodModule = await import(pathToFileURL(join(ROOT, 'providers/csod.mjs')).href);
  const csod = csodModule.default;
  const { resolveConfig, extractToken, parseCsodDate, cleanLocations, parseRequisitions } = csodModule;

  if (csod.id === 'csod') pass('csod.id is "csod"');
  else fail(`csod.id is ${JSON.stringify(csod.id)}`);

  // resolveConfig — tenant/siteId/corpName out of the careersite URL.
  const cfg = resolveConfig({ api: 'https://career-ohb.csod.com/ux/ats/careersite/4/home?c=career-ohb' });
  if (
    cfg && cfg.siteId === 4 && cfg.corpName === 'career-ohb' &&
    cfg.searchApi === 'https://career-ohb.csod.com/services/x/career-site/v1/search' &&
    cfg.homeUrl === 'https://career-ohb.csod.com/ux/ats/careersite/4/home?c=career-ohb'
  ) {
    pass('csod.resolveConfig() parses origin, siteId, corpName, endpoints');
  } else {
    fail(`csod.resolveConfig() wrong: ${JSON.stringify(cfg)}`);
  }
  if (resolveConfig({ api: 'https://career-x.csod.com/other/path' }) === null) pass('csod.resolveConfig() rejects non-careersite paths');
  else fail('csod.resolveConfig() should reject non-careersite paths');
  // HTTPS-only: the bootstrap session cookies are replayed on the search
  // request, so an http: tenant would put them on the wire in clear.
  if (resolveConfig({ api: 'http://career-ohb.csod.com/ux/ats/careersite/4/home?c=career-ohb' }) === null) pass('csod.resolveConfig() rejects http:// (cookies must never go out in clear)');
  else fail('csod.resolveConfig() should reject http:// careersite URLs');

  // detect — host-anchored, path-shape required; spoofs return null.
  if (csod.detect({ careers_url: 'https://career-ohb.csod.com/ux/ats/careersite/4/home?c=career-ohb' })) pass('csod.detect() matches *.csod.com careersite URLs');
  else fail('csod.detect() should match a careersite URL');
  if (csod.detect({ careers_url: 'https://evil.com/x.csod.com/ux/ats/careersite/4/home' }) === null) pass('csod.detect() rejects path-spoofed host');
  else fail('csod.detect() should reject path-spoofed host');
  if (csod.detect({ careers_url: 'https://csod.com.evil.com/ux/ats/careersite/4/home' }) === null) pass('csod.detect() rejects suffix-spoofed host');
  else fail('csod.detect() should reject suffix-spoofed host');

  // extractToken — anonymous JWT embedded in the bootstrap home page.
  if (extractToken('x{"token":"eyJab.c-d_e"}y') === 'eyJab.c-d_e') pass('csod.extractToken() pulls the bearer token');
  else fail(`csod.extractToken() wrong: ${JSON.stringify(extractToken('x{"token":"eyJab.c-d_e"}y'))}`);
  if (extractToken('<html>no token</html>') === '' && extractToken(undefined) === '') pass('csod.extractToken() returns "" when absent');
  else fail('csod.extractToken() should return "" when absent');

  // parseCsodDate — US M/D/YYYY; junk → undefined.
  if (parseCsodDate('7/3/2026') === Date.UTC(2026, 6, 3)) pass('csod.parseCsodDate() reads M/D/YYYY');
  else fail(`csod.parseCsodDate() wrong: ${parseCsodDate('7/3/2026')}`);
  if (parseCsodDate('13/40/2026') === undefined && parseCsodDate('garbage') === undefined && parseCsodDate(null) === undefined) {
    pass('csod.parseCsodDate() rejects junk and out-of-range dates');
  } else {
    fail('csod.parseCsodDate() should reject junk / out-of-range input');
  }

  // cleanLocations — city+country per location, " / " join, dedup, tolerant.
  if (cleanLocations([{ city: 'Bremen', state: 'Bremen', country: 'DE' }]) === 'Bremen, DE') pass('csod.cleanLocations() renders "City, CC"');
  else fail(`csod.cleanLocations() wrong: ${JSON.stringify(cleanLocations([{ city: 'Bremen', country: 'DE' }]))}`);
  if (cleanLocations([{ city: 'A', country: 'DE' }, { city: 'B', country: 'AT' }]) === 'A, DE / B, AT') pass('csod.cleanLocations() joins multiple locations');
  else fail('csod.cleanLocations() should join multiple locations with " / "');
  if (cleanLocations(undefined) === '' && cleanLocations([null]) === '') pass('csod.cleanLocations() tolerates missing/null input');
  else fail('csod.cleanLocations() should return "" for missing input');

  // parseRequisitions — id/title required; detail URL from origin+siteId+corp.
  const reqJson = {
    data: {
      totalCount: 3,
      requisitions: [
        { requisitionId: 8410, postingEffectiveDate: '7/3/2026', displayJobTitle: 'IT Specialist (m/w/d)', locations: [{ city: 'Bremen', country: 'DE' }] },
        { requisitionId: null, displayJobTitle: 'No id — dropped' },
        { requisitionId: 99, displayJobTitle: '' },
      ],
    },
  };
  const reqs = parseRequisitions(reqJson, { origin: 'https://career-ohb.csod.com', siteId: 4, corpName: 'career-ohb' });
  if (reqs.length === 1) pass('csod.parseRequisitions() drops records missing id or title');
  else fail(`csod.parseRequisitions() returned ${reqs.length}, expected 1`);
  if (reqs[0]?.url === 'https://career-ohb.csod.com/ux/ats/careersite/4/home/requisition/8410?c=career-ohb') pass('csod.parseRequisitions() builds the requisition detail URL');
  else fail(`csod.parseRequisitions() url wrong: ${JSON.stringify(reqs[0]?.url)}`);
  if (reqs[0]?.postedAt === Date.UTC(2026, 6, 3) && reqs[0]?.location === 'Bremen, DE') pass('csod.parseRequisitions() maps postedAt and location');
  else fail(`csod.parseRequisitions() fields wrong: ${JSON.stringify(reqs[0])}`);

  // fetch — token from page 1, then paginates the search API; totalCount stops
  // the loop; dedup across pages. Pages are full-size (25) like the live API —
  // a short page legitimately means "last page" to the provider.
  const mkReq = (id, title) => ({ requisitionId: id, displayJobTitle: title, postingEffectiveDate: '7/3/2026', locations: [] });
  const fullPage = Array.from({ length: 25 }, (_, i) => mkReq(i + 1, `Job ${i + 1}`));
  const searchPages = [
    { data: { totalCount: 27, requisitions: fullPage } },
    { data: { totalCount: 27, requisitions: [mkReq(25, 'Job 25 dup'), mkReq(26, 'Job 26'), mkReq(27, 'Job 27')] } },
  ];
  let searchCalls = 0;
  let sawAuth = '';
  const mockCtx = {
    sleep: async () => {},
    fetchText: async () => '{"token":"tok.abc"}',
    fetchJson: async (url, opts) => {
      sawAuth = opts?.headers?.authorization || '';
      const body = JSON.parse(opts.body);
      if (body.pageSize !== 25 || body.pageNumber !== searchCalls + 1) throw new Error('unexpected paging body');
      return searchPages[searchCalls++] ?? { data: { totalCount: 27, requisitions: [] } };
    },
  };
  const fetched = await csod.fetch({ name: 'OHB', api: 'https://career-ohb.csod.com/ux/ats/careersite/4/home?c=career-ohb' }, mockCtx);
  if (fetched.length === 27 && new Set(fetched.map((j) => j.url)).size === 27 && searchCalls === 2) pass('csod.fetch() paginates via totalCount and dedups across pages');
  else fail(`csod.fetch() returned ${fetched.length} jobs after ${searchCalls} calls`);
  if (sawAuth === 'Bearer tok.abc') pass('csod.fetch() sends the extracted anonymous bearer token');
  else fail(`csod.fetch() auth header wrong: ${JSON.stringify(sawAuth)}`);

  // Token missing → hard error (never a silent empty scan).
  let tokenErr = '';
  await csod.fetch({ name: 'X', api: 'https://x.csod.com/ux/ats/careersite/1/home?c=x' }, { ...mockCtx, fetchText: async () => '<html/>' }).catch((e) => { tokenErr = e.message; });
  if (/no anonymous token/.test(tokenErr)) pass('csod.fetch() throws when the home page carries no token');
  else fail(`csod.fetch() should throw on missing token, got: ${JSON.stringify(tokenErr)}`);

  // ── Session cookie priming ────────────────────────────────────────────────
  // Some tenants (verified live on careers-kln.csod.com) reject the search API
  // with "HTTP 401 CSOD Unauthorized" unless the request carries the session
  // cookies the bootstrap home page set — the anonymous bearer token alone is
  // not enough. The provider must therefore read Set-Cookie off the bootstrap
  // RESPONSE and replay it on every search call.
  const mkCookieCtx = (setCookies) => {
    const calls = { search: 0, cookieHeaders: [], homeUrls: [], bootstrapOpts: [] };
    return {
      calls,
      sleep: async () => {},
      fetchText: async () => { throw new Error('fetchText must not be used when fetchResponse exists'); },
      fetchResponse: async (url, opts) => {
        calls.homeUrls.push(url);
        calls.bootstrapOpts.push(opts);
        const headers = new Headers();
        for (const c of setCookies) headers.append('set-cookie', c);
        return new Response('{"token":"tok.abc"}', { status: 200, headers });
      },
      fetchJson: async (_url, opts) => {
        // Record the raw value — an absent header must stay `undefined` here,
        // so don't normalise it to null or the omission assertion can't tell
        // "no header" from "header set to null".
        calls.cookieHeaders.push(opts?.headers?.cookie);
        calls.search++;
        return { data: { totalCount: 1, requisitions: [mkReq(1, 'Job 1')] } };
      },
    };
  };

  const cookieCtx = mkCookieCtx(['ASP.NET_SessionId=abc123; path=/; HttpOnly', 'csod_tenant=kln; Secure; SameSite=None']);
  const cookieJobs = await csod.fetch({ name: 'KLN', api: 'https://careers-kln.csod.com/ux/ats/careersite/14/home?c=careers-kln' }, cookieCtx);
  if (cookieJobs.length === 1) pass('csod.fetch() still returns jobs when priming cookies');
  else fail(`csod.fetch() cookie path returned ${cookieJobs.length} jobs`);
  const sentCookie = cookieCtx.calls.cookieHeaders[0];
  if (sentCookie === 'ASP.NET_SessionId=abc123; csod_tenant=kln') pass('csod.fetch() replays bootstrap Set-Cookie as a cookie header (attributes stripped)');
  else fail(`csod.fetch() cookie header wrong: ${JSON.stringify(sentCookie)}`);

  // Origin validation only covers the URL we ask for. Without redirect:'error'
  // the bootstrap would follow a 3xx off the validated csod.com host — and the
  // cookies it collected there would then be replayed by the search call.
  if (cookieCtx.calls.bootstrapOpts[0]?.redirect === 'error') pass('csod.fetch() refuses redirects on the bootstrap request');
  else fail(`csod.fetch() bootstrap must pass redirect:'error', got ${JSON.stringify(cookieCtx.calls.bootstrapOpts[0]?.redirect)}`);

  // No Set-Cookie → no cookie header at all (never send an empty one).
  const bareCtx = mkCookieCtx([]);
  await csod.fetch({ name: 'X', api: 'https://x.csod.com/ux/ats/careersite/1/home?c=x' }, bareCtx);
  if (bareCtx.calls.cookieHeaders[0] === undefined) pass('csod.fetch() omits the cookie header when the tenant sets none');
  else fail(`csod.fetch() should omit cookie header, got ${JSON.stringify(bareCtx.calls.cookieHeaders[0])}`);

  // Backward compatibility: a ctx without fetchResponse (older callers, test
  // mocks) must keep working via fetchText rather than crashing.
  const legacyCtx = {
    sleep: async () => {},
    fetchText: async (_url, opts) => {
      if (opts?.redirect !== 'error') throw new Error(`legacy bootstrap must pass redirect:'error', got ${JSON.stringify(opts?.redirect)}`);
      return '{"token":"tok.legacy"}';
    },
    fetchJson: async (_url, opts) => {
      if (opts?.headers?.cookie !== undefined) throw new Error('legacy path must not send a cookie header');
      return { data: { totalCount: 1, requisitions: [mkReq(1, 'Job 1')] } };
    },
  };
  const legacyJobs = await csod.fetch({ name: 'L', api: 'https://l.csod.com/ux/ats/careersite/2/home?c=l' }, legacyCtx);
  if (legacyJobs.length === 1) pass('csod.fetch() falls back to fetchText when ctx has no fetchResponse');
  else fail(`csod.fetch() legacy path returned ${legacyJobs.length} jobs`);
} catch (e) {
  fail(`csod provider tests crashed: ${e.message}`);
}
