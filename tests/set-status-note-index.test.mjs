import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../set-status.mjs', import.meta.url));
const tracker = notes => `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\r\n|---|---|---|---|---|---|---|---|---|\r\n| 1 | 2026-10-01 | Example | Engineer | 4/5 | Evaluated | — | — | ${notes} |\r\n`;
function fixture(t, notes) {
  const root = mkdtempSync(join(tmpdir(), 'career-note-index-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'data'));
  const file = join(root, 'data/applications.md');
  writeFileSync(file, tracker(notes));
  return {
    read: () => readFileSync(file, 'utf8'),
    write: (value, status = 'Evaluated') => writeFileSync(file, tracker(value).replace('| Evaluated |', `| ${status} |`)),
    run(...args) {
      const result = spawnSync(process.execPath, [script, '--row', '1', 'Evaluated', ...args, '--json'], {
        cwd: root, env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: file }, encoding: 'utf8', timeout: 15000,
      });
      assert.equal(result.error, undefined);
      return { ...result, json: JSON.parse(result.stdout) };
    },
  };
}

for (const [before, index, old, replacement, after] of [
  ['same; same; keep', 0, 'same', 'new', 'new; same; keep'],
  ['same; same; keep', 1, 'same', 'new', 'same; new; keep'],
  ['a;  b', 1, 'b', 'new', 'a;  new'],
  ['a ; b', 0, 'a', 'new', 'new ; b'],
  ['first  ;   second  ;  third', 1, 'second', 'literal $1 [a].*', 'first  ;   literal $1 [a].*  ;  third'],
  ['; —; first; -; second', 1, 'second', 'last', '; —; first; -; last'],
]) {
  test(`edit only displayed note ${index} in ${JSON.stringify(before)}`, t => {
    const f = fixture(t, before);
    const result = f.run(`--note-index=${index}`, `--replace-note=${old}`, `--note=${replacement}`, `--expect-notes=${before}`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(f.read(), tracker(after));
    const retry = f.run(`--note-index=${index}`, `--replace-note=${old}`, `--note=${replacement}`, `--expect-notes=${before}`);
    assert.equal(retry.status, 3);
    assert.equal(retry.json.code, 'notes-changed');
    assert.equal(f.read(), tracker(after));
  });
}

test('an edit rejects a changed snapshot, wrong position, wrong note and malformed index', t => {
  const f = fixture(t, 'first; second');
  for (const args of [
    ['--note-index=0', '--replace-note=second', '--expect-notes=first; second'],
    ['--note-index=2', '--replace-note=second', '--expect-notes=first; second'],
    ['--note-index=-1', '--replace-note=second', '--expect-notes=first; second'],
    ['--note-index=1.5', '--replace-note=second', '--expect-notes=first; second'],
    ['--note-index=9007199254740992', '--replace-note=second', '--expect-notes=first; second'],
    ['--note-index=1', '--replace-note=second'],
    ['--note-index=1', '--expect-notes=first; second'],
  ]) {
    assert.equal(f.run(...args, '--note=new').status, 1);
    assert.equal(f.read(), tracker('first; second'));
  }
  f.write('changed; second');
  const result = f.run('--note-index=1', '--replace-note=second', '--note=new', '--expect-notes=first; second');
  assert.equal(result.status, 3);
  assert.equal(result.json.code, 'notes-changed');
  assert.equal(f.read(), tracker('changed; second'));
});

test('existing unindexed replacements accept displayed whitespace and retain all-match semantics', t => {
  const f = fixture(t, 'a ;  b  ; b; keep');
  const result = f.run('--replace-note=b', '--note=new');
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(f.read(), tracker('a ;  new  ; new; keep'));
});

test('indexed edits retain the selected note when canonicalization prepends legacy status text', t => {
  const f = fixture(t, 'first; second');
  const legacy = 'Applied 2026-10-02 via referral';
  f.write('first; second', legacy);
  const result = f.run('--note-index=1', '--replace-note=second', '--note=new', '--expect-notes=first; second');
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(f.read(), tracker(`${legacy}; first; new`));
});
