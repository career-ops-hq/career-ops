// tests/normalize-tabs.test.mjs — normalize-statuses.mjs must normalize a
// legacy tab-delimited tracker row in place, keeping its layout.
//
// The row loop called parseTrackerRow without { allowTabs: true } and rebuilt
// with line.split('|'), so a tab-layout tracker was silently skipped: its
// non-canonical statuses were never normalized. set-status.mjs and
// mark-pdf-ready.mjs already opted into the tab-aware parser; this pins the
// same for normalize, and pins that a tab row stays tab-delimited on the way
// out (a pipe-only writer must not migrate the layout as a side effect).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HEADER = '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n';

test('a tab-layout tracker normalizes in place and keeps its layout', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'normalize-tabs-'));
  try {
    mkdirSync(join(dataRoot, 'data'), { recursive: true });
    const apps = join(dataRoot, 'data', 'applications.md');
    // Canonical legacy shape: a pipe row whose inner separators are tabs
    // (the same construction tests/set-status-report-link.test.mjs parses).
    const tabRow = '|' + ['2', '2026-01-05', 'TabCo', 'Engineer', '4/5', 'applied', '❌', '—', 'seed'].join('\t') + '|';
    const pipeRow = '| 3 | 2026-01-05 | PipeCo | Engineer | 4/5 | applied | ❌ | — | seed |';
    writeFileSync(apps, HEADER + tabRow + '\n' + pipeRow + '\n');

    const r = spawnSync(process.execPath, [join(ROOT, 'normalize-statuses.mjs')], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
      env: { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_TRACKER: '' },
    });
    assert.equal(r.status, 0, `normalize-statuses exited ${r.status}\n${r.stdout}\n${r.stderr}`);

    const out = readFileSync(apps, 'utf-8');
    const outTab = out.split('\n').find((l) => l.includes('TabCo'));
    const outPipe = out.split('\n').find((l) => l.includes('PipeCo'));
    assert.ok(outTab, 'the tab row must still be there');
    assert.match(outTab, /\tApplied\t/, `tab row status must be canonical, got: ${outTab}`);
    assert.ok(!outTab.includes(' | '), `tab row must keep its tab layout, got: ${outTab}`);
    assert.equal(outPipe, '| 3 | 2026-01-05 | PipeCo | Engineer | 4/5 | Applied | ❌ | — | seed |', 'pipe row behavior unchanged');
    assert.ok(existsSync(apps + '.bak'), 'backup written as usual');
  } finally {
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
