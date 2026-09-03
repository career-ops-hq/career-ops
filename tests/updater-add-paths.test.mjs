/**
 * updater-add-paths.test.mjs — BEHAVIORAL staging tests for apply()'s commit step.
 *
 * apply() stages its checked-out system paths and commits them. Two ways that
 * `git add` call could fail leave the update half-done — files on disk, nothing
 * committed — and the user is told to finish it by hand:
 *
 *   1. A tracked system file shadowed by a local DIRECTORY-level ignore rule.
 *      `git add` refuses explicitly-named ignored paths (exit 1). .gitignore is
 *      deliberately not in SYSTEM_PATHS, so any user's rule can cause this at
 *      any time; a blanket `writing-samples/` over the tracked
 *      writing-samples/README.md is the shape seen in the wild. A file-level
 *      rule over the same tracked path does NOT trigger it — git only consults
 *      ignore rules for a tracked file when the match is an ignored directory.
 *   2. The .update-dismissed marker. It is gitignored by default and therefore
 *      never in the index, so staging it after deletion is a fatal unmatched
 *      pathspec (exit 128) that -f does NOT rescue. Reproduces in a stock
 *      checkout with no customization: dismiss an update, then apply one.
 *
 * Follows updater-rollback-behavior.test.mjs: drive the real exports against a
 * throwaway repo through the git-runner seam, so the property is verified rather
 * than the source merely pattern-matched.
 */

import { writeFileSync, mkdirSync, rmSync, unlinkSync } from 'fs';
import { join } from 'path';
import { pass, fail, makeUpdaterRepo } from './helpers.mjs';
import { gitIn, addPaths, isTracked, expandToShippedFiles } from '../update-system.mjs';

// Shared with updater-is-tracked.test.mjs so the git-isolation pins live in one
// body: dropping one has to redden both suites, not leave this one quietly
// unprotected. `root` is the second half of the seam here — addPaths resolves
// paths against it to decide what is a directory, and without it the guard
// would lstat the real repository instead of this fixture.
const makeRepo = () => makeUpdaterRepo(gitIn, { prefix: 'co-addpaths-', includeRoot: true });

// -z for the same reason the expansion uses it: under core.quotePath (the
// default) git renders a non-ASCII name as "modes/\346\227\245...", so a
// newline-split assertion silently misses a path that staged perfectly well.
const stagedPaths = g =>
  new Set(g('diff', '--cached', '--name-only', '-z', 'HEAD').split('\0').filter(Boolean));

console.log('\n🧪 Testing updater staging behavior (ignored + never-tracked paths)...');

// ── 1. a tracked system file shadowed by a user ignore rule still stages ──
{
  const { dir, g, ctx } = makeRepo();
  mkdirSync(join(dir, 'writing-samples'));
  writeFileSync(join(dir, 'writing-samples/README.md'), 'shipped by upstream');
  writeFileSync(join(dir, 'AGENTS.md'), 'v1');
  g('add', '-A');
  g('commit', '-qm', 'base');

  // The user hardens their own .gitignore with a blanket rule over a directory
  // that contains a tracked system file.
  writeFileSync(join(dir, '.gitignore'), 'writing-samples/\n');
  g('add', '.gitignore');
  g('commit', '-qm', 'user hardening');

  // An update rewrites both files and stages them together.
  writeFileSync(join(dir, 'writing-samples/README.md'), 'updated by v-next');
  writeFileSync(join(dir, 'AGENTS.md'), 'v2');

  let threw = null;
  try {
    addPaths(['AGENTS.md', 'writing-samples/README.md'], ctx);
  } catch (err) {
    threw = err;
  }

  if (!threw) {
    pass('staging succeeds when an ignore rule shadows a tracked system file');
  } else {
    fail(`staging threw on an ignored-but-tracked system path: ${threw.message.split('\n')[0]}`);
  }

  const staged = stagedPaths(g);
  if (staged.has('writing-samples/README.md') && staged.has('AGENTS.md')) {
    pass('both the shadowed path and its batch-mates reach the index');
  } else {
    fail(`incomplete staging: ${[...staged].join(', ') || '(nothing)'}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 2. only a DIRECTORY-level rule triggers this; a file-level one never did ──
//    Pins the actual boundary, so nobody "simplifies" the fix after seeing that
//    an ignored tracked file sometimes stages fine. git consults ignore rules
//    for a tracked file only when the match comes from an ignored directory.
{
  const { dir, g, ctx } = makeRepo();
  mkdirSync(join(dir, 'dirlevel'));
  mkdirSync(join(dir, 'filelevel'));
  writeFileSync(join(dir, 'dirlevel/F.md'), 'v1');
  writeFileSync(join(dir, 'filelevel/F.md'), 'v1');
  g('add', '-A');
  g('commit', '-qm', 'base');
  writeFileSync(join(dir, '.gitignore'), 'dirlevel/\nfilelevel/F.md\n');
  g('add', '.gitignore');
  g('commit', '-qm', 'ignores');

  writeFileSync(join(dir, 'dirlevel/F.md'), 'v2');
  writeFileSync(join(dir, 'filelevel/F.md'), 'v2');

  // Probe the boundary through a PLAIN add, not addPaths. addPaths always
  // passes -f, under which both cases stage fine — so asserting through it
  // could never detect the boundary moving.
  let fileLevelThrew = null;
  try {
    g('add', '--', 'filelevel/F.md');
  } catch (err) {
    fileLevelThrew = err;
  }
  if (!fileLevelThrew) {
    pass('a file-level ignore rule over a tracked path was never the problem');
  } else {
    fail('file-level ignore rule now blocks a plain add — the boundary moved');
  }

  let plainDirThrew = null;
  try {
    g('add', '--', 'dirlevel/F.md');
  } catch (err) {
    plainDirThrew = err;
  }
  if (plainDirThrew) {
    pass('a directory-level rule blocks a plain add — this is why -f is required');
  } else {
    fail('a plain add no longer fails on a directory-level rule — -f may be unnecessary');
  }

  g('reset', '-q');

  let dirLevelThrew = null;
  try {
    addPaths(['dirlevel/F.md'], ctx);
  } catch (err) {
    dirLevelThrew = err;
  }
  if (!dirLevelThrew && stagedPaths(g).has('dirlevel/F.md')) {
    pass('a directory-level ignore rule over a tracked path stages under -f');
  } else {
    fail(`directory-level rule still blocks staging: ${dirLevelThrew?.message.split('\n')[0] ?? 'not staged'}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 3. isTracked separates "ignored but in the index" from "never tracked" ──
{
  const { dir, g, ctx } = makeRepo();
  writeFileSync(join(dir, 'seed.txt'), 'x');
  g('add', '-A');
  g('commit', '-qm', 'base');
  writeFileSync(join(dir, '.gitignore'), '.update-dismissed\nkept.txt\n');
  g('add', '.gitignore');
  g('commit', '-qm', 'ignores');

  // Ignored AND tracked (force-added at some point) → stageable.
  writeFileSync(join(dir, 'kept.txt'), 'k');
  g('add', '-f', 'kept.txt');
  g('commit', '-qm', 'track an ignored file');

  // Ignored and never tracked — the .update-dismissed shape.
  writeFileSync(join(dir, '.update-dismissed'), new Date(0).toISOString());

  if (isTracked('kept.txt', ctx)) {
    pass('isTracked: true for an ignored-but-tracked path');
  } else {
    fail('isTracked said false for a tracked path — the marker guard would skip real work');
  }
  if (!isTracked('.update-dismissed', ctx)) {
    pass('isTracked: false for an ignored, never-tracked path');
  } else {
    fail('isTracked said true for a never-tracked path — apply() would stage an unmatched pathspec');
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 4. the never-tracked marker is fatal if staged after deletion ──
//    Pins WHY apply() guards with isTracked rather than relying on -f.
{
  const { dir, g, ctx } = makeRepo();
  writeFileSync(join(dir, 'seed.txt'), 'x');
  g('add', '-A');
  g('commit', '-qm', 'base');
  writeFileSync(join(dir, '.gitignore'), '.update-dismissed\n');
  g('add', '.gitignore');
  g('commit', '-qm', 'ignore marker');

  // dismiss() writes it, apply() deletes it — then it is an unmatched pathspec.
  writeFileSync(join(dir, '.update-dismissed'), 'ts');
  unlinkSync(join(dir, '.update-dismissed'));

  // git writes its own diagnostic to stderr here; the "fatal: pathspec" line
  // printed next is the expected failure, not a broken test.
  console.log('     ↓ the following git "fatal: pathspec" line is expected');

  let threw = null;
  try {
    addPaths(['.update-dismissed'], ctx);
  } catch (err) {
    threw = err;
  }
  if (threw) {
    pass('staging a deleted, never-tracked marker still fails (-f is no rescue)');
  } else {
    fail('expected an unmatched-pathspec failure; the isTracked guard would be pointless');
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 5. the marker takes the WHOLE batch down, which is the production shape ──
//    apply() batches the marker together with the real system paths. A fatal
//    pathspec is rejected before git stages anything, so unlike cause 1 (which
//    exits non-zero having staged what it could) this leaves an empty index —
//    the update is neither committed nor staged.
{
  const { dir, g, ctx } = makeRepo();
  writeFileSync(join(dir, 'AGENTS.md'), 'v1');
  g('add', '-A');
  g('commit', '-qm', 'base');
  writeFileSync(join(dir, '.gitignore'), '.update-dismissed\n');
  g('add', '.gitignore');
  g('commit', '-qm', 'ignore marker');

  writeFileSync(join(dir, 'AGENTS.md'), 'v2');              // a real system update
  writeFileSync(join(dir, '.update-dismissed'), 'ts');
  unlinkSync(join(dir, '.update-dismissed'));               // apply() deletes it

  console.log('     ↓ the following git "fatal: pathspec" line is expected');
  try {
    addPaths(['AGENTS.md', '.update-dismissed'], ctx);
  } catch {
    /* expected — asserting on the index below, not the throw */
  }
  if (stagedPaths(g).size === 0) {
    pass('an unmatched pathspec strands the entire batch, not just the marker');
  } else {
    fail(`expected an empty index; got: ${[...stagedPaths(g)].join(', ')}`);
  }

  // And with the guard applied (marker filtered out), the same batch stages.
  // Guarded like every other call here: an unguarded throw would abort the file
  // before fail() reports and before the cleanup below runs.
  let recoveryThrew = null;
  try {
    addPaths(['AGENTS.md'], ctx);
  } catch (err) {
    recoveryThrew = err;
  }
  if (!recoveryThrew && stagedPaths(g).has('AGENTS.md')) {
    pass('the same batch stages once the untracked marker is filtered out');
  } else {
    fail(`filtering the marker did not restore staging: ${recoveryThrew?.message.split('\n')[0] ?? 'not staged'}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 6. -f over a DIRECTORY pathspec commits the user's ignored files ──
//    The reason the staging list is expanded to filenames before it is forced.
//    53 of the 283 manifest entries are directories, so this is the production
//    shape, not a contrived one: `dashboard/` ships a compiled binary that
//    apply() rebuilds immediately before staging, and an unanchored rule like
//    `.DS_Store` or `*.env` matches at any depth under all 53.
{
  const { dir, g, ctx } = makeRepo();
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs/README.md'), 'shipped by upstream');
  writeFileSync(join(dir, '.gitignore'), 'career-dashboard\n*.env\n');
  g('add', '-A');
  g('commit', '-qm', 'base');

  // What a user's checkout looks like: ignored, never tracked, none of it ours.
  writeFileSync(join(dir, 'docs/career-dashboard'), 'compiled binary');
  writeFileSync(join(dir, 'docs/prod.env'), 'SECRET=hunter2');
  writeFileSync(join(dir, 'docs/README.md'), 'updated by v-next');

  // Oracle: the unexpanded force-add is what sweeps them in. Probed through the
  // RAW runner, not addPaths — addPaths now refuses a directory outright, and
  // asserting through it would only re-test that refusal. This pins git's
  // behaviour, which is the thing the expansion exists to work around; if it
  // ever stops being true the expansion is dead weight.
  g('add', '-f', '--', 'docs/');
  const swept = stagedPaths(g);
  if (swept.has('docs/prod.env') && swept.has('docs/career-dashboard')) {
    pass('-f over a directory pathspec does stage ignored files (oracle holds)');
  } else {
    fail(`oracle broken — a bare -f no longer sweeps: ${[...swept].join(', ') || '(nothing)'}`);
  }

  g('reset', '-q');

  // And the fix: same input, resolved through the target tree first.
  const expanded = expandToShippedFiles(['docs/'], 'HEAD', ctx);
  let fixedThrew = null;
  try {
    addPaths(expanded, ctx);
  } catch (err) {
    fixedThrew = err;
  }
  const staged = stagedPaths(g);
  if (!fixedThrew && staged.has('docs/README.md') && !staged.has('docs/prod.env') && !staged.has('docs/career-dashboard')) {
    pass('expanding to shipped files stages the update and leaves ignored files alone');
  } else {
    fail(`expansion did not contain the sweep: ${[...staged].join(', ') || '(nothing)'}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 6b. a scoped apply commit uses the target tree's file list ──────────
//     A directory can still contain a tracked file that the target retired.
//     Staging the expanded target list leaves that file alone; committing the
//     original directory pathspec would read its local edit from the worktree.
{
  const { dir, g, ctx } = makeRepo();
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs/README.md'), 'v1');
  writeFileSync(join(dir, 'docs/RETIRED.md'), 'v1');
  g('add', '-A');
  g('commit', '-qm', 'base');
  g('branch', 'target');

  g('checkout', '-q', 'target');
  writeFileSync(join(dir, 'docs/README.md'), 'v2');
  g('rm', '-q', '--', 'docs/RETIRED.md');
  g('add', '--', 'docs/README.md');
  g('commit', '-qm', 'target update');

  g('checkout', '-q', 'main');
  writeFileSync(join(dir, 'docs/README.md'), 'v2');
  writeFileSync(join(dir, 'docs/RETIRED.md'), 'the user\'s local edit');

  const expanded = expandToShippedFiles(['docs/'], 'target', ctx);
  g('add', '--', ...expanded);
  g('commit', '-qm', 'scoped apply', '--', ...expanded);

  const committed = g('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);
  const status = g('status', '--porcelain');
  if (expanded.includes('docs/README.md') && !expanded.includes('docs/RETIRED.md')) {
    pass('apply expansion follows the target tree and omits a retired tracked file');
  } else {
    fail(`apply expansion kept the retired file: ${expanded.join(', ')}`);
  }
  if (committed.includes('docs/README.md') && !committed.includes('docs/RETIRED.md')
      && status.includes('docs/RETIRED.md')) {
    pass('scoped apply commit leaves the retired tracked edit unstaged');
  } else {
    fail(`scoped apply commit touched the wrong paths: committed=${committed.join(', ')} status=${status}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 6c. preserved exclusions survive scoped commit expansion ────────────
//     The positive directory entry expands to every shipped file, while the
//     `:(exclude)` pathspec must remain so a preserved local file stays out.
{
  const { dir, g, ctx } = makeRepo();
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs/README.md'), 'v1');
  writeFileSync(join(dir, 'docs/KEEP.md'), 'v1');
  g('add', '-A');
  g('commit', '-qm', 'base');

  writeFileSync(join(dir, 'docs/README.md'), 'updated');
  writeFileSync(join(dir, 'docs/KEEP.md'), 'the preserved local edit');
  const paths = ['docs/', ':(exclude)docs/KEEP.md'];
  const expanded = expandToShippedFiles(paths, 'HEAD', ctx);
  g('add', '--', 'docs/README.md');
  g('commit', '-qm', 'scoped apply with preservation', '--', ...expanded);

  const committed = g('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);
  const status = g('status', '--porcelain');
  if (expanded.includes('docs/README.md') && expanded.includes('docs/KEEP.md')
      && expanded.includes(':(exclude)docs/KEEP.md')) {
    pass('scoped commit expansion keeps both shipped files and the preserve exclusion');
  } else {
    fail(`preserve exclusion was lost during expansion: ${expanded.join(', ')}`);
  }
  if (committed.includes('docs/README.md') && !committed.includes('docs/KEEP.md')
      && status.includes('docs/KEEP.md')) {
    pass('scoped commit honors the preserve exclusion');
  } else {
    fail(`preserve exclusion failed: committed=${committed.join(', ')} status=${status}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 7. the expansion returns files only, and passes non-directories through ──
//    Pruned deletions and materialized entrypoints arrive as plain filenames and
//    must survive untouched — a deletion is absent from the target tree, so
//    anything that tried to resolve it against FETCH_HEAD would drop it.
{
  const { dir, g, ctx } = makeRepo();
  mkdirSync(join(dir, 'modes'));
  writeFileSync(join(dir, 'modes/a.md'), 'a');
  writeFileSync(join(dir, 'modes/b.md'), 'b');
  writeFileSync(join(dir, 'AGENTS.md'), 'x');
  g('add', '-A');
  g('commit', '-qm', 'base');

  const out = expandToShippedFiles(['modes/', 'AGENTS.md', 'tests/pruned-away.mjs'], 'HEAD', ctx);

  if (!out.some(p => p.endsWith('/'))) {
    pass('expansion never yields a directory pathspec');
  } else {
    fail(`expansion returned a directory: ${out.filter(p => p.endsWith('/')).join(', ')}`);
  }
  if (out.includes('modes/a.md') && out.includes('modes/b.md')) {
    pass('a directory entry resolves to the files the target tree ships');
  } else {
    fail(`directory did not expand: ${out.join(', ')}`);
  }
  if (out.includes('AGENTS.md') && out.includes('tests/pruned-away.mjs')) {
    pass('file entries pass through, including one absent from the tree (a prune)');
  } else {
    fail(`file entries were dropped: ${out.join(', ')}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 8. a manifest directory absent upstream is skipped, not fatal ──
//    Stale manifest entries are expected (#1998); the checkout above already
//    skips them, and the expansion must agree rather than abort the update.
//    The mechanism matters now that the expansion has no catch: `ls-tree --
//    absent/` exits 0 with EMPTY OUTPUT rather than failing, which is what
//    makes an uncaught call safe here. If that ever changes, this goes red
//    instead of the failure being silently absorbed.
{
  const { dir, g, ctx } = makeRepo();
  writeFileSync(join(dir, 'AGENTS.md'), 'x');
  g('add', '-A');
  g('commit', '-qm', 'base');

  let threw = null;
  let out = null;
  try {
    out = expandToShippedFiles(['.gemini/commands/', 'AGENTS.md'], 'HEAD', ctx);
  } catch (err) {
    threw = err;
  }
  if (!threw && out.length === 1 && out[0] === 'AGENTS.md') {
    pass('a directory absent from the target tree is skipped silently');
  } else {
    fail(`stale manifest entry was not skipped: ${threw?.message.split('\n')[0] ?? out?.join(', ')}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 9. non-ASCII paths survive the expansion ──
//    ls-tree quotes them per core.quotePath, and a quoted name is not a usable
//    pathspec — the staging call would fail on a repo that ships modes/ja/ and
//    modes/ar/. -z is what keeps the names raw.
{
  const { dir, g, ctx } = makeRepo();
  g('config', 'core.quotePath', 'true');
  mkdirSync(join(dir, 'modes'));
  writeFileSync(join(dir, 'modes/日本語.md'), 'ja');
  g('add', '-A');
  g('commit', '-qm', 'base');

  const out = expandToShippedFiles(['modes/'], 'HEAD', ctx);
  if (out.includes('modes/日本語.md')) {
    pass('a non-ASCII path expands to a raw, usable pathspec');
  } else {
    fail(`path came back quoted or mangled: ${JSON.stringify(out)}`);
  }

  writeFileSync(join(dir, 'modes/日本語.md'), 'ja v2');
  let threw = null;
  try {
    addPaths(out, ctx);
  } catch (err) {
    threw = err;
  }
  if (!threw && stagedPaths(g).has('modes/日本語.md')) {
    pass('and it stages');
  } else {
    fail(`staging a non-ASCII path failed: ${threw?.message.split('\n')[0] ?? 'not staged'}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 10. the add is batched, because expanding multiplies the pathspec count ──
//    283 manifest entries expand to 817 files (~22 KB of argv) against a 32,767
//    character Windows command line. One call would sit at two-thirds of the
//    ceiling on day one and grow every release.
{
  const { dir, g } = makeRepo();
  mkdirSync(join(dir, 'bulk'));
  const names = [];
  for (let i = 0; i < 200; i++) {
    const name = `bulk/${String(i).padStart(3, '0')}-a-deliberately-long-fixture-filename.md`;
    writeFileSync(join(dir, name), 'v1');
    names.push(name);
  }
  g('add', '-A');
  g('commit', '-qm', 'base');
  for (const name of names) writeFileSync(join(dir, name), 'v2');

  const argvChars = names.join(' ').length;
  let addCalls = 0;
  // Find the subcommand rather than assuming argv[0] — the call carries leading
  // top-level flags (--literal-pathspecs), so a positional check silently
  // counts zero and the batching assertion passes for the wrong reason.
  const subcommand = args => args.find(a => !a.startsWith('-'));
  const counting = (...args) => { if (subcommand(args) === 'add') addCalls++; return g(...args); };

  let threw = null;
  try {
    addPaths(names, { git: counting });
  } catch (err) {
    threw = err;
  }

  if (argvChars > 8000 && addCalls > 1) {
    pass(`a ${argvChars}-char pathspec list is split across ${addCalls} add calls`);
  } else {
    fail(`expected batching for ${argvChars} chars; got ${addCalls} call(s)`);
  }
  const staged = stagedPaths(g);
  if (!threw && names.every(n => staged.has(n))) {
    pass('every path still reaches the index across the batches');
  } else {
    fail(`batching lost paths: staged ${staged.size} of ${names.length}${threw ? ` — ${threw.message.split('\n')[0]}` : ''}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 11. a shipped filename is a NAME, not a pattern ──
//    `--` ends option parsing but does not stop pathspec interpretation, so a
//    tracked file called `docs/[x].md` read as a glob matches an ignored
//    sibling `docs/x.md` and -f stages it. Expanding to filenames does not
//    close the sweep on its own — the names have to be taken literally too.
{
  const { dir, g, ctx } = makeRepo();
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs/[x].md'), 'shipped upstream');
  writeFileSync(join(dir, '.gitignore'), 'x.md\n');
  g('add', '-A');
  g('commit', '-qm', 'base');

  writeFileSync(join(dir, 'docs/x.md'), 'the user\'s ignored file');
  writeFileSync(join(dir, 'docs/[x].md'), 'updated by v-next');

  // Oracle: without literal pathspecs the bracket name captures the sibling.
  g('add', '-f', '--', 'docs/[x].md');
  if (stagedPaths(g).has('docs/x.md')) {
    pass('a bracket filename does glob onto an ignored sibling (oracle holds)');
  } else {
    fail('oracle broken — git no longer globs an explicit pathspec');
  }
  g('reset', '-q');

  const expanded = expandToShippedFiles(['docs/'], 'HEAD', ctx);
  let threw = null;
  try {
    addPaths(expanded, ctx);
  } catch (err) {
    threw = err;
  }
  const staged = stagedPaths(g);
  if (!threw && staged.has('docs/[x].md') && !staged.has('docs/x.md')) {
    pass('literal pathspecs keep a bracket filename from capturing its sibling');
  } else {
    fail(`sibling still swept: ${[...staged].join(', ') || '(nothing)'}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 12. rollback stages through the same expansion, against the BACKUP tree ──
//    rollback() builds `restored` straight off SYSTEM_PATHS, so it carries the
//    same 53 directory entries apply() does. Before this PR that was harmless
//    (addPaths did a plain add, which skips ignored paths); making -f
//    unconditional armed the sweep at BOTH call sites, and expanding only
//    apply()'s would have left rollback committing a user's ignored files while
//    claiming to restore them. The ref matters too: rollback restores what the
//    BACKUP shipped, which is not what HEAD ships.
{
  const { dir, g, ctx } = makeRepo();
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs/README.md'), 'backup state');
  writeFileSync(join(dir, 'docs/RETIRED.md'), 'shipped in the backup, deleted since');
  writeFileSync(join(dir, '.gitignore'), 'career-dashboard\n*.env\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  g('branch', 'backup-pre-update-1.0.0');

  // Time passes: upstream retires a file, and the user accumulates their own.
  g('rm', '-q', '--', 'docs/RETIRED.md');
  g('commit', '-qm', 'upstream retires a doc');
  writeFileSync(join(dir, 'docs/career-dashboard'), 'compiled binary');
  writeFileSync(join(dir, 'docs/prod.env'), 'SECRET=hunter2');

  const restored = ['docs/'];   // exactly what rollback() pushes

  // The guarantee is structural: rollback cannot reach the sweep even if its
  // expansion is removed, because addPaths refuses a directory outright. That
  // matters here specifically — rollback() is not exported and no harness
  // drives it, so this refusal is what closes the call site rather than a
  // test of rollback itself.
  let refused = null;
  try {
    addPaths(restored, ctx);
  } catch (err) {
    refused = err;
  }
  // Both halves are required. Throwing is not the guarantee — NOT STAGING is.
  // An implementation that swept the directory in and then threw would satisfy
  // the error check alone, and the sweep is the thing being prevented.
  const afterRefusal = stagedPaths(g);
  if (refused && refused.message.includes('docs/') && afterRefusal.size === 0) {
    pass('addPaths refuses rollback\'s unexpanded list without staging anything');
  } else if (refused && afterRefusal.size > 0) {
    fail(`addPaths threw but staged first: ${[...afterRefusal].join(', ')}`);
  } else {
    fail(`addPaths accepted a directory pathspec: ${[...afterRefusal].join(', ') || '(nothing staged)'}`);
  }
  g('reset', '-q');

  const expanded = expandToShippedFiles(restored, 'backup-pre-update-1.0.0', ctx);
  if (expanded.includes('docs/RETIRED.md')) {
    pass('rollback expands against the backup tree, so a retired file is restorable');
  } else {
    fail(`expanded against the wrong ref — RETIRED.md missing: ${expanded.join(', ')}`);
  }

  // rollback() checks the backup out before it stages, which is what puts a
  // retired file back on disk. Staging without that step would fail on an
  // unmatched pathspec, so the order is part of the property under test.
  g('checkout', 'backup-pre-update-1.0.0', '--', 'docs/');

  let threw = null;
  try {
    addPaths(expanded, ctx);
  } catch (err) {
    threw = err;
  }
  const staged = stagedPaths(g);
  if (!threw && staged.has('docs/RETIRED.md')
      && !staged.has('docs/prod.env') && !staged.has('docs/career-dashboard')) {
    pass('rollback restores the backup and stages no ignored user file');
  } else {
    fail(`rollback still swept: ${[...staged].join(', ') || threw?.message.split('\n')[0]}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 12a. a scoped rollback commit uses the backup tree's file list ──────
//      A file added after the backup can remain in the worktree when checkout
//      restores a directory. The rollback commit must not sweep its edit.
{
  const { dir, g, ctx } = makeRepo();
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs/README.md'), 'backup');
  g('add', '-A');
  g('commit', '-qm', 'backup base');
  g('branch', 'backup-pre-update-1.0.0');

  writeFileSync(join(dir, 'docs/README.md'), 'current');
  writeFileSync(join(dir, 'docs/LOCAL.md'), 'current');
  g('add', '-A');
  g('commit', '-qm', 'current update');
  writeFileSync(join(dir, 'docs/LOCAL.md'), 'the user\'s local edit');

  g('checkout', 'backup-pre-update-1.0.0', '--', 'docs/');
  const expanded = expandToShippedFiles(['docs/'], 'backup-pre-update-1.0.0', ctx);
  g('add', '--', ...expanded);
  g('commit', '-qm', 'scoped rollback', '--', ...expanded);

  const committed = g('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);
  const status = g('status', '--porcelain');
  if (expanded.includes('docs/README.md') && !expanded.includes('docs/LOCAL.md')) {
    pass('rollback expansion follows the backup tree and omits a later file');
  } else {
    fail(`rollback expansion kept the later file: ${expanded.join(', ')}`);
  }
  if (committed.includes('docs/README.md') && !committed.includes('docs/LOCAL.md')
      && status.includes('docs/LOCAL.md')) {
    pass('scoped rollback commit leaves the later tracked edit unstaged');
  } else {
    fail(`scoped rollback commit touched the wrong paths: committed=${committed.join(', ')} status=${status}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 12b. the refusal is about directories, not about trailing slashes ──
//    `git add -f -- docs` sweeps exactly as `docs/` does, and rollback() builds
//    its `removed` list in precisely that slash-stripped form a few lines from a
//    call site. A guard that matched the spelling would protect SYSTEM_PATHS'
//    convention and miss the actual hazard the moment anyone normalised a path.
{
  const { dir, g, ctx } = makeRepo();
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs/README.md'), 'shipped upstream');
  writeFileSync(join(dir, 'docs/RETIRED.md'), 'shipped once, deleted by the update');
  writeFileSync(join(dir, '.gitignore'), 'career-dashboard\n*.env\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  writeFileSync(join(dir, 'docs/career-dashboard'), 'compiled binary');
  writeFileSync(join(dir, 'docs/prod.env'), 'SECRET=hunter2');

  let refused = null;
  try {
    addPaths(['docs'], ctx);            // no trailing slash
  } catch (err) {
    refused = err;
  }
  const staged = stagedPaths(g);
  if (refused && refused.message.includes('docs') && staged.size === 0) {
    pass('a slash-free directory is refused without staging anything');
  } else if (refused && staged.size > 0) {
    fail(`threw but staged first: ${[...staged].join(', ')}`);
  } else {
    fail(`a slash-free directory was accepted: ${[...staged].join(', ') || '(nothing staged)'}`);
  }
  g('reset', '-q');

  // The converse has to hold too, or the guard would reject ordinary work: a
  // modified tracked file, a DELETED tracked file (what the prune step feeds
  // it), and a brand-new file (the materialized-entrypoint shape) must all pass
  // through. The deletion is the one worth spelling out — it is the only shape
  // here whose path does not exist on disk when the guard lstats it, which is
  // precisely the question the guard asks, so a guard that refused "missing"
  // instead of "is a directory" would still pass the other two.
  writeFileSync(join(dir, 'docs/README.md'), 'updated');
  writeFileSync(join(dir, 'NEWFILE.md'), 'never tracked before');
  unlinkSync(join(dir, 'docs/RETIRED.md'));
  let wrongly = null;
  try {
    addPaths(['docs/README.md', 'docs/RETIRED.md', 'NEWFILE.md'], ctx);
  } catch (err) {
    wrongly = err;
  }
  const ok = stagedPaths(g);
  const deleted = new Set(
    g('diff', '--cached', '--name-only', '-z', '--diff-filter=D', 'HEAD').split('\0').filter(Boolean),
  );
  if (!wrongly && ok.has('docs/README.md') && ok.has('NEWFILE.md') && deleted.has('docs/RETIRED.md')) {
    pass('modified, deleted and brand-new tracked paths all still stage');
  } else {
    fail(`guard rejected legitimate paths: ${wrongly?.message.split('\n')[0] ?? `staged=${[...ok].join(', ')} deleted=${[...deleted].join(', ') || 'none'}`}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 12c. the shapes an index-based check gets wrong ──
//    Each of these is a directory that a "does the index hold entries beneath
//    it" test misreads, or a file that such a test wrongly rejects. Asking the
//    filesystem answers all four; they are pinned so a future "optimisation"
//    back to an index probe fails here instead of in someone's repository.
{
  const { dir, g, ctx } = makeRepo();
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs/README.md'), 'v1');
  writeFileSync(join(dir, '.gitignore'), '*.env\nnode_modules/\n');
  g('add', '-A');
  g('commit', '-qm', 'base');

  const refuses = (p) => {
    let threw = null;
    try { addPaths([p], ctx); } catch (err) { threw = err; }
    const staged = stagedPaths(g);
    g('reset', '-q');
    return Boolean(threw) && staged.size === 0;
  };

  // (a) An UNTRACKED directory has no index entries at all, yet -f sweeps it.
  mkdirSync(join(dir, 'node_modules'));
  writeFileSync(join(dir, 'node_modules/dep.js'), 'vendored');
  if (refuses('node_modules')) {
    pass('an untracked directory is refused (no index entries to infer from)');
  } else {
    fail('an untracked directory was accepted — -f would sweep its contents');
  }

  // (b) Non-canonical spellings address the same directory. ls-files answers
  //     canonically, so a prefix comparison never matches these.
  if (refuses('./docs') && refuses('docs/.')) {
    pass('non-canonical directory spellings are refused too');
  } else {
    fail('a non-canonical directory spelling slipped through');
  }

  // (c) A directory replaced by a regular FILE of the same name. Stale index
  //     entries still sit beneath it, so an index test reads it as a directory
  //     and rejects legitimate work.
  mkdirSync(join(dir, 'legacy'));
  writeFileSync(join(dir, 'legacy/child.txt'), 'old layout');
  g('add', '-A');
  g('commit', '-qm', 'directory layout');
  rmSync(join(dir, 'legacy'), { recursive: true, force: true });
  writeFileSync(join(dir, 'legacy'), 'upstream replaced the dir with a file');
  let dfThrew = null;
  try { addPaths(['legacy'], ctx); } catch (err) { dfThrew = err; }
  if (!dfThrew && stagedPaths(g).has('legacy')) {
    pass('a directory replaced by a file still stages (index entries are stale)');
  } else {
    fail(`directory-to-file replacement was refused: ${dfThrew?.message.split('\n')[0] ?? 'not staged'}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 12d. a directory in a LATE batch stages nothing at all ──
//    Validating inside the batch loop caught it only after earlier batches were
//    already added, so the refusal reported a problem it had partly committed
//    to. The whole list is checked before any add now.
{
  const { dir, g, ctx } = makeRepo();
  mkdirSync(join(dir, 'bulk'));
  mkdirSync(join(dir, 'late'));
  const names = [];
  for (let i = 0; i < 200; i++) {
    const name = `bulk/${String(i).padStart(3, '0')}-a-deliberately-long-fixture-filename.md`;
    writeFileSync(join(dir, name), 'v1');
    names.push(name);
  }
  writeFileSync(join(dir, 'late/keep.md'), 'tracked');
  writeFileSync(join(dir, '.gitignore'), '*.env\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  for (const n of names) writeFileSync(join(dir, n), 'v2');
  writeFileSync(join(dir, 'late/secret.env'), 'SECRET=1');

  // The directory sits past the 8000-char budget, so it lands in a later batch.
  let threw = null;
  try {
    addPaths([...names, 'late'], ctx);
  } catch (err) {
    threw = err;
  }
  const staged = stagedPaths(g);
  if (threw && staged.size === 0) {
    pass('a directory in a late batch leaves the index completely untouched');
  } else if (threw) {
    fail(`earlier batches were staged before the refusal: ${staged.size} path(s)`);
  } else {
    fail('a late directory was accepted entirely');
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 13. a real ls-tree failure aborts instead of yielding "nothing shipped" ──
//    The absent-directory case exits 0 (test 8), so any throw is genuine. If it
//    were swallowed, an unreadable ref would drop every file under the
//    directory from staging while apply() carried on toward its success path.
{
  const { dir, g, ctx } = makeRepo();
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs/README.md'), 'v1');
  g('add', '-A');
  g('commit', '-qm', 'base');

  console.log('     ↓ the following git "Not a valid object name" line is expected');
  let threw = null;
  let out = null;
  try {
    out = expandToShippedFiles(['docs/'], 'NO-SUCH-REF', ctx);
  } catch (err) {
    threw = err;
  }
  if (threw) {
    pass('an unreadable ref propagates instead of silently expanding to nothing');
  } else {
    fail(`a bad ref was absorbed and returned ${JSON.stringify(out)} — staging would go quietly incomplete`);
  }
  rmSync(dir, { recursive: true, force: true });
}
