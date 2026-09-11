// tests/scan-recheck-pipeline-repin.test.mjs — `scan_history.recheck_after_days`
// must actually release a row, and must not release one that is still queued.
//
// collectSeenUrls builds the seen-set from three sources. Only the first,
// scan-history.tsv, consults the age policy; pipeline.md and applications.md are
// parsed with no policy at all. Every URL in scan-history that has ever been
// queued is also in pipeline.md, so a row the TTL released was re-pinned a few
// lines later and the window freed nothing on any install with a pipeline —
// which is every install past its first run. The counter said otherwise: it was
// incremented at the release site, before the two later sources could pin the
// row again, so it reported rows as "eligible again" that the same call had
// already put back in the set.
//
// The release cannot be unconditional, and that is the other half of the
// invariant. A `- [ ]` row under ## Pending is a line the user can still pull
// from: re-scanning it appends a SECOND copy of a job already on the list. Only
// finished work — `- [x]`, or anything under ## Processed — is safe to hand back
// to the TTL, and only when scan-history is what released it. A pipeline-only
// URL has no scan-history row to have released it, so it stays pinned whatever
// its checkbox says.
import { pass, fail } from './helpers.mjs';
import { collectSeenUrls } from '../scan.mjs';

console.log('\nscan.mjs — recheck_after_days survives the pipeline.md pass');

const HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation';
const DONE = 'https://boards.greenhouse.io/acme/jobs/1';
const OPEN = 'https://boards.greenhouse.io/acme/jobs/2';
const PROCESSED = 'https://jobs.lever.co/beta/3';
const PIPELINE_ONLY = 'https://jobs.ashbyhq.com/gamma/4';
const FRESH = 'https://boards.greenhouse.io/delta/5';
const PROCESSED_CHILD = 'https://jobs.lever.co/beta/6';
const NESTED_IN_PENDING = 'https://boards.greenhouse.io/epsilon/7';

// today = 2026-08-07, window = 30d. The 2026-01-01 rows are past it; the
// 2026-08-01 row is inside it.
const POLICY = { recheckAfterDays: 30, today: '2026-08-07' };

const SOURCES = {
  scanHistoryText: [
    HEADER,
    `${DONE}\t2026-01-01\tgreenhouse\tQuant\tAcme\tadded\tNY`,
    `${OPEN}\t2026-01-01\tgreenhouse\tTrader\tAcme\tadded\tNY`,
    `${PROCESSED}\t2026-01-01\tlever\tSRE\tBeta\tadded\tBerlin`,
    `${FRESH}\t2026-08-01\tgreenhouse\tAnalyst\tDelta\tadded\tRemote`,
    `${PROCESSED_CHILD}\t2026-01-01\tlever\tOps\tBeta\tadded\tBerlin`,
    `${NESTED_IN_PENDING}\t2026-01-01\tgreenhouse\tWriter\tEpsilon\tadded\tRemote`,
    '',
  ].join('\n'),
  pipelineText: [
    '# Pipeline — Pending URLs',
    '',
    '## Pending',
    '',
    `- [ ] ${OPEN} | Acme | Trader | NY`,
    `- [x] ${DONE} | Acme | Quant | NY`,
    `- [ ] ${PIPELINE_ONLY} | Gamma | Researcher | Remote`,
    // A subdivision inside ## Pending whose name happens to start with
    // "Processed". It is still Pending: the rows under it are queued work.
    '### Processed last week, still to file',
    `- [ ] ${NESTED_IN_PENDING} | Epsilon | Writer | Remote`,
    '',
    '## Processed',
    '',
    `- [ ] ${PROCESSED} | Beta | SRE | Berlin`,
    '### Archived by retry wave',
    `- [ ] ${PROCESSED_CHILD} | Beta | Ops | Berlin`,
    '',
  ].join('\n'),
  applicationsText: '',
};

const { seen, recheckEligible } = collectSeenUrls(SOURCES, POLICY);

if (!seen.has(DONE)) {
  pass('a `- [x]` row past the window is released — the TTL is not undone by pipeline.md');
} else {
  fail('a `- [x]` row past the window is still pinned: recheck_after_days is a no-op');
}

if (!seen.has(PROCESSED)) {
  pass('a row under ## Processed is released too, whatever its checkbox says');
} else {
  fail('a row under ## Processed is still pinned: the heading is not being read');
}

if (!seen.has(PROCESSED_CHILD)) {
  pass('a row under a child heading of ## Processed is still released');
} else {
  fail('a row under a child heading of ## Processed was pinned: nested processed headings are not being retained');
}

if (seen.has(NESTED_IN_PENDING)) {
  pass('a `### Processed…` subdivision inside ## Pending does not release its rows');
} else {
  fail('a row under a nested `### Processed…` heading inside ## Pending was released: the heading level is being ignored, so queued work is handed back to the scanner and duplicated');
}

if (seen.has(OPEN)) {
  pass('an actionable `- [ ]` row stays pinned — rescanning it would duplicate a queued job');
} else {
  fail('an actionable `- [ ]` row was released: the next scan appends a second copy of it');
}

if (seen.has(PIPELINE_ONLY)) {
  pass('a pipeline-only URL stays pinned — nothing released it, so nothing may un-pin it');
} else {
  fail('a pipeline-only URL was released, which no scan-history row ever authorised');
}

if (seen.has(FRESH)) {
  pass('a row inside the window is untouched by any of this');
} else {
  fail('a row inside the recheck window was released');
}

if (recheckEligible === 3) {
  pass('the counter reports the 3 rows that are genuinely rescannable, not the 4 released');
} else {
  fail(`recheckEligible is ${recheckEligible}, want 3 — it must be counted against the finished set, after pipeline.md and applications.md have had their say`);
}

// applications.md pins unconditionally: an applied job must never be re-offered,
// and there is no checkbox there to distinguish finished work from open work.
const applied = collectSeenUrls(
  { ...SOURCES, applicationsText: `| 1 | 2026-02-01 | Acme | Quant | 4/5 | Applied | ✅ | [1](reports/001.md) | ${DONE} |` },
  POLICY,
);
if (applied.seen.has(DONE) && applied.recheckEligible === 2) {
  pass('a released row that applications.md pins is neither rescanned nor counted as eligible');
} else {
  fail(`applications.md pin leaked: seen=${applied.seen.has(DONE)} eligible=${applied.recheckEligible} (want true/2)`);
}
