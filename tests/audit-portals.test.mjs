// tests/audit-portals.test.mjs — classification tests for audit-portals.mjs.
//
// The script exists because two real coverage failures survived
// verify-portals.mjs on 2026-08-26, and each one pins a case below:
//
//   - twelve entries carried `enabled: true` with a careers_url no provider
//     claims, so scan.mjs skipped them silently on every run. That state must
//     never classify as anything but `no-provider` — it is the one verdict that
//     means "this line in your config does literally nothing";
//   - `Booking Holdings` pointed at the PARENT company's Workday board. It was
//     well-formed and full of real postings, so no verdict can catch it. What
//     the script owes that case is evidence — samples the reader can recognise
//     the employer from — and the `small` tier that says "look at this".
//
// The baseline diff is the one part that CAN automate the migration case: a
// board that keeps answering after its ATS moved collapses toward zero, and
// only DROPS are reported so growth and new entries stay quiet.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\naudit-portals — board classification');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'audit-portals.mjs')).href);
  const {
    classifyBoard, sampleJobs, diffAgainstBaseline, auditCompanies,
    findUnclaimedEntries, DEFAULT_SMALL_THRESHOLD, VERDICTS,
  } = mod;

  const job = (title, location) => ({ title, location, url: 'https://example.com/j' });
  const many = (n) => Array.from({ length: n }, (_, i) => job(`Role ${i}`, 'Amsterdam'));

  // ── the silent-skip case: enabled in config, invisible to the scanner ──
  const noProv = classifyBoard({ provider: null, jobs: [] });
  if (noProv.verdict === 'no-provider') pass('an entry no provider claims is "no-provider", never "empty"');
  else fail(`expected no-provider, got ${noProv.verdict}`);

  // Precedence matters: a missing provider is a CONFIG defect, so it must win
  // over anything the (absent) fetch could have reported.
  const noProvWithError = classifyBoard({ provider: null, error: 'boom' });
  if (noProvWithError.verdict === 'no-provider') pass('no-provider outranks a fetch error');
  else fail(`expected no-provider to win, got ${noProvWithError.verdict}`);

  // The two flavours of no-provider are not equally broken, and the detail line
  // is the only place a reader learns which one they have: scan.mjs announces a
  // websearch entry in its handoff list, and swallows one without a scan_method.
  const silentDetail = classifyBoard({ provider: null }).detail;
  const handoffDetail = classifyBoard({ provider: null, scanMethod: 'websearch' }).detail;
  if (/no scan_method/.test(silentDetail) && /websearch/.test(handoffDetail)) {
    pass('no-provider names whether the entry is swallowed or handed to the agent');
  } else {
    fail(`no-provider details drifted: ${JSON.stringify([silentDetail, handoffDetail])}`);
  }

  // ── the Dell/EchoStar case: answers 200, returns nothing ──
  const empty = classifyBoard({ provider: 'workday', jobs: [] });
  if (empty.verdict === 'empty' && empty.count === 0) pass('a board answering with zero postings is "empty"');
  else fail(`expected empty/0, got ${empty.verdict}/${empty.count}`);

  // ── the "look at this" tier ──
  const small = classifyBoard({ provider: 'greenhouse', jobs: many(2) });
  if (small.verdict === 'small' && small.count === 2) pass('a board under the threshold is "small"');
  else fail(`expected small/2, got ${small.verdict}/${small.count}`);

  const atThreshold = classifyBoard({ provider: 'greenhouse', jobs: many(DEFAULT_SMALL_THRESHOLD) });
  if (atThreshold.verdict === 'small') pass('the threshold itself is inclusive');
  else fail(`expected small at exactly ${DEFAULT_SMALL_THRESHOLD}, got ${atThreshold.verdict}`);

  const justOver = classifyBoard({ provider: 'greenhouse', jobs: many(DEFAULT_SMALL_THRESHOLD + 1) });
  if (justOver.verdict === 'ok') pass('one posting over the threshold is "ok"');
  else fail(`expected ok, got ${justOver.verdict}`);

  // A threshold of 0 must DISABLE the tier, not flag every board.
  const disabled = classifyBoard({ provider: 'ashby', jobs: many(1) }, { smallThreshold: 0 });
  if (disabled.verdict === 'ok') pass('--small-threshold 0 disables the small tier');
  else fail(`expected ok with threshold 0, got ${disabled.verdict}`);

  const err = classifyBoard({ provider: 'icims', error: 'ETIMEDOUT' });
  if (err.verdict === 'error' && err.count === null) pass('a failed fetch is "error" with no count');
  else fail(`expected error/null, got ${err.verdict}/${err.count}`);

  // ── verdict ordering drives report ordering: worst first ──
  if (VERDICTS[0] === 'no-provider' && VERDICTS[VERDICTS.length - 1] === 'ok') {
    pass('VERDICTS is ordered worst-first so reports lead with what is broken');
  } else {
    fail(`VERDICTS order drifted: ${VERDICTS.join(',')}`);
  }

  // ── evidence: the only defence against a wrong-entity board ──
  const samples = sampleJobs([
    job('Senior Product Manager', 'Amsterdam, Netherlands'),
    job('Legal Counsel', 'Norwalk, CT'),
    job('AML Manager', 'Ireland - Remote'),
    job('Fourth Role', 'Nowhere'),
  ]);
  if (samples.length === 3) pass('samples are capped so a report stays scannable');
  else fail(`expected 3 samples, got ${samples.length}`);
  if (samples[0] === 'Senior Product Manager · Amsterdam, Netherlands') {
    pass('a sample carries title AND location — the pair that identifies an employer');
  } else {
    fail(`sample shape drifted: ${JSON.stringify(samples[0])}`);
  }
  const noLoc = sampleJobs([job('Solutions Architect', '')]);
  if (noLoc[0] === 'Solutions Architect') pass('a location-less posting drops the separator instead of trailing it');
  else fail(`expected bare title, got ${JSON.stringify(noLoc[0])}`);

  // ── baseline diff: the automatable half of the migration case ──
  const drops = diffAgainstBaseline(
    [{ name: 'Booking.com', count: 2 }, { name: 'Adyen', count: 120 }, { name: 'Stripe', count: 700 }],
    [{ name: 'Booking.com', count: 145 }, { name: 'Adyen', count: 118 }, { name: 'Stripe', count: 600 }],
  );
  if (drops.length === 1 && drops[0].name === 'Booking.com' && drops[0].lost === 143) {
    pass('a collapsed board is flagged; boards that grew are not');
  } else {
    fail(`baseline diff drifted: ${JSON.stringify(drops)}`);
  }

  // A board absent from the baseline is new, not a regression.
  const fresh = diffAgainstBaseline([{ name: 'Talkdesk', count: 0 }], [{ name: 'Adyen', count: 50 }]);
  if (fresh.length === 0) pass('a company missing from the baseline is not reported as a drop');
  else fail(`new company should not be a drop: ${JSON.stringify(fresh)}`);

  // 0 → 0 is already reported as `empty`; counting it as an infinite loss would
  // double-report it and divide by zero doing so.
  const fromZero = diffAgainstBaseline([{ name: 'Clerk', count: 0 }], [{ name: 'Clerk', count: 0 }]);
  if (fromZero.length === 0) pass('a baseline count of zero never produces a drop');
  else fail(`zero baseline should be skipped: ${JSON.stringify(fromZero)}`);

  // A modest decline is hiring churn, not a migration.
  const churn = diffAgainstBaseline([{ name: 'Adyen', count: 90 }], [{ name: 'Adyen', count: 100 }]);
  if (churn.length === 0) pass('a 10% decline stays below the drift threshold');
  else fail(`churn should not be flagged: ${JSON.stringify(churn)}`);

  // ── auditCompanies(): disabled entries are not audited ──
  const fakeProvider = { id: 'fake', detect: () => ({ url: 'x' }), fetch: async () => many(9) };
  const providers = new Map([['fake', fakeProvider]]);
  const rows = await auditCompanies(
    [
      { name: 'Live Co', careers_url: 'https://example.com/a', enabled: true },
      { name: 'Off Co', careers_url: 'https://example.com/b', enabled: false },
    ],
    { providers, httpCtx: {}, concurrency: 1 },
  );
  if (rows.length === 1 && rows[0].name === 'Live Co' && rows[0].verdict === 'ok') {
    pass('auditCompanies() audits enabled entries and skips disabled ones');
  } else {
    fail(`auditCompanies drifted: ${JSON.stringify(rows.map((r) => [r.name, r.verdict]))}`);
  }

  // A provider that throws must degrade to `error`, never take the run down.
  const angry = { id: 'angry', detect: () => ({ url: 'x' }), fetch: async () => { throw new Error('429 Too Many Requests'); } };
  const errRows = await auditCompanies(
    [{ name: 'Angry Co', careers_url: 'https://example.com/c', enabled: true }],
    { providers: new Map([['angry', angry]]), httpCtx: {}, concurrency: 1 },
  );
  if (errRows.length === 1 && errRows[0].verdict === 'error' && /429/.test(errRows[0].detail)) {
    pass('a throwing provider yields an "error" row instead of aborting the audit');
  } else {
    fail(`error handling drifted: ${JSON.stringify(errRows)}`);
  }

  // ── findUnclaimedEntries(): the offline half, wired into verify-pipeline ──
  // No network, so it is safe inside a health check — and it is the half that
  // can prove a defect outright rather than asking a human to look.
  const claimer = {
    id: 'claimer',
    detect: (e) => (String(e.careers_url || '').includes('claimed') ? { url: e.careers_url } : null),
    fetch: async () => [],
  };
  const localParser = {
    id: 'local-parser',
    detect: (e) => (e.parser ? { url: e.careers_url } : null),
    fetch: async () => [],
  };
  const reg = new Map([['claimer', claimer], ['local-parser', localParser]]);

  const unclaimed = findUnclaimedEntries([
    { name: 'Claimed Co', careers_url: 'https://claimed.example.com', enabled: true },
    { name: 'Silent Co', careers_url: 'https://nobody.example.com', enabled: true },
    { name: 'Handoff Co', careers_url: 'https://nobody.example.com', scan_method: 'websearch', enabled: true },
    { name: 'Typo Co', careers_url: 'https://x.example.com', provider: 'greenhosue', enabled: true },
    { name: 'Off Co', careers_url: 'https://nobody.example.com', enabled: false },
    { careers_url: 'https://nameless.example.com', enabled: true },
  ], reg);

  if (unclaimed.silent.length === 1 && unclaimed.silent[0].name === 'Silent Co') {
    pass('an enabled entry with no provider and no scan_method is reported as silent');
  } else {
    fail(`silent bucket drifted: ${JSON.stringify(unclaimed.silent.map((e) => e.name))}`);
  }
  if (unclaimed.handoff.length === 1 && unclaimed.handoff[0].name === 'Handoff Co') {
    pass('a websearch entry is bucketed as handoff, not counted against the config');
  } else {
    fail(`handoff bucket drifted: ${JSON.stringify(unclaimed.handoff.map((e) => e.name))}`);
  }
  if (unclaimed.unknownProvider.length === 1 && /greenhosue/.test(unclaimed.unknownProvider[0].error || '')) {
    pass('a typo in provider: is its own bucket, carrying the id that did not resolve');
  } else {
    fail(`unknownProvider bucket drifted: ${JSON.stringify(unclaimed.unknownProvider)}`);
  }
  const allNames = [...unclaimed.silent, ...unclaimed.handoff, ...unclaimed.unknownProvider].map((e) => e.name);
  if (!allNames.includes('Off Co')) pass('a disabled entry is never reported as unclaimed');
  else fail('disabled entry leaked into the unclaimed buckets');
  // An enabled entry with no `name` can't be labeled in any bucket, so
  // findUnclaimedEntries skips it silently — verify-pipeline.mjs's Check 15
  // must count it separately (as malformed) rather than as a resolved entry.
  if (unclaimed.silent.length === 1 && unclaimed.handoff.length === 1 && unclaimed.unknownProvider.length === 1) {
    pass('an enabled entry with no name is skipped, not added to any bucket');
  } else {
    fail(`nameless entry leaked into a bucket: silent=${unclaimed.silent.length} handoff=${unclaimed.handoff.length} unknownProvider=${unclaimed.unknownProvider.length}`);
  }

  // scan.mjs DOES claim a local-parser entry, so excluding local-parser here —
  // the way auditCompanies() must, since it refuses to run the command — would
  // report a working parser as dead config.
  const parsed = findUnclaimedEntries(
    [{ name: 'Parser Co', careers_url: 'https://self-hosted.example.com', parser: { command: 'node', script: 'x.mjs' }, enabled: true }],
    reg,
  );
  if (parsed.silent.length === 0 && parsed.handoff.length === 0) {
    pass('a local-parser entry counts as claimed, matching scan.mjs rather than the audit');
  } else {
    fail(`local-parser entry misreported: ${JSON.stringify(parsed)}`);
  }
} catch (err) {
  fail(`audit-portals tests could not run: ${err.message}`);
}
