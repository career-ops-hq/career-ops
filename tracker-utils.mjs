/**
 * tracker-utils.mjs — shared helpers for rewriting `data/applications.md` rows.
 *
 * The tracker is a markdown table that several scripts mutate in place
 * (`dedup-tracker.mjs`, `normalize-statuses.mjs`, `merge-tracker.mjs`,
 * `set-status.mjs`). Keeping the row-rewrite, path-resolution, locking, and
 * atomic-write logic here means a fix lands once instead of drifting between
 * copies — and every writer excludes every other writer through the same lock.
 */

import { readFileSync, writeFileSync, renameSync, rmSync, statSync, lstatSync, existsSync, realpathSync, readlinkSync, accessSync, constants as fsConstants, chmodSync, appendFileSync, openSync, fstatSync, readSync, closeSync } from 'fs';
import { join, dirname, basename, resolve, relative, isAbsolute, sep } from 'path';
import { createHash, randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { loadYaml } from './lib/yaml-document.mjs';
// The lock protocol is lib/dir-lock.mjs, shared with every other core lock.
// This module only picks the tracker's lock directory, timing and error.
import { acquireDirLock } from './lib/dir-lock.mjs';
import { normalizeTextKey, firstLinkTarget } from './tracker-parse.mjs';

/**
 * Minimum age before directory age alone may condemn an ownerless lock or
 * recover guard. See `lockRecoveryVerdict` for why the age check needs a floor.
 *
 * Re-exported rather than redeclared: the floor is applied inside that function
 * now, so a local copy would be a constant this file no longer enforces — free
 * to drift from the one that actually decides.
 */
export { OWNERLESS_GRACE_MS } from './lib/dir-lock.mjs';

/**
 * Rebuild a markdown table row from the cells produced by `line.split('|')`.
 *
 * `split('|')` yields a leading empty element (before the opening `|`) and,
 * when the row ends with a trailing `|`, a trailing empty element too. A naive
 * `slice(1, -1)` assumes that trailing empty always exists — but a row written
 * without a trailing pipe (`| 5 | … | note`, still a valid row) keeps its real
 * last cell (the notes) at the end, so `slice(1, -1)` silently drops it. Here we
 * drop the leading empty and only drop a trailing element when it is genuinely
 * empty, preserving every real cell regardless of trailing-pipe style (and
 * tolerating extra columns like a custom Location).
 *
 * @param {string[]} parts - Trimmed cells from `line.split('|').map(s => s.trim())`.
 * @returns {string} The rebuilt `| a | b | … |` row.
 */
export function rebuildRow(parts) {
  const cells = parts.slice(1);
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return '| ' + cells.join(' | ') + ' |';
}

/**
 * The ONE rule for "this Report cell links to a report that is not on disk",
 * shared by verify-pipeline.mjs (Check 3), merge-tracker.mjs (merge-time
 * warning, #4748) and fix-report-links.mjs (#4750) so the three can never
 * disagree about which rows are broken.
 *
 * The link is the first markdown `](target)` in the cell. It resolves when it
 * names a REGULAR FILE from the tracker's own directory (markdown links are
 * relative to the file holding them, see #760) or, for legacy root-relative
 * links, from the data root. A directory is not a report. A cell with no link
 * (`—`, `N/A`, empty) is the documented "no report" convention and is never
 * broken.
 *
 * "The tracker's own directory" has two answers when the tracker is a symlinked
 * file: the folder the link lives in (where an editor resolves it from) and the
 * folder of its target. Pass both, from trackerLinkDirsFor() (#5374).
 *
 * @param {string} reportCell - Raw Report cell value.
 * @param {string|string[]} trackerDir - Directory (or directories) containing the tracker file.
 * @param {string} dataRoot - Data root (getCareerOpsRoot()).
 * @param {{onInspectionError?: Function, stat?: Function}} [options]
 * @returns {string|null} The unresolved link target, or null when there is no link,
 *   it resolves, or its targets could not be inspected conclusively.
 */
export function findDeadReportLink(reportCell, trackerDir, dataRoot, options = {}) {
  const link = firstLinkTarget(reportCell);
  if (link == null) return null;
  const inspect = options.stat ?? statSync;
  const errors = [];
  const trackerDirs = Array.isArray(trackerDir) ? trackerDir : [trackerDir];
  const candidates = [...new Set([...trackerDirs.map((dir) => join(dir, link)), join(dataRoot, link)])];
  for (const path of candidates) {
    try {
      if (inspect(path).isFile()) return null;
    } catch (err) {
      // ENOENT/ENOTDIR prove that this candidate is absent. Permission errors,
      // transient I/O failures and every other error do not prove that, so an
      // explicit repair must preserve the tracker cell instead of deleting it.
      if (err?.code !== 'ENOENT' && err?.code !== 'ENOTDIR') errors.push({ path, error: err });
    }
  }
  if (errors.length > 0) {
    options.onInspectionError?.({ link, errors });
    return null;
  }
  return link;
}

/**
 * Normalize company names for same-company lookups across tracker scripts.
 *
 * Company names can contain spaces, punctuation, or branding variants in the
 * tracker and incoming rows. Folding them gives every consumer (merge-tracker
 * dedup, set-status/outcome row resolution, company-history grouping, the
 * scan blacklist) the same stable company key, so a row one script would match
 * is never missed by another.
 *
 * Script-preserving via the shared normalizeTextKey(): the previous
 * `[^a-z0-9]` filter DELETED every non-Latin name, so アクメ株式会社,
 * グロベックス合同会社 and Яндекс all produced `''` and compared equal to each
 * other — merge-tracker then treated applications at different companies as
 * the same row and silently overwrote one (#2429). `?` still folds to `''`,
 * which is what the #1596 cross-channel Via guard depends on.
 *
 * @param {string} name - Company name from the tracker or an input row.
 * @returns {string} Case-folded, punctuation-free, script-preserving key.
 */
export function normalizeCompany(name) {
  return normalizeTextKey(name);
}

// True legal-entity suffixes, stripped repeatedly (chained) since a name can
// legitimately carry more than one ("Acme Holdings Inc." → "acme holdings").
// These are unambiguous enough that removing several in a row is safe.
//
// Shared by invite-match.mjs's normalizeCompanyName() (which chain-strips them)
// and companiesMatchIgnoringCorporateForm() below (which accepts them as a
// corporate-form tail). Exported so both read one vocabulary: a private second
// copy is exactly the identity drift #2445 set out to remove. International
// forms are included because a company cell may quote the employer with its
// local legal form ("Foo, GmbH", "Foo, APC"); keep every entry a single
// space-free word so normalizeTextKey() tokenizes it to one token the tail
// check can match and normalizeCompanyName()'s `\s<suffix>$` anchor stays
// literal (no regex metacharacters to escape).
export const LEGAL_SUFFIXES = [
  // US / UK
  'incorporated', 'inc', 'corporation', 'corp', 'company', 'co',
  'limited', 'ltd', 'llc', 'llp', 'lp', 'plc', 'pc', 'apc',
  // DE / AT / CH
  'gmbh', 'ag', 'kgaa', 'mbh', 'ug',
  // FR / BE / CH / LU
  'sas', 'sarl', 'eurl', 'snc', 'scs', 'sca', 'sa',
  // IT / ES / PT / LATAM
  'spa', 'srl', 'ltda', 'saa', 'sl', 'sll', 'slu',
  // NL / BE
  'bv', 'nv', 'cv',
  // Nordics / Baltics
  'ab', 'as', 'oy', 'oyj', 'kf', 'sf', 'aps', 'se',
  // Central / Eastern Europe
  'jsc', 'pjsc', 'zao', 'ooo', 'doo', 'kft', 'rt', 'zrt',
  // Commonwealth / Asia
  'pty', 'pte', 'pvt', 'sdn', 'bhd',
];

// Generic business-descriptor words that vary between how a recruiter signs
// an email and how the tracker recorded the company, but are common enough
// as substantive parts of a name (e.g. "Data Solutions" vs "Data Corp") that
// chaining their removal risks collapsing two different companies to the
// same key. Stripped at most once, and only after legal suffixes are gone —
// never chained with each other or with LEGAL_SUFFIXES.
export const GENERIC_DESCRIPTORS = [
  'group', 'holdings', 'technologies', 'technology', 'solutions',
  'canada', 'international',
];

// Words that name a legal form or a generic business descriptor rather than the
// employer. The union is safe here in a way chaining them in normalizeCompanyName
// is not, because the prefix rule below never lets two names disagree on a
// substantive token.
const CORPORATE_FORM_WORDS = new Set([...LEGAL_SUFFIXES, ...GENERIC_DESCRIPTORS]);

// A one-token stem carries almost no identity, and a two-letter one is usually
// an initialism that several unrelated employers share. Refusing them costs the
// duplicate row that exists today; accepting them risks deleting a real one.
// Exported because it doubles as the narrowest bucket width a caller can be
// certain of: every pair companiesMatchIgnoringCorporateForm() accepts shares at
// least this many leading characters of its normalized form (the stem length
// floor above), and an exact normalizeCompany() match shares the whole string —
// so grouping on the first MIN_STEM_CHARS characters can never split a pair the
// rule would join.
export const MIN_STEM_CHARS = 3;

/**
 * True when two company cells are the same employer written with a different
 * corporate suffix ("Acme" vs "Acme Technologies Inc.").
 *
 * normalizeCompany() folds case, punctuation and width but not corporate
 * forms, so a suffix variant of one employer never matches the plain name and
 * the same opening is written twice. This is the narrow rule that closes that:
 * used where the role title already matches and neither a req-number nor an
 * employer-board URL has proved the rows distinct. The exact tier above is
 * untouched — callers OR this with an exact-key comparison, because two
 * IDENTICAL names have equal token length and so return false here.
 *
 * The rule is a token PREFIX plus a corporate-form tail, not a stripped key.
 * Stripping suffixes before comparing looks equivalent and is not: it maps
 * "Acme Solutions" and "Acme Technologies" to the same "acme", which folds two
 * genuinely different employers and deletes one row. Requiring the shorter name
 * to be a prefix of the longer makes that structurally impossible, since
 * neither of those is a prefix of the other. It also means an extra token that
 * is NOT a corporate form ("Acme Robotics") still reads as a different
 * employer, which is the conservative direction: over-merging is unrecoverable
 * here (dedup-tracker.mjs drops the losing line, and applications.md is
 * gitignored with no backup), while under-merging leaves a duplicate row the
 * user can already see.
 *
 * Tokens come from normalizeTextKey(name, ' ') so this shares the Unicode,
 * NFKC and Turkish dotted-I handling every other identity key uses (#2445,
 * #2736) instead of a private strip. Scripts written without spaces produce a
 * single token and never match here, so CJK corporate forms are unaffected and
 * remain #2570's subject.
 *
 * @param {string} a - Company cell from one side of the comparison.
 * @param {string} b - Company cell from the other side.
 * @returns {boolean} True when the two cells name the same employer under a
 *   different corporate form.
 */
export function companiesMatchIgnoringCorporateForm(a, b) {
  const ta = normalizeTextKey(a, ' ').split(' ').filter(Boolean);
  const tb = normalizeTextKey(b, ' ').split(' ').filter(Boolean);
  const [stem, full] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  // Equal lengths are either the exact tier's business or a genuine
  // disagreement on a substantive token. An empty stem is the blind-employer
  // `?` marker and every other punctuation-only cell, which must never match a
  // named employer.
  if (stem.length === 0 || stem.length === full.length) return false;
  if (stem.join('').length < MIN_STEM_CHARS) return false;
  if (stem.some((token, i) => token !== full[i])) return false;
  return full.slice(stem.length).every(token => CORPORATE_FORM_WORDS.has(token));
}

/**
 * Control characters that are invisible in every rendered view of the tracker.
 *
 * C0 and DEL and C1, minus the three whitespace controls: `\t` is ordinary
 * whitespace inside a cell, and `\r`/`\n` are folded to a single space by
 * cell() before this runs — stripping any of the three would glue words
 * together instead of separating them.
 *
 * Deliberately NOT shared with the plugin token/display sanitizer, which strips
 * the same idea but a different range: it collapses all whitespace first and so
 * can take `\t`/`\r`/`\n` with the rest, which here would destroy word breaks.
 * Two ranges that must differ are two constants; only the ranges that must
 * agree are shared, which is the single export below.
 *
 * Exported because verify-pipeline.mjs has to recognize exactly what cell()
 * removes: stripping only stops NEW bytes entering, and a second copy of this
 * range would let the write path and the detector disagree about what counts.
 */
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

/**
 * Neutralize characters that would corrupt the applications.md table.
 *
 * Tracker rows are read with a raw `line.split('|')`, so a literal pipe or a
 * newline in a free-text value (company/role/location/notes) would shift every
 * later column. Replace rather than backslash-escape: `\|` would still split
 * on the inner pipe. Additive — normal cells are unchanged; only values that
 * would already break the table get sanitized.
 *
 * Control characters (#3892) get the same treatment for the same reason, and
 * here rather than in each writer: this is the one sanitizer every tracker
 * writer passes through — merge-tracker's buildRow (and so the web, which
 * dictates its rows through the same merge path), set-status's note. A guard
 * added per writer is a guard the next writer is free to reintroduce the bug
 * around. They are DELETED, not replaced with a space: the byte renders as
 * nothing in markdown, on GitHub and in the dashboard, so a substitution would
 * change text a human has already read. The asymmetry is the point — a byte
 * that costs one regex to reject costs an unrelated arithmetic discrepancy
 * much later to find, because every view of the table hides it.
 *
 * @param {*} v - Free-text value headed for a table cell.
 * @returns {string} Table-safe value.
 */
export function cell(v) {
  return String(v ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(CONTROL_CHARS, '')
    .replace(/\s*\|\s*/g, ' / ')
    .trim();
}

/**
 * Resolve the tracker file path for the current workspace.
 *
 * Supports both layouts: `data/applications.md` (boilerplate) and
 * `applications.md` (original root layout). The `CAREER_OPS_TRACKER` env var
 * overrides the path (used by tests and non-standard layouts). The result is
 * canonicalized so every script that locks or hashes the tracker path agrees
 * on one spelling.
 *
 * @param {string} rootDir - The career-ops repository root.
 * @returns {string} Absolute canonical tracker path.
 */
export { resolveTrackerPath } from './path-resolver.mjs';

/**
 * Resolve the workspace root that owns a tracker, i.e. where `reports/` and
 * `data/` sit: the tracker's parent in the `data/applications.md` layout, and
 * the tracker's own directory in the root `applications.md` layout.
 *
 * Derive sibling paths from THIS rather than from a script's own location, so
 * that pointing `CAREER_OPS_TRACKER` at another workspace moves the whole set
 * together. A script that mixes the two (tracker from the env, manifest from
 * its own directory) reads one workspace and writes another — which is how the
 * merge-tracker suite came to read a developer's real `data/pdf-index.tsv`
 * while writing an isolated temp tracker.
 *
 * @param {string} trackerPath - Tracker path, typically from resolveTrackerPath().
 * @returns {string} Absolute workspace root directory.
 */
export function resolveWorkspaceRoot(trackerPath) {
  const trackerDir = dirname(trackerPath);
  return basename(trackerDir) === 'data' ? dirname(trackerDir) : trackerDir;
}

/**
 * Workspace root for a script started from `rootDir`, derived from the
 * *uncanonicalized* tracker path. Unlike `resolveWorkspaceRoot(resolveTrackerPath(rootDir))`,
 * this does not realpath the tracker first, so a workspace that only symlinks its
 * `data/` directory (the natural workaround for #524) still resolves to the repo
 * rather than the symlink's target (#3169). Pointing `CAREER_OPS_TRACKER` at a
 * genuinely external workspace keeps moving the whole set together (#2471), since
 * the raw path is then the external tracker itself.
 *
 * The returned root is left in its lexical form, exactly as
 * `resolveWorkspaceRoot(resolveTrackerPath(rootDir))` was, so it keeps the same
 * spelling the module's containment checks compare against (they realpath both
 * sides themselves for the symlinked-ancestor case, e.g. /tmp -> /private/tmp).
 *
 * @param {string} rootDir - The career-ops data root directory.
 * @returns {string} Absolute workspace root directory.
 */
export function resolveWorkspaceRootFor(rootDir) {
  return resolveWorkspaceRoot(resolve(rawTrackerPath(rootDir)));
}

/**
 * Directories a tracker's relative links can be resolved from, for
 * findDeadReportLink(). The realpathed tracker's folder comes first, then the
 * folder of the tracker path as given, deduplicated.
 *
 * They differ when the tracker is a symlinked FILE, e.g. `data/applications.md`
 * linked into a private repo while `reports/` stays in the checkout. Editors
 * resolve `../reports/...` from the link's own folder, so checking only the
 * target's folder flagged every live link as missing (#5374). Same raw-path idea
 * as resolveWorkspaceRootFor (#3169); the lock key keeps the canonical path.
 *
 * @param {string} rootDir - The career-ops data root directory.
 * @returns {string[]} One or two absolute directories.
 */
export function trackerLinkDirsFor(rootDir) {
  const raw = resolve(rawTrackerPath(rootDir));
  return [...new Set([dirname(canonicalizeTrackerPath(raw)), dirname(raw)])];
}

/**
 * Resolve the PDF manifest (`data/pdf-index.tsv`) for the workspace that owns
 * a tracker. `CAREER_OPS_PDF_INDEX` overrides it explicitly.
 *
 * One definition for every reader, because the manifest path was previously
 * rebuilt from a literal in each script — and each picked its own base
 * directory, so `merge-tracker.mjs` derived it from the tracker while
 * `sync-pdf-flags.mjs` and `find.mjs` used their own install directory. Scripts
 * that resolve the tracker from `CAREER_OPS_TRACKER` then read one workspace's
 * manifest against another's tracker (#2471).
 *
 * @param {string} trackerPath - Tracker path, typically from resolveTrackerPath().
 * @returns {string} Absolute path to the PDF manifest.
 */
export function resolvePdfIndexPath(trackerPath) {
  return process.env.CAREER_OPS_PDF_INDEX
    || join(resolveWorkspaceRoot(trackerPath), 'data', 'pdf-index.tsv');
}

/**
 * Convert the tracker path into one stable absolute spelling before hashing it.
 *
 * Equivalent tracker paths can be written in multiple ways, such as a relative
 * path from the current shell, an absolute path, or a path that travels through
 * a symlink. The lock key must be based on one canonical spelling so all
 * processes that target the same tracker also target the same lock directory.
 *
 * @param {string} path - Raw tracker path from config, env, or the default.
 * @returns {string} Absolute canonical path when the file exists, else resolved path.
 */
import { canonicalizeTrackerPath, rawTrackerPath, storedSpelling } from './path-resolver.mjs';
export { canonicalizeTrackerPath };

/**
 * Check whether one absolute path stays inside another directory.
 *
 * This protects recursive lock cleanup from accepting paths that escape the
 * system temp directory through `..` segments or unrelated absolute roots.
 * Also the shared boundary check for outcome.mjs's --clean-output (#2653,
 * #2911), where an output/ path must be validated before ever being deleted.
 *
 * @param {string} childPath - Candidate path to validate.
 * @param {string} parentDir - Required parent directory boundary.
 * @param {{relative: Function, isAbsolute: Function, sep: string}} [pathMod] -
 *   Path primitives to use, defaulting to the platform's own. Tests pass
 *   `path.win32` or `path.posix` to deterministically exercise one platform's
 *   separator and absolute-path rules (drive letters, UNC paths) regardless
 *   of the host OS running the suite.
 * @returns {boolean} True when childPath is inside parentDir or equal to it.
 */
export function pathIsInside(childPath, parentDir, pathMod = { relative, isAbsolute, sep }) {
  const relativePath = pathMod.relative(parentDir, childPath);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${pathMod.sep}`) && !pathMod.isAbsolute(relativePath));
}

/**
 * Walk up to the nearest ancestor that exists on disk.
 *
 * `lstatSync`, not `statSync`: a symlink must count as existing in its own
 * right, so the caller canonicalizes the link itself rather than walking past
 * it to a parent that looks contained.
 *
 * @param {string} pathValue - Absolute candidate path.
 * @returns {string} The candidate, or its nearest existing ancestor.
 */
function nearestExistingPath(pathValue) {
  let candidate = pathValue;
  while (true) {
    try {
      lstatSync(candidate);
      return candidate;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}

/**
 * Check containment both lexically AND canonically (symlinks resolved).
 *
 * `pathIsInside` compares strings, which is right for a boundary that is only
 * ever about spelling (the lock-name guard) and for the injected-`pathMod`
 * tests that exercise win32/posix rules on paths that do not exist. It is NOT
 * enough before deleting: `resolve()` never follows symlinks, so an `output/`
 * containing a link to somewhere else lets a path spell itself as contained
 * while pointing outside — and the deletion is unrecoverable.
 *
 * Mirrors `isWorkspaceOutputPath` in generate-pdf.mjs, which guards the far
 * lower-stakes *write* path. Lives here so a third copy is not needed; that
 * one should be migrated onto this rather than left to drift (see #2911).
 *
 * @param {string} childPath - Candidate path to validate.
 * @param {string} parentDir - Required parent directory boundary.
 * @returns {boolean} True only when the path is inside both lexically and after
 *   resolving symlinks. False if canonicalization fails for any reason.
 */
export function pathIsInsideCanonical(childPath, parentDir) {
  const parent = resolve(parentDir);
  const child = resolve(childPath);
  if (!pathIsInside(child, parent)) return false;

  try {
    const canonicalParent = realpathSync(parent);
    const canonicalChild = realpathSync(nearestExistingPath(child));
    return pathIsInside(canonicalChild, canonicalParent);
  } catch {
    return false;
  }
}

/**
 * Compute the tracker lock directory for a tracker file.
 *
 * The lock name is derived from a hash of the canonical tracker path, so every
 * writer (`merge-tracker.mjs`, `set-status.mjs`) that targets the same tracker
 * contends on the same lock. `CAREER_OPS_TRACKER_LOCK` exists for tests and
 * unusual local layouts, but lock directories are removed recursively, so
 * env-provided paths must be absolute, live under the OS temp directory, and
 * use the career-ops lock-name prefix. Invalid values are ignored and the
 * deterministic temp-dir default is used instead.
 *
 * @param {string} appsFile - Canonical tracker path (see canonicalizeTrackerPath).
 * @returns {string} Safe lock directory path.
 */
export function trackerLockDirFor(appsFile) {
  // The Go dashboard's copy of this function canonicalizes with EvalSymlinks,
  // which on Windows writes every component as the filesystem stores it: the
  // long name for an 8.3 alias such as a short %TEMP%, and the stored case. The
  // lock name hashes the path string, so it is computed on that spelling too,
  // or the two languages lock different directories (#4957).
  const lockKey = createHash('sha256').update(storedSpelling(appsFile)).digest('hex').slice(0, 16);
  const tmpRoot = storedSpelling(realpathSync(tmpdir()));
  const fallback = join(tmpRoot, `career-ops-merge-tracker-${lockKey}.lock`);
  const envValue = process.env.CAREER_OPS_TRACKER_LOCK;
  if (!envValue || !isAbsolute(envValue)) return fallback;

  const candidate = resolve(envValue);
  const parentDir = dirname(candidate);
  // A parent that does not exist yet is taken as written, as Go does when
  // EvalSymlinks fails.
  const canonicalParent = existsSync(parentDir) ? storedSpelling(realpathSync(parentDir)) : resolve(parentDir);
  if (!pathIsInside(canonicalParent, tmpRoot)) return fallback;
  if (!basename(candidate).startsWith('career-ops-merge-tracker-')) return fallback;
  return candidate;
}

/**
 * Acquire an exclusive filesystem lock for one tracker mutation.
 *
 * The critical section must cover the full read/modify/write/move sequence, not
 * just the final write. Otherwise two processes can read the same old tracker
 * snapshot, compute independent updates, and let the later writer erase rows
 * written by the earlier one. The protocol (atomic directory creation, owner
 * metadata, jittered retry, stale-owner recovery, and a token-checked release
 * so one process cannot delete another process's newer lock) is
 * lib/dir-lock.mjs, the same one every other core lock uses.
 *
 * @param {string} lockDir - Directory path used as the lock sentinel.
 * @param {object} [options] - Lock timing options.
 * @param {number} [options.timeoutMs=60000] - Maximum time to wait for the lock.
 * @param {number} [options.retryMs=75] - Delay between acquisition attempts.
 * @param {number} [options.staleMs=600000] - Metadata-free stale-lock threshold, floored at OWNERLESS_GRACE_MS.
 * @param {string} [options.tracker] - Tracker path recorded in owner metadata.
 * @param {Function} [options.removeLock] - Release hook for deterministic fault tests.
 * @returns {Promise<{attempts:number,waitMs:number,staleRecovered:boolean,release:Function}>}
 * Lock handle with metadata and an idempotent release method.
 */
export async function acquireTrackerLock(lockDir, options = {}) {
  // Test-only ordering signal for the cross-process writer-lock suite. It is
  // emitted only after this process successfully creates the recover guard,
  // and remains on disk after that short-lived directory is removed. The
  // parent can therefore prove both contention and guard creation without
  // sampling a sub-millisecond window. Production callers have no marker path
  // and keep the existing lock behavior.
  const testWaitingMarker = process.env.NODE_ENV === 'test'
    ? process.env.CAREER_OPS_TRACKER_TEST_LOCK_WAIT_MARKER
    : undefined;
  return acquireDirLock(lockDir, {
    timeoutMs: options.timeoutMs ?? 60_000,
    retryMs: options.retryMs ?? 75,
    staleMs: options.staleMs ?? 10 * 60_000,
    owner: { tracker: options.tracker ?? '' },
    removeLock: typeof options.removeLock === 'function' ? options.removeLock : undefined,
    onRecoverGuard: testWaitingMarker
      ? () => writeFileSync(testWaitingMarker, JSON.stringify({
        pid: process.pid, ppid: process.ppid, lockDir, guardCreated: true,
      }), { flag: 'wx' })
      : undefined,
    // Tagged so callers can tell "lock is busy, retry later" apart from
    // filesystem/configuration failures rethrown out of the acquisition loop.
    timeoutError: () => Object.assign(
      new Error(`Timed out waiting for tracker lock at ${lockDir}`),
      { code: 'LOCK_TIMEOUT' },
    ),
  });
}

/**
 * Open one serialized read/replace transaction for an applications tracker.
 * Writers receive only the canonical path plus guarded read and atomic replace
 * operations, keeping the complete mutation inside one shared lock lifetime.
 */
export async function openTrackerTransaction(appsFile, options = {}) {
  const trackerPath = canonicalizeTrackerPath(appsFile);
  const { lockDir = trackerLockDirFor(trackerPath), ...lockOptions } = options;
  const lock = await acquireTrackerLock(lockDir, {
    timeoutMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS) || 60_000,
    retryMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_RETRY_MS) || 75,
    staleMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_STALE_MS) || 10 * 60_000,
    tracker: trackerPath,
    ...lockOptions,
  });
  let closed = false;
  let closeError = null;
  const assertOpen = () => {
    if (closed) throw new Error('Tracker transaction is already closed');
  };
  return {
    path: trackerPath,
    read() {
      assertOpen();
      return readFileSync(trackerPath, 'utf-8');
    },
    replace(content) {
      assertOpen();
      writeFileAtomic(trackerPath, content);
    },
    close() {
      if (closed) return closeError;
      try {
        lock.release();
      } catch (err) {
        closeError = err;
        console.error(`Warning: tracker transaction closed but lock cleanup failed at ${lockDir}: ${err.message}`);
      } finally {
        closed = true;
      }
      return closeError;
    },
  };
}

/**
 * Codes Windows raises when a rename-over-existing-file loses a race for the
 * destination handle. Same portability gap this module already documents for
 * mkdir/rm (#2777): POSIX `rename(2)` atomically replaces the destination and
 * cannot fail this way, so these never fire on Linux/macOS.
 */
const RENAME_CONTENTION_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Backoff schedule for a contended rename. Worst case ~193ms, then rethrow. */
export const RENAME_RETRY_DELAYS_MS = [1, 2, 5, 10, 25, 50, 100];

/**
 * Is this error Windows saying "the destination is busy right now"?
 *
 * Exported for the same reason `lib/dir-lock.mjs` exports `isMkdirContention`
 * and `isRmContention`: one definition, testable, and no second copy to drift.
 *
 * @param {unknown} err - Error thrown by a rename attempt.
 * @returns {boolean} True when the rename should be retried.
 */
export function isRenameContention(err) {
  return RENAME_CONTENTION_CODES.has(err?.code);
}

/**
 * Block the current thread for `ms` without an event-loop turn.
 *
 * `writeFileAtomic` is synchronous by contract (every tracker writer calls it
 * inside a held lock), so the backoff cannot be a promise.
 *
 * @param {number} ms - Milliseconds to sleep.
 * @returns {void}
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * `renameSync` that survives Windows contention for the destination handle.
 *
 * Windows refuses a rename whose destination is open by anyone else at that
 * instant, and answers EPERM/EACCES/EBUSY. The holder is usually not another
 * writer of ours (they are serialized by the tracker lock) but a transient
 * reader: an antivirus scanner, the Search indexer, or a concurrent
 * `readFileSync` from a reporting script. The handle is released in
 * milliseconds, so a short backoff converts a lost write into a completed one.
 *
 * This mirrors `isMkdirContention` / `isRmContention` in lib/dir-lock.mjs.
 * Same reasoning as #2777: treating portable-looking contention as fatal is how
 * a write gets LOST, and the tracker is the canonical store.
 *
 * @param {string} tmpPath - Source path (the fully written temporary file).
 * @param {string} path - Destination path to replace.
 * @param {(from: string, to: string) => void} [rename] - Injectable rename, for tests.
 * @returns {void}
 */
export function renameSyncWithRetry(tmpPath, path, rename = renameSync) {
  for (let attempt = 0; ; attempt++) {
    try {
      rename(tmpPath, path);
      return;
    } catch (err) {
      if (!isRenameContention(err) || attempt >= RENAME_RETRY_DELAYS_MS.length) throw err;
      sleepSync(RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * Replace a tracker file atomically using a same-directory temporary file.
 *
 * Writing into the same directory keeps the final rename atomic on normal
 * filesystems and avoids exposing a partially written `applications.md` to other
 * readers. The rename retries through short Windows contention (see
 * `renameSyncWithRetry`). If the write or rename ultimately fails, the temporary
 * file is cleaned up before the original error is rethrown.
 *
 * The replacement is a NEW file, so it takes the process umask rather than the
 * original's permissions. Pass `mode` to carry them over: it is applied to the
 * temporary file before the rename, so the destination is never observable with
 * wider permissions than it had.
 *
 * @param {string} path - Final file path to replace.
 * @param {string} content - Complete file content to write.
 * @param {{mode?: number}} [options] - `mode`: permission bits for the replacement.
 * @returns {void}
 */
export function writeFileAtomic(path, content, { mode } = {}) {
  const tmpPath = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  try {
    // flush: fsync before the rename, so a write error that surfaces only at
    // sync time (ENOSPC on some filesystems), or a crash, cannot leave the
    // rename durable and the data not.
    if (mode === undefined) {
      writeFileSync(tmpPath, content, { flush: true });
    } else {
      // Creation honours the umask, so it can only narrow `mode`; chmod then
      // sets it exactly.
      writeFileSync(tmpPath, content, { mode, flush: true });
      chmodSync(tmpPath, mode);
    }
    renameSyncWithRetry(tmpPath, path);
  } catch (err) {
    rmSync(tmpPath, { force: true });
    throw err;
  }
}

/**
 * Replace a hand-edited user file (cv.md, article-digest.md, portals.yml)
 * atomically, keeping what an in-place write kept.
 *
 * A bare writeFileSync truncates the file before writing it, so a crash or a
 * full disk mid-write leaves the user's only copy empty or cut short. The
 * atomic replacement is a new file, which would otherwise turn a symlinked
 * cv.md into a regular file and drop the file's permissions; writing through
 * the real path and carrying the mode over keeps both. A symlink whose target
 * does not exist yet (article-digest.md before its first entry) is followed by
 * hand, since realpathSync cannot resolve it, so the target is created.
 *
 * @param {string} path - The file to replace (may be a symlink, or not exist yet).
 * @param {string} content - Complete file content to write.
 * @returns {void}
 */
export function replaceUserFile(path, content) {
  const target = userFileWriteTarget(path);
  const exists = existsSync(target);
  // A rename only needs the directory to be writable, so it would replace a
  // file the user made read-only. The in-place write refused; so does this
  // (throws EACCES/EPERM).
  if (exists) accessSync(target, fsConstants.W_OK);
  const mode = exists ? statSync(target).mode & 0o777 : undefined;
  writeFileAtomic(target, content, { mode });
}

/**
 * The file replaceUserFile() should write: the real path, or for a dangling
 * symlink chain the path at its end, which an in-place write would have created.
 *
 * @param {string} path
 * @returns {string}
 */
function userFileWriteTarget(path) {
  let current = canonicalizeTrackerPath(path);
  for (let hops = 0; hops < 40; hops++) {
    let stat;
    try { stat = lstatSync(current); } catch { return current; }
    if (!stat.isSymbolicLink()) return current;
    current = resolve(dirname(current), readlinkSync(current));
  }
  throw new Error(`${path}: too many levels of symbolic links`);
}

/**
 * Append whole rows to a line-oriented user file (status-log.tsv, scan-history.tsv,
 * scan-runs.tsv, portal-health.tsv), first closing an unterminated last row.
 *
 * These ledgers are plain text a user may open and save by hand. An editor that
 * drops the final newline leaves the last row unterminated, and a bare
 * appendFileSync then writes the next row straight onto it: the old row's last
 * cell grows by the new row's first, and the new row never exists. Every reader
 * skips a malformed line quietly, so nothing reports the loss. Starting the
 * append on a fresh line is the rule agent-inbox.mjs and assessment-log.mjs
 * already apply to their own files.
 *
 * Only the last byte is read. A missing or empty file needs no leading newline.
 *
 * @param {string} path - Ledger file.
 * @param {string} text - One or more complete rows, each ending in a newline.
 * @returns {void}
 */
export function appendLedgerRows(path, text) {
  let lead = '';
  let fd;
  try {
    fd = openSync(path, 'r');
  } catch {
    fd = null; // no file yet: the append below creates it
  }
  if (fd !== null) {
    try {
      const { size } = fstatSync(fd);
      if (size > 0) {
        const last = Buffer.alloc(1);
        readSync(fd, last, 0, 1, size - 1);
        if (last[0] !== 0x0a) lead = '\n';
      }
    } finally {
      closeSync(fd);
    }
  }
  appendFileSync(path, lead + text, 'utf-8');
}

/**
 * Load the canonical tracker states from `templates/states.yml`.
 *
 * states.yml is the single source of truth for the canonical states and
 * their aliases. Parsing it here (instead of hardcoding the list) means a new
 * state or alias lands in one file and every consumer follows.
 *
 * `description` and `terminal` are passed through for callers that EXPLAIN the
 * states rather than list them (set-status.mjs --help). Both default rather
 * than throw: an entry omitting them is still a usable state.
 *
 * @param {string} statesPath - Path to templates/states.yml.
 * @returns {{id:string,label:string,aliases:string[],description:string,terminal:boolean}[]} Parsed state entries.
 */
export function loadCanonicalStates(statesPath) {
  const doc = loadYaml(readFileSync(statesPath, 'utf-8'));
  if (!doc || !Array.isArray(doc.states)) {
    throw new Error(`Malformed states file at ${statesPath}: expected a top-level "states" list`);
  }
  return doc.states.map(s => ({
    id: String(s.id ?? ''),
    label: String(s.label ?? ''),
    aliases: Array.isArray(s.aliases) ? s.aliases.map(String) : [],
    description: String(s.description ?? ''),
    terminal: s.terminal === true,
  }));
}

/**
 * Resolve user input to a canonical state label, strictly.
 *
 * Case-insensitive match against each state's label, id, and aliases, after
 * stripping markdown bold. Unlike merge-tracker's lenient batch normalization
 * (which defaults unknowns to "Evaluated" so a whole merge isn't lost), this
 * is the strict variant for interactive/CLI use: unknown input returns null so
 * the caller can reject it before anything touches the tracker.
 *
 * @param {string} input - Raw state text from the user or a script.
 * @param {{id:string,label:string,aliases:string[]}[]} states - From loadCanonicalStates().
 * @returns {string|null} Canonical label (e.g. "Applied"), or null when unknown.
 */
/**
 * Case-fold a status the way a HUMAN typed it, not the way JS lowercases it.
 *
 * JavaScript lowercases the Turkish dotted capital `İ` (U+0130) to `i` plus a
 * COMBINING DOT ABOVE (U+0307), and the mark survives — so `TEKLİF` becomes
 * `tekli\u0307f`, which equals no alias anyone would ever write. Turkish
 * uppercase status words are ordinary, so every all-caps Turkish row missed.
 *
 * Dropping U+0307 after an NFKC lowercase repairs it for every alias at once, rather
 * than listing the ~32 mark-bearing spellings the aliases would otherwise need
 * — a list that would also have to carry `ski\u0307p` and `hi\u0307red`, and that
 * would silently need extending on every future alias containing an `i`.
 *
 * No canonical state, label or alias legitimately contains U+0307, so this
 * cannot collapse two different states together (asserted in test-all).
 *
 * @param {*} input - Raw status text.
 * @returns {string} Lowercased, mark-folded, bold/whitespace-stripped status.
 */
export function foldStatusInput(input) {
  return String(input ?? '')
    .replace(/\*\*/g, '')
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    // NO `NFD`, for the same structural reason normalizeTextKey documents:
    // NFKC leaves ż, ė and ġ as SINGLE precomposed code points so this strip
    // cannot reach their dots, while `i` + U+0307 (what lowercasing `İ`
    // produces) has no precomposed form and stays exposed. Decomposing first
    // looks equivalent and is not — it collapses Żubr/Zubr, Ėmė/Eme and
    // Ġenerali/Generali, which is what 5df43e7 had to undo on the company key.
    .replace(/\u0307/gu, '');
}

export function resolveCanonicalState(input, states) {
  const clean = foldStatusInput(input);
  if (!clean) return null;
  for (const s of states) {
    if (s.label.toLowerCase() === clean) return s.label;
    if (s.id.toLowerCase() === clean) return s.label;
    if (s.aliases.some(a => a.toLowerCase() === clean)) return s.label;
  }
  return null;
}

/**
 * Resolve a raw tracker status CELL to its canonical lowercase state id.
 *
 * The read-side twin of resolveCanonicalState(): scripts that bucket or compare
 * tracker rows (analyze-patterns, tracker-sync-check) work in ids
 * (`interview`), not labels (`Interview`), and read cells that legacy trackers
 * left with a date appended (`Rejected 2026-06-01`). Both steps live here so no
 * reader needs its own alias table. The hand-copied ones had drifted: a
 * `Mülakat` row counted as "pending" in the pattern analysis and as an
 * unrecognized status in the sync check.
 *
 * @param {*} input - Raw status cell from applications.md.
 * @param {{id:string,label:string,aliases:string[]}[]} states - From loadCanonicalStates().
 * @returns {string|null} Canonical id (e.g. "interview"), or null when unknown.
 */
export function resolveCanonicalStateId(input, states) {
  const cell = String(input ?? '').replace(/\*\*/g, '').replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '');
  const label = resolveCanonicalState(cell, states);
  if (label === null) return null;
  return states.find(s => s.label === label).id.toLowerCase();
}

/**
 * Canonical process-exit codes shared by every locked, single-purpose
 * tracker-writer CLI (set-status.mjs, mark-pdf-ready.mjs, ...) — one source
 * so a new script can't drift from the numbering an existing one already
 * commits to (callers/CI may depend on these exact values).
 */
export const CLI_EXIT = { OK: 0, USAGE: 1, NOT_FOUND: 2, AMBIGUOUS: 3, LOCK_TIMEOUT: 4 };

/**
 * Build a failWith(exitCode, code, message, extra) bound to a --json flag,
 * shared by every canonical tracker-writer CLI so the JSON-vs-human error
 * contract can't drift between them.
 *
 * With json:true the error object goes to stdout so machine callers always
 * parse one stream; the human-readable message always goes to stderr.
 *
 * @param {boolean} json - The CLI's --json flag.
 * @returns {(exitCode: number, code: string, message: string, extra?: object) => never}
 */
export function makeCliFailWith(json) {
  return function failWith(exitCode, code, message, extra = {}) {
    if (json) {
      console.log(JSON.stringify({ error: message, code, ...extra }));
    }
    console.error(`❌ ${message}`);
    process.exit(exitCode);
  };
}

/**
 * Build a failUsage(message) bound to raw argv and a USAGE string, shared by
 * every canonical tracker-writer CLI so the usage-error contract can't drift
 * between them. The copies differ only in defaultMessage.
 *
 * Print usage (plus an optional specific complaint) and exit CLI_EXIT.USAGE.
 *
 * With --json a structured usage-error payload goes to stdout (same shape as
 * failWith) so machine callers always parse one stream. failUsage can fire
 * mid-argv-parse — before flags.json is settled — so JSON mode is detected
 * from the raw argv directly. JSON must be the last thing written to stdout;
 * machine callers parse stdout as one JSON document. The human-readable
 * `❌` line always goes to stderr.
 *
 * Without --json, a specific complaint is printed to stderr only when a
 * message was given, then the USAGE text.
 *
 * @param {{argv: string[], usage: string, defaultMessage: string}} options
 * @returns {(message?: string|null) => never}
 */
export function makeCliFailUsage({ argv, usage, defaultMessage }) {
  return function failUsage(message) {
    const msg = message ?? defaultMessage;
    if (argv.includes('--json')) {
      // JSON must be the last thing written to stdout; machine callers parse stdout as one JSON document.
      console.log(JSON.stringify({ error: msg, code: 'usage' }));
      console.error(`❌ ${msg}`);
    } else {
      if (message) console.error(`❌ ${message}\n`);
      console.error(usage);
    }
    process.exit(CLI_EXIT.USAGE);
  };
}

/**
 * Acquire the shared tracker lock for a locked read-modify-write CLI,
 * routing any failure through the caller's failWith so every canonical
 * writer surfaces lock errors identically (LOCK_TIMEOUT → CLI_EXIT.LOCK_TIMEOUT,
 * anything else → CLI_EXIT.USAGE as a non-retryable config/filesystem error).
 *
 * Dry-run never writes, so it must not hold the exclusive lock: a read-only
 * preview should not block (or be blocked by) another writer — returns null
 * in that case. Registers the `process.exit` release safety net these CLIs
 * rely on (failWith/failUsage/row-resolution all exit directly and skip an
 * explicit release — release() is idempotent, so both firing is fine).
 *
 * @param {string} appsFile - Canonical tracker path (resolveTrackerPath()).
 * @param {{dryRun: boolean, failWith: (exitCode: number, code: string, message: string, extra?: object) => never}} options
 * @returns {Promise<{release: Function}|null>}
 */
export async function acquireTrackerLockForCli(appsFile, { dryRun, failWith }) {
  if (dryRun) return null;
  let lock;
  try {
    lock = await acquireTrackerLock(trackerLockDirFor(appsFile), {
      timeoutMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS) || 60_000,
      retryMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_RETRY_MS) || 75,
      staleMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_STALE_MS) || 10 * 60_000,
      tracker: appsFile,
    });
  } catch (err) {
    // Exit 4 means "lock is busy — retry later" and must stay reserved for
    // the actual timeout. Filesystem/configuration failures (EACCES on the
    // lock dir, unwritable owner.json, …) are not retryable and fail as a
    // config error instead.
    if (err?.code === 'LOCK_TIMEOUT') {
      failWith(CLI_EXIT.LOCK_TIMEOUT, 'lock-timeout', err.message);
    } else {
      failWith(CLI_EXIT.USAGE, 'lock-error', `Cannot acquire tracker lock: ${err.message}`);
    }
    // failWith is documented (and, today, always) to exit the process — but
    // this function is now shared, so don't let a future non-exiting failWith
    // silently fall through to releasing/returning an undefined lock; fail
    // loudly instead.
    throw err;
  }
  process.once('exit', () => lock.release());
  return lock;
}
