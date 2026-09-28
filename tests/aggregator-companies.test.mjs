// tests/aggregator-companies.test.mjs — a company marked `aggregator: true` in
// portals.yml is a multi-employer board, so its "same title twice" is many
// different employers rather than one employer re-listing. The detector skips
// it, and the report has to say the check was SKIPPED rather than that it found
// nothing (#2703).
//
// Every assertion below is paired against the same input without the flag,
// because the failure mode this guards is a false negative: rows that never
// clustered anyway would make "no clusters for the aggregator" pass on a build
// where the flag does nothing at all.

import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, ROOT } from './helpers.mjs';
import {
  parseScanHistory, detectReposts, loadAggregatorCompanies, companyKey,
} from '../detect-reposts.mjs';
import {
  computePostingChurn, buildCompanyCards, isAggregatorCompany,
} from '../company-history.mjs';

console.log('\naggregator companies — skipped, and visibly skipped');

const HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\tfingerprint\tposted_at\ttrust_score\ttrust_flags\tnormalized_company';
const row = (url, date, title, company) =>
  [url, date, 'greenhouse', title, company, 'added', 'Remote', '', '', '', '', ''].join('\t');

// One board, one title, two URLs, two scan dates a week apart: a cluster by
// every rule the detector has — which is exactly why the flag has to be what
// stops it.
const HISTORY = [
  HEADER,
  row('https://board.example/jobs/1', '2026-07-01', 'Account Manager', 'Jobs Board Inc'),
  row('https://board.example/jobs/2', '2026-07-08', 'Account Manager', 'Jobs Board Inc'),
  row('https://acme.example/jobs/9', '2026-07-01', 'Platform Engineer', 'Acme'),
  row('https://acme.example/jobs/7', '2026-07-08', 'Platform Engineer', 'Acme'),
].join('\n');

const rows = parseScanHistory(HISTORY);

// ── 1. The loader reads the flag, and only the flag ──────────────────
const dir = mkdtempSync(join(tmpdir(), 'career-ops-aggregators-'));
try {
  const portals = join(dir, 'portals.yml');
  writeFileSync(portals, [
    'tracked_companies:',
    '  - name: Jobs Board Inc',
    '    aggregator: true',
    '  - name: Acme',
    '  - name: Marked False',
    '    aggregator: false',
    '',
  ].join('\n'));

  const loaded = loadAggregatorCompanies(portals);
  const hasBoard = isAggregatorCompany('Jobs Board Inc', loaded);
  const hasAcme = isAggregatorCompany('Acme', loaded);
  const hasFalse = isAggregatorCompany('Marked False', loaded);
  if (hasBoard && !hasAcme && !hasFalse) {
    pass('loadAggregatorCompanies picks up `aggregator: true` and nothing else');
  } else {
    fail(`aggregator flag misread: board=${hasBoard} acme=${hasAcme} explicitFalse=${hasFalse}`);
  }

  // A missing file is a normal state, not a crash: portals.yml is user layer.
  if (loadAggregatorCompanies(join(dir, 'nope.yml')).size === 0) {
    pass('a missing portals.yml yields an empty set rather than throwing');
  } else {
    fail('loadAggregatorCompanies did not degrade to empty on a missing file');
  }

  // A board belongs under `job_boards` at least as often as under
  // `tracked_companies` — that is what the section is for — so the loader has to
  // read both. Reading only one is invisible to a synthetic fixture that happens
  // to use the other, which is exactly how it survived the first round here.
  const boards = join(dir, 'boards.yml');
  writeFileSync(boards, [
    'job_boards:',
    '  - name: Board Under job_boards',
    '    aggregator: true',
    '  - name: Ordinary Board',
    '',
  ].join('\n'));
  const fromBoards = loadAggregatorCompanies(boards);
  if (isAggregatorCompany('Board Under job_boards', fromBoards) && !isAggregatorCompany('Ordinary Board', fromBoards)) {
    pass('a flagged entry under job_boards is loaded, not only under tracked_companies');
  } else {
    fail(`job_boards flag not honoured: size=${fromBoards.size}`);
  }

  // The assertion that would have caught the above: measure the SHIPPED
  // template, not a fixture. Both entries it flags live under `job_boards`, so a
  // loader reading only `tracked_companies` returns zero here while every
  // synthetic case still passes.
  // By NAME, not by count. `size >= 2` is satisfied by any two flagged entries:
  // measured against a template with these two unflagged and two unrelated ones
  // flagged instead, it returns 2 and passes while protecting nothing.
  const shipped = loadAggregatorCompanies(join(ROOT, 'templates/portals.example.yml'));
  const REQUIRED = ['Founderful (portfolio)', 'joinup.ch'];
  const notFlagged = REQUIRED.filter((n) => !isAggregatorCompany(n, shipped));
  if (notFlagged.length === 0) {
    pass('the shipped template still flags the two boards it ships flagged');
  } else {
    fail(`the shipped template no longer flags: ${JSON.stringify(notFlagged)} (loaded ${shipped.size})`);
  }
  // And the raw name has to survive, by value: this returns a Map rather than a
  // Set precisely so a card reads "joinup.ch" instead of the key "joinup ch".
  // A regex for punctuation would accept any flagged entry that happens to have
  // some, which is the same counting mistake one level down.
  const rawNames = [...shipped.values()];
  const missingRaw = REQUIRED.filter((n) => !rawNames.includes(n));
  if (missingRaw.length === 0) {
    pass('each flagged board keeps its raw name exactly as written in the template');
  } else {
    fail(`raw names lost or rewritten: ${JSON.stringify(missingRaw)} not in ${JSON.stringify(rawNames)}`);
  }

  // Membership is by normalized name, so the report can ask with whatever
  // spelling the tracker happens to carry.
  const spellings = ['jobs board inc', 'Jobs Board, Inc.', '  Jobs Board Inc  '];
  const missed = spellings.filter((s) => !isAggregatorCompany(s, loaded));
  if (missed.length === 0) {
    pass('membership survives the spelling variants a tracker row carries');
  } else {
    fail(`aggregator lookup missed spellings: ${JSON.stringify(missed)}`);
  }

  // ── 2. The detector skips it — and would not, without the flag ──────
  const withoutFlag = detectReposts(rows, undefined, undefined, null);
  const withFlag = detectReposts(rows, undefined, undefined, loaded);
  const boardKey = companyKey({ company: 'Jobs Board Inc', normCompany: '' });
  const boardWithout = withoutFlag.filter((c) => companyKey({ company: c.company, normCompany: '' }) === boardKey);
  const boardWith = withFlag.filter((c) => companyKey({ company: c.company, normCompany: '' }) === boardKey);
  const acmeWith = withFlag.filter((c) => String(c.company).toLowerCase().includes('acme'));

  if (boardWithout.length > 0 && boardWith.length === 0) {
    pass('the flag is what removes the aggregator cluster — the same rows cluster without it');
  } else {
    fail(`flag did not decide the cluster: without=${boardWithout.length} with=${boardWith.length}`);
  }
  if (acmeWith.length > 0) {
    pass('a normal company alongside the aggregator still clusters');
  } else {
    fail('flagging one company suppressed an unflagged one too');
  }

  // ── 3. Skipped is not the same claim as clean ───────────────────────
  // `none-detected` asserts a negative result from a check that ran. For an
  // aggregator the check never ran, so the label has to say so.
  const skipped = computePostingChurn([], true, true);
  const clean = computePostingChurn([], true, false);
  const noData = computePostingChurn([], false, false);
  if (skipped.label === 'aggregator-not-evaluated' && clean.label === 'none-detected' && noData.label === 'no-scan-data') {
    pass('an aggregator reports as not-evaluated, distinct from none-detected and no-scan-data');
  } else {
    fail(`churn labels wrong: aggregator=${skipped.label} clean=${clean.label} noData=${noData.label}`);
  }

  // ── 4. It must not vanish from the report ───────────────────────────
  // The regression this pins: an aggregator usually has no tracker rows (you do
  // not apply to a board) and now no clusters either, so it falls out of the
  // key union and disappears from --summary. A company absent from the report
  // reads as "nothing to say", which is indistinguishable from a clean result
  // — and it is a regression, because before the flag it appeared.
  const built = buildCompanyCards({
    trackerRows: [],
    followupRows: [],
    repostClusters: withFlag,
    aggregators: loaded,
    sourcesLoaded: { tracker: true, followups: true, scanHistory: true, statusLog: false },
  }, { now: '2026-07-15' });

  const card = built.companies.find((c) => String(c.company).toLowerCase().includes('jobs board'));
  if (card) {
    pass('a flagged aggregator with no tracker rows and no clusters still gets a card');
  } else {
    fail(`the aggregator vanished from the report: ${JSON.stringify(built.companies.map((c) => c.company))}`);
  }
  if (card && card.postingChurn?.label === 'aggregator-not-evaluated') {
    pass('and that card says the check was skipped rather than clean');
  } else {
    fail(`aggregator card carries the wrong churn label: ${card?.postingChurn?.label}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
