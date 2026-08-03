// tests/helpers.mjs — shared assertion helpers + counters for the test suite.
// Moved verbatim from test-all.mjs (issue #1440); no framework by design:
// the suite must run on a fresh clone with only Node.
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');   // repo root (tests/ lives one level down)
export const QUICK = process.argv.includes('--quick');
export const NODE = process.execPath;

let passed = 0;
let failed = 0;
let warnings = 0;

/**
 * Record and print one passing test assertion.
 *
 * The suite uses these small counters instead of a framework so it can run in
 * any freshly cloned career-ops checkout with only Node.js available.
 *
 * @param {string} msg - Human-readable success message for the terminal log.
 * @returns {void}
 */
export function pass(msg) { console.log(`  ✅ ${msg}`); passed++; }

/**
 * Record and print one failing test assertion.
 *
 * Failures increment the shared counter that controls the final process exit
 * code, while still allowing later checks to run and show the full problem set.
 *
 * @param {string} msg - Human-readable failure message for the terminal log.
 * @returns {void}
 */
export function fail(msg) { console.log(`  ❌ ${msg}`); failed++; }

/**
 * Record and print one non-fatal warning.
 *
 * Warnings are used for expected local-environment gaps, such as missing user
 * data in a clean repo, where the check should stay visible but not fail CI.
 *
 * @param {string} msg - Human-readable warning message for the terminal log.
 * @returns {void}
 */
export function warn(msg) { console.log(`  ⚠️  ${msg}`); warnings++; }

/** Current counter snapshot. */
export function results() { return { passed, failed, warnings }; }

/**
 * Print the summary line and exit with the suite's exit code.
 * Moved verbatim from the tail of test-all.mjs — output must stay byte-identical.
 */
export function finish() {
  // A discovered suite under tests/ that uses node:test reports through node's
  // own runner, which increments none of the counters above. node:test does set
  // process.exitCode = 1 when one of its tests fails, but process.exit(0) below
  // overwrites that -- so a failing tests/*.test.mjs printed "All tests passed"
  // and exited 0. Verified 2026-08-03 by dropping a deliberately failing suite
  // into tests/: "📊 2049 passed, 0 failed" / "🟢 All tests passed" / exit 0.
  //
  // That silently covered every node:test suite in the directory (url-identity,
  // digest, stats, filter-precision, pipeline-state, the provider tests...):
  // they only ever reported when run directly with `node --test`.
  //
  // Read before printing so the summary line tells the truth too. The counters
  // stay authoritative for inline assertions; this only adds a failure source
  // that was already being computed and thrown away.
  const runnerFailed = Boolean(process.exitCode);
  console.log('\n' + '='.repeat(50));
  console.log(`📊 Results: ${passed} passed, ${failed} failed, ${warnings} warnings`
    + (runnerFailed ? ' — plus failures in a discovered node:test suite (see above)' : ''));
  if (failed > 0 || runnerFailed) {
    console.log('🔴 TESTS FAILED — do NOT push/merge until fixed\n');
    process.exit(1);
  } else if (warnings > 0) {
    console.log('🟡 Tests passed with warnings — review before pushing\n');
    process.exit(0);
  } else {
    console.log('🟢 All tests passed — safe to push/merge\n');
    process.exit(0);
  }
}

// The only executables the test harness is allowed to spawn. run() maps its
// cmd argument onto these literals (never passing the argument itself through
// to the OS), so a test can never be tricked into executing an arbitrary
// binary — and CodeQL's uncontrolled-command-line finding is closed by
// construction rather than dismissed (alerts #36/#41/#42).
// Scoop installs Git for Windows under the user profile, not Program Files, so
// a Program-Files-only list misses it entirely and getBash() falls through to
// WSL bash. That fallback launches the script but not the environment: WSL has
// its own PATH, so the Windows `node` (and any stub binary a test injects via
// PATH) is invisible, and batch-runner.sh dies with `node: command not found`,
// exit 127. run() converts that to null, the caller does `|| ''`, and the
// assertion reports an empty argv -- which reads as a routing bug in the code
// under test rather than a missing shell. That is what all five spend_tier
// tests were doing on a machine where Git Bash was installed the whole time
// (#2344).
//
// Kept as fixed-shape literals joined onto %USERPROFILE% / %SCOOP% rather than
// a PATH search, so this stays an allowlist of trusted literals (see
// resolveAllowedExecutable below and CodeQL alerts #36/#41/#42).
const SCOOP_ROOTS = [
  process.env.SCOOP,
  process.env.USERPROFILE ? join(process.env.USERPROFILE, 'scoop') : null,
].filter(Boolean);

const WINDOWS_BASH_CANDIDATES = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  ...SCOOP_ROOTS.flatMap((root) => [
    join(root, 'apps', 'git', 'current', 'bin', 'bash.exe'),
    join(root, 'apps', 'git', 'current', 'usr', 'bin', 'bash.exe'),
  ]),
];

// Same discovery problem, same fix: cygpath must come from the SAME Git
// install as the bash above. Mixing them is #1409 in reverse -- cygpath emits
// /c/... while WSL bash expects /mnt/c/..., so the path silently fails to
// resolve inside the shell that receives it.
const WINDOWS_CYGPATH_CANDIDATES = [
  'C:\\Program Files\\Git\\usr\\bin\\cygpath.exe',
  ...SCOOP_ROOTS.map((root) => join(root, 'apps', 'git', 'current', 'usr', 'bin', 'cygpath.exe')),
];

/**
 * Map a requested executable onto the harness allowlist, returning the
 * trusted literal (not the caller-supplied string).
 *
 * @param {string} cmd - Requested executable.
 * @returns {string} Allowlisted executable path/name.
 */
function resolveAllowedExecutable(cmd) {
  if (cmd === process.execPath || cmd === 'node') return process.execPath;
  if (cmd === 'bash') return 'bash';
  if (cmd === 'git') return 'git';
  if (cmd === 'go') return 'go';
  if (cmd === 'wsl') return 'wsl';
  for (const candidate of WINDOWS_BASH_CANDIDATES) {
    if (cmd === candidate) return candidate;
  }
  throw new Error(`run(): executable not in the test-helper allowlist: ${cmd}`);
}

/**
 * Run an allowlisted executable and return trimmed stdout on success.
 *
 * Always execFileSync with an argument vector — no shell is ever involved, so
 * arguments are never shell-parsed. The string-command/execSync form was
 * removed (it had no callers). Failures return null so the caller decides
 * whether to count the result as a failure or warning.
 *
 * @param {string} cmd - Executable to run (must be on the allowlist above).
 * @param {string[]} [args=[]] - Argument vector.
 * @param {object} [opts={}] - Extra child_process options.
 * @returns {string|null} Trimmed stdout, or null when the command fails.
 */
export function run(cmd, args = [], opts = {}) {
  // Cleared as the very first statement. resolveAllowedExecutable() throws for a
  // command outside the allowlist, so a reset placed after it is skipped on that
  // path and the previous run's diagnostics survive, which would let a later
  // formatRunFailure() attribute an unrelated child's stderr to whatever failed
  // most recently. A stale diagnostic is worse than none.
  //
  // Clearing here rather than on the success path also keeps the execFileSync
  // call below byte-identical: editing that line makes CodeQL re-attribute its
  // long-standing "uncontrolled command line" finding to whichever PR touched
  // it. Nothing about what reaches the child changes either way, since the
  // executable is still allowlisted and the arguments are still an argv vector.
  lastFailure = null;
  const exe = resolveAllowedExecutable(cmd);
  try {
    return execFileSync(exe, args, { cwd: ROOT, encoding: 'utf-8', timeout: 30000, ...opts }).trim();
  } catch (e) {
    // execFileSync attaches the child's streams and exit status to the error.
    // Keep them: callers report failure as `<name> crashed`, and without this a
    // CI-only failure arrives as a single line with no stack, no assertion text,
    // and no exit code, which is not enough to act on.
    lastFailure = {
      status: e?.status ?? null,
      signal: e?.signal ?? null,
      stdout: e?.stdout == null ? '' : String(e.stdout),
      stderr: e?.stderr == null ? '' : String(e.stderr),
    };
    warnFallbackShell(exe);
    return null;
  }
}

/** Diagnostics from the most recent failed run(), or null if the last run succeeded. */
let lastFailure = null;

/**
 * Diagnostics for the most recently failed run().
 *
 * Cleared by a successful run so a stale record is never attributed to a later
 * command. The suite is sequential, so "most recent" is unambiguous.
 *
 * @returns {{status: number|null, signal: string|null, stdout: string, stderr: string}|null}
 */
export function lastRunFailure() {
  return lastFailure;
}

/**
 * The last failure rendered for interpolation into a failure message, or an
 * empty string when nothing has failed, so a caller can append it
 * unconditionally without changing its message on the success path.
 *
 * @param {number} [maxChars=2000] - Per-stream cap, keeping a runaway log readable.
 * @returns {string}
 */
export function formatRunFailure(maxChars = 2000) {
  if (!lastFailure) return '';
  const clip = (s) => {
    const t = String(s ?? '').trim();
    if (!t) return '';
    return t.length > maxChars ? `${t.slice(0, maxChars)}\n    ... (${t.length - maxChars} more chars)` : t;
  };
  const parts = [` (exit ${lastFailure.status ?? 'null'}${lastFailure.signal ? `, signal ${lastFailure.signal}` : ''})`];
  const out = clip(lastFailure.stdout);
  const err = clip(lastFailure.stderr);
  if (out) parts.push(`\n    stdout: ${out.replace(/\n/g, '\n    ')}`);
  if (err) parts.push(`\n    stderr: ${err.replace(/\n/g, '\n    ')}`);
  return parts.join('');
}

/**
 * Check whether a repo-relative file exists.
 *
 * @param {string} path - Path relative to the career-ops repository root.
 * @returns {boolean} True when the file exists.
 */
export function fileExists(path) { return existsSync(join(ROOT, path)); }

let bashCache = null;
let bashSourceCache = null;

/**
 * Which probe in getBash() produced the current bash, or null before the first
 * getBash() call.
 *
 * getBash() returns the bare string 'bash' from three different branches -- the
 * WSL probe, the PATH probe, and the give-up path -- so its return value alone
 * cannot tell a caller which shell it is about to run. On Windows those are not
 * interchangeable: 'bash' via WSL is a different OS with a different PATH and a
 * different mount scheme (/mnt/c/... vs /c/...). Recording the branch is what
 * lets a failure name the shell instead of leaving the reader to infer it
 * (#2344).
 *
 * @returns {'posix'|'git-bash'|'wsl'|'path'|'unresolved'|null} Resolution source.
 */
export function bashSource() { return bashSourceCache; }

/** Sources whose shell is ambiguous or foreign, and worth naming on failure. */
const FALLBACK_BASH_SOURCES = new Set(['wsl', 'path', 'unresolved']);

let warnedFallbackShell = false;

/**
 * Say out loud, once per process, that a failing shell command ran in a
 * fallback shell rather than Git Bash.
 *
 * Unconditional by design. formatRunFailure() already surfaces the child's
 * stderr to callers that ask for it, but the shell that produced it is still
 * invisible, and the whole failure mode of #2344 is that nobody suspects the
 * shell: it is missing, the script dies at `node`, run() returns null, `|| ''`
 * turns that into an empty string, and the assertion accuses the code under
 * test of a routing bug it does not have.
 *
 * Two things keep this from becoming noise in the suites that provoke command
 * failures on purpose. It fires only when getBash() landed on a fallback -- a
 * Git Bash resolved by literal path is unambiguous and stays silent, which is
 * every correctly provisioned machine -- and it fires at most once per process.
 *
 * @param {string} exe - Executable that just failed.
 * @returns {void}
 */
function warnFallbackShell(exe) {
  if (warnedFallbackShell) return;
  if (bashCache === null || exe !== bashCache) return;
  if (!FALLBACK_BASH_SOURCES.has(bashSourceCache)) return;
  warnedFallbackShell = true;
  const where = {
    wsl: 'WSL bash (`wsl -e bash`) -- a different OS with its own PATH',
    path: '`bash` from PATH, provenance unknown',
    unresolved: '`bash`, which no probe could confirm exists',
  }[bashSourceCache];
  console.error(`    [shell] this command ran under ${where},`);
  console.error('            because no Git Bash was found at any known location.');
  console.error('            The Windows `node` and any PATH-injected stub binary may be invisible there,');
  console.error('            so scripts calling node die with `node: command not found` (exit 127) and the');
  console.error('            assertion sees an empty result. Suspect the shell before the code under test.');
  console.error('            Install Git for Windows, or see formatRunFailure() for the raw stderr.');
}

/**
 * Resolve the bash executable to use for shell-script checks, lazily.
 *
 * The Windows probes below shell out up to four times (the WSL probe can even
 * boot the WSL VM). Every test file imports this module, so doing the probes
 * eagerly at module load would repeat that cost once per spawned test process.
 * Resolution therefore happens on first call and is memoized for the rest of
 * the process; suites that never touch bash never pay for it.
 *
 * @returns {string} Bash executable path or command name.
 */
export function getBash() {
  if (bashCache !== null) return bashCache;
  if (process.platform !== 'win32') { bashSourceCache = 'posix'; return (bashCache = 'bash'); }
  for (const cmd of WINDOWS_BASH_CANDIDATES) {
    try {
      execFileSync(cmd, ['-c', 'true'], { stdio: 'ignore' });
      bashSourceCache = 'git-bash';
      return (bashCache = cmd);
    } catch {}
  }
  try {
    // Probe via argv vector — no shell string, nothing to interpolate.
    execFileSync('wsl', ['-e', 'bash', '-c', 'true'], { stdio: 'ignore' });
    bashSourceCache = 'wsl';
    return (bashCache = 'bash');
  } catch {}
  for (const cmd of ['bash']) {
    try {
      execFileSync(cmd, ['-c', 'true'], { stdio: 'ignore' });
      bashSourceCache = 'path';
      return (bashCache = cmd);
    } catch {}
  }
  bashSourceCache = 'unresolved';
  return (bashCache = 'bash');
}

export function toBashPath(wpath) {
  if (process.platform !== 'win32') return wpath;
  const forwardSlashed = wpath.replace(/\\/g, '/');
  // Try cygpath first: it ships with Git for Windows, which is also what
  // provides `bash` on PATH on most Windows dev machines (see getBash()
  // above). cygpath emits /c/... paths that match Git Bash's mount scheme.
  // wslpath emits /mnt/c/... paths, which only resolve inside WSL's own
  // bash -- if WSL happens to be installed but `bash` on PATH still
  // resolves to Git Bash, a wslpath-first order silently produces a path
  // Git Bash can't find (see #1409). Only fall back to wslpath (and only
  // pay the cost of booting the WSL VM) when cygpath is unavailable.
  try {
    // execFileSync: the path is passed as an argv element, never interpolated
    // into a shell string, so quotes/spaces in it can't be re-parsed.
    const cygpathCmd = WINDOWS_CYGPATH_CANDIDATES.find((p) => existsSync(p)) || 'cygpath';
    const out = execFileSync(cygpathCmd, ['-u', forwardSlashed], { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    if (out) return out;
  } catch {}
  try {
    execFileSync('wsl', ['-e', 'bash', '-c', 'true'], { stdio: 'ignore' });
    const out = execFileSync('wsl', ['wslpath', '-u', forwardSlashed], { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    if (out) return out;
  } catch {}
  return wpath.replace(/^[A-Za-z]:/, m => '/' + m[0].toLowerCase()).replace(/\\/g, '/');
}

/**
 * Capture console.error output produced by an async callback.
 *
 * Several provider fetch() paths report truncation/failure via console.error;
 * their tests need to assert on those messages. This wraps the
 * save/override/restore dance in one place — console.error is restored in
 * finally, even when the callback throws, so one test's override can never
 * leak into the next.
 *
 * @param {() => Promise<any>|any} fn - Callback to run while capturing.
 * @returns {Promise<{result: any, errors: any[]}>} Callback result + captured messages.
 */
export async function captureConsoleErrors(fn) {
  const errors = [];
  const original = console.error;
  console.error = (msg) => errors.push(msg);
  try {
    const result = await fn();
    return { result, errors };
  } finally {
    console.error = original;
  }
}
