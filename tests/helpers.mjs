// tests/helpers.mjs — shared assertion helpers + counters for the test suite.
// Moved verbatim from test-all.mjs (issue #1440); no framework by design:
// the suite must run on a fresh clone with only Node.
import { execFileSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync as _rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');   // repo root (tests/ lives one level down)
export const QUICK = process.argv.includes('--quick');
export const NODE = process.execPath;

// Windows keeps a handle open on a just-exited child's files for a short
// window (antivirus widens it), so a cleanup rmSync can fail with EPERM even
// though every assertion passed — `force: true` suppresses ENOENT, not EPERM.
// Node retries exactly that error class (EBUSY/EMFILE/ENFILE/ENOTEMPTY/EPERM)
// with linear backoff when given maxRetries, so default it here. An explicit
// option still wins, and a removal that keeps failing still throws. Same
// wrapper test-all.mjs applies to its own call sites (#3066), shared so the
// suites under tests/ cannot drift from it.
export const rmSync = (target, opts = {}) => _rmSync(target, { maxRetries: 10, retryDelay: 100, ...opts });

/**
 * The per-script budget run() applies when a caller does not override it.
 *
 * Deliberately NOT substituted into the `timeout: 30000` literal inside run()
 * below. The comment there explains why that execFileSync call is kept
 * byte-identical: editing the line makes CodeQL re-attribute its long-standing
 * "uncontrolled command line" finding to whichever PR touched it. Exported so
 * callers can reason about the budget — how close a script came to it, say —
 * rather than hard-coding the number in a second file. The two are linked by
 * this comment, not by the compiler: change one, change the other.
 */
export const DEFAULT_SCRIPT_TIMEOUT_MS = 30_000;

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
 * Over-long streams keep BOTH ENDS rather than the head. A failing script's
 * diagnostic line can be at either end: an early case that blew up, or — for
 * the suites here, which print a tick per assertion — the `Results:` summary
 * and the newest cases at the very bottom. Keeping only the head means the
 * later a case was added, the more certain it is to be truncated away, which
 * is exactly backwards for something read only when a run goes red.
 *
 * That is not hypothetical: `agent-inbox-tests.mjs` grew past this cap, and a
 * windows-latest failure of its §7 cut off mid-word one assertion short of §8's
 * verdict — the assertion added specifically to attribute that failure (#3035).
 *
 * @param {number} [maxChars=2000] - Per-stream cap, keeping a runaway log readable.
 * @returns {string}
 */
export function formatRunFailure(maxChars = 2000) {
  if (!lastFailure) return '';
  const clip = (s) => {
    const t = String(s ?? '').trim();
    if (!t || t.length <= maxChars) return t;
    // The marker's own width comes OUT of the budget rather than on top of it,
    // so maxChars is a promise about the string this returns. (Appending the
    // marker after slicing to maxChars, as this did before, put every clipped
    // stream over its documented cap.)
    const mark = (n) => `\n    ... (${n} more chars elided)\n`;
    // The dropped count is printed inside the marker, so the marker's width
    // depends on the budget and the budget depends on its width. Break the
    // circle with the widest that count can ever be — t.length — which can only
    // over-reserve, never under.
    const budget = maxChars - mark(t.length).length;
    // Degenerate cap, narrower than the marker itself: honour the number rather
    // than emit a marker that alone overruns it.
    if (budget <= 0) return t.slice(0, maxChars);
    // Weighted to the tail, which is where a suite that prints per-assertion
    // puts its summary, but never zero head — an early stack trace is the
    // other common shape and dropping it entirely would just invert the bug.
    //
    // Math.floor(budget * 0.35) rounds to 0 below budget 3, which would hand
    // the whole allowance to the tail and quietly reinstate exactly that
    // inversion. Floor the head at one character whenever there is room for
    // two. A one-character budget is genuinely single-sided — there is no way
    // to keep both ends of a string in one character — so it keeps the tail.
    const head = budget >= 2 ? Math.max(1, Math.floor(budget * 0.35)) : 0;
    const tail = budget - head;
    return `${t.slice(0, head)}${mark(t.length - budget)}${t.slice(t.length - tail)}`;
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

/**
 * Recursively collect files under `dir` whose basename matches `match`.
 *
 * Deterministic by construction: entries are sorted lexicographically at every
 * level, so the result is identical on every run and every OS — the same
 * property test-all.mjs's own `tests/` discovery relies on (#1440).
 *
 * A missing `dir` yields `[]` rather than throwing, so the caller reports its
 * own contract failure (e.g. "discovery is empty") instead of the run dying
 * mid-traversal with an ENOENT that says nothing about what was expected.
 *
 * @param {string} dir - Absolute directory to walk.
 * @param {RegExp} match - Tested against each entry's basename.
 * @param {Set<string>} [skipDirs] - Directory names never descended into.
 * @returns {string[]} Absolute paths, parents before children.
 */
export function walkFiles(dir, match, skipDirs = new Set()) {
  if (!existsSync(dir)) return [];
  const out = [];
  const entries = readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) out.push(...walkFiles(full, match, skipDirs));
    } else if (match.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Make one of the repo's own dependencies resolvable from a sandbox Node cannot
 * reach `ROOT/node_modules` from.
 *
 * The PDF sandboxes are created under `ROOT/output` and run a copy of
 * generate-pdf.mjs, whose siblings theme-style.mjs and tracker-utils.mjs both
 * `import * as yaml from 'js-yaml'`. That specifier resolves by walking parent
 * directories up into `ROOT/node_modules`, and the walk starts from the
 * importer's REALPATH, because --preserve-symlinks is off by default. On a
 * checkout whose `output/` is symlinked out of the repo -- the layout people
 * adopt as the manual workaround for #524 -- the walk begins outside the repo,
 * never reaches `ROOT/node_modules`, and every spawned script dies with
 * ERR_MODULE_NOT_FOUND before parsing a single argument. The suite then reports
 * 20 behaviour regressions in assertions that never ran (#3165).
 *
 * Relocating those sandboxes to `tmpdir()` does NOT fix this: tmpdir is outside
 * the repo too. They work today only because `ROOT/output` happens to be
 * physically inside it, which is the assumption worth removing rather than
 * relocating. Linking the package into the sandbox's own `node_modules` --
 * beside the `playwright` stub each sandbox already writes there -- makes the
 * sandbox self-sufficient wherever it physically lives.
 *
 * @param {string} sandboxDir - Sandbox root; its `node_modules/` is created if absent.
 * @param {string} pkgName - Package directory name under `ROOT/node_modules`.
 * @returns {string} Path to the package as seen from inside the sandbox.
 */
export function linkRepoPackage(sandboxDir, pkgName) {
  const source = join(ROOT, 'node_modules', pkgName);
  const dest = join(sandboxDir, 'node_modules', pkgName);
  if (existsSync(dest)) return dest;
  if (!existsSync(source)) {
    throw new Error(`linkRepoPackage: ${pkgName} is not installed at ${source} -- run npm install`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  try {
    // 'junction' is ignored on POSIX, and on Windows it is the one link type
    // granted without Developer Mode or elevation -- the privilege whose absence
    // aborted a whole suite in #2828. The copy below is the last resort.
    symlinkSync(source, dest, 'junction');
  } catch {
    cpSync(source, dest, { recursive: true });
  }
  return dest;
}

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

/**
 * Build a throwaway git repository for the two updater suites that drive git
 * through the `gitIn` seam (`updater-add-paths`, `updater-is-tracked`). Only
 * the first asserts on ignore RESOLUTION; the second writes its own .gitignore
 * and then asks about index membership, which is a different question.
 *
 * The pins below are the reason this is shared rather than copied, but they are
 * not all load-bearing for both callers, and this docstring should not imply
 * otherwise. Mutation-tested by dropping each pin under a GIT_CONFIG_GLOBAL it
 * exists to neutralise:
 *
 *   - `commit.gpgsign=false` and `core.hooksPath` → an empty dir. Either one
 *     inherited from the environment breaks every commit the fixtures make.
 *     Dropping either reddens BOTH suites.
 *   - `core.excludesFile` → an empty file. A global ignore rule silently alters
 *     what is measured (the failure mode reported in #2269). Dropping it reddens
 *     updater-add-paths only: updater-is-tracked writes its own .gitignore and
 *     then reads index membership, which a global rule does not move. Kept for
 *     both as a defensive pin, proven by one.
 *
 * Point `core.excludesFile` at an empty file rather than /dev/null: git on
 * Windows maps that to `nul` and dies with "fatal: cannot use nul as an
 * exclude file".
 *
 * Kept as one body so a pin cannot be dropped from one caller while the other
 * keeps it — which is the drift CodeRabbit flagged on #2531, where two copies
 * meant a pin added to one left the other silently unprotected. Note that is a
 * weaker guarantee than "deleting a pin fails both suites", which the table
 * above shows is only true for two of the three.
 *
 * The two other `makeRepo` fixtures under tests/ are deliberately NOT folded in
 * here: `updater-local-system-edits` pins line endings instead of excludes and
 * seeds a base commit plus an `upstream` branch, and `updater-rollback-behavior`
 * pins nothing. They are different fixtures that share a name, not copies of
 * this one.
 *
 * `gitIn` is injected rather than imported so this module keeps depending on
 * nothing but Node builtins — 57 of the 62 suites import it, and none of them
 * should pull in update-system.mjs as a side effect of asking for `pass`/`fail`.
 *
 * @param {(dir: string, ...args: string[]) => any} gitIn - Updater's git runner.
 * @param {object} [options]
 * @param {string} [options.prefix='co-updater-'] - mkdtemp prefix, so a leftover
 *   temp dir names the suite that made it.
 * @param {boolean} [options.includeRoot=false] - Add `root` to the returned ctx.
 *   `addPaths` resolves paths against it to decide what is a directory; without
 *   it the guard would lstat the real career-ops checkout instead of the
 *   fixture. `isTracked` never reads it.
 * @returns {{dir: string, g: Function, ctx: {git: Function, root?: string}}}
 */
export function makeUpdaterRepo(gitIn, { prefix = 'co-updater-', includeRoot = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  const emptyExcludes = join(dir, '.git', 'co-empty-excludes');
  const emptyHooks = join(dir, '.git', 'co-empty-hooks');
  writeFileSync(emptyExcludes, '');
  mkdirSync(emptyHooks, { recursive: true });
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.excludesFile', emptyExcludes);
  g('config', 'core.hooksPath', emptyHooks);
  return { dir, g, ctx: includeRoot ? { git: g, root: dir } : { git: g } };
}

/**
 * Build a git environment nothing ambient can reach into.
 *
 * GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM pin the FILE layers. They do not
 * close the RUNTIME layer: GIT_CONFIG_COUNT with its KEY_n / VALUE_n pairs is
 * applied AFTER every config file, so an ambient `core.excludesFile` injected
 * that way overrides even the one a fixture sets for itself, and the isolation
 * silently stops holding - the exact leak this pinning exists to close,
 * arriving through the one door left open (#2567).
 *
 * COUNT is set to 0 rather than deleting the variables: it is a single
 * authoritative value, and git reads KEY_n / VALUE_n only up to COUNT, so any
 * stragglers are inert without having to enumerate them.
 *
 * `base` exists so a regression case can hand in a parent environment
 * carrying the injection. Every caller shares this one construction on purpose:
 * a test that hand-rolled its own env would keep passing if the pin were
 * dropped here, which is how the gap got in.
 */
export function hermeticGitEnv(gitConfigPath, base = process.env) {
  const env = {
    ...base,
    GIT_CONFIG_COUNT: '0',
    GIT_CONFIG_GLOBAL: gitConfigPath,
    GIT_CONFIG_SYSTEM: gitConfigPath,
  };
  // These two DO have to be enumerated, because COUNT governs KEY_n / VALUE_n
  // and nothing else, and neither of them is a config FILE that GLOBAL/SYSTEM
  // could shadow. Both survive all three pins above:
  //
  //   GIT_CONFIG_PARAMETERS  the channel git uses to hand `-c` down to a
  //                          subprocess, so it reaches every git invocation.
  //                          Measured: with it set, a commit made through this
  //                          env took its author from the ambient value.
  //   GIT_CONFIG             redirects the `git config` command, reads AND
  //                          writes. The fixtures in test-all.mjs call `git config` to
  //                          set themselves up, so with it set that write lands
  //                          in the ambient file instead of the fixture: the
  //                          setting never takes effect, and the suite mutates
  //                          a file outside its own temp dir.
  delete env.GIT_CONFIG_PARAMETERS;
  delete env.GIT_CONFIG;
  return env;
}
