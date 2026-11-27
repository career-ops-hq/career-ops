// A deadline accepted by add must remain readable by open's reminder logic.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';
import { buildRow, isOffsetDateTime, openTakeHomes, parseAssessments } from '../assessment-log.mjs';

const check = (name, fn) => {
  try { fn(); pass(name); } catch (error) { fail(`${name}: ${error.message}`); }
};
const base = { kind: 'take-home', company: 'ExampleCorp', platform: 'portal', subject: 'Exercise' };
const offsets = ['Z', '+01:00', '-05:00', '+0100', '-0500'];
const now = new Date('2026-11-26T12:30:00Z');

for (const offset of offsets) {
  const deadline = `2026-11-27T12:30.5${offset}`;
  check(`deadline rejects a fraction without seconds (${offset})`, () => {
    assert.equal(isOffsetDateTime(deadline), false);
    assert.throws(() => buildRow({ ...base, deadline }, '2026-11-26'), /--deadline.*UTC offset/);
  });
}

for (const clock of ['12:30', '12:30:00', '12:30:00.125']) {
  for (const offset of offsets) {
    const deadline = `2026-11-27T${clock}${offset}`;
    check(`deadline reminder survives the ledger round-trip (${clock}${offset})`, () => {
      assert.equal(isOffsetDateTime(deadline), true);
      const { rows, malformed } = parseAssessments(buildRow({ ...base, deadline }, '2026-11-26'));
      assert.deepEqual(malformed, []);
      assert.equal(rows.length, 1);
      const open = openTakeHomes(rows, { tz: 'UTC', now });
      assert.equal(open.length, 1);
      assert.equal(open[0].deadline, deadline);
      const hour = offset === 'Z' ? '12' : offset.startsWith('+') ? '11' : '17';
      assert.equal(open[0].deadlineLocal, `2026-11-27 ${hour}:30 UTC`);
      assert.equal(open[0].hoursLeft, offset === 'Z' ? 24 : offset.startsWith('+') ? 23 : 29);
      assert.equal(open[0].warn, true);
      assert.equal(open[0].overdue, false);
    });
  }
}

check('CLI rejects fractional-minute deadlines without changing the existing ledger', () => {
  const root = mkdtempSync(join(tmpdir(), 'assessment-deadline-'));
  try {
    mkdirSync(join(root, 'data'));
    const log = join(root, 'data', 'assessments.tsv');
    const before = Buffer.from(`${buildRow({ ...base, deadline: '2026-11-27T12:30Z' }, '2026-11-26')}\n`);
    writeFileSync(log, before);
    for (const offset of offsets) {
      const result = spawnSync(NODE, [join(ROOT, 'assessment-log.mjs'), 'add',
        '--kind', 'take-home', '--company', 'ExampleCorp', '--platform', 'portal', '--subject', 'Exercise',
        '--deadline', `2026-11-27T12:30.5${offset}`], {
        cwd: root, encoding: 'utf8', windowsHide: true,
        env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: '' },
      });
      assert.ok(exitedNonZero(result), describeSpawn(result, 'expected invalid deadline rejection'));
      assert.match(result.stderr, /--deadline.*UTC offset/);
      assert.deepEqual(readFileSync(log), before);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


// Seed rows directly: these deadlines were accepted by earlier versions of add.
function withStoredTakeHome(deadline, fn) {
  const root = mkdtempSync(join(tmpdir(), 'assessment-legacy-submit-'));
  try {
    mkdirSync(join(root, 'data'));
    const log = join(root, 'data', 'assessments.tsv');
    const row = ['2026-11-26', 'ExampleCorp', '42', 'portal', 'Exercise', '-', '-', '',
      'take-home', deadline ?? '-', 'file', 'https://example.com/requirements', '-', '-'];
    writeFileSync(log, row.join('\t') + '\n');
    const cli = (...args) => spawnSync(NODE, [join(ROOT, 'assessment-log.mjs'), ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: '' },
    });
    fn({ log, cli, row });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const submitArgs = ['submit', '--company', 'ExampleCorp', '--report', '42', '--subject', 'Exercise'];
const legacyDeadlines = offsets.map(offset => '2026-11-27T12:30.5' + offset);
for (const deadline of [...legacyDeadlines, '2026-11-27T12:30Z', '2026-11-27T12:30:00.125Z', null]) {
  check('CLI submit preserves the stored deadline (' + (deadline ?? 'none') + ')', () => {
    withStoredTakeHome(deadline, ({ log, cli }) => {
      const before = readFileSync(log);
      const result = cli(...submitArgs, '--submitted-at', '2026-11-26', '--proof', 'receipt',
        '--deadline', '2030-01-01T09:00.5Z');
      assert.equal(result.status, 0, describeSpawn(result, 'expected legacy submission success'));
      const after = readFileSync(log);
      assert.deepEqual(after.subarray(0, before.length), before);
      const { rows, malformed } = parseAssessments(after.toString('utf8'));
      assert.deepEqual(malformed, []);
      assert.equal(rows.length, 2);
      assert.equal(rows[1].deadline, deadline);
      assert.equal(rows[1].submittedAt, '2026-11-26');
      assert.equal(rows[1].proof, 'receipt');
      assert.equal(rows[1].reportNum, '42');
      assert.equal(rows[1].platform, 'portal');
      assert.equal(rows[1].deliverable, 'file');
      assert.equal(rows[1].requirementsUrl, 'https://example.com/requirements');
      assert.equal(JSON.parse(result.stdout).row[9], deadline ?? '-');
      const open = cli('open', '--tz', 'UTC', '--json');
      assert.equal(open.status, 0, describeSpawn(open, 'expected open success'));
      assert.deepEqual(JSON.parse(open.stdout).open, []);
    });
  });
}

check('CLI submit carries the latest folded deadline', () => {
  withStoredTakeHome('2026-11-27T12:30Z', ({ log, cli, row }) => {
    const deadline = '2026-11-28T12:30.5+01:00';
    row[9] = deadline;
    writeFileSync(log, readFileSync(log, 'utf8') + row.join('\t') + '\n');
    const before = readFileSync(log);
    const result = cli(...submitArgs, '--submitted-at', '2026-11-26');
    assert.equal(result.status, 0, describeSpawn(result, 'expected folded submission success'));
    const after = readFileSync(log);
    assert.deepEqual(after.subarray(0, before.length), before);
    const { rows } = parseAssessments(after.toString('utf8'));
    assert.equal(rows.length, 3);
    assert.equal(rows[2].deadline, deadline);
    assert.equal(rows[2].submittedAt, '2026-11-26');
  });
});

for (const [label, args, error] of [
  ['missing submission date', [], /--submitted-at is required/],
  ['invalid submission date', ['--submitted-at', '2026-02-30'], /--submitted-at must be/],
  ['unknown assignment', ['--subject', 'Other', '--submitted-at', '2026-11-26'], /no logged take-home matches/],
  ['invalid proof', ['--submitted-at', '2026-11-26', '--proof', 'bad\tproof'], /--proof must not contain/],
]) {
  check('CLI submit with a legacy deadline still rejects ' + label, () => {
    withStoredTakeHome(legacyDeadlines[0], ({ log, cli }) => {
      const before = readFileSync(log);
      const result = cli(...submitArgs, ...args);
      assert.ok(exitedNonZero(result), describeSpawn(result, 'expected invalid submission rejection'));
      assert.match(result.stderr, error);
      assert.deepEqual(readFileSync(log), before);
    });
  });
}
