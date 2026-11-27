import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScore } from '../tracker-parse.mjs';
import { parseScore as notionParseScore } from '../plugins/notion/index.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('a fullwidth score is the number in front of the slash', () => {
  assert.equal(parseScore('４.２/5'), 4.2);
  assert.equal(parseScore('１.０/5'), 1);
  assert.equal(parseScore('4.2/5'), 4.2);
  assert.equal(parseScore('4,2/5'), 4.2);
  assert.equal(parseScore('**4.2/5**'), 4.2);
  assert.equal(notionParseScore('４.２/5'), 4.2);
  assert.equal(notionParseScore('4.2/5'), 4.2);
});

test('dedup keeps the higher ASCII score when the other cell is fullwidth', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-fullwidth-score-'));
  const tracker = join(dir, 'applications.md');
  try {
    writeFileSync(tracker, [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 1 | 2026-03-02 | Fixture Co | Engineer | 4.8/5 | Evaluated | ❌ | — | |',
      '| 2 | 2026-03-03 | Fixture Co | Engineer | ４.２/5 | Evaluated | ❌ | — | |',
      '',
    ].join('\n'));
    execFileSync(process.execPath, [join(ROOT, 'dedup-tracker.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_TRACKER: tracker },
    });
    const rows = readFileSync(tracker, 'utf8').split('\n').filter((line) => /^\|\s*\d+\s*\|/.test(line));
    assert.equal(rows.length, 1);
    assert.match(rows[0], /4\.8\/5/);
    assert.doesNotMatch(rows[0], /４/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
