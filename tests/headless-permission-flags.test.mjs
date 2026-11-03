// tests/headless-permission-flags.test.mjs — no spawner outside the known set
// may hand a headless worker blanket approval (#2876).
//
// The web already has this guard (web/tests/lib/clis-permissions.test.mjs),
// but it reads only web/src/lib/clis.ts. The root spawners are invisible to
// it: batch-tailor.mjs launches the `pdf` worker with
// --dangerously-skip-permissions, which hands back the Bash that #2172 took
// away on the web path, and nothing went red. So the rule written in AGENTS.md
// ("Headless worker permissions") is enforced here, in the root suite.
//
// Discovery, not a list of files to scan: the whole tree is walked and every
// code file whose argv carries one of the flags is collected. The result must
// equal KNOWN below, in both directions — a new spawner fails, and so does an
// entry that no longer passes a flag, so the list cannot rot into a blanket
// allowance after the debt is paid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { ROOT } from './helpers.mjs';
import { walkTree } from '../lib/walk-tree.mjs';

/** Flags that hand a CLI blanket approval for write-capable tools. The web
 *  guard's list plus the Codex forms cli-fencing.mjs refuses. */
const AUTO_APPROVE = [
  '--dangerously-skip-permissions',
  '--dangerously-bypass-approvals-and-sandbox',
  '--always-approve',
  '--yolo',
  '--full-auto',
  '--auto-approve',
  '--approve-all',
  '--skip-permissions',
  '--no-confirm',
];

/** Every file allowed to name a flag above, how many times it may name each
 *  flag, and why. Pinned per flag and per count, not per file: a second grant
 *  added to an allowed file must fail too. Changing a line here is a
 *  permission change: it needs the same review as the spawner itself. */
const KNOWN = new Map([
  // pdf worker under claude -p — the gap #2876 tracks; the fix is the harness rendering the PDF, not a flag.
  ['batch-tailor.mjs', { '--dangerously-skip-permissions': 1 }],
  // evaluate worker under claude -p and grok -p — tracked in #2876.
  ['batch/batch-runner.sh', { '--dangerously-skip-permissions': 1, '--always-approve': 1 }],
  // Not a spawner: names the Codex flags in order to refuse them.
  ['web/src/lib/cli-fencing.mjs', { '--dangerously-bypass-approvals-and-sandbox': 1, '--yolo': 1, '--full-auto': 1 }],
]);

const CODE_EXT = new Set(['.mjs', '.js', '.cjs', '.ts', '.tsx', '.sh', '.bash', '.py', '.go']);
// Never code that ships, or code whose job is to mention the flags.
// plugins.local/ is the user's own gitignored plugin directory, not this repo's code.
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'tests', 'test-fixtures', 'output', 'reports', 'data', 'jds', 'plugins.local']);

/** An extensionless file counts when it starts with a shebang (`cops` today),
 *  so a new extensionless entry point is discovered rather than listed. */
function hasShebang(path) {
  // Two bytes, not the whole file: an extensionless binary is never read in full.
  const head = Buffer.alloc(2);
  let fd;
  try {
    fd = openSync(path, 'r');
    return readSync(fd, head, 0, 2, 0) === 2 && head.toString('latin1') === '#!';
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function isScannedFile(entry, dir) {
  // Regular files only: opening a FIFO or socket would block the walk.
  if (!entry.isFile() || /\.test\.[cm]?[jt]sx?$/.test(entry.name)) return false;
  const ext = extname(entry.name);
  return ext ? CODE_EXT.has(ext) : hasShebang(join(dir, entry.name));
}

// walkTree, not a hand-rolled readdir loop: it applies the nested-checkout
// guard, so a linked worktree inside this one cannot feed its spawners in.
function codeFiles() {
  return walkTree(ROOT, {
    skip: (entry, dir) => (entry.isDirectory() ? SKIP_DIRS.has(entry.name) : !isScannedFile(entry, dir)),
  });
}

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#)/;
const FLAG_RES = AUTO_APPROVE.map((flag) => [flag, new RegExp(`(?<![\\w-])${flag}(?![\\w-])`, 'g')]);

/** How many times code (not comments) names each flag — every occurrence, so
 *  a second grant on the same line counts too. A comment that names a flag
 *  to warn against it — clis.ts, salary-gap.mjs — is not a grant. */
function flagsIn(text) {
  const found = {};
  for (const line of text.split('\n')) {
    if (COMMENT_LINE.test(line)) continue;
    for (const [flag, re] of FLAG_RES) {
      const n = line.match(re)?.length ?? 0;
      if (n) found[flag] = (found[flag] ?? 0) + n;
    }
  }
  return found;
}

function discover() {
  const hits = new Map();
  for (const file of codeFiles()) {
    const flags = flagsIn(readFileSync(file, 'utf8'));
    if (Object.keys(flags).length) hits.set(relative(ROOT, file).split(sep).join('/'), flags);
  }
  return hits;
}

const hits = discover();

test('the scan sees the spawners it is meant to see', () => {
  // Without this, a walk that silently skipped batch/ (or a regex that stopped
  // matching) would pass by finding nothing at all.
  assert.ok(hits.has('batch-tailor.mjs'),
    `batch-tailor.mjs not discovered — found: ${[...hits.keys()].join(', ') || '(none)'}`);
});

test('no file outside KNOWN passes a blanket auto-approve flag', () => {
  const unexpected = [...hits].filter(([file]) => !KNOWN.has(file))
    .map(([file, flags]) => `${file} (${Object.keys(flags).join(', ')})`);
  assert.deepEqual(unexpected, [],
    `new blanket-approval grant(s): ${unexpected.join('; ')}. A headless worker may not get more write power than the web grants it — see "Headless worker permissions" in AGENTS.md. If a CLI cannot express the web's deny list, withhold the writing workers from it instead.`);
});

test('a KNOWN file carries exactly its pinned grants, no more and no others', () => {
  const drift = [...hits].filter(([file]) => KNOWN.has(file))
    .filter(([file, flags]) => JSON.stringify(sortKeys(flags)) !== JSON.stringify(sortKeys(KNOWN.get(file))))
    .map(([file, flags]) => `${file}: found ${JSON.stringify(sortKeys(flags))}, pinned ${JSON.stringify(sortKeys(KNOWN.get(file)))}`);
  assert.deepEqual(drift, [],
    `a known file's grants changed — ${drift.join('; ')}. An added grant needs the same review as a new spawner; a removed one means the pinned count should drop with it.`);
});

test('every KNOWN entry still passes a flag (the list cannot outlive the debt)', () => {
  // web/ is its own release-please component and can be absent on an
  // upgraded install (#3269); its entry is then not stale, just not here.
  const stale = [...KNOWN.keys()].filter((file) => !hits.has(file)
    && !(file.startsWith('web/') && !existsSync(join(ROOT, 'web'))));
  assert.deepEqual(stale, [],
    `KNOWN lists ${stale.join(', ')} but no flag was found there — remove the entry so the allowance does not outlive the fix`);
});

test('the guard actually fires (mutation check)', () => {
  const spawner = "spawnSync('claude', ['-p', '--always-approve', prompt]);";
  assert.deepEqual(flagsIn(spawner), { '--always-approve': 1 });
  // A second grant in the same text is counted, so it cannot hide behind the first.
  assert.deepEqual(flagsIn(`${spawner}\n${spawner}`), { '--always-approve': 2 });
  // ...including one on the same line as the first.
  assert.deepEqual(flagsIn(`${spawner} ${spawner}`), { '--always-approve': 2 });
  // ...and a comment naming the flag, or a longer flag sharing its prefix, does not.
  assert.deepEqual(flagsIn('// never pass --yolo here'), {});
  assert.deepEqual(flagsIn("args.push('--yolo-mode-docs')"), {});
});

function sortKeys(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}
