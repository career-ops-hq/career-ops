/**
 * invite-match.test.mjs — regression tests for invite-match.mjs's ambiguous-
 * match ranking, which is the part most likely to silently regress: a wrong
 * top candidate is worse than no candidate at all. Also covers the #2098
 * rejection-classification and --apply-to-Rejected additions.
 *
 * Run: node invite-match.test.mjs
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { matchInvite, normalizeCompanyName, extractPlatform, classifyEmail, analyzeInvite, applyRejectionStatus, selectApplyTarget } from './invite-match.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL: ${label}`);
    console.log(`    expected: ${e}`);
    console.log(`    actual:   ${a}`);
  }
}

const rows = [
  { num: 201, company: 'Northwind Traders', role: 'Ops Coordinator', status: 'Applied', date: '2026-05-01', notes: '' },
  { num: 202, company: 'Northwind Traders', role: 'HR Assistant', status: 'Interview', date: '2026-05-15', notes: '' },
  { num: 203, company: 'Northwind Traders', role: 'Analyst', status: 'Rejected', date: '2026-04-10', notes: 'Rejected 2026-04-20' },
];

// Three tracker rows for the same company at three different statuses — the
// Interview row must outrank both Applied and Rejected, since an in-progress
// interview is the most likely thing a new invite email is about.
const result = matchInvite({ company: 'Northwind Traders', date: null, reqId: null }, rows);
eq('all three same-company candidates are returned, not just the top one', result.length, 3);
eq('Interview-status row ranks first among same-name candidates', result[0].appNumber, 202);
eq('Rejected-status row ranks last among same-name candidates', result[result.length - 1].appNumber, 203);

// A company name that only partially overlaps (e.g. recruiter drops a
// division name) must still resolve, but must not outrank an exact match
// when both are present in the tracker.
const mixedRows = [
  ...rows,
  { num: 204, company: 'Northwind', role: 'Coordinator', status: 'Applied', date: '2026-06-01', notes: '' },
];
const partial = matchInvite({ company: 'Northwind', date: null, reqId: null }, mixedRows);
eq('exact "Northwind" match outranks the longer "Northwind Traders" partial matches', partial[0].appNumber, 204);

// normalizeCompanyName must be idempotent — normalizing an already-normalized
// string must return it unchanged, otherwise repeated normalization could
// drift the matching key across call sites.
const once = normalizeCompanyName('Acme Technologies Inc.');
eq('normalizeCompanyName is idempotent', normalizeCompanyName(once), once);

// A req ID that appears verbatim in a row's notes must outrank a same-name
// row without it, even though both have identical name similarity — this is
// the strongest disambiguation signal the matcher has, so it must actually
// move the ranking, not just add a negligible tiebreaker.
const reqIdRows = [
  { num: 301, company: 'Fabrikam', role: 'Engineer', status: 'Applied', date: '2026-05-01', notes: '' },
  { num: 302, company: 'Fabrikam', role: 'Engineer II', status: 'Applied', date: '2026-05-02', notes: 'req R-4821 mentioned' },
];
const reqIdResult = matchInvite({ company: 'Fabrikam', date: null, reqId: 'R-4821' }, reqIdRows);
eq('row with matching reqId in notes outranks identical-name row without it', reqIdResult[0].appNumber, 302);

// The req-ID boost must be case-insensitive: the invite and the tracker
// notes may case the same ID differently ("r-4821" vs "R-4821"), and a
// casing mismatch silently dropping the strongest signal is exactly the
// kind of regression this suite exists to catch.
const reqIdCaseResult = matchInvite({ company: 'Fabrikam', date: null, reqId: 'r-4821' }, reqIdRows);
eq('reqId boost still applies when invite cases the ID differently than the notes', reqIdCaseResult[0].appNumber, 302);

// Two distinct companies that each end in a *different pair* of chained
// generic descriptor words must not erode down to the same root — this is
// the actual over-stripping bug raised on PR #1497: chaining generic-word
// removal (not just legal-suffix removal) let "X Solutions Group" and
// "X Technologies Holdings" both collapse all the way to "x". Limiting
// generic-descriptor stripping to a single, non-chained pass stops at the
// first strip instead of eating through both words.
eq(
  'chained generic descriptors ("Solutions Group" vs "Technologies Holdings") do not erode to the same key',
  normalizeCompanyName('Northwind Solutions Group') === normalizeCompanyName('Northwind Technologies Holdings'),
  false
);

// extractPlatform — deterministic call-platform detection (issue #2126).
// A meeting-platform URL always wins over a phone-number pattern that might
// also be present in the same text (e.g. a dial-in fallback line under a
// Zoom link) — the video link is the actual call medium in that case.
eq('Zoom URL detected as Zoom', extractPlatform('Join: https://us05web.zoom.us/j/9998887777'), 'Zoom');
eq('Teams (microsoft.com) URL detected as Microsoft Teams', extractPlatform('https://teams.microsoft.com/l/meetup-join/abc'), 'Microsoft Teams');
eq('Teams (live.com) URL detected as Microsoft Teams', extractPlatform('https://teams.live.com/meet/abc'), 'Microsoft Teams');
eq('Meet URL detected as Google Meet', extractPlatform('https://meet.google.com/xyz-abcd-efg'), 'Google Meet');
eq('phone number with no meeting URL detected as Phone', extractPlatform('We will call you at 416-555-0199 for the screen.'), 'Phone');
eq('meeting URL outranks a phone-number fallback line in the same text', extractPlatform('Zoom: https://zoom.us/j/1234567890\nDial-in: 416-555-0199'), 'Zoom');
eq('no platform or phone signal returns null', extractPlatform('Please confirm your availability for the interview.'), null);
// Lookalike hosts / email addresses must never be reported as a real
// meeting platform — "silence stays silence" (issue #2128 review finding).
eq('lookalike host (notzoom.us) is not detected as Zoom', extractPlatform('Please visit https://notzoom.us for details.'), null);
eq('email address containing zoom.us is not detected as Zoom', extractPlatform('Contact support@zoom.us with questions.'), null);
eq('lookalike domain (teams.microsoft.com.evil.example) is not detected as Microsoft Teams', extractPlatform('See https://teams.microsoft.com.evil.example for the link.'), null);
// A platform-looking host must only be recognized at a true URL authority
// boundary — not as a path segment or query value on an unrelated host
// (issue #2128 review finding).
eq('does not detect a platform-looking URL path (Zoom)', extractPlatform('See https://example.com/zoom.us for details.'), null);
eq('does not detect a platform-looking query value (Zoom)', extractPlatform('See https://example.com?next=zoom.us for details.'), null);
eq('does not detect a platform-looking URL path (Microsoft Teams)', extractPlatform('See https://example.com/teams.microsoft.com for details.'), null);
eq('does not detect a platform-looking query value (Microsoft Teams)', extractPlatform('See https://example.com?next=teams.microsoft.com for details.'), null);
eq('does not detect a platform-looking URL path (Google Meet)', extractPlatform('See https://example.com/meet.google.com for details.'), null);
eq('does not detect a platform-looking query value (Google Meet)', extractPlatform('See https://example.com?next=meet.google.com for details.'), null);
// An explicit port in the URL authority must not block detection (issue
// #2128 review finding).
eq('Zoom URL with explicit port detected as Zoom', extractPlatform('Join: https://zoom.us:443/j/123456789'), 'Zoom');
eq('Microsoft Teams URL with explicit port detected as Microsoft Teams', extractPlatform('https://teams.microsoft.com:8443/l/meetup-join/abc'), 'Microsoft Teams');
eq('Google Meet URL with explicit port detected as Google Meet', extractPlatform('https://meet.google.com:443/xyz-abcd-efg'), 'Google Meet');

// --- #2098: rejection classification is unaffected-invite-classification regression check ---

eq('invite-phrased text still classifies as "invite" (no regression)', classifyEmail('Looking forward to interviewing with you next week for the Analyst role.').classification, 'invite');
eq('rejection-phrased text classifies as "rejection"', classifyEmail('Unfortunately, we have decided to move forward with other candidates.').classification, 'rejection');
eq('unrelated text classifies as "unknown"', classifyEmail('Your order has shipped.').classification, 'unknown');

// --- CodeRabbit PR #2100: "unfortunately" is corroborating-only, never sufficient alone ---
// The exact false-positive named in review: a reschedule email that happens
// to use "unfortunately" for an unrelated reason must not be misclassified
// as a rejection, since --apply would otherwise mark an active application
// Rejected on a single generic word.
const rescheduleOnly = classifyEmail('Unfortunately we need to push your interview to next Tuesday due to a scheduling conflict.');
eq('"unfortunately" alone (benign reschedule) does not classify as rejection', rescheduleOnly.classification === 'rejection', false);

// A real rejection that happens to also use "unfortunately" alongside a
// genuine strong rejection phrase must still classify as rejection — the
// weak phrase is corroborating, not disqualifying.
const weakPlusStrong = classifyEmail('Unfortunately, we have decided not to move forward with your application for this role.');
eq('"unfortunately" alongside a strong rejection phrase still classifies as rejection', weakPlusStrong.classification, 'rejection');

// matchedPhrases must be exposed and populated so a human/agent can
// sanity-check a rejection classification before trusting an --apply write.
const rejectionPhraseCheck = classifyEmail('We regret to inform you that you have not been selected.');
eq('matchedPhrases is a non-empty array for a rejection classification', Array.isArray(rejectionPhraseCheck.matchedPhrases) && rejectionPhraseCheck.matchedPhrases.length > 0, true);

const invitePhraseCheck = classifyEmail('We would like to invite you to schedule your phone screen for next week.');
eq('matchedPhrases includes the specific invite phrase that matched', invitePhraseCheck.matchedPhrases.includes('schedule your phone screen'), true);

const invitePastRows = [
  { num: 401, company: 'Fabrikam', role: 'Engineer', status: 'Applied', date: '2026-06-01', notes: '' },
];
const inviteAnalysis = analyzeInvite('Schedule Your Phone Screen – Fabrikam Opportunity', invitePastRows);
eq('analyzeInvite classification for an invite email is "invite" (matching behavior unchanged from before #2098)', inviteAnalysis.classification, 'invite');
eq('analyzeInvite still returns the same candidates for an invite email as before #2098', inviteAnalysis.candidates.length, 1);

// A benign reschedule email ("unfortunately" only, no strong rejection cue)
// against a real tracker row must not classify as rejection end-to-end —
// this is what keeps --apply from refusing correctly rather than writing.
const rescheduleAnalysis = analyzeInvite(
  'Company: Fabrikam\nUnfortunately we need to push your interview to next Tuesday due to a scheduling conflict.',
  invitePastRows
);
eq('analyzeInvite does not classify a benign reschedule email as rejection', rescheduleAnalysis.classification === 'rejection', false);

// --- #2098: --apply-to-Rejected path (applyRejectionStatus, real sandboxed tracker) ---

function makeSandboxTracker(rows) {
  const dir = mkdtempSync(join(tmpdir(), 'co-invitematch-unit-'));
  const tracker = join(dir, 'applications.md');
  writeFileSync(tracker, [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    ...rows,
    '',
  ].join('\n'));
  return { dir, tracker };
}

{
  const sb = makeSandboxTracker([
    '| 1 | 2026-06-01 | Fabrikam | Engineer | 4.0/5 | Applied | ❌ | — | — |',
  ]);
  const applied = applyRejectionStatus(1, { appsFile: sb.tracker });
  eq('applyRejectionStatus (single confident match) reports the Rejected transition', applied.newStatus, 'Rejected');
  eq('applyRejectionStatus (single confident match) reports changed:true', applied.changed, true);
  const content = readFileSync(sb.tracker, 'utf-8');
  eq('applyRejectionStatus actually writes Rejected to the tracker on disk', /\|\s*Rejected\s*\|/.test(content), true);
  rmSync(sb.dir, { recursive: true, force: true });
}

{
  // Re-running against an already-Rejected row must be a safe no-op, not an error.
  const sb = makeSandboxTracker([
    '| 1 | 2026-06-01 | Fabrikam | Engineer | 4.0/5 | Rejected | ❌ | — | — |',
  ]);
  const applied = applyRejectionStatus(1, { appsFile: sb.tracker });
  eq('applyRejectionStatus is idempotent — no-op re-run reports changed:false', applied.changed, false);
  eq('applyRejectionStatus idempotent re-run still reports newStatus Rejected', applied.newStatus, 'Rejected');
  rmSync(sb.dir, { recursive: true, force: true });
}

{
  // A tracker # that doesn't exist must fail structured, not throw uncaught.
  const sb = makeSandboxTracker([
    '| 1 | 2026-06-01 | Fabrikam | Engineer | 4.0/5 | Applied | ❌ | — | — |',
  ]);
  const applied = applyRejectionStatus(999, { appsFile: sb.tracker });
  eq('applyRejectionStatus on a nonexistent tracker # reports a structured error, not a thrown exception', typeof applied.error, 'string');
  rmSync(sb.dir, { recursive: true, force: true });
}

// --- #2100 CodeRabbit major finding: --apply's sole-candidate branch must
// require a confidence gate, not auto-select any single fuzzy match ---

// End-to-end: a company name that only partially overlaps the tracker row
// (a fuzzy, non-exact match) paired with a genuine strong rejection phrase
// still resolves to exactly one candidate — but that candidate must NOT be
// auto-applied, since the company match itself is low-confidence. This is
// the unsafe scenario CodeRabbit named on the old unconditional
// `result.candidates.length === 1` branch (line 768-769).
const fuzzySoleMatchRows = [
  { num: 601, company: 'Example Industries Global Holdings', role: 'Analyst', status: 'Applied', date: '2026-05-01', notes: '' },
];
const fuzzySoleMatchText = 'Company: Example Industries\nWe regret to inform you that we have decided not to move forward with your application for this role.';
const fuzzySoleMatchResult = analyzeInvite(fuzzySoleMatchText, fuzzySoleMatchRows);
eq('weak sole-match fixture: exactly one candidate matched (fuzzy, not exact, company name)', fuzzySoleMatchResult.candidates.length, 1);
eq('weak sole-match fixture: the sole candidate is not an exact company-name match', fuzzySoleMatchResult.candidates[0].nameScore === 1, false);
eq('weak sole-match fixture: classification is still "rejection" (strong phrase present)', fuzzySoleMatchResult.classification, 'rejection');
eq('weak sole-match fixture: phraseStrength is "strong"', fuzzySoleMatchResult.phraseStrength, 'strong');

const fuzzySoleMatchSelection = selectApplyTarget(fuzzySoleMatchResult, null);
eq('selectApplyTarget refuses to auto-apply a sole candidate that is only a fuzzy/partial company-name match, even with a strong rejection phrase', !!fuzzySoleMatchSelection.error, true);
eq('selectApplyTarget refusal on the fuzzy sole-match case uses exit code 2 (same as other non-ambiguous refusals)', fuzzySoleMatchSelection.code, 2);
eq('selectApplyTarget exposes the near-miss candidate so the caller can report it', fuzzySoleMatchSelection.candidate && fuzzySoleMatchSelection.candidate.appNumber, 601);

// The same weak sole match is auto-applied only once an exact company name
// is available to raise it above the confidence bar — confirms the gate is
// actually keyed on nameScore, not some other side effect of the fixture.
const exactSoleMatchRows = [
  { num: 602, company: 'Example Industries', role: 'Analyst', status: 'Applied', date: '2026-05-01', notes: '' },
];
const exactSoleMatchResult = analyzeInvite(fuzzySoleMatchText, exactSoleMatchRows);
const exactSoleMatchSelection = selectApplyTarget(exactSoleMatchResult, null);
eq('selectApplyTarget auto-applies a sole candidate once it is an exact company-name match with a strong rejection phrase', !exactSoleMatchSelection.error && exactSoleMatchSelection.target.appNumber, 602);

// An exact company-name match with only a weak ("unfortunately"-only)
// classification must also refuse — the gate requires BOTH conditions, not
// either one alone.
const exactButWeakText = 'Company: Example Industries\nUnfortunately we need to push your interview to next Tuesday due to a scheduling conflict.';
const exactButWeakResult = analyzeInvite(exactButWeakText, exactSoleMatchRows);
eq('exact-company/weak-phrase fixture does not classify as rejection at all (benign reschedule)', exactButWeakResult.classification === 'rejection', false);
// classifyEmail's own "unfortunately"-alone phrasing already refuses via the
// classification gate above --apply's candidate-selection step; this
// confirms selectApplyTarget is never even reached in that case since the
// CLI's classification check runs first (see the --apply block in
// invite-match.mjs).

// --- maintainer finding, PR #2100 review comment 2026-08-07: realistic
// non-rejection emails must never classify as `rejection`. This is the exact
// asymmetry the review named: a false `rejection` marks a live application
// dead via --apply's irreversible tracker write, while a missed rejection
// only costs one unnecessary follow-up. Full realistic email bodies, not
// isolated phrase fragments, since classifyEmail works on full text. ---

const rescheduleFullEmail = 'Hi Jamie,\n\nThanks for your flexibility — we need to reschedule your interview to next week. Something came up on our end and we want to make sure we can give you our full attention. Would Tuesday or Thursday afternoon work?\n\nSorry for the back and forth.\n\nBest,\nRecruiting Team';
const rescheduleFullResult = classifyEmail(rescheduleFullEmail);
eq('realistic reschedule email does not classify as rejection', rescheduleFullResult.classification === 'rejection', false);
eq('realistic reschedule email does not report phraseStrength "strong"', rescheduleFullResult.phraseStrength === 'strong', false);

const delayApologyFullEmail = 'Hi Alex,\n\nApologies for the delay in getting back to you — we\'re still reviewing candidates for this role and expect to have an update within the next week. Thanks so much for your patience.\n\nBest,\nTalent Acquisition Team';
const delayApologyFullResult = classifyEmail(delayApologyFullEmail);
eq('realistic delay-apology email does not classify as rejection', delayApologyFullResult.classification === 'rejection', false);
eq('realistic delay-apology email does not report phraseStrength "strong"', delayApologyFullResult.phraseStrength === 'strong', false);

const redundancyFullEmail = 'Hi team,\n\nWe regret to inform everyone that, following today\'s town hall, the company will be closing our satellite office as part of a broader restructuring, and several roles across departments are affected. To be clear, this update is unrelated to any individual candidate applications currently in progress — those pipelines continue as normal.\n\nThank you for your understanding.\n\nPeople Team';
const redundancyFullResult = classifyEmail(redundancyFullEmail);
eq('unrelated company-wide redundancy announcement does not classify as rejection', redundancyFullResult.classification === 'rejection', false);
eq('unrelated company-wide redundancy announcement does not report phraseStrength "strong"', redundancyFullResult.phraseStrength === 'strong', false);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:', failures.join(', '));
  process.exit(1);
}
