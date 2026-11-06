// tests/tracked-path-portability.test.mjs — every tracked path checks out
// byte-identical on Linux, macOS and Windows (#6535).
//
// Four properties of the index, none of which the OS matrix in CI notices on
// its own, because each one only bites a checkout the matrix never makes:
//
//   1. No blob is stored with CRLF. `.gitattributes` normalizes an ordinary
//      `git add` to LF under every `core.autocrlf` setting, yet #5203 still
//      merged tests/upskill-known-skills.test.mjs with CRLF on all 379 lines,
//      and #5301 had to repair it. A CRLF blob shows as modified in every
//      checkout that applies the attributes, `git restore` cannot clear it, and
//      `git switch` refuses to leave the branch without `-f`.
//   2. No two paths differ only by case. macOS and Windows fold case, so one
//      of the two files silently overwrites the other on checkout and the
//      working tree shows a phantom modification nobody made.
//   3. No path component is a name Windows cannot create: a reserved device
//      name (CON, NUL, COM1, ...), a character NTFS rejects, or a trailing dot
//      or space. Git for Windows aborts the checkout on such a path.
//   4. Every tracked `.sh` file is executable. A contributor on Windows cannot
//      see or set the bit without `git update-index --chmod=+x`, and a script
//      committed without it fails with "Permission denied" on Linux and macOS.
//
// Each check is a pure function over git's own listing, so the controls at the
// bottom can prove it fires on a synthetic offender without building a repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * NUL-separated git output, split into entries.
 *
 * @param {string[]} args - Arguments to `git`.
 * @returns {string[]}
 */
function gitList(args) {
  const out = execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

/**
 * Paths whose index blob holds CRLF line endings.
 *
 * Reads `git ls-files --eol` entries (`i/<index> w/<worktree> attr/<attrs>\t<path>`).
 * The `i/` field describes the blob in the index, not the file on disk, so a
 * Windows working tree with CRLF on disk does not trip this: only a committed
 * CRLF blob does. `i/mixed` counts, since it holds at least one CRLF. Binary
 * blobs report `i/-text` and are skipped.
 *
 * @param {string[]} entries - `git ls-files --eol -z` entries.
 * @returns {string[]} Offending paths, each with its index state.
 */
export function crlfBlobs(entries) {
  const offenders = [];
  for (const entry of entries) {
    const tab = entry.indexOf('\t');
    if (tab === -1) continue;
    const index = entry.slice(0, tab).trim().split(/\s+/)[0];
    if (index === 'i/crlf' || index === 'i/mixed') offenders.push(`${entry.slice(tab + 1)} (${index})`);
  }
  return offenders;
}

/**
 * Groups of tracked paths that a case-insensitive filesystem would merge.
 *
 * Directories count as well as files: `Docs/a.md` beside `docs/b.md` puts two
 * spellings of one directory in the index, and which one a checkout creates
 * depends on the order git writes them. Keys are NFC-normalized before folding,
 * because macOS also treats the composed and decomposed forms of an accented
 * name as one file.
 *
 * @param {string[]} paths - Tracked paths, `/`-separated.
 * @returns {string[][]} Each group of colliding spellings, sorted.
 */
export function caseCollisions(paths) {
  const spellings = new Map();
  for (const path of paths) {
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i += 1) {
      const prefix = parts.slice(0, i).join('/');
      const key = prefix.normalize('NFC').toLowerCase();
      if (!spellings.has(key)) spellings.set(key, new Set());
      spellings.get(key).add(prefix);
    }
  }
  return [...spellings.values()].filter((set) => set.size > 1).map((set) => [...set].sort());
}

// Device names Windows reserves in every directory, with or without an
// extension (`nul.txt` is as unusable as `nul`), and with spaces before the
// extension (`nul .txt`). The list is Microsoft's ("Naming Files, Paths, and
// Namespaces"): COM0 and LPT0 and the superscript digits count, since Windows
// treats COM¹ like COM1. CONIN$ and CONOUT$ name the console the same way.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³]) *(\..*)?$/i;
// Characters NTFS rejects in a name, plus the ASCII control range. A backslash
// is an ordinary character to git on Linux and a path separator on Windows.
const WINDOWS_ILLEGAL_CHAR = /[<>:"|?*\\\u0000-\u001f]/;

/**
 * Tracked paths with a component Windows cannot create.
 *
 * @param {string[]} paths - Tracked paths, `/`-separated.
 * @returns {string[]} Offending paths, each with the reason.
 */
export function windowsUnsafePaths(paths) {
  const offenders = [];
  for (const path of paths) {
    for (const part of path.split('/')) {
      let reason = null;
      if (WINDOWS_RESERVED.test(part)) reason = `"${part}" is a reserved device name`;
      else if (WINDOWS_ILLEGAL_CHAR.test(part)) reason = `"${part}" contains a character Windows rejects`;
      else if (/[. ]$/.test(part)) reason = `"${part}" ends in a dot or space`;
      if (reason) {
        offenders.push(`${path}: ${reason}`);
        break;
      }
    }
  }
  return offenders;
}

/**
 * Tracked `.sh` files the index does not record as executable.
 *
 * Reads `git ls-files -s` entries (`<mode> <sha> <stage>\t<path>`). A symlink
 * (120000) is skipped: its target carries the mode that matters.
 *
 * @param {string[]} entries - `git ls-files -s -z` entries.
 * @returns {string[]} Offending paths, each with its recorded mode.
 */
export function nonExecutableShellScripts(entries) {
  const offenders = [];
  for (const entry of entries) {
    const tab = entry.indexOf('\t');
    if (tab === -1) continue;
    const mode = entry.slice(0, tab).split(' ')[0];
    const path = entry.slice(tab + 1);
    if (!path.toLowerCase().endsWith('.sh') || mode === '120000') continue;
    if (mode !== '100755') offenders.push(`${path} (${mode})`);
  }
  return offenders;
}

const eolEntries = gitList(['ls-files', '--eol', '-z']);
const stageEntries = gitList(['ls-files', '-s', '-z']);
// One path per stage entry; a conflicted path is listed once per stage.
const paths = [...new Set(stageEntries.map((e) => e.slice(e.indexOf('\t') + 1)))];

test('git listed the tracked tree', () => {
  // Guard the guard: an empty listing (not a git checkout, wrong cwd, a changed
  // flag) would pass every check below by checking nothing.
  assert.ok(paths.length > 100, `expected to read the tracked tree, got ${paths.length} paths`);
  assert.ok(eolEntries.length > 100, `expected line-ending info for the tracked tree, got ${eolEntries.length} entries`);
});

test('no tracked blob is stored with CRLF line endings', () => {
  const offenders = crlfBlobs(eolEntries);
  assert.deepEqual(
    offenders,
    [],
    `CRLF in the index: ${offenders.join(', ')}\n`
      + 'Renormalize with `git add --renormalize <path>` and commit the result. '
      + '`git ls-files --eol <path>` should then report i/lf.',
  );
});

test('no two tracked paths differ only by case', () => {
  const groups = caseCollisions(paths);
  assert.deepEqual(
    groups,
    [],
    `paths that collide on a case-insensitive filesystem (macOS, Windows): ${groups.map((g) => g.join(' vs ')).join('; ')}\n`
      + 'Rename one of them with `git mv`, so each name has one spelling.',
  );
});

test('every tracked path can be checked out on Windows', () => {
  const offenders = windowsUnsafePaths(paths);
  assert.deepEqual(offenders, [], `Git for Windows cannot check out: ${offenders.join('; ')}`);
});

test('every tracked .sh file is executable', () => {
  const offenders = nonExecutableShellScripts(stageEntries);
  assert.deepEqual(
    offenders,
    [],
    `shell scripts committed without the executable bit: ${offenders.join(', ')}\n`
      + 'Fix with `git update-index --chmod=+x <path>`, which also works on Windows.',
  );
});

// Controls: each check must fire on an offender, or a green run above means nothing.

test('control: crlfBlobs flags CRLF and mixed blobs only', () => {
  assert.deepEqual(
    crlfBlobs([
      'i/lf    w/lf    attr/text eol=lf      \tok.mjs',
      'i/crlf  w/crlf  attr/text eol=lf      \tbad.mjs',
      'i/mixed w/mixed attr/text eol=lf      \tmixed.md',
      'i/-text w/-text attr/-text            \timage.png',
      'i/      w/      attr/text eol=lf      \tlink/SKILL.md',
    ]),
    ['bad.mjs (i/crlf)', 'mixed.md (i/mixed)'],
  );
});

test('control: caseCollisions flags files and directories', () => {
  assert.deepEqual(caseCollisions(['README.md', 'docs/a.md', 'docs/b.md']), []);
  assert.deepEqual(caseCollisions(['README.md', 'readme.md']), [['README.md', 'readme.md']]);
  assert.deepEqual(caseCollisions(['Docs/a.md', 'docs/b.md']), [['Docs', 'docs']]);
  // Composed "é" (U+00E9) against "e" plus a combining acute (U+0301).
  assert.deepEqual(caseCollisions(['caf\u00e9.md', 'cafe\u0301.md']), [['cafe\u0301.md', 'caf\u00e9.md']]);
});

test('control: windowsUnsafePaths flags reserved names, bad characters and trailing dots', () => {
  assert.deepEqual(windowsUnsafePaths(['docs/console.md', 'lib/aux-tools.mjs', 'com10.txt']), []);
  assert.deepEqual(windowsUnsafePaths(['docs/nul', 'Aux.md', 'x/LPT1.txt', 'COM0', 'nul .txt']).length, 5);
  assert.deepEqual(windowsUnsafePaths(['CONIN$', 'conout$.log', 'conin$x.md']).length, 2);
  assert.deepEqual(windowsUnsafePaths(['a:b.md', 'q?.md', 'back\\slash.md', 'tab\there.md']).length, 4);
  assert.deepEqual(windowsUnsafePaths(['trailing./x.md', 'space .md ']).length, 2);
});

test('control: nonExecutableShellScripts flags a 100644 script and skips symlinks', () => {
  assert.deepEqual(
    nonExecutableShellScripts([
      '100755 0123456789abcdef0123456789abcdef01234567 0\tok.sh',
      '100644 0123456789abcdef0123456789abcdef01234567 0\tbad.sh',
      '120000 0123456789abcdef0123456789abcdef01234567 0\tlink.sh',
      '100644 0123456789abcdef0123456789abcdef01234567 0\tnot-a-script.mjs',
    ]),
    ['bad.sh (100644)'],
  );
});
