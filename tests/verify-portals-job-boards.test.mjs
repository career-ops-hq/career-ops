// tests/verify-portals-job-boards.test.mjs — verifyPortalsFile() sweeps
// `job_boards` entries together with `tracked_companies`: every enabled entry in
// either list gets one health row.
//
// A `job_boards` entry is a multi-employer aggregator and comes in two shapes,
// both resolved by the provider-plugin layer (verify-portals "tier 2"):
//   - `provider:` only, no `careers_url` — arbeitnow, hackernews, himalayas,
//     thehub, wttj, remotive …
//   - `careers_url` on a non-ATS host + explicit `provider:` — the Getro VC
//     boards (`careers.<vc>.com/jobs` + `provider: getro`), arbeitsagentur.
// Neither carries an ATS slug, so tier 1 (the hardcoded Greenhouse/Ashby/Lever
// fast probe) does not apply to a `job_boards` entry. The CLI's `main()` calls
// verifyPortalsFile with the loaded provider registry, so each feed is probed
// through its plugin.
//
// This test runs offline with stubs. Given no `providers` map a feed resolves to
// `skipped` (it is still in the result); given a stub `providers` map it is
// probed and classified. The per-ATS response shapes and the stub-provider
// pattern match the tier-2 fixtures in test-all.mjs §10b. Entry names are
// invented.
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT, rmSync } from './helpers.mjs';

console.log('\nverify-portals — job_boards are swept alongside tracked_companies');

const { verifyPortalsFile } = await import(
  pathToFileURL(join(ROOT, 'verify-portals.mjs')).href
);

// tracked_companies control: a real ATS slug, probed via tier 1. Greenhouse/Ashby
// wrap in `{ jobs: [...] }`, Lever returns a bare array.
const fetchJson = async (url) =>
  (url.includes('api.lever.co/') ? [{ id: 1 }] : { jobs: [{ id: 1, title: 'QA Engineer' }] });

// Stand-in for the provider registry the CLI loads (loadProviders()). A bare
// `provider:` field resolves straight to the matching stub — explicit provider
// wins, no detect() needed — and its bounded `fetch` is called.
const fakeCtx = { transport: 'http', fetchJson: async () => ({}), fetchText: async () => ['x'] };
const boardPlugin = {
  id: 'board-plugin',
  fetch: async (_entry, ctx) => {
    if (ctx.maxPages !== 1) throw new Error('health probe must bound pagination to maxPages=1');
    return [{ title: 'one' }, { title: 'two' }];
  },
};
const fakeProviders = new Map([[boardPlugin.id, boardPlugin]]);

const tmp = mkdtempSync(join(tmpdir(), 'co-verify-jb-'));
const writeYml = (name, body) => {
  const p = join(tmp, name);
  writeFileSync(p, body, 'utf-8');
  return p;
};
const byName = (rows) => Object.fromEntries(rows.map((r) => [r.name, r]));

// Both job_boards shapes + a tracked_companies control.
const both = writeYml('both.yml', `
tracked_companies:
  - name: "Acme"
    api: "https://boards-api.greenhouse.io/v1/boards/acme/jobs"
job_boards:
  - name: "VC portfolio board"
    careers_url: "https://careers.example-vc.com/jobs"
    provider: board-plugin
  - name: "Remote-jobs feed"
    provider: board-plugin
`);

try {
  // 1. With no providers map, tier 2 is inert: each job_boards feed resolves to
  //    `skipped`, and every entry from both lists is present in the result.
  const noProv = await verifyPortalsFile(both, { fetchJson });
  const npRows = byName(noProv.results);
  if (noProv.results.length === 3 && npRows['Acme'] && npRows['VC portfolio board'] && npRows['Remote-jobs feed']) {
    pass('every tracked_companies and job_boards entry gets a health row');
  } else {
    fail(`expected 3 rows (Acme + 2 job_boards) — got ${JSON.stringify(noProv.results.map((r) => r.name))}`);
  }
  if (npRows['VC portfolio board']?.status === 'skipped' && npRows['Remote-jobs feed']?.status === 'skipped') {
    pass('with no provider layer, a job_boards feed resolves to skipped');
  } else {
    fail(`job_boards feeds should be "skipped" without providers — got ${JSON.stringify({
      vc: npRows['VC portfolio board'], feed: npRows['Remote-jobs feed'],
    })}`);
  }

  // 2. With the provider registry the CLI supplies, both job_boards shapes are
  //    probed through their plugin and classified.
  const withProv = await verifyPortalsFile(both, { fetchJson, providers: fakeProviders, httpCtx: fakeCtx });
  const wpRows = byName(withProv.results);
  if (wpRows['VC portfolio board']?.status === 'live' && wpRows['Remote-jobs feed']?.status === 'live'
    && wpRows['Acme']?.status === 'live') {
    pass('with the provider layer, job_boards feeds (url+provider and provider-only) are probed live');
  } else {
    fail(`job_boards feeds should probe live via the provider layer — got ${JSON.stringify(wpRows)}`);
  }

  // 3. A file with only a job_boards section is still swept.
  const boardsOnly = writeYml('boards-only.yml', `
job_boards:
  - name: "Solo feed"
    provider: board-plugin
`);
  const boardsOnlyRes = await verifyPortalsFile(boardsOnly, { fetchJson, providers: fakeProviders, httpCtx: fakeCtx });
  if (boardsOnlyRes.found && boardsOnlyRes.results.length === 1
    && boardsOnlyRes.results[0].name === 'Solo feed' && boardsOnlyRes.results[0].status === 'live') {
    pass('a portals file with only a job_boards section is swept');
  } else {
    fail(`job_boards-only file should yield 1 probed row — got ${JSON.stringify(boardsOnlyRes)}`);
  }

  // 4. A file with only a tracked_companies section: the entry is probed via
  //    tier 1.
  const companiesOnly = writeYml('companies-only.yml', `
tracked_companies:
  - name: "Only Co"
    api: "https://boards-api.greenhouse.io/v1/boards/onlyco/jobs"
`);
  const companiesOnlyRes = await verifyPortalsFile(companiesOnly, { fetchJson });
  if (companiesOnlyRes.results.length === 1
    && companiesOnlyRes.results[0].name === 'Only Co'
    && companiesOnlyRes.results[0].status === 'live') {
    pass('a portals file with only a tracked_companies section is swept');
  } else {
    fail(`tracked_companies-only file — got ${JSON.stringify(companiesOnlyRes)}`);
  }

  // 5. `enabled: false` excludes a job_boards entry from the sweep, as it does a
  //    company.
  const disabled = writeYml('disabled.yml', `
job_boards:
  - name: "Active feed"
    provider: board-plugin
  - name: "Retired feed"
    provider: board-plugin
    enabled: false
`);
  const disabledRes = await verifyPortalsFile(disabled, { fetchJson, providers: fakeProviders, httpCtx: fakeCtx });
  if (disabledRes.results.length === 1 && disabledRes.results[0].name === 'Active feed') {
    pass('an `enabled: false` job_boards entry is excluded from the sweep');
  } else {
    fail(`disabled job_boards entry should be excluded — got ${JSON.stringify(disabledRes.results.map((r) => r.name))}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
