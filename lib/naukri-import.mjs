/**
 * lib/naukri-import.mjs — turn a pasted Naukri job-alert email (or a list of
 * Naukri links) into pipeline offers, with no network request of any kind.
 *
 * Naukri cannot be scanned: its listing and posting pages are client-rendered
 * shells and its own JSON endpoint answers `recaptcha required`
 * (docs/NAUKRI.md, measured 2026-11-20). What a candidate *does* have is the
 * daily job-alert email Naukri sends to their own inbox, which is their mail,
 * not a crawl. This module reads that paste the same way `lib/linkedin-import.mjs`
 * reads a LinkedIn alert: find the posting links, keep the ones the pipeline
 * and the tracker do not already carry, and hand back offers for
 * `appendToPipeline()`.
 *
 * The fields are best-effort and deliberately humble: a title from the anchor
 * text (Naukri's alerts link the job title), the line under it as the company,
 * and a slug fallback that is labelled as unparsed rather than split into a
 * title and an employer the URL does not actually delimit.
 */

import { parseNaukriPosting } from './naukri-url.mjs';

export const NAUKRI_IMPORT_MAX_CHARS = 2_000_000;
// A real title or company name is far shorter than a pasted paragraph.
export const MAX_FIELD_LENGTH = 120;

const EMPTY_MESSAGE = 'No Naukri jobs found. Open a Naukri job-alert email, select all, copy, and paste it here.';
const TOO_LARGE_MESSAGE = 'That paste is too large. Paste one job-alert email.';

// A full URL, or a bare naukri.com posting link that does not sit inside
// another URL. One pattern keeps the matches in text order.
const JOB_LINK = /https?:\/\/[^\s"'<>]+|(?<![\w.\-/%@:=&?#~+])(?:[a-z0-9-]+\.)?naukri\.com\/job-listings-[^\s"'<>]+/gi;
const ANCHOR = /href\s*=\s*["']?([^"'\s>]+)["']?[^>]*>([\s\S]{0,300}?)<\/a>/gi;
const MAIL_HEADER = /^(from|to|subject|date|reply-to|cc|bcc|mime-version|content-type)\s*:/i;
const BOILERPLATE = /^(?:view job|see job|see all jobs|apply now|easy apply|apply on naukri|posted(?:\s|:)|updated(?:\s|:))/i;
const LOCATION = /^(?:remote|hybrid|on-?site|work from home|wfh)\b/i;

/**
 * Decode the two encodings a saved `.eml` puts in the way, in this order:
 * a quoted-printable soft break, then a quoted-printable `=3D` that hides an
 * `=`, then an HTML-encoded ampersand inside an `href`.
 *
 * @param {string} text
 * @returns {string}
 */
function prepare(text) {
  return text.replace(/=\r?\n/g, '').replace(/=3D/gi, '=').replaceAll('&amp;', '&');
}

function stripTrail(url) {
  return url.replace(/[),.;!?\]]+$/g, '');
}

function textOf(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function bounded(line) {
  const text = String(line || '').trim();
  return text.length > MAX_FIELD_LENGTH ? `${text.slice(0, MAX_FIELD_LENGTH - 1).trimEnd()}…` : text;
}

/**
 * Every Naukri posting in `text`, first-seen order, as `{id, url}`.
 * A tracking/redirect wrapper is unwrapped (up to three query levels), which is
 * how a Google or mail-provider redirect around an alert link is read.
 *
 * @param {string} text
 * @returns {{id: string, url: string}[]}
 */
export function naukriJobsFromText(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const body = prepare(text);
  /** @type {string[]} */
  const ids = [];
  const urls = new Map();
  const push = (posting) => {
    if (!posting || urls.has(posting.id)) return;
    urls.set(posting.id, posting.url);
    ids.push(posting.id);
  };
  /** @param {string} raw @param {number} depth */
  const consider = (raw, depth) => {
    if (!raw || depth > 3) return;
    let url;
    try {
      url = new URL(raw);
    } catch {
      return;
    }
    push(parseNaukriPosting(url.href));
    for (const value of url.searchParams.values()) consider(value, depth + 1);
  };
  for (const [match] of body.matchAll(JOB_LINK)) {
    const url = stripTrail(match);
    consider(/^https?:/i.test(url) ? url : `https://${url}`, 0);
  }
  return ids.map((id) => ({ id, url: urls.get(id) }));
}

/** Anchor text and line number per posting id, from the alert's own HTML. */
function anchorIndex(body) {
  /** @type {Map<string, string>} */
  const label = new Map();
  for (const [, href, inner] of body.matchAll(ANCHOR)) {
    const posting = parseNaukriPosting(stripTrail(href));
    if (!posting || label.has(posting.id)) continue;
    const text = textOf(inner);
    if (text) label.set(posting.id, text);
  }
  return label;
}

/** First line whose own posting is this id. */
function jobLineIndex(lines) {
  /** @type {Map<string, number>} */
  const index = new Map();
  for (let i = 0; i < lines.length; i++) {
    const link = new RegExp(JOB_LINK.source, 'gi');
    for (const [match] of lines[i].matchAll(link)) {
      const posting = parseNaukriPosting(stripTrail(match));
      if (posting && !index.has(posting.id)) index.set(posting.id, i);
    }
  }
  return index;
}

/**
 * A readable title from the slug, used only when the paste gives none: the
 * slug's words before the experience band, which still carries the title, the
 * employer and the city in one string because the URL does not say where the
 * title ends. Never presented as a parsed employer.
 *
 * @param {string} slug
 * @returns {string}
 */
export function naukriSlugWords(slug) {
  const text = String(slug || '')
    .replace(/-\d{1,2}-to-\d{1,2}-years$/i, '')
    .replace(/-\d{1,2}-years$/i, '');
  if (!text) return '';
  return bounded(
    text
      .split('-')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' '),
  );
}

const isLink = (line) => /^https?:\/\//i.test(line) || /naukri\.com\/job-listings-/i.test(line);
// A corporate suffix after the comma means a company, not a place
// ("Quillfeather Labs, Inc" is an employer; "Noida, Uttar Pradesh" is not).
const LEGAL_TAIL = /(?:^|,)\s*(?:inc|ltd|limited|llc|pvt|private|plc|llp|corp|corporation|company|co|technologies|solutions|services|systems|consulting|labs|group)\b\.?$/i;
// A place is a Remote/Hybrid statement, a "City, State" pair, or "City, Region"
// with a word after the comma. A bare word ("Kolkata", "Nasscomm") is neither:
// it is left to the employer column rather than guessed into the place one.
const isPlace = (line) =>
  LOCATION.test(line) ||
  (line.length <= 60 && !/\d/.test(line) && !LEGAL_TAIL.test(line) &&
    (/^[\p{L}][\p{L}\s.'&-]*, \s*[\p{L}][\p{L}\s.'&-]{1,}$/u.test(line) || /,\s*[A-Z]{2}\b/.test(line)));

/**
 * The usable lines around a link, top-down, at most three each side, stopping at
 * a blank, the next posting's link, a mail header or boilerplate. `before` holds
 * a title above the link (the LinkedIn-alert shape), `after` the employer and
 * the place (the Naukri-alert shape, where the link is the title itself).
 *
 * @param {string[]} lines
 * @param {number} at
 * @returns {{before: string[], after: string[]}}
 */
function usableAround(lines, at) {
  if (at < 0) return { before: [], after: [] };
  const usable = (line) => {
    const text = line.trim();
    if (!text) return null;
    if (isLink(text) || MAIL_HEADER.test(text) || BOILERPLATE.test(text)) return false;
    return text;
  };
  const walk = (step) => {
    const out = [];
    for (let i = at + step; i >= 0 && i < lines.length && out.length < 3; i += step) {
      const text = usable(lines[i]);
      if (text === null) { if (out.length) break; else continue; }
      if (text === false) break;
      out.push(text);
    }
    return out;
  };
  return { before: walk(-1).reverse(), after: walk(1) };
}

/**
 * Title, company and location for one parsed job, best-effort and from the
 * paste only. The anchor text Naukri's alert puts on the link is the title; a
 * title above the link is read the way a LinkedIn alert writes it; the first
 * usable line under the link is the company and the line after it a place. A
 * Remote/Hybrid line is the location wherever it appears. Anything the paste
 * does not say stays unknown — the slug words are labelled as slug words, never
 * split into a guessed employer.
 *
 * @param {string} text
 * @param {{id?: string, url?: string}} job
 * @returns {{title: string, company: string, location: string}}
 */
export function naukriOfferFields(text, job) {
  const body = typeof text === 'string' ? prepare(text) : '';
  const posting = parseNaukriPosting(job?.url || '') || null;
  const id = posting?.id || '';
  const lines = body.split(/\r?\n/);
  const lineOf = jobLineIndex(lines);
  const labels = anchorIndex(body);
  const at = id && lineOf.has(id) ? lineOf.get(id) : -1;
  const { before, after } = usableAround(lines, at);

  let location = '';
  const dropPlace = (list) => list.filter((line) => {
    if (!isPlace(line)) return true;
    if (!location) location = bounded(textOf(line));
    return false;
  });
  const above = labels.size === 0 ? dropPlace(before) : [];
  const below = dropPlace(after);

  const title = bounded((id && labels.get(id)) || above[0] || naukriSlugWords(posting?.slug || '') || 'Naukri posting');
  const company = bounded(below[0] || above[1] || '') || 'Naukri';
  return { title, company, location: bounded(location) };
}

/**
 * Pipeline offers for the jobs a plan kept.
 *
 * @param {{id: string, url: string}[]} jobs
 * @param {string} [text]
 * @returns {{url: string, company: string, title: string, location: string, source: string}[]}
 */
export function naukriOffers(jobs, text = '') {
  return jobs.map((job) => {
    const fields = naukriOfferFields(text, job);
    return { url: job.url, company: fields.company, title: fields.title, location: fields.location, source: 'naukri-import' };
  });
}

/**
 * @param {{added: number, already: number, found: number, dryRun?: boolean}} counts
 * @returns {string}
 */
export function naukriImportMessage({ added, already, found, dryRun = false }) {
  if (found === 0) return EMPTY_MESSAGE;
  if (dryRun && added > 0) {
    return added === 1 ? '1 Naukri job found. Nothing was saved.' : `${added} Naukri jobs found. Nothing was saved.`;
  }
  if (added === 0) {
    return already === 1
      ? 'That Naukri job is already in your list.'
      : `Those ${already} Naukri jobs are already in your list.`;
  }
  const addedLine = added === 1
    ? '1 Naukri job added. Open Pipeline to review it.'
    : `${added} Naukri jobs added. Open Pipeline to review them.`;
  if (already === 0) return addedLine;
  const alreadyLine = already === 1 ? '1 was already in your list' : `${already} were already in your list`;
  return `${addedLine} ${alreadyLine}.`;
}

/**
 * @param {string} text Alert email, a list of URLs, or a saved .eml.
 * @param {string} seenText pipeline.md and applications.md, concatenated.
 * @param {{dryRun?: boolean}} [options]
 * @returns {{found: number, added: {id: string, url: string}[], already: {id: string, url: string}[], message: string, error?: string}}
 */
export function planNaukriImport(text, seenText, { dryRun = false } = {}) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { found: 0, added: [], already: [], message: EMPTY_MESSAGE };
  }
  if (text.length > NAUKRI_IMPORT_MAX_CHARS) {
    return { found: 0, added: [], already: [], error: 'too-large', message: TOO_LARGE_MESSAGE };
  }
  const jobs = naukriJobsFromText(text);
  const seen = new Set(naukriJobsFromText(typeof seenText === 'string' ? seenText : '').map((job) => job.id));
  const added = [];
  const already = [];
  for (const job of jobs) {
    if (seen.has(job.id)) already.push(job);
    else added.push(job);
  }
  return {
    found: jobs.length,
    added,
    already,
    message: naukriImportMessage({ added: added.length, already: already.length, found: jobs.length, dryRun }),
  };
}
