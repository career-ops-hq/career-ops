import assert from 'node:assert/strict';
import { join } from 'node:path';
import { computeVelocity, foldObservations, parseStatusLog } from '../funnel-velocity.mjs';
import { loadCanonicalStates } from '../tracker-utils.mjs';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nfunnel-velocity hop math for re-applied rows');

const STATES = loadCanonicalStates(join(ROOT, 'templates/states.yml'));
const velocityOf = (lines) => computeVelocity(
  foldObservations(parseStatusLog(lines.join('\n'), STATES).observations),
  '2026-10-22',
);

function check(name, fn) {
  try {
    fn();
    pass(name);
  } catch (err) {
    fail(`${name}: ${err.message}`);
  }
}

check('a re-application is measured from its own Applied date', () => {
  const lines = [];
  for (const [num, replyDay] of [[1, '03'], [2, '04'], [3, '05']]) {
    lines.push(
      `${num}\t2026-01-05\tEvaluated\tApplied\tset-status\t`,
      `${num}\t2026-01-20\tApplied\tRejected\tset-status\t`,
      `${num}\t2026-06-01\tRejected\tApplied\tset-status\t`,
      `${num}\t2026-06-${replyDay}\tApplied\tResponded\tset-status\t`,
    );
  }
  const velocity = velocityOf(lines);
  assert.equal(velocity.appliedToResponded.median, 3);
  assert.equal(velocity.appliedToRejected.median, 15);
});

check('a re-applied row with no reply yet counts as still waiting', () => {
  const velocity = velocityOf([
    '1\t2026-01-05\tEvaluated\tApplied\tset-status\t',
    '1\t2026-01-20\tApplied\tRejected\tset-status\t',
    '1\t2026-06-01\tRejected\tApplied\tset-status\t',
  ]);
  assert.equal(velocity.appliedToResponded.censored, 1);
});

check('a reply logged by hand still ends the first application', () => {
  const lines = [];
  for (const [num, replyDay] of [[1, '03'], [2, '04'], [3, '05']]) {
    lines.push(
      `${num}\t2026-01-05\tEvaluated\tApplied\tset-status\t`,
      `${num}\t2026-01-12\tApplied\tResponded\tmanual\t`,
      `${num}\t2026-06-01\tResponded\tApplied\tset-status\t`,
      `${num}\t2026-06-${replyDay}\tApplied\tResponded\tset-status\t`,
    );
  }
  assert.equal(velocityOf(lines).appliedToResponded.median, 3);
});

check('an Applied logged by hand in between keeps the first Applied date', () => {
  const lines = [];
  for (const [num, replyDay] of [[1, '09'], [2, '10'], [3, '11']]) {
    lines.push(
      `${num}\t2026-01-05\tEvaluated\tApplied\tset-status\t`,
      `${num}\t2026-01-06\tApplied\tApplied\tmanual\t`,
      `${num}\t2026-01-07\tApplied\tApplied\tset-status\t`,
      `${num}\t2026-01-${replyDay}\tApplied\tResponded\tset-status\t`,
    );
  }
  assert.equal(velocityOf(lines).appliedToResponded.median, 5);
});

check('a re-application logged by hand is not measured from the first Applied', () => {
  const lines = [];
  for (const num of [1, 2, 3]) {
    lines.push(
      `${num}\t2026-01-05\tEvaluated\tApplied\tset-status\t`,
      `${num}\t2026-01-20\tApplied\tRejected\tset-status\t`,
      `${num}\t2026-06-01\tRejected\tApplied\tmanual\t`,
      `${num}\t2026-06-03\tApplied\tResponded\tset-status\t`,
    );
  }
  assert.equal(velocityOf(lines).appliedToResponded.n, 0);
});

check('two trusted applications on one row both count toward the reply time', () => {
  const lines = [];
  for (const [num, firstReply, secondReply] of [[1, '08', '23'], [2, '09', '24'], [3, '10', '25']]) {
    lines.push(
      `${num}\t2026-01-05\tEvaluated\tApplied\tset-status\t`,
      `${num}\t2026-01-${firstReply}\tApplied\tResponded\tset-status\t`,
      `${num}\t2026-01-20\tResponded\tApplied\tset-status\t`,
      `${num}\t2026-01-${secondReply}\tApplied\tResponded\tset-status\t`,
    );
  }
  const hop = velocityOf(lines).appliedToResponded;
  assert.equal(hop.n, 6);
  assert.equal(hop.median, 4);
});
