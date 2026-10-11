// tests/liveness-record-expired.test.mjs — check-liveness must WRITE its
// `expired` verdict back into data/scan-history.tsv, on the default path (#3891).
//
// The verdict is the expensive half of the check (a real fetch, sometimes a
// browser) and it used to die with the process: nothing recorded it, so the
// posting kept whatever status it already had and the web "new matches this
// week" feed re-surfaced it for as long as its lookback window reached back.
//
// Two properties are load-bearing and both are asserted below:
//
//   1. DEFAULT-ON. Recording behind an opt-IN flag is the bug wearing a fix:
//      the scheduled routines pass no flags, which is exactly how the verdict
//      came to be computed and discarded. `--no-record` is the opt-OUT, for a
//      read-only spot check that must leave no trace.
//   2. THE POSTING ACTUALLY STOPS RESURFACING. A test that only proves a row
//      was appended proves nothing a user can see: scan-history is append-only,
//      so the older `added` row that first surfaced the posting is still in the
//      file, and the web reader walks newest-first but skips dead rows WITHOUT
//      retiring their URL — so the older row won and the dead posting came back.
//      The end-to-end assertion below goes through the real writer
//      (appendToScanHistory) and the real reader (collectWhatsNew).
//
// Run:  node --test tests/liveness-record-expired.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquirePipelineLock } from '../pipeline-lock.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// scan.mjs resolves CAREER_OPS_SCAN_HISTORY ONCE, at module evaluation, so the
// sandbox has to be pointed at before the import below — not after. Getting
// this backwards is how a module ends up reading the developer's real
// data/scan-history.tsv while the test believes it is hermetic.
const sandbox = mkdtempSync(join(tmpdir(), 'liveness-record-'));
const historyPath = join(sandbox, 'scan-history.tsv');
process.env.CAREER_OPS_SCAN_HISTORY = historyPath;

const { planExpiredHistoryRows } = await import('../liveness-core.mjs');
const { normalizeUrlForDedup, shouldDedupScanHistoryRow } = await import('../scan.mjs');
// web/ is not in every checkout, and an unguarded import of it crashes the whole
// suite there rather than skipping one case (#3269). The core half of this file
// does not need web/ at all; only the end-to-end feed assertion does.
const WEB_SRC = join(ROOT, 'web', 'src');
const WEB_WHATS_NEW = join(WEB_SRC, 'lib', 'whats-new.mjs');
const HAS_WEB = existsSync(WEB_SRC);
const { collectWhatsNew } = HAS_WEB
  ? await import(pathToFileURL(WEB_WHATS_NEW).href)
  : { collectWhatsNew: null };
const { recordingEnabled, recordExpiredVerdicts } = await import('../check-liveness.mjs');

const HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation';
const DEAD = 'https://boards.example.com/acme/jobs/1';
const plan = (rows, verdicts) =>
  planExpiredHistoryRows(rows.join('\n'), verdicts, normalizeUrlForDedup);

process.on('exit', () => rmSync(sandbox, { recursive: true, force: true, maxRetries: 10 }));

// ── 1. Default-on, opt-out ────────────────────────────────────────────────

test('recording is on by default and only --no-record turns it off', () => {
  // The whole point of #3891: a scheduled routine passes no flags. If this
  // ever inverts into an opt-in, the verdict goes back to being discarded on
  // every run that matters.
  assert.equal(recordingEnabled([]), true, 'a flagless run must record');
  assert.equal(recordingEnabled(['--throttle', DEAD]), true);
  assert.equal(recordingEnabled(['--no-fallback', DEAD]), true);
  assert.equal(recordingEnabled(['--no-record']), false);
  assert.equal(recordingEnabled(['--no-record', DEAD]), false);
});

test('--no-record is parsed as a flag, not as a URL to check', () => {
  // Without it in the positional filter the flag becomes the only "URL",
  // and a read-only spot check turns into a live fetch of the string
  // "--no-record". With no real URLs left the script must print usage and
  // exit 1, touching nothing.
  const out = spawnSync(process.execPath, [join(ROOT, 'check-liveness.mjs'), '--no-record'], {
    encoding: 'utf-8',
    timeout: 20000,
  });
  assert.equal(out.status, 1, `expected usage exit 1, got ${out.status}`);
  assert.match(out.stderr || '', /Usage:/);
});

test('main() calls the recorder, and does not gate it behind an opt-in flag', () => {
  // The one link the assertions above cannot exercise: driving main() end to
  // end needs a live fetch or a browser launch, and this suite launches
  // neither. So it asserts on the source, the way
  // tests/local-today-gates.test.mjs does — because a recorder that works and
  // is never called is precisely the bug being fixed, and deleting the call
  // site otherwise leaves this suite green (verified).
  const src = readFileSync(join(ROOT, 'check-liveness.mjs'), 'utf-8');
  // main() is defined after the recorder, so this slice is the CALL, never the
  // definition.
  const body = src.slice(src.indexOf('async function main('));
  assert.match(body, /await recordExpiredVerdicts\(/, 'main() never records its verdicts — #3891 is back');
  assert.doesNotMatch(src, /includes\(['"]--record['"]\)/, 'recording must not be gated behind an opt-in flag');
});

test('main() hands the verdict code to the recorder, from both rungs', () => {
  // The planner skips an `insufficient_content` verdict, and that filter does
  // nothing if the CLI drops `code` before the verdict gets there. Same
  // source-level check as the call-site test above, for the same reason:
  // driving main() needs a live fetch or a browser launch.
  const src = readFileSync(join(ROOT, 'check-liveness.mjs'), 'utf-8');
  const body = src.slice(src.indexOf('async function main('));
  assert.match(body, /verdicts\.push\(\{[^}]*\bcode\b[^}]*\}\)/, 'the pushed verdict drops its code');
  assert.match(body, /\(\{ result, reason, code \} = api\)/, 'the API rung drops the verdict code');
  assert.match(body, /\(\{ result, reason, code \} = await checkUrlLivenessWithFallback/, 'the browser rung drops the verdict code');
});

test('--help documents the opt-out', () => {
  const out = spawnSync(process.execPath, [join(ROOT, 'check-liveness.mjs'), '--help'], {
    encoding: 'utf-8',
    timeout: 20000,
  });
  assert.equal(out.status, 0);
  assert.match(out.stdout || '', /--no-record/);
});

// ── 2. What gets planned ──────────────────────────────────────────────────

test('only an expired verdict is planned — never uncertain, never active', () => {
  // `uncertain` is a timeout or a bot wall, not a death certificate. Recording
  // it would bury a live posting behind a network hiccup, which is a strictly
  // worse failure than the one being fixed.
  const rows = [
    HEADER,
    `${DEAD}\t2026-09-01\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote`,
    `https://boards.example.com/acme/jobs/2\t2026-09-01\tgreenhouse\tStaff SRE\tAcme\tadded\tRemote`,
    `https://boards.example.com/acme/jobs/3\t2026-09-01\tgreenhouse\tStaff Data\tAcme\tadded\tRemote`,
  ];
  const planned = plan(rows, [
    { url: DEAD, result: 'expired' },
    { url: 'https://boards.example.com/acme/jobs/2', result: 'uncertain' },
    { url: 'https://boards.example.com/acme/jobs/3', result: 'active' },
  ]);
  assert.deepEqual(planned.map((r) => r.url), [DEAD]);
});

test('an expired verdict that is only an unrendered page is not planned', () => {
  // `insufficient_content` is a page under 300 characters with no closure
  // notice and no apply control, which is mostly a page that had not rendered
  // yet. AGENTS.md calls a loading placeholder unconfirmed, not closed, so it
  // is no more a death certificate than `uncertain` is. A dead posting that
  // reads this way gets no row, exactly as it did before this PR.
  const live = 'https://boards.example.com/acme/jobs/2';
  const rows = [
    HEADER,
    `${DEAD}\t2026-09-01\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote`,
    `${live}\t2026-09-01\tgreenhouse\tStaff SRE\tAcme\tadded\tRemote`,
  ];
  const planned = plan(rows, [
    { url: DEAD, result: 'expired', code: 'http_gone' },
    { url: live, result: 'expired', code: 'insufficient_content' },
  ]);
  assert.deepEqual(planned.map((r) => r.url), [DEAD]);
});

test('only URLs the history already knows are planned', () => {
  const rows = [HEADER, `${DEAD}\t2026-09-01\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote`];
  const planned = plan(rows, [
    { url: DEAD, result: 'expired' },
    { url: 'https://elsewhere.example.com/never-scanned', result: 'expired' },
  ]);
  assert.deepEqual(planned.map((r) => r.url), [DEAD]);
});

test('a planned row carries the known row’s portal, title, company and location', () => {
  // A blank row is legible to nobody: the web feed renders company and title
  // straight off these columns.
  const rows = [HEADER, `${DEAD}\t2026-09-01\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote`];
  const [row] = plan(rows, [{ url: DEAD, result: 'expired' }]);
  assert.equal(row.source, 'greenhouse');
  assert.equal(row.title, 'Staff Engineer');
  assert.equal(row.company, 'Acme');
  assert.equal(row.location, 'Remote');
});

test('a URL already recorded dead is not recorded twice', () => {
  const rows = [
    HEADER,
    `${DEAD}\t2026-09-01\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote`,
    `${DEAD}\t2026-09-04\tgreenhouse\tStaff Engineer\tAcme\tskipped_expired\tRemote`,
  ];
  assert.deepEqual(plan(rows, [{ url: DEAD, result: 'expired' }]), []);
});

test('a posting relisted after it died can be recorded dead a second time', () => {
  // Scan history is append-only and chronological, so the LAST row for a URL
  // states what it is now. A posting that was retired, relisted, and died again
  // is live in the feed under that newer `added` row; if the first retirement
  // keeps the URL marked for good, the second death writes nothing and the
  // posting resurfaces — the failure this file exists to stop, arriving by a
  // longer route.
  const rows = [
    HEADER,
    `${DEAD}\t2026-09-01\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote`,
    `${DEAD}\t2026-09-04\tgreenhouse\tStaff Engineer\tAcme\tskipped_expired\tRemote`,
    `${DEAD}\t2026-09-20\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote`,
  ];
  assert.deepEqual(plan(rows, [{ url: DEAD, result: 'expired' }]), [
    {
      url: DEAD,
      source: 'greenhouse',
      title: 'Staff Engineer',
      company: 'Acme',
      location: 'Remote',
      fingerprint: '',
    },
  ]);
});

test('the same URL passed twice in one run is planned once', () => {
  const rows = [HEADER, `${DEAD}\t2026-09-01\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote`];
  const planned = plan(rows, [
    { url: DEAD, result: 'expired' },
    { url: DEAD, result: 'expired' },
  ]);
  assert.equal(planned.length, 1);
});

test('the planned row keeps the history’s spelling of the URL', () => {
  // The web feed keys its dedup on the verbatim url cell. A row written under
  // the caller's spelling would not line up with the `added` row it retires,
  // and the dead posting would keep coming back.
  const stored = `${DEAD}?utm_source=jobboard`;
  const rows = [HEADER, `${stored}\t2026-09-01\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote`];
  const [row] = plan(rows, [{ url: DEAD, result: 'expired' }]);
  assert.equal(row.url, stored);
});

test('an empty or absent history plans nothing', () => {
  assert.deepEqual(planExpiredHistoryRows('', [{ url: DEAD, result: 'expired' }], normalizeUrlForDedup), []);
  assert.deepEqual(planExpiredHistoryRows(undefined, undefined, normalizeUrlForDedup), []);
});

// ── 3. The posting stops resurfacing (writer + reader, end to end) ─────────

test('a re-confirmed dead posting stops resurfacing in the web feed', { skip: HAS_WEB ? false : 'web/ not present in this checkout' }, async () => {
  // The whats-new route's own row predicate: cols are
  // url, first_seen, portal, title, company, status, location.
  const toOffer = (c) => {
    const [url, , portal, title, company, status, location] = c;
    if (!url || !/^https?:\/\//i.test(url)) return null;
    if (status && /skipped|expired/i.test(status)) return null;
    return { url, company, title, location, ats: portal, source: 'whats-new' };
  };
  // The cutoff is deliberately ancient so this asserts the retire rule and not
  // the clock: the recorded row is stamped with the real localToday(), and a
  // window pinned to a fixture date would go green or red depending on when the
  // suite runs. (In production the two can never disagree anyway — the death
  // certificate is always newer than the `added` row it retires, so it is
  // inside the window whenever that row is.)
  const read = () => collectWhatsNew(readFileSync(historyPath, 'utf-8').split('\n'), {
    cutoff: Date.parse('2000-01-01'),
    toOffer,
  });

  writeFileSync(
    historyPath,
    `${HEADER}\n${DEAD}\t2026-09-02\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote\n`,
    'utf-8',
  );

  // Positive control: without the recorded verdict the feed serves the posting.
  // Without this the assertion below could pass on an empty feed and prove
  // nothing at all.
  assert.equal(read().count, 1, 'fixture must surface the posting before it is confirmed dead');

  // check-liveness's OWN writer, not a re-implementation of it here.
  const written = await recordExpiredVerdicts([
    { url: DEAD, result: 'expired' },
    { url: 'https://boards.example.com/acme/jobs/9', result: 'uncertain' },
  ]);
  assert.equal(written, 1, 'the expired verdict must be recorded');
  assert.match(readFileSync(historyPath, 'utf-8'), /skipped_expired/, 'the verdict must reach scan-history.tsv');

  assert.equal(read().count, 0, 'the dead posting resurfaced after being confirmed dead');

  // Idempotent: sweeping the same dead posting again writes nothing more.
  assert.equal(await recordExpiredVerdicts([{ url: DEAD, result: 'expired' }]), 0);
});

test('the history read happens inside the lock, so a concurrent scan cannot cause a duplicate', async () => {
  // The plan is computed FROM the history, so reading it outside the lock is a
  // check-then-act: a scanner appending the same `skipped_expired` row in the
  // window between the read and the append would leave two death certificates
  // for one posting, and the write-once rule would be true only when nobody
  // else was writing.
  //
  // Deterministic, not a race the suite hopes to lose (tests/scan-history-lock
  // rejects that style for good reason): the lock IS the barrier. This holds it,
  // lets the recorder block on it, appends the row the recorder must notice,
  // and only then releases. A recorder that read before blocking has a stale
  // plan and writes a duplicate; one that reads after acquiring sees the row
  // and writes nothing.
  const historyFixture = join(sandbox, 'concurrent-history.tsv');
  const marker = join(sandbox, 'child-started');
  writeFileSync(
    historyFixture,
    `${HEADER}\n${DEAD}\t2026-09-02\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote\n`,
    'utf-8',
  );

  const child = `
    import { writeFileSync } from 'node:fs';
    writeFileSync(process.argv[process.argv.length - 1], 'go');
    const { recordExpiredVerdicts } = await import(process.argv[process.argv.length - 2]);
    console.log(await recordExpiredVerdicts([{ url: ${JSON.stringify(DEAD)}, result: 'expired' }]));
  `;

  const lock = await acquirePipelineLock(historyFixture, { timeoutMs: 30000 });
  let out;
  try {
    const proc = execFile(
      process.execPath,
      ['--input-type=module', '-e', child, pathToFileURL(join(ROOT, 'check-liveness.mjs')).href, marker],
      { env: { ...process.env, CAREER_OPS_SCAN_HISTORY: historyFixture }, encoding: 'utf-8' },
    );
    const finished = new Promise((resolve, reject) => {
      proc.on('error', reject);
      let stdout = '';
      proc.stdout.on('data', (c) => { stdout += c; });
      proc.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`child exited ${code}`))));
    });

    // The child has imported and is about to read-or-block. The marker covers
    // process start and module load (the slow, variable part); what remains is
    // a few microseconds of straight-line code, and the sleep dwarfs it.
    while (!existsSync(marker)) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 500));

    // The concurrent scanner's write, landing while the recorder waits.
    appendFileSync(
      historyFixture,
      `${DEAD}\t2026-09-04\tgreenhouse\tStaff Engineer\tAcme\tskipped_expired\tRemote\n`,
      'utf-8',
    );
    lock.release();
    out = await finished;
  } finally {
    lock.release(); // idempotent; covers the throwing path
  }

  assert.equal(out.trim(), '0', 'the recorder planned from a history snapshot taken before the lock');
  const deathCertificates = readFileSync(historyFixture, 'utf-8')
    .split('\n')
    .filter((line) => line.startsWith(DEAD) && line.includes('skipped_expired'));
  assert.equal(deathCertificates.length, 1, `one posting, ${deathCertificates.length} death certificates`);
});

test('recording is a no-op when no history file exists', async () => {
  // A liveness sweep is not a discovery channel. With no history there is no
  // row to retire, and the run must not create one — that is what keeps a
  // non-job URL (upskill cites article links through the same checker) out of
  // the scanner's dedup set.
  rmSync(historyPath, { force: true });
  assert.equal(await recordExpiredVerdicts([{ url: DEAD, result: 'expired' }]), 0);
  assert.equal(existsSync(historyPath), false);
});

// ── 6. A retirement is not a life sentence (#3891 follow-up) ──────────────
//
// Recording the verdict stops a dead posting resurfacing. It must not also put
// the URL beyond the recheck the user configured: `scan_history.recheck_after_days`
// is the knob that says "look again after N days", and a posting can be relisted.
// Before this, shouldDedupScanHistoryRow returned true for every status that was
// not `added`, so the TTL below it was unreachable for a row this PR writes.

test('a recorded expired row is pinned until the configured recheck window passes', () => {
  const row = { firstSeen: '2026-07-01', status: 'skipped_expired' };

  // No TTL configured: pinned, exactly as before.
  assert.equal(shouldDedupScanHistoryRow(row, { today: '2026-08-07' }), true);

  // Inside the window: still pinned.
  assert.equal(shouldDedupScanHistoryRow(row, { recheckAfterDays: 90, today: '2026-08-07' }), true);

  // Past the window: released, so the user's recheck can reach it.
  assert.equal(shouldDedupScanHistoryRow(row, { recheckAfterDays: 30, today: '2026-08-07' }), false);
});

test('a status that describes the URL rather than the posting stays pinned', () => {
  // The recheck window says "look at this posting again". It does not say an
  // invalid URL became valid or a blocked host became reachable, so those keep
  // their permanent pin whatever the TTL is.
  for (const status of ['skipped_invalid_url', 'skipped_blocked_host']) {
    assert.equal(
      shouldDedupScanHistoryRow({ firstSeen: '2026-01-01', status }, { recheckAfterDays: 30, today: '2026-08-07' }),
      true,
      `${status} must stay pinned`,
    );
  }
});
