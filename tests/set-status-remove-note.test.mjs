import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../set-status.mjs', import.meta.url));
const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\r\n|---|---|---|---|---|---|---|---|---|\r\n';
const tracker = notes => HEADER + `| 1 | 2026-10-01 | Example | Engineer | 4/5 | Evaluated | — | — | ${notes} |\r\n`;
function fixture(t, notes) {
  const root = mkdtempSync(join(tmpdir(), 'career-remove-note-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'data'));
  const file = join(root, 'data/applications.md');
  writeFileSync(file, tracker(notes));
  return { root, file };
}
function run(f, ...args) {
  const result = spawnSync(process.execPath, [SCRIPT, '--row', '1', 'Evaluated', ...args, '--json'], {
    cwd: f.root, env: { ...process.env, CAREER_OPS_ROOT: f.root, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: f.file }, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.error, undefined);
  let json;
  try { json = JSON.parse(result.stdout); } catch { /* Usage errors can print only a message. */ }
  return { ...result, json };
}
for (const [before, note, after] of [
  ['first; second; third', 'first', 'second; third'],
  ['first; second; third', 'second', 'first; third'],
  ['first; second; third', 'third', 'first; second'],
  ['only', 'only', '—'],
  ['; Focused evaluation: summary', 'Focused evaluation: summary', '—'],
  ['same; same; other', 'same', 'same; other'],
  ['literal [a].* $1; keep', 'literal [a].* $1', 'keep'],
  ['first; part one; part two; last', 'part one; part two', 'first; last'],
  ['--dry-run; keep', '--dry-run', 'keep'],
  ['a;  b', 'b', 'a'],
  ['a ; b', 'a', 'b'],
  ['first  ;   second  ;  third', 'first', 'second  ;  third'],
  ['first  ;   second  ;  third', 'second', 'first  ;   third'],
  ['first  ;   second  ;  third', 'third', 'first  ;   second'],
]) {
  test(`remove whole note ${JSON.stringify(note)} from ${JSON.stringify(before)}`, t => {
    const f = fixture(t, before);
    const result = run(f, `--remove-note=${note}`, `--expect-notes=${before}`);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(result.json.removedNote, note);
    assert.equal(readFileSync(f.file, 'utf8'), tracker(after));
    assert.equal(existsSync(join(f.root, 'data/status-log.tsv')), false);
    assert.equal(existsSync(join(f.root, 'data/follow-ups.md')), false);
  });
}
test('stale snapshots cannot remove another duplicate or overwrite a concurrent note', t => {
  const f = fixture(t, 'same; same');
  const args = ['--remove-note=same', '--expect-notes=same; same'];
  assert.equal(run(f, ...args).status, 0);
  const retry = run(f, ...args);
  assert.equal(retry.status, 3);
  assert.equal(retry.json.code, 'notes-changed');
  assert.equal(readFileSync(f.file, 'utf8'), tracker('same'));
});
test('missing notes and substring-only matches are refused without writing', t => {
  const f = fixture(t, 'call Alex; keep');
  const result = run(f, '--remove-note=call');
  assert.equal(result.status, 1);
  assert.equal(result.json.code, 'remove-note-not-found');
  assert.equal(readFileSync(f.file, 'utf8'), tracker('call Alex; keep'));
});

test('extra separator spaces do not turn a partial note into a whole-note match', t => {
  const f = fixture(t, 'first;  call Alex  ; last');
  assert.equal(run(f, '--remove-note=call').json.code, 'remove-note-not-found');
  assert.equal(readFileSync(f.file, 'utf8'), tracker('first;  call Alex  ; last'));
});
test('dry runs and invalid flag combinations never change a tracker', t => {
  const f = fixture(t, 'keep; remove');
  assert.equal(run(f, '--remove-note=remove', '--dry-run').status, 0);
  for (const args of [['--remove-note='], ['--remove-note=remove', '--note=other'], ['--remove-note=remove', '--replace-note=keep', '--note=new']]) assert.equal(run(f, ...args).status, 1);
  assert.equal(readFileSync(f.file, 'utf8'), tracker('keep; remove'));
});

// The status writer also preserves legacy text after a status date. Removing
// another note in that same transaction must keep the migrated status text.
test('removing a note preserves legacy status text moved into Notes', t => {
  const f = fixture(t, 'keep; remove');
  const legacy = 'Applied 2026-10-02 via referral';
  writeFileSync(f.file, tracker('keep; remove').replace('| Evaluated |', `| ${legacy} |`));
  const result = run(f, '--remove-note=remove', '--expect-notes=keep; remove');
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(readFileSync(f.file, 'utf8'), tracker(`${legacy}; keep`));
});
