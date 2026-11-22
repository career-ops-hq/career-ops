// tests/scan-skip-tiers-per-entry.test.mjs — #5778 through the real scan.
//
// A tracked_companies / job_boards entry's own skip_tiers replaces the global
// list for that entry, and [] turns the tier filter off there. Runs scan.mjs
// against a local-parser board with one intern, one entry and one senior
// posting, and asserts on what reached the pipeline and on the summary line.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

console.log('\nscan.mjs — per-entry skip_tiers');

function runScan(globalTiers, entryExtra) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-tiers-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'applications.md'), `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`);
    writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n');
    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, `title_filter:
  positive:
    - "Software"
${globalTiers}tracked_companies:
  - name: Tier Board
    careers_url: https://example.invalid/jobs
${entryExtra}    parser:
      command: node
      script: tests/fixtures/tier-board.mjs
`);
    const stdout = execFileSync(NODE, [join(ROOT, 'scan.mjs')], {
      cwd: dir,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: portals },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const p = join(dir, 'data', 'pipeline.md');
    const urls = existsSync(p)
      ? readFileSync(p, 'utf-8').split('\n').filter(l => /^- \[[ x]\]\s+https?:\/\//.test(l))
      : [];
    return { stdout, urls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const kept = urls => [1, 2, 3].filter(n => urls.some(u => u.includes(`/jobs/${n}`)));

// Global list only: today's behaviour.
{
  const { stdout, urls } = runScan('skip_tiers: [intern, entry]\n', '');
  if (JSON.stringify(kept(urls)) === '[3]') pass('the global skip_tiers still applies to an entry without its own');
  else fail(`expected only the senior posting, got ${JSON.stringify(urls)}`);
  if (/Filtered by tier:\s+2 removed/.test(stdout)) pass('the global filter is counted in the summary');
  else fail(`expected "Filtered by tier: 2 removed":\n${stdout}`);
}

// An empty entry list turns the filter off for that entry.
{
  const { stdout, urls } = runScan('skip_tiers: [intern, entry]\n', '    skip_tiers: []\n');
  if (JSON.stringify(kept(urls)) === '[1,2,3]') pass('skip_tiers: [] on the entry keeps every tier');
  else fail(`expected all three postings, got ${JSON.stringify(urls)}`);
  if (/Filtered by tier:\s+0 removed/.test(stdout)) pass('the summary still reports the tier filter');
  else fail(`expected "Filtered by tier: 0 removed":\n${stdout}`);
}

// An entry list with no global one loads the classifier and filters.
{
  const { stdout, urls } = runScan('', '    skip_tiers: [senior]\n');
  if (JSON.stringify(kept(urls)) === '[1,2]') pass('an entry-only skip_tiers filters without a global list');
  else fail(`expected the intern and entry postings, got ${JSON.stringify(urls)}`);
  if (/Filtered by tier:\s+1 removed/.test(stdout)) pass('an entry-only list shows the tier summary line');
  else fail(`expected "Filtered by tier: 1 removed":\n${stdout}`);
}

// A value classifyTier never returns is a config error, not a silent no-op.
{
  try {
    runScan('', '    skip_tiers: [lead]\n');
    fail('expected skip_tiers: [lead] to be rejected');
  } catch (err) {
    const stderr = String(err.stderr ?? '') + String(err.stdout ?? '');
    if (/skip_tiers must be a list of intern, entry, mid, senior/.test(stderr)) pass('an unknown tier in an entry is rejected by name');
    else fail(`expected the skip_tiers config error, got:\n${stderr}`);
  }
}
