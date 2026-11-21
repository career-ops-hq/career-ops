// Which apply-date in a tracker row's Notes belongs to THIS row.
//
// `parseAppliedDate` prefers the notes over the tracker's date column, because
// the date column is often the evaluation date. Notes routinely cite a SIBLING
// requisition's timeline for context, and that citation reads exactly like this
// row's own date to a positional scan (#2607). `isCrossReferencedMention` drops
// the foreign ones.
//
// Attribution is decided by one clause model (see followup-cadence.mjs): the
// note is split into clauses, each "applied ... date" owns a segment inside its
// clause, every row pointer is attributed to exactly one date, and an undated
// pointer's subject carries into the next clause across a `;`/`|` only. These
// cases are the contract for that model, including the cases it deliberately
// cannot read.
//
// The two failure directions are NOT symmetric, and every case below is written
// with that in mind:
//   - a false positive (a genuine date called foreign) discards a real measured
//     submission date and silently degrades a live follow-up;
//   - a false negative reports another row's date as this row's MEASURED one,
//     which is the bug the guard exists to prevent.
// The first is the more expensive, so the "keeps its own date" group is as much
// of the contract as the "cross-reference" group.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAppliedDate, resolveAppliedDate } from '../followup-cadence.mjs';

// Dates that belong to ANOTHER row. `null` means "this note does not state when
// this row was submitted", which both consumers degrade to a LABELLED fallback.
const FOREIGN = [
  // #2607, the original: a `#NNN` pointer before the date.
  ['Same posting as #140 (applied 2026-07-20). Not yet submitted.', 'bare #id citation'],
  ['Sibling #1311 - applied 2026-08-06.', 'bare #id in the req-label shape'],
  ['#154 is already live; applied 2026-08-04. Not submitted here yet.', 'undated citation, one separator'],
  ['#154 is already live;applied 2026-08-04.', 'undated citation, unspaced separator'],
  ['#154 Sr PM (applied 2026-08-04)', 'citation dated, nothing after it'],

  // #4953: the same pointer written in PROSE. The guard knew only `#NNN`, so
  // this shape read straight through as the row's own date -- a row submitted in
  // November whose note cited a sibling's September submission had its next
  // follow-up pinned two months in the past.
  ['row 51 (other Staff req, applied 2026-09-20)', 'word pointer before the date'],
  ['tracker row 51 (applied 2026-09-20)', '"tracker row"'],
  ['entry 51 (applied 2026-09-20)', '"entry"'],
  ['row #51 (applied 2026-09-20)', '"row #51" (the hash branch already caught this one)'],

  // #4953: the pointer can also FOLLOW the date it owns. This is the shape that
  // forced a forward scan -- the citation sits 24 chars after the date and only
  // a word or two precedes it, so no lookback length can reach it. Asserted
  // next to the backward form on purpose: a fix that only widens the lookback
  // passes those and still fails these.
  ['applied 2026-09-20 to their other Staff req (row 51, 4.6/5)', 'pointer after the date'],
  ['Applied 2026-09-20 (via Greenhouse) to their other Staff req (row 51)', 'pointer in a LATER bracket group'],
  // Depth-matched brackets: searching for the first `)` read this group as
  // closing after "US" and missed the pointer entirely.
  ['Applied 2026-09-20 elsewhere (via Ashby (US), row 51)', 'pointer after a NESTED bracket group'],

  // #4953: and it can sit INSIDE the matched span, between "applied" and the
  // date it governs, where neither window reaches.
  ['Applied to their other req (row 51) on 2026-09-20', 'pointer between "applied" and its date'],

  // `|` is a clause boundary for the scope model, so an "applied ... date" match
  // must not span one either: reaching across it paired "Not applied" with a
  // sibling's date and reported it as this row's. A literal `|` does reach this
  // column -- a populated tracker had one inside a Notes cell.
  ['Not applied | row 51 applied 2026-09-20', 'a match cannot cross a pipe'],
];

// Dates that are THIS row's own. Several of these are deliberate exclusions
// with a cost attached: each one protects a real measured date from being
// thrown away, so a "simplification" that breaks one is a regression even
// though the guard still looks correct on the cases above.
const OWN = [
  // Baseline parsing.
  ['Applied 2026-06-09 via Personio; raised part-time', '2026-06-09', 'plain apply date'],
  ['APPLIED 2026-06-17 (German CV; jobId=104170)', '2026-06-17', 'uppercase APPLIED'],
  ['Applied ~2026-06-09 (date estimated)', '2026-06-09', 'estimated date'],
  ['Applied via Ashby 2026-08-31', '2026-08-31', 'channel phrasing before the date (#4084)'],
  ['Applied on 2026-08-25 via Ashby', '2026-08-25', 'channel phrasing after the date (#4084)'],
  // First-wins among a row's OWN dates: a later status date must not displace
  // the submission date.
  // Two real `applied` candidates, so this actually pins the ordering: with
  // only one candidate (a later date after "discarded") a switch to last-wins
  // would still pass.
  ['Applied 2026-06-09 via Ashby; applied 2026-06-18 again by mistake', '2026-06-09', 'first of several own dates'],
  ['Applied 2026-06-09. No response; discarded 2026-06-18.', '2026-06-09', 'a later non-apply date is not a candidate'],

  // A sentence break always ends a pointer's scope, in both directions.
  ['Sibling #140 was slow. Applied 2026-08-06.', '2026-08-06', 'sentence break after the pointer'],
  ['Applied 2026-11-20. Sibling row 51 is open.', '2026-11-20', 'sentence break before a later pointer'],

  // Once the citation HAS its own date, a separator ends it and what follows is
  // this row's. The common shape when two roles are live at one employer: the
  // note naming the sibling is the same note recording this submission.
  ['#154 Sr PM (applied 2026-08-04); applied 2026-06-15', '2026-06-15', 'dated citation, semicolon'],
  ['#154 Sr PM (applied 2026-08-04) | applied 2026-06-15', '2026-06-15', 'dated citation, pipe'],
  ['#154 Sr PM (applied 2026-08-04);applied 2026-06-15', '2026-06-15', 'dated citation, unspaced semicolon'],
  ['#154 Sr PM (applied 2026-08-04)|applied 2026-06-15', '2026-06-15', 'dated citation, unspaced pipe'],
  // ...and the citation's date may sit BEFORE the pointer. Reading only the
  // text after the pointer missed this and discarded the November date.
  [
    'Applied 2026-09-20 to their other Staff req (row 51); Applied 2026-11-20',
    '2026-11-20',
    'citation dated before the pointer, own date after the separator',
  ],

  // A `#NNN` carrying a req/job/posting/ref label is this row's ATS identifier,
  // not a pointer at another row.
  ['Req #1311 - applied 2026-08-06.', '2026-08-06', '"req"-labelled id'],
  ['Job ID #65136; applied 2026-08-06.', '2026-08-06', '"job id"-labelled id'],
  ['Posting #4471 — applied 2026-08-06.', '2026-08-06', '"posting"-labelled id'],
  ['Ref #R2857957 applied 2026-08-06.', '2026-08-06', '"ref"-labelled id'],
  ['Applied via req #1311 on 2026-08-06', '2026-08-06', 'labelled id inside the matched span'],
  // A `#NNN` glued to a word character or hyphen is an external tag.
  ['job-search#7; Applied 2026-09-21', '2026-09-21', 'external tag, not a row pointer'],

  // #4953 over-match guards. The WORD is the discriminator: a bare number after
  // a bare word is this row's own identifier, and `\b` keeps the pattern from
  // firing inside another word.
  ['Req 1311, job 88214, posting 4001; applied 2026-08-06', '2026-08-06', 'bare labelled ids are not pointers'],
  ['Narrow 51 roles scanned; applied 2026-09-21', '2026-09-21', '"Narrow 51" is not "row 51"'],
  // The year of an ISO date is not a row number: `\b` holds between the digit
  // and the hyphen, so "entry 2026" matched and August 6 was thrown away.
  ['Data entry 2026-08-05; Applied 2026-08-06', '2026-08-06', 'a date year is not a row number'],

  // The forward scan is bracketed, word-spelled and clause-bounded. Each limit
  // keeps a real date that a looser rule discarded or a tighter one adopted.
  // A pointer BETWEEN two dates: unbracketed it is the subject of the "applied"
  // that follows it, bracketed it is an appositive for the clause just read. A
  // comma is not a clause boundary, so without that distinction both dates in
  // the second note were thrown away.
  ['Applied 2026-11-20 and row 51 applied 2026-09-20', '2026-11-20', 'unbracketed pointer belongs to the NEXT date'],
  ['Applied 2026-11-20 here, applied 2026-09-20 elsewhere (row 51)', '2026-11-20', 'bracketed pointer belongs to the PRECEDING date'],
  // The same appositive with the citation FIRST. Letting the following date
  // claim the bracket cited November and returned the sibling's September as
  // this row's measured date, so both orders are pinned.
  [
    'Applied 2026-09-20 elsewhere (row 51), applied 2026-11-20 here',
    '2026-11-20',
    'bracketed pointer attaches backward even with a date after it',
  ],
  // The mirror image of that one, and the reason the rule is about punctuation
  // rather than position: the bracket sits against the verb that follows it, so
  // it is that application's subject and November stays this row's. Attributing
  // it backward lost November AND reported the sibling's September as measured,
  // outranking a real ledger date.
  [
    'Applied 2026-11-20 and (row 51) applied 2026-09-20',
    '2026-11-20',
    'a bracketed pointer against the next verb is its subject, not an appositive',
  ],
  // And the shape where the whole citation lives inside the bracket: the
  // pointer is still against the verb that follows it, just inside the group
  // rather than outside. Both of these resolved to September on this branch
  // before the punctuation rule, while `main` answered November by not reading
  // the pointer at all.
  [
    'Applied 2026-11-20 (row 51 applied 2026-09-20)',
    '2026-11-20',
    'a citation complete inside its own bracket does not take the date before it',
  ],
  // Direction is a property of the GROUP, not of each pointer in it. Measured
  // per pointer, the two here disagreed -- "row 51" read the comma before
  // "row 52" as an appositive's and attached backward, "row 52" sat against the
  // verb and attached forward -- so both dates were cited and the note was
  // reported as stating none, with the resolver falling back to the ledger.
  // Asserted in both directions, and after a nested group, since the group's
  // closing bracket is what has to be found.
  [
    'Applied 2026-11-20 and (row 51, row 52) applied 2026-09-20',
    '2026-11-20',
    'two pointers in one bracket, reading forward',
  ],
  [
    'Applied 2026-09-20 elsewhere (row 51, row 52), applied 2026-11-20 here',
    '2026-11-20',
    'two pointers in one bracket, reading backward',
  ],
  [
    'Applied 2026-11-20 and (via Ashby (US), row 51, row 52) applied 2026-09-20',
    '2026-11-20',
    'two pointers in one bracket, after a nested group',
  ],
  // An ENCLOSING bracket is somebody else's punctuation, so direction comes
  // from the innermost group holding the pointer. Reading it from the outermost
  // let a wrapper decide the answer: parenthesising the whole note made the
  // first of these read forward, returning the sibling's September, while the
  // bare note answered November. Both directions asserted wrapped, since a
  // wrapper must not change either.
  [
    '(Applied 2026-09-20 elsewhere (row 51), applied 2026-11-20 here)',
    '2026-11-20',
    'a wrapped note still attaches backward',
  ],
  [
    '(Applied 2026-11-20 and (row 51) applied 2026-09-20)',
    '2026-11-20',
    'a wrapped note still attaches forward',
  ],
  // Climbing out of an enclosing group is not punctuation this aside chose, so
  // the gap may hold the closing brackets of groups around it -- "((row 51))"
  // leaves a `)` before the verb. Both directions pinned at depth, since the
  // comma has to keep winning there, and the last case guards the other half of
  // that rule: a group OPENING in the gap is an intervening aside, not a climb.
  [
    'Applied 2026-11-20 and ((row 51)) applied 2026-09-20',
    '2026-11-20',
    'a double-bracketed subject still attaches forward',
  ],
  [
    'Applied 2026-09-20 elsewhere ((row 51)), applied 2026-11-20 here',
    '2026-11-20',
    'a double-bracketed appositive still attaches backward',
  ],
  [
    'Applied 2026-09-20 elsewhere (row 51) (via Ashby) applied 2026-11-20',
    '2026-11-20',
    'a second group in the gap is not a climb out of an enclosing one',
  ],
  // A TRAILING pointer cites the date before it only when it is bracketed. Both
  // of these put a pointer after a date with nothing after it, so position
  // alone cannot separate an appositive citation from prose that merely
  // COMPARES this submission with a sibling's. The second is a real tracker
  // row, found by replaying the model over one: calling it a citation discards
  // a genuine measured date.
  [
    'APPLIED 2026-11-13 via the Ashby form (https://jobs.example.com/x), confirmed submitted, same day as #267',
    '2026-11-13',
    'an unbracketed trailing pointer is a comparison, not a citation',
  ],
  ['Applied 2026-08-06 (Req #1311)', '2026-08-06', 'labelled-hash parenthetical after the date'],
  // Unlabelled too: inside brackets right after the date, the brackets do the
  // labelling, and this is how a posting id gets written by hand. "row 51" is
  // never a requisition, so only the word form attaches backward -- treating a
  // bare id as a citation here threw away a genuine measured date.
  ['Applied 2026-08-06 (#1311)', '2026-08-06', 'bare-hash parenthetical after the date'],
  ['Applied 2026-11-20 (via Greenhouse, see notes)', '2026-11-20', 'bracket naming no row'],
  ['Applied 2026-11-20; (row 51 is the other one)', '2026-11-20', 'a separator blocks the forward scan'],
  [
    'Applied 2026-11-20 (via Greenhouse; see row 51 for a different role)',
    '2026-11-20',
    'a separator INSIDE the bracket ends the citation',
  ],
  ['Applied 2026-11-20 (compare with row 51', '2026-11-20', 'an unfinished bracket is not a citation'],
  // A line break is a hard clause boundary, like a sentence break: a pointer's
  // subject never carries across one.
  ['Applied 2026-09-20 elsewhere (row 51)\nApplied 2026-11-20', '2026-11-20', 'a line break ends the pointer\'s scope'],
  // "this role" names the CURRENT row, so a rule that read such wording as a
  // reference to the sibling discarded this date.
  ['Sibling #154 is live; same ATS; Applied 2026-08-04 for this role', '2026-08-04', 'a pointer two clauses back does not carry'],

  // An undated pointer's subject carries across ONE semicolon-joined clause,
  // not a chain of them. Found by replaying the guard over a populated tracker:
  // a pointer ~110 chars and four clauses back disqualified a date that was
  // unmistakably the row's own, and no other scope rule ended it (there is no
  // sentence break, and the "citation already dated" test cannot fire because
  // "application" is not "applied").
  [
    'Not row 39 (a different employer); no prior application there; one-active-application policy '
    + 'unverified; posted: 2026-10-29; Applied 2026-10-30 via Greenhouse (job 9000001, req 1000)',
    '2026-10-30',
    "a pointer's scope does not survive a chain of clauses",
  ],
];

// A malformed value must be rejected, not truncated to a plausible date:
// truncating "2026-06-091" would be reported as a MEASURED application date.
const MALFORMED = [
  ['Applied 2026-06-091', 'a trailing digit'],
  ['Applied ~2026-06-091', 'a trailing digit after a tilde'],
  ['Applied 2026-06-09-foo', 'a hyphenated suffix'],
  ['Applied 2026-06-09foo', 'an unseparated word suffix'],
  ['Applied 2026-06-09_v2', 'an underscore suffix'],
  ['Applied 2026-06-09-2026-06-10', 'an ambiguous date range'],
  ['Applied 12026-06-09', 'a leading extra digit'],
];

test('a date cited about another row is not this row\'s', () => {
  for (const [notes, why] of FOREIGN) {
    assert.equal(parseAppliedDate(notes), null, `${why}: ${notes}`);
  }
});

test("a row's own date survives every exclusion", () => {
  for (const [notes, want, why] of OWN) {
    assert.equal(parseAppliedDate(notes), want, `${why}: ${notes}`);
  }
});

test('a malformed date is rejected, never truncated', () => {
  for (const [notes, why] of MALFORMED) {
    assert.equal(parseAppliedDate(notes), null, `${why}: ${notes}`);
  }
  assert.equal(
    parseAppliedDate('Applied 2026-06-091 (typo); Applied 2026-06-17 for real'),
    '2026-06-17',
    'the scan continues past a malformed candidate to a later valid one',
  );
});

// A typo in a CITATION is still the citation's. Validating dates before
// attributing them hid the impossible one from the clause model, which then
// read row 51's clause as undated, carried its scope into the next clause and
// discarded a valid own date -- so the note was reported as stating no date at
// all. Both callers must agree here: the cadence report validates, and
// followup-seed.mjs does not (it throws INVALID_DATE on a date it is asked to
// pin), and before the fix they disagreed on this note.
test('an impossible date in a citation does not cost this row its own date', () => {
  const notes = 'row 51 applied 2026-02-30; Applied 2026-06-17';

  assert.equal(parseAppliedDate(notes, { requireValidCalendarDate: true }), '2026-06-17');
  assert.equal(parseAppliedDate(notes), '2026-06-17');

  // Unchanged: when the IMPOSSIBLE date is the one this row claims, the
  // validating caller still gets null and degrades to a labelled fallback,
  // while the seeding caller still sees the raw value and can refuse it.
  assert.equal(parseAppliedDate('Applied 2026-02-30 via Ashby', { requireValidCalendarDate: true }), null);
  assert.equal(parseAppliedDate('Applied 2026-02-30 via Ashby'), '2026-02-30');
});

test('"reapplied" is not "applied"', () => {
  assert.equal(parseAppliedDate('reapplied 2026-06-09 after rejection'), null);
  assert.equal(parseAppliedDate('reapplied ~2026-06-09 after rejection'), null);
});

test('no apply date at all', () => {
  assert.equal(parseAppliedDate('On-archetype fit; no submission yet'), null);
  assert.equal(parseAppliedDate(''), null);
  assert.equal(parseAppliedDate(undefined), null);
});

// The point of returning null: the caller must degrade to a date that is
// LABELLED as not-measured, rather than report a foreign date as measured.
// The evaluation date and the ledger date are deliberately different values, so
// each assertion pins down which input was used as well as how it was labelled.
test('a cross-reference-only note degrades to a labelled fallback', () => {
  const notes = 'Second application: applied 2026-09-20 to their other Staff req (row 51, 4.6/5).';

  assert.deepEqual(
    resolveAppliedDate({ notes, date: '2026-11-18' }, '2026-11-20'),
    { appliedDate: '2026-11-20', appDateSource: 'status-log' },
    'the ledger date is preferred over the evaluation date, and labelled as the ledger',
  );

  assert.deepEqual(
    resolveAppliedDate({ notes, date: '2026-11-18' }, null),
    { appliedDate: '2026-11-18', appDateSource: 'evaluation-date-fallback' },
    'with no ledger entry, the evaluation date is used and labelled as a fallback',
  );
});

test("a note stating this row's own date is reported as measured", () => {
  assert.deepEqual(
    resolveAppliedDate({ notes: 'Applied 2026-11-20 via Ashby', date: '2026-11-18' }, '2026-11-19'),
    { appliedDate: '2026-11-20', appDateSource: 'notes' },
    'the notes outrank both the ledger and the evaluation date',
  );
});

// What the model deliberately cannot read, asserted so the limit is visible
// rather than discovered. An undated pointer's subject carries exactly one
// clause, so a pointer further back stops governing -- which is right for a
// note whose later clauses are about other things, and wrong for one that
// points back in words.
//
// Telling those apart needs the anaphora ("to that sibling") read. Matching
// such wording was tried and produced three fresh misattributions, including
// discarding a real date from "Applied 2026-08-04 for this role", where the
// wording names the CURRENT row. One documented limit in the cheaper direction
// beats three bugs, so these resolve to the row's own date.
test('known limit: a pointer that is referred back to in words is not followed', () => {
  for (const notes of [
    'Sibling #154 is live; same ATS; applied 2026-08-04 to that sibling',
    'Sibling #154 is live; same ATS; For that sibling, Applied 2026-08-04',
    'Sibling #154 is live; same ATS; Applied to that sibling on 2026-08-04',
  ]) {
    assert.equal(parseAppliedDate(notes), '2026-08-04', notes);
  }

  // One clause closer and it does carry, which is what keeps the common
  // two-roles-at-one-employer note correct.
  assert.equal(parseAppliedDate('Sibling #154 is live; applied 2026-08-04 to that sibling'), null);
});

// The two shapes the bracket rules cannot read, for the same reason: the note
// is structurally identical to one that means the opposite, so a reader uses
// the prose and this model cannot. Each is asserted in the direction that keeps
// a real measured date rather than the one that discards it.
test('known limit: a bracket can be read the other way round', () => {
  // With nothing but its own bracket between the pointer and the next
  // application, the subject reading wins; with a comma there, the appositive
  // reading does. Strip BOTH and the note is genuinely ambiguous -- only the
  // prose ("elsewhere", "here") separates the readings, so whichever way this
  // is attributed, some note of this shape is read the wrong way round.
  assert.equal(
    parseAppliedDate('Applied 2026-09-20 elsewhere (row 51) applied 2026-11-20 here'),
    '2026-09-20',
    'with no punctuation after the bracket, the pointer is the next date\'s subject',
  );

  // Past the end of a span a bare id is taken for this row's posting id, so a
  // genuine citation written that way is not followed. The word form is.
  assert.equal(
    parseAppliedDate('applied 2026-09-20 to their other req (#51)'),
    '2026-09-20',
    'a bare-hash citation after the date is read as a posting id',
  );
  assert.equal(parseAppliedDate('applied 2026-09-20 to their other req (row 51)'), null);
});
