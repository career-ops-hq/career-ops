// merge-tracker must still merge when templates/states.yml is missing (#3561).
//
// The canonical states load at startup, so a broken install used to kill the
// run on a raw ENOENT. It now warns once and keeps each status as written:
// never an "Evaluated" the row did not claim.
//
// states.yml resolves beside the script (System Layer), so the only way to take
// it away without touching the checkout is a throwaway code root: the flat
// scripts plus lib/, node_modules linked (as in verifiers-plugin-providers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { linkNodeModules } from './helpers.mjs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';
import { extractCellUrl } from '../tracker-parse.mjs';

function postingHref(row) {
  const cells = row.split('|').map(s => s.trim());
  return extractCellUrl(cells[cells.length - 2] ?? '');
}

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('merge-tracker merges with the status as written when templates/states.yml is missing', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'career-ops-no-states-'));
  try {
    const codeRoot = join(tmp, 'code');
    const dataRoot = join(tmp, 'user');
    mkdirSync(codeRoot, { recursive: true });
    for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
      if (entry.isFile() && /\.(mjs|json)$/.test(entry.name)) cpSync(join(ROOT, entry.name), join(codeRoot, entry.name));
    }
    cpSync(join(ROOT, 'lib'), join(codeRoot, 'lib'), { recursive: true });
    // linkNodeModules() rather than a raw symlinkSync: a bare call leaves a
    // dangling link when the tree is absent, so merge-tracker dies at module
    // load and every assertion below passes vacuously. The helper returns a
    // reason instead, and makes a junction on Windows where a 'dir' link needs
    // a privilege a normal shell lacks.
    const depsReason = linkNodeModules(codeRoot, ROOT);
    if (depsReason) return t.skip(depsReason);
    // No templates/ at all: neither states.yml candidate exists.

    const tracker = join(dataRoot, 'data', 'applications.md');
    mkdirSync(dirname(tracker), { recursive: true });
    mkdirSync(join(dataRoot, 'batch', 'tracker-additions'), { recursive: true });
    writeFileSync(tracker, [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 1 | 2026-01-01 | Acme | PM | 4.0/5 | Evaluated | ❌ | — | seeded |',
      '',
    ].join('\n'));
    writeFileSync(join(dataRoot, 'batch', 'tracker-additions', '002-globex.tsv'),
      '2\t2026-01-02\tGlobex\tEngineer\tApplied\t4.1/5\t❌\t—\tqueued\n');

    const env = { ...process.env, CAREER_OPS_ROOT: dataRoot };
    for (const k of ['CAREER_OPS_DATA_DIR', 'CAREER_OPS_TRACKER', 'CAREER_OPS_ADDITIONS', 'CAREER_OPS_BATCH_STATE']) delete env[k];
    const r = spawnSync(process.execPath, [join(codeRoot, 'merge-tracker.mjs'), '--allow-headerless'], {
      cwd: tmp, env, encoding: 'utf-8', timeout: 60_000,
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;

    assert.equal(r.status, 0, describeSpawn(r, `merge-tracker died without states.yml:\n${out}`));
    assert.match(out, /Cannot read canonical states/, 'the broken install must be reported');
    const row = readFileSync(tracker, 'utf-8').split('\n').find(l => l.includes('Globex'));
    assert.ok(row, `the addition was not merged:\n${out}`);
    assert.match(row, /\|\s*Applied\s*\|/, `status was rewritten instead of kept: ${row}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('an Applied row keeps its posting when templates/states.yml is missing', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'career-ops-no-states-applied-'));
  try {
    const codeRoot = join(tmp, 'code');
    const dataRoot = join(tmp, 'user');
    mkdirSync(codeRoot, { recursive: true });
    for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
      if (entry.isFile() && /\.(mjs|json)$/.test(entry.name)) cpSync(join(ROOT, entry.name), join(codeRoot, entry.name));
    }
    cpSync(join(ROOT, 'lib'), join(codeRoot, 'lib'), { recursive: true });
    const depsReason = linkNodeModules(codeRoot, ROOT);
    if (depsReason) return t.skip(depsReason);

    const tracker = join(dataRoot, 'data', 'applications.md');
    mkdirSync(dirname(tracker), { recursive: true });
    mkdirSync(join(dataRoot, 'batch', 'tracker-additions'), { recursive: true });
    const appliedUrl = 'https://www.linkedin.com/jobs/view/4001';
    const incomingUrl = 'https://boards.greenhouse.io/fixtureco/jobs/9001';
    writeFileSync(tracker, [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|-----|',
      `| 1 | 2026-06-01 | Fixture Co | Director of Marketing | 4.6/5 | **Applied** | ❌ | [1](reports/1-fixture.md) | n | ${appliedUrl} |`,
      '| 3 | 2026-06-02 | Fixture Co | Director of Marketing | 3.0/5 | Evaluated | ❌ | [3](reports/3-fixture.md) | n | — |',
      '',
    ].join('\n'));
    writeFileSync(join(dataRoot, 'batch', 'tracker-additions', '002-fixture.tsv'),
      `2\t2026-06-03\tFixture Co\tDirector of Marketing\tEvaluated\t3.4/5\t❌\t[2](reports/2-fixture.md)\tn\t${incomingUrl}\n`);

    const env = { ...process.env, CAREER_OPS_ROOT: dataRoot };
    for (const k of ['CAREER_OPS_DATA_DIR', 'CAREER_OPS_TRACKER', 'CAREER_OPS_ADDITIONS', 'CAREER_OPS_BATCH_STATE']) delete env[k];
    const r = spawnSync(process.execPath, [join(codeRoot, 'merge-tracker.mjs'), '--allow-headerless'], {
      cwd: tmp, env, encoding: 'utf-8', timeout: 60_000,
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    assert.equal(r.status, 0, describeSpawn(r, `merge-tracker died without states.yml:\n${out}`));

    const rows = readFileSync(tracker, 'utf-8').split('\n').filter(l => l.startsWith('|') && !l.includes('---') && !/\|\s*#\s*\|/.test(l));
    assert.equal(rows.length, 2, `the Evaluated row is updated, not a new row:\n${rows.join('\n')}\n${out}`);
    const applied = rows.find(l => l.includes('**Applied**'));
    assert.ok(applied, `no Applied row:\n${rows.join('\n')}`);
    assert.equal(postingHref(applied), appliedUrl, `the Applied row was retargeted: ${applied}`);
    const evaluated = rows.find(l => /\|\s*3\s*\|/.test(l));
    assert.ok(evaluated, `no Evaluated row:\n${rows.join('\n')}`);
    assert.equal(postingHref(evaluated), incomingUrl, `the Evaluated row was not updated: ${evaluated}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
