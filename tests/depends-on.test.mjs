// Parser for the `Depends on` section of a PR body (#3880).
//
// The load-bearing case is the NEGATIVE one. "depends on" is ordinary English
// and appears mid-prose in most PR bodies in this repo; a parser that matches
// the phrase anywhere fires on bodies that declare no dependency at all, and a
// false positive here blocks a merge. So the anchor is strict: a heading, or
// the phrase at the start of a line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRefs, prFromQueueRef, renderBody, resolveDependsOn } from '../.github/scripts/depends-on.mjs';

// The check reads GitHub's own rendering of the body, so the suite asserts
// against recorded output from that renderer rather than a local reimplementation.
// Regenerate with `GITHUB_TOKEN=... node tests/record-fixtures.mjs`.
const FIXTURES = JSON.parse(readFileSync(new URL('./fixtures/rendered-bodies.json', import.meta.url), 'utf8'));

/** The value of a single-quoted JS string literal, given its inner text. */
function literalValue(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] !== '\\') { out += raw[i]; continue; }
    const c = raw[i + 1];
    i += 1;
    if (c === 'n') out += '\n';
    else if (c === 't') out += '\t';
    else if (c === 'r') out += '\r';
    else if (c === '0') out += '\0';
    else if (c === 'u' && raw[i + 1] === '{') {
      const end = raw.indexOf('}', i + 2);
      out += String.fromCodePoint(parseInt(raw.slice(i + 2, end), 16));
      i = end;
    } else if (c === 'u') { out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 5), 16)); i += 4; }
    else if (c === 'x') { out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 3), 16)); i += 2; }
    else out += c;
  }
  return out;
}

/** What the check returns for a Markdown body, offline. */
function refs(body, self = null) {
  if (typeof body !== 'string' || !body.trim()) return [];
  const html = FIXTURES[body];
  assert.ok(html !== undefined, `no recorded fixture for ${JSON.stringify(body)} - run node tests/record-fixtures.mjs`);
  return extractRefs(html, self);
}
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

test('a `## Depends on` heading collects the refs beneath it', () => {
  assert.deepEqual(refs('## Depends on\n\n#3513 — §2 lands with it.\n'), [3513]);
});

test('a `Depends on:` line collects the refs on that line', () => {
  assert.deepEqual(refs('Depends on: #12, #34\n'), [12, 34]);
});

test('a line-initial bold `**Depends on #4076**` counts', () => {
  assert.deepEqual(refs('**Depends on #4076** (it adds the field).\n'), [4076]);
});

test('a list item `- Depends on #7` counts', () => {
  assert.deepEqual(refs('- Depends on #7\n'), [7]);
});

// GFM accepts BOTH `1.` and `1)` as ordered list markers, and LIST_MARKER two
// dozen lines below LINE already spells that `\d{1,9}[.)]`. LINE spelled only
// `\d+\.`, so the same file disagreed with itself: `1)` opened a fence for
// stripping purposes but did not anchor a declaration. A body numbering its
// dependencies that way passed the check with the dependency still open.
test('an ordered list item counts under either GFM marker', () => {
  assert.deepEqual(refs('1. Depends on #5\n'), [5]);
  assert.deepEqual(refs('1) Depends on #5\n'), [5]);
  // The marker is a marker, not prose: no other punctuation stands in for it.
  assert.deepEqual(refs('1: Depends on #5\n'), []);
});

// This is the case that matters. Verbatim shapes taken from open PRs in this
// repo that declare NO dependency.
test('the phrase mid-sentence is prose and collects nothing', () => {
  const bodies = [
    'The flag would disable the very magic it depends on. See #3935 for context.\n',
    "`bodyAt`'s brace matching depends on it.\n\nCloses #3908\n",
    'It carries the one rule the whole design depends on.\n\nRefs #2185\n',
    'CI never depends on occ.com.mx being reachable. Fixes #3748\n',
  ];
  for (const b of bodies) assert.deepEqual(refs(b), [], `prose matched: ${b.slice(0, 40)}`);
});

test('`Closes #N` alone collects nothing', () => {
  assert.deepEqual(refs('Closes #123\n\n## Tests\n\nAll green.\n'), []);
});

test('the section ends at the next heading', () => {
  assert.deepEqual(refs('## Depends on\n\n#1\n\n## Tests\n\n#2 is unrelated.\n'), [1]);
});

test('a fenced block is not the document', () => {
  assert.deepEqual(refs('```\n## Depends on\n\n#99\n```\n'), []);
});

test('a fence longer than three characters is still a fence', () => {
  // stripFences looked for a closing run matching the opening marker exactly,
  // so a four-character fence never closed and the sample inside it was read as
  // a declaration. A required check that blocks on a documented example is the
  // false positive this parser exists to avoid.
  assert.deepEqual(refs('~~~~\nDepends on #99\n~~~~\n'), []);
  assert.deepEqual(refs('````\nDepends on #99\n````\n'), []);
  // Controls: the three-character forms that already worked must keep working,
  // otherwise "closes the 4-char hole" is indistinguishable from "drops
  // everything".
  assert.deepEqual(refs('```\nDepends on #99\n```\n'), []);
  assert.deepEqual(refs('~~~\nDepends on #99\n~~~\n'), []);
  // And a real declaration outside any fence still parses.
  assert.deepEqual(refs('```\nsample\n```\n\nDepends on #42\n'), [42]);
});

test('a fence opened inside a list item is still a fence', () => {
  // GFM lets a fence open at a list item's content column, not only at the
  // document margin. FENCE_OPEN anchored to 0-3 spaces missed the opener, so
  // the sample inside the block leaked out and read as a declaration: a
  // required check blocking a PR that declared no dependency at all.
  assert.deepEqual(refs('- ```\n  Depends on #42\n  ```\n'), []);
  assert.deepEqual(refs('1. ~~~\n   Depends on #42\n   ~~~\n'), []);
  // Controls: the margin form still works, and a declaration after the list
  // item is still found, so "handles list items" is not "swallows the body".
  assert.deepEqual(refs('```\nDepends on #42\n```\n'), []);
  assert.deepEqual(refs('- ```\n  sample\n  ```\n\nDepends on #42\n'), [42]);
});

test('a fence opened in a list item ends with the list item', () => {
  // GFM closes an unclosed fence at the end of its enclosing list item. Running
  // it to the end of the document instead swallowed every declaration after the
  // list, which hides a dependency rather than inventing one: the direction that
  // lets a bad merge through. A line that is non-blank and indented less than the
  // item's content column has left the item.
  assert.deepEqual(refs('- ```\n  sample\n\nDepends on #42\n'), [42]);
  assert.deepEqual(refs('- ```\n  sample\nDepends on #42\n'), [42]);
  // Still inside the item, so still inside the block.
  assert.deepEqual(refs('- ```\n  Depends on #42\n'), []);
  // A fence at the margin keeps running to the end of the document, per GFM.
  assert.deepEqual(refs('```\nDepends on #42\n'), []);
});

test('a code span cannot open at a backslash-escaped backtick', () => {
  // GFM: a backslash-escaped backtick is literal text, never a delimiter.
  // CODE_SPAN matched between two escaped backticks and masked everything
  // between them, including a real declaration. That is the failure direction
  // that lets a bad merge through, not merely a false block.
  assert.deepEqual(refs('Note \\`sample\n\nDepends on #42\n\nand \\`more\n'), [42]);
  // An escaped BACKSLASH does not escape the backtick after it, so this pair
  // is a real span and still masks what it contains.
  assert.deepEqual(refs('a \\\\`Depends on #42`\n'), []);
  // Control: an ordinary span still masks its contents.
  assert.deepEqual(refs('`Depends on #42`\n'), []);
});

test('a commented-out command is not counted as an invocation', () => {
  // The sweeps below read run blocks as text. Without this, commenting a step
  // out still satisfied them, so they stayed green for a check that no longer
  // ran. A `#` inside quotes stays data, or a real command after it would be
  // dropped and the sweep would pass for the opposite reason.
  assert.deepEqual(
    paths(INVOKES, stripShellComments('# node .github/scripts/depends-on.mjs\necho hi\n')),
    [],
  );
  assert.deepEqual(
    paths(INVOKES, stripShellComments('  # node a.mjs\nnode b.mjs\n')),
    ['b.mjs'],
  );
  assert.deepEqual(
    paths(INVOKES, stripShellComments('node a.mjs # see node b.mjs\n')),
    ['a.mjs'],
  );
  assert.deepEqual(
    paths(INVOKES, stripShellComments('echo "a # b" && node a.mjs\n')),
    ['a.mjs'],
  );
});

test('a list-item fence measures indentation in columns, and a new item can reopen it', () => {
  // Two gaps in the list-item boundary. Indentation was counted with /^ */, so a
  // TAB read as zero columns and a tab-indented line looked like it had left the
  // item; GFM advances a tab to the next four-column stop, so it is still inside.
  assert.deepEqual(refs('- ```\n\tDepends on #42\n  ```\n'), []);
  // And the boundary line was kept as text without being retested, so a second
  // list item opening its own fence never opened one.
  assert.deepEqual(refs('- ```\n  sample\n- ```\n  Depends on #42\n  ```\n'), []);
  // Controls: the boundary still ends the fence when the line is ordinary prose,
  // a declaration inside the item stays hidden, and the margin case is unchanged.
  assert.deepEqual(refs('- ```\n  sample\n\nDepends on #42\n'), [42]);
  assert.deepEqual(refs('- ```\n  Depends on #42\n'), []);
  assert.deepEqual(refs('```\nDepends on #42\n'), []);
});

test('a margin fence after a list item is a new block, not the item\'s closer', () => {
  // Checked against commonmark 0.31 and marked with gfm, not from reading the
  // spec: both render `Depends on #80` inside <pre><code> and `Depends on #81`
  // as a paragraph. The column-0 run ends the list item, then opens a fresh
  // document-level block, so the first ref is hidden and the second is not.
  assert.deepEqual(
    refs('- ```\n  x\n```\nDepends on #80\n```\nDepends on #81\n'),
    [81],
  );
});

test('a code span ending in a backslash still closes', () => {
  // GFM applies backslash escapes OUTSIDE code spans only. Inside one a
  // backslash is literal, so it cannot stop the span closing. Neutralising
  // every escape pair before the scan ate the closer of a span ending in a
  // backslash, and the span ran on to the next backtick and swallowed the
  // declaration between them. Windows paths make `C:\\` an everyday body.
  assert.deepEqual(
    refs('Writes to `C:\\` on Windows.\n\n**Depends on #4076** first.\n\nSee `set-status.mjs`.\n'),
    [4076],
  );
  // The opening side of the rule still holds: an escaped backtick opens nothing.
  assert.deepEqual(refs('Note \\`sample\n\nDepends on #42\n\nand \\`more\n'), [42]);
  // An escaped BACKSLASH leaves the backtick after it free to open a span.
  assert.deepEqual(refs('a \\\\`Depends on #42`\n'), []);
  // Control: an ordinary span still masks its contents.
  assert.deepEqual(refs('`Depends on #42`\n'), []);
});

test('an unclosed fence runs to the end of the body', () => {
  // GFM: a fence with no closing line extends to the end of the document.
  assert.deepEqual(refs('```\nDepends on #99\n'), []);
});

test('a CRLF body still sees declarations after a fenced block', () => {
  // GFM counts CRLF as a line ending, and GitHub's own web editor submits it.
  // Splitting on \n alone left a trailing \r that no closing-fence pattern
  // matched, so the first fence never closed and swallowed everything after it.
  // The failure direction is the dangerous one: the declaration goes MISSING,
  // so the required check passes while the dependency PR is still open.
  assert.deepEqual(refs('```\r\nex\r\n```\r\nDepends on #42\r\n'), [42]);
  assert.deepEqual(refs('Depends on #42\r\n'), [42]);
  assert.deepEqual(refs('Depends on #42\r'), [42]);
});

test('a backtick in a backtick fence info string is not a fence', () => {
  // GFM: a backtick-fenced block's info string may not contain a backtick, so
  // ```js`sample is ordinary text. Opening a fence on it hid the declaration
  // beneath, another silent pass while the dependency is open.
  assert.deepEqual(refs('```js`sample\nDepends on #42\n'), [42]);
  // Controls: a plain info string still opens a fence, and a TILDE fence may
  // carry a backtick in its info string.
  assert.deepEqual(refs('```js\nDepends on #42\n```\n'), []);
  assert.deepEqual(refs('~~~js`x\nDepends on #42\n~~~\n'), []);
});

test('a shorter backtick run does not close a longer one', () => {
  // The backreference could match the first two backticks of a three-backtick
  // run, ending a span early and exposing the text inside it.
  assert.deepEqual(refs('`` code ``` and ` note\nDepends on #42\n``'), []);
});

test('a fence marker under four spaces does not close its own fence', () => {
  // GFM allows a fence marker at most three spaces of indentation. Deeper than
  // that it is indented code and stays INSIDE the block, so accepting any
  // indentation let an indented sample line close the fence and expose the
  // text beneath it as a declaration.
  assert.deepEqual(refs('```\nexample\n    ```\nDepends on #42\n'), []);
  // Controls: three spaces and none still close, so this is not just "never
  // closes a fence".
  assert.deepEqual(refs('```\nexample\n   ```\nDepends on #42\n'), [42]);
  assert.deepEqual(refs('```\nexample\n```\nDepends on #42\n'), [42]);
});

test('a code span may contain a newline', () => {
  // GFM permits a newline inside a span, and the line rules are anchored to the
  // start of a line, so a span crossing lines exposed its second line as a
  // declaration.
  assert.deepEqual(refs('`example\nDepends on #99`\n'), []);
  // Control: a lone backtick with no partner must not swallow the rest of the
  // body. Without this, masking multiline spans could hide a real declaration.
  assert.deepEqual(refs('Use `foo to do X\n\nDepends on #42\n'), [42]);
});

test('a code span wrapping a bold anchor is documentation', () => {
  // BOLD scanned the raw body, so it lifted the inner text out of a code span
  // before code spans were removed, and a body documenting the syntax declared
  // a dependency on its own example.
  assert.deepEqual(refs('`**Depends on #99**`\n'), []);
  // Control: the same bold OUTSIDE a code span is a real declaration. Without
  // this, stripping spans before the BOLD scan could silently kill the feature.
  assert.deepEqual(refs('**Depends on #99**\n'), [99]);
});

test('a code span is not a reference', () => {
  assert.deepEqual(refs('## Depends on\n\n`#99` is the format. #1 is real.\n'), [1]);
});

test('repeats collapse and order is stable', () => {
  assert.deepEqual(refs('## Depends on\n\n#5 and #3 and #5 again\n'), [5, 3]);
});

test('an empty or absent body collects nothing', () => {
  for (const b of [null, undefined, '', '   \n']) assert.deepEqual(refs(b), []);
});

test('the heading match ignores case and depth', () => {
  assert.deepEqual(refs('### DEPENDS ON\n\n#42\n'), [42]);
});

test('a merge-queue head_ref yields the PR number behind it', () => {
  assert.equal(prFromQueueRef('refs/heads/gh-readonly-queue/main/pr-4078-abc123'), 4078);
  assert.equal(prFromQueueRef('refs/heads/main'), null);
  assert.equal(prFromQueueRef(''), null);
  assert.equal(prFromQueueRef(undefined), null);
});

// #4078 writes it mid-paragraph, bolded. That is a live dependency (#4076 is open),
// so missing it defeats the check. A bold span carrying both the phrase and the ref
// is tight enough: across all ten open PRs whose body contains "depends on", it hits
// that one and nothing else.
test('a bold span carrying both the phrase and the ref counts anywhere', () => {
  const body = 'Reshaped after a compliance pass. **Depends on #4076** (it adds `externalId`).\n';
  assert.deepEqual(refs(body), [4076]);
});

// The bound is per-line on purpose. Without it the span runs from one paragraph's
// closing `**` to the next paragraph's opening `**`, swallowing prose and an
// unrelated `#N` in between. That shape is real: it is what PR #2999's body does.
test('a bold span does not run across a blank line', () => {
  // Written as one literal, not joined from parts: the fixture recorder reads
  // string literals out of this file, so an assembled body has nothing recorded
  // and the helper below refuses it rather than asserting against nothing.
  assert.deepEqual(refs('Some emphasis **here** and the design depends on that.\n\nA later paragraph cites #2185 for unrelated reasons.\n\nAnd **more emphasis** closes it.\n'), []);
});

// Without the ref inside the bold span, `**the design depends on this**` collects the
// whole line and any `#N` sharing it gets swept up.
test('a bold span without a ref inside it collects nothing', () => {
  assert.deepEqual(refs('**The whole design depends on this**, and #2185 froze it.\n'), []);
});

test('a body listing its own number does not block itself', () => {
  assert.deepEqual(refs('## Depends on\n\n#4078 and #4076\n', 4078), [4076]);
  assert.deepEqual(refs('## Depends on\n\n#4078\n', 4078), []);
});

// The visible-container list was an allowlist of block tags, so a container
// nobody listed was never scanned and its declaration vanished. Tags now
// default to a block break and only inline elements are kept inline, which
// turns an unknown tag into a spurious line break instead of a hidden one.
test('an unlisted visible container still yields its declaration', () => {
  assert.deepEqual(refs('<div>Depends on #42</div>\n'), [42]);
  assert.deepEqual(refs('<details>Depends on #42</details>\n'), [42]);
  assert.deepEqual(refs('<dl><dt>dep</dt><dd>Depends on #42</dd></dl>\n'), [42]);
});

// GitHub wraps every `#42` in an anchor, so treating `a` as a block break would
// separate a declaration from its own reference.
test('the reference stays on the declaration line', () => {
  assert.deepEqual(refs('Depends on #42\n'), [42]);
  assert.deepEqual(refs('| a |\n|---|\n| Depends on #42 |\n'), [42]);
});

// The line anchor still skips leading asterisks, as the replaced code did. Dropping
// that was a trade: it stopped literal asterisks in raw HTML counting, and in
// exchange a forgotten closing `**` stopped counting too, which is an ordinary typo
// and hides a real declaration.
test('leading asterisks do not stop a line anchoring', () => {
  assert.deepEqual(refs('**Depends on #4076** (it adds the field).\n'), [4076]);
  assert.deepEqual(refs('**Depends on #5\n\nFixes #9\n'), [5]);
  assert.deepEqual(refs('<details>\n<summary>Deps</summary>\n**Depends on #5**\n</details>\n'), [5]);
});

test('a commented-out declaration is invisible', () => {
  assert.deepEqual(refs('<!-- Depends on #99 -->\n\nNothing here.\n'), []);
  assert.deepEqual(refs('Depends on #42\n\n<!-- Depends on #99 -->\n'), [42]);
});

// Fixtures cover extractRefs, so nothing else would notice the request itself
// going wrong: a changed endpoint, a dropped `mode`, a missing `context`.
test('the renderer asks GitHub for GFM in this repo context', async () => {
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url, init });
    return { ok: true, text: async () => '<p>Depends on #42</p>' };
  };
  const html = await renderBody('Depends on #42\n', 'owner/repo', 'tok', fakeFetch);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://api.github.com/markdown');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers.authorization, 'Bearer tok');
  assert.equal(seen[0].init.headers.accept, 'application/vnd.github+json');
  assert.deepEqual(JSON.parse(seen[0].init.body), { text: 'Depends on #42\n', mode: 'gfm', context: 'owner/repo' });
  assert.equal(html, '<p>Depends on #42</p>');
});

// A render failure must not fall back to reading the raw body: two parsers with
// different semantics is the class this change removes. Fail closed instead.
test('a render failure is raised, never silently downgraded', async () => {
  const failing = async () => ({ ok: false, status: 503, text: async () => '' });
  await assert.rejects(() => renderBody('Depends on #42\n', 'owner/repo', 'tok', failing), /503/);
});

test('a phrase-bearing body is resolved through the renderer', async () => {
  const stub = async () => ({ ok: true, text: async () => FIXTURES['Depends on #42\n'] });
  assert.deepEqual(await resolveDependsOn('Depends on #42\n', null, 'owner/repo', 'tok', stub), [42]);
});

// An adversarial pass found these by rendering each body and comparing against the
// page. Every one ran in the HIDDEN direction: the gate returned nothing for a body
// that visibly declares a dependency, so the PR would have merged early.

// A body hard-wrapped after `Depends` is the likely accident here. GitHub renders
// the break, and a phrase pattern built on one literal space never matches it.
test('any whitespace separates the two words', () => {
  assert.deepEqual(refs('Depends  on #42\n'), [42]);
  assert.deepEqual(refs('Depends\non #42\n'), [42]);
  assert.deepEqual(refs('Depends\ton #42\n'), [42]);
  assert.deepEqual(refs('Depends <!-- x --> on #42\n'), [42]);
  assert.deepEqual(refs('Depends&nbsp;on #42\n'), [42]);
});

// An unclosed `<code>` makes GitHub's sanitizer wrap every later block inside it.
// Removing that wrapper removed real declarations, so a code element holding a
// block element is treated as the sanitizer's doing rather than the author's.
test('a sanitizer-invented code wrapper does not swallow the body', () => {
  assert.deepEqual(refs('<code>oops\n\nDepends on #19'), [19]);
});

// Any tag outside the inline set becomes a line break, so a missing inline tag
// separates the phrase from its reference and the declaration disappears.
test('inline markup between the phrase and its reference is not a break', () => {
  assert.deepEqual(refs('<ruby>Depends on</ruby> #42\n'), [42]);
  assert.deepEqual(refs('<strike>Depends on</strike> #42\n'), [42]);
});

// A section ends at the next heading, whatever its level. Scoping by level instead
// was a trade, not a fix: it stopped a subheading hiding references, and in exchange
// pulled unrelated ones out of the prose below that subheading and blocked merges on
// them. This matches the behaviour of the code being replaced.
test('a section ends at the next heading of any level', () => {
  assert.deepEqual(refs('## Depends on\n\n### Detail\n\n- #42\n'), []);
  assert.deepEqual(refs('## Depends on\n#4400\n\n### Rationale\nSee #3880 for context.\n'), [4400]);
});

// A declaration continues while the lines directly below carry nothing but
// references. Without it a hard break after the first ref drops every later one.
//
// The continuation stops at a blank line on purpose, so `Depends on:` followed by
// a separate list is still not read. That shape is an open question about how far
// the anchor should reach, and widening a required gate is not a decision to make
// inside a fix.
test('a declaration keeps the references listed under it', () => {
  assert.deepEqual(refs('Depends on #1<br>#2\n'), [1, 2]);
  assert.deepEqual(refs('Depends on:\n\n- #77\n- #78\n'), []);
});

// The point of all of the above is that a documented example still counts for
// nothing. These are the cases the strictness exists for.
test('a documented example is still not a declaration', () => {
  assert.deepEqual(refs('```\nDepends on #99\n```\n'), []);
  assert.deepEqual(refs('`Depends on #99` is the syntax.\n'), []);
  assert.deepEqual(refs('The flag would disable the very magic it depends on. See #3935 for context.\n'), []);
});

// A second adversarial pass found these. Each is the same shape: a list of things
// the code knew about, and a body using something the list had not heard of. Every
// one of them now works by complement instead, so an unrecognised construct costs
// an extra render or a kept element rather than a lost declaration.

// Inline Markdown renders to a plain word, so no amount of unescaping the RAW body
// finds the phrase. This is why the body is always rendered and never pre-filtered.
test('inline markup inside the word still declares', () => {
  assert.deepEqual(refs('Dep*end*s on #5\n'), [5]);
  assert.deepEqual(refs('Dep**end**s on #5\n'), [5]);
  assert.deepEqual(refs('[Dep](http://x.y)ends on #5\n'), [5]);
});

// A leading `&emsp;` renders U+2003, which a `[ \t]` class does not match, and a
// zero-width space sits inside the phrase where `\s` cannot see it.
test('invisible and exotic whitespace does not hide a declaration', () => {
  assert.deepEqual(refs('&emsp;Depends on #5\n'), [5]);
  assert.deepEqual(refs('Depends\u200b on #5\n'), [5]);
  assert.deepEqual(refs('Dep&shy;ends on #5\n'), [5]);
});

// An unclosed `<code>` makes GitHub wrap later content in it. Keeping any code
// element that holds a non-inline tag covers the containers a block-tag list missed,
// and the inline case is kept because prose naming a tag is an ordinary accident.
test('a kept code wrapper still hides a genuine fence inside it', () => {
  assert.deepEqual(refs('Wraps it in a <code> block.\n\nThe syntax is:\n\n```\nDepends on #99\n```\n'), []);
});

test('an unclosed code tag does not delete the rest of the body', () => {
  assert.deepEqual(refs('<code>x\n\n<details><summary>Depends on #5</summary>t</details>'), [5]);
  assert.deepEqual(refs('Use the <code> tag\nDepends on #5'), [5]);
});

// Same trade, same conclusion: skipping nested headings kept the section open past
// a <details> that GitHub auto-closes at the end of the document, so every later
// reference joined it.
test('a nested heading also closes the section', () => {
  assert.deepEqual(refs('## Depends on\n\n> # quoted\n\n#5\n'), []);
});

// The continuation rule is a complement: a line qualifies when removing its
// references and connectors leaves nothing. A punctuation list kept dropping refs.
test('a continuation line survives ordinary punctuation', () => {
  assert.deepEqual(refs('Depends on #5  \n#6.\n'), [5, 6]);
  assert.deepEqual(refs('Depends on #5  \n(#6)\n'), [5, 6]);
  assert.deepEqual(refs('Depends on #5  \n#6 or #7\n'), [5, 6, 7]);
  // Prose below a declaration is still prose, references and all.
  assert.deepEqual(refs('Depends on #5  \n#6 is the one we need\n'), [5]);
});

// A case added without re-recording would pass vacuously on a stale fixture.
test('every Markdown case in this suite has a recorded fixture', () => {
  const src = readFileSync(new URL('./depends-on.test.mjs', import.meta.url), 'utf8');
  const missing = [];
  for (const m of src.matchAll(/\brefs\('((?:[^'\\]|\\.)*)'/g)) {
    const body = literalValue(m[1]);
    if (typeof body === 'string' && body.trim() && FIXTURES[body] === undefined) missing.push(body);
  }
  assert.deepEqual(missing, [], 'run node tests/record-fixtures.mjs');
});

// The path the workflow runs (#3880).
//
// `.github/workflows/depends-on.yml` passes when the script is absent. That is
// correct on the PR introducing the check. It is correct again later: a required
// check whose implementation went missing should not redden every open PR.
//
// The cost is that absent and working look identical from outside. Rename the
// script, or edit the sparse-checkout path it arrives under, and the required
// check reports success on every PR in the repo. The ordering gate is off, and
// one log line nobody opens is the only signal.
//
// So the paths get pinned here. Every path below is read out of the workflow
// YAML. A test carrying its own copy stops tracking the workflow the day it
// moves, and pins nothing.
//
// The sweep reads every workflow, because the shape is not unique to this one.
// Four sibling jobs run a script out of a sparse checkout the same way. Their
// failure is loud, so they need no guard, and their paths cost nothing to pin
// while the parser is already open.
//
// Two floors keep the sweep honest. The first says it found something at all.
// The second names this job. The first is an existence check across the whole
// repo, so a stranger job satisfies it. Exactly one job carries an
// absent-means-pass guard today, this one. Put its run step under a
// `working-directory` and the sweep drops it. Add a guard anywhere else and the
// repo-wide floor still passes, with this job swept for nothing.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');

/** `node <path>.mjs` inside a run block. */
const INVOKES = /\bnode\s+([^\s;&|)'"]+\.mjs)/g;
/**
 * Shell source with its comments removed.
 *
 * A regex cannot tell a command from a comment that mentions one. Commenting a
 * run step out to `# node .github/scripts/depends-on.mjs` left INVOKES still
 * matching it, so the guard, disk and sparse-checkout sweeps below kept passing
 * while the required check no longer ran at all: green for a workflow that does
 * nothing. Quote tracking matters because a `#` inside a quoted string is data,
 * not a comment, and cutting there would drop a real invocation after it.
 */
function stripShellComments(script) {
  return script.split('\n').map((line) => {
    let quote = null;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
        return line.slice(0, i);
      }
    }
    return line;
  }).join('\n');
}
/** `[ ! -f <path>.mjs ]`, the absent-means-pass guard. */
const GUARDS = /\[\s*!\s*-f\s+([^\s\]]+\.mjs)\s*\]/g;

const paths = (re, text) => [...new Set([...text.matchAll(re)].map((m) => m[1]))].sort();

/**
 * Every workflow job, with the script paths its run steps name and the sparse
 * checkout those paths have to arrive under.
 * @returns {{file: string, job: string, sparse: string[], invoked: string[], guarded: string[]}[]}
 */
function workflowJobs() {
  const out = [];
  for (const file of readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/i.test(f))) {
    const doc = yaml.load(readFileSync(join(WORKFLOWS, file), 'utf-8'));
    for (const [job, spec] of Object.entries(doc?.jobs ?? {})) {
      const steps = spec?.steps ?? [];
      const sparse = steps.flatMap((s) => {
        const declared = s?.with?.['sparse-checkout'];
        const lines = Array.isArray(declared) ? declared : String(declared ?? '').split('\n');
        return lines.map((p) => p.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean);
      });
      // A step with its own working directory resolves its paths somewhere else.
      // This sweep reads repo-root-relative paths only.
      const run = steps.filter((s) => s?.run && !s['working-directory']).map((s) => s.run).join('\n');
      const live = stripShellComments(run);
      out.push({ file, job, sparse, invoked: paths(INVOKES, live), guarded: paths(GUARDS, live) });
    }
  }
  return out;
}

// Runs first on purpose. Every assertion below iterates what this sweep
// collected. An empty collection passes all of them without reading a byte of
// the workflow.
test('the workflow sweep finds paths to pin', () => {
  const jobs = workflowJobs();
  assert.ok(jobs.length > 0, 'no workflow jobs were read');
  assert.ok(jobs.some((j) => j.invoked.length), 'no run step invokes a script');
  assert.ok(jobs.some((j) => j.guarded.length), 'no absent-means-pass guard was found');
  assert.ok(jobs.some((j) => j.sparse.length), 'no sparse-checkout was found');
});

// Every assertion below skips a job whose set is empty, and the floor above is
// satisfied by any job in the repo. This test names the job that matters.
// Paths still come out of the YAML; only the job's identity is written here.
test('the depends-on job is in the sweep with its own guard', () => {
  const job = workflowJobs().find((j) => j.file === 'depends-on.yml' && j.job === 'depends-on');
  assert.ok(job, 'depends-on.yml no longer defines a `depends-on` job');
  assert.ok(job.invoked.length, 'the depends-on job contributes no invoked script to the sweep');
  assert.ok(job.guarded.length, 'the depends-on job contributes no absent-means-pass guard to the sweep');
  assert.ok(job.sparse.length, 'the depends-on job contributes no sparse-checkout to the sweep');
});

test('every script a workflow names is on disk', () => {
  for (const j of workflowJobs()) {
    for (const p of new Set([...j.invoked, ...j.guarded])) {
      assert.ok(existsSync(join(ROOT, p)), `${j.file} (${j.job}) names ${p}, which is not in the repo`);
    }
  }
});

// The guard decides whether the job runs at all. A guard reading one path while
// the step runs another passes the job whenever they disagree.
test('an absent-means-pass guard tests the path its job runs', () => {
  for (const j of workflowJobs()) {
    if (!j.guarded.length) continue;
    assert.deepEqual(j.guarded, j.invoked, `${j.file} (${j.job}) guards a different path than it runs`);
  }
});

// The script arrives through the sparse checkout. A sparse path that stops
// covering it makes it absent on every run, which the guard reads as a pass.
test('a sparse checkout covers every script its job names', () => {
  for (const j of workflowJobs()) {
    if (!j.sparse.length) continue;
    for (const p of new Set([...j.invoked, ...j.guarded])) {
      const covered = j.sparse.some((s) => p === s || p.startsWith(`${s}/`));
      assert.ok(covered, `${j.file} (${j.job}) runs ${p}, outside its sparse checkout (${j.sparse.join(', ')})`);
    }
  }
});
