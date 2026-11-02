import { pass, fail } from './helpers.mjs';
import assert from 'node:assert/strict';
import { extractReqId, matchInvite, selectApplyTarget } from '../invite-match.mjs';
import { extractReqNumber } from '../tracker-parse.mjs';

const row = (num, status, notes) => ({ num, company: 'Acme', role: `Engineer ${num}`, status, notes });
const reqId = extractReqId('Req ID: JR1234');

function check(name, run) {
  try {
    run();
    pass(name);
  } catch (error) {
    fail(`${name}: ${error.message}`);
  }
}

// The shared tracker parser accepts a label immediately followed by its ID.
// Losing that bonus puts a different same-company Interview row first.
for (const label of ['req', 'requisition', 'job', 'jobid', 'posting', 'postingid', 'ref', 'reference']) {
  check(`the exact ID in ${label}JR1234 outranks the status tiebreaker`, () => {
    const notes = `${label}JR1234`;
    assert.equal(extractReqNumber(notes), reqId);
    const candidates = matchInvite({ company: 'Acme', reqId }, [row(1, 'Applied', notes), row(2, 'Interview', 'req JR9999')]);
    assert.equal(candidates[0].appNumber, 1, JSON.stringify(candidates));
    assert.equal(candidates[0].matchConfidence, 1.55);
    assert.equal(candidates[1].matchConfidence, 1.07);
    assert.equal(selectApplyTarget({ candidates }, null).code, 3, 'ranked candidates still require explicit disambiguation');
  });
}

for (const notes of ['REQjr1234', 'req1234', 'reference1234']) {
  check(`glued labels retain case-insensitive and numeric matching: ${notes}`, () => {
    const id = extractReqNumber(notes);
    assert.equal(matchInvite({ company: 'Acme', reqId: id }, [row(1, 'Applied', notes)])[0].matchConfidence, 1.55);
  });
}

for (const [id, notes] of [
  [reqId, 'reqJR12345'], [reqId, 'reqJR1234-A'], [reqId, 'reqJR1234_2'],
  [reqId, 'reqXJR1234'], [reqId, 'reqJR1234-'], [reqId, 'XreqJR1234'],
  [reqId, 'req reqJR1234'], [reqId, 'job id REQJR1234'],
  ['1234', 'reqJR1234'], ['1234', 'JR1234'],
]) {
  check(`${id} does not boost a different whole ID in ${notes}`, () => {
    assert.equal(matchInvite({ company: 'Acme', reqId: id }, [row(1, 'Interview', notes)])[0].matchConfidence, 1.07);
  });
}
