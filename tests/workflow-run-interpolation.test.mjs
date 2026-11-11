// tests/workflow-run-interpolation.test.mjs — no workflow may put an event
// field inside a `run:` block.
//
// GitHub substitutes `${{ … }}` into the script BEFORE the shell parses it, so a
// `run:` block is the one place a workflow expression becomes shell text instead
// of data. For a value the repository controls (`matrix.*`, `needs.*`,
// `steps.*.outputs`, `env.*`) that is harmless and convenient. For a value an
// event carries it is the documented command-injection footgun: a PR title, a
// comment body, a branch name. The house pattern is to read those in
// `actions/github-script` or to hand them to the shell through `env:`, which the
// shell reads as data and never re-parses.
//
// This is a CONVENTION check, not a proof of exploitability. A GitHub login
// cannot carry a shell metacharacter today, so an interpolation of
// `github.event.comment.user.login` is currently harmless — and it is still
// refused here, because "harmless because of a charset we do not own" is the
// condition that silently stops being true. Same reasoning as
// tests/provider-user-agent-convention.test.mjs (#3170): ban the raw ingredient,
// not the incident.
//
// Run:  node --test tests/workflow-run-interpolation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WORKFLOWS_DIR = join(ROOT, '.github', 'workflows');

/**
 * Expressions whose value the event payload chooses.
 *
 * `github.head_ref` is a branch name, which a fork author picks; `github.ref_name`
 * collapses to the same thing on a pull_request event. Listed with the payload
 * fields so one rule covers them rather than three literals drifting apart.
 *
 * Both access forms count. GitHub supports index syntax as well as property
 * dereference, so `github['event'].issue.title` reaches the same payload as
 * `github.event.issue.title`, and a guard that only knew the dot form would
 * report a clean tree while that expression sat in a `run:` block.
 *
 * Plain `github.ref` carries `refs/heads/<branch>` on a push, and a git ref name
 * may hold `$(`, `;`, `` ` `` and `|` even though it cannot hold a space or a
 * colon, so a branch name is not safe inside shell text either.
 *
 * Case-insensitive because the context lookup is: `github.EVENT` resolves to the
 * same payload as `github.event`, so a case-sensitive matcher is a bypass rather
 * than a false alarm on a lower-case convention. `ref\b` does not swallow
 * `ref_name`, since `_` is a word character and there is no boundary there,
 * which is why both are listed.
 *
 * `github` has to be the root of the expression, not a property someone else
 * owns: a matrix can define `github: [{event: push}]`, and `matrix.github.event`
 * is then a repository-defined value rather than the payload. The lookbehind is
 * what separates the two, and a word boundary alone would not — `.` is already a
 * non-word character, so `\b` matches happily on both sides of it.
 */
const EVENT_OWNED = /(?<![\w.$])github\s*(?:\.|\[\s*['"])\s*(?:event\b|head_ref\b|ref_name\b|ref\b)/i;

/**
 * Every `${{ … }}` body in a string, trimmed.
 *
 * A non-greedy match up to the first `}}` is wrong for a real workflow: GitHub
 * allows `}}` inside a quoted expression string, so
 * `format('{{{0}}}', github.event.issue.title)` would close the expression early
 * and the event field after it would never be examined. This walks each
 * expression and only treats `}}` as the end when it sits outside a single-quoted
 * string. GitHub escapes a quote inside one by doubling it (`''`); a backslash is
 * an ordinary character and is not an escape.
 */
function expressionsIn(text) {
  const src = String(text);
  const bodies = [];
  let from = 0;
  while (from < src.length) {
    const open = src.indexOf('${{', from);
    if (open === -1) break;
    let i = open + 3;
    let inString = false;
    while (i < src.length) {
      const c = src[i];
      if (inString) {
        // GitHub expression strings escape a quote by DOUBLING it; a backslash
        // is an ordinary character. Treating `\` as an escape kept the scanner
        // inside the string for `'\\'`, swallowed the real `}}`, and dropped the
        // whole expression — a guard that reported a clean tree for
        // `${{ github.event.issue.title || '\' }}`.
        if (c === "'") {
          if (src[i + 1] === "'") { i += 2; continue; }
          inString = false;
        }
        i += 1;
        continue;
      }
      if (c === "'") { inString = true; i += 1; continue; }
      if (c === '}' && src[i + 1] === '}') break;
      i += 1;
    }
    if (i >= src.length) break; // unterminated: nothing trustworthy to report
    bodies.push(src.slice(open + 3, i).trim());
    from = i + 2;
  }
  return bodies;
}

/**
 * The keys the matcher looks for, as index syntax spells them.
 *
 * `github['event']` and `github[ 'event' ]` reach the same payload as
 * `github.event`, so their quotes are index syntax rather than a literal and
 * must stay visible to the matcher.
 */
const EVENT_INDEX_KEY = /^(?:event|head_ref|ref_name|ref)$/i;

/**
 * Is the quote at `quoteAt` the start of an event index key?
 *
 * The runner's lexer skips whitespace inside brackets, so the check looks back
 * past it. The key itself is checked too: preserving every indexed string would
 * hand the matcher the contents of `matrix['github.event.issue.title']`, which
 * is a constant and not a reference.
 *
 * @param {string} src
 * @param {number} quoteAt
 * @returns {boolean}
 */
function isEventIndexKey(src, quoteAt) {
  let j = quoteAt - 1;
  while (j >= 0 && /\s/.test(src[j])) j -= 1;
  if (j < 0 || src[j] !== '[') return false;
  const end = src.indexOf("'", quoteAt + 1);
  if (end === -1) return false;
  return EVENT_INDEX_KEY.test(src.slice(quoteAt + 1, end));
}

/**
 * The expression with its string literals blanked out.
 *
 * `${{ 'github.event.issue.title' }}` is a constant string; treating its contents
 * as a context reference rejects a safe workflow. Blanking every quoted run
 * would also hide the reference in `github['event']`, where the quotes are index
 * syntax rather than a literal, so a quote directly after `[` is copied through
 * as it stands.
 *
 * Lengths are preserved so offsets stay comparable, and `''` is the escape for a
 * quote inside a literal, as in GitHub's own grammar.
 *
 * @param {string} expression
 * @returns {string} Same shape, with literal contents replaced by spaces.
 */
function withoutStringLiterals(expression) {
  const src = String(expression);
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src[i] !== "'") {
      out += src[i];
      i += 1;
      continue;
    }
    if (isEventIndexKey(src, i)) {
      const end = src.indexOf("'", i + 1);
      if (end !== -1) {
        out += src.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    out += ' ';
    i += 1;
    while (i < src.length) {
      if (src[i] === "'") {
        if (src[i + 1] === "'") { out += '  '; i += 2; continue; }
        out += ' ';
        i += 1;
        break;
      }
      out += ' ';
      i += 1;
    }
  }
  return out;
}
/**
 * Offending expressions per workflow file, as `job/step: expression`.
 *
 * Exported so the self-test below can drive it with a fixture instead of the
 * live workflows, which is the only way to know the detector still detects.
 *
 * @param {string} source - A workflow file's text.
 * @returns {string[]} One entry per offending expression.
 */
export function offendingExpressions(source) {
  let doc;
  try {
    doc = yaml.load(source);
  } catch {
    return [];
  }
  const found = [];
  const jobs = doc?.jobs ?? {};
  for (const [jobId, job] of Object.entries(jobs)) {
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    steps.forEach((step, index) => {
      if (typeof step?.run !== 'string') return;
      const where = `${jobId}/${step.name ?? `step ${index + 1}`}`;
      for (const expression of expressionsIn(step.run)) {
        if (EVENT_OWNED.test(withoutStringLiterals(expression))) found.push(where + ': ${{ ' + expression + ' }}');
      }
    });
  }
  return found;
}

test('the detector catches an event field in run: and ignores the safe forms', () => {
  const bad = [
    'jobs:',
    '  gate:',
    '    steps:',
    '      - name: Gate',
    '        run: |',
    '          grep -qix "${{ github.event.comment.user.login }}" file',
  ].join('\n');
  assert.equal(offendingExpressions(bad).length, 1, 'an event field in run: must be caught');

  const branchBad = [
    'jobs:',
    '  b:',
    '    steps:',
    '      - run: echo "${{ github.head_ref }}"',
  ].join('\n');
  assert.equal(offendingExpressions(branchBad).length, 1, 'a fork-chosen branch name must be caught');

  // Index syntax reaches the same payload as property dereference.
  const indexedBad = [
    'jobs:',
    '  c:',
    '    steps:',
    '      - run: echo "${{ github[\'event\'].issue.title }}"',
  ].join('\n');
  assert.equal(offendingExpressions(indexedBad).length, 1, 'indexed access to the event payload must be caught');

  // The runner's lexer skips whitespace inside brackets, so the spaced spelling
  // reaches the same payload — and a blanking pass that only looked at the
  // immediately preceding character would hide the key and miss it.
  const spacedIndexedBad = indexedBad.replace("github['event']", "github[ 'event' ]");
  assert.equal(offendingExpressions(spacedIndexedBad).length, 1, 'spaced indexed access must be caught');

  // Preserving an index key must not become a way to smuggle an unrelated
  // indexed string past the matcher: only the monitored keys are kept visible.
  const safeIndexed = indexedBad.replace("github['event'].issue.title", "matrix[ 'github.event.issue.title' ]");
  assert.deepEqual(offendingExpressions(safeIndexed), [], 'an unrelated indexed string must pass');

  // `github` has to be the root of the expression. A matrix may define its own
  // `github` key, and `matrix.github.event` is then a repository-defined value
  // rather than the payload — a word boundary would not tell the two apart,
  // because `.` is a non-word character on both sides of it.
  const nestedGithub = [
    'jobs:',
    '  i:',
    '    steps:',
    '      - run: echo "${{ matrix.github.event }}"',
  ].join('\n');
  assert.deepEqual(offendingExpressions(nestedGithub), [], 'a nested github key is not the context');

  const nestedIndexed = [
    'jobs:',
    '  j:',
    '    steps:',
    '      - run: echo "${{ matrix.github[ \'event\' ] }}"',
  ].join('\n');
  assert.deepEqual(offendingExpressions(nestedIndexed), [], 'a nested github key reached by index is not the context either');

  // A push's ref is a branch or tag name, and a git ref may carry $(, ;, ` or |.
  const refBad = [
    'jobs:',
    '  d:',
    '    steps:',
    '      - run: echo "${{ github.ref }}"',
  ].join('\n');
  assert.equal(offendingExpressions(refBad).length, 1, 'github.ref carries a branch name and must be caught');

  // The context lookup is case-insensitive, so a case-sensitive matcher is a bypass.
  const caseBad = [
    'jobs:',
    '  e:',
    '    steps:',
    '      - run: echo "${{ github.EVENT.issue.title }}"',
  ].join('\n');
  assert.equal(offendingExpressions(caseBad).length, 1, 'an upper-case context property must be caught');

  // GitHub allows }} inside a quoted expression string; the expression must not
  // be cut short before the event field it also contains.
  const braceInStringBad = [
    'jobs:',
    '  f:',
    '    steps:',
    '      - run: echo "${{ format(\'{{{0}}}\', github.event.issue.title) }}"',
  ].join('\n');
  assert.equal(offendingExpressions(braceInStringBad).length, 1, 'an expression whose string holds }} must be read to its real end');

  // A backslash is not an expression-string escape: GitHub escapes a quote by
  // doubling it. Reading `\` as an escape kept the scanner inside the string,
  // swallowed the real `}}`, and returned no offenders at all.
  const backslashBad = [
    'jobs:',
    '  g:',
    '    steps:',
    '      - run: |',
    '          echo "${{ github.event.issue.title || \'\\\' }}"',
  ].join('\n');
  assert.equal(offendingExpressions(backslashBad).length, 1, 'a backslash inside an expression string must not hide the expression');

  const safe = [
    'jobs:',
    '  ok:',
    '    steps:',
    '      - name: Gate',
    '        env:',
    '          AUTHOR: ${{ github.event.comment.user.login }}',
    '        run: echo "$AUTHOR" | grep -qix santifer',
    '      - run: echo "${{ matrix.os }} ${{ needs.changes.outputs.docs_only }} ${{ github.repository }}"',
    '      - run: echo "${{ \'github.event.issue.title\' }}"',
  ].join('\n');
  assert.deepEqual(offendingExpressions(safe), [], 'env: indirection, repo-owned values, unrelated github.* fields and a string literal must pass');

  // A literal that spells a context reference is not one, but a real reference
  // beside it still is.
  const literalBesideReference = [
    'jobs:',
    '  h:',
    '    steps:',
    '      - run: echo "${{ format(\'github.event is {0}\', github.event.issue.title) }}"',
  ].join('\n');
  assert.equal(offendingExpressions(literalBesideReference).length, 1, 'a literal must not hide the reference next to it');
});

test('no workflow interpolates an event field into a run: block', () => {
  const files = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  assert.ok(files.length > 0, 'no workflow files found — the guard would pass vacuously');

  const offenders = [];
  for (const file of files) {
    for (const hit of offendingExpressions(readFileSync(join(WORKFLOWS_DIR, file), 'utf8'))) {
      offenders.push(`${file} → ${hit}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Event fields must reach a shell through env:, not through run: (see tests/workflow-run-interpolation.test.mjs):\n  ${offenders.join('\n  ')}`,
  );
});