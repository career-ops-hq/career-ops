#!/usr/bin/env node
/**
 * jd-rescue.mjs — recover a job description from a page whose *visible* text is
 * too thin to use, before the batch runner spends a worker on it.
 *
 * Usage:  node batch/jd-rescue.mjs <url> <raw-html-file> <out-file> [stripped-words]
 * Output: "<words>\t<method>" on stdout; exit 0 on success, 1 on failure.
 *         On success <out-file> is overwritten with clean plain text.
 *
 * WHY THIS EXISTS
 *
 * The runner strips <script> and <style> blocks before counting visible words,
 * so a JS-rendered board scores near zero and the JD file is emptied — the
 * worker is then told to WebFetch, which hits the same wall from the same kind
 * of address and fails. Observed in one batch run: 14 of 24 offers
 * (58% of the run's spend) died as "JD file empty/boilerplate; WebFetch
 * returned only title/company", and the failures clustered by ATS vendor, not
 * randomly — 6/7 Ashby (jobs.ashbyhq.com/acme/...) and 6/9 Greenhouse-embedded
 * (careers.example.com/job?gh_jid=...), while 7/7 plain boards.greenhouse.io
 * postings in the same run succeeded.
 *
 * The decisive finding: for those pages the description was *already in the
 * bytes curl downloaded*, inside the very <script> blocks the strip discards.
 * The same Ashby posting that stripped down to 13 words ("Data Scientist @ Acme
 * You need to enable JavaScript to run this app.") carries 898 words of clean
 * JD in its application/ld+json JobPosting. Nothing needs to be re-fetched and
 * no browser needs to run — the data just has to be read out of the right place.
 *
 * Strategies run in order, cheapest first. 1 and 3 are pure offline parsing of
 * bytes already on disk; only 2 makes a network request, a single
 * unauthenticated JSON GET to the ATS's public API. All three are zero-LLM-token.
 *
 * WHEN A RESCUE IS ACCEPTED
 *
 * A thin page is not the only failure shape, and the word count alone does not
 * separate them. The embed pages stripped to 126 words — above the
 * runner's 80-word floor — so they were never flagged as thin; the worker was
 * handed 126 words of the company's own page chrome and correctly reported that
 * it had no job description. What actually distinguishes those pages is not how
 * much text they have but *where the JD lives*: the posting is served from
 * the ATS's own API, a different origin than the document curl fetched,
 * so no amount of parsing that document can produce it.
 *
 * Hence two accept conditions rather than one:
 *   - the stripped page is thin (< minWords), or
 *   - the rescued text is longer than the stripped page, meaning the visible
 *     text was demonstrably missing content the structured source has.
 * A structured JobPosting is high-precision, so "longer" here means "more JD",
 * not "more navigation". Where the stripped page already wins — a canonical
 * Greenhouse board posting renders its own JD server-side — the rescue is
 * rejected and the existing text is kept untouched, so pages that work today
 * cannot regress.
 */

import fs from 'node:fs';
import { isMainModule } from '../lib/is-main-module.mjs';

const HTML_ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'",
  '#160': ' ', '#xa0': ' ', '#x27': "'", '#38': '&', mdash: '—', ndash: '–',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…',
};

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
      const k = e.toLowerCase();
      if (HTML_ENTITIES[k] !== undefined) return HTML_ENTITIES[k];
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
  const lower = src.toLowerCase();
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
  const lower = src.toLowerCase();
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
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) { queue.push(...node); continue; }
      if (Array.isArray(node['@graph'])) queue.push(...node['@graph']);

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

/* ---------------------------------------------------------------- strategy 2
 * The ATS's own public API, through upstream's fetchJdViaKnownApi().
 *
 * A company that embeds Greenhouse on its own careers domain
 * (careers.example.com/job?gh_jid=1234567) serves a host page with no JD text
 * in it, and the posting lives on another origin, so no amount of parsing the
 * downloaded document can produce it. browser-extract.mjs already knows how to
 * ask the right API for every ATS in JD_TEXT_API_ATS (the same dispatch
 * fetch-jd.mjs and the `jd` mode use), so this strategy calls it rather than
 * carrying a second copy of the per-ATS code. A URL it does not recognise
 * answers null without any network request.
 */
async function fromKnownApi(url) {
  try {
    const { fetchJdViaKnownApi } = await import('../browser-extract.mjs');
    const result = await fetchJdViaKnownApi(url, 20_000, 15_000);
    if (!result?.text) return null;
    const text = result.title ? `${result.title}\n\n${result.text}` : result.text;
    return { text, method: `ats-api:${result.ats}` };
  } catch {
    return null;
  }
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
export function fromEmbeddedDescription(html) {
  const re = /"(descriptionHtml|descriptionPlainText|jobDescriptionHtml)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let best = '';
  let m;
  while ((m = re.exec(html)) !== null) {
    let raw;
    try { raw = JSON.parse(`"${m[2]}"`); } catch { continue; }
    const text = htmlToText(raw);
    if (text.length > best.length) best = text;
  }
  if (!best) return null;
  return { text: best, method: 'embedded-description' };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  node batch/jd-rescue.mjs <url> <raw-html-file> <out-file> [stripped-words]
  node batch/jd-rescue.mjs --help

Recover a JD from a page's structured data (JSON-LD, ATS API, embedded payload)
when its visible text is too thin. Prints "<words>\\t<method>"; exit 0 on success.

Options:
  --help, -h  Print this usage block and exit`);
    process.exit(0);
  }
  const [url, rawFile, outFile, strippedArg] = args;
  const minWords = Number(process.env.JD_RESCUE_MIN_WORDS || 80);
  const strippedWords = Number.isFinite(Number(strippedArg)) ? Number(strippedArg) : 0;
  const thin = strippedWords < minWords;

  if (!url || !rawFile || !outFile) {
    process.stdout.write('0\tusage\n');
    process.exit(1);
  }

  let html = '';
  try { html = fs.readFileSync(rawFile, 'utf-8'); } catch {
    process.stdout.write('0\tno-raw-file\n');
    process.exit(1);
  }

  // First strategy whose text clears the word floor AND, when the page is not
  // thin, is longer than the page's own text, wins. A candidate that fails
  // either test must not stop the chain: a later source may hold the full JD.
  let found = null;
  let thinFound = null;
  let notBetter = null;
  for (const run of [
    () => fromLdJson(html),
    () => fromKnownApi(url),
    () => fromEmbeddedDescription(html),
  ]) {
    const candidate = await run();
    if (!candidate) continue;
    const w = wordCount(candidate.text);
    if (w < minWords) { thinFound ??= candidate; continue; }
    // Never replace a page that already had more JD than the rescue found —
    // see "WHEN A RESCUE IS ACCEPTED" above.
    if (!thin && w <= strippedWords) { notBetter ??= candidate; continue; }
    found = candidate;
    break;
  }

  if (!found) {
    // A rescue that yields another thin page is not a rescue. Reporting it as
    // one would put the worker back in exactly the position this module exists
    // to avoid, so it is a failure and the caller routes the offer to Playwright.
    if (notBetter) process.stdout.write(`${wordCount(notBetter.text)}\t${notBetter.method}:not-better\n`);
    else if (thinFound) process.stdout.write(`${wordCount(thinFound.text)}\t${thinFound.method}:thin\n`);
    else process.stdout.write('0\tnone\n');
    process.exit(1);
  }

  const words = wordCount(found.text);
  // Write beside the target and rename, so a failed write leaves the existing
  // JD file intact for the fallbacks that follow.
  const tmp = `${outFile}.rescue-${process.pid}`;
  try {
    fs.writeFileSync(tmp, found.text);
    fs.renameSync(tmp, outFile);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw err;
  }
  process.stdout.write(`${words}\t${found.method}\n`);
}

// Importable for fetch-jd.mjs's page tier, so the parsers have one copy. The CLI
// tail runs only when this file is the process entry.
if (isMainModule(import.meta.url)) {
  main().catch(() => {
    process.stdout.write('0\terror\n');
    process.exit(1);
  });
}
