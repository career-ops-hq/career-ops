/**
 * is-main-module.mjs — "was this file run, or imported?", answered correctly
 * when the path used to reach it is a symlink (#3170).
 *
 * Every `.mjs` entrypoint here ends with a guard that only runs the CLI tail
 * when the module IS the process entry. Around sixty of them hand-rolled that
 * comparison, in at least six spellings, and all but one shared the same bug:
 *
 *   const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
 *
 * Node resolves the ESM entry through REALPATH before it sets `import.meta.url`;
 * `process.argv[1]` keeps whatever spelling the caller typed. Reached through a
 * symlink the two sides describe the same file with different strings, never
 * match, and the CLI tail is skipped — so the process falls off the end of the
 * module and exits 0 having done nothing. `node /tmp/co/generate-pdf.mjs` on a
 * symlinked checkout printed no usage, produced no PDF, and reported success,
 * which every caller reads as "the PDF was written".
 *
 * That is not an exotic path: `/opt/career-ops` linked into a home directory, a
 * checkout on an external volume, a shared install symlinked per-user, a `~/bin`
 * shim — and `tmpdir()` itself on macOS, where `/var/folders` is a symlink to
 * `/private/var`. Tests that copied a script into a temp dir hit this and worked
 * around it by realpathing their own sandbox root, one test at a time.
 *
 * Canonicalizing BOTH sides through ONE function is the fix; `reserve-report-num.mjs`
 * had it right and alone. The general defect is broader than symlinks — it is
 * canonicalizing one side of a comparison and not the other, which also covers
 * Windows 8.3 short names and case on case-insensitive volumes (see
 * `canonicalize` below for how those are handled, and #3169 for the same shape
 * in a different comparison). Adopting one helper also collapses the six
 * spellings, and `tests/main-guard-convention.test.mjs` fails the suite if any
 * file goes back to reading the entry path itself — enforced, not remembered.
 */

import { realpathSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

/**
 * Canonicalize a path as far as the platform allows.
 *
 * `.native` rather than the JS implementation, because realpathing both sides is
 * only most of the fix. Two more spellings of "the same file" survive it, and
 * both are the same defect wearing different clothes:
 *
 *   - WINDOWS 8.3 SHORT NAMES. `C:\PROGRA~1\co\pdf.mjs` and
 *     `C:\Program Files\co\pdf.mjs` are one file; the JS realpath resolves
 *     symlinks and leaves the short name alone, `.native` expands it.
 *   - CASE. On a case-insensitive volume `C:\Repo\pdf.mjs` and `C:\repo\pdf.mjs`
 *     both open the file, and only `.native` reports the on-disk casing.
 *
 * What actually matters is that ONE function normalizes BOTH sides: any
 * canonical form works as long as the two paths reach it the same way. That is
 * the property the original bug lacked, and the reason this is a named function
 * rather than two inline calls — a future edit that canonicalizes one side has
 * to notice it is doing so.
 *
 * `.native` has existed since Node 9 and this package requires >=18, so the
 * fallback is for non-Node runtimes, not for old ones.
 *
 * @param {string} path - Absolute path to canonicalize.
 * @returns {string} The canonical path.
 */
const canonicalize = realpathSync.native ?? realpathSync;

/**
 * True when the module identified by `moduleUrl` is the process entrypoint.
 *
 * Call it as `isMainModule(import.meta.url)`. Returns false when the module was
 * imported rather than run, which is what keeps a CLI tail from firing inside
 * `node --test`, `test-all.mjs`, or any script that imports the module's
 * exported functions.
 *
 * @param {string} moduleUrl - The caller's `import.meta.url`. A `file:` URL, and
 *   deliberately nothing else — see the throw below.
 * @returns {boolean} True when this module is what `node` was pointed at.
 * @throws {TypeError} When handed a filesystem path instead of a `file:` URL.
 */
export function isMainModule(moduleUrl) {
  if (typeof moduleUrl !== 'string' || moduleUrl === '') {
    throw new TypeError(`isMainModule expects import.meta.url; got ${typeof moduleUrl === 'string' ? 'an empty string' : typeof moduleUrl}`);
  }

  if (!moduleUrl.startsWith('file:')) {
    // A Windows drive letter parses as a one-character URL scheme, so it has to
    // be excluded before the scheme test or `C:\co\pdf.mjs` reads as a URL.
    //
    // Matched WITHOUT requiring a following separator, because `C:repo\pdf.mjs`
    // is also a path — the drive-RELATIVE form, resolved against the current
    // directory on C:. Requiring `[\\/]` let that one through to the `return
    // false` below, which is the silent-suppression footgun this branch exists
    // to prevent. No registered URL scheme is a single letter, so treating
    // `X:` as a drive is unambiguous.
    const isPath = !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(moduleUrl) || /^[a-zA-Z]:/.test(moduleUrl);
    if (isPath) {
      // LOUD, because the quiet alternative is the bug this module exists to
      // kill. `isMainModule(import.meta.filename)` would resolve, compare
      // false, skip the CLI tail, and exit 0 having printed nothing — #3170
      // reintroduced one argument at a time. A crash names the mistake instead.
      throw new TypeError(
        `isMainModule expects import.meta.url (a file: URL), got a filesystem path: ${moduleUrl}. ` +
        'Returning false here would silently suppress the CLI, which is the defect #3170 fixed.',
      );
    }
    // A real non-file scheme (`data:`, `node:`, an http import). Not a
    // programmer error, and never the file named on the command line.
    return false;
  }

  // No argv[1] at all: `node -e`, `node --input-type=module`, a worker, the
  // REPL. Nothing was "run" in the sense the guard means. Checked AFTER the
  // argument validation so a bad call is caught wherever it happens.
  if (!process.argv[1]) return false;

  let modulePath;
  try {
    modulePath = fileURLToPath(moduleUrl);
  } catch {
    // A malformed file: URL. Nothing to compare against.
    return false;
  }

  const entryPath = resolve(process.argv[1]);

  // Fast path: the overwhelmingly common case, and it touches no filesystem.
  // Identical strings are the same file, so no canonicalization can change the
  // answer — this also keeps the guard working if the script has been deleted
  // or replaced underneath a still-running process.
  if (entryPath === modulePath) return true;

  try {
    return canonicalize(entryPath) === canonicalize(modulePath);
  } catch {
    // One of the two no longer resolves. The lexical comparison above already
    // said "different", and without a filesystem there is nothing further to
    // check — answering false keeps an unresolvable path from running a CLI.
    return false;
  }
}
