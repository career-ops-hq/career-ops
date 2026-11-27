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
  ['https://wf.wd1.myworkdayjobs.com/wday/cxs/wf/WellsFargoJobs/jobs', 'workday', 'wf|wd1|wellsfargojobs'],
  ['https://wd5.myworkdaysite.com/recruiting/guidewire/external/job/Foster-City/X_R1', 'workday', 'guidewire|wd5|external'],
  ['https://wd5.myworkdaysite.com/en-US/recruiting/guidewire/external/job/Foster-City/X_R1', 'workday', 'guidewire|wd5|external'],
  ['https://careers-acme.icims.com/jobs/1/job', 'icims', 'acme'],
  ['https://apply.workable.com/anza/j/ABC/', 'workable', 'anza'],
  ['https://apply.workable.com/api/v1/widget/accounts/Anza?details=true', 'workable', 'anza'],
  ['https://boards-api.greenhouse.io/v1/boards/Anthropic/jobs', 'greenhouse', 'anthropic'],
  ['https://api.lever.co/v0/postings/Mistral', 'lever', 'mistral'],
  ['https://api.eu.lever.co/v0/postings/Kraken', 'lever', 'kraken'],
  ['https://api.ashbyhq.com/posting-api/job-board/Andela?includeCompensation=true', 'ashby', 'andela'],
];
for (const [url, ats, slug] of cases) {
  const got = atsFromUrl(url);
  check(got.ats === ats && got.slug === slug, `atsFromUrl ${url} -> ${ats}:${slug} (got ${got.ats}:${got.slug})`);
}
const custom = atsFromUrl('https://acme.com/careers?gh_jid=42');
check(custom.ats === 'greenhouse' && custom.slug === null, 'atsFromUrl: gh_jid on a custom domain is Greenhouse with an unknown board token');
const workableShare = atsFromUrl('https://apply.workable.com/j/ABC123');
check(workableShare.ats === 'workable' && workableShare.slug === null, 'atsFromUrl: Workable /j/<shortcode> share link has no account slug');
check(careersUrlFor(workableShare) === null, 'careersUrlFor: Workable share link with unknown account slug yields null, not /j');
for (const incomplete of [
  'https://boards-api.greenhouse.io/v1/boards',
  'https://api.lever.co/v0/postings',
  'https://api.ashbyhq.com/posting-api/job-board',
  'https://apply.workable.com/api/v1/widget/accounts',
  'https://wf.wd1.myworkdayjobs.com/wday/cxs/wf',
]) {
  check(atsFromUrl(incomplete).ats === null, `atsFromUrl: incomplete API path ${incomplete} has no ATS match`);
}
check(atsFromUrl('https://acme.notion.site/Role').ats === null, 'atsFromUrl: unknown host has no ATS');
check(careersUrlFor({ ats: 'workday', slug: 'wf|wd1|wellsfargojobs' }) === 'https://wf.wd1.myworkdayjobs.com/wellsfargojobs', 'careersUrlFor rebuilds a Workday board');
check(careersUrlFor(atsFromUrl('https://wd5.myworkdaysite.com/recruiting/guidewire/external/job/X_R1')) === 'https://wd5.myworkdaysite.com/recruiting/guidewire/external',
  'careersUrlFor rebuilds a myworkdaysite board on its own host');
check(atsFromUrl('https://wd5.myworkdaysite.com/recruiting/guidewire').ats === null, 'atsFromUrl: a myworkdaysite path without a site has no ATS match');

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

// Corporate careers_url + explicit ATS api: URL (35+ shipped portals.example.yml entries)
const apiPinnedEntries = [
  { name: 'Anthropic', careers_url: 'https://www.anthropic.com/careers/jobs', api: 'https://boards-api.greenhouse.io/v1/boards/anthropic/jobs' },
  { name: 'Andela', careers_url: 'https://www.andela.com/careers', api: 'https://api.ashbyhq.com/posting-api/job-board/andela' },
  { name: 'Anza', careers_url: 'https://apply.workable.com/anza' },
];
const apiPinnedProviders = new Map([
  ['greenhouse', { id: 'greenhouse', fetch() {}, detect: e => /greenhouse\.io/.test(e.api || e.careers_url || '') }],
  ['ashby', { id: 'ashby', fetch() {}, detect: e => /ashbyhq\.com/.test(e.api || e.careers_url || '') }],
  ['workable', { id: 'workable', fetch() {}, detect: e => /apply\.workable\.com\/(?!j\/)/.test(e.api || e.careers_url || '') }],
]);
check(findTrackedEntry(apiPinnedEntries, { ats: 'greenhouse', slug: 'anthropic', company: 'Anthropic PBC' })?.name === 'Anthropic',
  'findTrackedEntry matches on board slug derived from entry.api');
const anthropicDiag = diagnose(
  { url: 'https://job-boards.greenhouse.io/anthropic/jobs/99', company: 'Anthropic', title: 'Rust Engineer', location: '' },
  ctx({ entries: apiPinnedEntries, providers: apiPinnedProviders }),
);
check(!anthropicDiag.evidence.some(e => e.startsWith('posting is on')) && anthropicDiag.fix.startsWith('none: newer than the last scan'),
  'diagnose: corporate careers_url with matching entry.api does not report a false board mismatch');
const workableShareTracked = diagnose(
  { url: 'https://apply.workable.com/j/ABC123', company: 'Anza', title: 'Rust Engineer', location: '' },
  ctx({ entries: apiPinnedEntries, providers: apiPinnedProviders }),
);
check(!workableShareTracked.evidence.some(e => e.startsWith('posting is on')) && !workableShareTracked.fix.includes('apply.workable.com/j'),
  'diagnose: a Workable /j/ share link for a tracked Workable company does not report workable:j or propose /j');
const workableShareUntracked = diagnose(
  { url: 'https://apply.workable.com/j/ABC123', company: 'NewWorkableCo', title: 'Rust Engineer', location: '' },
  ctx({ entries: apiPinnedEntries, providers: apiPinnedProviders }),
);
check(workableShareUntracked.gap === 'untracked-unsupported-ats'
  && workableShareUntracked.evidence.includes('workable share link, account slug not in URL')
  && !workableShareUntracked.fix.includes('apply.workable.com/j'),
'diagnose: an untracked Workable /j/ share link explains the missing account slug instead of proposing https://apply.workable.com/j');

const untracked = diagnose({ url: 'https://jobs.ashbyhq.com/zeta/2', company: 'Zeta', title: 'Rust Engineer', location: '' }, ctx());
check(untracked.gap === 'untracked', 'untracked company on a known ATS');
check(untracked.fix.includes('careers_url: https://jobs.ashbyhq.com/zeta'), 'untracked: proposes the careers_url');
check(untracked.evidence.some(e => e.includes('in the reverse-sweep company list')), 'untracked: reports reverse-sweep coverage');
check(untracked.evidence.includes('title_filter_full drops this title in the reverse sweep'), 'untracked: reports the full-sweep title verdict');
check(diagnose({ url: 'https://jobs.ashbyhq.com/zeta/3', company: 'Zeta', title: 'Head of Sales', location: '' }, ctx()).fix.startsWith('add the company only with a title keyword'), 'untracked: a title the filter drops is not proposed as a plain add');
check(gap({ url: 'https://zeta.notion.site/Role', company: 'Zeta', title: 'Rust Engineer' }) === 'untracked-unsupported-ats', 'untracked company on an unknown site');
const wdSite = diagnose({ url: 'https://wd5.myworkdaysite.com/recruiting/guidewire/external/job/X_R1', company: 'Guidewire', title: 'Rust Engineer', location: '' }, ctx());
check(wdSite.gap === 'untracked' && wdSite.fix.includes('careers_url: https://wd5.myworkdaysite.com/recruiting/guidewire/external'),
  'untracked: a myworkdaysite posting is on a known ATS, and the fix proposes its board');
check(findTrackedEntry([{ name: 'Guidewire Software', careers_url: 'https://wd5.myworkdaysite.com/recruiting/guidewire/external' }],
  { ...atsFromUrl('https://wd5.myworkdaysite.com/en-US/recruiting/guidewire/external/job/X_R1'), company: 'Guidewire' })?.name === 'Guidewire Software',
'findTrackedEntry matches a myworkdaysite entry on its board');

// 3b. A site no provider reads: count the host, and lead with the platform when other companies post there
const ON_HOST = 'https://app.tenantats.example/apply/Zeta/1';
const onHost = (...rows) => new Map(rows.map(([url, company]) => [url, [url, '2026-10-01', 'getro-api', 'Rust Engineer', company, 'skipped_location']]));
const siteCase = (over, url = ON_HOST, company = 'Zeta') => diagnose({ url, company, title: 'Rust Engineer', location: '' }, ctx(over));

const noOthers = siteCase({});
check(noOthers.evidence.includes('no provider reads app.tenantats.example'), 'site: says no provider reads the host');
check(!noOthers.evidence.some(e => e.includes('other posting')), 'site: no host line when nothing else is on it');
check(noOthers.fix === 'add "Zeta" with its careers page; if no provider resolves it, scan_method: websearch', 'site: the per-company fix stays when nothing else is on the host');

const trackerText = [
  '| # | Date | Company | Role | Score | Status | URL | PDF | Report | Notes |',
  '|---|---|---|---|---|---|---|---|---|---|',
  '| 1 | 2026-10-02 | Gamma | Rust Engineer | 4.0/5 | Applied | [link](https://app.tenantats.example/apply/Gamma/3) | - | - | - |',
  '| 2 | 2026-10-02 | Delta | Rust Engineer | 4.0/5 | Applied | https://elsewhere.example/4 | - | - | - |',
].join('\n');
const three = siteCase({
  history: onHost(['https://app.tenantats.example/apply/Alpha/1', 'Alpha']),
  pipelineText: '- [ ] https://www.app.tenantats.example/apply/Beta/2 | Beta | Rust Engineer',
  trackerText,
});
check(three.gap === 'untracked-unsupported-ats', 'site: the closed gap set does not change');
check(three.evidence.includes('3 other postings on app.tenantats.example (scan history, pipeline, tracker): Alpha, Beta, Gamma'),
  'site: counts the host across scan history, pipeline and tracker, ignoring www');
check(three.fix.startsWith('3 other companies post on app.tenantats.example too: one provider could cover all of them'), 'site: the fix leads with the platform');
check(three.fix.includes('providers/ADDING_A_PROVIDER.md'), 'site: the fix points at the provider guide');
check(three.fix.endsWith('For "Zeta" alone: add "Zeta" with its careers page; if no provider resolves it, scan_method: websearch'), 'site: the fix keeps the per-company line');

const one = siteCase({ history: onHost(['https://app.tenantats.example/apply/Alpha/1', 'Alpha']) });
check(one.fix.startsWith('1 other company posts on'), 'site: one other company reads in the singular');
check(one.evidence.includes('1 other posting on app.tenantats.example (scan history): Alpha'), 'site: one other posting reads in the singular');

const ownOnly = siteCase({ history: onHost(['https://app.tenantats.example/apply/Zeta/2', 'Zeta (EU)'], ['https://app.tenantats.example/apply/none/3', '']) });
check(ownOnly.evidence.includes('2 other postings on app.tenantats.example (scan history)'), 'site: the same company and an unnamed row count as postings, not companies');
check(ownOnly.fix.startsWith('add "Zeta"'), 'site: no platform lead without another named company');

const selfRow = siteCase({ pipelineText: `- [ ] ${ON_HOST}/?utm_source=x | Zeta | Rust Engineer` });
check(!selfRow.evidence.some(e => e.includes('other posting')), 'site: a variant of the same URL is not another posting');

const mixed = siteCase({ history: onHost(['not a url', 'Alpha'], ['https://elsewhere.example/1', 'Beta']) });
check(!mixed.evidence.some(e => e.includes('other posting')), 'site: a malformed URL or another host does not count');

const many = siteCase({ history: onHost(...['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(c => [`https://app.tenantats.example/apply/${c}/1`, `Company ${c}`])) });
check(many.evidence.some(e => e.endsWith(': Company A, Company B, Company C, Company D, Company E, +2 more')), 'site: a long company list is capped');

// A posting URL that detect() does not know, on a site with a provider named after it (Dover's /apply/ pages)
const namedProviders = new Map([...providers, ['tenantats', { id: 'tenantats', fetch() {}, detect: e => /\/careers\//.test(e.careers_url || '') }]]);
const named = siteCase({ providers: namedProviders, history: onHost(['https://app.tenantats.example/apply/Alpha/1', 'Alpha']) });
check(named.evidence.includes('provider tenantats looks like it reads app.tenantats.example'), 'site: a provider named after a host label counts as reading it');
check(!named.evidence.includes('no provider reads app.tenantats.example'), 'site: no "no provider" claim when one looks like it reads the host');
check(named.fix.startsWith('add "Zeta"'), 'site: no platform lead when a provider looks like it reads the host');

const detected = siteCase({ providers: new Map([['tenantats2', { id: 'tenantats2', fetch() {}, detect: e => /tenantats/.test(e.careers_url || '') }]]), history: onHost(['https://app.tenantats.example/apply/Alpha/1', 'Alpha']) });
check(detected.evidence.includes('provider tenantats2 looks like it reads app.tenantats.example'), 'site: a provider that detects the posting URL counts as reading it');
check(detected.fix.startsWith('add "Zeta"'), 'site: no platform lead when a provider detects the posting URL');

const customDomain = siteCase({ history: onHost(['https://acme.com/careers?gh_jid=1', 'Other']) }, 'https://acme.com/careers?gh_jid=42', 'Acme');
check(customDomain.evidence.includes('greenhouse posting on a custom domain, board token unknown'), 'site: a Greenhouse custom domain keeps its evidence');
check(!customDomain.evidence.some(e => e.includes('other posting')) && customDomain.fix.startsWith('add "Acme"'), 'site: a job site with a known ATS is not a platform question');

const badUrl = siteCase({}, 'not a url', 'Zeta');
check(badUrl.evidence.includes('no provider reads this URL') && badUrl.gap === 'untracked-unsupported-ats', 'site: a URL that does not parse keeps its evidence');

const trackedOn = (url, over = {}) => diagnose({ url, company: 'Acme Labs', title: 'Rust Engineer', location: '' }, ctx(over));
check(trackedOn('https://acme.com/careers/1').fix === 'none zero-token: no provider reads this site; WebSearch only', 'tracked: the WebSearch fix stays when nothing else is on the host');
const trackedLead = trackedOn('https://acme.com/careers/1', { history: onHost(['https://acme.com/careers/2', 'Beta Corp']) });
check(trackedLead.gap === 'tracked-no-provider' && trackedLead.evidence.includes('1 other posting on acme.com (scan history): Beta Corp'), 'tracked: counts the host');
check(trackedLead.fix.startsWith('1 other company posts on acme.com too') && trackedLead.fix.endsWith('For "Acme Labs" alone: none zero-token: no provider reads this site; WebSearch only'), 'tracked: leads with the platform and keeps the fix');
check(trackedOn(ON_HOST, { providers: namedProviders }).fix === 'point "Acme Labs".careers_url at its careers page on app.tenantats.example: provider tenantats looks like it reads that site', 'tracked: names the provider that looks like it reads the host');

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
