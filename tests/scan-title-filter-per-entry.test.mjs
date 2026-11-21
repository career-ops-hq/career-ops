// tests/scan-title-filter-per-entry.test.mjs — #7244 through the real scan.
//
// A tracked_companies / job_boards entry's own title_filter replaces the global
// filter for that entry only, including global negatives.
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

console.log('\nscan.mjs — per-entry title_filter (#7244)');

function runScan(portalsContent) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-title-filter-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'applications.md'), `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`);
    const pipeline = join(dir, 'data', 'pipeline.md');
    const scanHistory = join(dir, 'data', 'scan-history.tsv');
    writeFileSync(pipeline, '# Pipeline\n\n');
    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, portalsContent);
    const stdout = execFileSync(NODE, [join(ROOT, 'scan.mjs')], {
      cwd: dir,
      env: {
        ...process.env,
        CAREER_OPS_ROOT: dir,
        CAREER_OPS_DATA_DIR: '',
        CAREER_OPS_PORTALS: portals,
        CAREER_OPS_PIPELINE: pipeline,
        CAREER_OPS_SCAN_HISTORY: scanHistory,
      },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const urls = existsSync(pipeline)
      ? readFileSync(pipeline, 'utf-8').split('\n').filter(l => /^- \[[ x]\]\s+https?:\/\//.test(l))
      : [];
    return { stdout, urls };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Under OS temp directory; handle locks on Windows should never crash the test suite
    }
  }
}

const kept = urls => [1, 2, 3, 4].filter(n => urls.some(u => u.includes(`/jobs/${n}`)));

// 1. Global title_filter only: applies to entry without its own.
{
  const portals = `title_filter:
  positive:
    - "Software"
tracked_companies:
  - name: Global Only Board
    careers_url: https://example.invalid/jobs
    parser:
      command: node
      script: tests/fixtures/title-filter-board.mjs
`;
  const { stdout, urls } = runScan(portals);
  if (JSON.stringify(kept(urls)) === '[2]') {
    pass('the global title_filter applies to an entry without its own');
  } else {
    fail(`expected only job 2 (Software Engineer), got ${JSON.stringify(urls)}`);
  }
  if (/Filtered by title:\s+3 removed/.test(stdout)) {
    pass('title filter rejection count is accurate in summary');
  } else {
    fail(`expected "Filtered by title: 3 removed":\n${stdout}`);
  }
}

// 2. An entry's title_filter replaces global positives and keeps only what it specifies.
{
  const portals = `title_filter:
  positive:
    - "Software"
tracked_companies:
  - name: Library Board
    careers_url: https://example.invalid/jobs
    title_filter:
      positive:
        - "Librarian"
    parser:
      command: node
      script: tests/fixtures/title-filter-board.mjs
`;
  const { urls } = runScan(portals);
  if (JSON.stringify(kept(urls)) === '[4]') {
    pass('per-entry title_filter replaces global positive list for that entry');
  } else {
    fail(`expected only job 4 (Librarian), got ${JSON.stringify(urls)}`);
  }
}

// 3. An entry whose title_filter targets a title dropped by global negative wins
//    for that entry only, because per-entry filter replaces global negatives (#7244 / @Schlaflied test).
{
  const portalsDefault = `title_filter:
  positive:
    - "Contract"
  negative:
    - "Compliance"
tracked_companies:
  - name: Default Board
    careers_url: https://example.invalid/jobs
    parser:
      command: node
      script: tests/fixtures/title-filter-board.mjs
`;
  const { urls: urlsDefault } = runScan(portalsDefault);
  // Default Board drops job 1 ("Contract Compliance Specialist") via global negative "Compliance"
  if (!urlsDefault.some(u => u.includes('/jobs/1')) && urlsDefault.some(u => u.includes('/jobs/3'))) {
    pass('global negative drops matching title for entry using global filter');
  } else {
    fail(`expected job 1 dropped by global negative, got: ${JSON.stringify(urlsDefault)}`);
  }

  const portalsOverride = `title_filter:
  positive:
    - "Contract"
  negative:
    - "Compliance"
tracked_companies:
  - name: Override Board
    careers_url: https://example.invalid/jobs
    title_filter:
      positive:
        - "Contract"
    parser:
      command: node
      script: tests/fixtures/title-filter-board.mjs
`;
  const { urls: urlsOverride } = runScan(portalsOverride);
  // Override Board replaces global negatives with its own (none), so it keeps job 1
  if (urlsOverride.some(u => u.includes('/jobs/1')) && urlsOverride.some(u => u.includes('/jobs/3'))) {
    pass('per-entry title_filter replaces global negative list for that entry only');
  } else {
    fail(`expected job 1 and 3 kept by override board, got: ${JSON.stringify(urlsOverride)}`);
  }
}

// 4. Per-entry title_filter respects its own negative list.
{
  const portals = `title_filter:
  positive:
    - "Contract"
tracked_companies:
  - name: Negative Override Board
    careers_url: https://example.invalid/jobs
    title_filter:
      positive:
        - "Contract"
      negative:
        - "Senior"
    parser:
      command: node
      script: tests/fixtures/title-filter-board.mjs
`;
  const { urls } = runScan(portals);
  // Job 1 is kept ("Contract Compliance Specialist"), Job 3 ("Senior Contract Developer") is dropped by entry negative.
  if (JSON.stringify(kept(urls)) === '[1]') {
    pass('per-entry negative filter drops matching titles');
  } else {
    fail(`expected only job 1, got ${JSON.stringify(urls)}`);
  }
}

// 5. Misspelled key in entry title_filter (e.g. positve:) is rejected at startup.
{
  const portals = `title_filter:
  positive:
    - "Software"
tracked_companies:
  - name: Bad Entry Board
    careers_url: https://example.invalid/jobs
    title_filter:
      positve:
        - "Librarian"
    parser:
      command: node
      script: tests/fixtures/title-filter-board.mjs
`;
  try {
    runScan(portals);
    fail('expected invalid title_filter key to be rejected');
  } catch (err) {
    const stderr = String(err.stderr ?? '') + String(err.stdout ?? '');
    if (/title_filter\.positve is not a recognized key/.test(stderr)) {
      pass('an unknown key in entry title_filter is rejected by name');
    } else {
      fail(`expected config error for title_filter.positve, got:\n${stderr}`);
    }
  }
}

// 6. content_filter.rescue_title_misses reads the entry's own negative filter.
{
  const portals = `title_filter:
  positive:
    - "Software"
  negative:
    - "Specialist"
content_filter:
  rescue_title_misses: true
  positive:
    - "Procurement"
tracked_companies:
  - name: Entry Rescue Board
    careers_url: https://example.invalid/jobs
    title_filter:
      positive:
        - "Developer"
    parser:
      command: node
      script: tests/fixtures/title-filter-board.mjs
`;
  const { urls } = runScan(portals);
  // Job 1: "Contract Compliance Specialist", description: "Procurement role".
  // The entry filter has positive: ["Developer"] (which misses Job 1) and no negatives.
  // Since the entry filter replaces global negatives, "Specialist" does not veto Job 1.
  // With rescue_title_misses: true, description matches "Procurement" -> rescued!
  if (urls.some(u => u.includes('/jobs/1'))) {
    pass('content_filter.rescue_title_misses reads the entry filter negatives to gate rescue');
  } else {
    fail(`expected job 1 to be rescued under entry filter, got: ${JSON.stringify(urls)}`);
  }
}

// 7. content_filter.by_title_keyword reads the entry's own matched title keywords.
{
  const portals = `title_filter:
  positive:
    - "Software"
content_filter:
  positive:
    - "development"
  by_title_keyword:
    Developer:
      positive:
        - "MissingKeyword"
tracked_companies:
  - name: Entry ByTitleKeyword Board
    careers_url: https://example.invalid/jobs
    title_filter:
      positive:
        - "Developer"
    parser:
      command: node
      script: tests/fixtures/title-filter-board.mjs
`;
  const { urls } = runScan(portals);
  // Job 3: "Senior Contract Developer", description: "Contract development".
  // Matches entry positive keyword "Developer".
  // by_title_keyword["Developer"] demands "MissingKeyword" in description.
  // Description lacks it -> dropped by content filter!
  if (!urls.some(u => u.includes('/jobs/3'))) {
    pass('matchedTitleKeywords reads entry positive keywords to scope content_filter.by_title_keyword');
  } else {
    fail(`expected job 3 to be dropped by by_title_keyword scoped to entry keyword "Developer", got: ${JSON.stringify(urls)}`);
  }
}

// 8. An entry with negatives but no positives keeps the global positives (#7244).
{
  const portals = `title_filter:
  positive:
    - "Software"
tracked_companies:
  - name: Negative Only Board
    careers_url: https://example.invalid/jobs
    title_filter:
      negative:
        - "Contract"
    parser:
      command: node
      script: tests/fixtures/title-filter-board.mjs
`;
  const { urls } = runScan(portals);
  // Keeps job 2 ("Software Engineer") matching global positive.
  // Does NOT keep job 4 ("Librarian") or job 1 ("Contract Compliance Specialist"),
  // proving it did not match every title and preserved global positives.
  if (JSON.stringify(kept(urls)) === '[2]') {
    pass('an entry with negatives but no positives keeps the global positives');
  } else {
    fail(`expected only job 2, got ${JSON.stringify(urls)}`);
  }
}

// 9. An entry with negatives only drops matching titles while keeping global positives.
{
  const portals = `title_filter:
  positive:
    - "Software"
tracked_companies:
  - name: Negative Drop Board
    careers_url: https://example.invalid/jobs
    title_filter:
      negative:
        - "Engineer"
    parser:
      command: node
      script: tests/fixtures/title-filter-board.mjs
`;
  const { urls } = runScan(portals);
  if (urls.length === 0) {
    pass('an entry with negatives only drops matching titles while keeping global positives');
  } else {
    fail(`expected 0 jobs kept, got ${JSON.stringify(urls)}`);
  }
}

// 10. An entry whose positive list holds only empty/blank strings falls back to global positives.
{
  const portals = `title_filter:
  positive:
    - "Software"
tracked_companies:
  - name: Blank Positives Board
    careers_url: https://example.invalid/jobs
    title_filter:
      positive:
        - ""
        - "   "
      negative:
        - "Contract"
    parser:
      command: node
      script: tests/fixtures/title-filter-board.mjs
`;
  const { urls } = runScan(portals);
  // Keeps job 2 ("Software Engineer") by falling back to global positive "Software".
  // Drops job 4 ("Librarian") because global positives are kept.
  if (JSON.stringify(kept(urls)) === '[2]') {
    pass('an entry with blank-string positives falls back to global positives');
  } else {
    fail(`expected only job 2, got ${JSON.stringify(urls)}`);
  }
}

// 11. An entry with blank-only positives and NO negatives falls back to global positives (#7244).
{
  const portals = `title_filter:
  positive:
    - "Software"
tracked_companies:
  - name: Blank Positives No Negatives Board
    careers_url: https://example.invalid/jobs
    title_filter:
      positive:
        - ""
        - "   "
    parser:
      command: node
      script: tests/fixtures/title-filter-board.mjs
`;
  const { urls } = runScan(portals);
  // Keeps job 2 ("Software Engineer") by falling back to global positive "Software".
  // Drops job 4 ("Librarian"), job 1 ("Contract Compliance Specialist"), and job 3 ("Senior Contract Developer")
  // because global positives are kept (proving it did not match every title).
  if (JSON.stringify(kept(urls)) === '[2]') {
    pass('an entry with blank-only positives and no negatives falls back to global positives');
  } else {
    fail(`expected only job 2, got ${JSON.stringify(urls)}`);
  }
}





