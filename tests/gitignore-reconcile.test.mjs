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

import { readFileSync } from 'fs';
import { join } from 'path';
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
