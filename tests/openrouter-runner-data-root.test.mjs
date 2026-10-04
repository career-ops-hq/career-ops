// tests/openrouter-runner-data-root.test.mjs — openrouter-runner reserves report
// numbers in the same directory it writes reports into.
//
// The module defines DATA_ROOT = getCareerOpsRoot() with a comment stating the
// rule ("Anchored to the career-ops data root, not to __dirname") and the reason
// (with CAREER_OPS_DATA_DIR set it was reading a different data/scan-history.tsv
// than the writers it delegates to). Its report paths did not follow it:
//
//     reservedNumbers = await reserveReportNumbers(1, {
//       rootDir: __dirname,
//       reportsDir: path.join(__dirname, 'reports'),
//     });
//
// reserve-report-num.mjs defaults to getCareerOpsRoot(), so those options
// actively redirect it to the CODE root — while the report is written to
// {DATA_ROOT}/reports/ by writeFile(). The allocator is asked whether a number is
// free somewhere the report will never be written, so it says yes for numbers
// already in use, and the write silently replaces an existing evaluation.
//
// This is the failure the reservation exists to prevent (AGENTS.md's #749), and
// it needs no race: one worker reaches it on its own.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { pass, fail, warn, ROOT, NODE } from './helpers.mjs';

console.log('\nopenrouter-runner — report numbers and blacklist follow the data root');

const cleanup = [];

/** A data root that already holds reports 001-003 and a tracker row for 3. */
function makeDataRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'or-runner-root-'));
  cleanup.push(dir);
  mkdirSync(join(dir, 'reports'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  for (const n of ['001', '002', '003']) {
    writeFileSync(join(dir, 'reports', `${n}-acme-2026-01-01.md`), `# report ${n}\n`);
  }
  writeFileSync(join(dir, 'data', 'applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 3 | 2026-01-01 | Acme | Eng | 4.5/5 | Applied | ✅ | [3](reports/003-acme-2026-01-01.md) | — |',
    '',
  ].join('\n'));
  return dir;
}

// CAREER_OPS_TRACKER and CAREER_OPS_REPORTS_DIR are cleared: both outrank the
// resolved root, so leaving a developer's own exports in place would mask the bug
// and point the allocator at their real reports directory (#3988).
function env(dir, extra = {}) {
  return {
    ...process.env,
    CAREER_OPS_DATA_DIR: dir,
    CAREER_OPS_ROOT: '',
    CAREER_OPS_TRACKER: '',
    CAREER_OPS_REPORTS_DIR: '',
    ...extra,
  };
}

/** Evaluate an expression in a child with the data root pointed at `dir`. */
function inDataRoot(dir, expr, extraEnv = {}) {
  return execFileSync(NODE, ['--input-type=module', '-e', expr], {
    cwd: ROOT, env: env(dir, extraEnv), encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
  }).trim();
}

// ── the collision: the runner's own reservation options ─────────────────────
//
// Read the reservation options out of the source and hand them to the real
// allocator. Driving the runner end to end would need an OpenRouter API key and a
// live model call; the defect is entirely in which directory it names, so this
// asserts that directory against the allocator that consumes it.
{
  const src = readFileSync(join(ROOT, 'openrouter-runner.mjs'), 'utf8');

  // The reservation and the write must name the same root. Asserted on the source
  // because that pairing is the whole bug: each line is defensible alone.
  const reserves = /reserveReportNumbers\(1,\s*\{\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*rootDir: DATA_ROOT,\s*reportsDir: path\.join\(DATA_ROOT, 'reports'\),/.test(src)
    || /reserveReportNumbers\(1,\s*\{[^}]*rootDir: DATA_ROOT,[^}]*reportsDir: path\.join\(DATA_ROOT, 'reports'\)/s.test(src);
  if (reserves) pass('the reservation names DATA_ROOT, the root writeFile() writes into');
  else fail('reserveReportNumbers is not called with DATA_ROOT — it would reserve a number in a directory the report is never written to');

  if (!/releaseReportNumbers\([^)]*path\.join\(__dirname, 'reports'\)/.test(src)) {
    pass('the release names the same directory as the reservation');
  } else {
    fail('releaseReportNumbers still names __dirname — the sentinel would be '
      + 'dropped in a directory the reservation never touched');
  }

  // No report path may be built from __dirname any more.
  const strays = [...src.matchAll(/path\.join\(__dirname, 'reports'\)/g)];
  if (strays.length === 0) pass('no report path is built from __dirname');
  else fail(`${strays.length} report path(s) still built from __dirname`);
}

// ── the same question, answered by the allocator itself ─────────────────────
{
  const dir = makeDataRoot();
  const allocate = (rootExpr) => inDataRoot(dir, `
    import path from 'node:path';
    import { getCareerOpsRoot } from ${JSON.stringify(new URL('../path-resolver.mjs', import.meta.url).href)};
    import { reserveReportNumbers, releaseReportNumbers } from ${JSON.stringify(new URL('../reserve-report-num.mjs', import.meta.url).href)};
    const DATA_ROOT = getCareerOpsRoot();
    const base = ${rootExpr};
    const got = await reserveReportNumbers(1, { rootDir: base, reportsDir: path.join(base, 'reports') });
    await releaseReportNumbers(got, { reportsDir: path.join(base, 'reports') });
    process.stdout.write(String(got[0]));
  `);

  // 001-003 exist in the data root and the tracker's highest row is 3, so the
  // only free number is 4. Against the code root the allocator sees none of that.
  const fromDataRoot = allocate('DATA_ROOT');
  if (fromDataRoot === '4') pass('reserving against the data root skips 001-003 and the tracker row → 4');
  else fail(`reserving against the data root gave ${fromDataRoot}, expected 4`);

  // The "other root" is an isolated empty directory, NOT process.cwd(). Pointing
  // the allocator at the checkout would make the suite create and delete a
  // RESERVED sentinel inside a developer's own reports/ — the same hazard the
  // reply-watch suite had to handle, and a test must not edit real data to prove
  // that code does. An empty directory stands in for exactly what the code root
  // was: a root that does not hold the user's reports.
  const otherRoot = mkdtempSync(join(tmpdir(), 'or-runner-otherroot-'));
  cleanup.push(otherRoot);
  mkdirSync(join(otherRoot, 'reports'), { recursive: true });
  const fromOtherRoot = allocate(JSON.stringify(otherRoot));
  if (fromOtherRoot !== fromDataRoot) {
    pass(`a root without the user's reports answers differently (${fromOtherRoot} vs ${fromDataRoot})`);
  } else {
    fail('both roots agree, so this fixture cannot discriminate — check that the '
      + 'data root fixture really holds reports 001-003');
  }

  // The consequence, stated as a fact about the fixture: the number the code root
  // hands out names a report file that already exists.
  const collides = existsSync(join(dir, 'reports', `${String(fromOtherRoot).padStart(3, '0')}-acme-2026-01-01.md`));
  if (collides) {
    pass(`a number reserved against the wrong root (${fromOtherRoot}) names an existing report — writeFile() would overwrite it`);
  } else {
    fail(`expected ${fromOtherRoot} to collide with an existing report in the data root`);
  }

  // Guard: no sentinel is left behind in either directory.
  const sentinels = [dir, otherRoot]
    .flatMap((d) => readdirSync(join(d, 'reports')).filter((f) => /RESERVED/.test(f)));
  if (sentinels.length === 0) pass('both reservations were released — no RESERVED sentinel left behind');
  else fail(`stale sentinels: ${sentinels.join(', ')}`);
}

// ── behavioural: `apply N` finds a report the user actually has ────────────
//
// cmdApply() resolves the report by number BEFORE any model call, so this reaches
// the fixed line through the real CLI without an API key. Against main the runner
// cannot see a report sitting in the user's data root and says so:
//
//     $ CAREER_OPS_DATA_DIR=$SB node openrouter-runner.mjs apply 1
//     Report not found: 1
//
// With the fix it gets past the lookup and fails later, on the missing key.
{
  const dir = makeDataRoot();
  mkdirSync(join(dir, 'modes'), { recursive: true });
  writeFileSync(join(dir, 'modes', 'apply.md'), 'apply mode\n');

  // spawnSync, not execFileSync: "Report not found" is written with console.error
  // and cmdApply then RETURNS, so the process exits 0. execFileSync hands back only
  // stdout on a zero exit, which silently discards the very marker this assertion
  // looks for -- the leg then skipped instead of failing against the bug.
  const r = spawnSync(NODE, [join(ROOT, 'openrouter-runner.mjs'), 'apply', '1'], {
    cwd: ROOT, env: env(dir, { OPENROUTER_API_KEY: '' }), encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
  });
  const out = `${String(r.stdout || '')}${String(r.stderr || '')}`;

  // Two markers, one on each side of the lookup: "Report not found" is printed by
  // the failure branch (openrouter-runner.mjs:802), which returns immediately, and
  // "Generating application form answers..." comes after it (:827). So the first
  // means the lookup read the wrong directory and the second means it read the
  // right one.
  const notFound = /Report not found: 1/.test(out);
  const pastLookup = /Generating application form answers/.test(out);

  // The runner fetches its model list from OpenRouter before either marker. That
  // is a network call this assertion does not need and must not depend on, so a
  // run that reaches neither marker is a skip, not a failure -- the source-level
  // assertions above cover the same lines deterministically, offline.
  if (notFound) {
    fail('`apply 1` reported "Report not found: 1" although reports/001-… exists '
      + 'in the data root — the lookup is reading the wrong directory');
  } else if (pastLookup) {
    pass('`apply 1` finds report 001 in the data root and proceeds past the lookup');
  } else {
    warn('openrouter-runner apply: reached neither marker (likely no network for '
      + `the model list) — behavioural leg skipped. Output: ${out.slice(0, 160)}`);
  }
}

// ── the model blacklist ────────────────────────────────────────────────────
{
  const dir = makeDataRoot();
  const resolved = inDataRoot(dir, `
    import path from 'node:path';
    import { getCareerOpsRoot } from ${JSON.stringify(new URL('../path-resolver.mjs', import.meta.url).href)};
    process.stdout.write(path.join(getCareerOpsRoot(), 'data', 'model-blacklist.json'));
  `);
  if (resolved === join(dir, 'data', 'model-blacklist.json')) {
    pass('the blacklist resolves under the data root');
  } else {
    fail(`blacklist resolved to ${resolved}, expected ${join(dir, 'data', 'model-blacklist.json')}`);
  }

  // Asserted as an INVARIANT, not as a spelling. The first version of this
  // check required `getCareerOpsRoot(), 'data', 'model-blacklist.json'` on one
  // line, and failed against an equivalent implementation that split the path
  // across a BLACKLIST_DIR constant — a test that fails on a correct fix is
  // worse than no test. What matters is that no blacklist path is built from
  // the script's own directory; how the join is spelled is the author's call.
  const src = readFileSync(join(ROOT, 'openrouter-runner.mjs'), 'utf8');
  const blacklistLines = src
    .split('\n')
    .filter((line) => /BLACKLIST/.test(line) && !line.trim().startsWith('//'));
  const fromDirname = blacklistLines.filter((line) => line.includes('__dirname'));
  if (blacklistLines.length > 0 && fromDirname.length === 0) {
    pass('no blacklist path is built from __dirname');
  } else if (blacklistLines.length === 0) {
    fail('no BLACKLIST path found at all — has the constant been renamed?');
  } else {
    fail(`the blacklist path is still built from __dirname:\n    ${fromDirname.join('\n    ')}`);
  }

  // Guard: the module still loads. The blacklist became a lazy accessor because
  // DATA_ROOT is declared further down the file, and getting that wrong is a
  // top-level ReferenceError rather than a wrong path.
  try {
    inDataRoot(dir, `await import(${JSON.stringify(new URL('../openrouter-runner.mjs', import.meta.url).href)});`);
    pass('the module still imports cleanly (no use-before-declaration)');
  } catch (err) {
    fail(`importing openrouter-runner.mjs failed: ${String(err.stderr || err.message).split('\n')[0]}`);
  }
}

// ── the default layout is unchanged ────────────────────────────────────────
//
// getCareerOpsRoot() returns the checkout when no env and no marker are set, so a
// user who never configured a data root must see identical behaviour. Asserted
// with the variables cleared rather than by reasoning about it.
{
  const resolved = execFileSync(NODE, ['--input-type=module', '-e',
    `import { getCareerOpsRoot } from ${JSON.stringify(new URL('../path-resolver.mjs', import.meta.url).href)};`
    + 'process.stdout.write(getCareerOpsRoot());',
  ], {
    cwd: ROOT, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: '' },
  }).trim();
  if (resolved === ROOT) pass('with no env set, the data root is the checkout — default behaviour unchanged');
  else warnOrFail(resolved);
}

function warnOrFail(resolved) {
  // A .career-ops-data marker in the developer's checkout legitimately moves the
  // root, so this is not a failure of the code under test.
  if (existsSync(join(ROOT, '.career-ops-data'))) {
    pass('a .career-ops-data marker is present, so the root is intentionally not the checkout');
  } else {
    fail(`with no env set the data root resolved to ${resolved}, expected the checkout ${ROOT}`);
  }
}

for (const dir of cleanup) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

// ── the census: every remaining __dirname use is accounted for ──────────────
//
// The assertions above name the three report paths and the blacklist, which is
// this bug. They cannot catch the NEXT one — a new data/ or reports/ path added
// on __dirname would pass all of them. This module has a DATA_ROOT and a comment
// stating the rule, and still had four paths that ignored it, so the rule needs
// something that checks it rather than a comment asking for it.
//
// A lint over ONE file, deliberately: other scripts resolve paths against their
// own directory for good reasons, and judging those needs the context each
// carries.
{
  const src = readFileSync(join(ROOT, 'openrouter-runner.mjs'), 'utf8');

  // The one legitimate use, with its reason. .env ships beside the script and is
  // read by loadDotenv before any data path is resolved; it is configuration for
  // the process, not user data, so it does NOT follow the data root.
  const ALLOWED = [
    { pattern: /path\.join\(__dirname, '\.env'\)/, why: '.env is process configuration, read beside the script' },
    { pattern: /^const __dirname = /m, why: 'the declaration itself' },
  ];

  // Every line mentioning __dirname, minus comments and the allowed uses.
  const offenders = src.split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => line.includes('__dirname'))
    .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*'))
    .filter(({ line }) => !ALLOWED.some(({ pattern }) => pattern.test(line)));

  if (offenders.length === 0) {
    pass('every __dirname use in openrouter-runner.mjs is the declaration or .env');
  } else {
    fail('these lines resolve a path against the script\'s own directory rather than '
      + 'the data root — if one of them is deliberate, add it to ALLOWED in this test '
      + `with its reason:\n    ${offenders.map(({ n, line }) => `${n}: ${line}`).join('\n    ')}`);
  }

  // And the positive form: the data-layer accessors still go through DATA_ROOT,
  // so a future edit cannot satisfy the check above by deleting __dirname while
  // hardcoding a path some other way.
  if (/function readFile\(relPath\) \{[\s\S]{0,120}path\.join\(DATA_ROOT, relPath\)/.test(src)
    && /function writeFile\(relPath, content\) \{[\s\S]{0,160}path\.join\(DATA_ROOT, relPath\)/.test(src)) {
    pass('readFile/writeFile still resolve through DATA_ROOT');
  } else {
    fail('readFile/writeFile no longer resolve through DATA_ROOT');
  }
}
