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
//   - the decision is conservative: any seeded row without a requisition, or a
//     candidate without one, keeps the historical "duplicate" answer;
//   - end to end through the CLI: the labelled tracker row lets JR25853 through
//     once (not again on a second run), and an unlabelled tracker row still
//     suppresses both.
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import {
  ANY_REQUISITION,
  collectSeenCompanyRoles,
  companyRoleDedupKey,
  isDistinctRequisition,
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
    [{ url: `${WD}/Programmer-Analyst-I_JR25853` }, ['25853'], 'Workday URL tail'],
    [{ url: `${WD}/Development-Coordinator--Library_JR25830-1` }, ['25830'], 'Workday -N repost suffix is the same requisition'],
    [{ text: 'req JR25919; Deadline 2026-09-17' }, ['25919'], 'labelled tracker note'],
    [{ text: 'JR25919 one-year term' }, ['25919'], 'bare JR label'],
    [{ text: 'req JR25919-1; applied' }, ['259191', '25919'], 'no URL: a copied -N tail yields both forms, so it still meets the Workday URL (PR #4267 review)'],
    [{ text: 'req ABC123-1' }, ['1231', '123'], 'no URL: a short -N suffix yields both forms, so it still meets a Lever title (PR #4267 review)'],
    [{ text: 'req ABC123-1', url: 'https://jobs.lever.co/acme/a1' }, ['1231'], 'known non-Workday URL keeps the -N suffix (it is part of the ID)'],
    [{ text: 'req ABC123-2', url: 'https://jobs.lever.co/acme/a2' }, ['1232'], 'known non-Workday URL: the sibling ID stays distinct'],
    [{ text: 'req R-2593225' }, ['2593225'], 'hyphenated non-Workday ID is one form even without a URL'],
    [{ url: 'https://careers.walmart.com/us/en/job/R-2593225' }, [], 'non-Workday URL is not parsed as a requisition'],
    [{ url: 'https://job-boards.greenhouse.io/acme/jobs/4244715009' }, [], 'generic board posting id is not a requisition'],
    [{ text: 'remote Canada; base CAD 140K' }, [], 'unlabelled note'],
  ];
  for (const [input, want, label] of cases) {
    const got = requisitionIdsForDedup(input);
    if (JSON.stringify(got) === JSON.stringify(want)) pass(`requisitionIdsForDedup: ${label}`);
    else fail(`requisitionIdsForDedup: ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
  const single = requisitionIdForDedup({ text: 'req JR25919-1' });
  if (single === '259191') pass('requisitionIdForDedup: returns the as-labelled form first');
  else fail(`requisitionIdForDedup: got ${JSON.stringify(single)}, want "259191"`);
}

// ── 2. Decision is conservative ──────────────────────────────────────────────
{
  const checks = [
    [new Set(['25919']), ['25853'], true, 'different labelled requisition is distinct'],
    [new Set(['1231']), ['1232'], true, 'non-Workday ABC123-1 vs ABC123-2 stay distinct requisitions'],
    [new Set(['25919']), ['25919'], false, 'same requisition is a duplicate'],
    [new Set(['259191', '25919']), ['25919'], false, 'ambiguous note seeded both forms: the Workday URL form hits one'],
    [new Set(['1231', '123']), ['1231'], false, 'ambiguous note seeded both forms: the Lever title form hits one'],
    [new Set(['1231', '123']), ['1232'], true, 'ambiguous note seeded both forms: the Lever sibling hits neither'],
    [new Set(['25919']), '25919', false, 'a bare string candidate is still accepted'],
    [new Set(['25919', ANY_REQUISITION]), '25853', false, 'an unlabelled seed keeps the duplicate'],
    [new Set(['25919']), null, false, 'an unlabelled candidate keeps the duplicate'],
    [undefined, '25853', false, 'no seed data keeps the duplicate'],
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
  if (seeded && seeded.size === 1 && seeded.has('25919')) {
    pass('collectSeenCompanyRoles: tracker note, pipeline URL and scan-history URL all seed the same requisition');
  } else {
    fail(`collectSeenCompanyRoles seeded [${seeded ? [...seeded].join(', ') : 'nothing'}], want [25919]`);
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
  if (seeded && seeded.size === 1 && seeded.has('1231')) {
    pass('collectSeenCompanyRoles: a tracker URL column reaches the parser, so a Lever row keeps ABC123-1 whole');
  } else {
    fail(`collectSeenCompanyRoles (URL column) seeded [${seeded ? [...seeded].join(', ') : 'nothing'}], want [1231]`);
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

function runScanTwice(trackerNotes, board = UBC_BOARD) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-reqdedup-e2e-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'applications.md'), trackerWith(trackerNotes, board));
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

    const scan = () => execFileSync(NODE, [join(ROOT, 'scan.mjs')], {
      cwd: dir,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: portals },
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
  // the Lever posting's own form is `1231`. Guessing the Workday reading
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
    if (afterFirst.length === 0 && afterSecond.length === 0) {
      pass('e2e control: an unlabelled tracker row still suppresses every same-titled posting');
    } else {
      fail(`e2e control: ${afterFirst.length} entries after run 1, ${afterSecond.length} after run 2 (want 0 and 0)`);
    }
  } catch (err) {
    fail(`e2e scan run (unlabelled tracker) failed: ${err.message}`);
  }
}
