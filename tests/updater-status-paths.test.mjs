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
 * The corruption vector is `gitIn()`'s `.trim()`: `--porcelain` lines for
 * worktree/index changes begin with a space (` M path`), and trimming the WHOLE
 * buffer strips the first line's leading space, turning it into `M path`. The
 * parser's `path: line.slice(3)` then drops the path's first character — for
 * ` M data/user-file.md` the resulting `ata/user-file.md` matches nothing.
 *
 * The parser lives in parsePorcelainStatus() so its second disguise — a
 * Windows git whose CRLF line endings would give every path a trailing `\r` —
 * can be driven with a synthetic CRLF buffer instead of trusting whatever EOL
 * the local git happens to emit.
 *
 * These tests drive gitStatusEntries() against throwaway repos through the
 * same seam the production code uses (gitRawIn under a root), pinning the
 * whitespace-sensitive behaviour on both code shapes (` M` and `M `) and on the
 * first-line position that the old `gitIn`-based implementation corrupted.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import { gitIn, gitStatusEntries, parsePorcelainStatus } from '../update-system.mjs';

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'co-status-paths-'));
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'core.quotepath', 'false');
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
// NOTE: paths containing a space arrive C-quoted (git prints `"my notes.md"`)
// and the parser keeps the quotes — a distinct limitation from the leading-
// space trim bug under test, so space-free names are used here on purpose.
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

// ── 6. Entries carry no trailing CR (Windows line-ending robustness) ──────
// The parser, not git's output, is what must be CRLF-robust: a Windows build
// of git terminates `--porcelain` lines with CRLF (its native EOL), and the
// CR is sliced off right where `path` begins. This has to be proven by feeding
// a CRLF buffer straight through parsePorcelainStatus — on a machine where git
// happens to emit LF the old test passed because git chose LF, not because the
// parser handled CRLF. The direct input makes the assertion real.
{
  const crlf = ' M b.mjs\r\n?? run-now.mjs\r\n';
  const want = [
    { code: ' M', path: 'b.mjs' },
    { code: '??', path: 'run-now.mjs' },
  ];
  const got = JSON.stringify(parsePorcelainStatus(crlf));
  if (got === JSON.stringify(want)) {
    pass('CRLF-terminated porcelain lines parse with no trailing carriage return');
  } else {
    fail(`CRLF porcelain damaged — parsed ${got}, expected ${JSON.stringify(want)}`);
  }
}

// And the real seam against an actual repo (LF here, CRLF on Windows runners)
// still round-trips a dirty worktree file byte-for-byte.
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