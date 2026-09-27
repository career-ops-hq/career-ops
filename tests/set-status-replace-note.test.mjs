import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pass, fail, NODE, ROOT } from './helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'replace-note-'));
const tracker = join(dir, 'applications.md');
function reset(note, status = 'Applied') {
  writeFileSync(tracker, `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-09-01 | Example | Engineer | 4/5 | ${status} | — | — | ${note} |\n`);
}
function run(args, state = 'Applied') {
  const r = spawnSync(NODE, [join(ROOT, 'set-status.mjs'), '--row', '1', state, '--json', ...args], {
    encoding: 'utf8', env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: dir, CAREER_OPS_TRACKER: tracker },
  });
  return { ...r, data: JSON.parse(r.stdout) };
}
const replace = ['--replace-note', 'CV ready', '--note', 'CV ready, applied'];
try {
  reset('keep me; CV ready; CV ready, applied; CV ready');
  const preview = readFileSync(tracker, 'utf8');
  let r = run([...replace, '--dry-run']);
  assert.equal(r.status, 0); assert.equal(r.data.changed, true);
  assert.equal(readFileSync(tracker, 'utf8'), preview);
  pass('replace-note dry-run leaves tracker unchanged');
  r = run(replace);
  assert.equal(r.status, 0); assert.equal(r.data.replacedNote, 'CV ready');
  assert.ok(readFileSync(tracker, 'utf8').includes('keep me; CV ready, applied; CV ready, applied; CV ready, applied'));
  assert.equal(existsSync(join(dir, 'status-log.tsv')), false);
  assert.equal(existsSync(join(dir, 'follow-ups.md')), false);
  assert.equal(r.data.followupSeedCandidate, undefined);
  pass('replaces all stale occurrences while preserving completed spans and unrelated notes');
  const after = readFileSync(tracker, 'utf8');
  r = run(replace);
  assert.equal(r.status, 0); assert.equal(r.data.changed, false);
  assert.equal(readFileSync(tracker, 'utf8'), after);
  pass('replacement containing OLD is idempotent and note-only edits have no transition side effects');
  r = run(['--replace-note', 'typo', '--note', 'missing'], 'Interview');
  assert.equal(r.status, 1); assert.equal(r.data.code, 'replace-note-not-found');
  assert.equal(readFileSync(tracker, 'utf8'), after);
  pass('missing OLD and NEW fails without changing status');
  for (const args of [['--replace-note', 'old'], ['--replace-note', '', '--note', 'new'], ['--replace-note', 'old', '--note', ' ']]) {
    assert.equal(run(args).status, 1);
    assert.equal(readFileSync(tracker, 'utf8'), after);
  }
  pass('rejects missing or empty replacement arguments before writing');
  for (const existing of ['sent CV', 'resent', 'CV sent', 'sent CV; resent; CV sent']) {
    reset(existing);
    const before = readFileSync(tracker, 'utf8');
    r = run(['--replace-note', 'sent', '--note', 'applied'], 'Interview');
    assert.equal(r.status, 1, `must reject substring-only OLD in ${existing}`);
    assert.equal(r.data.code, 'replace-note-not-found');
    assert.equal(readFileSync(tracker, 'utf8'), before);
  }
  pass('substring-only OLD fails without changing the note or status');
  reset('sent; sent CV; resent; sent; CV sent; sent');
  r = run(['--replace-note', 'sent', '--note', 'applied']);
  assert.equal(r.status, 0);
  assert.ok(readFileSync(tracker, 'utf8').includes('applied; sent CV; resent; applied; CV sent; applied'));
  assert.equal(run(['--replace-note', 'sent', '--note', 'applied']).data.changed, false);
  pass('replaces whole notes at every position while preserving longer notes');
  reset('applied CV');
  const substringNew = readFileSync(tracker, 'utf8');
  r = run(['--replace-note', 'sent', '--note', 'applied']);
  assert.equal(r.status, 1);
  assert.equal(r.data.code, 'replace-note-not-found');
  assert.equal(readFileSync(tracker, 'utf8'), substringNew);
  pass('substring-only NEW does not falsely mark a replacement as complete');
  reset('keep me; sent; sent; awaiting reply');
  const compound = ['--replace-note', 'sent', '--note', 'sent; awaiting reply'];
  assert.equal(run(compound).status, 0);
  assert.ok(readFileSync(tracker, 'utf8').includes('keep me; sent; awaiting reply; sent; awaiting reply'));
  assert.equal(run(compound).data.changed, false);
  pass('delimiter-containing replacement stays idempotent at whole-note boundaries');
  reset('CV ready, not applied; keep me');
  r = run(['--replace-note', 'CV ready, not applied', '--note', 'CV ready']);
  assert.equal(r.status, 0);
  assert.ok(readFileSync(tracker, 'utf8').includes('CV ready; keep me'));
  pass('OLD containing NEW still replaces the entire stale text');
  reset('a.b $&; a.b $&');
  r = run(['--replace-note', 'a.b $&', '--note', 'literal $1']);
  assert.equal(r.status, 0);
  assert.ok(readFileSync(tracker, 'utf8').includes('literal $1; literal $1'));
  pass('replacement treats regex and substitution characters literally');
  reset('CV ready, not applied', 'Evaluated');
  r = run(['--replace-note', 'CV ready, not applied', '--note', 'CV ready, applied']);
  assert.equal(r.status, 0); assert.equal(r.data.statusLogged, true);
  assert.equal(r.data.followupSeedCandidate, true);
  pass('replacement can accompany an actual status transition');
} catch (err) { fail(err.stack); }
finally { rmSync(dir, { recursive: true, force: true }); }
