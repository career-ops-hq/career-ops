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
  const addedLine = added === 1 ? '1 LinkedIn job added' : `${added} LinkedIn jobs added`;
  if (already === 0) return `${addedLine}.`;
  const alreadyLine = already === 1 ? '1 was already in your list' : `${already} were already in your list`;
  return `${addedLine}. ${alreadyLine}.`;
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
export function linkedInOffers(jobs) {
  return jobs.map((job) => ({
    url: job.url,
    company: 'LinkedIn',
    title: 'Job alert',
    location: '',
    source: 'linkedin-import',
  }));
}
