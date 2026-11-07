/**
 * jd-parse.mjs: pure HTML-to-JD parsers shared by batch/jd-rescue.mjs and
 * lib/jd-page-fetch.mjs. They live here, a system file in its own right, so the
 * page fetcher never depends on batch/jd-rescue.mjs, which the updater preserves
 * when the user has edited it. No I/O: every function takes a string.
 */

/** Lowercase A-Z only. String#toLowerCase can change the length (e.g. U+0130), which would misalign indexOf offsets with the source. */
export const asciiLower = (s) => String(s).replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

const HTML_ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'",
  '#160': ' ', '#xa0': ' ', '#x27': "'", '#38': '&', mdash: '—', ndash: '–',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…',
};

/** Latin-1 named references (U+00A1-U+00FF), case-sensitive: `&Eacute;` and `&eacute;` differ. nbsp stays a plain space. */
export const LATIN1_ENTITIES = Object.fromEntries(Object.entries({ AElig: 0xc6, Aacute: 0xc1, Acirc: 0xc2, Agrave: 0xc0, Aring: 0xc5, Atilde: 0xc3, Auml: 0xc4, Ccedil: 0xc7, ETH: 0xd0, Eacute: 0xc9, Ecirc: 0xca, Egrave: 0xc8, Euml: 0xcb, Iacute: 0xcd, Icirc: 0xce, Igrave: 0xcc, Iuml: 0xcf, Ntilde: 0xd1, Oacute: 0xd3, Ocirc: 0xd4, Ograve: 0xd2, Oslash: 0xd8, Otilde: 0xd5, Ouml: 0xd6, THORN: 0xde, Uacute: 0xda, Ucirc: 0xdb, Ugrave: 0xd9, Uuml: 0xdc, Yacute: 0xdd, aacute: 0xe1, acirc: 0xe2, acute: 0xb4, aelig: 0xe6, agrave: 0xe0, aring: 0xe5, atilde: 0xe3, auml: 0xe4, brvbar: 0xa6, ccedil: 0xe7, cedil: 0xb8, cent: 0xa2, copy: 0xa9, curren: 0xa4, deg: 0xb0, divide: 0xf7, eacute: 0xe9, ecirc: 0xea, egrave: 0xe8, eth: 0xf0, euml: 0xeb, frac12: 0xbd, frac14: 0xbc, frac34: 0xbe, iacute: 0xed, icirc: 0xee, iexcl: 0xa1, igrave: 0xec, iquest: 0xbf, iuml: 0xef, laquo: 0xab, macr: 0xaf, micro: 0xb5, middot: 0xb7, nbsp: 0xa0, not: 0xac, ntilde: 0xf1, oacute: 0xf3, ocirc: 0xf4, ograve: 0xf2, ordf: 0xaa, ordm: 0xba, oslash: 0xf8, otilde: 0xf5, ouml: 0xf6, para: 0xb6, plusmn: 0xb1, pound: 0xa3, raquo: 0xbb, reg: 0xae, sect: 0xa7, shy: 0xad, sup1: 0xb9, sup2: 0xb2, sup3: 0xb3, szlig: 0xdf, thorn: 0xfe, times: 0xd7, uacute: 0xfa, ucirc: 0xfb, ugrave: 0xf9, uml: 0xa8, uuml: 0xfc, yacute: 0xfd, yen: 0xa5, yuml: 0xff }).filter(([n]) => n !== 'nbsp').map(([n, cp]) => [n, String.fromCodePoint(cp)]));

// An entity-escaped tag: `&lt;p&gt;`, `&lt;/p&gt;`, `&lt;br /&gt;`, `&lt;a href=&quot;x&quot;&gt;`.
// Known tags only, and attributes must be name=value pairs (see htmlToText).
const ESCAPED_TAG_NAMES = 'p|br|hr|div|span|b|i|u|em|strong|ul|ol|li|h[1-6]|a|table|thead|tbody|tr|td|th|section|article|blockquote|font|sup|sub|pre|code|small|big';
// `&amp;` is the one entity that legitimately sits inside a quoted value (a URL's
// query string), so it is allowed there while any other `&` keeps the prose guard.
const ESCAPED_ATTR = String.raw`\s+[a-z_:][\w:.-]*=(?:"(?:[^"<>&]|&amp;)*"|'(?:[^'<>&]|&amp;)*'|&quot;(?:[^<>&]|&amp;)*?&quot;|[^\s"'<>&=]+)`;
const ESCAPED_TAG_RE = new RegExp(String.raw`&lt;(/?(?:${ESCAPED_TAG_NAMES}))((?:${ESCAPED_ATTR})*)\s*/?&gt;`, 'gi');

// `&#99999999;` is out of range and String.fromCodePoint throws on it, which
// aborted the whole extraction (the batch CLI then logged "error"). An entity
// that is not a real code point is not decodable, so it reads as a space.
function codePointOrSpace(cp) {
  return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)
    ? String.fromCodePoint(cp)
    : ' ';
}

/** Strip HTML to visible text, matching the runner's own normalization. */
function htmlToText(html) {
  // Some boards (Phenom, observed on careers.roberthalf.com) ship the JobPosting
  // description as entity-ESCAPED markup (`&lt;div&gt;&lt;p&gt;…`). The tag strip
  // below cannot see those as tags, and the entity pass then turns them back into
  // literal `<div><p>` in the JD. Unescape the tags, and ONLY the tags: a global
  // `&lt;`/`&gt;` replace would also decode prose like `latency &lt; 50 ms`, and
  // the strip would then eat the prose up to the next `>`. A tag qualifies when
  // it is a known HTML tag whose attributes are all name="value" pairs, so
  // `&lt;b and c&gt;` stays text.
  const markup = String(html ?? '').replace(
    ESCAPED_TAG_RE,
    (_m, name, attrs) => `<${name}${String(attrs).replace(/&quot;/gi, '"')}>`,
  );
  return stripMarkup(markup)
    .replace(/&([a-z]+|#x?[0-9a-f]+);/gi, (m, e) => {
      if (Object.hasOwn(LATIN1_ENTITIES, e)) return LATIN1_ENTITIES[e];
      const k = e.toLowerCase();
      if (Object.hasOwn(HTML_ENTITIES, k)) return HTML_ENTITIES[k];
      const dec = /^#(\d+)$/.exec(k);
      if (dec) return codePointOrSpace(Number(dec[1]));
      const hex = /^#x([0-9a-f]+)$/.exec(k);
      if (hex) return codePointOrSpace(parseInt(hex[1], 16));
      return ' ';
    })
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

export const wordCount = (t) => t.split(/\s+/).filter(Boolean).length;

const BLOCK_END_TAG = /^\/(p|div|li|h[1-6]|tr|section|article)$/;

/**
 * Remove `<script>`/`<style>` elements and every tag, in one forward pass.
 * Block-closing tags and `<br>` become line breaks so requirement lists do not
 * run together into one paragraph for the worker. Each step moves forward with
 * indexOf, so hostile input (many unclosed `<script`, or `<` with no `>`) stays
 * linear where the lazy-regex form rescanned the remainder per start.
 *
 * @param {string} markup
 * @returns {string}
 */
function stripMarkup(markup) {
  const src = String(markup);
  const lower = asciiLower(src);
  const out = [];
  let i = 0;
  let noMoreGt = false;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { out.push(src.slice(i)); break; }
    out.push(src.slice(i, lt));
    const gt = noMoreGt ? -1 : src.indexOf('>', lt + 1);
    if (gt === -1) { noMoreGt = true; out.push(src.slice(lt)); break; }
    const name = /^\/?[a-z][a-z0-9]*|^br(?=[\s/])/.exec(lower.slice(lt + 1, lt + 12))?.[0] ?? '';
    if (name === 'script' || name === 'style') {
      const close = lower.indexOf(`</${name}`, gt + 1);
      const closeGt = close === -1 ? -1 : src.indexOf('>', close);
      if (closeGt === -1) { out.push(' '); break; } // unclosed: the rest is script/style payload, not text
      out.push(' ');
      i = closeGt + 1;
      continue;
    }
    out.push(name === 'br' || BLOCK_END_TAG.test(name) ? '\n' : ' ');
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
