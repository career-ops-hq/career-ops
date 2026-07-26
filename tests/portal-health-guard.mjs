// tests/portal-health-guard.mjs — safe cleanup for a test-run write that may
// have landed in the wrong (script-directory) location under a cwd-resolution
// regression. A blind backup/restore of the whole file would silently discard
// any row a concurrent real process (e.g. a scheduled scan) appended to that
// same live file while the test's child process ran. This instead removes
// only the marker row the test itself may have written, leaving everything
// else in the file exactly as it was found.
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs';

/**
 * Remove a fixture marker row from `path` without disturbing any other content.
 *
 * @param {object} opts
 * @param {string} opts.path - File to guard (the script directory's data path).
 * @param {boolean} opts.existedBefore - Whether the file existed before the test ran.
 * @param {string} opts.marker - Substring unique to the fixture row the test wrote.
 * @returns {void}
 */
export function applyScriptDirGuard({ path, existedBefore, marker }) {
  if (!existsSync(path)) return; // never touched -- the expected, fixed case
  const current = readFileSync(path, 'utf-8');
  if (!current.includes(marker)) return; // no marker row -- leave untouched

  const remainingLines = current.split('\n').filter((line) => !line.includes(marker));
  const remaining = remainingLines.join('\n');

  if (!existedBefore && remaining.trim() === '') {
    rmSync(path, { force: true });
    return;
  }
  writeFileSync(path, remaining, 'utf-8');
}
