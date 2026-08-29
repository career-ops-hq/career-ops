/**
 * updater-status-paths.test.mjs — `git status --porcelain` paths must survive
 * parsing byte-for-byte.
 *
 * gitStatusEntries() feeds the updater's "did we touch a user file?" safety
 * check: the Set of paths that were dirty BEFORE the update, the list of paths
 * the update `changed`, and the commit-failure guard all compare against the
 * parsed `path` field. A mistyped path is a blind spot — a user file whose
 * path is mangled no longer matches its real counterpart, so a violation can
 * slip past the abort.
 *
 * Historical corruption vectors, all now closed by parsing `--porcelain -z`
 * (NUL-delimited) instead of the newline form:
 *   - `gitIn()`'s `.trim()`: worktree/index lines begin with a space (` M path`),
 *     and trimming the whole buffer stripped the first line's leading space, so
 *     `path: line.slice(3)` dropped the path's first character.
 *   - Windows CRLF line endings gave every path a trailing `\r`; `-z` suppresses
 *     line-ending translation, so there is nothing to strip.
 *   - C-quoting: the newline form wraps any path with a space, a quote, or a
 *     non-ASCII byte (under git's default core.quotepath) in `"…"` with octal
 *     escapes; the safety check then compared a quoted string to a real file.
 *   - renames: the newline form writes `R  old -> new` on ONE line, so the
 *     "path" was the blob `old -> new`; `-z` writes destination and origin as
 *     two NUL fields, and parsePorcelainStatus surfaces both as their own entry.
 *
 * A mistyped path is a blind spot — gitStatusEntries() feeds the "did we touch
 * a user file?" safety check (the pre-update dirty Set, the `changed` list, the
 * commit-failure guard), all of which compare against the parsed `path`. These
 * tests drive gitStatusEntries() against throwaway repos through the same seam
 * production uses (gitRawIn under a root), plus a few synthetic `-z` buffers
 * straight through parsePorcelainStatus() for the shapes a local git may not
 * emit on demand.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import { gitIn, gitStatusEntries, parsePorcelainStatus } from '../update-system.mjs';

// quotepath: false in most repos here only to keep assertion strings readable —
// with `-z` the parser never sees a quoted path regardless of the setting. The
// non-ASCII test below deliberately leaves it at git's dangerous default (true).
function makeRepo({ quotepath = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'co-status-paths-'));
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'core.quotepath', String(quotepath));
  return { dir, g };
}

// Every parsed entry must name a real file exactly, with the two status
// characters that git actually emitted.
function assertRoundTrip(label, dir, expected) {
  const entries = gitStatusEntries(dir);
  const got = JSON.stringify(entries);
  const want = JSON.stringify(expected);
  if (got === want) {
    pass(label);
  } else {
    fail(`${label} — parsed ${got}, expected ${want}`);
  }
}

console.log('\n🧪 Testing updater git-status path parsing...');

// ── 1. FIRST LINE is a worktree modification (the corruption trigger ──────
// The bug only fires on the FIRST status line: gitIn trims the whole buffer,
// so only that line loses its leading space. Regress exactly that shape.
{
  const { dir, g } = makeRepo();
  try {
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'data', 'user-file.md'), 'v1\n');
    writeFileSync(join(dir, 'scan.mjs'), 'x\n');
    g('add', '-A');
    g('commit', '-qm', 'base');
    // Dirty a tracked file WITHOUT staging: its porcelain line is ` M …`
    // (leading space), and it sorts to the top of the status output.
    writeFileSync(join(dir, 'data', 'user-file.md'), 'v2\n');

    assertRoundTrip(
      'first-line worktree mod keeps ` M` code and full path (no dropped first char)',
      dir,
      [{ code: ' M', path: 'data/user-file.md' }],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 2. First line is a staged modification (`M ` code shape) ──────────────
{
  const { dir, g } = makeRepo();
  try {
    writeFileSync(join(dir, 'tracker.mjs'), 'x\n');
    g('add', 'tracker.mjs');
    g('commit', '-qm', 'base');
    writeFileSync(join(dir, 'tracker.mjs'), 'y\n');
    g('add', 'tracker.mjs');

    assertRoundTrip(
      'staged-first-line entry keeps `M ` code and full path',
      dir,
      [{ code: 'M ', path: 'tracker.mjs' }],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 3. Hidden (leading-dot) directory as the first line ───────────────────
// Mirrors the real incident: `.antigravitycli/skills/…/SKILL.md` parsed as
// `antigravitycli/…` (the leading dot dropped) when it sat first.
{
  const { dir, g } = makeRepo();
  try {
    mkdirSync(join(dir, '.config'));
    writeFileSync(join(dir, '.config', 'tool.mjs'), 'x\n');
    g('add', '-A');
    g('commit', '-qm', 'base');
    writeFileSync(join(dir, '.config', 'tool.mjs'), 'y\n');

    assertRoundTrip(
      'hidden-dir path on the first line keeps its leading dot',
      dir,
      [{ code: ' M', path: '.config/tool.mjs' }],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 4. Mixed statuses ────────────────────────────────────────────────────
// Order-insensitive: git's porcelain ordering is by path (untracked entries
// can sort before tracked changes), so assert the entry SET, not a sequence.
// Paths with a space are covered on their own in case 8; plain names here.
{
  const { dir, g } = makeRepo();
  try {
    mkdirSync(join(dir, 'data'));
    mkdirSync(join(dir, 'modes'));
    writeFileSync(join(dir, 'data', 'notes.md'), 'v1\n');
    writeFileSync(join(dir, 'modes', 'scan.md'), 'v1\n');
    g('add', '-A');
    g('commit', '-qm', 'base');
    writeFileSync(join(dir, 'data', 'notes.md'), 'v2\n');
    writeFileSync(join(dir, 'modes', 'scan.md'), 'v2\n');
    g('add', 'modes/scan.md');
    writeFileSync(join(dir, 'brand-new.mjs'), 'z\n');

    const sort = (xs) => xs.slice().sort((a, b) => `${a.code}|${a.path}`.localeCompare(`${b.code}|${b.path}`));
    const got = JSON.stringify(sort(gitStatusEntries(dir)));
    const want = JSON.stringify(sort([
      { code: ' M', path: 'data/notes.md' },
      { code: 'M ', path: 'modes/scan.md' },
      { code: '??', path: 'brand-new.mjs' },
    ]));

    if (got === want) {
      pass('mixed worktree/staged/untracked entries all keep their exact paths');
    } else {
      fail(`mixed entries damaged — parsed ${got}, expected ${want}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 5. Clean tree parses to nothing ───────────────────────────────────────
{
  const { dir, g } = makeRepo();
  try {
    writeFileSync(join(dir, 'a.mjs'), 'x\n');
    g('add', '-A');
    g('commit', '-qm', 'base');

    assertRoundTrip('clean tree yields no entries', dir, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 6. Synthetic `-z` buffers straight through parsePorcelainStatus ──────
// `git status --porcelain -z` separates entries with NUL and never appends a
// newline or CR, so there is no line-ending disguise left to handle — but the
// parser must still (a) split on NUL not '\n', (b) drop the empty tail after
// the final NUL, and (c) treat a rename/copy as TWO fields: destination first,
// origin second, both surfaced as their own entry.
{
  const cases = [
    {
      label: 'plain NUL-delimited entries, trailing empty field ignored',
      buf: ' M b.mjs\x00?? run-now.mjs\x00',
      want: [
        { code: ' M', path: 'b.mjs' },
        { code: '??', path: 'run-now.mjs' },
      ],
    },
    {
      label: 'a CR inside a `-z` field is a real path byte, not stripped',
      buf: ' M weird\rname.mjs\x00',
      want: [{ code: ' M', path: 'weird\rname.mjs' }],
    },
    {
      label: 'rename entry yields both destination and origin as real paths',
      buf: 'R  modes/new.md\x00modes/old.md\x00',
      want: [
        { code: 'R ', path: 'modes/new.md' },
        { code: 'R ', path: 'modes/old.md' },
      ],
    },
    {
      label: 'copy entry (C) also emits its origin field',
      buf: 'C  data/copy.md\x00data/src.md\x00 M other.mjs\x00',
      want: [
        { code: 'C ', path: 'data/copy.md' },
        { code: 'C ', path: 'data/src.md' },
        { code: ' M', path: 'other.mjs' },
      ],
    },
  ];
  for (const { label, buf, want } of cases) {
    const got = JSON.stringify(parsePorcelainStatus(buf));
    if (got === JSON.stringify(want)) {
      pass(label);
    } else {
      fail(`${label} — parsed ${got}, expected ${JSON.stringify(want)}`);
    }
  }
}

// And the real seam against an actual repo still round-trips a dirty worktree
// file byte-for-byte.
{
  const { dir, g } = makeRepo();
  try {
    writeFileSync(join(dir, 'b.mjs'), 'x\n');
    g('add', '-A');
    g('commit', '-qm', 'base');
    writeFileSync(join(dir, 'b.mjs'), 'y\n');

    const entries = gitStatusEntries(dir);
    if (entries.length === 1 && entries[0].path === 'b.mjs' && entries[0].code === ' M') {
      pass('real git porcelain entries carry no trailing CR or mangled path');
    } else {
      fail(`parsed paths damaged: ${JSON.stringify(entries)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 7. #3048 guard: a pre-existing dirty USER_PATHS file matches exactly ──
// Reproduces the issue's repro (v1.25.0 → v1.27.0): `interview-prep/story-bank.md`
// is the ONLY dirty file before apply() runs. apply() builds `initialStatusPaths`
// from gitStatusEntries()'s `path` field and `continue`s past anything in that
// Set, so a mistyped path is exactly what turned a legitimate pre-existing edit
// into a false `SAFETY VIOLATION: User file was modified` abort. Assert the
// guard's lookup with the path string the issue names.
{
  const { dir, g } = makeRepo();
  try {
    mkdirSync(join(dir, 'interview-prep'));
    writeFileSync(join(dir, 'interview-prep', 'story-bank.md'), 'STAR+R seed\n');
    g('add', '-A');
    g('commit', '-qm', 'base');
    writeFileSync(join(dir, 'interview-prep', 'story-bank.md'), 'STAR+R seed\n- added story today\n');

    const entries = gitStatusEntries(dir);
    const initialStatusPaths = new Set(entries.map((entry) => entry.path));

    if (
      entries.length === 1 &&
      entries[0].code === ' M' &&
      entries[0].path === 'interview-prep/story-bank.md' &&
      initialStatusPaths.has('interview-prep/story-bank.md')
    ) {
      pass('#3048: dirty user file keeps its full path, so the initialStatusPaths guard matches');
    } else {
      fail(`#3048 guard misses the dirty user file — parsed ${JSON.stringify(entries)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 8. A path containing a space arrives unquoted ────────────────────────
// The newline form prints ` M "data/my notes.md"` (quotes always, regardless
// of core.quotepath). A safety check comparing `"data/my notes.md"` — quotes
// included — to a real file matches nothing, so the modification slips past.
{
  const { dir, g } = makeRepo();
  try {
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'data', 'my notes.md'), 'v1\n');
    g('add', '-A');
    g('commit', '-qm', 'base');
    writeFileSync(join(dir, 'data', 'my notes.md'), 'v2\n');

    assertRoundTrip(
      'spaced path parses with no surrounding quotes',
      dir,
      [{ code: ' M', path: 'data/my notes.md' }],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 9. A non-ASCII path under git's DEFAULT core.quotepath (true) ────────
// This is the dangerous default: the newline form would emit
// ` M "data/caf\303\251.md"` (octal-escaped). `-z` ignores quotepath entirely.
{
  const { dir, g } = makeRepo({ quotepath: true });
  try {
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'data', 'café.md'), 'v1\n');
    g('add', '-A');
    g('commit', '-qm', 'base');
    writeFileSync(join(dir, 'data', 'café.md'), 'v2\n');

    assertRoundTrip(
      'non-ASCII path survives as real UTF-8 under default core.quotepath',
      dir,
      [{ code: ' M', path: 'data/café.md' }],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 10. A real `git mv` rename surfaces BOTH sides as real paths ─────────
// The newline form writes `R  data/old.md -> data/new.md` on one line, so the
// old slice yielded the blob `data/old.md -> data/new.md` as the "path" —
// neither side matched a file, so a renamed user file was invisible to the
// safety check. Assert both paths come back, order-insensitively.
{
  const { dir, g } = makeRepo();
  try {
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'data', 'old.md'), 'v1\n');
    g('add', '-A');
    g('commit', '-qm', 'base');
    g('mv', 'data/old.md', 'data/new.md');

    const paths = new Set(gitStatusEntries(dir).map((e) => e.path));
    if (paths.has('data/old.md') && paths.has('data/new.md') && paths.size === 2) {
      pass('rename entry surfaces both origin and destination as real paths');
    } else {
      fail(`rename paths damaged — got ${JSON.stringify([...paths])}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}