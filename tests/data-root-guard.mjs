// tests/data-root-guard.mjs — proof that a test run left the developer's data alone.
//
// The suite is run inside real workspaces, by contributors and by end users
// checking an install, so "the tests passed" has to include "and your tracker is
// the tracker you started with". tests/helpers.mjs pins the data root to a
// scratch directory for that; this module is the check that the pin held. It
// fingerprints the real data root before the run and again at exit, and names
// every path that differs (#5113).
//
// It can only see a difference that survives to the end of the run. A suite
// that overwrites a live file and puts it back is invisible here — and loses
// the file when the run is interrupted between the two, which is what
// tests/stats.test.mjs did to the tracker. The guard keeps a write from going
// unnoticed; it does not make writing to the real root safe.
//
// No dependency on tests/helpers.mjs: helpers imports this, and the snapshot
// has to be taken before helpers repoints the data root.
import { createHash } from 'crypto';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { walkTree } from '../lib/walk-tree.mjs';

/**
 * The user layer, relative to the data root — the content half of
 * `USER_PATHS` in update-system.mjs; the other half is
 * `UNGUARDED_USER_PATHS` below. An entry is a file or a directory; one that
 * does not exist contributes nothing, so a fresh clone snapshots to almost
 * nothing and costs nothing.
 */
export const GUARDED_PATHS = [
  'cv.md',
  'article-digest.md',
  'voice-dna.md',
  'portals.yml',
  'config/profile.yml',
  'config/plugins.yml',
  'modes/_profile.md',
  'modes/_custom.md',
  'modes/_brief.md',
  'data',
  'reports',
  'interview-prep',
  'documents',
  'output',
  'jds',
  'writing-samples',
];

/**
 * The rest of `USER_PATHS`: user-owned paths the guard does not fingerprint,
 * each with the reason. A suite that wrote one of these for real would not be
 * reported here.
 *
 * Five are resolved from the checkout, not from the data root, so the scratch
 * root the suite pins does not move them and a snapshot of the data root does
 * not contain them. The sixth is under the data root and is left out on
 * purpose.
 *
 * Kept as a list so that each gap is a decision. tests/data-root-guard.test.mjs
 * holds `USER_PATHS` to this list plus `GUARDED_PATHS`: a path added to the
 * user layer later has to be put in one of them, with a reason if it is this
 * one.
 */
export const UNGUARDED_USER_PATHS = {
  '.career-ops-web': "the dashboard's run logs and memory under the data root, written whenever it is in use: a suite run beside an open dashboard would report it every time",
  'plugins.local': 'installed plugin code, kept beside plugins/ in the checkout',
  'plugins.lock': 'the plugin trust lock, kept beside plugins/ in the checkout',
  'opencode.json': "OpenCode's project config, read from the checkout by that CLI",
  '.claude/settings.json': "Claude Code's project config, read from the checkout by that CLI",
  '.claude/hooks': "Claude Code's project hooks, read from the checkout by that CLI",
};

/**
 * The marker that redirects the data root. It lives beside the code, not in
 * the data root, and a marker left pointing at a deleted temp directory sends
 * every script to an empty root.
 */
export const MARKER_FILE = '.career-ops-data';

// Content, through any link: a file linked into the data root is still the
// user's file, and what must not change is what it says.
function fingerprint(abs) {
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

/**
 * Fingerprint the user layer under `dataRoot`, plus the marker in `codeRoot`.
 *
 * @param {string} dataRoot - The data root to protect.
 * @param {string} codeRoot - The checkout, where the marker file lives.
 * @returns {Map<string, string>} Path (`/`-separated, relative to its root) → fingerprint.
 */
export function snapshotDataRoot(dataRoot, codeRoot) {
  const snapshot = new Map();
  const record = (key, abs) => {
    try {
      snapshot.set(key, fingerprint(abs));
    } catch (err) {
      // A file that vanished between the listing and the read is recorded as
      // unreadable rather than dropped, so it still compares unequal to a
      // snapshot in which it had content.
      snapshot.set(key, `unreadable:${err?.code ?? 'error'}`);
    }
  };
  for (const entry of GUARDED_PATHS) {
    const abs = join(dataRoot, entry);
    if (!existsSync(abs)) continue;
    // statSync, not lstat: a `data/` that is itself a link to the real data
    // directory is the directory to walk.
    if (!statSync(abs).isDirectory()) {
      record(entry, abs);
      continue;
    }
    walkTree(abs, {
      // A user's data is not this repository's tree: a checkout or a scratch
      // directory nested inside it is still theirs, and skipping it would
      // leave a place to write unseen.
      allowNestedCheckouts: true,
      links: 'follow',
      onFile: (file) => record(relative(dataRoot, file).split(sep).join('/'), file),
    });
  }
  const marker = join(codeRoot, MARKER_FILE);
  if (existsSync(marker)) record(MARKER_FILE, marker);
  return snapshot;
}

/**
 * Every path that differs between two snapshots.
 *
 * @param {Map<string, string>} before
 * @param {Map<string, string>} after
 * @returns {Array<{path: string, change: 'added'|'removed'|'modified'}>} Sorted by path.
 */
export function diffSnapshots(before, after) {
  const drift = [];
  for (const [path, hash] of before) {
    if (!after.has(path)) drift.push({ path, change: 'removed' });
    else if (after.get(path) !== hash) drift.push({ path, change: 'modified' });
  }
  for (const path of after.keys()) {
    if (!before.has(path)) drift.push({ path, change: 'added' });
  }
  return drift.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** How many drifted paths a report lists before it summarises the rest. */
const MAX_LISTED = 20;

/**
 * Render a drift list for the terminal.
 *
 * @param {string} dataRoot - The root the paths are relative to.
 * @param {Array<{path: string, change: string}>} drift - From `diffSnapshots`.
 * @returns {string[]} Lines, unindented.
 */
export function describeDrift(dataRoot, drift) {
  const lines = [`the test run changed the real data root (${dataRoot}):`];
  for (const { path, change } of drift.slice(0, MAX_LISTED)) {
    lines.push(`  ${change.padEnd(8)} ${path}`);
  }
  if (drift.length > MAX_LISTED) lines.push(`  … and ${drift.length - MAX_LISTED} more`);
  lines.push(
    'A suite must write to the scratch data root tests/helpers.mjs pins (SANDBOX_DATA_ROOT), never to this one.',
    'If something else wrote these files while the suite ran (the web UI, an agent, you), run it again.',
  );
  return lines;
}
