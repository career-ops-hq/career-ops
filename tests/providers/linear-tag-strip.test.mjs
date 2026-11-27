// tests/providers/linear-tag-strip.test.mjs — no provider strips tags in
// quadratic time, and the linear strip removes exactly what the old one did.
//
// A generic tag strip such as `/<[^>]*>/g` or `/<[^>]+>/g` is quadratic on text
// with many `<` and no closing `>`: each opener scans to the end of the input
// before it fails, then the next opener does the same. A 50,000-character run
// of `<` takes over a second and a 1 MiB one minutes, during a scan, on text a
// posting supplies.
//
// The providers now match `/<[^>]*(>?)/g` (or `/<([^>]*)(>?)/g` for the `+`
// form) and replace a match only when it closed. A run that never closes is
// consumed once and handed back unchanged, so the later `<` in it are never
// tried again. Every other match is the one the old pattern made, so the output
// is the same on every input; only the time changes. Keeping `<` out of the tag
// body (`[^<>]`) is also linear, but it changes what a tag is when an attribute
// value holds a `<`, and it turns the strip-until-nothing-changes loops in
// jobbankca.mjs and personio.mjs quadratic on nested `<a<a…>>` instead.
//
// This guard keeps the quadratic shape out of every provider, checks the two
// forms against the patterns they replace on every short string, and times the
// strippers on the inputs that are quadratic for one shape or the other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHnComment, replaceAnchorsWithHref } from '../../providers/hackernews.mjs';
import { visibleText, replaceScriptStyleBlocks } from '../../providers/_html-to-text.mjs';
import { stripHtml as agenticStripHtml } from '../../providers/agentic-jobs.mjs';
import { parseWorkableWidget } from '../../providers/workable.mjs';
import { parsePersonioHtml } from '../../providers/personio.mjs';
import { parseJobBankFeed } from '../../providers/jobbankca.mjs';
import { parseSearchPage } from '../../providers/themuse.mjs';

const PROVIDERS = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'providers');

/** Source with block and line comments blanked, so prose about the pattern is not flagged. */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (line.trimStart().startsWith('//') ? '' : line))
    .join('\n');
}

test('no provider strips tags with the quadratic <[^>]*> or <[^>]+> shape', () => {
  const offenders = [];
  for (const name of readdirSync(PROVIDERS).filter((f) => f.endsWith('.mjs')).sort()) {
    const lines = code(readFileSync(join(PROVIDERS, name), 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (/<\[\^>\][*+]>/.test(line)) offenders.push(`providers/${name}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(offenders, [],
    `replace /<[^>]*(>?)/g with (tag, close) => (close ? r : tag), so an unclosed "<" cannot make the strip quadratic:\n${offenders.join('\n')}`);
});

test('the linear forms replace exactly what <[^>]*> and <[^>]+> replaced, on every string up to 6 characters', () => {
  const alphabet = ['<', '>', 'a', ' ', '"', '/'];
  let strings = [''];
  const all = [];
  for (let len = 1; len <= 6; len++) {
    strings = strings.flatMap((s) => alphabet.map((c) => s + c));
    all.push(...strings);
  }
  for (const r of [' ', '']) {
    for (const s of all) {
      const star = s.replace(/<[^>]*(>?)/g, (tag, close) => (close ? r : tag));
      if (star !== s.replace(/<[^>]*>/g, r)) assert.fail(`<[^>]*> form differs on ${JSON.stringify(s)}`);
      const plus = s.replace(/<([^>]*)(>?)/g, (tag, body, close) => (close && body ? r : tag));
      if (plus !== s.replace(/<[^>]+>/g, r)) assert.fail(`<[^>]+> form differs on ${JSON.stringify(s)}`);
    }
  }
});

function assertFast(label, fn) {
  // Quadratic, each of these took from one to twenty seconds on a laptop; linear, milliseconds.
  // A quadratic strip is slow on every run, while a loaded runner stalls one run
  // at random, so the fastest of three runs is what the bound is checked against.
  let best = Infinity;
  for (let i = 0; i < 3 && best >= 1500; i++) {
    const started = performance.now();
    fn();
    best = Math.min(best, performance.now() - started);
  }
  assert.ok(best < 1500, `${label} took ${Math.round(best)} ms`);
}

test('a Hacker News comment or a fragment of unclosed "<" or "<!--" is stripped in linear time', () => {
  assertFast('parseHnComment on 100,000 unclosed "<"', () => parseHnComment('<'.repeat(100_000)));
  assertFast('visibleText on 100,000 unclosed "<"', () => visibleText('<'.repeat(100_000)));
  assertFast('visibleText on 100,000 unclosed "<!--"', () => visibleText('<!--'.repeat(100_000)));
  assertFast('themuse on 100,000 unclosed "<!--"', () => parseSearchPage(`<h1 class="sr-count">${'<!--'.repeat(100_000)}12 jobs</h1>`));
});

const N = 50_000;
const personioPage = (title) => `<a class="job-box" href="/job/1"><h3>${title}</h3></a>`;
const jobBankFeed = (employer) => '<feed><entry><title>Platform Engineer</title>'
  + '<link href="https://www.jobbank.gc.ca/jobsearch/jobposting/12345"/>'
  + `<summary type="html">&lt;strong&gt;Employer:&lt;/strong&gt; ${employer}&lt;br&gt;`
  + '&lt;strong&gt;Location:&lt;/strong&gt; Ottawa (ON)&lt;br&gt;</summary></entry></feed>';

test('the strip-until-nothing-changes loops stay linear on unclosed and on nested "<"', () => {
  assertFast('personio on unclosed "<a"', () => parsePersonioHtml(personioPage(`Engineer ${'<a'.repeat(N)}`), 'Acme', 'acme.jobs.personio.de'));
  assertFast('personio on nested "<a…>"', () => parsePersonioHtml(personioPage(`Engineer ${'<a'.repeat(N)}${'>'.repeat(N)}`), 'Acme', 'acme.jobs.personio.de'));
  assertFast('jobbankca on unclosed "<a"', () => parseJobBankFeed(jobBankFeed(`Acme ${'&lt;a'.repeat(N)}`)));
  assertFast('jobbankca on nested "<a…>"', () => parseJobBankFeed(jobBankFeed(`Acme ${'&lt;a'.repeat(N)}${'&gt;'.repeat(N)}`)));
});

// A deterministic string generator: the same strings on every run.
function tokenStrings(tokens, count, maxTokens, seed) {
  let state = seed;
  const rnd = (n) => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state % n; };
  const out = [];
  for (let i = 0; i < count; i++) {
    let s = '';
    const len = 1 + rnd(maxTokens);
    for (let j = 0; j < len; j++) s += tokens[rnd(tokens.length)];
    out.push(s);
  }
  return out;
}

// The passes CodeRabbit flagged next to the generic strips: agentic-jobs' and
// workable's script/style removal and Hacker News' anchor and block-tag passes.
// Each is replaced by a linear form, checked here against the pattern it replaces.
test('the script/style block strip matches the regex it replaces', () => {
  const tokens = ['<script', '<script>', '<SCRIPT', '<style', '<style>', '<Style a="x>y">', '</script>', '</SCRIPT>',
    '</style>', '</Style>', '</script >', '<scripts>', '<styles', 'İ', 'ſ', 'a', ' ', '>', '<', '/', '"', '\n'];
  for (const wordBoundary of [false, true]) {
    const re = new RegExp(`<(script|style)${wordBoundary ? '\\b' : ''}[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi');
    for (const s of tokenStrings(tokens, 20_000, 12, wordBoundary ? 7 : 8)) {
      const got = replaceScriptStyleBlocks(s, ' ', { wordBoundary });
      if (got !== s.replace(re, ' ')) assert.fail(`wordBoundary=${wordBoundary} differs on ${JSON.stringify(s)}`);
    }
  }
});

test('the Hacker News anchor pass matches the regex it replaces', () => {
  const re = /<a\s[^>]*href="([^"]+)"[^>]*>.*?<\/a>/gi;
  const tokens = ['<a ', '<A\t', '<a\n', '<a\u00a0', 'href="', 'HREF="', 'x', 'y', '"', '>', '</a>', '</A>', '\n', '\r',
    '\u2028', ' ', '<a href="u">', '<', 'a', '/', '='];
  for (const s of tokenStrings(tokens, 20_000, 14, 11)) {
    if (replaceAnchorsWithHref(s) !== s.replace(re, (_, href) => href)) assert.fail(`differs on ${JSON.stringify(s)}`);
  }
});

test('the Hacker News block-tag pass matches the regex it replaces', () => {
  const tokens = ['<p', '<P ', '</p', '<br', '<pre', '<div', '</li', '<h2', '<h7', '<hr', '>', 'x', ' ', '/', '<'];
  for (const s of tokenStrings(tokens, 20_000, 10, 13)) {
    const got = s.replace(/<\/?(?:p|br|div|li|h[1-6])\b[^>]*(>?)/gi, (tag, close) => (close ? '\n' : tag));
    if (got !== s.replace(/<\/?(?:p|br|div|li|h[1-6])\b[^>]*>/gi, '\n')) assert.fail(`differs on ${JSON.stringify(s)}`);
  }
});

test('those passes stay linear on unclosed openers', () => {
  const workable = (description) => parseWorkableWidget({ jobs: [{ title: 'Engineer', shortlink: 'https://apply.workable.com/j/ABC123', description }] }, 'Acme', 'acme');
  assertFast('agentic-jobs on 100,000 "<script" with no ">"', () => agenticStripHtml('<script'.repeat(100_000)));
  assertFast('agentic-jobs on 100,000 "<script>" with no closer', () => agenticStripHtml('<script>'.repeat(100_000)));
  assertFast('workable on 100,000 "<script " with no ">"', () => workable('<script '.repeat(100_000)));
  assertFast('workable on 100,000 "<style>" with no closer', () => workable('<style>'.repeat(100_000)));
  assertFast('parseHnComment on 100,000 "<a " with no ">"', () => parseHnComment('<a '.repeat(100_000)));
  assertFast('parseHnComment on 100,000 "<p " with no ">"', () => parseHnComment(`x\n${'<p '.repeat(100_000)}`));
  assertFast('parseHnComment on 100,000 "<a href" with no "</a>"', () => parseHnComment('<a href="x">'.repeat(100_000)));
});

test('well-formed markup strips as before', () => {
  assert.deepEqual(
    parseHnComment('<p>Acme | Platform Engineer | Remote | <a href="https://acme.example/jobs/1">apply</a></p><p>We build <b>reliable</b> software &amp; tools.</p>'),
    { title: 'Acme | Platform Engineer | Remote |', url: 'https://acme.example/jobs/1', company: 'Acme', location: 'Remote' },
  );
  assert.equal(visibleText('<span class="t">Senior <b>Data</b> Engineer</span><!-- x -->'), 'Senior Data Engineer');
  // A `<` in an attribute value is inside the tag, as it was for <[^>]+>.
  assert.equal(visibleText('<a title="x<y">text</a>'), 'text');
  assert.deepEqual(parsePersonioHtml(personioPage('Data <b<i>x> Engineer'), 'Acme', 'acme.jobs.personio.de').map((j) => j.title), ['Data x> Engineer']);
  assert.deepEqual(parseJobBankFeed(jobBankFeed('Acme &lt;b&lt;i&gt;x&gt; Ltd')).map((j) => j.company), ['Acme x Ltd']);
  // A complete comment is removed and an unclosed one kept, as the lazy regex did.
  assert.equal(parseSearchPage('<h1 class="sr-count"><!-- 99 -->56 jobs</h1>').total, 56);
  assert.equal(parseSearchPage('<h1 class="sr-count"><!-- 78 jobs</h1>').total, 78);
});
