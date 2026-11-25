/**
 * jd-parse.mjs: pure HTML-to-JD parsers used by fetch-jd.mjs, the one
 * JD reader. No I/O: every function takes a string.
 */

import { decodeEntities } from '../providers/_html-entities.mjs';

/** Lowercase A-Z only. String#toLowerCase can change the length (e.g. U+0130), which would misalign indexOf offsets with the source. */
export const asciiLower = (s) => String(s).replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

// An entity-escaped tag: `&lt;p&gt;`, `&lt;/p&gt;`, `&lt;br /&gt;`, `&lt;a href=&quot;x&quot;&gt;`.
// Known tags only, and attributes must be name=value pairs (see htmlToText).
const ESCAPED_TAG_NAMES = 'p|br|hr|div|span|b|i|u|em|strong|ul|ol|li|h[1-6]|a|table|thead|tbody|tr|td|th|section|article|blockquote|font|sup|sub|pre|code|small|big';
// `&amp;` is the one entity that legitimately sits inside a quoted value (a URL's
// query string), so it is allowed there while any other `&` keeps the prose guard.
const ESCAPED_ATTR = String.raw`\s+[a-z_:][\w:.-]*=(?:"(?:[^"<>&]|&amp;)*"|'(?:[^'<>&]|&amp;)*'|&quot;(?:[^<>&]|&amp;)*?&quot;|[^\s"'<>&=]+)`;
const ESCAPED_TAG_RE = new RegExp(String.raw`&lt;(/?(?:${ESCAPED_TAG_NAMES}))((?:${ESCAPED_ATTR})*)\s*/?&gt;`, 'gi');

/**
 * Markup -> the text a reader would see, keeping block structure as newlines
 * and list items as `- ` bullets. The one HTML-to-text for every JD source: an
 * ATS payload's description, a JobPosting's description and a page's own body.
 * Pure; exported for fetch-jd.mjs and tests.
 *
 * Not providers/_html-to-text.mjs's htmlToText: that one is tuned for scan
 * payloads, hard-caps at 4000 chars and flattens every newline. A JD read for
 * evaluation wants its full body with paragraph and bullet breaks intact.
 */
export function htmlToText(html) {
  if (typeof html !== 'string' || !html) return '';
  // Some boards (Phenom, observed on careers.roberthalf.com) ship the JobPosting
  // description as entity-ESCAPED markup (`&lt;div&gt;&lt;p&gt;…`). The tag strip
  // below cannot see those as tags, and the entity pass then turns them back into
  // literal `<div><p>` in the JD. Unescape the tags, and ONLY the tags: a global
  // `&lt;`/`&gt;` replace would also decode prose like `latency &lt; 50 ms`, and
  // the strip would then eat the prose up to the next `>`. A tag qualifies when
  // it is a known HTML tag whose attributes are all name="value" pairs, so
  // `&lt;b and c&gt;` stays text.
  const markup = html.replace(
    ESCAPED_TAG_RE,
    (_m, name, attrs) => `<${name}${String(attrs).replace(/&quot;/gi, '"')}>`,
  );
  return decodeEntities(stripMarkup(markup), { bareNumeric: true, text: true })
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

export const wordCount = (t) => t.split(/\s+/).filter(Boolean).length;

// Closers that end a block, so they read as a line break. `li` is absent: its
// opener emits the break plus a bullet, and breaking on both ends double-spaces a list.
const BLOCK_END_TAG = /^\/(p|div|ul|ol|h[1-6]|tr|table|section|article|blockquote|header|footer|main)$/;
// Elements whose contents a reader never sees.
const HIDDEN_ELEMENTS = new Set(['script', 'style', 'noscript', 'template']);

/**
 * Remove `<script>`/`<style>` elements and every tag, in one forward pass.
 * Block-closing tags and `<br>` become line breaks so requirement lists do not
 * run together into one paragraph for the worker. Each step moves forward with
 * indexOf, so hostile input (many unclosed `<script`, or `<` with no `>`) stays
 * linear where the lazy-regex form rescanned the remainder per start.
 *
 * @param {string} markup
 * @param {{unclosedPayloadIsText?: boolean}} [options] - `unclosedPayloadIsText`:
 *   read the payload of a script/style element that never closes as text
 *   instead of discarding it. The default is the JD path's rule (that payload
 *   is not visible text); himalayas-posting asks for the other reading so its
 *   description-length check keeps the classification it had before.
 * @returns {string}
 */
export function stripMarkup(markup, { unclosedPayloadIsText = false } = {}) {
  const src = String(markup);
  const lower = asciiLower(src);
  const out = [];
  let i = 0;
  let noMoreGt = false;
  // A name whose closer does not occur anywhere ahead of the current position
  // never will, so one failed search retires it for the rest of the string.
  const noCloser = new Set();
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { out.push(src.slice(i)); break; }
    out.push(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      out.push(' ');
      if (end === -1) break;
      i = end + 3;
      continue;
    }
    let gt = noMoreGt ? -1 : src.indexOf('>', lt + 1);
    if (gt === -1) { noMoreGt = true; out.push(src.slice(lt)); break; }
    // A custom element such as `<style-guide>` opens with a known element's
    // name; keeping the hyphen in the class keeps it out of the branch below.
    const name = /^\/?[a-z][a-z0-9-]*|^br(?=[\s/])/.exec(lower.slice(lt + 1, lt + 12))?.[0] ?? '';
    if (HIDDEN_ELEMENTS.has(name)) {
      // A closer has to end the element's name where the name ends: the `>`
      // after `</scripture>` closes nothing, while `</SCRIPT >` does. Same line
      // _html-to-text.mjs draws with `\b` and `\s*>`, here without a regex so
      // the search stays linear on a description full of near-miss closers.
      const opener = `</${name}`;
      let close = -1;
      if (!noCloser.has(name)) {
        for (let at = lower.indexOf(opener, gt + 1); at !== -1; at = lower.indexOf(opener, at + 1)) {
          const after = lower[at + opener.length];
          if (after === '>' || after === '/' || after === ' ' || after === '\t'
              || after === '\n' || after === '\r' || after === '\f') { close = at; break; }
        }
        if (close === -1) noCloser.add(name);
      }
      const closeGt = close === -1 ? -1 : src.indexOf('>', close);
      if (closeGt === -1) {
        // Unclosed: by default the rest is script/style payload, not text.
        if (!unclosedPayloadIsText) { out.push(' '); break; }
        // A closer with no `>` after it will never close anything either, and
        // nothing later can: retire the name so the next opener does not
        // rescan to the end for the same malformed closer.
        noCloser.add(name);
        // The opener is markup; what follows it is the caller's call to read.
        i = gt + 1;
        continue;
      }
      out.push(' ');
      i = closeGt + 1;
      continue;
    }
    if (/["']/.test(src.slice(lt, gt))) {
      // A `>` inside a quoted attribute value does not end the tag.
      const end = scriptTagEnd(src, lt + 1);
      if (end > gt) gt = end;
    }
    out.push(name === 'li' ? '\n- ' : name === 'br' || BLOCK_END_TAG.test(name) ? '\n' : ' ');
    i = gt + 1;
  }
  return out.join('');
}

/**
 * End of an opening tag, skipping any `>` inside a quoted attribute value. Bounded
 * to 4 KB so an unmatched quote cannot make every later `<script` rescan the page.
 */
function scriptTagEnd(src, start) {
  let quote = '';
  const stop = Math.min(src.length, start + 4096);
  for (let i = start; i < stop; i += 1) {
    const ch = src[i];
    if (quote) { if (ch === quote) quote = ''; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
  }
  return -1;
}

/**
 * Contents of every `<script type="application/ld+json">` block, found with
 * forward indexOf scans only. A lazy `[^>]*`/`[\s\S]*?` regex rescans to the end
 * of the page for each unclosed `<script`, which is quadratic on hostile input.
 *
 * @param {string} html
 * @returns {string[]}
 */
export function ldJsonBlocks(html) {
  const src = String(html ?? '');
  const lower = asciiLower(src);
  const blocks = [];
  let i = 0;
  let nextGt = -2;
  for (;;) {
    const start = lower.indexOf('<script', i);
    if (start === -1) break;
    if (nextGt < start) nextGt = src.indexOf('>', start);
    if (nextGt === -1) break; // no later '>' exists
    // A tag whose first '>' is far away is not worth a quote-aware scan; this
    // also keeps a run of unclosed `<script` starts from rescanning the page.
    const gt = nextGt - start > 4096 ? -1 : scriptTagEnd(src, start);
    if (gt === -1) { i = start + 7; continue; }
    const tag = lower.slice(start, gt);
    i = gt + 1;
    if (!/type\s*=\s*["']application\/ld\+json["']/.test(tag)) continue;
    const close = lower.indexOf('</script', i);
    if (close === -1) break;
    blocks.push(src.slice(i, close));
    const closeGt = src.indexOf('>', close);
    if (closeGt === -1) break;
    i = closeGt + 1;
  }
  return blocks;
}

/** Assemble a JD document from the structured fields an ATS exposes. */
function composeJd({ title, company, location, description, employmentType }) {
  const head = [
    title && `# ${title}`,
    company && `**Company:** ${company}`,
    location && `**Location:** ${location}`,
    employmentType && `**Employment type:** ${employmentType}`,
  ].filter(Boolean).join('\n');
  const body = htmlToText(description);
  return [head, body].filter(Boolean).join('\n\n').trim();
}

/* ---------------------------------------------------------------- strategy 1
 * schema.org JobPosting in <script type="application/ld+json">.
 *
 * This is the broadest single win available: Ashby, Lever, SmartRecruiters,
 * Workable, Recruitee and many bespoke career sites all emit it for Google Jobs
 * indexing, which means they emit it whether or not their UI needs JavaScript.
 * A page can carry several ld+json blocks (BreadcrumbList, Organization), and
 * a block may itself be an array or an @graph wrapper, so every shape is walked
 * and only JobPosting nodes are kept.
 */
export function fromLdJson(html) {
  // Collect every distinct JobPosting on the page. A listing page can carry
  // several, and taking the first would hand the worker some other job's JD, so
  // a rescue is only offered when exactly one posting qualifies.
  const candidates = new Map();
  for (const block of ldJsonBlocks(html)) {
    let parsed;
    // A malformed block is normal (trailing commas, HTML comments wrapping the
    // JSON). Skip it and keep looking rather than aborting the whole strategy.
    try { parsed = JSON.parse(block.trim()); } catch { continue; }

    const queue = [parsed];
    for (let qi = 0; qi < queue.length; qi += 1) {
      const node = queue[qi];
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) { for (const child of node) queue.push(child); continue; }
      if (Array.isArray(node['@graph'])) for (const child of node['@graph']) queue.push(child);

      const type = node['@type'];
      const isJobPosting = Array.isArray(type)
        ? type.includes('JobPosting')
        : type === 'JobPosting';
      if (!isJobPosting || !node.description) continue;

      const loc = node.jobLocation;
      const locNode = Array.isArray(loc) ? loc[0] : loc;
      const addr = locNode?.address ?? locNode;
      const location = [addr?.addressLocality, addr?.addressRegion, addr?.addressCountry]
        .map((v) => (typeof v === 'object' ? v?.name : v))
        .filter(Boolean).join(', ');

      const text = composeJd({
        title: node.title,
        company: node.hiringOrganization?.name ?? node.hiringOrganization,
        location: location || undefined,
        description: node.description,
        employmentType: Array.isArray(node.employmentType)
          ? node.employmentType.join(', ') : node.employmentType,
      });
      if (wordCount(text) > 0) candidates.set(text, { text, method: 'ld+json' });
    }
  }
  return candidates.size === 1 ? [...candidates.values()][0] : null;
}

/* ---------------------------------------------------------------- strategy 3
 * Ashby's hydration payload.
 *
 * Fallback for the case where Ashby ships window.__appData but no ld+json.
 * Rather than parse the whole bootstrap object (its shape is not contractual),
 * pull the descriptionHtml/descriptionPlainText/jobDescriptionHtml string values
 * directly (a bare `description` key is too generic: it also labels unrelated
 * page content) and take the longest — the JD is by a wide margin the biggest such field on the page.
 */
/**
 * Decoded values of the description-like JSON string fields in a page. Linear: the key
 * regex has no nested quantifier, and each string is scanned once by hand, so repeated
 * unterminated `"descriptionHtml":"` starts cannot make the scan quadratic. An unterminated
 * string runs to the end of the page, so nothing after it can start a new value.
 * @returns {string[]}
 */
export function embeddedDescriptionStrings(html, { lenient = false } = {}) {
  const out = [];
  const keyRe = /"(?:descriptionHtml|descriptionPlainText|jobDescriptionHtml)"\s*:\s*"/g;
  const src = String(html);
  let m;
  while ((m = keyRe.exec(src)) !== null) {
    const start = keyRe.lastIndex;
    let i = start;
    while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
    if (i >= src.length) break;
    keyRe.lastIndex = i + 1;
    const rawStr = src.slice(start, i);
    try { out.push(JSON.parse(`"${rawStr}"`)); } catch {
      // Malformed (e.g. a raw control character). Never extracted as text, but a caller counting
      // description-sized fields (lenient) still sees it, so it cannot hide a second posting.
      // Escape the raw control characters and parse again, so valid escapes survive and a copy
      // that differs only in whitespace compares equal to its valid twin.
      if (!lenient) continue;
      const fixed = rawStr.replace(/[\u0000-\u001f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
      try { out.push(JSON.parse(`"${fixed}"`)); } catch { out.push(rawStr.replace(/\\./g, ' ').replace(/[\u0000-\u001f]/g, ' ')); }
    }
  }
  return out;
}

export function fromEmbeddedDescription(html) {
  let best = '';
  for (const raw of embeddedDescriptionStrings(html)) {
    const text = htmlToText(raw);
    if (text.length > best.length) best = text;
  }
  if (!best) return null;
  return { text: best, method: 'embedded-description' };
}
