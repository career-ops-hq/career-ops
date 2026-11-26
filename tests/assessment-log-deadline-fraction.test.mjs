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
