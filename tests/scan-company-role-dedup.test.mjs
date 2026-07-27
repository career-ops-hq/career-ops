// tests/scan-company-role-dedup.test.mjs — the company+role dedupe key must
// survive between scan runs.
//
// `loadSeenUrls` reads all three dedupe sources (scan-history.tsv, pipeline.md,
// applications.md). Its company+role counterpart read applications.md alone, so
// the role key was effectively intra-run: a role surfaced by a prior scan lives
// in scan-history and pipeline, and does not reach applications.md until the
// user evaluates and applies it. Companies that open one req per city therefore
// leaked one city variant per scan — run 1 added the Costa Mesa req (marking the
// key in memory only), run 2 re-seeded from applications.md, found the key
// absent, and the DC req cleared both the URL check and the role check.
//
// The unit checks exercise `loadSeenCompanyRoles` (the filesystem wrapper)
// rather than the pure collector, because the defect was in which sources get
// wired in, not in how any one source is parsed. The last check is end-to-end —
// two real `scan.mjs` runs over a fixture board — because the defect is in the
// wiring between the loader and main(), which no unit test observes.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { loadSeenCompanyRoles, companyRoleDedupKey } from '../scan.mjs';

console.log('\nscan.mjs — company+role dedupe survives between runs');

const EMPTY_TRACKER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`;

const HISTORY_HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation';

// Build a sandbox and return the paths, so nothing reads the developer's real
// data/ (the module-level paths are relative to process.cwd()).
function sandbox({ tracker = EMPTY_TRACKER, history = '', pipeline = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'co-roledash-'));
  mkdirSync(dir, { recursive: true });
  const paths = {
    dir,
    appsPath: join(dir, 'applications.md'),
    scanHistoryPath: join(dir, 'scan-history.tsv'),
    pipelinePath: join(dir, 'pipeline.md'),
  };
  writeFileSync(paths.appsPath, tracker);
  if (history) writeFileSync(paths.scanHistoryPath, history);
  if (pipeline) writeFileSync(paths.pipelinePath, pipeline);
  return paths;
}

function seenFor(paths, policy = {}) {
  return loadSeenCompanyRoles(paths.appsPath, undefined, {
    policy,
    scanHistoryPath: paths.scanHistoryPath,
    pipelinePath: paths.pipelinePath,
  });
}

const KEY = companyRoleDedupKey('Anduril', 'Strategic Finance');

// ── 1. The cross-run leak ───────────────────────────────────────────────────
// The regression itself: a role recorded as `added` in scan-history seeds the
// key even though it has not reached the tracker yet.
{
  const sb = sandbox({
    history: `${HISTORY_HEADER}\nhttps://ex.com/a/1\t2026-07-18\tgreenhouse\tStrategic Finance\tAnduril\tadded\tCosta Mesa\n`,
  });
  const seen = seenFor(sb);
  if (seen.has(KEY)) pass('scan-history `added` row seeds the role key (cross-run leak closed)');
  else fail(`scan-history \`added\` row did not seed the role key — got [${[...seen].join(', ')}]`);
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 2. pipeline.md seeds the key ────────────────────────────────────────────
// Both the pending form and the processed strikethrough form, with and without
// the optional trailing columns.
{
  const sb = sandbox({
    pipeline: [
      '- [ ] https://ex.com/a/1 | Anduril | Strategic Finance | Costa Mesa',
      '- [ ] https://ex.com/b/2 | Brex | BizOps Manager',
      '- [x] https://ex.com/c/3 | Harvey | GTM Finance Lead | NY | $200k | posted: 2026-07-01',
    ].join('\n') + '\n',
  });
  const seen = seenFor(sb);
  const want = [
    ['Anduril', 'Strategic Finance', 'with location column'],
    ['Brex', 'BizOps Manager', 'bare 3-column form'],
    ['Harvey', 'GTM Finance Lead', 'checked row with trailing segments'],
  ];
  let ok = true;
  for (const [co, role, label] of want) {
    if (!seen.has(companyRoleDedupKey(co, role))) { ok = false; fail(`pipeline.md ${label} did not seed the key`); }
  }
  if (ok) pass('pipeline.md seeds the role key (3-col, location column, trailing segments)');
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 3. URL-level failures must NOT seed ─────────────────────────────────────
// skipped_expired is not evidence the role was surfaced. Seeding from it would
// let a dead Costa Mesa URL permanently bury a live DC req; because an expired
// posting is recorded as skipped_expired rather than added, this self-heals.
{
  for (const status of ['skipped_expired', 'skipped_invalid_url', 'skipped_blocked_host']) {
    const sb = sandbox({
      history: `${HISTORY_HEADER}\nhttps://ex.com/a/1\t2026-07-18\tgreenhouse\tStrategic Finance\tAnduril\t${status}\tCosta Mesa\n`,
    });
    const seen = seenFor(sb);
    if (!seen.has(KEY)) pass(`\`${status}\` does not seed the role key (variant can resurface)`);
    else fail(`\`${status}\` seeded the role key — a dead URL would bury a live req`);
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

// ── 4. Seeding honours the recheck TTL ──────────────────────────────────────
// The role key mirrors the URL key, so it must not outlive it.
{
  const sb = sandbox({
    history: `${HISTORY_HEADER}\nhttps://ex.com/a/1\t2026-01-01\tgreenhouse\tStrategic Finance\tAnduril\tadded\tCosta Mesa\n`,
  });
  const fresh = seenFor(sb, { recheckAfterDays: 30, today: '2026-01-10' });
  const stale = seenFor(sb, { recheckAfterDays: 30, today: '2026-06-01' });
  if (fresh.has(KEY) && !stale.has(KEY)) {
    pass('role key honours scan_history.recheck_after_days (cannot outlive the URL key)');
  } else {
    fail(`recheck TTL not honoured — inside window: ${fresh.has(KEY)}, past window: ${stale.has(KEY)}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 5. applications.md still seeds (no regression) ──────────────────────────
// Header-aware parse (#954) must keep working, including a customized layout
// with an extra column that no consumer recognizes.
{
  const sb = sandbox({
    tracker: `# Applications Tracker

| # | Date | Company | Priority | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|----------|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Anduril | high | Strategic Finance | 4.0/5 | Applied | ✅ | — | seed row |
`,
  });
  const seen = seenFor(sb);
  if (seen.has(KEY) && seen.size === 1) {
    pass('applications.md still seeds the key, unknown extra column skipped');
  } else {
    fail(`applications.md seeding regressed — [${[...seen].join(', ')}]`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 6. Header and separator cells are not roles ─────────────────────────────
{
  const sb = sandbox({
    history: `${HISTORY_HEADER}\nhttps://ex.com/a/1\t2026-07-18\tgreenhouse\tStrategic Finance\tAnduril\tadded\tCosta Mesa\n`,
    pipeline: '- [ ] https://ex.com/z/9 | --- | :---:\n',
  });
  const seen = seenFor(sb);
  const garbage = [...seen].filter(k => /^[-:]+::|::[-:]+$|^company::/.test(k));
  if (garbage.length === 0) pass('header and markdown-separator cells never become keys');
  else fail(`garbage keys seeded: [${garbage.join(', ')}]`);
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 7. Absent sources are not an error ──────────────────────────────────────
// A fresh install has no scan-history or pipeline yet.
{
  const sb = sandbox();
  try {
    const seen = seenFor(sb);
    if (seen.size === 0) pass('absent scan-history/pipeline degrade to an empty set');
    else fail(`expected an empty set on a fresh install — got [${[...seen].join(', ')}]`);
  } catch (err) {
    fail(`absent sources threw: ${err.message}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 8. END-TO-END: two real scan runs over a three-city board ───────────────
// The only check here that would have caught the original bug. Every unit above
// passes against a build where main() simply never passes the extra sources —
// the defect lived in the wiring, so it has to be observed through the CLI.
//
// scan.mjs resolves data/ relative to process.cwd(), so the child runs with cwd
// pinned to a sandbox. The fixture board is reached through local-parser, which
// requires an in-repo script (realpath-guarded) and runs it with cwd at the repo
// root — hence the repo-relative `script:` against an absolute portals path.
// No network is involved.
{
  const dir = mkdtempSync(join(tmpdir(), 'scan-e2e-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'applications.md'), `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`);
    writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n');

    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, `title_filter:
  positive:
    - "Strategic Finance"
tracked_companies:
  - name: Fixture Defense
    careers_url: https://boards.example.com/fixture
    parser:
      command: node
      script: tests/fixtures/three-city-board.mjs
`);

    const scan = () => execFileSync(NODE, [join(ROOT, 'scan.mjs')], {
      cwd: dir,
      env: { ...process.env, CAREER_OPS_PORTALS: portals },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const entries = () => {
      const p = join(dir, 'data', 'pipeline.md');
      if (!existsSync(p)) return [];
      return readFileSync(p, 'utf-8').split('\n').filter(l => /^- \[[ x]\]\s+https?:\/\//.test(l));
    };

    scan();
    const afterFirst = entries().length;
    scan();
    const afterSecond = entries().length;

    if (afterFirst === 1 && afterSecond === 1) {
      pass('two scan runs over a one-role/three-city board yield exactly 1 pipeline entry');
    } else {
      fail(`same-role/different-city leak: ${afterFirst} entr(y/ies) after run 1, ${afterSecond} after run 2 (want 1 and 1)`);
    }
  } catch (err) {
    fail(`e2e scan run failed: ${err.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
