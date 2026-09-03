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

  if (DESCRIPTION_CAP === 4000) pass('DESCRIPTION_CAP is 4000 (greenhouse/alibaba precedent)');
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
} catch (e) {
  fail(`_html-to-text tests crashed: ${e.message}`);
}
