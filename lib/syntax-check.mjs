/**
 * syntax-check.mjs — "does every one of these .mjs files parse?", answered in
 * one process instead of one process per file (#5078).
 *
 * Two things syntax-check this repository: `scripts/check-syntax.mjs` (run as
 * `npm run lint`) and section 1 of `test-all.mjs`. Both ran `node --check` once
 * per file. `test-all.mjs` put them through a pool of 8 (#2387) and still spent
 * 22 s on ~1,190 files, because the cost was never the parsing: it was starting
 * node 1,190 times. Parsing all of them in one process takes about 0.3 s.
 *
 * HOW. `node --check` on an ES module does one thing with the source:
 * `new ModuleWrap(filename, undefined, source, 0, 0)` (node's
 * lib/internal/main/check_syntax.js). `new vm.SourceTextModule(source)` makes
 * the same call (lib/internal/vm/module.js), so it is the same parser entered
 * the same way, without the process. Neither one links, resolves an import or
 * runs a line of the file.
 *
 * `vm.SourceTextModule` only exists under `--experimental-vm-modules`, so the
 * pass is a child started with that flag: lib/syntax-check-child.mjs.
 *
 * WHAT IT IS TRUSTED FOR. Only for "this file parses". A file the fast pass
 * does not vouch for goes through `node --check` exactly as before, so:
 *
 *   - a syntax error prints the diagnostic it always printed;
 *   - a file the fast pass rejects wrongly costs one spawn, not a wrong verdict;
 *   - a fast pass that cannot run at all (a node without the flag, a child that
 *     died, output that is not the expected JSON) vouches for nothing, and every
 *     file is checked the old way. Slower, never less strict.
 *
 * That leaves one way to be wrong: accepting a file `node --check` would
 * reject. The shared constructor call above is the argument that it cannot, and
 * `tests/syntax-check.test.mjs` is the check: it runs both over a corpus of
 * broken and unusual modules and requires the same verdict on every one.
 *
 * ONLY FOR `.mjs`. `node --check` picks the goal (module or CommonJS) from the
 * extension and the nearest package.json; this parses everything as a module.
 * `collectMjsFiles()` returns nothing else, and `checkSyntax` refuses a list
 * that does.
 */

import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const FAST_PASS_CHILD = fileURLToPath(new URL('./syntax-check-child.mjs', import.meta.url));

// How many `node --check` children run at once. Only reached for the files the
// fast pass did not vouch for: none on a healthy tree, all of them when the
// fast pass is unavailable, which is the case this pool was sized for (#2387).
const CHECK_POOL_SIZE = 8;
// Exported so a caller describing a timed-out check names the real limit.
export const NODE_CHECK_TIMEOUT_MS = 30000;
// The fast pass parses the whole repository in well under a second. A child
// that has not answered in this long is not going to; the per-file path is
// still there, so this only bounds how long a hung child can delay it.
const FAST_PASS_TIMEOUT_MS = 60000;

/**
 * Parse every file in one child process and report which ones parsed.
 *
 * Never throws and never reports a file as broken: the answer is the set of
 * indexes the child vouched for, and the caller decides what to do with the
 * rest. `unavailable` is null when the child ran and answered, otherwise one
 * line saying why it did not.
 *
 * @param {string[]} files - Paths, absolute or relative to `cwd`.
 * @param {object} [opts]
 * @param {string} [opts.cwd] - Directory relative paths resolve against.
 * @param {string} [opts.node] - Node binary to start.
 * @param {string[]} [opts.nodeArgs] - Flags for the child. Overridden by tests
 *   to stand in for a node that does not have the flag.
 * @returns {Promise<{parsed: Set<number>, unavailable: string|null}>}
 */
export async function parseInOneProcess(files, {
  cwd = process.cwd(),
  node = process.execPath,
  nodeArgs = ['--experimental-vm-modules', '--no-warnings'],
} = {}) {
  const none = (why) => ({ parsed: new Set(), unavailable: why });
  let stdout;
  try {
    const running = execFileAsync(node, [...nodeArgs, FAST_PASS_CHILD], {
      cwd,
      timeout: FAST_PASS_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
    // A child that exits before reading (a rejected flag) closes the pipe under
    // this write. That failure is already reported through the exit code.
    running.child.stdin?.on('error', () => {});
    running.child.stdin?.end(JSON.stringify(files));
    ({ stdout } = await running);
  } catch (err) {
    const stderr = String(err?.stderr ?? '').trim().split('\n').filter(Boolean).pop();
    return none(err?.killed ? `no answer after ${FAST_PASS_TIMEOUT_MS}ms` : stderr || String(err?.message ?? err));
  }
  let indexes;
  try {
    indexes = JSON.parse(stdout).parsed;
  } catch {
    return none('its output was not JSON');
  }
  // All or nothing. An answer that names an index that does not exist did not
  // come from the child's loop over this list, and none of it is worth believing.
  if (!Array.isArray(indexes) || !indexes.every((i) => Number.isInteger(i) && i >= 0 && i < files.length)) {
    return none('its output was not a list of file indexes');
  }
  return { parsed: new Set(indexes), unavailable: null };
}

/**
 * Run `node --check` on one file.
 *
 * @param {string} file - Path, absolute or relative to `cwd`.
 * @param {object} [opts]
 * @param {string} [opts.cwd] - Directory a relative path resolves against.
 * @param {string} [opts.node] - Node binary to start.
 * @returns {Promise<Error|null>} Null when the file parses; otherwise the
 *   `execFile` error, with the child's `stderr`, `code`, `signal` and `killed`.
 */
export async function nodeCheck(file, { cwd = process.cwd(), node = process.execPath } = {}) {
  try {
    await execFileAsync(node, ['--check', file], { cwd, timeout: NODE_CHECK_TIMEOUT_MS });
    return null;
  } catch (err) {
    return err;
  }
}

/**
 * Syntax-check a list of `.mjs` files.
 *
 * One fast pass over all of them, then `node --check` on each file the fast
 * pass did not vouch for. Every error returned is `node --check`'s own.
 *
 * @param {string[]} files - `.mjs` paths, absolute or relative to `cwd`.
 * @param {object} [opts]
 * @param {string} [opts.cwd] - Directory relative paths resolve against.
 * @param {string} [opts.node] - Node binary to start.
 * @param {string[]} [opts.nodeArgs] - Flags for the fast pass (see `parseInOneProcess`).
 * @returns {Promise<{errors: (Error|null)[], fastPassUnavailable: string|null}>}
 *   `errors[i]` is null when `files[i]` parses, in the order given.
 *   `fastPassUnavailable` is null when the fast pass ran, otherwise why not.
 */
export async function checkSyntax(files, opts = {}) {
  const notMjs = files.find((f) => !f.endsWith('.mjs'));
  if (notMjs !== undefined) {
    throw new Error(`checkSyntax parses every file as an ES module and was given ${notMjs}`);
  }
  const { parsed, unavailable } = await parseInOneProcess(files, opts);
  const errors = new Array(files.length).fill(null);
  const pending = files.map((_, i) => i).filter((i) => !parsed.has(i));
  // Collected by index, so the result does not depend on which child finishes
  // first.
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const i = pending[next++];
      errors[i] = await nodeCheck(files[i], opts);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CHECK_POOL_SIZE, pending.length) }, worker));
  return { errors, fastPassUnavailable: unavailable };
}
