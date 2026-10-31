// tests/scan-recheck-policy-siblings.test.mjs — every scanner applies the
// scan_history.recheck_after_days window scan.mjs applies.
//
// portals.yml's `scan_history.recheck_after_days` lets an `added` (or
// `skipped_expired`) URL become eligible again after N days, for roles that
// reopen at the same URL. scan.mjs builds its seen set with that policy. The
// admission gate (scan-interamt, scan-hn, openrouter-runner, plugin ingest),
// scan-dayforce and scan-ats-full called loadSeenUrls() with no policy, which
// reads as "dedup forever", so the same portals.yml gave two verdicts: scan.mjs
// let the URL back in and every other writer refused it. The gate exists to
// stop exactly that (#5478).
//
// The window has to reach the rows those scanners write, too. scan-dayforce and
// scan-interamt record a `skipped_dup` row each time a scan meets a seen URL
// again, and that status was loaded as permanent, so the first repeat kept an
// aged posting out for good. Reading the row's own date instead would be no
// better: it is the day of the repeat, so every scan would restart the window.
// The row follows the URL's other rows, whatever its age.
//
// The gate runs in a child process because discovered suites share one process
// (and one module cache) with the rest of test-all, so scan.mjs may already be
// imported with its real data paths baked in.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { pathToFileURL } from 'url';
import { tmpdir } from 'os';
import { localToday } from '../lib/local-today.mjs';
import { trackedFiles } from '../lib/mjs-files.mjs';
import { collectSeenCompanyRoles, collectSeenUrls, formatScanHistoryRow, normalizeUrlForDedup, shouldDedupScanHistoryRow } from '../scan.mjs';

console.log('\nscan_history.recheck_after_days — the gate and the sibling scanners apply it too');

const daysAgo = (n) => {
  const d = new Date(`${localToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

const root = mkdtempSync(join(tmpdir(), 'career-ops-recheck-siblings-'));
mkdirSync(join(root, 'data'), { recursive: true });
const HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus';
const OLD = 'https://boards.greenhouse.io/acme/jobs/1001';
const FRESH = 'https://boards.greenhouse.io/acme/jobs/1002';
const REPEATED = 'https://boards.greenhouse.io/acme/jobs/1003';
writeFileSync(join(root, 'data', 'scan-history.tsv'), [
  HEADER,
  `${OLD}\t${daysAgo(60)}\tgreenhouse\tEngineer\tAcme\tadded`,
  `${FRESH}\t${daysAgo(5)}\tgreenhouse\tEngineer\tAcme\tadded`,
  `${REPEATED}\t${daysAgo(60)}\tgreenhouse\tEngineer\tAcme\tadded`,
  `${REPEATED}\t${daysAgo(1)}\tgreenhouse\tEngineer\tAcme\tskipped_dup`,
  '',
].join('\n'));

// The fixture above is the child's whole data root. An override inherited from
// the parent would send it to other files instead: with CAREER_OPS_SCAN_HISTORY
// exported, every verdict below would come from that file and not these rows.
const SCANNER_PATH_VARS = [
  'CAREER_OPS_DATA_DIR',
  'CAREER_OPS_PORTALS',
  'CAREER_OPS_PROFILE',
  'CAREER_OPS_PIPELINE',
  'CAREER_OPS_SCAN_HISTORY',
  'CAREER_OPS_TRACKER',
  'CAREER_OPS_AGGREGATOR_DOMAINS',
];

// The configs and URLs come from a JSON file read at run time, never spliced
// into the evaluated source.
const probeSource = `
  const { readFileSync } = await import('node:fs');
  const [scanUrl, gateUrl, jobFile] = process.argv.slice(-3);
  const scan = await import(scanUrl);
  const { createAdmissionGate } = await import(gateUrl);
  const { configs, urls } = JSON.parse(readFileSync(jobFile, 'utf8'));
  const out = {};
  for (const [name, config] of Object.entries(configs)) {
    const gate = createAdmissionGate({ config, titleFilter: () => true, locationFilter: () => true, blacklist: new Map() });
    const scanSeen = scan.loadSeenUrls(scan.scanHistoryPolicy(config)).seen;
    out[name] = urls.map((url) => ({
      url,
      gate: gate.check({ url, company: 'Acme', title: 'Engineer', location: 'Remote' }),
      scanSeen: scanSeen.has(scan.normalizeUrlForDedup(url)),
    }));
  }
  process.stdout.write(JSON.stringify(out));
`;

try {
  const jobFile = join(root, 'job.json');
  writeFileSync(jobFile, JSON.stringify({
    configs: { recheck30: { scan_history: { recheck_after_days: 30 } }, none: {} },
    urls: [OLD, FRESH, REPEATED],
  }));
  const env = { ...process.env, CAREER_OPS_ROOT: root };
  for (const name of SCANNER_PATH_VARS) delete env[name];
  const out = JSON.parse(execFileSync(NODE, [
    '--input-type=module', '-e', probeSource,
    pathToFileURL(join(ROOT, 'scan.mjs')).href,
    pathToFileURL(join(ROOT, 'lib', 'admission-gate.mjs')).href,
    jobFile,
  ], { env, encoding: 'utf8' }));

  const [oldRecheck, freshRecheck, repeatedRecheck] = out.recheck30;

  // Premise: scan.mjs itself releases the 60-day-old row and keeps the 5-day one.
  if (oldRecheck.scanSeen === false && freshRecheck.scanSeen === true) {
    pass('premise: scan.mjs releases a 60-day-old added row under a 30-day window and keeps a 5-day-old one');
  } else {
    fail(`premise broken — scan.mjs verdicts: ${JSON.stringify(out.recheck30)}`);
  }

  if (oldRecheck.gate === null && freshRecheck.gate === 'seen') {
    pass('the admission gate admits the row the window released and still refuses the one inside it');
  } else {
    fail(`gate ignores scan_history.recheck_after_days: ${JSON.stringify(out.recheck30)}`);
  }

  if (repeatedRecheck.gate === null && repeatedRecheck.scanSeen === false) {
    pass('an aged added row followed by a skipped_dup row is released for scan.mjs and the gate alike');
  } else {
    fail(`a repeat sighting kept an aged posting out: ${JSON.stringify(repeatedRecheck)}`);
  }

  if (out.none.every((verdict) => verdict.gate === 'seen' && verdict.scanSeen)) {
    pass('with no recheck window, the gate and scan.mjs both dedup forever, as before');
  } else {
    fail(`no-policy verdicts changed: ${JSON.stringify(out.none)}`);
  }
} catch (err) {
  fail(`admission-gate recheck probe crashed: ${err.message}`);
}

// scan-dayforce builds its own seen set: loadConfig hands back the policy.
try {
  const { loadConfig } = await import(pathToFileURL(join(ROOT, 'scan-dayforce.mjs')).href);
  const portals = join(root, 'portals.yml');
  writeFileSync(portals, 'scan_history:\n  recheck_after_days: 30\ndayforce_boards: []\n');
  const withWindow = loadConfig(portals).historyPolicy;
  writeFileSync(portals, 'dayforce_boards: []\n');
  const without = loadConfig(portals).historyPolicy;
  if (withWindow?.recheckAfterDays === 30 && without?.recheckAfterDays === null) {
    pass('scan-dayforce loadConfig carries the recheck window to its seen set');
  } else {
    fail(`scan-dayforce loadConfig historyPolicy wrong: ${JSON.stringify({ withWindow, without })}`);
  }
} catch (err) {
  fail(`scan-dayforce loadConfig probe crashed: ${err.message}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('\nskipped_dup — expires with the posting it restates');

// today = 2026-08-07, window = 30 days: 2026-07-09 is the last day inside it.
const POLICY = { recheckAfterDays: 30, today: '2026-08-07' };
const NO_WINDOW = { today: POLICY.today };
const AGED = '2026-01-01';
const RECENT = '2026-08-01';
const POSTING = { url: 'https://boards.greenhouse.io/acme/jobs/2001', source: 'dayforce', title: 'Engineer', company: 'Acme', location: 'Remote' };
const KEY = normalizeUrlForDedup(POSTING.url);
// Through the writer, so the rows have the shape scan-dayforce appends.
const row = (date, status = 'added', offer = POSTING) => formatScanHistoryRow(offer, date, status);
const dup = (date, offer) => row(date, 'skipped_dup', offer);
const history = (rows) => [HEADER, ...rows, ''].join('\n');

const RELEASED = { seen: [], recheckEligible: 1 };
const PINNED = { seen: [KEY], recheckEligible: 0 };

// The whole set, not one membership: a row that pinned some other spelling of the
// URL would read as released.
function check(label, rows, want, { sources = {}, policy = POLICY } = {}) {
  const { seen, recheckEligible } = collectSeenUrls({ scanHistoryText: history(rows), ...sources }, policy);
  const got = { seen: [...seen], recheckEligible };
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass(label);
  } else {
    fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// The dup row neither pins the URL nor restarts the clock, however old it is.
for (const date of ['2026-02-01', '2026-07-08', '2026-07-09', '2026-08-07']) {
  check(`an aged added row followed by a skipped_dup row dated ${date} releases the URL`, [row(AGED), dup(date)], RELEASED);
}
check('a run of repeat sightings releases it too', [row(AGED), dup('2026-06-01'), dup('2026-07-15'), dup('2026-08-06')], RELEASED);
check('the window runs from the added row: on its last day a later repeat changes nothing', [row('2026-07-09'), dup('2026-07-20')], PINNED);
check('and the day after, the same repeat does not extend it', [row('2026-07-08'), dup('2026-07-20')], RELEASED);
check('a skipped_dup row above its original in the file follows it all the same', [dup('2026-08-06'), row(AGED)], RELEASED);
check('a skipped_dup row spelling the URL differently finds its original', [row(AGED), dup('2026-08-06', { ...POSTING, url: `${POSTING.url}?utm_source=x` })], RELEASED);

// A row the original still pins stays seen, and a new added row pins again.
check('a fresh added row plus a skipped_dup row stays seen', [row(RECENT), dup('2026-08-06')], PINNED);
check('a fresh added row outlives an aged skipped_dup row', [dup(AGED), row(RECENT)], PINNED);
check('a URL re-added after release is seen again through its new added row', [row(AGED), dup('2026-03-01'), row(RECENT)], PINNED);
check('and that new row is on a clock of its own', [row(AGED), dup('2026-03-01'), row(RECENT), dup('2026-09-30')], RELEASED,
  { policy: { ...POLICY, today: '2026-10-01' } });

// The other rows a skipped_dup row can restate.
check('an aged skipped_expired row takes its repeat with it', [row(AGED, 'skipped_expired'), dup('2026-08-06')], RELEASED);
check('a fresh skipped_expired row keeps its repeat', [row(RECENT, 'skipped_expired'), dup('2026-08-06')], PINNED);
check('a cooldown that is over takes its repeat with it', [row(AGED, 'cooldown:Acme:2026-02-01'), dup('2026-08-06')], RELEASED);
check('a cooldown still running keeps its repeat', [row(AGED, 'cooldown:Acme:2026-12-01'), dup('2026-08-06')], PINNED);
check('a permanent row keeps its repeat', [row(AGED, 'skipped_blocked_host'), dup(AGED)], PINNED);

// No window: every one of these dedups forever, as it did.
check('no window: an aged added row and its skipped_dup row stay seen', [row(AGED), dup('2026-02-01')], PINNED, { policy: NO_WINDOW });
check('no window: a skipped_dup row with no original stays seen', [dup(AGED)], PINNED, { policy: NO_WINDOW });
check('no window: a skipped_dup row still pins after the cooldown it repeated ended', [row(AGED, 'cooldown:Acme:2026-02-01'), dup('2026-01-15')], PINNED, { policy: NO_WINDOW });

// No original in scan-history: the agent workflow in modes/scan.md writes these,
// for a URL held by the tracker or the pipeline. A config cut is no original:
// the row does not make its URL seen, so nothing there can be restated.
const TRACKED = { applicationsText: `| 1 | 2026-02-01 | Acme | Engineer | 4/5 | Applied | ✅ | [1](reports/001.md) | ${POSTING.url} |` };
const QUEUED = { pipelineText: `## Pending\n\n- [ ] ${POSTING.url} | Acme | Engineer | Remote\n\n## Processed\n` };
const TICKED = { pipelineText: `## Pending\n\n- [x] ${POSTING.url} | Acme | Engineer | Remote\n\n## Processed\n` };
const PROCESSED = { pipelineText: `## Pending\n\n## Processed\n\n- [ ] ${POSTING.url} | Acme | Engineer | Remote\n` };

check('a skipped_dup row with no original stays seen inside the window', [dup(RECENT)], PINNED);
check('and ages out by its own first_seen', [dup(AGED)], RELEASED);
check('several of them are each read by their own date', [dup(AGED), dup(RECENT)], PINNED);
check('a config cut is not an original: the skipped_dup row keeps its own date', [row(AGED, 'skipped_title'), dup(RECENT)], PINNED);
check('and ages out on it', [row(AGED, 'skipped_title'), dup('2026-02-01')], RELEASED);
check('an aged orphan row leaves a tracker row pinning', [dup(AGED)], PINNED, { sources: TRACKED });
check('an aged orphan row leaves a pending pipeline row pinning', [dup(AGED)], PINNED, { sources: QUEUED });
check('an aged orphan row cannot un-pin the `- [x]` entry it repeats', [dup(AGED)], PINNED, { sources: TICKED });
check('an aged orphan row cannot un-pin the ## Processed entry it repeats', [dup(AGED)], PINNED, { sources: PROCESSED });

// The tracker and pipeline rules read the same with a repeat in the file.
check('an aged added row and its repeat stay pinned by a tracker row', [row(AGED), dup('2026-08-06')], PINNED, { sources: TRACKED });
check('an aged added row and its repeat stay pinned by a pending pipeline row', [row(AGED), dup('2026-08-06')], PINNED, { sources: QUEUED });
check('an aged added row and its repeat are released past a `- [x]` entry', [row(AGED), dup('2026-08-06')], RELEASED, { sources: TICKED });

// A repeat on a URL that stays seen still says which versions of it were seen.
{
  const { variants } = collectSeenUrls({ scanHistoryText: history([row(RECENT, 'added', { ...POSTING, language: 'en' }), dup('2026-08-06', { ...POSTING, language: 'de' })]) }, POLICY);
  const languages = variants.get(KEY)?.flatMap((variant) => variant.languages) ?? [];
  if (languages.includes('en') && languages.includes('de')) {
    pass('a skipped_dup row on a URL that stays seen still records its language version');
  } else {
    fail(`language versions lost: ${JSON.stringify(variants.get(KEY))}`);
  }
}

// The status rule collectSeenUrls falls back on for an orphan row.
{
  const verdicts = [
    shouldDedupScanHistoryRow({ firstSeen: AGED, status: 'skipped_dup' }, POLICY),
    shouldDedupScanHistoryRow({ firstSeen: RECENT, status: 'skipped_dup' }, POLICY),
    shouldDedupScanHistoryRow({ firstSeen: AGED, status: 'skipped_dup' }, NO_WINDOW),
    shouldDedupScanHistoryRow({ firstSeen: '2026-02-31', status: 'skipped_dup' }, POLICY),
  ];
  if (JSON.stringify(verdicts) === '[false,true,true,true]') {
    pass('skipped_dup is recheckable: a row ages under a window, not without one, and a bad date stays pinned');
  } else {
    fail(`shouldDedupScanHistoryRow verdicts for skipped_dup: ${JSON.stringify(verdicts)}`);
  }
}

// collectSeenCompanyRoles loads no skipped_dup row at all, so it needs no rule of
// its own, and the role key cannot outlive the URL key by way of a repeat.
{
  const roles = (rows, policy) => collectSeenCompanyRoles({ scanHistoryText: history(rows) }, policy).size;
  const sizes = [roles([dup(RECENT)], POLICY), roles([dup(AGED)], NO_WINDOW), roles([row(AGED), dup('2026-08-06')], POLICY), roles([row(RECENT), dup('2026-08-06')], POLICY)];
  if (JSON.stringify(sizes) === '[0,0,0,1]') {
    pass('a skipped_dup row seeds no company+role key, so a released URL takes its role key with it');
  } else {
    fail(`company+role keys per fixture: ${JSON.stringify(sizes)}, want [0,0,0,1]`);
  }
}

// Census: a seen set built with no policy dedups forever, whatever portals.yml
// says. Every loadSeenUrls call outside the tests has to pass one.
const BARE = /(?<!function )\bloadSeenUrls\(\s*(?:\)|\{\s*\})/;
const offenders = [];
let calls = 0;
for (const abs of trackedFiles(ROOT, (rel) => /\.(?:mjs|ts)$/.test(rel) && !rel.startsWith('tests/') && !rel.startsWith('web/tests/') && rel !== 'test-all.mjs')) {
  const rel = relative(ROOT, abs).split(sep).join('/');
  const lines = readFileSync(abs, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) return;
    if (/(?<!function )\bloadSeenUrls\(/.test(line)) calls++;
    if (BARE.test(line)) offenders.push(`${rel}:${i + 1}`);
  });
}
if (calls >= 3 && offenders.length === 0) {
  pass(`all ${calls} loadSeenUrls calls outside the tests pass a recheck policy`);
} else {
  fail(`loadSeenUrls built with no policy (dedups forever, ignoring scan_history.recheck_after_days): ${JSON.stringify(offenders)} of ${calls} calls`);
}
