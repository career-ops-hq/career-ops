// A committed outcome journal must not precede a rejected tracker transition.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ROOT, pass, fail } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';
const root = mkdtempSync(join(tmpdir(), 'career-ops-outcome-commit-'));
mkdirSync(join(root, 'data'), { recursive: true });
const tracker = join(root, 'data', 'applications.md');
const initial = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-01-05 | Fictional | Engineer | 4/5 | Applied | — | — | notes |\n';
writeFileSync(tracker, initial);
writeFileSync(join(root, 'cv.md'), '# Fictional master CV\n');
const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: tracker, CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS: '100', CAREER_OPS_TRACKER_LOCK_RETRY_MS: '10' };
const run = (nodeArgs = [], flags = []) => spawnSync(process.execPath, [...nodeArgs, join(ROOT, 'outcome.mjs'), '1', 'hired', '--json', ...flags], { env, encoding: 'utf8' });
function check(label, fn) { try { fn(); pass(label); } catch (e) { fail(`${label}: ${e.message}`); process.exitCode = 1; } }

const { acquireTrackerLock, canonicalizeTrackerPath, trackerLockDirFor } = await import('../tracker-utils.mjs');
const dir = join(root, 'data', 'outcomes', '1_fictional_engineer');
mkdirSync(dir, { recursive: true });
const journal = join(dir, 'outcome.md');
const previous = '# Previous outcome history\n';
writeFileSync(journal, previous);
try {
  const canonical = canonicalizeTrackerPath(tracker);
  const lock = await acquireTrackerLock(trackerLockDirFor(canonical), { tracker: canonical });
  let result;
  try { result = run([]); } finally { lock.release(); }
  check('failed real tracker lock leaves the prior outcome journal unchanged', () => {
    assert.equal(result.status, 1, describeSpawn(result));
    assert.equal(readFileSync(tracker, 'utf8'), initial);
    assert.equal(readFileSync(journal, 'utf8'), previous);
  });
  const success = run([]);
  check('confirmed tracker transition appends one committed outcome', () => {
    assert.equal(success.status, 0, describeSpawn(success));
    assert.match(readFileSync(tracker, 'utf8'), /Hired/);
    assert.ok(readFileSync(journal, 'utf8').startsWith(previous));
    assert.equal((readFileSync(journal, 'utf8').match(/\*\*Outcome Type\*\*: hired/g) || []).length, 1);
  });
  const retry = run([]);
  check('retry does not duplicate the same outcome entry', () => {
    assert.equal(retry.status, 0, describeSpawn(retry));
    assert.equal((readFileSync(journal, 'utf8').match(/\*\*Outcome Type\*\*: hired/g) || []).length, 1);
  });

  writeFileSync(tracker, initial);
  writeFileSync(journal, previous);
  const replacement = initial.replace('Fictional', 'Another Employer');
  const edit = join(root, 'tracker-edit.mjs');
  writeFileSync(edit, `import childProcess from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const exec = childProcess.execFileSync;
childProcess.execFileSync = (file, args, options) => {
  if (basename(args[0]) === 'set-status.mjs') {
    writeFileSync(process.env.CAREER_OPS_TRACKER, ${JSON.stringify(replacement)});
  }
  return exec(file, args, options);
};
syncBuiltinESMExports();
`);
  const edited = run(['--import', pathToFileURL(edit).href]);
  check('a tracker row replaced during outcome recording keeps its status and journal', () => {
    assert.equal(readFileSync(tracker, 'utf8'), replacement);
    assert.equal(readFileSync(journal, 'utf8'), previous);
    assert.equal(edited.status, 1, describeSpawn(edited));
    assert.match(edited.stderr, /Tracker #1 changed since review/);
  });

  const other = '| 1 | 2026-01-08 | Fictional | Designer | 4/5 | Applied | — | — | other notes |';
  writeFileSync(tracker, initial + other + '\n');
  writeFileSync(journal, previous);
  check('a duplicate tracker number requires a role and can then update only that role', () => {
    const ambiguous = run();
    assert.equal(ambiguous.status, 3, describeSpawn(ambiguous));
    assert.equal(JSON.parse(ambiguous.stdout).code, 'ambiguous-match');
    assert.equal(readFileSync(tracker, 'utf8'), initial + other + '\n');
    const result = run([], ['--role', 'Engineer']);
    assert.equal(result.status, 0, describeSpawn(result));
    const lines = readFileSync(tracker, 'utf8').split('\n');
    assert.match(lines.find(line => line.includes('| Engineer |')), /\| Hired \|/);
    assert.ok(lines.includes(other));
  });
} finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
