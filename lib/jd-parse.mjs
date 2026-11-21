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
    const gt = noMoreGt ? -1 : src.indexOf('>', lt + 1);
    if (gt === -1) { noMoreGt = true; out.push(src.slice(lt)); break; }
    // A custom element such as `<style-guide>` opens with a known element's
    // name; keeping the hyphen in the class keeps it out of the branch below.
    const name = /^\/?[a-z][a-z0-9-]*|^br(?=[\s/])/.exec(lower.slice(lt + 1, lt + 12))?.[0] ?? '';
    if (name === 'script' || name === 'style') {
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
function composeJd({ title, company, location, description, employmentType, extra = [] }) {
  const head = [
    title && `# ${title}`,
    company && `**Company:** ${company}`,
    location && `**Location:** ${location}`,
    employmentType && `**Employment type:** ${employmentType}`,
  ].filter(Boolean).join('\n');
  const body = htmlToText(description);
  // schema.org JobPosting carries qualifications, responsibilities and
  // experienceRequirements as their own fields, and some boards (Meta, iCIMS
  // Jibe) keep the requirements there and out of `description`. Dropping them
  // drops the stated years. A field already inside the description is not
  // repeated.
  const sections = [];
  for (const [label, value] of extra) {
    const text = htmlToText(fieldText(value));
    if (text && !body.includes(text)) sections.push(`## ${label}\n${text}`);
  }
  return [head, body, ...sections].filter(Boolean).join('\n\n').trim();
}

/** A JobPosting text field: a string, a {description}/{name} node, or a list of them. */
function fieldText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(fieldText).filter(Boolean).join('\n');
  if (value && typeof value === 'object') return fieldText(value.description ?? value.name ?? '');
  return '';
}

/** JobPosting fields appended after the description, in reading order. */
const JOBPOSTING_EXTRA_FIELDS = [
  ['Responsibilities', 'responsibilities'],
  ['Qualifications', 'qualifications'],
  ['Experience requirements', 'experienceRequirements'],
  ['Education requirements', 'educationRequirements'],
];

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
        extra: JOBPOSTING_EXTRA_FIELDS.map(([label, key]) => [label, node[key]]),
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

/* ---------------------------------------------------------------- strategy 4
 * The posting's own markup, for career sites that ship the JD in the visible
 * HTML with no JSON-LD and no description-keyed JSON:
 *   - schema.org JobPosting as microdata (`itemtype=".../JobPosting"` with one
 *     `itemprop="description"`): SAP SuccessFactors Recruiting Marketing (RMK)
 *     sites such as jobs.lionsgate.com and careers.celestica.com;
 *   - an RMK job layout whose description token is labelled "Job Description"
 *     and carries no microdata (seagatecareers.com);
 *   - Radancy TalentBrew's `ats-description` block (disneycareers.com).
 * Each is taken only when the page holds exactly one such element, so a listing
 * or a page with a second posting yields nothing. Whether the element belongs to
 * the requested posting is the caller's check (inspectPage matches the URL's id).
 */

/**
 * Inner HTML of the element whose opening tag starts at `openLt`, matched by
 * depth on the same tag name. Forward indexOf scans only, with the next opening
 * tag cached, so a page of many nested or unclosed tags stays linear.
 * @returns {string|null} null when the element never closes
 */
export function elementInnerHtml(html, openLt) {
  const src = String(html ?? '');
  const lower = asciiLower(src);
  const name = /^<([a-z][a-z0-9]*)/.exec(lower.slice(openLt, openLt + 24))?.[1];
  if (!name) return null;
  const gt = scriptTagEnd(src, openLt);
  if (gt === -1) return null;
  if (src[gt - 1] === '/') return '';
  const open = `<${name}`;
  const close = `</${name}`;
  const isTagBoundary = (at) => /[\s/>]/.test(lower[at] ?? '');
  let depth = 1;
  let i = gt + 1;
  let nextOpen = -2;
  for (;;) {
    let c = lower.indexOf(close, i);
    while (c !== -1 && !isTagBoundary(c + close.length)) c = lower.indexOf(close, c + close.length);
    if (c === -1) return null;
    if (nextOpen !== -1 && nextOpen < i) nextOpen = lower.indexOf(open, i);
    while (nextOpen !== -1 && nextOpen < c) {
      if (isTagBoundary(nextOpen + open.length)) depth += 1;
      nextOpen = lower.indexOf(open, nextOpen + open.length);
    }
    depth -= 1;
    if (depth === 0) return src.slice(gt + 1, c);
    i = c + close.length;
  }
}

/** Every index at which `re` (global) matches. */
function matchIndexes(src, re) {
  const out = [];
  for (const m of src.matchAll(re)) out.push(m.index);
  return out;
}

/** Text of the single element whose opening tag contains the match at `at`, or null. */
function elementTextAt(src, at) {
  const lt = src.lastIndexOf('<', at);
  if (lt === -1) return null;
  const tag = src.slice(lt, scriptTagEnd(src, lt) + 1);
  if (/^<meta\b/i.test(tag)) return htmlToText(/\bcontent="([^"]*)"/i.exec(tag)?.[1] ?? '') || null;
  const inner = elementInnerHtml(src, lt);
  return inner == null ? null : (htmlToText(inner) || null);
}

/**
 * JD text from the posting's own markup, or null (see strategy 4 above).
 * @param {string} html
 * @returns {{text: string, method: string, title: string}|null}
 */
export function fromJobMarkup(html) {
  const found = jobMarkup(String(html ?? ''));
  return found ? { ...found, text: found.text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim() } : null;
}

function jobMarkup(src) {

  // Microdata JobPosting: one scope, one description, the description inside it.
  const scopes = matchIndexes(src, /itemtype=["']https?:\/\/schema\.org\/JobPosting["']/gi);
  if (scopes.length > 1) return null;
  if (scopes.length === 1) {
    const descs = matchIndexes(src, /itemprop=["']description["']/gi);
    if (descs.length === 1 && descs[0] > scopes[0]) {
      const text = elementTextAt(src, descs[0]);
      const titles = matchIndexes(src, /itemprop=["']title["']/gi);
      const title = titles.length === 1 ? (elementTextAt(src, titles[0]) || '').replace(/\s+/g, ' ').trim() : '';
      if (text) return { text: title ? `# ${title}\n\n${text}` : text, method: 'microdata', title };
    }
  }

  // RMK job layout with a "Job Description" token and no microdata.
  const labels = matchIndexes(src, /class="joblayouttoken-label"[^>]*>\s*Job Description\s*:?\s*</gi);
  if (labels.length === 1) {
    const labelEnd = src.toLowerCase().indexOf('</span', labels[0]);
    const valueAt = labelEnd === -1 ? -1 : src.toLowerCase().indexOf('<span', labelEnd + 6);
    const inner = valueAt === -1 ? null : elementInnerHtml(src, valueAt);
    const text = inner == null ? '' : htmlToText(inner);
    if (text) return { text, method: 'rmk-layout', title: '' };
  } else if (labels.length > 1) return null;

  // Radancy TalentBrew.
  const ats = matchIndexes(src, /class=["']ats-description["']/gi);
  if (ats.length === 1) {
    const text = elementTextAt(src, ats[0]);
    if (text) return { text, method: 'radancy', title: '' };
  }
  return null;
}
