import { pass, fail } from './helpers.mjs';
import { extractReqId, matchInvite } from '../invite-match.mjs';
import { extractReqNumber } from '../tracker-parse.mjs';

const reqId = extractReqId('Req ID: JR1234');
const row = (num, status, notes) => ({ num, company: 'Acme', role: `Engineer ${num}`, status, notes });

for (const wrongId of ['JR12345', 'XJR1234', 'JR1234-A', 'JR1234_2', 'X-JR1234', 'req_JR12345', 'r_JR1234-A', 'REQ-JR1234_2', 'req_JR1234-', 'r_JR1234_']) {
  const candidates = matchInvite({ company: 'Acme', reqId }, [
    row(1, 'Interview', `req ${wrongId}`),
    row(2, 'Applied', 'req JR1234'),
  ]);
  if (candidates[0].appNumber === 2 && candidates[1].matchConfidence === 1.07) {
    pass(`the exact requisition outranks an active row carrying ${wrongId}`);
  } else {
    fail(`partial requisition ${wrongId} received a bonus: ${JSON.stringify(candidates)}`);
  }
}

for (const notes of ['JR1234', 'req jr1234', 'req: (JR1234).', 'https://careers.example.com/jobs/JR1234?source=mail', 'req_JR1234', 'r_JR1234', 'REQ-JR1234', 'Older req_JR9999; current r_JR1234']) {
  const candidates = matchInvite({ company: 'Acme', reqId }, [row(1, 'Applied', notes)]);
  if (candidates[0].matchConfidence === 1.55) pass(`whole requisition still matches ${notes}`);
  else fail(`whole requisition lost its bonus: ${notes}`);
}

const hyphenated = matchInvite({ company: 'Acme', reqId: 'r-4821' }, [row(1, 'Applied', 'req R-4821 mentioned')]);
if (hyphenated[0].matchConfidence === 1.55) pass('existing case-insensitive hyphenated IDs retain their bonus');
else fail('existing hyphenated ID no longer matches');

const noReq = matchInvite({ company: 'Acme', reqId: null }, [row(1, 'Applied', 'req JR1234'), row(2, 'Interview', 'req JR12345')]);
if (noReq[0].appNumber === 2) pass('without a requisition signal, existing active-status ranking is preserved');
else fail('status ranking changed without a requisition signal');

for (const wrongId of ['JR1234', 'JR-1234', 'R-1234', 'req_JR1234', 'r_JR1234', 'REQ-JR1234']) {
  const candidates = matchInvite({ company: 'Acme', reqId: '1234' }, [row(1, 'Interview', `req ${wrongId}`), row(2, 'Applied', 'req 1234')]);
  if (candidates[0].appNumber === 2 && candidates[1].matchConfidence === 1.07) pass(`numeric 1234 does not boost the prefixed ID ${wrongId}`);
  else fail(`numeric 1234 falsely matches ${wrongId}: ${JSON.stringify(candidates)}`);
}

for (const notes of ['1234', 'req 1234', 'req_1234', 'r_1234', 'REQ-1234']) {
  const candidates = matchInvite({ company: 'Acme', reqId: '1234' }, [row(1, 'Applied', notes)]);
  if (candidates[0].matchConfidence === 1.55) pass(`whole numeric ID retains its bonus in ${notes}`);
  else fail(`whole numeric ID lost its bonus: ${notes}`);
}

for (const [reqId, notes] of [
  ['1234', 'req REQ-1234'],
  ['1234', 'req R_1234'],
  ['1234', 'job id REQ-1234'],
  ['1234', 'reference (REQ-1234)'],
  ['JR1234', 'req REQ-JR1234'],
  ['001234', 'req REQ-001234'],
  ['1234', 'job id JOBID-1234'],
]) {
  const candidates = matchInvite({ company: 'Acme', reqId }, [row(1, 'Interview', notes), row(2, 'Applied', `req ${reqId}`)]);
  if (candidates[0].appNumber === 2 && candidates[1].matchConfidence === 1.07) pass(`a separate label preserves the actual prefixed ID in ${notes}`);
  else fail(`an actual prefixed ID was stripped in ${notes}: ${JSON.stringify(candidates)}`);
}

for (const reqId of ['REQ-1234', 'R_1234']) {
  const candidates = matchInvite({ company: 'Acme', reqId }, [row(1, 'Applied', `req ${reqId}`)]);
  if (candidates[0].matchConfidence === 1.55) pass(`a separate label preserves an exact ${reqId} match`);
  else fail(`a separately labelled exact ${reqId} lost its bonus`);
}

for (const [notes, actualId] of [
  ['req - REQ-1234', 'REQ-1234'],
  ['req- REQ-1234', 'REQ-1234'],
  ['req_ REQ-1234', 'REQ-1234'],
  ['req _ REQ-1234', 'REQ-1234'],
  ['job id - JOBID-1234', 'JOBID-1234'],
]) {
  const candidates = matchInvite({ company: 'Acme', reqId: extractReqId('Req ID: 1234') }, [row(1, 'Interview', notes), row(2, 'Applied', 'req 1234')]);
  if (extractReqNumber(notes) === actualId && candidates[0].appNumber === 2 && candidates[1].matchConfidence === 1.07) pass(`separated label retains the full canonical ID in ${notes}`);
  else fail(`a separator hid the label context in ${notes}: ${JSON.stringify(candidates)}`);

  const exact = matchInvite({ company: 'Acme', reqId: actualId }, [row(1, 'Applied', notes)]);
  if (exact[0].matchConfidence === 1.55) pass(`the full canonical ID still matches ${notes}`);
  else fail(`separated-label exact ${actualId} lost its bonus`);
}
