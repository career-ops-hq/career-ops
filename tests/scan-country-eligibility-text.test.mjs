// tests/scan-country-eligibility-text.test.mjs — #6747 through the real scan.
//
// CryptocurrencyJobs states where a job can be done only in its feed teaser,
// which #6746 keeps out of `description` because content_filter reads any
// description as the JD. The provider now carries the teaser's location
// clause as `eligibilityText`, which country_eligibility_filter reads and
// content_filter does not. This runs scan.mjs against a fixture board that
// feeds the real provider parser, and checks what reached the pipeline and
// the counters the run printed.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';

console.log('\nscan.mjs — country eligibility reads eligibilityText (#6747)');

const { buildCountryEligibilityFilter, countryEligibilityText } =
  await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

// ── countryEligibilityText ──────────────────────────────────────────
{
  const cases = [
    [{ description: 'JD body', eligibilityText: 'can be done remotely anywhere in Canada' }, 'JD body\ncan be done remotely anywhere in Canada'],
    [{ eligibilityText: 'is based in Paris' }, 'is based in Paris'],
    [{ description: 'JD body' }, 'JD body'],
    [{ description: '   ', eligibilityText: '' }, ''],
    [{ description: 42, eligibilityText: null }, ''],
    [{}, ''],
  ];
  const wrong = cases.filter(([job, want]) => countryEligibilityText(job) !== want);
  if (wrong.length === 0) pass('countryEligibilityText joins description and eligibilityText, skipping empty and non-string values');
  else fail(`countryEligibilityText wrong for ${JSON.stringify(wrong.map(([job]) => [job, countryEligibilityText(job)]))}`);
}

// The filter itself is unchanged; this pins that an eligibilityText-only job
// reaches it with the clause and gets the same three-way decision a JD would.
{
  const cfg = { exclusionary: ['remotely anywhere in the united states'], inclusive: ['north america'] };
  const de = buildCountryEligibilityFilter(cfg, 'Germany');
  const ca = buildCountryEligibilityFilter(cfg, 'Canada');
  const usOnly = countryEligibilityText({ eligibilityText: 'can be done remotely anywhere in the United States' });
  const usCa = countryEligibilityText({ eligibilityText: 'can be done remotely anywhere in the United States, or Canada' });
  const na = countryEligibilityText({ eligibilityText: 'can be done remotely anywhere in the United States or North America' });
  if (!de(usOnly) && !ca(usOnly)) pass('an exclusionary phrase in eligibilityText rejects the job');
  else fail('an exclusionary phrase in eligibilityText should reject the job');
  if (ca(usCa) && !de(usCa)) pass('eligibilityText naming the candidate\'s country passes only that candidate');
  else fail(`candidate-country check on eligibilityText wrong: ca=${ca(usCa)} de=${de(usCa)}`);
  if (de(na)) pass('an inclusive phrase in eligibilityText widens eligibility');
  else fail('an inclusive phrase in eligibilityText should pass the job');
}

// ── End to end ──────────────────────────────────────────────────────
const SCANNER_PATH_VARS = [
  'CAREER_OPS_PORTALS',
  'CAREER_OPS_PROFILE',
  'CAREER_OPS_PIPELINE',
  'CAREER_OPS_SCAN_HISTORY',
  'CAREER_OPS_ROOT',
  'CAREER_OPS_DATA_DIR',
];

const COUNTRY_FILTER = `country_eligibility_filter:
  exclusionary:
    - "remotely anywhere in the united states"
`;

function runScan({ country, countryFilter }) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-elig-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'data', 'applications.md'), `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`);
    writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n');
    writeFileSync(join(dir, 'config', 'profile.yml'), `location:\n  country: ${country}\n`);
    const portals = join(dir, 'portals.yml');
    // content_filter requires a keyword none of the postings carry: a job
    // with no description passes it, a job with one is dropped.
    writeFileSync(portals, `title_filter:
  positive:
    - "Engineer"
content_filter:
  positive:
    - "solidity"
${countryFilter ? COUNTRY_FILTER : ''}tracked_companies:
  - name: Fixture Chain
    careers_url: https://example.invalid/jobs
    parser:
      command: node
      script: tests/fixtures/cryptocurrencyjobs-teaser-board.mjs
`);
    const childEnv = { ...process.env };
    for (const name of SCANNER_PATH_VARS) delete childEnv[name];
    const stdout = execFileSync(NODE, [join(ROOT, 'scan.mjs')], {
      cwd: dir,
      env: { ...childEnv, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: portals },
      encoding: 'utf-8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const p = join(dir, 'data', 'pipeline.md');
    const slugs = existsSync(p)
      ? readFileSync(p, 'utf-8').split('\n')
        .map(l => l.match(/^- \[[ x]\]\s+https:\/\/example\.invalid\/jobs\/([\w-]+)/)?.[1])
        .filter(Boolean)
        .sort()
      : [];
    return { stdout, slugs };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const counter = (stdout, label) => stdout.match(new RegExp(`Filtered by ${label}:\\s+(\\d+) removed`))?.[1];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A German candidate: both US-restricted teasers match the exclusionary
// phrase and name no German eligibility, so both are dropped.
{
  const { stdout, slugs } = runScan({ country: 'Germany', countryFilter: true });
  if (same(slugs, ['no-clause', 'worldwide'])) pass('a teaser restriction matching an exclusionary phrase is rejected; worldwide and no-clause postings stay');
  else fail(`expected [no-clause, worldwide] in the pipeline, got ${JSON.stringify(slugs)}\n${stdout}`);
  if (counter(stdout, 'country eligibility') === '2') pass('the run counts both teaser rejections under country eligibility');
  else fail(`expected "Filtered by country eligibility: 2 removed"\n${stdout}`);
  if (counter(stdout, 'content') === '1') pass('content_filter dropped only the posting with a description: the teaser is not read as a JD');
  else fail(`expected "Filtered by content: 1 removed"\n${stdout}`);
}

// A Canadian candidate: the US-or-Canada teaser names their country, so only
// the US-only posting is dropped.
{
  const { stdout, slugs } = runScan({ country: 'Canada', countryFilter: true });
  if (same(slugs, ['no-clause', 'us-canada', 'worldwide'])) pass('a teaser naming the candidate\'s country keeps the posting');
  else fail(`expected [no-clause, us-canada, worldwide] in the pipeline, got ${JSON.stringify(slugs)}\n${stdout}`);
  if (counter(stdout, 'country eligibility') === '1') pass('the Canadian run counts one country-eligibility rejection');
  else fail(`expected "Filtered by country eligibility: 1 removed"\n${stdout}`);
}

// No country_eligibility_filter configured: every teaser posting passes, as
// before #6747, and content_filter behaves the same.
{
  const { stdout, slugs } = runScan({ country: 'Germany', countryFilter: false });
  if (same(slugs, ['no-clause', 'us-canada', 'us-only', 'worldwide'])) pass('without country_eligibility_filter every teaser posting passes');
  else fail(`expected all four teaser postings in the pipeline, got ${JSON.stringify(slugs)}\n${stdout}`);
  if (counter(stdout, 'content') === '1' && counter(stdout, 'country eligibility') === undefined) {
    pass('without country_eligibility_filter the content filter still drops only the described posting');
  } else {
    fail(`unexpected counters without country_eligibility_filter\n${stdout}`);
  }
}
