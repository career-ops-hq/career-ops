// @ts-check
// Shared HTML → plain-text pipeline for providers whose payloads embed
// description markup. Greenhouse's contentToText was the first instance;
// this is the extracted form so later providers cannot grow a divergent
// copy — same rationale that produced _html-entities when entity decoders
// drifted across four files (#1555/#1639/#2623).
import { decodeEntities } from './_html-entities.mjs';

// Capped like greenhouse/alibaba full-text JDs: a 10 KB/posting body is
// normal on these boards, and scan payloads must stay sane.
export const DESCRIPTION_CAP = 4000;

// A tag ends at an unquoted `>`. Attribute values may contain angle brackets,
// so the common `<[^>]+>` shortcut can stop midway through a tag and expose
// the remaining attributes as description text. Requiring content between the
// brackets preserves a literal `<>`, as the old matcher did.
//
// A tag also has to START like one: `<` followed by a letter, `/`, `!` or `?`,
// the only openers an HTML tokenizer reads as markup. Without that, every
// strip after a decode read prose as a tag: a JD saying `teams of &lt;10
// engineers` decoded to `<10 engineers`, and everything from there to the
// next `>` (a `&gt;150k` paragraphs later) was deleted, sponsorship sentence
// included. `<script`, `</p`, `<!--` still match, so double-encoded active
// markup stays inert.
//
// The unquoted part of a tag body excludes `<` as well as `>` and quotes. An
// unquoted `<` never occurs inside a real tag, and allowing it lets a text
// with many openers and no closing `>` (`'<script '.repeat(10000)`) backtrack
// quadratically: every opener rescans the whole rest of the input, which
// takes seconds on a full JD body.
export const HTML_TAG_RE = /<(?=[a-z/!?])(?:[^<>"']|"[^"]*"|'[^']*')+>/gi;
// The opener of a <script> or <style> block. Its body, up to the closer, is
// found with indexOf in stripMediaBlocks() below, not with a lazy regex.
const HTML_MEDIA_OPEN_RE = /<(script|style)\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;

/**
 * Remove complete HTML comments (`<!-- ... -->`) in one linear pass.
 *
 * A comment body may hold an unquoted `<` (`<!-- salary < 100000 -->`), which
 * the tag body class above rejects, so comments are removed here first and
 * never reach HTML_TAG_RE. indexOf, not a lazy regex: `<!--[\s\S]*?-->` is
 * quadratic again on text with many `<!--` and no `-->`. An unterminated
 * `<!--` is left in place for the tag matcher and the final opener cleanup.
 *
 * Exported for browser-extract.mjs, which strips with HTML_TAG_RE too.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripHtmlComments(text) {
  let out = '';
  let from = 0;
  for (;;) {
    const start = text.indexOf('<!--', from);
    if (start < 0) break;
    const end = text.indexOf('-->', start + 4);
    if (end < 0) break;
    out += `${text.slice(from, start)} `;
    from = end + 3;
  }
  return from === 0 ? text : out + text.slice(from);
}

/**
 * Remove complete <script> and <style> blocks without a lazy regex.
 *
 * A lazy regex (`<(script|style)\b…>[\s\S]*?<\/\1\s*>`) is quadratic on text
 * with many openers and no closer, the same way `<!--[\s\S]*?-->` is above:
 * every opener scans the rest of the input for its closer and fails. 40,000
 * `<script>` openers took about a second. The blocks removed are the ones that
 * regex removed: an opener up to the first closer of its own kind at or after
 * the opener's end, case-insensitive, with whitespace allowed before the
 * closing `>`. The closers of each kind are listed once, and each opener looks
 * its closer up in that list, so the cost grows with the text, not with the
 * number of openers times the text.
 *
 * @param {string} text
 * @returns {string}
 */
function stripMediaBlocks(text) {
  const closers = { script: closerSpans(text, 'script'), style: closerSpans(text, 'style') };
  const opener = new RegExp(HTML_MEDIA_OPEN_RE.source, 'gi');
  let out = '';
  let from = 0;
  for (let m = opener.exec(text); m; m = opener.exec(text)) {
    const close = firstAtOrAfter(closers[m[1].toLowerCase()], m.index + m[0].length);
    if (!close) {
      // No block opens here; try the next position, as the regex would.
      opener.lastIndex = m.index + 1;
      continue;
    }
    out += `${text.slice(from, m.index)} `;
    from = close.end;
    opener.lastIndex = close.end;
  }
  return from === 0 ? text : out + text.slice(from);
}

/**
 * Every `</kind\s*>` in the text, in order, as start and end offsets.
 *
 * Matched case-insensitively on the text itself, as the lazy regex matched
 * its closer. Not on text.toLowerCase(): lower-casing can change the length
 * (`İ` becomes `i` and a combining dot), and every offset after it would then
 * point one character too far into the original text.
 *
 * @param {string} text
 * @param {string} kind - `script` or `style`
 * @returns {Array<{start: number, end: number}>}
 */
function closerSpans(text, kind) {
  const spans = [];
  for (const m of text.matchAll(new RegExp(`</${kind}\\s*>`, 'gi'))) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

/**
 * The first span starting at or after `pos`, by binary search.
 * @param {Array<{start: number, end: number}>} spans
 * @param {number} pos
 */
function firstAtOrAfter(spans, pos) {
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].start < pos) lo = mid + 1;
    else hi = mid;
  }
  return spans[lo];
}

/**
 * `text.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, replacement)` (or, with
 * `wordBoundary`, the same pattern with `\b` after the name) in linear time,
 * with the same result on every input. Some providers strip their blocks with
 * exactly these rules, which are not stripMediaBlocks()'s: the opener ends at
 * its first `>` whatever the quotes say, and the closer allows no whitespace.
 *
 * At an opener the pattern reads up to the first `>` after the name, then up
 * to the first closer of the same kind (any case); if either is missing it
 * moves on one character. Each part has one way to match, so the outcome at an
 * opener is the next `>` and a closer lookup. The regex rescans the rest of
 * the text from every opener that has no `>` or no closer, which was
 * quadratic; here no `>` after an opener means none after any later one, and
 * closers are looked up by binary search.
 *
 * @param {string} text
 * @param {string} replacement
 * @param {{ wordBoundary?: boolean }} [options]
 * @returns {string}
 */
export function replaceScriptStyleBlocks(text, replacement, { wordBoundary = false } = {}) {
  const closers = { script: exactCloserSpans(text, 'script'), style: exactCloserSpans(text, 'style') };
  const opener = new RegExp(`<(script|style)${wordBoundary ? '\\b' : ''}`, 'gi');
  let out = '';
  let from = 0;
  // The first `>` at or after the last opener's name. Openers only move
  // forward, so each stretch of text is searched for `>` once.
  let gt = -2;
  for (let m = opener.exec(text); m; m = opener.exec(text)) {
    const afterName = m.index + m[0].length;
    if (gt === -2 || (gt !== -1 && gt < afterName)) gt = text.indexOf('>', afterName);
    if (gt === -1) break;
    const close = firstAtOrAfter(closers[m[1].toLowerCase()], gt + 1);
    if (!close) {
      opener.lastIndex = m.index + 1;
      continue;
    }
    out += text.slice(from, m.index) + replacement;
    from = close.end;
    opener.lastIndex = close.end;
  }
  return from === 0 ? text : out + text.slice(from);
}

/**
 * Every `</kind>` (any case, no whitespace) in the text, as start and end offsets.
 * @param {string} text
 * @param {string} kind - `script` or `style`
 * @returns {Array<{start: number, end: number}>}
 */
function exactCloserSpans(text, kind) {
  const spans = [];
  for (const m of text.matchAll(new RegExp(`</${kind}>`, 'gi'))) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

/** @param {string} content */
function stripMarkup(content) {
  return stripMediaBlocks(stripHtmlComments(content)).replace(HTML_TAG_RE, ' ');
}

/**
 * Entity-decoded markup → stripped plain text.
 *
 * Double-decode: the payload often carries entity-escaped tags (`&lt;p&gt;`),
 * so the first pass reveals real tags, and text-level entities (`&amp;`,
 * `&#39;`) only become decodable once those tags are gone. Plain text is what
 * the description-consuming filters match against — substring matching over
 * raw HTML misses keywords split by a tag and pads matches into attribute
 * soup.
 *
 * Exported for tests.
 *
 * @param {unknown} content
 * @param {{cap?: number}} [options] - `cap`: maximum length of the result,
 *   DESCRIPTION_CAP by default. A provider that has always passed a JD
 *   through whole passes `Infinity`.
 * @returns {string}
 */
export function htmlToText(content, { cap = DESCRIPTION_CAP } = {}) {
  if (typeof content !== 'string' || !content) return '';
  // Strip literal markup before decoding: quote entities inside a quoted
  // attribute are data, and decoding them first would turn them into false
  // delimiters. Each decode is followed by a strip so double-encoded active
  // markup cannot become the final plain-text output. A final incomplete tag
  // opener has no closing `>` for stripMarkup() to consume, so drop only its
  // leading angle bracket; this keeps the text visible while making it inert.
  const decoded = decodeEntities(stripMarkup(content));
  const decodedTwice = decodeEntities(stripMarkup(decoded));
  return stripMarkup(decodedTwice)
    .replace(/<(?=\/?[a-z!?])/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, cap);
}

/**
 * Collapse a markup fragment to its visible text.
 * Comments are stripped FIRST: the anchor bodies carry `<!-- d ico postulez -->`
 * between the title and a spacer image, and a naive tag strip would leave the
 * comment body sitting inside the title.
 * @param {string} fragment
 * @returns {string}
 */
export function visibleText(fragment) {
  // stripHtmlComments, not /<!--[\s\S]*?-->/: the lazy regex rescans the rest
  // of the text from every `<!--` that has no `-->`. A tag that never closes
  // is consumed once and kept as it was, which is what /<[^>]+>/ left behind,
  // without rescanning the rest of the text from every later `<`.
  return decodeEntities(
    stripHtmlComments(String(fragment ?? ''))
      .replace(/<([^>]*)(>?)/g, (tag, body, close) => (close && body ? ' ' : tag)),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

