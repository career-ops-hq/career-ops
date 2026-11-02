// tests/hired-share-report-ids.test.mjs — the report id is unpadded
// everywhere now, so a flag or a state file that still carries zeros has to
// reach the same hire.
//
// `--report 012` used to work because the report number was a digit grab; it
// kept its zeros, and the row's id does not have them. And a state file
// written before the change holds "012" where the row's id is now "12" — a
// declined hire is meant to stay declined forever, so that key is still found.
//
// Every check seeds the state it needs: a check must not depend on what an
// earlier check left behind.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, pass, fail } from './helpers.mjs';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const root = mkdtempSync(join(tmpdir(), 'career-ops-hired-ids-'));
mkdirSync(join(root, 'data'), { recursive: true });
const tracker = join(root, 'data', 'applications.md');
const statePath = join(root, 'data', '.hired-share-state.json');
const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: tracker };

// One Hired row whose report link carries the padding: reports/012-acme.md.
writeFileSync(tracker, '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n'
  + '|---|---|---|---|---|---|---|---|---|\n'
  + '| 12 | 2026-01-05 | Acme | Engineer | 4/5 | Hired | — | [012](reports/012-acme.md) | notes |\n');

const seed = (byReport) => writeFileSync(statePath, JSON.stringify({ byReport }));
const run = (args) => spawnSync(process.execPath, [join(ROOT, 'hired-share.mjs'), ...args], { env, encoding: 'utf8' });
const readState = () => JSON.parse(readFileSync(statePath, 'utf8')).byReport;
function check(label, fn) { try { fn(); pass(label); } catch (e) { fail(`${label}: ${e.message}`); process.exitCode = 1; } }

const never = { status: 'never', askedAt: '2026-01-01T00:00:00Z' };

try {
  // 1. A padded flag reaches the unpadded row.
  seed({});
  const padded = run(['--report', '012', '--mark', 'later']);
  check('--report 012 reaches the row whose id is 12', () => {
    assert.equal(padded.status, 0, padded.stderr);
    const state = readState();
    assert.equal(state['12']?.status, 'later', `state: ${JSON.stringify(state)}`);
  });

  // 2. A state file written before the change keeps its padded key, and the
  // answer in it is still the answer.
  seed({ '012': never });
  const status = run(['--status']);
  check('a decline saved under the old padded key is still found', () => {
    assert.equal(status.status, 0, status.stderr);
    const out = JSON.parse(status.stdout);
    // The hire has to be FOUND as well: an empty askable list also holds when
    // no hire was found at all.
    assert.equal(out.hires.length, 1, `hires: ${JSON.stringify(out.hires)}`);
    assert.equal(out.hires[0].report, '12');
    assert.equal(out.hires[0].status, 'never');
    assert.deepEqual(out.askable, [], `askable: ${JSON.stringify(out.askable)}`);
  });

  // 3. Drafting does not overwrite that decline.
  seed({ '012': never });
  const draft = run(['--report', '12']);
  check('a padded decline survives a draft of the same hire', () => {
    assert.equal(draft.status, 0, draft.stderr);
    const state = readState();
    assert.equal(state['012']?.status, 'never', `state: ${JSON.stringify(state)}`);
  });

  // 4. A new answer is written under the key that is already there, so one
  // hire never ends up with two entries.
  seed({ '012': never });
  const marked = run(['--report', '012', '--mark', 'later']);
  check('a new answer reuses the existing padded key', () => {
    assert.equal(marked.status, 0, marked.stderr);
    const state = readState();
    assert.deepEqual(Object.keys(state), ['012'], `keys: ${JSON.stringify(Object.keys(state))}`);
    assert.equal(state['012'].status, 'later');
  });

  // 5. A file holding BOTH forms of one id: the decline is authoritative, so
  // the hire cannot become mentionable again and a draft cannot soften it.
  seed({ '12': { status: 'later', askedAt: '2026-01-01T00:00:00Z' }, '012': never });
  const both = run(['--status']);
  check('a decline is authoritative when both id forms are on record', () => {
    assert.equal(both.status, 0, both.stderr);
    const out = JSON.parse(both.stdout);
    assert.equal(out.hires.length, 1, `hires: ${JSON.stringify(out.hires)}`);
    assert.equal(out.hires[0].report, '12');
    assert.equal(out.hires[0].status, 'never', 'the decline wins over the later key');
    assert.deepEqual(out.askable, [], `askable: ${JSON.stringify(out.askable)}`);
  });
  seed({ '12': { status: 'later', askedAt: '2026-01-01T00:00:00Z' }, '012': never });
  const bothDraft = run(['--report', '12']);
  check('a draft does not soften a decline recorded under the padded key', () => {
    assert.equal(bothDraft.status, 0, bothDraft.stderr);
    const state = readState();
    assert.equal(state['012']?.status, 'never', `state: ${JSON.stringify(state)}`);
    assert.equal(state['12']?.status, 'later', `state: ${JSON.stringify(state)}`);
  });

  // 6. A flag that is not a number is refused: it is a typo, not report 12.
  seed({});
  const bogus = run(['--report', '1x2', '--mark', 'never']);
  check('a non-numeric --report is refused and nothing is recorded', () => {
    assert.ok(exitedNonZero(bogus), describeSpawn(bogus, 'the command should have failed'));
    assert.match(bogus.stderr, /--report must be a report number/);
    assert.deepEqual(readState(), {}, 'no decision may be recorded for an invalid id');
  });
} finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
