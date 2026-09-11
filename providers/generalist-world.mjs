// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */

import { htmlToText } from './_html-to-text.mjs';

// Generalist World provider — the curated board of generalist / operator roles
// (chief of staff, founder's associate, ops lead, "first business hire") at
// https://generalist.world/jobs/. Wire in via a `job_boards:` entry with
// `provider: generalist-world`; a `careers_url` on generalist.world is
// auto-detected too.
//
// The board is one server-rendered WordPress page: a single plain GET returns
// every open posting (138 cards / ~300 KB when this was written, 2026-09),
// no pagination, no JSON API, no auth, and the default fetch User-Agent is
// served. Each posting is one anchor:
//
//   <a class="gw-job-card" data-type="connector" data-region="remote"
//      href="/jobs/{slug}/">
//     <div class="gw-job-company">ExampleCo</div>
//     <div class="gw-job-title">Chief of Staff</div>
//     <p class="gw-job-description">One-paragraph teaser.</p>
//     <span class="gw-job-meta-tag gw-salary">£70k–£85k</span>
//     <span class="gw-job-meta-tag gw-location">Remote (UK)</span>
//   </a>
//
// Field mapping: title / company / location straight off the card, with the
// anchor's data-region as the location fallback (a card missing its title or
// employer is skipped); the teaser becomes
// `description` (it is in the list payload, so it costs no extra request).
// The salary tag is free text ("$1,500/mo retainer + ...") and is not turned
// into figures, so no `salary` is attached. No posted date is exposed at list
// level, so no `postedAt`.
//
// job.url is the board's own /jobs/{slug}/ page (Source Indexing Policy
// rule 2, source-page fallback): the list page carries no employer link. The
// employer's apply URL lives only on each detail page, and fetching 100+
// detail pages per scan would break the zero-token rule. The "Featured"
// block at the top of the page uses the same card markup and is parsed with
// the rest (rule 3, full inventory); URLs are deduped, so a card rendered
// twice counts once.

const SITE_ORIGIN = 'https://generalist.world';
const LIST_URL = `${SITE_ORIGIN}/jobs/`;
const TRUSTED_HOSTS = new Set(['generalist.world', 'www.generalist.world']);

// One card = one anchor whose class list carries the gw-job-card token (a
// whole token: gw-job-card-top is a child div, not a card). Cards never nest
// another <a>, so the lazy match ends at the card's own closing tag.
// The captured attribute string starts at the tag's first whitespace, so
// every attribute name is preceded by whitespace (a `\b` alone would also
// match the tail of data-class= / data-href=); class tokens are matched whole.
const CARD_SRC = '<a(\\s(?:[^>]*?\\s)?class="(?:[^"]*\\s)?gw-job-card(?:\\s[^"]*)?"[^>]*)>([\\s\\S]*?)<\\/a>';
const CARDS_RE = new RegExp(CARD_SRC, 'g');
const ONE_CARD_RE = new RegExp(CARD_SRC);
const HREF_RE = /\shref="([^"]*)"/;
const REGION_RE = /\sdata-region="([^"]*)"/;
const TITLE_RE = /<div\s(?:[^>]*?\s)?class="gw-job-title"[^>]*>([\s\S]*?)<\/div>/;
const COMPANY_RE = /<div\s(?:[^>]*?\s)?class="gw-job-company"[^>]*>([\s\S]*?)<\/div>/;
const LOCATION_RE = /<span\s(?:[^>]*?\s)?class="(?:[^"]*\s)?gw-location(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/span>/;
const DESCRIPTION_RE = /<p\s(?:[^>]*?\s)?class="gw-job-description"[^>]*>([\s\S]*?)<\/p>/;
// The listing container, `<div class="gw-jobs-section" data-jobs-container>`.
// It is part of the page template, so it is present even when nothing is
// posted; that separates "alive, empty board" from "not the page this parser
// knows". Matched as an opening tag carrying the class token or the
// attribute, so the words appearing in text, CSS or script do not count.
const BOARD_MARKER_RE = /<[a-zA-Z][^\s>]*\s(?:[^>]*?\s)?(?:class="(?:[^"]*\s)?gw-jobs-section(?:\s[^"]*)?"|data-jobs-container(?=[\s>\/=]))[^>]*>/;

// The href is host-controlled and becomes a URL path segment, so it is held
// to a strict slug charset instead of being encoded: anything that is not
// /jobs/{slug}/ on this host (another origin, a query string, a traversal
// segment) drops just that card.
const SLUG_PATH_RE = /^\/jobs\/([A-Za-z0-9][A-Za-z0-9._~-]*)\/?$/;

/**
 * Human label for the card's data-region attribute, used only when the card
 * carries no gw-location tag. Known values on the live board: remote, uk,
 * eu, us.
 * @param {unknown} code
 */
function regionLabel(code) {
  if (typeof code !== 'string') return '';
  const c = code.trim().toLowerCase();
  if (!c) return '';
  return c === 'remote' ? 'Remote' : c.replace(/[-_]+/g, ' ').toUpperCase();
}

/**
 * Resolve a card href to the canonical posting URL, or null when it is not a
 * /jobs/{slug}/ path (site-relative, or absolute on generalist.world).
 * Exported for tests.
 * @param {unknown} href
 * @returns {string | null}
 */
export function resolveGeneralistWorldUrl(href) {
  if (typeof href !== 'string') return null;
  let path = href.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    // Absolute (or scheme-relative-looking) href: only https on the trusted
    // host, with no query or fragment, is taken as a posting page.
    let parsed;
    try {
      parsed = new URL(path);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:' || !TRUSTED_HOSTS.has(parsed.hostname) || parsed.search || parsed.hash) return null;
    path = parsed.pathname;
  }
  const m = SLUG_PATH_RE.exec(path);
  return m ? `${SITE_ORIGIN}/jobs/${m[1]}/` : null;
}

/**
 * @param {string} attrs  the card anchor's attribute string
 * @param {string} inner  the card anchor's inner HTML
 * @returns {Job | null}
 */
function cardToJob(attrs, inner) {
  const url = resolveGeneralistWorldUrl(HREF_RE.exec(attrs)?.[1]);
  if (!url) return null;
  const title = htmlToText(TITLE_RE.exec(inner)?.[1]);
  if (!title) return null;
  // A board listing has to be attributed to an identifiable employer (Source
  // Indexing Policy); every live card carries one, so a card without it is
  // malformed rather than a real posting.
  const company = htmlToText(COMPANY_RE.exec(inner)?.[1]);
  if (!company) return null;
  const location = htmlToText(LOCATION_RE.exec(inner)?.[1]) || regionLabel(REGION_RE.exec(attrs)?.[1]);
  /** @type {Job} */
  const job = { title, url, company, location };
  const description = htmlToText(DESCRIPTION_RE.exec(inner)?.[1]);
  if (description) job.description = description;
  return job;
}

/**
 * Normalize one `<a class="gw-job-card" …>…</a>` fragment into the shared
 * Job shape, or null when it is not a card or lacks a usable title, employer
 * or link. Exported for tests.
 * @param {unknown} cardHtml
 * @returns {Job | null}
 */
export function normalizeGeneralistWorldCard(cardHtml) {
  if (typeof cardHtml !== 'string') return null;
  const m = ONE_CARD_RE.exec(cardHtml);
  return m ? cardToJob(m[1], m[2]) : null;
}

/**
 * Parse the board page. An empty body, or a page that still carries the
 * listing container but no cards, is an alive-but-empty board and yields [].
 * A body with neither throws, so a redesign or a challenge page surfaces as
 * an error instead of a board that quietly reads 0 forever. Exported for
 * tests.
 * @param {unknown} html
 * @returns {Job[]}
 */
export function parseGeneralistWorldJobs(html) {
  if (typeof html !== 'string' || !html.trim()) return [];
  /** @type {Job[]} */
  const jobs = [];
  const seen = new Set();
  for (const m of html.matchAll(CARDS_RE)) {
    const job = cardToJob(m[1], m[2]);
    if (!job || seen.has(job.url)) continue;
    seen.add(job.url);
    jobs.push(job);
  }
  if (jobs.length === 0 && !BOARD_MARKER_RE.test(html)) {
    throw new Error(
      'generalist-world: no gw-job-card anchors and no listing container in the response; the page structure likely changed',
    );
  }
  return jobs;
}

/** @param {import('./_types.js').PortalEntry | null | undefined} entry */
function detectGeneralistWorldEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.provider === 'generalist-world') return { url: LIST_URL };
  if (entry.provider) return null;

  for (const value of [entry.api, entry.careers_url]) {
    if (typeof value !== 'string') continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol === 'https:' && TRUSTED_HOSTS.has(parsed.hostname)) return { url: LIST_URL };
    } catch {
      // Malformed URL: not ours; another provider may still claim the entry.
    }
  }
  return null;
}

/** @type {Provider} */
export default {
  id: 'generalist-world',

  detect: detectGeneralistWorldEntry,

  async fetch(_entry, ctx) {
    // The list URL is a constant on the trusted host, so no config-derived
    // value reaches the network; redirect:'error' still refuses a server-side
    // redirect off the host (SSRF guard).
    const html = await ctx.fetchText(LIST_URL, { redirect: 'error' });
    return parseGeneralistWorldJobs(html);
  },
};
