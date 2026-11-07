import { linkedInJobId } from './linkedin-url.mjs';

export const LINKEDIN_DOCTOR_LABEL =
  'LinkedIn jobs: paste an alert email on the dashboard, or run node linkedin-import.mjs. No Google account.';

export const LINKEDIN_SKIP_GOOGLE =
  'You can skip Google setup. Paste the LinkedIn alert email on the dashboard, or run node linkedin-import.mjs.';

export const LINKEDIN_IMPORT_MAX_CHARS = 2_000_000;

const EMPTY_MESSAGE = 'No LinkedIn jobs found. Open a job alert email, select all, copy, and paste it here.';
const TOO_LARGE_MESSAGE = 'That paste is too large. Paste one alert email.';

// A full URL, or a bare linkedin.com/jobs link that does not sit inside
// another URL. One pattern keeps the matches in text order.
const JOB_LINK = /https?:\/\/[^\s"'<>]+|(?<![\w.\-/%@:=&?#~+])(?:[a-z0-9-]+\.)?linkedin\.com\/(?:comm\/)?jobs\/[^\s"'<>]+/gi;

/**
 * @param {string} pluginId
 * @returns {string|null}
 */
export function linkedInPluginFix(pluginId) {
  if (pluginId !== 'gmail') return null;
  return `${pluginId}: ${LINKEDIN_SKIP_GOOGLE}`;
}

/**
 * @param {string} id
 * @returns {string}
 */
export function canonicalLinkedInJobUrl(id) {
  return `https://www.linkedin.com/jobs/view/${id}`;
}

function prepare(text) {
  return text.replace(/=\r?\n/g, '').replaceAll('&amp;', '&');
}

function stripTrail(url) {
  return url.replace(/[),.;!?\]]+$/g, '');
}

/**
 * @param {string} raw
 * @param {(id: string) => void} push
 * @param {number} depth
 */
function consider(raw, push, depth) {
  if (!raw || depth > 3) return;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return;
  }
  const id = linkedInJobId(url);
  if (id) push(id);
  for (const value of url.searchParams.values()) consider(value, push, depth + 1);
}

/**
 * Every LinkedIn posting in `text`, first-seen order.
 * The URL is always `https://www.linkedin.com/jobs/view/{id}`.
 *
 * @param {string} text
 * @returns {{id: string, url: string}[]}
 */
export function linkedInJobsFromText(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const body = prepare(text);
  /** @type {string[]} */
  const ids = [];
  const seen = new Set();
  const push = (id) => {
    if (!/^\d+$/.test(id) || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  for (const [match] of body.matchAll(JOB_LINK)) {
    const url = stripTrail(match);
    consider(/^https?:/i.test(url) ? url : `https://${url}`, push, 0);
  }
  return ids.map((id) => ({ id, url: canonicalLinkedInJobUrl(id) }));
}

/**
 * @param {{added: number, already: number, found: number, dryRun?: boolean}} counts
 * @returns {string}
 */
export function linkedInImportMessage({ added, already, found, dryRun = false }) {
  if (found === 0) return EMPTY_MESSAGE;
  if (dryRun && added > 0) {
    return added === 1
      ? '1 LinkedIn job found. Nothing was saved.'
      : `${added} LinkedIn jobs found. Nothing was saved.`;
  }
  if (added === 0) {
    return already === 1
      ? 'That LinkedIn job is already in your list.'
      : `Those ${already} LinkedIn jobs are already in your list.`;
  }
  const addedLine = added === 1
    ? '1 LinkedIn job added. Open Pipeline to review it.'
    : `${added} LinkedIn jobs added. Open Pipeline to review them.`;
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
export function planLinkedInImport(text, seenText, { dryRun = false } = {}) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { found: 0, added: [], already: [], message: EMPTY_MESSAGE };
  }
  if (text.length > LINKEDIN_IMPORT_MAX_CHARS) {
    return { found: 0, added: [], already: [], error: 'too-large', message: TOO_LARGE_MESSAGE };
  }
  const jobs = linkedInJobsFromText(text);
  const seen = new Set(linkedInJobsFromText(typeof seenText === 'string' ? seenText : '').map((job) => job.id));
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
    message: linkedInImportMessage({
      added: added.length,
      already: already.length,
      found: jobs.length,
      dryRun,
    }),
  };
}

/**
 * @param {{id: string, url: string}[]} jobs
 * @returns {{url: string, company: string, title: string, location: string, source: string}[]}
 */
const MAIL_HEADER = /^(from|to|subject|date|reply-to|cc|bcc|mime-version|content-type)\s*:/i;
const BOILERPLATE = /^(view job|see job|see all jobs|easy apply|apply now)\b/i;

function looksLikeLocation(line) {
  const text = line.trim();
  // "Remote Software Engineer" is a title. A place is the mode alone,
  // the mode plus a separator ("Remote, US"), or the mode plus one token
  // ("Remote US", "Remote Europe").
  if (/^(?:remote|hybrid|on-?site)(?:\s*$|\s*[-,(\/|·•]|\s+\S+$)/i.test(text)) return true;
  return /,\s*[A-Z]{2}\b/.test(text) && text.length < 80;
}

function titleFromSlug(body, id) {
  const match = body.match(new RegExp(String.raw`/jobs/view/([a-z0-9]+(?:-[a-z0-9]+)*)-${id}(?!\d)`, 'i'));
  if (!match) return null;
  const words = match[1].split('-').filter(Boolean);
  if (!words.length) return null;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function linesAboveIndex(lines, index) {
  if (index < 0) return [];
  const collected = [];
  for (let i = index - 1; i >= 0 && collected.length < 4; i--) {
    const line = lines[i].trim();
    if (!line) {
      if (collected.length) break;
      continue;
    }
    if (/^https?:\/\//i.test(line) || /linkedin\.com\/(?:comm\/)?jobs\//i.test(line)) break;
    if (MAIL_HEADER.test(line)) break;
    if (BOILERPLATE.test(line)) continue;
    collected.push(line);
  }
  return collected.reverse();
}

// First job-link line for each id. Callers were splitting and scanning the
// whole alert once per job, which is quadratic near the size cap.
function jobLineIndex(lines) {
  const index = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (!/jobs\/view|currentJobId/i.test(lines[i])) continue;
    for (const id of lines[i].match(/\d+/g) || []) {
      if (!index.has(id)) index.set(id, i);
    }
  }
  return index;
}

// A pasted line can be a whole paragraph. A real title or company name is far
// shorter, so a longer line is cut before it reaches the pipeline row.
export const MAX_FIELD_LENGTH = 120;

function bounded(line) {
  return line.length > MAX_FIELD_LENGTH ? `${line.slice(0, MAX_FIELD_LENGTH - 1).trimEnd()}…` : line;
}

function fieldsFromAbove(body, lines, lineOf, id) {
  const useful = [];
  for (const line of linesAboveIndex(lines, id && lineOf.has(id) ? lineOf.get(id) : -1)) {
    if (looksLikeLocation(line)) continue;
    useful.push(bounded(line));
  }
  if (useful.length >= 2) return { title: useful[0], company: useful[1] };
  if (useful.length === 1) return { title: useful[0], company: 'LinkedIn' };
  return { title: (id && titleFromSlug(body, id)) || 'Job alert', company: 'LinkedIn' };
}

/**
 * Title and company for one parsed job. The job list itself stays `{id, url}`.
 * A non-URL block above the link wins (title, then company, skipping a location).
 * Otherwise the words in `/jobs/view/{words}-{id}` become the title.
 *
 * @param {string} text
 * @param {{id?: string}} job
 * @returns {{title: string, company: string}}
 */
export function linkedInOfferFields(text, job) {
  const body = typeof text === 'string' ? prepare(text) : '';
  const lines = body.split(/\r?\n/);
  const id = job?.id && /^\d+$/.test(job.id) ? job.id : '';
  return fieldsFromAbove(body, lines, jobLineIndex(lines), id);
}

export function linkedInOffers(jobs, text = '') {
  const body = typeof text === 'string' ? prepare(text) : '';
  const lines = body.split(/\r?\n/);
  const lineOf = jobLineIndex(lines);
  return jobs.map((job) => {
    const id = job?.id && /^\d+$/.test(job.id) ? job.id : '';
    const fields = fieldsFromAbove(body, lines, lineOf, id);
    return {
      url: job.url,
      company: fields.company,
      title: fields.title,
      location: '',
      source: 'linkedin-import',
    };
  });
}
