// tests/providers/_html-to-text.test.mjs — shared description pipeline.
// _html-to-text.mjs is the extracted form of greenhouse's contentToText
// (#3175 phase 2): providers whose payloads embed HTML bodies must all strip
// through this one pipeline so a divergent private copy cannot grow the way
// entity decoders once did.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nShared — _html-to-text');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/_html-to-text.mjs')).href);
  const { htmlToText, DESCRIPTION_CAP } = mod;

  if (DESCRIPTION_CAP === 4000) pass('DESCRIPTION_CAP is 4000 (alibaba precedent)');
  else fail(`DESCRIPTION_CAP = ${JSON.stringify(DESCRIPTION_CAP)}, expected 4000`);

  // Non-string and empty inputs degrade to "" — never a thrown error.
  if (htmlToText(null) === '' && htmlToText(undefined) === '' && htmlToText(42) === '' && htmlToText('') === '') {
    pass('htmlToText() returns "" for missing / non-string / empty input');
  } else {
    fail('htmlToText() should return "" for non-string and empty input');
  }

  if (htmlToText('Already plain text') === 'Already plain text') {
    pass('htmlToText() passes plain text through unchanged');
  } else {
    fail(`plain passthrough = ${JSON.stringify(htmlToText('Already plain text'))}`);
  }

  if (htmlToText('<p>Hello <b>world</b></p>') === 'Hello world') {
    pass('htmlToText() strips tags');
  } else {
    fail(`tag stripping = ${JSON.stringify(htmlToText('<p>Hello <b>world</b></p>'))}`);
  }

  const quotedAngles = htmlToText(
    `<p>Requires 5&amp;gt;3 years <a title="x > y" data-note='a > b' href="z">apply here</a> today</p>`
  );
  if (quotedAngles === 'Requires 5>3 years apply here today') {
    pass('htmlToText() keeps quoted angle brackets inside tag attributes');
  } else {
    fail(`quoted angle attribute = ${JSON.stringify(quotedAngles)}`);
  }

  const encodedQuotes = htmlToText(
    `<a title="say &quot;hello &#34;there > world&#x22;&quot;" data-note='it&apos;s &#39;still > safe&#x27;&apos;'>apply</a>`
  );
  if (encodedQuotes === 'apply') {
    pass('htmlToText() keeps encoded quotes from becoming attribute delimiters');
  } else {
    fail(`encoded quote attribute = ${JSON.stringify(encodedQuotes)}`);
  }

  if (htmlToText('a <> b') === 'a <> b') {
    pass('htmlToText() preserves empty angle brackets in plain text');
  } else {
    fail(`empty angle brackets = ${JSON.stringify(htmlToText('a <> b'))}`);
  }

  if (htmlToText('<style>.x{color:red}</style><script>evil()</script><p>Body</p>') === 'Body') {
    pass("htmlToText() drops <script>/<style> WITH their contents");
  } else {
    fail(`media strip = ${JSON.stringify(htmlToText('<style>.x{color:red}</style><script>evil()</script><p>Body</p>'))}`);
  }

  const quotedMedia = htmlToText(
    `<script data-note="x > </script>">evil()</script><style data-note='x > </style>'>bad{}</style><p>Body</p>`
  );
  if (quotedMedia === 'Body') {
    pass('htmlToText() strips media with quoted angle brackets in attributes');
  } else {
    fail(`quoted media attribute = ${JSON.stringify(quotedMedia)}`);
  }

  // The double-decode case that motivated greenhouse's pipeline: entity-
  // escaped markup first reveals real tags, and only after those are gone
  // can the text-level entities decode. A single-pass decoder leaves "&amp;"
  // behind or turns attribute soup into noise.
  const doubled = htmlToText('&lt;p&gt;C++ &amp;amp; Rust&amp;rsquo;s runtime&lt;/p&gt;');
  if (doubled === "C++ & Rust\u2019s runtime") {
    pass('htmlToText() double-decodes entity-escaped markup to readable text');
  } else {
    fail(`double decode = ${JSON.stringify(doubled)}`);
  }

  const doubleEncodedMarkup = htmlToText(
    '&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;After &#252; &quot;quoted&quot;'
  );
  if (doubleEncodedMarkup === 'After ü "quoted"') {
    pass('htmlToText() keeps double-encoded active markup inert while decoding text entities');
  } else {
    fail(`double-encoded active markup = ${JSON.stringify(doubleEncodedMarkup)}`);
  }

  const incompleteEncodedMarkup = htmlToText(
    'Before &amp;lt;script data-x=alert(1) After'
  );
  if (incompleteEncodedMarkup === 'Before script data-x=alert(1) After') {
    pass('htmlToText() neutralizes incomplete double-encoded tag openers without dropping text');
  } else {
    fail(`incomplete double-encoded markup = ${JSON.stringify(incompleteEncodedMarkup)}`);
  }

  // A comparison in prose is text, not a tag. Decoded, `&lt;10` is `<10`, and
  // a tag matcher that accepted any `<` read it as a tag opener and deleted
  // everything up to the next `>`: here `&gt;150k`, a paragraph later, with
  // the sponsorship sentence between them. Both the single-escaped shape and
  // greenhouse's double-escaped one, where the third strip did the damage.
  const proseAngles = htmlToText(
    '<p>Requirements: experience with teams of &lt;10 engineers.</p>'
    + '<p>Visa sponsorship is not available for this role. Salary &gt;150k.</p>'
  );
  if (proseAngles === 'Requirements: experience with teams of <10 engineers. Visa sponsorship is not available for this role. Salary >150k.') {
    pass('htmlToText() keeps a decoded prose `<` and the text after it');
  } else {
    fail(`prose angle brackets = ${JSON.stringify(proseAngles)}`);
  }

  const doubleEscapedProse = htmlToText(
    '&lt;p&gt;Teams of &amp;lt;10 engineers.&lt;/p&gt;&lt;p&gt;No visa sponsorship. Salary &amp;gt;150k.&lt;/p&gt;'
  );
  if (doubleEscapedProse === 'Teams of <10 engineers. No visa sponsorship. Salary >150k.') {
    pass('htmlToText() keeps a double-escaped prose `<` and the text after it');
  } else {
    fail(`double-escaped prose angle brackets = ${JSON.stringify(doubleEscapedProse)}`);
  }

  // The other side of that line: markup that does open like a tag is still
  // stripped after every decode, attributes and all.
  const encodedHandler = htmlToText('&lt;img src=x onerror=alert(1)&gt; text');
  if (encodedHandler === 'text') {
    pass('htmlToText() still strips decoded markup that opens with a tag name');
  } else {
    fail(`decoded img tag = ${JSON.stringify(encodedHandler)}`);
  }

  // A keyword split across a tag boundary must survive stripping, since
  // visa/content filters substring-match over the result.
  const split = htmlToText('<p>No sponsorship is <span>provided</span> for this role</p>');
  if (split === 'No sponsorship is provided for this role') {
    pass('htmlToText() re-joins text split across tag boundaries');
  } else {
    fail(`split keyword = ${JSON.stringify(split)}`);
  }

  if (htmlToText('<p>a</p>\t\n <p>b</p>') === 'a b') {
    pass('htmlToText() collapses whitespace runs to single spaces and trims');
  } else {
    fail(`collapse = ${JSON.stringify(htmlToText('<p>a</p>\t\n <p>b</p>'))}`);
  }

  const longBody = `<p>${'word '.repeat(1200)}</p>`;
  // The cap slices after trim+collapse, so the cut can land mid-pattern
  // (greenhouse behaves identically) — assert only the budget, not the tail.
  const capped = htmlToText(longBody);
  if (capped.length === 4000 && capped.startsWith('word')) {
    pass('htmlToText() caps output at DESCRIPTION_CAP characters');
  } else {
    fail(`cap: length=${capped.length}, tail=${JSON.stringify(capped.slice(-10))}`);
  }

  const uncapped = htmlToText(longBody, { cap: Infinity });
  if (uncapped.length === 'word '.repeat(1200).trim().length) {
    pass('htmlToText(content, { cap: Infinity }) returns the whole text');
  } else {
    fail(`cap Infinity: length=${uncapped.length}`);
  }

  // Linear-time guard: text with many `<` openers and no closing `>` must not
  // backtrack quadratically (10k openers took ~7 s before the tag body class
  // excluded `<`). The bound is generous; the linear form takes a few ms.
  for (const [label, input] of [
    ['<script openers', '<script '.repeat(10000)],
    ['<a openers', '<a '.repeat(20000)],
    ['<p class="x" openers', '<p class="x" '.repeat(5000)],
  ]) {
    const started = performance.now();
    const out = htmlToText(input);
    const ms = performance.now() - started;
    if (ms < 500) pass(`htmlToText() stays linear on unclosed ${label} (${Math.round(ms)} ms)`);
    else fail(`htmlToText() took ${Math.round(ms)} ms on unclosed ${label}, expected < 500`);
    if (!out.includes('<')) pass(`htmlToText() leaves no '<' from unclosed ${label}`);
    else fail(`unclosed ${label} left a '<' in the output`);
  }

  // The tighter tag body must not change how well-formed markup converts.
  const wellFormed = htmlToText(
    `<p class="lead" title='a > b'>Hi <!-- note --> there</p><script type="text/javascript">if (a < b && c > d) {}</script><style>p > a { color: red }</style><br/>Done`
  );
  if (wellFormed === 'Hi there Done') pass('htmlToText() still strips quoted-attribute tags, comments, script and style blocks');
  else fail(`well-formed markup = ${JSON.stringify(wellFormed)}`);

  // A comment body may hold an unquoted `<`; the whole comment still goes.
  const commentWithLt = htmlToText('<!-- salary < 100000 -->Body <p>a</p><!-- <b>x</b> -->end');
  if (commentWithLt === 'Body a end') pass('htmlToText() strips comments that contain `<` or tags');
  else fail(`comment with '<' = ${JSON.stringify(commentWithLt)}`);
  const unclosedComments = '<!-- '.repeat(20000);
  const commentStarted = performance.now();
  htmlToText(unclosedComments);
  const commentMs = performance.now() - commentStarted;
  if (commentMs < 500) pass(`htmlToText() stays linear on unterminated comment openers (${Math.round(commentMs)} ms)`);
  else fail(`htmlToText() took ${Math.round(commentMs)} ms on unterminated comment openers, expected < 500`);

  // A complete <script> or <style> opener with no closer is the other slow
  // shape: a lazy `[\s\S]*?<\/script>` body scanned the rest of the input from
  // every opener (40,000 `<script>` openers took about a second). One closer
  // of the other kind at the end must not bring it back.
  for (const [label, input] of [
    ['<script> openers', '<script>'.repeat(40000)],
    ['<style> openers', '<style>'.repeat(40000)],
    ['<script> openers and one </style>', `${'<script>'.repeat(40000)}</style>`],
  ]) {
    const started = performance.now();
    htmlToText(input, { cap: Infinity });
    const ms = performance.now() - started;
    if (ms < 500) pass(`htmlToText() stays linear on ${label} with no closer of their kind (${Math.round(ms)} ms)`);
    else fail(`htmlToText() took ${Math.round(ms)} ms on ${label}, expected < 500`);
  }

  // The blocks removed are the ones the lazy regex removed: an opener up to the
  // first closer of its own kind, case-insensitive, with whitespace before `>`,
  // also when an opener's quoted attribute holds another opener.
  for (const [input, expected] of [
    ['a<SCRIPT>x</script >b<style>y</STYLE\n>c', 'a b c'],
    ['a<script>x</style>y</script>b', 'a b'],
    ['a<script>x and no closer', 'a x and no closer'],
    ['a<script x="<script>">y</script>b', 'a b'],
    ['a<style>p{}</style><script>z</script\t>b', 'a b'],
    // Lower-casing turns `İ` into two characters, so closer offsets found in
    // the lower-cased text pointed one character too far into the original.
    ['<script>İ</script>Body', 'Body'],
    ['<p>İstanbul</p><style>x</style>After', 'İstanbul After'],
  ]) {
    const out = htmlToText(input, { cap: Infinity });
    if (out === expected) pass(`htmlToText() strips script/style blocks as before: ${JSON.stringify(input)}`);
    else fail(`script/style block ${JSON.stringify(input)} = ${JSON.stringify(out)}, expected ${JSON.stringify(expected)}`);
  }

  // Text after an unclosed opener survives; the earlier real tag is still stripped.
  const afterUnclosed = htmlToText('<b>ok</b> <i never closed, then plain text');
  if (afterUnclosed === 'ok i never closed, then plain text') pass('htmlToText() keeps text after an unclosed tag opener');
  else fail(`unclosed opener = ${JSON.stringify(afterUnclosed)}`);
} catch (e) {
  fail(`_html-to-text tests crashed: ${e.message}`);
}
