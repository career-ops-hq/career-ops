import { strict as assert } from 'assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { checkJdArchive } from '../check-jd-archive.mjs';
import { pass, fail } from './helpers.mjs';

const root = mkdtempSync(join(tmpdir(), 'check-jd-archive-reserved-'));
const reportsDir = join(root, 'reports');
const jdsDir = join(root, 'jds');
const trackerPath = join(root, 'applications.md');

try {
  mkdirSync(reportsDir, { recursive: true });
  mkdirSync(jdsDir, { recursive: true });
  writeFileSync(
    join(reportsDir, '042-RESERVED.md'),
    JSON.stringify({ pid: 1234, token: 'fixture', created_at: '2026-09-11T00:00:00.000Z' }),
  );
  writeFileSync(
    join(reportsDir, 'hand-named-report.md'),
    '# Evaluation: Weyland — Analyst\n\n**URL:** https://example.com\n',
  );
  writeFileSync(trackerPath, [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
  ].join('\n'));

  const result = checkJdArchive(reportsDir, jdsDir, { trackerPath });

  assert.equal(result.reportsScanned, 1);
  assert.deepEqual(result.findings.map((finding) => finding.file), ['hand-named-report.md']);
  assert.equal(result.findings[0].type, 'jd-archive-review-due');
  pass('exact numeric reservation sentinel is ignored while a hand-named report remains checked');
} catch (error) {
  fail(error.stack || error.message);
} finally {
  rmSync(root, { recursive: true, force: true });
}
