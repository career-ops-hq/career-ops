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
