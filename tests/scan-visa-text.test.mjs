// tests/scan-visa-text.test.mjs — visa_filter reads `visaText` through the real scan.
//
// Startup Jobs keeps its feed teaser out of `description`, because
// content_filter reads any description as the JD. The provider carries the
// teaser as `visaText` instead, which visa_filter reads and content_filter
// does not. This runs scan.mjs against a fixture board that feeds the real
// provider parser, and checks what reached the pipeline and the counters the
// run printed.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';

console.log('\nscan.mjs — visa_filter reads visaText');

const { buildVisaFilter, visaFilterText, countryEligibilityText } =
  await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

// ── visaFilterText ──────────────────────────────────────────────────
{
  const cases = [
    [{ description: 'JD body', visaText: 'we offer visa sponsorship' }, 'JD body\nwe offer visa sponsorship'],
    [{ visaText: 'we offer visa sponsorship' }, 'we offer visa sponsorship'],
    [{ description: 'JD body' }, 'JD body'],
    [{ description: '   ', visaText: '' }, ''],
    [{ description: 42, visaText: null }, ''],
    [{}, ''],
  ];
  const wrong = cases.filter(([job, want]) => visaFilterText(job) !== want);
  if (wrong.length === 0) pass('visaFilterText joins description and visaText, skipping empty and non-string values');
  else fail(`visaFilterText wrong for ${JSON.stringify(wrong.map(([job]) => [job, visaFilterText(job)]))}`);

  if (countryEligibilityText({ visaText: 'we offer visa sponsorship' }) === '') pass('country_eligibility_filter text never includes visaText');
  else fail('countryEligibilityText should ignore visaText');
}

// The filter itself is unchanged; this pins that a visaText-only job gets
// the same decision a JD with that text would.
{
  const strict = buildVisaFilter({ enabled: true, require_mention: true });
  const lenient = buildVisaFilter({ enabled: true });
  const sponsor = visaFilterText({ visaText: 'Build our API; we offer visa sponsorship.' });
  const refuse = visaFilterText({ visaText: 'We cannot sponsor visas for this role.' });
  const plain = visaFilterText({ visaText: 'Own the warehouse.' });
  if (strict(sponsor) && !strict(plain) && !strict(refuse)) pass('require_mention keeps only a visaText that names sponsorship');
  else fail(`require_mention on visaText wrong: sponsor=${strict(sponsor)} plain=${strict(plain)} refuse=${strict(refuse)}`);
  if (lenient(sponsor) && lenient(plain) && !lenient(refuse)) pass('a refusal in visaText rejects the job; text without a refusal passes');
  else fail(`negatives on visaText wrong: sponsor=${lenient(sponsor)} plain=${lenient(plain)} refuse=${lenient(refuse)}`);
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

function runScan(visaFilter) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-visa-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'data', 'applications.md'), `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`);
    writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n');
    writeFileSync(join(dir, 'config', 'profile.yml'), 'location:\n  country: Germany\n');
    const portals = join(dir, 'portals.yml');
    // content_filter requires a keyword no teaser carries: a job with no
    // description passes it, so every teaser posting must get through it.
    writeFileSync(portals, `title_filter:
  positive:
    - "Engineer"
content_filter:
  positive:
    - "solidity"
${visaFilter}tracked_companies:
  - name: Fixture Labs
    careers_url: https://example.invalid/jobs
    parser:
      command: node
      script: tests/fixtures/startup-jobs-teaser-board.mjs
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
        .map(l => l.match(/^- \[[ x]\]\s+https:\/\/startup\.jobs\/([\w-]+)/)?.[1])
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

// require_mention: only the teaser that offers sponsorship stays.
{
  const { stdout, slugs } = runScan('visa_filter:\n  enabled: true\n  require_mention: true\n');
  if (same(slugs, ['sponsor'])) pass('require_mention keeps the posting whose teaser offers visa sponsorship');
  else fail(`expected [sponsor] in the pipeline, got ${JSON.stringify(slugs)}\n${stdout}`);
  if (counter(stdout, 'visa') === '2') pass('the run counts the other two teaser postings under visa');
  else fail(`expected "Filtered by visa: 2 removed"\n${stdout}`);
  if (counter(stdout, 'content') === '0') pass('content_filter drops no teaser posting: visaText is not read as a JD');
  else fail(`expected no content-filter removals\n${stdout}`);
}

// Default visa_filter: only the teaser that refuses sponsorship is dropped.
{
  const { stdout, slugs } = runScan('visa_filter:\n  enabled: true\n');
  if (same(slugs, ['plain', 'sponsor'])) pass('a teaser refusing sponsorship is dropped; the others stay');
  else fail(`expected [plain, sponsor] in the pipeline, got ${JSON.stringify(slugs)}\n${stdout}`);
  if (counter(stdout, 'visa') === '1') pass('the default visa_filter run counts one visa rejection');
  else fail(`expected "Filtered by visa: 1 removed"\n${stdout}`);
}

// No visa_filter: every teaser posting passes.
{
  const { stdout, slugs } = runScan('');
  if (same(slugs, ['plain', 'refuse', 'sponsor'])) pass('without visa_filter every teaser posting passes');
  else fail(`expected all three teaser postings in the pipeline, got ${JSON.stringify(slugs)}\n${stdout}`);
}
