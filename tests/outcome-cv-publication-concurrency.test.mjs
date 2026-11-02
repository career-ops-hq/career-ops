// Outcome status and journal must wait for the whole submitted CV copy.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROOT } from './helpers.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const rootCode = ROOT;
const initial = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-01-05 | Fictional | Engineer | 4/5 | Applied | — | — | notes |\n';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  const deadline = Date.now() + 10000;
  while (!fn()) {
    assert.ok(Date.now() < deadline, 'child did not reach the coordinated archive phase');
    await pause(20);
  }
}

for (const explicit of [true, false]) for (const fails of [false, true]) {
  test(`concurrent ${explicit ? 'selected' : 'automatic'} CV waits for ${fails ? 'failed' : 'complete'} archive copy`, { timeout: 20000 }, async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-cv-publication-')));
    const root = join(dir, 'workspace');
    const tracker = join(root, 'data', 'applications.md');
    const archive = join(root, 'data', 'outcomes', '1_fictional_engineer');
    const dest = join(archive, 'submitted_cv.pdf');
    const copying = join(dir, 'copying');
    const release = join(dir, 'release');
    const contender = join(dir, 'contender');
    const first = join(dir, 'first.pdf');
    const second = join(root, 'second.pdf');
    const initialTracker = initial.replace('Applied | — |', 'Applied | local:second.pdf |');
    const bytes = '%PDF-fictional complete first CV';
    const other = '%PDF-fictional complete second CV';
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(tracker, initialTracker);
    writeFileSync(first, bytes);
    writeFileSync(second, other);
    const preload = join(dir, 'coordinate.mjs');
    writeFileSync(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const paths = ${JSON.stringify({ dest, archive, copying, release, contender })};
const original = Object.fromEntries(['mkdirSync','existsSync','linkSync','copyFileSync'].map(k => [k, fs[k]]));
const writer = process.env.CV_RACE_WRITER === 'first';
fs.mkdirSync = (path, ...args) => { if (!writer && String(path) === paths.archive) fs.writeFileSync(paths.contender, 'started'); return original.mkdirSync(path, ...args); };
fs.linkSync = (src, dest, ...args) => { if (writer && dest === paths.dest) throw Object.assign(new Error('volume does not support links'), { code: 'ENOTSUP' }); return original.linkSync(src, dest, ...args); };
fs.copyFileSync = (src, dest, ...args) => {
  if (!writer || dest !== paths.dest) return original.copyFileSync(src, dest, ...args);
  const bytes = fs.readFileSync(src), fd = fs.openSync(dest, 'wx');
  try {
    fs.writeSync(fd, bytes.subarray(0, 5));
    fs.writeFileSync(paths.copying, 'partial');
    const deadline = Date.now() + 10000;
    while (!original.existsSync(paths.release)) { if (Date.now() > deadline) throw new Error('copy not released'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); }
    if (${fails}) throw Object.assign(new Error('injected failed copy'), { code: 'EIO' });
    fs.writeSync(fd, bytes.subarray(5));
  } catch (err) { fs.closeSync(fd); fs.unlinkSync(dest); throw err; }
  fs.closeSync(fd);
};
syncBuiltinESMExports();
`);
    const children = [];
    function start(path, writer) {
      const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, join(rootCode, 'outcome.mjs'), '1', 'hired', ...((writer === 'first' || explicit) ? ['--cv', path] : []), '--json'], { cwd: dir, env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: tracker, CV_RACE_WRITER: writer } });
      const result = { done: false, status: null, stdout: '', stderr: '' };
      child.stdout.on('data', chunk => { result.stdout += chunk; });
      child.stderr.on('data', chunk => { result.stderr += chunk; });
      const closed = new Promise(resolve => child.on('close', status => { result.done = true; result.status = status; resolve(result); }));
      children.push({ child, closed });
      return { result, closed };
    }
    try {
      const a = start(first, 'first');
      await until(() => existsSync(copying));
      const b = start(second, 'second');
      await until(() => existsSync(contender));
      await Promise.race([b.closed, pause(500)]);
      const before = { secondCompleted: b.result.done, journalExists: existsSync(join(archive, 'outcome.md')), trackerUnchanged: readFileSync(tracker, 'utf8') === initialTracker, archive: readFileSync(dest, 'utf8') };
      writeFileSync(release, 'continue');
      const [firstResult, secondResult] = await Promise.all([a.closed, b.closed]);
      assert.equal(before.secondCompleted, false, 'second outcome committed while the CV was partial');
      assert.equal(before.journalExists, false, 'journal appeared before the archived CV completed');
      assert.equal(before.trackerUnchanged, true, 'tracker changed before the archived CV completed');
      assert.equal(firstResult.status, fails ? 1 : 0, firstResult.stderr);
      if (fails) assert.equal(JSON.parse(firstResult.stdout).code, 'invalid-cv');
      assert.equal(secondResult.status, 0, secondResult.stderr);
      assert.equal(readFileSync(dest, 'utf8'), fails ? other : bytes);
      assert.equal(existsSync(join(archive, '.submitted-cv.lock')), false, 'CV publication lock was not released');
    } finally {
      writeFileSync(release, 'continue');
      for (const { child } of children) if (child.exitCode === null) child.kill();
      await Promise.all(children.map(c => c.closed));
      rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    }
  });
}
