// tests/ledger-append-newline.test.mjs — an append-only ledger whose last row has
// no trailing newline must not swallow the next row.
//
// scan-history.tsv, scan-runs.tsv, portal-health.tsv, status-log.tsv and
// coverage-misses.tsv are appended to with a bare appendFileSync. A file saved
// by an editor that drops the final newline then took the new row on the same
// line: the old row's last cell grew by the new row's first cell, and the new
// row never existed. Every reader skips a malformed line quietly, so the loss
// was invisible (a posting seen again as new, a status transition missing from
// the funnel). agent-inbox.mjs and assessment-log.mjs already start such an
// append on a fresh line; the other ledgers now do the same.
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };
const href = (m) => pathToFileURL(join(ROOT, m)).href;
const lines = (s) => s.split('\n').filter(Boolean);

const root = mkdtempSync(join(tmpdir(), 'ledger-newline-'));
const dataDir = join(root, 'data');
mkdirSync(dataDir, { recursive: true });

function node(script) {
  const r = spawnSync(NODE, ['--input-type=module', '-e', script], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: '' },
  });
  if (r.status !== 0) throw new Error(`child failed: ${r.stderr.trim().split('\n').pop()}`);
  return r.stdout;
}

try {
  ok('appendLedgerRows closes an unterminated last row first', () => {
    const f = join(root, 'plain.tsv');
    writeFileSync(f, 'a\tb\nc\td');
    node(`import { appendLedgerRows } from '${href('tracker-utils.mjs')}'; appendLedgerRows(${JSON.stringify(f)}, 'e\\tf\\n');`);
    assert.equal(readFileSync(f, 'utf-8'), 'a\tb\nc\td\ne\tf\n');
  });

  ok('a failed append puts the ledger back to the size it had before', () => {
    const f = join(root, 'rollback.tsv');
    writeFileSync(f, 'kept\n');
    // A permission error fails before any byte is written, so the file staying
    // put does not by itself show the rollback. The child below writes the new
    // row and then throws, which is the close-failed case. The refusal is
    // injected: chmod does not withhold read on Windows, and a privileged
    // process can ignore the mode.
    const denied = spawnSync(NODE, ['--experimental-test-module-mocks', '--input-type=module', '-e', `
      import { mock } from 'node:test';
      import * as fs from 'node:fs';
      const realAppend = fs.appendFileSync;
      mock.module('fs', { namedExports: { ...fs, appendFileSync(path, data, enc) {
        if (String(path).endsWith('rollback.tsv')) {
          const err = new Error('EACCES: permission denied');
          err.code = 'EACCES';
          throw err;
        }
        return realAppend(path, data, enc);
      } } });
      const { appendLedgerRows } = await import('${href('tracker-utils.mjs')}');
      appendLedgerRows(${JSON.stringify(f)}, 'new\\n');
    `], { cwd: root, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: '' } });
    assert.ok(exitedNonZero(denied), describeSpawn(denied, 'a read-only ledger must fail the append'));
    assert.equal(readFileSync(f, 'utf-8'), 'kept\n');

    const child = spawnSync(NODE, ['--experimental-test-module-mocks', '--input-type=module', '-e', `
      import { mock } from 'node:test';
      import * as fs from 'node:fs';
      const real = fs.appendFileSync;
      mock.module('fs', { namedExports: { ...fs, appendFileSync(path, data, enc) {
        real(path, data, enc);
        throw new Error('close failed');
      } } });
      const { appendLedgerRows } = await import('${href('tracker-utils.mjs')}');
      try {
        appendLedgerRows(${JSON.stringify(f)}, 'new\\n');
        console.log('NO_THROW');
      } catch (err) {
        console.log('THREW ' + err.message);
      }
    `], { cwd: root, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: '' } });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /THREW close failed/);
    assert.equal(readFileSync(f, 'utf-8'), 'kept\n');
  });

  ok('a ledger that cannot be read is left untouched', () => {
    const f = join(root, 'write-only.tsv');
    writeFileSync(f, 'kept\n');
    // Open is refused here. chmod 0o222 still leaves the file readable on
    // Windows, so a mode bit would not exercise this branch.
    const denied = spawnSync(NODE, ['--experimental-test-module-mocks', '--input-type=module', '-e', `
      import { mock } from 'node:test';
      import * as fs from 'node:fs';
      const realOpen = fs.openSync;
      mock.module('fs', { namedExports: { ...fs, openSync(path, flag) {
        if (String(path).endsWith('write-only.tsv')) {
          const err = new Error('EACCES: permission denied');
          err.code = 'EACCES';
          throw err;
        }
        return realOpen(path, flag);
      } } });
      const { appendLedgerRows } = await import('${href('tracker-utils.mjs')}');
      appendLedgerRows(${JSON.stringify(f)}, 'new\\n');
    `], { cwd: root, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: '' } });
    assert.ok(exitedNonZero(denied), describeSpawn(denied, 'a write-only ledger must fail before the append'));
    assert.match(`${denied.stderr}\n${denied.stdout}`, /EACCES/);
    assert.equal(readFileSync(f, 'utf-8'), 'kept\n');
  });

  ok('a failed restore is reported', () => {
    const f = join(root, 'restore-fails.tsv');
    writeFileSync(f, 'kept\n');
    const child = spawnSync(NODE, ['--experimental-test-module-mocks', '--input-type=module', '-e', `
      import { mock } from 'node:test';
      import * as fs from 'node:fs';
      const realAppend = fs.appendFileSync;
      mock.module('fs', { namedExports: { ...fs,
        appendFileSync(path, data, enc) {
          realAppend(path, data, enc);
          const err = new Error('close failed');
          err.code = 'EIO';
          throw err;
        },
        truncateSync() {
          const err = new Error('truncate failed');
          err.code = 'EIO';
          throw err;
        },
      } });
      const { appendLedgerRows } = await import('${href('tracker-utils.mjs')}');
      try {
        appendLedgerRows(${JSON.stringify(f)}, 'new\\n');
        console.log('NO_THROW');
      } catch (err) {
        console.log('THREW ' + err.message);
      }
    `], { cwd: root, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: '' } });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /could not be put back/);
    assert.match(readFileSync(f, 'utf-8'), /^kept\nnew\n$/);
  });

  ok('appendLedgerRows leaves a terminated, CRLF, empty or missing file alone', () => {
    const cases = {
      terminated: ['a\n', 'a\nx\n'],
      crlf: ['a\r\n', 'a\r\nx\n'],
      empty: ['', 'x\n'],
      missing: [null, 'x\n'],
    };
    for (const [label, [before, after]] of Object.entries(cases)) {
      const f = join(root, `${label}.tsv`);
      if (before !== null) writeFileSync(f, before);
      node(`import { appendLedgerRows } from '${href('tracker-utils.mjs')}'; appendLedgerRows(${JSON.stringify(f)}, 'x\\n');`);
      assert.equal(readFileSync(f, 'utf-8'), after, label);
    }
  });

  ok('scan-history: the new row lands on its own line', () => {
    const f = join(dataDir, 'scan-history.tsv');
    writeFileSync(f, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n'
      + 'https://boards.greenhouse.io/acme/jobs/1\t2026-09-01\tgreenhouse\tEngineer\tAcme\tadded\tRemote');
    node(`import { appendToScanHistory } from '${href('scan.mjs')}';
      await appendToScanHistory([{ url: 'https://boards.greenhouse.io/beta/jobs/2', source: 'greenhouse', title: 'Dev', company: 'Beta', location: 'Berlin' }], '2026-10-10', 'added');`);
    const rows = lines(readFileSync(f, 'utf-8')).slice(1).map(l => l.split('\t'));
    assert.equal(rows.length, 2, 'two data rows, not one fused row');
    assert.equal(rows[0][6], 'Remote', 'the earlier row is intact');
    assert.equal(rows[1][0], 'https://boards.greenhouse.io/beta/jobs/2');
  });

  ok('status-log: set-status appends its transition on its own line', () => {
    const tracker = join(dataDir, 'applications.md');
    writeFileSync(tracker, '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n'
      + '|---|------|---------|------|-------|--------|-----|--------|-------|\n'
      + '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | — | n |\n');
    const log = join(dataDir, 'status-log.tsv');
    writeFileSync(log, '7\t2026-01-05\t-\tEvaluated\tcorrection\t');
    const r = spawnSync(NODE, [join(ROOT, 'set-status.mjs'), '--row', '1', 'Applied'], {
      cwd: root, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: '' },
    });
    assert.equal(r.status, 0, describeSpawn(r));
    const rows = lines(readFileSync(log, 'utf-8')).map(l => l.split('\t'));
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].slice(0, 5), ['7', '2026-01-05', '-', 'Evaluated', 'correction']);
    assert.deepEqual([rows[1][0], rows[1][2], rows[1][3]], ['1', 'Evaluated', 'Applied']);
  });

  ok('scan-runs and portal-health: the new row lands on its own line', () => {
    const runs = join(dataDir, 'scan-runs.tsv');
    const health = join(dataDir, 'portal-health.tsv');
    node(`import { SCAN_RUNS_HEADER, appendScanRunSummary, appendPortalHealth } from '${href('scan.mjs')}';
      import { writeFileSync } from 'node:fs';
      writeFileSync(${JSON.stringify(runs)}, SCAN_RUNS_HEADER + '2026-07-01T00:00:00Z\\tcompleted');
      appendScanRunSummary({ timestamp: '2026-07-02T00:00:00Z', companies: 1, boards: 1, found: 1, newAdded: 1 }, ${JSON.stringify(runs)});
      writeFileSync(${JSON.stringify(health)}, 'timestamp\\tcompany\\tstatus\\n2026-07-01\\tAcme\\treachable');
      await appendPortalHealth([{ timestamp: '2026-07-02', company: 'Beta', status: 'reachable' }], ${JSON.stringify(health)});`);
    const runRows = lines(readFileSync(runs, 'utf-8')).slice(1);
    assert.equal(runRows.length, 2);
    assert.ok(runRows[1].startsWith('2026-07-02T00:00:00Z\tcompleted'));
    assert.deepEqual(lines(readFileSync(health, 'utf-8')).slice(1), ['2026-07-01\tAcme\treachable', '2026-07-02\tBeta\treachable']);
  });

  ok('coverage-misses: appendMiss starts the new row on its own line', () => {
    const f = join(dataDir, 'coverage-misses.tsv');
    writeFileSync(f, 'date\turl\tcompany\ttitle\tgap\tfix\tnote\n'
      + '2026-07-01\thttps://a.example/jobs/1\tAcme\tEngineer\tfilter\t-\tn');
    node(`import { appendMiss } from '${href('coverage-check.mjs')}';
      appendMiss(${JSON.stringify(f)}, { url: 'https://b.example/jobs/2', company: 'Beta', title: 'Dev' }, { gap: 'filter', fix: '-' }, 'n', '2026-10-10');`);
    const rows = lines(readFileSync(f, 'utf-8')).slice(1).map(l => l.split('\t'));
    assert.equal(rows.length, 2, 'two data rows, not one fused row');
    assert.equal(rows[0][2], 'Acme');
    assert.deepEqual(rows[1].slice(0, 3), ['2026-10-10', 'https://b.example/jobs/2', 'Beta']);
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}
