import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { tryAcquireDirLockSync } from '../lib/dir-lock.mjs';
import { writeEvaluationArtifacts } from '../persist-evaluation-report.mjs';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const payload = {
  num: '035', today: '2026-10-22', company: 'Globex', role: 'Analyst', score: '4.2/5',
  reportFile: '035-globex-2026-10-22.md', markdown: '# New evaluation\n', notes: '',
};
const answers = fileURLToPath(new URL('../application-answers.mjs', import.meta.url));
const snapshot = { date: '2026-10-22', state: 'filled', freeText: [{ question: 'Why?', answer: 'Fictional answer' }] };
function fixture(fn) {
  const root = fs.mkdtempSync(join(tmpdir(), 'evaluation-review-'));
  try { fn(root, join(root, 'reports', payload.reportFile)); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

for (const partial of [false, true]) {
  test(`rollback works when birth time falls back to mutable ctime (partial=${partial})`, () => fixture((root, report) => {
    const descriptors = new Map();
    const metadata = (stat) => Object.assign(stat, { birthtimeNs: stat.ctimeNs });
    let generation = 1n;
    const result = writeEvaluationArtifacts(root, payload, {
      ...fs,
      openSync(file, ...args) { const fd = fs.openSync(file, ...args); descriptors.set(fd, file); return fd; },
      fstatSync(fd, options) { return Object.assign(metadata(fs.fstatSync(fd, options)), { birthtimeNs: generation }); },
      lstatSync(file, options) { return Object.assign(metadata(fs.lstatSync(file, options)), { birthtimeNs: generation }); },
      writeFileSync(file, content, ...args) {
        if ((descriptors.get(file) || file).endsWith('.tsv')) throw new Error('injected TSV failure');
        fs.writeFileSync(file, partial ? content.slice(0, 4) : content, ...args);
        generation++;
        if (partial) throw new Error('injected partial report failure');
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /injected/);
    assert.equal(fs.existsSync(report), false, 'our report must roll back after its own write changed ctime');
  }));
}

test('application-answers cannot edit a report while evaluation may roll it back', () => fixture((root, report) => {
  let attempted = false;
  const result = writeEvaluationArtifacts(root, payload, {
    ...fs,
    openSync(file, ...args) {
      if (String(file).endsWith('.tsv')) {
        attempted = true;
        const peer = spawnSync(process.execPath, [answers, '--report', report, '--input', '-'], {
          input: JSON.stringify(snapshot), encoding: 'utf8', timeout: 10_000,
        });
        assert.equal(peer.error, undefined);
        assert.ok(exitedNonZero(peer), describeSpawn(peer, 'the peer must refuse rather than save answers that rollback deletes'));
        assert.match(peer.stderr, /report is busy/);
        assert.equal(fs.readFileSync(report, 'utf8'), payload.markdown);
        throw new Error('injected TSV open failure');
      }
      return fs.openSync(file, ...args);
    },
  });
  assert.ok(attempted);
  assert.equal(result.ok, false);
  assert.match(result.error, /injected TSV open failure/);
  assert.equal(fs.existsSync(report), false);
  assert.equal(fs.existsSync(report + '.lock'), false, 'failed persistence releases the lock');
  assert.equal(writeEvaluationArtifacts(root, payload).ok, true, 'a retry succeeds');
  const peer = spawnSync(process.execPath, [answers, '--report', report, '--input', '-'], {
    input: JSON.stringify(snapshot), encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(peer.status, 0, peer.stderr);
  assert.match(fs.readFileSync(report, 'utf8'), /Fictional answer/);
  assert.equal(fs.existsSync(report + '.lock'), false);
}));

test('evaluation refuses a report whose answers writer already holds the lock', () => fixture((root, report) => {
  const lock = tryAcquireDirLockSync(report + '.lock', { staleMs: 30_000, createParent: true });
  assert.ok(lock);
  try {
    const result = writeEvaluationArtifacts(root, payload);
    assert.equal(result.ok, false);
    assert.match(result.error, /report is busy/);
    assert.equal(fs.existsSync(report), false);
    assert.equal(fs.existsSync(join(root, 'batch', 'tracker-additions', '035-globex.tsv')), false);
    assert.equal(fs.existsSync(report + '.lock'), true, 'the rejected save must preserve its peer lock');
  } finally { lock.release(); }
}));

test('a staging removal failure does not undo a completed save or skip further cleanup', (t) => fixture((root, report) => {
  const warnings = t.mock.method(console, 'error', () => {});
  const removals = [];
  const tsv = join(root, 'batch', 'tracker-additions', '035-globex.tsv');
  const result = writeEvaluationArtifacts(root, payload, {
    ...fs,
    rmSync(staging, options) {
      removals.push(staging);
      if (removals.length === 1) throw new Error('injected staging removal failure');
      fs.rmSync(staging, options);
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(fs.readFileSync(report, 'utf8'), payload.markdown);
  assert.match(fs.readFileSync(tsv, 'utf8'), /Globex/);
  assert.equal(removals.length, 2);
  assert.equal(fs.existsSync(removals[1]), false);
  assert.match(warnings.mock.calls[0].arguments[0], /injected staging removal failure/);
  assert.equal(fs.existsSync(report + '.lock'), false);
}));
