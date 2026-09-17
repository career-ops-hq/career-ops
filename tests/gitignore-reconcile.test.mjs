// tests/gitignore-reconcile.test.mjs
//
// .gitignore was absent from the updater's manifest for 43 releases' worth of
// commits, so every ignore rule added upstream in that window reached this
// repository and no existing install (#2756). The file cannot simply join
// SYSTEM_PATHS: it is the one system file users also write to, and the raw
// `git checkout` the update stage performs would delete their rules silently.
//
// reconcileGitignore() appends only what is missing. These tests pin both
// halves of that contract: the system rules arrive, and nothing the user wrote
// is modified, reordered or removed.

import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pass, fail, ROOT } from './helpers.mjs';
import { reconcileGitignore } from '../update-system.mjs';

console.log('\n🔁 .gitignore reconcile (append-if-missing)');

const eq = (actual, expected, msg) =>
  (actual === expected ? pass(msg) : fail(`${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
const ok = (cond, msg) => (cond ? pass(msg) : fail(msg));

// ── The headline requirement: a user-authored rule survives an update ────────
{
  const local = ['cv.md', 'my-scratch-notes/', '*.secret'].join('\n') + '\n';
  const upstream = ['cv.md', 'data/*', '!data/.gitkeep'].join('\n') + '\n';
  const { text, added } = reconcileGitignore(local, upstream);
  const lines = text.split('\n');

  for (const userRule of ['my-scratch-notes/', '*.secret']) {
    ok(lines.includes(userRule), `user rule survives: ${userRule}`);
  }
  ok(text.startsWith(local), 'the original file is a byte-for-byte prefix of the result (no line above was touched)');
  eq(added.join(','), 'data/*,!data/.gitkeep', 'both missing upstream rules were appended');
  ok(!added.includes('cv.md'), 'a rule already present is not duplicated');
}

// ── Idempotency: a second pass is a byte-identical no-op ─────────────────────
{
  const local = 'cv.md\nmy-notes/\n';
  const upstream = 'cv.md\ndata/*\n';
  const first = reconcileGitignore(local, upstream);
  const second = reconcileGitignore(first.text, upstream);
  eq(second.added.length, 0, 'second pass appends nothing');
  eq(second.text, first.text, 'second pass leaves the file byte-identical');
}

// ── A file that already has everything is untouched ──────────────────────────
{
  const local = '# mine\ncv.md\ndata/*\n';
  const { text, added } = reconcileGitignore(local, 'cv.md\ndata/*\n');
  eq(added.length, 0, 'nothing missing means nothing added');
  eq(text, local, 'and the file is returned byte-identical (no spurious update commit)');
}

// ── Presence beats position: moved/reordered system rules do not come back ───
{
  const local = ['data/*', '# my own section', 'notes/', 'cv.md'].join('\n') + '\n';
  const upstream = ['cv.md', 'data/*'].join('\n') + '\n';
  const { added } = reconcileGitignore(local, upstream);
  eq(added.length, 0, 'rules the user reordered are found anywhere in the file, not by position');
}

// ── Rationale comments travel with their rule, but are not duplicated ────────
{
  const upstream = ['# holds PII, never commit', 'documents/*', '!documents/.gitkeep'].join('\n') + '\n';
  const { text } = reconcileGitignore('cv.md\n', upstream);
  ok(text.includes('# holds PII, never commit'), 'the comment explaining a rule is carried across with it');
  const withComment = reconcileGitignore(`cv.md\n# holds PII, never commit\n`, upstream);
  eq(
    (withComment.text.match(/# holds PII, never commit/g) || []).length, 1,
    'a comment already present is not copied a second time',
  );
}

// ── Negations keep their position relative to the pattern they negate ────────
{
  const upstream = ['reports/*', '!reports/.gitkeep'].join('\n') + '\n';
  const { text } = reconcileGitignore('cv.md\n', upstream);
  const lines = text.split('\n');
  ok(
    lines.indexOf('reports/*') !== -1 && lines.indexOf('reports/*') < lines.indexOf('!reports/.gitkeep'),
    'an appended negation lands after the pattern it negates (order is significant in .gitignore)',
  );
}

// ── CRLF checkouts stay CRLF (Windows, core.autocrlf=true) ───────────────────
{
  const { text } = reconcileGitignore('cv.md\r\nmy-notes/\r\n', 'cv.md\ndata/*\n');
  ok(text.includes('data/*'), 'the missing rule is appended to a CRLF file');
  ok(!/[^\r]\n/.test(text), 'and every appended line uses CRLF, so git diff does not report the whole file as changed');
}

// ── A missing trailing newline does not glue two rules together ──────────────
{
  const { text } = reconcileGitignore('cv.md', 'cv.md\ndata/*\n');
  ok(text.split('\n').includes('data/*'), 'the appended rule is on its own line even with no trailing newline locally');
}

// ── Patterns are emitted verbatim, matched normalized ────────────────────────
// A trailing space is only significant in .gitignore when backslash-escaped.
// Matching has to normalize (so indentation drift does not cause a re-add), but
// writing back the normalized form would corrupt the pattern.
{
  const upstream = 'cv.md\nsecret\\ \n';
  const { text, added } = reconcileGitignore('cv.md\n', upstream);
  ok(added.includes('secret\\'), 'the escaped-space pattern is matched in normalized form');
  ok(text.split('\n').includes('secret\\ '), 'but written back verbatim, with its escaped trailing space intact');
  const again = reconcileGitignore(text, upstream);
  eq(again.added.length, 0, 'and the verbatim line is still recognized on the next pass (no re-add loop)');
}

// ── A local rule's significant trailing space survives verbatim ────────────────────────
// The mirror of the case above: normalization is for MATCHING only. Trimming
// the local file's tail would modify a line the user wrote, which is the one
// thing this function promises never to do.
{
  const local = 'cv.md\nsecret\\ ';   // no trailing newline, escaped space is significant
  const { text } = reconcileGitignore(local, 'cv.md\ndata/*\n');
  ok(text.startsWith(local), 'the local file is preserved byte-for-byte, escaped trailing space included');
  ok(text.split(/\r?\n/).includes('secret\\ '), 'and the user rule keeps its significant trailing space');
  ok(text.split(/\r?\n/).includes('data/*'), 'while the missing upstream rule is still appended');
}

// ── An empty local file gets no leading blank lines ──────────────────────────
{
  const { text, added } = reconcileGitignore('', 'cv.md\n');
  ok(added.length > 0, 'an empty file receives the missing rules');
  ok(!text.startsWith('\n'), 'and the result does not open with blank lines');
  eq(reconcileGitignore(text, 'cv.md\n').added.length, 0, 'and is idempotent from there');
}

// ── The shipped .gitignore is self-consistent ────────────────────────────────
// Reconciling the real file against itself must be a no-op. If it is not, the
// reconciler would rewrite .gitignore on every single update forever.
{
  const shipped = readFileSync(join(ROOT, '.gitignore'), 'utf-8');
  const { text, added } = reconcileGitignore(shipped, shipped);
  eq(added.length, 0, 'the shipped .gitignore reconciled against itself adds nothing');
  eq(text, shipped, 'and is returned byte-identical');
}

// ── The upstream blob is read untrimmed ──────────────────────────────────────
// reconcileGitignore()'s verbatim guarantee is only as good as its input. The
// updater's general-purpose git helpers call .trim() on stdout, which is right
// for SHAs and pathspecs and wrong for file content: it strips a significant
// backslash-escaped trailing space off the blob's LAST line, which is exactly
// where a freshly appended upstream rule sits. Every assertion above would
// still pass with a trimming read, so this is a source-level guard, matching
// tests/js-yaml-import-form.test.mjs and tests/source-no-nul-bytes.test.mjs.
{
  const src = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8');

  const readCall = src.match(/const upstreamGitignore = (\w+)\(/);
  if (!readCall) fail('could not find the upstreamGitignore read in update-system.mjs — update this test');
  else eq(readCall[1], 'gitShowRaw', 'the upstream .gitignore is read with gitShowRaw, not a trimming helper');

  const body = src.match(/function gitShowRaw\([^)]*\) \{[\s\S]*?\n\}/);
  if (!body) fail('could not find gitShowRaw() in update-system.mjs — update this test');
  else ok(!/\.trim\(\)/.test(body[0]), 'gitShowRaw() does not trim, so the blob reaches the reconciler byte-exact');
}

// ── A directory re-inclusion negation is not silently defeated (#4189) ──────
// A bare, unanchored appended pattern (`applications.md`) matches ANYWHERE in
// the tree, including under a directory a negation re-includes. Appending it
// at EOF, after `!test-fixtures/**`, makes the new pattern the LAST match for
// every fixture path sharing that name — silently re-ignoring committed
// upgrade-test fixtures on every update. The fix inserts new patterns before
// the last directory negation instead; verified two ways: the appended
// pattern's position in the text, and — the issue's own reproduction command
// — `git check-ignore --no-index` actually resolving the fixture path as
// NOT ignored.
{
  const local = [
    'node_modules/',
    '',
    '!test-fixtures/**',
    '',
  ].join('\n');
  const upstream = [
    'node_modules/',
    '',
    'applications.md',
    'follow-ups.md',
    '',
    '!test-fixtures/**',
    '',
  ].join('\n');
  const { text, added } = reconcileGitignore(local, upstream);

  eq(added.join(','), 'applications.md,follow-ups.md', 'both missing patterns are detected as added');

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const negationIndex = lines.lastIndexOf('!test-fixtures/**');
  const appIndex = lines.indexOf('applications.md');
  const followIndex = lines.indexOf('follow-ups.md');
  ok(
    appIndex !== -1 && followIndex !== -1 && appIndex < negationIndex && followIndex < negationIndex,
    'both appended patterns land BEFORE !test-fixtures/**, not after it',
  );
  // The negation itself is untouched — same line, same position relative to
  // whatever was already below it (nothing, here) — only NEW content moved.
  eq(
    lines.filter((l) => l === '!test-fixtures/**').length, 1,
    '!test-fixtures/** appears exactly once — not duplicated by the insertion',
  );

  // The decisive check: does git itself now agree the fixture is tracked?
  // `check-ignore` still needs SOME repository to run in (a bare standalone
  // directory errors "fatal: not a git repository") — `--no-index` means
  // something narrower: don't consult the INDEX for whether the path is
  // already tracked, which is exactly the blind spot the issue's own report
  // calls out ("plain git check-ignore reports nothing for an already-
  // tracked file"). A throwaway `git init` supplies the repository context
  // without ever staging or committing the fixture.
  const dir = mkdtempSync(join(tmpdir(), 'co-gitignore-4189-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), text);
    mkdirSync(join(dir, 'test-fixtures', 'upgrade', 'data'), { recursive: true });
    writeFileSync(join(dir, 'test-fixtures', 'upgrade', 'data', 'applications.md'), 'fixture\n');
    let ignored = true;
    try {
      execFileSync('git', ['check-ignore', '--no-index', '-q', 'test-fixtures/upgrade/data/applications.md'], { cwd: dir });
    } catch (e) {
      // check-ignore exits 1 when the path is NOT ignored — the outcome
      // this fix exists to restore.
      if (e.status === 1) ignored = false;
    }
    ok(!ignored, 'git check-ignore --no-index confirms the fixture path is NOT ignored after reconciliation');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── Fallback: no directory negation present → unchanged EOF-append (#4189) ──
{
  const local = ['cv.md', 'my-scratch-notes/'].join('\n') + '\n';
  const upstream = ['cv.md', 'my-scratch-notes/', 'applications.md'].join('\n') + '\n';
  const { text } = reconcileGitignore(local, upstream);
  ok(text.startsWith(local), 'with no directory negation to protect, the original file is still an unmodified prefix');
  ok(text.trim().endsWith('applications.md'), 'and the new pattern still lands at EOF, exactly as before this fix');
}
