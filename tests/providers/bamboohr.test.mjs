// tests/providers/bamboohr.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — bamboohr');

try {
  const bamboohrModule = await import(pathToFileURL(join(ROOT, 'providers/bamboohr.mjs')).href);
  const bamboohr = bamboohrModule.default;
  const { parseBambooHRResponse } = bamboohrModule;

  if (bamboohr.id === 'bamboohr') pass('bamboohr.id is "bamboohr"');
  else fail(`bamboohr.id is ${JSON.stringify(bamboohr.id)}`);

  // detect: <tenant>.bamboohr.com → /careers/list
  const hit = bamboohr.detect({ name: 'Acme', careers_url: 'https://acme.bamboohr.com/careers' });
  if (hit && hit.url === 'https://acme.bamboohr.com/careers/list') {
    pass('bamboohr.detect() resolves <tenant>.bamboohr.com → /careers/list');
  } else {
    fail(`bamboohr.detect() returned ${JSON.stringify(hit)}`);
  }

  // detect: honours an explicit api: URL
  const apiHit = bamboohr.detect({ name: 'Acme', api: 'https://acme.bamboohr.com' });
  if (apiHit && apiHit.url === 'https://acme.bamboohr.com/careers/list') pass('bamboohr.detect() honours explicit api: URL');
  else fail(`bamboohr.detect() api: returned ${JSON.stringify(apiHit)}`);

  // detect: null for non-bamboohr URLs
  if (bamboohr.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('bamboohr.detect() returns null for non-bamboohr URLs');
  } else {
    fail('bamboohr.detect() should return null for non-bamboohr URLs');
  }

  // detect: null for non-string careers_url
  if (bamboohr.detect({ name: 'X', careers_url: null }) === null && bamboohr.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('bamboohr.detect() returns null for non-string careers_url (null and 7)');
  } else {
    fail('bamboohr.detect() should treat non-string careers_url as missing');
  }

  // SSRF: bamboohr.com in the PATH (not host) must not be detected.
  if (bamboohr.detect({ name: 'Spoof', careers_url: 'https://evil.example/acme.bamboohr.com/foo' }) === null) {
    pass('bamboohr.detect() rejects path-spoofed URLs');
  } else {
    fail('bamboohr.detect() must reject path-spoofed URLs');
  }

  // parseBambooHRResponse — real BambooHR list shape
  const sample = {
    meta: {},
    result: [
      { id: '15', jobOpeningName: 'IT Security Engineer', location: { city: 'Mayfair', state: 'London, City of' }, isRemote: null },
      { id: 22, jobOpeningName: 'Android Engineer', location: { city: 'Bengaluru', state: 'Karnataka' }, isRemote: 1 },
      { id: '7', jobOpeningName: '', location: { city: 'X' } },          // no title → dropped
      { jobOpeningName: 'No ID Role', location: { city: 'Y' } },          // no id → dropped
      { id: '   ', jobOpeningName: 'Blank ID Role', location: { city: 'Z' } }, // blank/whitespace id → dropped
    ],
  };
  const jobs = parseBambooHRResponse(sample, 'Acme', 'https://acme.bamboohr.com');
  if (jobs.length === 2) pass('parseBambooHRResponse keeps rows with non-empty id + title, drops the rest');
  else fail(`parseBambooHRResponse returned ${jobs.length} jobs (expected 2)`);

  if (!jobs.some(j => j.title === 'Blank ID Role')) pass('parseBambooHRResponse drops blank/whitespace-id rows (no /careers/ URL)');
  else fail('parseBambooHRResponse should drop blank/whitespace-id rows');

  if (jobs[0]?.url === 'https://acme.bamboohr.com/careers/15' && jobs[0]?.company === 'Acme') {
    pass('parseBambooHRResponse builds <origin>/careers/<id> URL');
  } else {
    fail(`parseBambooHRResponse url was ${jobs[0]?.url}`);
  }

  if (jobs[0]?.location === 'Mayfair, London, City of') pass('parseBambooHRResponse joins city + state');
  else fail(`parseBambooHRResponse location[0] was ${JSON.stringify(jobs[0]?.location)}`);

  if (jobs[1]?.location === 'Bengaluru, Karnataka, Remote') pass('parseBambooHRResponse appends Remote when isRemote is set');
  else fail(`parseBambooHRResponse location[1] was ${JSON.stringify(jobs[1]?.location)}`);

  if (jobs[1]?.url === 'https://acme.bamboohr.com/careers/22') pass('parseBambooHRResponse coerces numeric id to URL');
  else fail(`parseBambooHRResponse numeric-id url was ${jobs[1]?.url}`);

  // empty / malformed payloads → []
  if (parseBambooHRResponse({}, 'X', 'https://x.bamboohr.com').length === 0) pass('parseBambooHRResponse empty {} → []');
  else fail('parseBambooHRResponse should return [] for {}');
  if (parseBambooHRResponse({ result: null }, 'X', 'https://x.bamboohr.com').length === 0) pass('parseBambooHRResponse result:null → []');
  else fail('parseBambooHRResponse should return [] for result:null');

  // fetch() — via mock ctx, asserts the resolved URL + SSRF redirect pinning + parsing
  let fetchedUrl = '';
  let fetchedOpts;
  const mockCtx = {
    fetchJson: async (url, opts) => { fetchedUrl = url; fetchedOpts = opts; return sample; },
  };
  const fetched = await bamboohr.fetch({ name: 'Acme', careers_url: 'https://acme.bamboohr.com/careers' }, mockCtx);
  if (fetchedUrl === 'https://acme.bamboohr.com/careers/list' && fetchedOpts?.redirect === 'manual' && fetched.length === 2) {
    pass('bamboohr.fetch() calls /careers/list with redirect:manual and returns parsed jobs');
  } else {
    fail(`bamboohr.fetch() url=${fetchedUrl} redirect=${JSON.stringify(fetchedOpts)} jobs=${fetched.length}`);
  }

  // SSRF guard — an untrusted host must never reach ctx.fetchJson at all.
  // A stub that only throws would pass whether the guard fired or a fetch
  // was wrongly attempted, so assert the call count directly.
  {
    let calls = 0;
    const untrustedCtx = { fetchJson: async () => { calls++; throw new Error('should never be called'); } };
    try {
      await bamboohr.fetch({ name: 'Evil', careers_url: 'https://evil.example/acme.bamboohr.com/foo' }, untrustedCtx);
      fail('bamboohr.fetch() should throw for an untrusted host');
    } catch {
      if (calls === 0) pass('bamboohr.fetch() rejects an untrusted host before any fetchJson call');
      else fail(`bamboohr.fetch() should not call fetchJson for an untrusted host (called ${calls} time(s))`);
    }
  }

  // fetch() — a redirect away from /careers/list is not by itself proof the
  // board is dead. The marketing-site bounce is the one exception (skipped
  // straight to dead, tested separately below); any other redirect probes
  // the embed-widget feed (/jobs/embed2.php) to tell a live-but-empty board
  // from the account-suspension signature, whose job pages answer with a
  // login wall regardless of how many positions the feed reports (verified
  // live 2026-09-21 against three such tenants) — so a populated feed there
  // is treated the same as no answer at all: dead.
  {
    const redirectErr = new Error('HTTP 302');
    redirectErr.status = 302;
    redirectErr.location = '/settings/account/temporarily_suspended';

    // Fallback answers with zero positions — a live, currently-empty board;
    // fetch() must succeed with [], not throw. Also asserts the probe uses
    // redirect:'error' (it never reads .location, so 'manual' is not
    // warranted for this request).
    let embed2Opts;
    const emptyLiveCtx = {
      fetchJson: async (url, opts) => {
        if (url.includes('/careers/list')) throw redirectErr;
        embed2Opts = opts;
        return { success: true, departments: [] };
      },
    };
    const emptyLive = await bamboohr.fetch({ name: 'Empty', careers_url: 'https://empty.bamboohr.com/careers' }, emptyLiveCtx);
    if (Array.isArray(emptyLive) && emptyLive.length === 0 && embed2Opts?.redirect === 'error') {
      pass('bamboohr.fetch() returns [] (not an error) when the embed-widget probe confirms a live, empty board, using redirect:error');
    } else {
      fail(`bamboohr.fetch() live-empty case: jobs=${JSON.stringify(emptyLive)}, probe redirect=${JSON.stringify(embed2Opts)}`);
    }

    // Fallback answers with real positions — the suspended-account
    // signature, whose job pages are confirmed unusable regardless of count.
    // Still mapped to dead, not returned as matches.
    const populatedCtx = {
      fetchJson: async (url) => {
        if (url.includes('/careers/list')) throw redirectErr;
        return { success: true, departments: [{ id: 1, label: 'Ops', positions: [{ id: 7, name: 'Caregiver', location: 'OR', url: 'https://dead.bamboohr.com/careers/7' }] }] };
      },
    };
    try {
      await bamboohr.fetch({ name: 'Suspended', careers_url: 'https://dead.bamboohr.com/careers' }, populatedCtx);
      fail('bamboohr.fetch() should throw when the embed-widget probe returns a populated (suspended-account) board');
    } catch (err) {
      if (err.status === 404) pass('bamboohr.fetch() maps a populated embed-widget probe (suspended-account signature) to status 404');
      else fail(`bamboohr.fetch() populated-probe case got status ${err.status}, want 404`);
    }

    // Fallback is itself unreachable — dead, same as a populated board.
    const bothFailCtx = { fetchJson: async () => { throw redirectErr; } };
    try {
      await bamboohr.fetch({ name: 'Dead', careers_url: 'https://dead.bamboohr.com/careers' }, bothFailCtx);
      fail('bamboohr.fetch() should throw when both /careers/list and the embed-widget probe fail');
    } catch (err) {
      if (err.status === 404) pass('bamboohr.fetch() maps a doubly-unreachable redirect to status 404');
      else fail(`bamboohr.fetch() doubly-unreachable case got status ${err.status}, want 404`);
    }
  }

  // fetch() — the marketing-site bounce specifically skips the embed-widget
  // probe entirely (92% of a full sweep's redirected tenants, confirmed
  // dead by the probe every time sampled — paying that request there is
  // pure waste). Prove the skip, not just the outcome: the mock ctx would
  // answer with a live, empty board if the probe were called, so a passing
  // test here means it never was.
  for (const [label, location] of [
    ['bare host', 'https://www.bamboohr.com/'],
    ['no www', 'https://bamboohr.com'],
  ]) {
    const marketingRedirectErr = new Error('HTTP 302');
    marketingRedirectErr.status = 302;
    marketingRedirectErr.location = location;
    let probeCalled = false;
    const fastPathCtx = {
      fetchJson: async (url) => {
        if (url.includes('/careers/list')) throw marketingRedirectErr;
        probeCalled = true;
        return { success: true, departments: [] };
      },
    };
    try {
      await bamboohr.fetch({ name: 'Dead', careers_url: 'https://dead.bamboohr.com/careers' }, fastPathCtx);
      fail(`bamboohr.fetch() should throw for a marketing-site bounce (${label})`);
    } catch (err) {
      if (err.status === 404 && !probeCalled) pass(`bamboohr.fetch() skips the embed-widget probe for a marketing-site bounce (${label})`);
      else fail(`bamboohr.fetch() marketing bounce (${label}): status=${err.status}, probeCalled=${probeCalled} (want 404, false)`);
    }
  }

  // fetch() — a non-redirect failure (timeout, DNS, 5xx) must pass through
  // unchanged: it is not a confirmed-dead signal, only "unknown" (dead-boards.mjs).
  {
    const transientErr = new Error('This operation was aborted');
    transientErr.code = 20;
    const transientCtx = { fetchJson: async () => { throw transientErr; } };
    try {
      await bamboohr.fetch({ name: 'Slow', careers_url: 'https://slow.bamboohr.com/careers' }, transientCtx);
      fail('bamboohr.fetch() should throw for a transport error');
    } catch (err) {
      if (err === transientErr && err.status !== 404) pass('bamboohr.fetch() passes a non-redirect failure through unmapped');
      else fail(`bamboohr.fetch() should not remap a transport error, got status ${err.status}`);
    }
  }

  // enrichDate() — the detail-page fetch passes redirect:'error' like every
  // non-inspection request.
  {
    let detailOpts;
    const detailCtx = {
      fetchJson: async (url, opts) => {
        detailOpts = opts;
        return { result: { jobOpening: { datePosted: '2026-01-17' } } };
      },
    };
    const job = { url: 'https://acme.bamboohr.com/careers/15' };
    await bamboohr.enrichDate(job, detailCtx);
    if (detailOpts?.redirect === 'error' && job.postedAt === Date.parse('2026-01-17')) {
      pass('bamboohr.enrichDate() fetches /careers/<id>/detail with redirect:error and sets postedAt');
    } else {
      fail(`bamboohr.enrichDate() redirect=${JSON.stringify(detailOpts)} postedAt=${job.postedAt}`);
    }
  }

} catch (e) {
  fail(`bamboohr provider tests crashed: ${e.message}`);
}

