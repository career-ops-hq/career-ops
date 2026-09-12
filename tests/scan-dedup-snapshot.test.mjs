// tests/scan-dedup-snapshot.test.mjs — one read per dedup source per scan run (#2382).
//
// A scan run used to parse scan-history.tsv three separate times (loadSeenUrls,
// loadSeenCompanyRoles, loadFingerprintHistory) and pipeline.md/applications.md
// twice each. `loadDedupSnapshot` reads each file once and hands the text to the
// three collectors, so the run operates on one coherent snapshot.
//
// The maintainer's mergeability bar for #2382 is "identical output before/after
// on the same fixture". The expected values below are GOLDEN: they were captured
// by running the three pre-refactor loaders on this exact fixture at upstream
// 402e798, then hard-coded. They must never be regenerated from the code under
// test — that would turn the behaviour proof into a tautology.
//
// The fixture deliberately exercises every policy branch that could silently
// diverge: a recheck-aged `added` row (the recheck TTL is the easiest thing to
// lose in a wiring mistake — a double-wrapped policy object reads as
// `recheckAfterDays: undefined` and dedups aged rows forever), a permanent
// status, an active and an expired cooldown, a legacy 7-column row, and a
// cosmetic utm query param.
import { pass, fail } from './helpers.mjs';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadDedupSnapshot, buildCompanyCanonicalizer } from '../scan.mjs';

console.log('\nscan.mjs — dedup snapshot: one read per source, golden outputs (#2382)');

const HISTORY_HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\tfingerprint\tposted_at\ttrust_score\ttrust_flags\tnormalized_company';

const HISTORY = [
  HISTORY_HEADER,
  // fresh `added` inside the recheck window, with fingerprint + cosmetic utm param
  'https://boards.greenhouse.io/acme/jobs/1?utm_source=x\t2026-08-01\tgreenhouse\tPlatform Engineer\tAcme\tadded\tRemote\tfp-acme-1\t2026-07-30\t\t\tacme',
  // recheck-aged `added` (recheckAfterDays=30, today=2026-08-07): NOT deduped, recheck-eligible
  'https://jobs.lever.co/beta/2\t2026-01-01\tlever\tData Engineer\tBeta\tadded\tBerlin\tfp-beta-2\t2025-12-28\t\t\tbeta',
  // permanent status: dedups the URL forever, never seeds a role key, fingerprint still recorded
  'https://boards.greenhouse.io/gamma/3\t2026-07-01\tgreenhouse\tML Engineer\tGamma\tskipped_expired\tRemote\tfp-gamma-3\t2026-06-28\t\t\tgamma',
  // active cooldown (until 2026-12-31 > today): dedups, no role key, no fingerprint
  'https://jobs.example.com/delta/4\t2026-07-15\tashby\tBackend Engineer\tDelta\tcooldown:refused:2026-12-31\tRemote\t\t\t\t\tdelta',
  // expired cooldown (until 2026-07-01 < today): NOT deduped, recheck-eligible
  'https://jobs.example.com/eps/5\t2026-06-01\tashby\tFrontend Engineer\tEpsilon\tcooldown:refused:2026-07-01\tRemote\t\t\t\t\tepsilon',
  // legacy 7-col row, fresh `added`: dedups + seeds a role key, no fingerprint column at all
  'https://old.example.com/zeta/6\t2026-08-05\tpersonio-feed\tSRE\tZeta\tadded\tMunich',
  '',
].join('\n');

const PIPELINE = `# Pipeline — Pending URLs

## Pending

- [ ] https://boards.greenhouse.io/pipeco/jobs/7 | PipeCo | Staff Engineer | Remote
- [x] https://jobs.lever.co/doneco/8 | DoneCo | Principal Engineer

## Processed
`;

const APPLICATIONS = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-07-20 | TrackCo | Head of Platform | 4.2/5 | Applied | ✅ | [12](reports/012-trackco-2026-07-20.md) | https://trackco.example.com/careers/9 |
`;

const POLICY = { recheckAfterDays: 30, today: '2026-08-07' };

// Golden outputs from the pre-refactor loaders (see header comment).
const GOLDEN = {
  seen: [
    'https://boards.greenhouse.io/acme/jobs/1',
    'https://boards.greenhouse.io/gamma/3',
    'https://boards.greenhouse.io/pipeco/jobs/7',
    'https://jobs.example.com/delta/4',
    'https://jobs.lever.co/doneco/8',
    'https://old.example.com/zeta/6',
    'https://trackco.example.com/careers/9',
  ],
  recheckEligible: 2,
  companyRoles: [
    'acme::platform engineer',
    'doneco::principal engineer',
    'pipeco::staff engineer',
    'trackco::head of platform',
    'zeta::sre',
  ],
  fingerprints: [
    { url: 'https://boards.greenhouse.io/acme/jobs/1?utm_source=x', dateStr: '2026-08-01', title: 'Platform Engineer', company: 'Acme', fingerprint: 'fp-acme-1' },
    { url: 'https://jobs.lever.co/beta/2', dateStr: '2026-01-01', title: 'Data Engineer', company: 'Beta', fingerprint: 'fp-beta-2' },
    { url: 'https://boards.greenhouse.io/gamma/3', dateStr: '2026-07-01', title: 'ML Engineer', company: 'Gamma', fingerprint: 'fp-gamma-3' },
  ],
};

// The module-level data/ paths are anchored to CAREER_OPS_ROOT (frozen at
// module load), so a chdir can no longer retarget them: each call receives the
// sandbox's explicit paths through loadDedupSnapshot's path-options seam.
function inSandbox(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dedup-snapshot-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, 'data', name), content, 'utf-8');
  }
  const paths = {
    scanHistoryPath: join(dir, 'data', 'scan-history.tsv'),
    pipelinePath: join(dir, 'data', 'pipeline.md'),
    applicationsPath: join(dir, 'data', 'applications.md'),
  };
  try {
    return fn(paths);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function sameArray(actual, expected) {
  return actual.length === expected.length && actual.every((v, i) => v === expected[i]);
}

// ── 1. Golden equivalence on the full fixture ───────────────────────────────
{
  const snapshot = inSandbox(
    { 'scan-history.tsv': HISTORY, 'pipeline.md': PIPELINE, 'applications.md': APPLICATIONS },
    (paths) => loadDedupSnapshot(POLICY, undefined, paths),
  );

  if (sameArray([...snapshot.seen].sort(), GOLDEN.seen)) {
    pass('snapshot seen-URL set matches the pre-refactor golden output');
  } else {
    fail(`seen-URL set diverged from golden: [${[...snapshot.seen].sort().join(', ')}]`);
  }

  if (snapshot.recheckEligible === GOLDEN.recheckEligible) {
    pass('snapshot recheckEligible count matches golden (aged row + expired cooldown)');
  } else {
    fail(`recheckEligible diverged: got ${snapshot.recheckEligible}, want ${GOLDEN.recheckEligible} — the recheck TTL policy is not reaching the collector`);
  }

  if (sameArray([...snapshot.seenCompanyRoles].sort(), GOLDEN.companyRoles)) {
    pass('snapshot company+role key set matches golden (permanent/cooldown rows excluded, aged row expired)');
  } else {
    fail(`company+role keys diverged from golden: [${[...snapshot.seenCompanyRoles].sort().join(', ')}]`);
  }

  if (JSON.stringify(snapshot.fingerprintHistory) === JSON.stringify(GOLDEN.fingerprints)) {
    pass('snapshot fingerprint rows match golden (status- and age-independent, legacy rows skipped)');
  } else {
    fail(`fingerprint rows diverged from golden: ${JSON.stringify(snapshot.fingerprintHistory)}`);
  }
}

// ── 2. Recheck policy must actually reach the collectors ────────────────────
// The same fixture without a recheck TTL (clock still pinned — cooldown expiry
// is clock-driven, not TTL-driven) dedups the aged Beta row and seeds its role
// key, and only the expired cooldown stays recheck-eligible. If this returned
// the same thing as the TTL run, the policy argument is being dropped somewhere
// in the composition — the exact silent change #2382's review flagged as
// unmergeable.
{
  const files = { 'scan-history.tsv': HISTORY, 'pipeline.md': PIPELINE, 'applications.md': APPLICATIONS };
  const noTtl = inSandbox(files, (paths) => loadDedupSnapshot({ today: '2026-08-07' }, undefined, paths));
  if (
    noTtl.seen.has('https://jobs.lever.co/beta/2') &&
    noTtl.seenCompanyRoles.has('beta::data engineer') &&
    noTtl.recheckEligible === 1
  ) {
    pass('without a recheck TTL the aged row dedups and seeds its role key (policy argument is live, not defaulted)');
  } else {
    fail(`no-TTL snapshot wrong: hasBetaUrl=${noTtl.seen.has('https://jobs.lever.co/beta/2')} hasBetaRole=${noTtl.seenCompanyRoles.has('beta::data engineer')} recheckEligible=${noTtl.recheckEligible} (want true/true/1)`);
  }
}

// ── 3. Company canonicalizer must actually reach the role-key collector ─────
// main() builds this from config.company_aliases and passes it as
// loadDedupSnapshot's second argument. Every fixture company canonicalizes to
// itself under the default normalizer, so checks 1–2 cannot see that argument:
// dropping `canonicalize` from the collectSeenCompanyRoles call inside
// loadDedupSnapshot leaves them all green. An alias map that rewrites one
// fixture company makes the wiring observable — if it breaks, company_aliases
// silently stops applying to company+role dedup and the same role is listed
// twice under two spellings.
{
  const files = { 'scan-history.tsv': HISTORY, 'pipeline.md': PIPELINE, 'applications.md': APPLICATIONS };
  const canonicalize = buildCompanyCanonicalizer({ 'Zeta Industries': ['Zeta'] });
  const snapshot = inSandbox(files, (paths) => loadDedupSnapshot(POLICY, canonicalize, paths));
  if (
    snapshot.seenCompanyRoles.has('zeta industries::sre') &&
    !snapshot.seenCompanyRoles.has('zeta::sre') &&
    snapshot.seenCompanyRoles.has('acme::platform engineer')
  ) {
    pass('aliased company lands under its canonical role key (canonicalize argument is live, not defaulted)');
  } else {
    fail(`aliased snapshot wrong: hasCanonical=${snapshot.seenCompanyRoles.has('zeta industries::sre')} hasRaw=${snapshot.seenCompanyRoles.has('zeta::sre')} hasAcme=${snapshot.seenCompanyRoles.has('acme::platform engineer')} (want true/false/true)`);
  }
}

// ── 4. Fresh install: absent files degrade to empty, never throw ────────────
{
  try {
    const snapshot = inSandbox({}, (paths) => loadDedupSnapshot(POLICY, undefined, paths));
    if (
      snapshot.seen.size === 0 &&
      snapshot.recheckEligible === 0 &&
      snapshot.seenCompanyRoles.size === 0 &&
      snapshot.fingerprintHistory.length === 0
    ) {
      pass('absent dedup sources degrade to empty sets on a fresh install');
    } else {
      fail(`fresh-install snapshot not empty: seen=${snapshot.seen.size} roles=${snapshot.seenCompanyRoles.size} fingerprints=${snapshot.fingerprintHistory.length}`);
    }
  } catch (err) {
    fail(`fresh-install snapshot threw: ${err.message}`);
  }
}

// ── 5. Empty file ≡ absent file ─────────────────────────────────────────────
// readIfExists hands '' to the collectors for an absent file; a zero-byte file
// must land in the same place.
{
  const snapshot = inSandbox(
    { 'scan-history.tsv': '', 'pipeline.md': '', 'applications.md': '' },
    (paths) => loadDedupSnapshot(POLICY, undefined, paths),
  );
  if (snapshot.seen.size === 0 && snapshot.seenCompanyRoles.size === 0 && snapshot.fingerprintHistory.length === 0) {
    pass('zero-byte dedup sources behave exactly like absent ones');
  } else {
    fail(`zero-byte sources diverged: seen=${snapshot.seen.size} roles=${snapshot.seenCompanyRoles.size} fingerprints=${snapshot.fingerprintHistory.length}`);
  }
}
