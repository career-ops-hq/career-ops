// tests/evidence-freshness.test.mjs — the stale-GitHub-evidence check that runs
// before Block A in oferta, auto-pipeline and batch. Every gh call goes through
// an injected runner: nothing here spawns gh or reaches the network.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import {
  readThresholds, findLatestScan, daysBetween, searchArgs, countNewMergedPrs, judge, runCli,
  DEFAULTS, QUERY_LIMIT,
} from '../evidence-freshness.mjs';

console.log('\nevidence-freshness.mjs — stale GitHub evidence before an evaluation');

const check = (ok, msg) => (ok ? pass(msg) : fail(msg));
const USER = 'jane-doe';
// Local noon on 2026-10-22, so "today" is the same date in every time zone.
const NOW = new Date(2026, 9, 22, 12, 0, 0);

const roots = [];
// The check is opt-in, so a sandbox turns it on unless a test says otherwise.
function sandbox({ github = 'https://github.com/jane-doe/', freshness = { enabled: true }, profile = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'co-evidence-freshness-'));
  roots.push(root);
  mkdirSync(join(root, 'config'), { recursive: true });
  if (profile) {
    const lines = ['candidate:', '  full_name: "Jane Doe"'];
    if (github !== null) lines.push(`  github: "${github}"`);
    if (freshness) lines.push('evidence_freshness:', ...Object.entries(freshness).map(([k, v]) => `  ${k}: ${v}`));
    writeFileSync(join(root, 'config', 'profile.yml'), `${lines.join('\n')}\n`);
  }
  return root;
}

/** Write output/github-evidence-{date}.json with its mtime at `writtenAt` (local time). */
function scanFile(root, date, { user = USER, writtenAt = null, body = null } = {}) {
  mkdirSync(join(root, 'output'), { recursive: true });
  const path = join(root, 'output', `github-evidence-${date}.json`);
  writeFileSync(path, body ?? `${JSON.stringify({ status: 'ok', generatedAt: date, user })}\n`);
  if (writtenAt) utimesSync(path, writtenAt, writtenAt);
  return path;
}

const ok = (rows) => ({ status: 0, signal: null, stdout: JSON.stringify(rows), stderr: '', notFound: false });
const prs = (n, repo = 'acme/widgets') => Array.from({ length: n }, () => ({ repository: { nameWithOwner: repo } }));

function fakeGh(response) {
  const calls = [];
  const runner = (args) => { calls.push(args); return typeof response === 'function' ? response(args) : response; };
  return { runner, calls };
}

function cli(root, runGh) {
  let out = '';
  let err = '';
  const code = runCli({
    dataRoot: root, runGh, profilePath: join(root, 'config', 'profile.yml'), now: NOW,
    stdout: (s) => { out += s; }, stderr: (s) => { err += s; },
  });
  let json = null;
  try { json = JSON.parse(out); } catch { /* reported by the caller's check */ }
  return { code, json, err };
}

try {
  // ── 1. No scan file ────────────────────────────────────────────────
  {
    const root = sandbox();
    const { runner, calls } = fakeGh(ok(prs(12)));
    const res = cli(root, runner);
    check(res.code === 0 && res.json?.status === 'ok', `no scan file -> exit 0, status ok (got ${res.code}, ${res.json?.status})`);
    check(res.json?.lastScan === null && res.json?.daysSince === null, 'no scan file -> lastScan and daysSince are null');
    check(res.json?.stale === true && /no GitHub evidence scan on record/.test(res.json?.reason ?? ''),
      `no scan file + merged PRs -> stale, reason says no scan is on record (${res.json?.reason})`);
    check(res.json?.notice === "No GitHub evidence scan on record; 12 merged PRs in other people's repos. Scores may understate fit.",
      `no scan file -> one-line notice (${res.json?.notice})`);
    check(calls.length === 1 && !calls[0].includes('--merged-at'), 'no scan file -> one query, with no date bound');

    const none = cli(root, fakeGh(ok([])).runner);
    check(none.json?.stale === false && none.json?.notice === null,
      'no scan file and no merged PRs in other people\'s repos -> not stale (nothing for a scan to find)');
  }

  // ── 2. Fresh scan ──────────────────────────────────────────────────
  {
    const root = sandbox();
    scanFile(root, '2026-10-20', { writtenAt: new Date(2026, 9, 20, 14, 3, 7) });
    const { runner, calls } = fakeGh(ok(prs(4)));
    const res = cli(root, runner);
    check(res.code === 0 && res.json?.status === 'ok' && res.json?.stale === false && res.json?.notice === null,
      `fresh scan (2 days, 4 PRs) -> not stale, no notice (${res.json?.reason})`);
    check(res.json?.lastScan === '2026-10-20' && res.json?.daysSince === 2 && res.json?.newMergedPrs === 4,
      'fresh scan -> lastScan, daysSince and newMergedPrs reported');
    check(res.json?.scanFile === 'output/github-evidence-2026-10-20.json', 'fresh scan -> names the scan file it used');
    check(/^within thresholds/.test(res.json?.reason ?? ''), 'fresh scan -> reason says it is within thresholds');

    const args = calls[0] ?? [];
    check(calls.length === 1, `exactly one gh call (got ${calls.length})`);
    const at = args.indexOf('--merged-at');
    check(at > 0 && args[at + 1] === `>=${new Date(2026, 9, 20, 14, 3, 7).toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
      `query starts at the time the scan was written, not the start of its day (${args[at + 1]})`);
    check(args[0] === 'search' && args[1] === 'prs' && args.includes('--merged')
      && args[args.indexOf('--author') + 1] === USER && args[args.indexOf('--json') + 1] === 'repository',
      'query: authored, merged PRs, repository field only (metadata)');
    check(args[args.indexOf('--limit') + 1] === String(QUERY_LIMIT) && args.at(-2) === '--' && args.at(-1) === `-user:${USER}`,
      'query: one page, and the user\'s own repos excluded');
  }

  // ── 3. Stale by count ──────────────────────────────────────────────
  {
    const root = sandbox();
    scanFile(root, '2026-10-15', { writtenAt: new Date(2026, 9, 15, 9, 0, 0) });
    const res = cli(root, fakeGh(ok(prs(79))).runner);
    check(res.json?.stale === true && res.json?.newMergedPrs === 79 && res.json?.daysSince === 7,
      `79 merged PRs since a 7-day-old scan -> stale (${res.json?.reason})`);
    check(res.json?.reason === '79 merged PRs since the last scan (stale at 5)', 'stale by count -> the reason names the count rule only');
    check(res.json?.notice === 'Last GitHub evidence scan: 2026-10-15 (7 days ago); 79 merged PRs since. Scores may understate fit.',
      `stale by count -> one-line notice (${res.json?.notice})`);

    const atThreshold = cli(root, fakeGh(ok(prs(DEFAULTS.minNewMergedPrs))).runner);
    const below = cli(root, fakeGh(ok(prs(DEFAULTS.minNewMergedPrs - 1))).runner);
    check(atThreshold.json?.stale === true && below.json?.stale === false,
      `the default count rule is ">= ${DEFAULTS.minNewMergedPrs}"`);

    const own = cli(root, fakeGh(ok([...prs(3), ...prs(6, 'Jane-Doe/side-project')])).runner);
    check(own.json?.newMergedPrs === 3 && own.json?.stale === false,
      'PRs in the user\'s own repos are not counted, even if the search returns them');

    const capped = cli(root, fakeGh(ok(prs(QUERY_LIMIT))).runner);
    check(capped.json?.newMergedPrsTruncated === true && /100\+ merged PRs since/.test(capped.json?.notice ?? ''),
      'a full search page is reported as "100+", not as an exact count');

    const tuned = sandbox({ freshness: { enabled: true, min_new_merged_prs: 100 } });
    scanFile(tuned, '2026-10-15', { writtenAt: new Date(2026, 9, 15, 9, 0, 0) });
    const raised = cli(tuned, fakeGh(ok(prs(79))).runner);
    check(raised.json?.status === 'ok' && raised.json?.stale === false && raised.json?.thresholds?.minNewMergedPrs === 100,
      'evidence_freshness.min_new_merged_prs in the profile replaces the default');
  }

  // ── 4. Stale by age ────────────────────────────────────────────────
  {
    const root = sandbox();
    scanFile(root, '2026-09-01', { writtenAt: new Date(2026, 8, 1, 10, 0, 0) });
    const res = cli(root, fakeGh(ok([])).runner);
    check(res.json?.stale === true && res.json?.daysSince === 51 && res.json?.newMergedPrs === 0,
      `51-day-old scan with no new PRs -> stale by age (${res.json?.reason})`);
    check(res.json?.reason === 'last scan 51 days ago (stale after 30 days)', 'stale by age -> the reason names the age rule only');
    check(res.json?.notice === 'Last GitHub evidence scan: 2026-09-01 (51 days ago); 0 merged PRs since. Scores may understate fit.',
      `stale by age -> one-line notice (${res.json?.notice})`);

    const edge = sandbox();
    scanFile(edge, '2026-09-22', { writtenAt: new Date(2026, 8, 22, 10, 0, 0) });
    check(cli(edge, fakeGh(ok([])).runner).json?.stale === false, 'exactly 30 days old is not stale (the rule is "> 30")');

    const both = cli(root, fakeGh(ok(prs(9))).runner);
    check(/9 merged PRs since the last scan/.test(both.json?.reason ?? '') && /51 days ago/.test(both.json?.reason ?? ''),
      'stale by both rules -> the reason names both');

    const longer = sandbox({ freshness: { enabled: true, max_age_days: 60 } });
    scanFile(longer, '2026-09-01', { writtenAt: new Date(2026, 8, 1, 10, 0, 0) });
    const extended = cli(longer, fakeGh(ok([])).runner);
    check(extended.json?.status === 'ok' && extended.json?.stale === false && extended.json?.thresholds?.maxAgeDays === 60,
      'evidence_freshness.max_age_days in the profile replaces the default');
  }

  // ── 5. gh unavailable or failing ───────────────────────────────────
  {
    const root = sandbox();
    scanFile(root, '2026-09-01');
    const missing = cli(root, fakeGh({ status: null, signal: null, stdout: '', stderr: '', notFound: true }).runner);
    check(missing.code === 0 && missing.json?.status === 'gh-unavailable' && missing.json?.stale === false && missing.json?.notice === null,
      `gh not installed -> exit 0, status gh-unavailable, not stale (${missing.json?.reason})`);
    check(/not installed/.test(missing.json?.reason ?? '') && missing.json?.lastScan === '2026-09-01',
      'gh not installed -> the reason says so, and the scan date is still reported');

    const loggedOut = cli(root, fakeGh({
      status: 4, signal: null, stdout: '', notFound: false,
      stderr: 'To get started with GitHub CLI, please run:  gh auth login\n',
    }).runner);
    check(loggedOut.code === 0 && loggedOut.json?.status === 'gh-unavailable' && /not logged in/.test(loggedOut.json?.reason ?? ''),
      'gh logged out -> exit 0, status gh-unavailable, reason says not logged in');

    const badToken = cli(root, fakeGh({
      status: 1, signal: null, stdout: '', notFound: false,
      stderr: 'non-200 OK status code: 401 Unauthorized body: "{\\"message\\": \\"Bad credentials\\"}"\n',
    }).runner);
    check(badToken.json?.status === 'gh-unavailable', 'a rejected token is reported as not logged in');

    const offline = cli(root, fakeGh({ status: 1, signal: null, stdout: '', stderr: 'error connecting to api.github.com\n', notFound: false }).runner);
    check(offline.code === 0 && offline.json?.status === 'gh-query-failed' && offline.json?.stale === false
      && /error connecting/.test(offline.json?.reason ?? ''),
      `query fails (offline) -> exit 0, status gh-query-failed, not stale (${offline.json?.reason})`);

    const killed = countNewMergedPrs(USER, null, () => ({ status: null, signal: 'SIGTERM', stdout: '', stderr: '', notFound: false }));
    check(killed.ok === false && killed.status === 'gh-query-failed' && /SIGTERM/.test(killed.detail),
      'a gh call killed by its timeout is a failed query, not "not logged in"');

    const garbage = countNewMergedPrs(USER, null, () => ({ status: 0, signal: null, stdout: 'not json', stderr: '', notFound: false }));
    check(garbage.ok === false && garbage.status === 'gh-query-failed', 'non-JSON output is a failed query');
  }

  // ── 6. Missing candidate.github (and other early exits) ────────────
  {
    for (const [label, opts] of [
      ['candidate.github unset', { github: null }],
      ['candidate.github is a repo link', { github: 'github.com/jane-doe/tool' }],
      ['no config/profile.yml', { profile: false }],
    ]) {
      const root = sandbox(opts);
      scanFile(root, '2026-09-01');
      const { runner, calls } = fakeGh(ok(prs(50)));
      const res = cli(root, runner);
      check(res.code === 0 && res.json?.status === 'no-github' && res.json?.stale === false && calls.length === 0,
        `${label} -> exit 0, status no-github, not stale, no gh call (${res.json?.reason})`);
    }

    for (const [label, freshness] of [
      ['no evidence_freshness block (the default)', null],
      ['evidence_freshness without enabled', { max_age_days: 30 }],
      ['evidence_freshness.enabled: false', { enabled: false }],
    ]) {
      const off = sandbox({ freshness });
      scanFile(off, '2026-09-01');
      const { runner, calls } = fakeGh(ok(prs(50)));
      const res = cli(off, runner);
      check(res.code === 0 && res.json?.status === 'disabled' && res.json?.stale === false && calls.length === 0,
        `${label} -> opt-in check stays off: status disabled, no gh call`);
    }

    const broken = sandbox({ profile: false });
    writeFileSync(join(broken, 'config', 'profile.yml'), 'candidate: [unclosed\n');
    const bad = cli(broken, fakeGh(ok([])).runner);
    check(bad.code === 0 && bad.json?.status === 'no-github' && /not valid YAML/.test(bad.json?.reason ?? ''),
      'an unparseable profile -> exit 0 with the reason, nothing thrown');
  }

  // ── 7. Pure helpers ────────────────────────────────────────────────
  {
    const d = readThresholds(null);
    check(d.thresholds.enabled === false && d.thresholds.minNewMergedPrs === 5 && d.thresholds.maxAgeDays === 30 && d.warnings.length === 0,
      'no evidence_freshness block -> off, with the documented thresholds (5 PRs, 30 days)');
    check(readThresholds({ evidence_freshness: { enabled: true } }).thresholds.enabled === true, 'enabled: true turns the check on');
    const yes = readThresholds({ evidence_freshness: { enabled: 'yes' } });
    check(yes.thresholds.enabled === false && yes.warnings.length === 1, 'an enabled value that is not a boolean is reported and leaves the check off');
    const typo = readThresholds({ evidence_freshness: { min_new_merged_prs: 0, max_age_days: 'soon' } });
    check(typo.thresholds.minNewMergedPrs === 5 && typo.thresholds.maxAgeDays === 30 && typo.warnings.length === 2,
      'invalid threshold values keep their defaults and are reported');
    check(readThresholds({ evidence_freshness: 'off' }).warnings.length === 1, 'a scalar evidence_freshness is reported, not obeyed');

    check(daysBetween('2026-10-15', '2026-10-22') === 7 && daysBetween('2026-10-23', '2026-10-22') === 0
      && daysBetween('2026-02-28', '2026-03-01') === 1, 'daysBetween counts calendar days, never negative');

    check(!searchArgs(USER, null).includes('--merged-at') && searchArgs(USER, '2026-10-15T00:00:00Z').includes('>=2026-10-15T00:00:00Z'),
      'searchArgs bounds the query only when there is a scan');

    const v = judge({ lastScan: '2026-10-22', daysSince: 0, newMergedPrs: 1, truncated: false, thresholds: { minNewMergedPrs: 1, maxAgeDays: 30 } });
    check(v.notice === 'Last GitHub evidence scan: 2026-10-22 (today); 1 merged PR since. Scores may understate fit.',
      `judge: singular wording and "today" (${v.notice})`);
  }

  // ── 8. Which scan file counts ──────────────────────────────────────
  {
    const root = sandbox();
    scanFile(root, '2026-10-01', { writtenAt: new Date(2026, 9, 1, 8, 0, 0) });
    scanFile(root, '2026-10-10', { writtenAt: new Date(2026, 9, 10, 8, 0, 0) });
    scanFile(root, '2026-10-12', { user: 'someone-else' });
    scanFile(root, '2026-10-14', { body: '{ not json' });
    writeFileSync(join(root, 'output', 'github-evidence-2026-10-13.md'), '# report\n');
    writeFileSync(join(root, 'output', 'github-evidence-2026-13-45.json'), '{}\n');
    const scan = findLatestScan(root, 'JANE-DOE');
    check(scan?.date === '2026-10-10',
      `newest readable scan of this user wins; another account's, unparseable and impossible-date files are skipped (got ${scan?.date})`);

    const copied = sandbox();
    // mtime on a later day (the file was copied or touched): fall back to the start of the scan's own day.
    scanFile(copied, '2026-10-10', { writtenAt: new Date(2026, 9, 18, 8, 0, 0) });
    const fallback = findLatestScan(copied, USER);
    check(fallback?.since === new Date(2026, 9, 10).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      `an mtime that is not on the scan's date falls back to the start of that day (${fallback?.since})`);

    check(findLatestScan(sandbox(), USER) === null, 'no output/ directory -> no scan');
  }

  // ── 9. Read-only, and the real entry point ─────────────────────────
  {
    const root = sandbox();
    scanFile(root, '2026-10-15', { writtenAt: new Date(2026, 9, 15, 9, 0, 0) });
    const before = readdirSync(join(root, 'output')).join();
    cli(root, fakeGh(ok(prs(79))).runner);
    check(readdirSync(join(root, 'output')).join() === before && readdirSync(root).sort().join() === 'config,output',
      'the check writes nothing');

    const bare = sandbox({ github: null });
    const env = { ...process.env, CAREER_OPS_ROOT: bare, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: '' };
    const run = spawnSync(NODE, [join(ROOT, 'evidence-freshness.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 30000, env });
    let parsed = null;
    try { parsed = JSON.parse(run.stdout); } catch { /* checked below */ }
    check(run.status === 0 && parsed?.status === 'no-github', `CLI with no candidate.github -> exit 0, JSON on stdout (got ${run.status}: ${run.stdout.slice(0, 80)})`);

    const help = spawnSync(NODE, [join(ROOT, 'evidence-freshness.mjs'), '--help'], { cwd: ROOT, encoding: 'utf8', timeout: 30000, env });
    const bogus = spawnSync(NODE, [join(ROOT, 'evidence-freshness.mjs'), '--bogus'], { cwd: ROOT, encoding: 'utf8', timeout: 30000, env });
    check(help.status === 0 && /Usage:/.test(help.stdout) && bogus.status === 1, '--help prints usage; an unknown flag is a usage error');
  }

  // ── 10. Wiring: modes, batch schema, example profile, updater ──────
  {
    const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
    const oferta = read('modes/oferta.md');
    const at = (text, marker) => text.indexOf(marker);
    const section = oferta.slice(at(oferta, '## GitHub evidence freshness'), at(oferta, '## Bounded Research Budget'));
    check(at(oferta, '## Agency confirmation gate') < at(oferta, '## GitHub evidence freshness')
      && at(oferta, '## GitHub evidence freshness') < at(oferta, '## Block A — Role Summary')
      && section.includes('node evidence-freshness.mjs'),
      'oferta runs the check after its gates and before Block A');
    check(/does not count against the \*\*Bounded Research Budget\*\*/.test(section)
      && /never change a score/.test(section) && /Never run `expand`/.test(section),
      'oferta: outside the research budget, never changes a score, never runs expand');
    check(/^\*\*GitHub evidence:\*\* \{/m.test(oferta), 'oferta report header has the stale-only GitHub evidence line');

    const auto = read('modes/auto-pipeline.md');
    check(auto.includes('`modes/oferta.md` → **GitHub evidence freshness**') && at(auto, 'GitHub evidence freshness') < at(auto, '## Step 2'),
      'auto-pipeline runs the oferta check once, before Block A');

    const batch = read('batch/batch-prompt.md');
    check(at(batch, '### Step 1.6') < at(batch, '### Step 1.7 — GitHub evidence freshness')
      && at(batch, '### Step 1.7 — GitHub evidence freshness') < at(batch, '### Step 2 — Evaluate A-G'),
      'batch runs the check as Step 1.7, before Step 2');
    const step17 = batch.slice(at(batch, '### Step 1.7'), at(batch, '### Step 2 — Evaluate A-G'));
    check(/once per batch run, not once per worker/.test(step17) && /Do not run the script yourself/.test(step17)
      && step17.includes('**Runtime: GitHub evidence freshness**'),
      'batch workers read the run-wide result from their prompt instead of running the check');
    const runner = read('batch/batch-runner.sh');
    check(runner.includes("printf '## Runtime: GitHub evidence freshness\\n\\n'"),
      'batch-runner.sh appends the section Step 1.7 names');
    check((batch.match(/^evidence_freshness: "\{fresh \| stale \| not_evaluated\}"$/gm) ?? []).length === 2,
      'evidence_freshness appears in both batch Machine Summary examples');
    check(/^- `evidence_freshness` is the Step 1\.7 check/m.test(batch) && /^\*\*GitHub evidence:\*\* \{/m.test(batch),
      'batch documents the key and the stale-only header line');

    const documented = read('config/profile.example.yml')
      .match(/^# evidence_freshness:\n#   enabled: (true|false)\n#   min_new_merged_prs: (\d+)\n#   max_age_days: (\d+)$/m);
    check(documented?.[1] === String(DEFAULTS.enabled) && documented?.[2] === String(DEFAULTS.minNewMergedPrs)
      && documented?.[3] === String(DEFAULTS.maxAgeDays),
      'config/profile.example.yml documents the same defaults the script uses (off, 5 PRs, 30 days)');

    check(read('lib/update-manifest.mjs').includes("  'evidence-freshness.mjs',\n"), 'evidence-freshness.mjs is in lib/update-manifest.mjs SYSTEM_PATHS');
  }
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
