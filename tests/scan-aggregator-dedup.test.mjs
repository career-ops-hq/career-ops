// tests/scan-aggregator-dedup.test.mjs — `aggregator: true` reaches the scan.
//
// The intra-scan company+role dedup assumes "same company + same title = the
// same opening". A multi-employer feed names itself as the company, so on it
// that assumption drops real postings before repost analysis ever sees them:
// the second "Backend Engineer" from a Telegram channel is a different
// employer's job. On a flagged entry only the URL may dedup.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

console.log('\nscan.mjs — aggregator entries keep same-titled postings');

function scanPipelineEntries(aggregator) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-aggregator-'));
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
    - "Backend"
tracked_companies:
  - name: Fixture Feed
    careers_url: https://t.me/s/fixturejobs
${aggregator ? '    aggregator: true\n' : ''}    parser:
      command: node
      script: tests/fixtures/same-title-board.mjs
`);
    execFileSync(NODE, [join(ROOT, 'scan.mjs')], {
      cwd: dir,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: portals },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const p = join(dir, 'data', 'pipeline.md');
    return existsSync(p) ? readFileSync(p, 'utf-8').split('\n').filter(l => /^- \[[ x]\]\s+https?:\/\//.test(l)) : [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

try {
  const flagged = scanPipelineEntries(true);
  if (flagged.length === 2) pass('aggregator: true keeps both same-titled postings (the URL is the only dedup key)');
  else fail(`aggregator entry yielded ${flagged.length} pipeline entr(y/ies), want 2: ${JSON.stringify(flagged)}`);

  const plain = scanPipelineEntries(false);
  if (plain.length === 1) pass('without the flag the company+role dedup still collapses them to one');
  else fail(`plain entry yielded ${plain.length} pipeline entr(y/ies), want 1: ${JSON.stringify(plain)}`);
} catch (err) {
  fail(`e2e scan run failed: ${err.message}`);
}
