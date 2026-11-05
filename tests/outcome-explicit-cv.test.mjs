// Explicit submitted-CV selection must fail closed before artifact or tracker writes.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { ROOT, pass, fail } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const initial = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-01-05 | Fictional | Engineer | 4/5 | Applied | — | — | notes |\n';
function check(label, fn) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-outcome-commit-')));
  const root = join(dir, 'workspace');
  const tracker = join(root, 'data', 'applications.md');
  const cwd = join(dir, 'cwd');
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(cwd);
  writeFileSync(tracker, initial);
  writeFileSync(join(root, 'cv.md'), '# Fictional master CV\n');
  const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: tracker, CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS: '100', CAREER_OPS_TRACKER_LOCK_RETRY_MS: '10' };
  const run = (args, preload) => spawnSync(process.execPath, [...(preload ? ['--import', pathToFileURL(preload).href] : []), join(ROOT, 'outcome.mjs'), '1', 'hired', '--json', ...args], { cwd, env, encoding: 'utf8', timeout: 15000 });
  try { fn({ root, tracker, cwd, run }); pass(label); }
  catch (e) { fail(`${label}: ${e.message}`); process.exitCode = 1; }
  finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
}
function unchanged(root, tracker) {
  assert.equal(readFileSync(tracker, 'utf8'), initial);
  assert.equal(existsSync(join(root, 'data', 'outcomes')), false);
}

for (const kind of ['missing', 'directory', 'empty']) {
  for (const flags of [[], ['--dry-run']]) {
    check(`${kind} explicit CV returns invalid-cv without mutation ${flags.join(' ')}`, ({ root, tracker, run }) => {
      const path = kind === 'missing' ? join(root, 'missing.pdf') : kind === 'directory' ? root : '';
      const r = run(['--cv', path, ...flags]);
      assert.equal(r.status, 1, describeSpawn(r));
      assert.equal(JSON.parse(r.stdout).code, 'invalid-cv');
      unchanged(root, tracker);
    });
  }
}

for (const flags of [[], ['--dry-run']]) {
  check(`zero-byte explicit CV returns invalid-cv without mutation ${flags.join(' ')}`, ({ root, tracker, run }) => {
    const pdf = join(root, 'empty.pdf');
    writeFileSync(pdf, '');
    const r = run(['--cv', pdf, ...flags]);
    assert.equal(r.status, 1, describeSpawn(r));
    assert.equal(JSON.parse(r.stdout).code, 'invalid-cv');
    unchanged(root, tracker);
    assert.equal(readFileSync(pdf).length, 0);
  });
}

if (process.platform !== 'win32') {
  check('a named pipe is rejected before opening without a producer', ({ root, tracker, cwd, run }) => {
    const pipe = join(cwd, 'selected.pdf');
    execFileSync('mkfifo', [pipe]);
    const r = run(['--cv', pipe]);
    assert.equal(r.status, 1, r.error?.message || r.stderr);
    assert.equal(JSON.parse(r.stdout).code, 'invalid-cv');
    unchanged(root, tracker);
  });
  check('a file swapped to a named pipe after stat fails without waiting for a producer', ({ root, tracker, cwd, run }) => {
    const pdf = join(cwd, 'selected.pdf');
    writeFileSync(pdf, '%PDF-selected submission');
    const r = run(['--cv', pdf], cvPreload(cwd, pdf, 'fifo-race'));
    assert.equal(r.status, 1, r.error?.message || r.stderr);
    assert.equal(JSON.parse(r.stdout).code, 'invalid-cv');
    unchanged(root, tracker);
  });
}

check('existing absolute PDF outside the workspace is archived rather than the master CV', ({ root, cwd, run }) => {
  const pdf = join(cwd, 'submitted.pdf');
  const bytes = '%PDF-fictional selected submission';
  writeFileSync(pdf, bytes);
  const selected = run(['--cv', pdf]);
  assert.equal(selected.status, 0, describeSpawn(selected));
  assert.equal(readFileSync(join(root, 'data', 'outcomes', '1_fictional_engineer', 'submitted_cv.pdf'), 'utf8'), bytes);
  assert.equal(readFileSync(pdf, 'utf8'), bytes);
});

// With a separate data root, a same-named CV in cwd must never become the
// submitted artifact. The workspace's relative path is the selected CV.
check('relative CV archives the data-root PDF rather than a same-named cwd file', ({ root, cwd, run }) => {
  writeFileSync(join(root, 'submitted.pdf'), '%PDF-data-root submission');
  writeFileSync(join(cwd, 'submitted.pdf'), '%PDF-wrong cwd submission');
  const selected = run(['--cv', 'submitted.pdf']);
  assert.equal(selected.status, 0, describeSpawn(selected));
  assert.equal(readFileSync(join(root, 'data', 'outcomes', '1_fictional_engineer', 'submitted_cv.pdf'), 'utf8'), '%PDF-data-root submission');
});

for (const flags of [[], ['--dry-run']]) {
  check(`relative CV missing in the data root rejects a cwd decoy ${flags.join(' ')}`, ({ root, tracker, cwd, run }) => {
    writeFileSync(join(cwd, 'submitted.pdf'), '%PDF-wrong cwd submission');
    const r = run(['--cv', 'submitted.pdf', ...flags]);
    assert.equal(r.status, 1, describeSpawn(r));
    assert.equal(JSON.parse(r.stdout).code, 'invalid-cv');
    unchanged(root, tracker);
  });
}

check('relative PDF preview resolves cleanup in the data root without mutation', ({ root, tracker, run }) => {
  mkdirSync(join(root, 'output'));
  const pdf = join(root, 'output', 'submitted.pdf');
  writeFileSync(pdf, '%PDF-data-root submission');
  const r = run(['--cv', join('output', 'submitted.pdf'), '--clean-output', '--dry-run']);
  assert.equal(r.status, 0, describeSpawn(r));
  assert.deepEqual(JSON.parse(r.stdout).cleanupCandidates, [pdf]);
  assert.equal(readFileSync(pdf, 'utf8'), '%PDF-data-root submission');
  unchanged(root, tracker);
});

check('omitted --cv retains automatic master-CV fallback in an independent workspace', ({ root, run }) => {
  const automatic = run([]);
  assert.equal(automatic.status, 0, describeSpawn(automatic));
  assert.equal(readFileSync(join(root, 'data', 'outcomes', '1_fictional_engineer', 'submitted_cv.md'), 'utf8'), '# Fictional master CV\n');
});

// Change the real source after validation, or inject a real archive/read failure.
// The old path-based validation uses access(); a bound snapshot closes its handle.
function cvPreload(cwd, selected, mode) {
  const preload = join(cwd, 'cv-race.mjs');
  writeFileSync(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { execFileSync } from 'node:child_process';
const selected = ${JSON.stringify(selected)}, mode = ${JSON.stringify(mode)};
const original = Object.fromEntries(['statSync','existsSync','accessSync','openSync','readFileSync','closeSync','writeFileSync','copyFileSync','linkSync'].map(k => [k, fs[k]]));
let selectedFd, changed = false;
function change() {
  if (changed || !['removed','replaced'].includes(mode)) return;
  changed = true;
  fs.unlinkSync(selected);
  if (mode === 'replaced') original.writeFileSync(selected, '%PDF-replacement CV');
}
function archiveFailure(path, bytes) {
  if (mode === 'archive-partial' && String(path).endsWith('submitted_cv.pdf')) {
    original.writeFileSync(path, Buffer.from(bytes).subarray(0, 5));
    throw Object.assign(new Error('injected failure after partial write'), { code: 'EIO' });
  }
  if (mode === 'archive-error' && String(path).endsWith('submitted_cv.pdf')) throw Object.assign(new Error('injected archive failure'), { code: 'EIO' });
}
fs.statSync = (path, ...args) => {
  const value = original.statSync(path, ...args);
  if (path === selected && mode === 'fifo-race' && !changed) {
    changed = true;
    fs.unlinkSync(selected);
    execFileSync('mkfifo', [selected]);
  }
  return value;
};
fs.accessSync = (path, ...args) => { const value = original.accessSync(path, ...args); if (path === selected) change(); return value; };
fs.existsSync = path => {
  const value = original.existsSync(path);
  if (value && path === selected) change();
  if (!value && mode === 'archive-race' && String(path).endsWith('submitted_cv.pdf')) original.writeFileSync(path, '%PDF-earlier archived submission');
  return value;
};
fs.openSync = (path, ...args) => { const fd = original.openSync(path, ...args); if (path === selected) selectedFd = fd; return fd; };
fs.readFileSync = (path, ...args) => { if (path === selectedFd && mode === 'read-error') throw Object.assign(new Error('injected read failure'), { code: 'EACCES' }); return original.readFileSync(path, ...args); };
fs.closeSync = fd => { const value = original.closeSync(fd); if (fd === selectedFd) { selectedFd = undefined; change(); } return value; };
fs.writeFileSync = (path, ...args) => { archiveFailure(path, args[0]); return original.writeFileSync(path, ...args); };
fs.linkSync = (src, dest, ...args) => {
  if (String(dest).endsWith('submitted_cv.pdf') && (mode.startsWith('link-') || mode === 'copy-error')) {
    throw Object.assign(new Error('injected link failure'), { code: mode === 'link-race' || mode === 'copy-error' ? 'ENOTSUP' : mode.slice(5) });
  }
  return original.linkSync(src, dest, ...args);
};
fs.copyFileSync = (src, dest, ...args) => {
  if (String(dest).endsWith('submitted_cv.pdf')) {
    if (mode === 'link-race') original.writeFileSync(dest, '%PDF-earlier archived submission');
    if (mode === 'copy-error') throw Object.assign(new Error('injected copy failure'), { code: 'EIO' });
  }
  archiveFailure(dest, mode === 'archive-partial' ? original.readFileSync(src) : null);
  return original.copyFileSync(src, dest, ...args);
};
syncBuiltinESMExports();
`);
  return preload;
}

check('a failed partial CV write leaves no archive to poison the next attempt', ({ root, tracker, cwd, run }) => {
  const pdf = join(cwd, 'submitted.pdf');
  const bytes = '%PDF-original selected submission';
  writeFileSync(pdf, bytes);
  const r = run(['--cv', pdf], cvPreload(cwd, pdf, 'archive-partial'));
  const archive = join(root, 'data', 'outcomes', '1_fictional_engineer');
  const dest = join(archive, 'submitted_cv.pdf');
  assert.equal(r.status, 1, describeSpawn(r));
  assert.equal(JSON.parse(r.stdout).code, 'invalid-cv');
  assert.equal(readFileSync(tracker, 'utf8'), initial);
  assert.equal(existsSync(join(archive, 'outcome.md')), false);
  const leftover = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
  const retry = run(['--cv', pdf]);
  assert.equal(retry.status, 0, describeSpawn(retry));
  assert.equal(leftover, null, `partial archive survived; retry archived ${JSON.stringify(readFileSync(dest, 'utf8'))}`);
  assert.equal(readFileSync(dest, 'utf8'), bytes);
  assert.equal(readFileSync(pdf, 'utf8'), bytes);
  assert.equal(readdirSync(archive).some(name => name.startsWith('.submitted-cv-')), false);
});

check('a concurrently published CV archive is preserved', ({ root, cwd, run }) => {
  const pdf = join(cwd, 'submitted.pdf');
  writeFileSync(pdf, '%PDF-selected submission');
  const r = run(['--cv', pdf], cvPreload(cwd, pdf, 'archive-race'));
  const archive = join(root, 'data', 'outcomes', '1_fictional_engineer');
  assert.equal(r.status, 0, describeSpawn(r));
  assert.equal(readFileSync(join(archive, 'submitted_cv.pdf'), 'utf8'), '%PDF-earlier archived submission');
  assert.equal(readdirSync(archive).some(name => name.startsWith('.submitted-cv-')), false);
});

for (const code of ['EPERM', 'ENOTSUP', 'ENOSYS', 'EXDEV']) {
  check(`explicit CV is archived when hard links fail with ${code}`, ({ root, cwd, run }) => {
    const pdf = join(cwd, 'submitted.pdf');
    const bytes = '%PDF-selected submission';
    writeFileSync(pdf, bytes);
    const r = run(['--cv', pdf], cvPreload(cwd, pdf, `link-${code}`));
    const archive = join(root, 'data', 'outcomes', '1_fictional_engineer');
    assert.equal(r.status, 0, describeSpawn(r));
    assert.equal(readFileSync(join(archive, 'submitted_cv.pdf'), 'utf8'), bytes);
    assert.equal(readFileSync(pdf, 'utf8'), bytes);
    assert.equal(readdirSync(archive).some(name => name.startsWith('.submitted-cv-')), false);
  });
}

check('exclusive-copy fallback preserves a concurrently published CV', ({ root, cwd, run }) => {
  const pdf = join(cwd, 'submitted.pdf');
  writeFileSync(pdf, '%PDF-selected submission');
  const r = run(['--cv', pdf], cvPreload(cwd, pdf, 'link-race'));
  const archive = join(root, 'data', 'outcomes', '1_fictional_engineer');
  assert.equal(r.status, 0, describeSpawn(r));
  assert.equal(readFileSync(join(archive, 'submitted_cv.pdf'), 'utf8'), '%PDF-earlier archived submission');
  assert.equal(readdirSync(archive).some(name => name.startsWith('.submitted-cv-')), false);
});

for (const mode of ['copy-error', 'link-EIO']) {
  check(`CV archive ${mode} fails before journal or status writes and can be retried`, ({ root, tracker, cwd, run }) => {
    const pdf = join(cwd, 'submitted.pdf');
    const bytes = '%PDF-selected submission';
    writeFileSync(pdf, bytes);
    const r = run(['--cv', pdf], cvPreload(cwd, pdf, mode));
    const archive = join(root, 'data', 'outcomes', '1_fictional_engineer');
    assert.equal(r.status, 1, describeSpawn(r));
    assert.equal(JSON.parse(r.stdout).code, 'invalid-cv');
    assert.equal(readFileSync(tracker, 'utf8'), initial);
    assert.equal(existsSync(join(archive, 'outcome.md')), false);
    assert.equal(existsSync(join(archive, 'submitted_cv.pdf')), false);
    assert.equal(readdirSync(archive).some(name => name.startsWith('.submitted-cv-')), false);
    const retry = run(['--cv', pdf]);
    assert.equal(retry.status, 0, describeSpawn(retry));
    assert.equal(readFileSync(join(archive, 'submitted_cv.pdf'), 'utf8'), bytes);
  });
}

for (const mode of ['removed', 'replaced', 'read-error', 'archive-error']) {
  check(`explicit CV snapshot stays bound or fails invalid-cv when ${mode}`, ({ root, tracker, cwd, run }) => {
    const pdf = join(cwd, 'submitted.pdf');
    const bytes = '%PDF-original selected submission';
    writeFileSync(pdf, bytes);
    const r = run(['--cv', pdf], cvPreload(cwd, pdf, mode));
    const archive = join(root, 'data', 'outcomes', '1_fictional_engineer');
    if (mode === 'removed' || mode === 'replaced') {
      assert.equal(r.status, 0, describeSpawn(r));
      assert.equal(readFileSync(join(archive, 'submitted_cv.pdf'), 'utf8'), bytes);
      assert.equal(existsSync(join(archive, 'submitted_cv.md')), false);
      if (mode === 'removed') assert.equal(existsSync(pdf), false);
      else assert.equal(readFileSync(pdf, 'utf8'), '%PDF-replacement CV');
    } else {
      assert.equal(r.status, 1, describeSpawn(r));
      assert.equal(JSON.parse(r.stdout).code, 'invalid-cv');
      assert.equal(readFileSync(tracker, 'utf8'), initial);
      assert.equal(existsSync(join(archive, 'outcome.md')), false);
      assert.equal(existsSync(join(archive, 'submitted_cv.md')), false);
    }
  });
}
