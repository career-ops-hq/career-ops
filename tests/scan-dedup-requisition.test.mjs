// tests/scan-dedup-requisition.test.mjs — company+role dedupe honours
// requisition IDs.
//
// The company+role key collapses same-titled postings so a role re-listed at a
// new URL is not evaluated twice. That is wrong when the employer runs two
// genuinely different requisitions under one title at the same time. Live
// shape: UBC posted "Programmer Analyst I" as JR25919 (Automation Solution
// Delivery) and JR25853 (Facilities). JR25919 was in the tracker with
// "req JR25919" in its notes, and the scan dropped JR25853 as a duplicate on
// the day it closed.
//
// The halves this file gates:
//   - the requisition parse: Workday URL tails and labelled notes agree, and
//     Workday's `-N` repost suffix is the same requisition;
//   - a seeded row that named no requisition does not hide a later posting
//     that names one, including an Applied row. A candidate that names none
//     stays a duplicate;
//   - end to end through the CLI: the labelled tracker row lets JR25853 through
//     once (not again on a second run), and an Applied row with no requisition
//     lets later labelled openings through;
//   - a pipeline row whose scan-history write never landed keeps the
//     duplicate, since its requisition id was lost rather than absent.
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import {
  ANY_REQUISITION,
  appendToPipeline,
  appendToScanHistory,
  collectSeenCompanyRoles,
  companyRoleDedupKey,
  isDistinctRequisition,
  loadDedupSnapshot,
  matchesSeenCompanyRole,
  requisitionIdForDedup,
  requisitionIdsForDedup,
} from '../scan.mjs';

console.log('\nscan.mjs — requisition-aware company+role dedupe');

const WD = 'https://ubc.wd10.myworkdayjobs.com/ubcstaffjobs/job/UBC-Vancouver-Campus---Vancouver-BC-Canada';
const trackerWith = (notes, { company = 'UBC', role = 'Programmer Analyst I' } = {}) => `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-09-14 | ${company} | ${role} | 4.2/5 | Applied | ✅ | [001](../reports/001-ubc-2026-09-14.md) | ${notes} |
`;

// ── 1. Requisition parse ─────────────────────────────────────────────────────
// Each case lists EVERY form the source may name. One form when the source is
// known (a Workday URL strips the -N repost suffix, a non-Workday URL keeps the
// label whole); both forms when only a labelled note is available, so the
// decision never has to guess which board the note came from.
{
  const cases = [
    [{ url: `${WD}/Programmer-Analyst-I_JR25853` }, ['JR25853'], 'Workday URL tail'],
    [{ url: `${WD}/Development-Coordinator--Library_JR25830-1` }, ['JR25830'], 'Workday -N repost suffix is the same requisition'],
    [{ text: 'req JR25919; Deadline 2026-09-17' }, ['JR25919'], 'labelled tracker note'],
    [{ text: 'JR25919 one-year term' }, ['JR25919'], 'bare JR label'],
    [{ text: 'req JR25919-1; applied' }, ['JR25919-1', 'JR25919'], 'no URL: a copied -N tail yields both forms, so it still meets the Workday URL (PR #4267 review)'],
    [{ text: 'req ABC123-1' }, ['ABC123-1', 'ABC123'], 'no URL: a short -N suffix yields both forms, so it still meets a Lever title (PR #4267 review)'],
    [{ text: 'req ABC123-1', url: 'https://jobs.lever.co/acme/a1' }, ['ABC123-1'], 'known non-Workday URL keeps the -N suffix (it is part of the ID)'],
    [{ text: 'req ABC123-2', url: 'https://jobs.lever.co/acme/a2' }, ['ABC123-2'], 'known non-Workday URL: the sibling ID stays distinct'],
    [{ text: 'req R-2593225' }, ['R-2593225'], 'hyphenated non-Workday ID is one form even without a URL'],
    [{ url: `${WD}/Role_JR-017459-1` }, ['JR-017459'], 'Workday -N suffix on a hyphenated requisition is the same requisition (#3882)'],
    [{ text: 'req JR-017459-1' }, ['JR-017459-1', 'JR-017459'], 'no URL: a hyphenated ID with a copied -N tail yields both forms, so it meets the Workday URL (#3882)'],
    [{ text: 'req REQ-2026-10' }, ['REQ-2026-10'], 'a two-digit tail on a hyphenated base is part of the ID: one form (#3882)'],
    [{ url: 'https://careers.walmart.com/us/en/job/R-2593225' }, [], 'non-Workday URL is not parsed as a requisition'],
    [{ url: 'https://job-boards.greenhouse.io/acme/jobs/4244715009' }, [], 'generic board posting id is not a requisition'],
    [{ url: 'https://www.google.com/about/careers/applications/jobs/results/100000000000000001' }, ['100000000000000001'], 'Google careers job id in the URL path is the requisition'],
    [{ url: 'https://www.google.com/about/careers/applications/jobs/results/100000000000000002-software-engineer?location=Zurich' }, ['100000000000000002'], 'Google slugged URL yields the same id as the id-only form'],
    [{ url: 'https://www.google.com/about/careers/applications/jobs/results/?q=engineer' }, [], 'Google results page names no posting'],
    [{ url: 'https://www.example.com/about/careers/applications/jobs/results/100000000000000001' }, [], 'the Google id shape on another host is not read'],
    [{ text: 'remote Canada; base CAD 140K' }, [], 'unlabelled note'],
    [{ requisitionId: '*' }, [], 'a star id is the unknown marker, not a requisition'],
    [{ requisitionId: ' * ' }, [], 'a padded star is the unknown marker'],
    [{ requisitionId: '*', text: 'req JR25919' }, ['JR25919'], 'a star id falls through to labelled text'],
    [{ requisitionId: 'JR25919' }, ['JR25919'], 'a supplied id is kept'],
  ];
  for (const [input, want, label] of cases) {
    const got = requisitionIdsForDedup(input);
    if (JSON.stringify(got) === JSON.stringify(want)) pass(`requisitionIdsForDedup: ${label}`);
    else fail(`requisitionIdsForDedup: ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
  const single = requisitionIdForDedup({ text: 'req JR25919-1' });
  if (single === 'JR25919-1') pass('requisitionIdForDedup: returns the as-labelled form first');
  else fail(`requisitionIdForDedup: got ${JSON.stringify(single)}, want "JR25919-1"`);
}

// ── 2. Decision is conservative ──────────────────────────────────────────────
{
  const checks = [
    [new Set(['JR25919']), ['JR25853'], true, 'different labelled requisition is distinct'],
    [new Set(['ABC123-1']), ['ABC123-2'], true, 'non-Workday ABC123-1 vs ABC123-2 stay distinct requisitions'],
    [new Set(['JR25919']), ['JR25919'], false, 'same requisition is a duplicate'],
    [new Set(['JR25919-1', 'JR25919']), ['JR25919'], false, 'ambiguous note seeded both forms: the Workday URL form hits one'],
    [new Set(['ABC123-1', 'ABC123']), ['ABC123-1'], false, 'ambiguous note seeded both forms: the Lever title form hits one'],
    [new Set(['ABC123-1', 'ABC123']), ['ABC123-2'], true, 'ambiguous note seeded both forms: the Lever sibling hits neither'],
    [new Set(['JR25919']), 'JR25919', false, 'a bare string candidate is still accepted'],
    [new Set(['JR25919', ANY_REQUISITION]), 'JR25853', true, 'an unlabelled seed does not hide a different labelled id'],
    [new Set([ANY_REQUISITION]), 'JR25853', true, 'a seed that named no requisition does not hide a later id'],
    [new Set([ANY_REQUISITION]), requisitionIdsForDedup({ requisitionId: '*' }), false, 'a star id against an unlabelled seed is the same opening'],
    [new Set([ANY_REQUISITION]), null, false, 'a seed that named no requisition still hides a later row with no id'],
    [new Set(['JR25919']), null, false, 'an unlabelled candidate keeps the duplicate'],
    [undefined, 'JR25853', false, 'no seed data keeps the duplicate'],
  ];
  for (const [seeded, candidate, want, label] of checks) {
    if (isDistinctRequisition(seeded, candidate) === want) pass(`isDistinctRequisition: ${label}`);
    else fail(`isDistinctRequisition: ${label} — expected ${want}`);
  }
}

// ── 3. Seeding reads every source ────────────────────────────────────────────
{
  const requisitionsByBase = new Map();
  collectSeenCompanyRoles({
    applicationsText: trackerWith('req JR25919'),
    pipelineText: `- [x] ${WD}/Programmer-Analyst-I_JR25919 | UBC | Programmer Analyst I | applied\n`,
    scanHistoryText: `url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n${WD}/Programmer-Analyst-I_JR25919\t2026-09-14\tUBC\tProgrammer Analyst I\tUBC\tadded\tVancouver\n`,
  }, {}, undefined, { requisitionsByBase });
  const seeded = requisitionsByBase.get(companyRoleDedupKey('UBC', 'Programmer Analyst I'));
  // The note has no -N suffix, so it contributes one form — the same one the
  // two URLs contribute.
  if (seeded && seeded.size === 1 && seeded.has('JR25919')) {
    pass('collectSeenCompanyRoles: tracker note, pipeline URL and scan-history URL all seed the same requisition');
  } else {
    fail(`collectSeenCompanyRoles seeded [${seeded ? [...seeded].join(', ') : 'nothing'}], want [JR25919]`);
  }
}

// ── 3a. Google: a second opening with the same title and city is not a duplicate
{
  const G = 'https://www.google.com/about/careers/applications/jobs/results/';
  const seenOpening = `${G}100000000000000001-software-engineer`;
  const seed = (scanHistoryText) => {
    const requisitionsByBase = new Map();
    const result = collectSeenCompanyRoles({ scanHistoryText }, {}, undefined, { requisitionsByBase });
    return { requisitionsByBase, result, base: companyRoleDedupKey('Google', 'Software Engineer') };
  };
  const history = `url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n${seenOpening}\t2026-10-01\tGoogle\tSoftware Engineer\tGoogle\tadded\tZurich\n`;
  const { requisitionsByBase, base } = seed(history);
  const seeded = requisitionsByBase.get(base);
  if (seeded && seeded.size === 1 && seeded.has('100000000000000001')) pass('collectSeenCompanyRoles: a Google scan-history URL seeds its job id');
  else fail(`collectSeenCompanyRoles seeded [${seeded ? [...seeded].join(', ') : 'nothing'}], want [100000000000000001]`);

  const other = requisitionIdsForDedup({ url: `${G}200000000000000002-software-engineer` });
  if (isDistinctRequisition(seeded, other)) pass('a Google opening under a new job id is a distinct requisition');
  else fail('a Google opening under a new job id was treated as a duplicate');
  const same = requisitionIdsForDedup({ url: `${G}100000000000000001` });
  if (!isDistinctRequisition(seeded, same)) pass('the same Google job id, slugged or not, is still a duplicate');
  else fail('the same Google job id was treated as a distinct requisition');
  // A Google URL that names no posting (the results page) is a real row that
  // names no requisition: it seeds the wildcard. That is not proof of which
  // opening it was, so a later opening that names a job id comes back, and a
  // later row that names none stays hidden.
  const noId = seed(`url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n${G}?q=software-engineer\t2026-10-01\tGoogle\tSoftware Engineer\tGoogle\tadded\tZurich\n`);
  const wildcard = noId.requisitionsByBase.get(noId.base);
  if (wildcard && wildcard.size === 1 && wildcard.has(ANY_REQUISITION)) pass('a Google URL with no job id seeds the wildcard requisition');
  else fail(`a Google URL with no job id seeded [${wildcard ? [...wildcard].join(', ') : 'nothing'}], want [${ANY_REQUISITION}]`);
  if (wildcard && isDistinctRequisition(wildcard, other)) pass('a Google row with no job id lets a later opening that names one come back');
  else fail('a Google row with no job id hid a later opening that names a job id');
  if (wildcard && !isDistinctRequisition(wildcard, [])) pass('a Google row with no job id still hides a later row that names none');
  else fail('a Google row with no job id let a later row with no id through');
  // A row with an empty URL is skipped by the seeder outright, so it seeds
  // nothing at all (kept apart from the wildcard case above).
  const noUrl = seed(`url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n\t2026-10-01\tGoogle\tSoftware Engineer\tGoogle\tadded\tZurich\n`);
  if (noUrl.requisitionsByBase.get(noUrl.base) === undefined) pass('a scan-history row with an empty URL seeds nothing');
  else fail('a scan-history row with an empty URL was seeded');
}

// An Applied row with no requisition in its notes is not proof of which
// opening was applied to. The same title posted again with an id comes back.
// The same title posted again with no id stays hidden.
{
  const requisitionsByBase = new Map();
  collectSeenCompanyRoles({
    applicationsText: trackerWith('applied; hybrid unconfirmed'),
  }, {}, undefined, { requisitionsByBase });
  const key = companyRoleDedupKey('UBC', 'Programmer Analyst I');
  const seeded = requisitionsByBase.get(key);
  const state = {
    key,
    baseKey: key,
    seen: new Set([key]),
    requisitions: requisitionsByBase,
    locatedRequisitions: new Map(),
  };
  const labelled = requisitionIdsForDedup({ url: `${WD}/Programmer-Analyst-I_JR25919` });
  const comesBack = matchesSeenCompanyRole(state, labelled) === false;
  const staysHidden = matchesSeenCompanyRole(state, []) === true;
  if (seeded?.size === 1 && seeded.has(ANY_REQUISITION) && comesBack && staysHidden) {
    pass('an Applied row with no requisition lets the same title come back once it names an id');
  } else {
    fail(`Applied row with no requisition: seeded [${seeded ? [...seeded].join(', ') : 'nothing'}], comesBack ${comesBack}, staysHidden ${staysHidden}`);
  }
}

// ── 3b. A tracker with a URL column passes the URL through ───────────────────
{
  const requisitionsByBase = new Map();
  collectSeenCompanyRoles({
    applicationsText: `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |
|---|------|---------|------|-------|--------|-----|--------|-------|-----|
| 1 | 2026-09-14 | Acme | Engineer | 4.0/5 | Applied | ✅ | [001](../reports/001-acme-2026-09-14.md) | req ABC123-1 | https://jobs.lever.co/acme/a1 |
`,
  }, {}, undefined, { requisitionsByBase });
  const seeded = requisitionsByBase.get(companyRoleDedupKey('Acme', 'Engineer'));
  if (seeded && seeded.size === 1 && seeded.has('ABC123-1')) {
    pass('collectSeenCompanyRoles: a tracker URL column reaches the parser, so a Lever row keeps ABC123-1 whole');
  } else {
    fail(`collectSeenCompanyRoles (URL column) seeded [${seeded ? [...seeded].join(', ') : 'nothing'}], want [ABC123-1]`);
  }
}

// ── 4. END-TO-END: two scan runs over the two-requisition board ─────────────
const UBC_BOARD = {
  company: 'UBC', role: 'Programmer Analyst I', titleFilter: 'Programmer Analyst',
  careersUrl: 'https://ubc.wd10.myworkdayjobs.com/ubcstaffjobs', script: 'tests/fixtures/two-requisition-board.mjs',
};
const LEVER_BOARD = {
  company: 'Acme', role: 'Engineer - req ABC123-1', titleFilter: 'Engineer',
  careersUrl: 'https://jobs.lever.co/acme', script: 'tests/fixtures/lever-suffixed-requisitions-board.mjs',
};

const LOCATION_BOARD = {
  company: 'Acme', role: 'Engineer', titleFilter: 'Engineer',
  careersUrl: 'https://acme.wd1.myworkdayjobs.com/careers',
  script: 'tests/fixtures/location-requisition-board.mjs',
  history: `url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation
https://acme.wd1.myworkdayjobs.com/careers/job/London/Engineer_JR100\t2026-09-22\tAcme\tEngineer\tAcme\tadded\tLondon
https://acme.wd1.myworkdayjobs.com/careers/job/New-York/Engineer_JR200\t2026-09-22\tAcme\tEngineer\tAcme\tadded\tNew York
`,
};

function runScanTwice(trackerNotes, board = UBC_BOARD) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-reqdedup-e2e-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'applications.md'), board.history ? '' : trackerWith(trackerNotes, board));
    if (board.history) writeFileSync(join(dir, 'data', 'scan-history.tsv'), board.history);
    writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n');

    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, `scan_history:
  dedup_include_location: true
title_filter:
  positive:
    - "${board.titleFilter}"
tracked_companies:
  - name: ${board.company}
    careers_url: ${board.careersUrl}
    parser:
      command: node
      script: ${board.script}
`);

    // An inherited CAREER_OPS_* override (a shell or CI setting) could point
    // the child away from this temp folder, so none of them pass through.
    const inherited = Object.fromEntries(Object.entries(process.env)
      .filter(([k]) => !k.toUpperCase().startsWith('CAREER_OPS_')));
    const scan = () => execFileSync(NODE, [join(ROOT, 'scan.mjs')], {
      cwd: dir,
      env: { ...inherited, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: portals },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const entries = () => {
      const p = join(dir, 'data', 'pipeline.md');
      if (!existsSync(p)) return [];
      return readFileSync(p, 'utf-8').split('\n').filter(l => /^- \[[ x]\]\s+https?:\/\//.test(l));
    };

    scan();
    const afterFirst = entries();
    scan();
    const afterSecond = entries();
    return { afterFirst, afterSecond };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const { afterFirst, afterSecond } = runScanTwice('', LOCATION_BOARD);
  if (afterFirst.length === 1 && afterFirst[0].includes('/London/Engineer_JR200') && afterSecond.length === 1) {
    pass('e2e: a requisition seen only in New York does not suppress London; second scan adds nothing');
  } else {
    fail(`e2e location requisitions: ${JSON.stringify({afterFirst, afterSecond})}`);
  }
}

for (const notes of ['JR 25919; applied', 'JR:25919; applied', 'JR #25919; applied']) {
  const { afterFirst, afterSecond } = runScanTwice(notes);
  if (afterFirst.length === 1 && afterFirst[0].includes('_JR25853') && afterSecond.length === 1) {
    pass(`e2e: separated label ${notes} recognises the applied Workday requisition`);
  } else fail(`e2e separated label: ${JSON.stringify({notes, afterFirst, afterSecond})}`);
}

for (const notes of ['Req #25919; applied', 'req 25919; applied']) {
  const { afterFirst, afterSecond } = runScanTwice(notes);
  const both = afterFirst.length === 2
    && afterFirst.some((line) => line.includes('_JR25919'))
    && afterFirst.some((line) => line.includes('_JR25853'))
    && afterSecond.length === 2;
  if (both) pass(`e2e: a note with no requisition id lets both openings through once (${notes})`);
  else fail(`e2e numeric note: ${JSON.stringify({notes, afterFirst, afterSecond})}`);
}

{
  try {
    const { afterFirst, afterSecond } = runScanTwice('req JR25919; applied');
    if (afterFirst.length === 1 && afterFirst[0].includes('_JR25853') && afterSecond.length === 1) {
      pass('e2e: labelled tracker row lets the other requisition through once, and not again on run 2');
    } else {
      fail(`e2e labelled: run 1 ${JSON.stringify(afterFirst)}, run 2 has ${afterSecond.length} (want only JR25853, once)`);
    }
  } catch (err) {
    fail(`e2e scan run (labelled tracker) failed: ${err.message}`);
  }
}

{
  // Mixed representations of one requisition: the note carries Workday's -N
  // repost suffix, the board URL does not. Before the suffix rule was shared,
  // the note read as a third requisition and the applied JR25919 was re-queued.
  try {
    const { afterFirst, afterSecond } = runScanTwice('req JR25919-1; applied');
    if (afterFirst.length === 1 && afterFirst[0].includes('_JR25853') && afterSecond.length === 1) {
      pass('e2e: a note with the -N repost suffix still recognises the applied requisition, only JR25853 queued');
    } else {
      fail(`e2e -N suffix note: run 1 ${JSON.stringify(afterFirst)}, run 2 has ${afterSecond.length} (want only JR25853, once)`);
    }
  } catch (err) {
    fail(`e2e scan run (-N suffix note) failed: ${err.message}`);
  }
}

{
  // The other half of the same ambiguity, on a board where the -N suffix is
  // part of the ID. The tracker note names `req ABC123-1` with no URL column;
  // the Lever posting's own form is `ABC123-1`. Guessing the Workday reading
  // (`123`) for the note made the applied posting look distinct and re-queued
  // it; carrying both forms recognises it, and only ABC123-2 is queued.
  try {
    const { afterFirst, afterSecond } = runScanTwice('req ABC123-1; applied', LEVER_BOARD);
    if (afterFirst.length === 1 && afterFirst[0].includes('/acme/a2') && afterSecond.length === 1) {
      pass('e2e: a no-URL note with a short -N suffix still recognises the applied Lever posting, only ABC123-2 queued');
    } else {
      fail(`e2e no-URL note vs Lever: run 1 ${JSON.stringify(afterFirst)}, run 2 has ${afterSecond.length} (want only /acme/a2, once)`);
    }
  } catch (err) {
    fail(`e2e scan run (no-URL note vs Lever) failed: ${err.message}`);
  }
}

{
  try {
    const { afterFirst, afterSecond } = runScanTwice('applied; hybrid unconfirmed');
    const both = afterFirst.length === 2
      && afterFirst.some((line) => line.includes('_JR25919'))
      && afterFirst.some((line) => line.includes('_JR25853'))
      && afterSecond.length === 2;
    if (both) {
      pass('e2e control: an unlabelled tracker row does not hide later openings that name a requisition');
    } else {
      fail(`e2e control: ${afterFirst.length} entries after run 1, ${afterSecond.length} after run 2 (want both requisitions, once)`);
    }
  } catch (err) {
    fail(`e2e scan run (unlabelled tracker) failed: ${err.message}`);
  }
}


// ── 5. Review regressions (PR #4267, second round) ───────────────────────────
// Each block pins one finding from the review of the both-forms parser.
{
  const eq = (label, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) pass(label);
    else fail(`${label} — expected ${e}, got ${a}`);
  };
  const ids = requisitionIdsForDedup;
  const lever = 'https://jobs.lever.co/acme/a1';

  // 5a. Prefixes and punctuation identify a requisition. Stripping the
  // leading letters made ABC123-1 and XYZ123-1 both read 1231, so one seeded
  // requisition suppressed the other.
  for (const [a, b] of [['ABC123-1', 'XYZ123-1'], ['ABC123-1', 'ABC1231']]) {
    eq(`prefix kept: ${a} and ${b} on a non-Workday board are distinct`,
      isDistinctRequisition(new Set(ids({ url: lever, text: `req ${a}` })), ids({ url: lever, text: `req ${b}` })), true);
  }
  eq('prefix kept: comparison ignores case only', ids({ url: lever, text: 'req abc123-1' }), ['ABC123-1']);
  eq('prefix kept: bare JR token keeps the prefix the label consumed', ids({ text: 'JR25919' }), ['JR25919']);
  eq('prefix kept: glued JR-10423 is literal', ids({ text: 'JR-10423' }), ['JR-10423']);
  eq('prefix kept: bare R_ token keeps its prefix', ids({ text: 'R_1488728' }), ['R_1488728']);

  // 5b. A separated label (`JR 25919`, `JR:25919`) is the same requisition as
  // the URL tail `_JR25919`; glued punctuation (`JR-25919`) is part of the ID.
  for (const text of ['JR 25919', 'JR:25919', 'jr: #25919', 'JR #25919']) {
    eq(`separated label: "${text}" re-attaches JR`, ids({ text }), ['JR25919']);
  }
  for (const text of ['R_ 1488728', 'R_:1488728', 'r_#1488728']) {
    eq(`separated label: "${text}" re-attaches R_`, ids({ text }), ['R_1488728']);
  }
  eq('separated label: glued JR-25919 stays literal', ids({ text: 'JR-25919' }), ['JR-25919']);
  eq('separated label: glued JR_25919 stays literal', ids({ text: 'JR_25919' }), ['JR_25919']);
  eq('separated label: literal JR-25919 and JR25919 stay distinct on a non-Workday board',
    isDistinctRequisition(new Set(ids({ url: lever, text: 'JR-25919' })), ids({ url: lever, text: 'JR25919' })), true);

  // 5c. Numeric-only text (`Req #25919`) may have dropped a prefix, so it is
  // not a requisition id. As a candidate it yields no form and stays a
  // duplicate. As a seed it records only the wildcard, which does not hide a
  // later row that names an id. A numeric Workday URL tail is still usable.
  for (const text of ['Req #25919', 'req 25919', 'req 25919-1']) {
    eq(`numeric-only note: "${text}" yields no form`, ids({ text }), []);
    eq(`numeric-only note: "${text}" as a candidate is never distinct`,
      isDistinctRequisition(new Set(['JR25919']), ids({ text })), false);
    const requisitions = new Map();
    collectSeenCompanyRoles({
      applicationsText: trackerWith(text, { company: 'Acme', role: 'Engineer' }),
    }, {}, undefined, { requisitionsByBase: requisitions });
    const seeded = requisitions.get(companyRoleDedupKey('Acme', 'Engineer'));
    eq(`numeric-only note: "${text}" seeds only the wildcard`,
      seeded instanceof Set && seeded.size === 1 && seeded.has(ANY_REQUISITION), true);
    eq(`numeric-only note: "${text}" does not hide a later labelled id`,
      isDistinctRequisition(seeded, ['JR25919']), true);
  }
  eq('numeric Workday URL tail is still a form', ids({ url: 'https://acme.wd1.myworkdayjobs.com/jobs/job/Engineer_25919' }), ['25919']);

  // 5d. A known Workday URL whose last segment has no underscore yields no
  // URL form; the labelled text must then use ONLY the stripped form, or a
  // non-Workday JR25919-1 seen earlier could suppress the Workday candidate
  // through the unstripped one.
  const workday = 'https://acme.wd1.myworkdayjobs.com/careers/job/London/Engineer';
  eq('known Workday URL without an underscore: only the stripped text form', ids({ url: workday, text: 'req JR25919-1' }), ['JR25919']);
  eq('known Workday URL without an underscore: a seeded literal JR25919-1 does not suppress it',
    isDistinctRequisition(new Set(['JR25919-1']), ids({ url: workday, text: 'req JR25919-1' })), true);
  eq('no URL: both forms, as before', ids({ text: 'req JR25919-1' }), ['JR25919-1', 'JR25919']);

  // 5e. Requisitions are recorded under the key that matched, so a
  // requisition seen only in New York cannot suppress a new London opening,
  // while a locationless candidate still meets the aggregate of located rows
  // and a locationless wildcard row still meets every located candidate.
  const history = `url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation
${workday}_JR100\t2026-09-22\tAcme\tEngineer\tAcme\tadded\tLondon
${workday.replace('London', 'New-York')}_JR200\t2026-09-22\tAcme\tEngineer\tAcme\tadded\tNew York
`;
  for (const includeLocation of [true, false]) {
    const tag = includeLocation ? 'located keys' : 'bare keys';
    const requisitions = new Map();
    const locatedRequisitions = new Map();
    const seen = collectSeenCompanyRoles({ scanHistoryText: history }, {}, undefined, {
      includeLocation, requisitionsByBase: requisitions, locatedRequisitionsByBase: locatedRequisitions,
    });
    const baseKey = companyRoleDedupKey('Acme', 'Engineer');
    const matches = (location, candidate) => matchesSeenCompanyRole({
      key: companyRoleDedupKey('Acme', 'Engineer', undefined, includeLocation ? location : undefined),
      baseKey, seen, requisitions, locatedRequisitions,
    }, candidate);
    eq(`${tag}: London JR200 is a duplicate only when locations are not part of the key`, matches('London', ['JR200']), !includeLocation);
    eq(`${tag}: London JR100 is a duplicate`, matches('London', ['JR100']), true);
    eq(`${tag}: a locationless JR200 candidate meets the located row`, matches(undefined, ['JR200']), true);
    eq(`${tag}: a locationless JR300 candidate is distinct`, matches(undefined, ['JR300']), false);
    if (includeLocation) {
      eq('located keys: nothing is recorded under the bare key', requisitions.has(baseKey), false);
      eq('located keys: an unseen city with no requisition is not a duplicate', matches('Paris', []), false);
      requisitions.get(companyRoleDedupKey('Acme', 'Engineer', undefined, 'New York')).add(ANY_REQUISITION);
      locatedRequisitions.get(baseKey).add(ANY_REQUISITION);
      eq('located keys: an unlabelled New York row does not poison London', matches('London', ['JR200']), false);
      eq('located keys: an unlabelled located row does not hide a later labelled id', matches(undefined, ['JR300']), false);
      seen.add(baseKey);
      requisitions.set(baseKey, new Set(['JR200']));
      eq('located keys: a locationless JR200 wildcard row catches London JR200', matches('London', ['JR200']), true);
      requisitions.set(baseKey, new Set([ANY_REQUISITION]));
      eq('located keys: an unlabelled locationless row does not hide a later labelled id', matches('Paris', ['JR300']), false);
      eq('located keys: an unlabelled locationless row still hides a later row with no id', matches('Paris', []), true);
    }
  }
}

// ── 6. Only the pipeline write landed (PR #7138 review) ──────────────────────
// The scanner writes pipeline.md first and scan-history second, and a
// provider-only requisition id lives in scan-history alone. When the history
// write fails, the pipeline row has lost its id, not named none, so a new URL
// for the same requisition must stay a duplicate. Once history has the row,
// the id is back; a history row that names no id lets a labelled opening in.
{
  const offer = (url, requisitionId) => ({
    url, company: 'Acme', title: 'Engineer', source: 'fixture', ...(requisitionId ? { requisitionId } : {}),
  });
  const seenOpening = 'https://jobs.example.com/acme/1001';
  const candidate = (snapshot, requisition) => matchesSeenCompanyRole({
    key: companyRoleDedupKey('Acme', 'Engineer'),
    baseKey: companyRoleDedupKey('Acme', 'Engineer'),
    seen: snapshot.seenCompanyRoles,
    requisitions: snapshot.seenCompanyRoleRequisitions,
    locatedRequisitions: snapshot.locatedRequisitionsByBase,
  }, requisition);
  const run = async (historyOffer) => {
    const dir = mkdtempSync(join(tmpdir(), 'scan-reqdedup-pipeline-only-'));
    try {
      const pipelinePath = join(dir, 'pipeline.md');
      const scanHistoryPath = join(dir, 'scan-history.tsv');
      const applicationsPath = join(dir, 'applications.md');
      await appendToPipeline([offer(seenOpening, 'JR100')], { pipelinePath, scanHistoryPath, historyPolicy: {} });
      if (historyOffer) await appendToScanHistory([historyOffer], '2026-11-02', 'added', { historyPath: scanHistoryPath, historyPolicy: {} });
      return loadDedupSnapshot({}, undefined, { pipelinePath, scanHistoryPath, applicationsPath });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const eq = (label, actual, expected) => {
    if (actual === expected) pass(label);
    else fail(`${label}: got ${actual}, want ${expected}`);
  };

  const pipelineOnly = await run(null);
  eq('pipeline-only write: a new URL for JR100 stays a duplicate', candidate(pipelineOnly, ['JR100']), true);

  const skippedOnlyDir = mkdtempSync(join(tmpdir(), 'scan-reqdedup-skipped-only-'));
  try {
    const pipelinePath = join(skippedOnlyDir, 'pipeline.md');
    const scanHistoryPath = join(skippedOnlyDir, 'scan-history.tsv');
    const applicationsPath = join(skippedOnlyDir, 'applications.md');
    await appendToScanHistory([offer(seenOpening)], '2026-11-01', 'skipped_title', { historyPath: scanHistoryPath, historyPolicy: {} });
    await appendToPipeline([offer(seenOpening, 'JR100')], { pipelinePath, scanHistoryPath, historyPolicy: {} });
    const skippedOnly = loadDedupSnapshot({}, undefined, { pipelinePath, scanHistoryPath, applicationsPath });
    eq('an older skipped row is not the accepted write: JR100 stays a duplicate', candidate(skippedOnly, ['JR100']), true);
  } finally {
    rmSync(skippedOnlyDir, { recursive: true, force: true });
  }
  eq('pipeline-only write: a new URL with no id stays a duplicate', candidate(pipelineOnly, []), true);

  const both = await run(offer(seenOpening, 'JR100'));
  eq('both writes: a new URL for JR100 is a duplicate', candidate(both, ['JR100']), true);
  eq('both writes: JR200 under the same title is a different opening', candidate(both, ['JR200']), false);

  const noId = await run(offer(seenOpening));
  eq('history names no id: a labelled JR100 opening is not hidden', candidate(noId, ['JR100']), false);
  eq('history names no id: a later row with no id stays a duplicate', candidate(noId, []), true);
}
