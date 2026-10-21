// tests/coverage-check.test.mjs — why a posting the user found by hand was missed by the scanners
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, rmSync } from './helpers.mjs';
import { atsFromUrl, careersUrlFor, companyKey, findTrackedEntry, diagnose, appendMiss, loadDatasets } from '../coverage-check.mjs';

console.log('\ncoverage-check.mjs — coverage-miss diagnosis');

const check = (ok, msg) => (ok ? pass(msg) : fail(msg));

// 1. URL -> (ats, slug), keyed the way data/cache/ats-companies lists them
const cases = [
  ['https://job-boards.greenhouse.io/coinbase/jobs/123', 'greenhouse', 'coinbase'],
  ['https://boards.greenhouse.io/embed/job_app?for=Acme&token=1', 'greenhouse', 'acme'],
  ['https://jobs.eu.lever.co/kraken/abc', 'lever', 'kraken'],
  ['https://jobs.ashbyhq.com/Solana%20Foundation/abc', 'ashby', 'solana foundation'],
  ['https://wf.wd1.myworkdayjobs.com/en-US/WellsFargoJobs/job/NC/X_R1', 'workday', 'wf|wd1|wellsfargojobs'],
  ['https://careers-acme.icims.com/jobs/1/job', 'icims', 'acme'],
  ['https://apply.workable.com/anza/j/ABC/', 'workable', 'anza'],
];
for (const [url, ats, slug] of cases) {
  const got = atsFromUrl(url);
  check(got.ats === ats && got.slug === slug, `atsFromUrl ${url} -> ${ats}:${slug} (got ${got.ats}:${got.slug})`);
}
const custom = atsFromUrl('https://acme.com/careers?gh_jid=42');
check(custom.ats === 'greenhouse' && custom.slug === null, 'atsFromUrl: gh_jid on a custom domain is Greenhouse with an unknown board token');
check(atsFromUrl('https://acme.notion.site/Role').ats === null, 'atsFromUrl: unknown host has no ATS');
check(careersUrlFor({ ats: 'workday', slug: 'wf|wd1|wellsfargojobs' }) === 'https://wf.wd1.myworkdayjobs.com/wellsfargojobs', 'careersUrlFor rebuilds a Workday board');

// 2. Tracked-entry lookup: by board slug, or by name with the parenthetical note dropped
const entries = [
  { name: 'Coinbase (EU roles only)', careers_url: 'https://job-boards.greenhouse.io/coinbase' },
  { name: 'Acme Labs', careers_url: 'https://acme.com/careers', scan_method: 'websearch' },
  { name: 'Old Co', careers_url: 'https://jobs.lever.co/oldco', enabled: false },
];
check(findTrackedEntry(entries, { ats: 'greenhouse', slug: 'coinbase', company: 'Whatever' })?.name.startsWith('Coinbase'), 'findTrackedEntry matches on board slug');
check(findTrackedEntry(entries, { ats: null, slug: null, company: 'Coinbase' })?.name.startsWith('Coinbase'), 'findTrackedEntry ignores the parenthetical note in the entry name');
check(findTrackedEntry(entries, { ats: 'ashby', slug: 'zeta', company: 'Zeta' }) === null, 'findTrackedEntry: unknown company is untracked');
const twoBoards = [
  { name: 'Coinbase', careers_url: 'https://job-boards.greenhouse.io/coinbase' },
  { name: 'Coinbase Ventures', careers_url: 'https://jobs.ashbyhq.com/cbv' },
];
check(findTrackedEntry(twoBoards, { ats: 'ashby', slug: 'cbv', company: 'Coinbase' })?.name === 'Coinbase Ventures',
  'findTrackedEntry: a board match wins over an earlier entry matching only by name');

// 3. diagnose() over a synthetic context (no files, no network)
const providers = new Map([
  ['greenhouse', { id: 'greenhouse', fetch() {}, detect: e => /greenhouse\.io/.test(e.careers_url || '') }],
  ['ashby', { id: 'ashby', fetch() {}, detect: e => /ashbyhq\.com/.test(e.careers_url || '') }],
  ['lever', { id: 'lever', fetch() {}, detect: e => /lever\.co/.test(e.careers_url || '') }],
]);
const config = {
  title_filter: { positive: ['Solidity', 'Rust'], negative: ['Intern'] },
  title_filter_full: { positive: ['Solidity'] },
  location_filter: { allow: ['Remote'] },
};
const ctx = (over = {}) => ({
  config, entries, providers,
  history: new Map(), historyCompanies: new Map(), pipelineText: '',
  datasets: new Map([['ashby', new Set(['zeta'])]]),
  ...over,
});
const gap = (posting, c = ctx()) => diagnose({ location: '', ...posting }, c).gap;

const seenUrl = 'https://jobs.ashbyhq.com/zeta/1';
const history = new Map([[seenUrl, [seenUrl, '2026-10-01', 'ashby-api', 'Rust Engineer', 'Zeta', 'skipped_location']]]);
check(gap({ url: seenUrl, company: 'Zeta', title: 'Rust Engineer' }, ctx({ history })) === 'filtered', 'a URL in scan-history with a skipped_* status is "filtered"');
check(gap({ url: 'https://jobs.lever.co/oldco/1', company: 'Old Co', title: 'Rust Engineer' }) === 'tracked-disabled', 'disabled entry');
check(gap({ url: 'https://acme.com/careers/1', company: 'Acme Labs', title: 'Rust Engineer' }) === 'tracked-no-provider', 'websearch-only entry with no other scanner');
check(gap({ url: 'https://acme.com/careers/1', company: 'Acme Labs', title: 'Rust Engineer' },
  ctx({ historyCompanies: new Map([[companyKey('Acme Labs'), new Set(['acme-labs-playwright'])]]) })) === 'tracked-not-seen',
'a custom-pages scanner counts as coverage');
check(gap({ url: 'https://job-boards.greenhouse.io/coinbase/jobs/9', company: 'Coinbase', title: 'Head of Sales' }) === 'tracked-title-filter', 'tracked, title matches no keyword');
check(gap({ url: 'https://job-boards.greenhouse.io/coinbase/jobs/9', company: 'Coinbase', title: 'Senior Rust Engineer' }) === 'tracked-not-seen', 'tracked, passes the filters, not in scan-history');
check(gap({ url: 'https://job-boards.greenhouse.io/coinbase/jobs/9', company: 'Coinbase', title: 'Rust Engineer', location: 'New York' }) === 'tracked-location-filter', 'tracked, location dropped');
check(!diagnose({ url: 'https://job-boards.greenhouse.io/coinbase/jobs/9', company: 'Coinbase', title: 'Senior Rust Engineer', location: '' }, ctx())
  .evidence.some(e => e.startsWith('posting is on')), 'tracked on the same board: no board-mismatch evidence');

// Matched by name, but the posting lives on another board: say so, and point the fix at that board
const moved = diagnose({ url: 'https://jobs.ashbyhq.com/coinbase/9', company: 'Coinbase', title: 'Senior Rust Engineer', location: '' }, ctx());
check(moved.evidence.includes('posting is on ashby:coinbase, entry reads greenhouse:coinbase'), 'name-only match: evidence names both boards');
check(moved.gap === 'tracked-not-seen' && moved.fix.includes('https://jobs.ashbyhq.com/coinbase'), 'name-only match: the fix points at the posting\'s board');

const untracked = diagnose({ url: 'https://jobs.ashbyhq.com/zeta/2', company: 'Zeta', title: 'Rust Engineer', location: '' }, ctx());
check(untracked.gap === 'untracked', 'untracked company on a known ATS');
check(untracked.fix.includes('careers_url: https://jobs.ashbyhq.com/zeta'), 'untracked: proposes the careers_url');
check(untracked.evidence.some(e => e.includes('in the reverse-sweep company list')), 'untracked: reports reverse-sweep coverage');
check(untracked.evidence.includes('title_filter_full drops this title in the reverse sweep'), 'untracked: reports the full-sweep title verdict');
check(diagnose({ url: 'https://jobs.ashbyhq.com/zeta/3', company: 'Zeta', title: 'Head of Sales', location: '' }, ctx()).fix.startsWith('add the company only with a title keyword'), 'untracked: a title the filter drops is not proposed as a plain add');
check(gap({ url: 'https://zeta.notion.site/Role', company: 'Zeta', title: 'Rust Engineer' }) === 'untracked-unsupported-ats', 'untracked company on an unknown site');

// 4. The miss log: header once, one row per URL
const dir = mkdtempSync(join(tmpdir(), 'coverage-check-'));
try {
  const file = join(dir, 'coverage-misses.tsv');
  const posting = { url: 'https://jobs.ashbyhq.com/zeta/2', company: 'Zeta', title: 'Rust\tEngineer' };
  check(appendMiss(file, posting, untracked, 'note', '2026-10-07') === true, 'appendMiss writes a new URL');
  check(appendMiss(file, posting, untracked, 'note', '2026-10-07') === false, 'appendMiss skips a URL already logged');
  check(appendMiss(file, { ...posting, url: 'https://jobs.ashbyhq.com/zeta/2/?utm_source=x' }, untracked, 'note', '2026-10-07') === false,
    'appendMiss skips a variant of a logged URL (normalizeUrlForDedup)');
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  check(lines.length === 2 && lines[0].startsWith('date\turl') && lines[1].split('\t').length === 7, 'log has one header and one 7-column row (tabs in fields folded)');

  // 5. The reverse sweep's company lists: a damaged file is skipped, not fatal
  writeFileSync(join(dir, 'greenhouse.json'), '["Acme", "Zeta"]');
  writeFileSync(join(dir, 'lever.json'), '["acme", "ze');
  writeFileSync(join(dir, 'ashby.json'), '{"acme": true}');
  const datasets = loadDatasets(dir);
  check(datasets.get('greenhouse')?.has('zeta') && !datasets.has('lever') && !datasets.has('ashby'),
    'loadDatasets keeps a valid list and skips a truncated or non-array file');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
