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
  console.log('\n' + '='.repeat(50));
  console.log(`📊 Results: ${passed} passed, ${failed} failed, ${warnings} warnings`);
  if (failed > 0) {
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
const WINDOWS_BASH_CANDIDATES = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
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
  const exe = resolveAllowedExecutable(cmd);
  try {
    return execFileSync(exe, args, { cwd: ROOT, encoding: 'utf-8', timeout: 30000, ...opts }).trim();
  } catch (e) {
    return null;
  }
}

/**
 * Check whether a repo-relative file exists.
 *
 * @param {string} path - Path relative to the career-ops repository root.
 * @returns {boolean} True when the file exists.
 */
export function fileExists(path) { return existsSync(join(ROOT, path)); }

let bashCache = null;

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
  if (process.platform !== 'win32') return (bashCache = 'bash');
  for (const cmd of WINDOWS_BASH_CANDIDATES) {
    try {
      execFileSync(cmd, ['-c', 'true'], { stdio: 'ignore' });
      return (bashCache = cmd);
    } catch {}
  }
  try {
    // Probe via argv vector — no shell string, nothing to interpolate.
    execFileSync('wsl', ['-e', 'bash', '-c', 'true'], { stdio: 'ignore' });
    return (bashCache = 'bash');
  } catch {}
  for (const cmd of ['bash']) {
    try {
      execFileSync(cmd, ['-c', 'true'], { stdio: 'ignore' });
      return (bashCache = cmd);
    } catch {}
  }
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
    const cygpathCmd = existsSync('C:\\Program Files\\Git\\usr\\bin\\cygpath.exe') ? 'C:\\Program Files\\Git\\usr\\bin\\cygpath.exe' : 'cygpath';
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
