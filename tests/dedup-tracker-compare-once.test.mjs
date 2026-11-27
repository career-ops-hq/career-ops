// tests/dedup-tracker-compare-once.test.mjs — dedup compares each row's
// company key and posting-language key once, not once per pair.
//
// The pair loop used to rebuild both keys on every comparison. A company key
// is a Unicode normalize, and a posting key parses the URL. On a few thousand
// rows that share a bucket those two dominate the run, and the answer does
// not change between pairs. CAREER_OPS_DEDUP_STATS=1 prints the counts so
// this can fail when a later edit puts the work back inside the loop.
// The line is absent without that cache, which is the failure this file pins.

import { pass, fail, rmSync } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEDUP = join(HERE, '..', 'dedup-tracker.mjs');
let localFailed = 0;
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { localFailed++; fail(`${name} — ${e.message}`); } };

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEP = '|---|---|---|---|---|---|---|---|---|';

function reportDoc(url) {
  return `# Fernhollow Labs — Analytics Engineer\n\n**Score:** 4.0/5 | **URL:** ${url} | **Legitimacy:** High\n`;
}

function runDedup(rows, reports) {
  const root = mkdtempSync(join(tmpdir(), 'dedup-compare-once-'));
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    mkdirSync(join(root, 'reports'), { recursive: true });
    for (const [name, url] of Object.entries(reports)) {
      writeFileSync(join(root, 'reports', name), reportDoc(url));
    }
    writeFileSync(join(root, 'data', 'applications.md'), ['# Applications Tracker', '', HEADER, SEP, ...rows, ''].join('\n'));
    const res = spawnSync(process.execPath, [DEDUP, '--dry-run'], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CAREER_OPS_ROOT: root,
        CAREER_OPS_TRACKER: '',
        CAREER_OPS_DATA_DIR: '',
        CAREER_OPS_DEDUP_STATS: '1',
      },
    });
    assert.strictEqual(res.status, 0, `dedup exited ${res.status}: ${res.stderr}`);
    const line = (res.stderr || '').split('\n').find((l) => l.startsWith('dedup-stats '));
    assert.ok(line, `missing dedup-stats line in stderr: ${res.stderr}`);
    const parsed = Object.fromEntries(line.slice('dedup-stats '.length).split(' ').map((part) => {
      const [k, v] = part.split('=');
      return [k, Number(v)];
    }));
    return { stdout: res.stdout, stats: parsed };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('\ndedup-tracker — company and posting keys are built once per row');

ok('forty same-company rows with distinct report URLs build each key once and remove nothing', () => {
  const rows = [];
  const reports = {};
  for (let n = 1; n <= 40; n++) {
    const file = `${String(n).padStart(3, '0')}-fernhollow.md`;
    rows.push(`| ${n} | 2026-10-01 | Fernhollow Labs | Analytics Engineer | 4.0/5 | Evaluated | ❌ | [${n}](../reports/${file}) |  |`);
    reports[file] = `https://boards.example.com/fernhollow/jobs/${1000 + n}`;
  }
  const { stdout, stats } = runDedup(rows, reports);
  assert.strictEqual(stats.normalizes, 40, `company keys built ${stats.normalizes} times, want 40`);
  assert.strictEqual(stats.urlKeys, 40, `posting keys built ${stats.urlKeys} times, want 40`);
  assert.strictEqual(stats.pairs, 780, `pairs compared ${stats.pairs}, want 780`);
  assert.match(stdout, /📊 0 duplicates removed/);
});

ok('two rows that name one posting still merge, and each key is built once', () => {
  const url = 'https://boards.example.com/fernhollow/jobs/1001';
  const { stdout, stats } = runDedup(
    [
      '| 1 | 2026-10-01 | Fernhollow Labs | Analytics Engineer | 4.2/5 | Evaluated | ❌ | [1](../reports/001-fernhollow.md) |  |',
      '| 2 | 2026-10-02 | Fernhollow Labs | Analytics Engineer | 3.8/5 | Evaluated | ❌ | [2](../reports/002-fernhollow.md) |  |',
    ],
    { '001-fernhollow.md': url, '002-fernhollow.md': url },
  );
  assert.strictEqual(stats.normalizes, 2, `company keys built ${stats.normalizes} times, want 2`);
  assert.strictEqual(stats.urlKeys, 2, `posting keys built ${stats.urlKeys} times, want 2`);
  assert.strictEqual(stats.pairs, 1, `pairs compared ${stats.pairs}, want 1`);
  assert.match(stdout, /📊 1 duplicates removed/);
});

ok('a row that never meets another does not read a posting key', () => {
  const { stdout, stats } = runDedup(
    ['| 1 | 2026-10-01 | Fernhollow Labs | Analytics Engineer | 4.0/5 | Evaluated | ❌ | [1](../reports/001-fernhollow.md) |  |'],
    { '001-fernhollow.md': 'https://boards.example.com/fernhollow/jobs/1001' },
  );
  assert.strictEqual(stats.normalizes, 1, `company keys built ${stats.normalizes} times, want 1`);
  assert.strictEqual(stats.urlKeys, 0, `posting keys built ${stats.urlKeys} times, want 0`);
  assert.strictEqual(stats.pairs, 0, `pairs compared ${stats.pairs}, want 0`);
  assert.match(stdout, /📊 0 duplicates removed/);
});

if (localFailed > 0) process.exitCode = 1;
