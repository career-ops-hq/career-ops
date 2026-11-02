// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Zoho Recruit provider — target list: `tracked_companies:` (one Zoho Recruit
// tenant's career site per entry).
//
// Auto-detects any `https://<tenant>.zohorecruit.com` careers_url. Only the
// hostname is used: the board is always read from `/jobs/Careers`, which every
// tenant with the current career site serves, whatever its own portal name
// (`Emplois`, …) or the path the configured URL carries (a posting, the bare
// host, the legacy `/recruit/Portal.na`). Posting URLs are built under the
// same path.
//
// The career site is server-rendered: the whole board sits in the list page
// as `<input type="hidden" id="jobs" value="[…]">`, a JSON array whose
// quotes are HTML-entity-escaped. One list request per tenant, no auth.
//   - `id="jobs"` present with `[]`     → a live board with nothing open.
//   - `id="jobs"` absent on the page   → throw. Zoho answers 200 with a
//     "Page does not exist" page for an unknown tenant, and for a tenant that
//     only has the legacy career site, so a missing input is the only signal
//     that tells a broken or unsupported board from an empty one.
// Rows marked `Is_Locked: true` or `Publish: false` are postings the career
// site shows as filled, and are skipped.
//
// Each posting's own page (`/jobs/Careers/<id>`) embeds its record as a
// JavaScript string literal, `var jobs = JSON.parse('[…]')`, with HTML
// `Job_Description`, `Date_Opened` and a free-text `Salary`.
// parseZohoDetailPage() reads it without evaluating any script; the scan
// uses it only under the opt-in below, and liveness-api.mjs /
// browser-extract.mjs use it for a posting's liveness and JD text.
//
//   - name: Example Zoho Recruit Co
//     careers_url: https://exampleco.zohorecruit.com/jobs/Careers
//     zohoRecruit:
//       fetchDetails: true   # optional: fetch each posting's page for description, date and salary
//       detailLimit: 25      # optional: max detail fetches per sweep (1..100, default 25)

import { intInRange } from './_config-utils.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { fetchTextWithRetry, sleep } from './_http.mjs';
import { compensationCurrency, parseAnnualCompensation } from './_salary-text.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

const ZOHO_HOST_RE = /^[a-z0-9][a-z0-9-]*\.zohorecruit\.com$/;
const BOARD_PATH = '/jobs/Careers';
const DETAIL_PACE_MS = 250;

/** @param {unknown} value */
function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** @param {unknown} value */
function toEpochMs(value) {
  if (!value || typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse an entry's careers_url / api into its Zoho Recruit host, or null for
 * anything that is not an HTTPS `<tenant>.zohorecruit.com` URL.
 * @param {any} entry
 * @returns {URL | null}
 */
function parseZohoUrl(entry) {
  const raw = str(entry?.careers_url) || str(entry?.api);
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!ZOHO_HOST_RE.test(parsed.hostname)) return null;
  return parsed;
}

/**
 * The board an entry points at: the origin rebuilt from the hostname alone,
 * and the fixed list path. The configured path and port are discarded.
 * @param {any} entry
 * @returns {{ origin: string, boardUrl: string } | null}
 */
export function resolveZohoBoard(entry) {
  const parsed = parseZohoUrl(entry);
  if (!parsed) return null;
  const origin = `https://${parsed.hostname}`;
  return { origin, boardUrl: `${origin}${BOARD_PATH}` };
}

// A tag ends at an unquoted `>`: a JSON value inside an attribute can carry a
// literal `>`.
const INPUT_TAG_RE = /<input\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

/**
 * The raw job records from a list page's `<input id="jobs">`. Throws when the
 * input is missing or its value is not a JSON array — a missing page or a
 * markup change, never an empty board.
 * @param {unknown} html
 * @returns {any[]}
 */
export function extractZohoListRecords(html) {
  if (typeof html !== 'string' || !html.trim()) {
    throw new Error('zoho-recruit: empty careers page');
  }
  let value = null;
  for (const [tag] of html.matchAll(INPUT_TAG_RE)) {
    if (!/\sid\s*=\s*["']?jobs["'\s/>]/i.test(tag)) continue;
    const attr = tag.match(/\svalue\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    value = attr ? (attr[1] ?? attr[2] ?? '') : '';
    break;
  }
  if (value === null) {
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
    throw new Error(`zoho-recruit: no id="jobs" input on ${BOARD_PATH} — an unknown tenant, or one with only the legacy career site, which is not supported${title ? ` (page title: "${decodeEntities(title)}")` : ''}`);
  }
  let records;
  try {
    records = JSON.parse(decodeEntities(value));
  } catch (err) {
    throw new Error(`zoho-recruit: id="jobs" value is not JSON (${/** @type {Error} */ (err).message})`);
  }
  if (!Array.isArray(records)) {
    const got = records && typeof records === 'object' ? `{${Object.keys(records).join(', ')}}` : typeof records;
    throw new Error(`zoho-recruit: id="jobs" value is not an array, got: ${got}`);
  }
  return records;
}

/**
 * True for a record the career site shows as filled.
 * @param {any} record
 */
export function isZohoRecordClosed(record) {
  return record?.Is_Locked === true || record?.Publish === false;
}

/**
 * Location from the tenant-configured fields: city, state and country as
 * given, then "Remote" when the posting is flagged remote.
 * @param {any} record
 */
function locationOf(record) {
  const parts = [str(record.City), str(record.State), str(record.Country)].filter(Boolean);
  if (record.Remote_Job === true) parts.push('Remote');
  return [...new Set(parts)].join(', ');
}

/**
 * Normalize one list record, or null when it is filled or lacks a title/id.
 * @param {any} record
 * @param {{ origin: string }} board
 * @param {string} company
 * @returns {import('./_types.js').Job | null}
 */
function normalizeRecord(record, board, company) {
  if (!record || typeof record !== 'object' || isZohoRecordClosed(record)) return null;
  const title = str(record.Posting_Title) || str(record.Job_Opening_Name);
  if (!title) return null;
  const id = typeof record.id === 'number' ? String(record.id) : str(record.id);
  if (!id) return null;
  const seg = safeEncodeURIComponent(id);
  if (seg === null) return null;
  /** @type {import('./_types.js').Job} */
  const job = {
    title,
    url: `${board.origin}${BOARD_PATH}/${seg}`,
    company,
    location: locationOf(record),
    externalId: id,
  };
  const postedAt = toEpochMs(record.Date_Opened);
  if (postedAt !== undefined) job.postedAt = postedAt;
  const description = htmlToText(record.Job_Description);
  if (description) job.description = description;
  return job;
}

/**
 * List page → normalized jobs. Exported for tests.
 * @param {unknown} html
 * @param {{ origin: string }} board
 * @param {string} company
 */
export function parseZohoJobsPage(html, board, company) {
  return pairRecords(extractZohoListRecords(html), board, company).map(({ job }) => job);
}

/**
 * @param {any[]} records
 * @param {{ origin: string }} board
 * @param {string} company
 * @returns {Array<{ job: import('./_types.js').Job, record: any }>}
 */
function pairRecords(records, board, company) {
  const seen = new Set();
  const out = [];
  for (const record of records) {
    const job = normalizeRecord(record, board, company);
    if (!job || seen.has(job.url)) continue;
    seen.add(job.url);
    out.push({ job, record });
  }
  return out;
}

const JS_ESCAPES = /** @type {Record<string, string>} */ ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' });

/**
 * Unescape the body of a single-quoted JavaScript string literal (`\x22`,
 * `\u00e9`, `\n`, `\/`, `\-`, `\'`, line continuations). Never evaluates code.
 * @param {string} body
 */
function unescapeJsString(body) {
  return body.replace(/\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|u\{([0-9a-fA-F]{1,6})\}|(\r\n|[\s\S]))/g,
    (_, hex, u4, uBraced, ch) => {
      if (hex) return String.fromCharCode(parseInt(hex, 16));
      if (u4) return String.fromCharCode(parseInt(u4, 16));
      if (uBraced) {
        const cp = parseInt(uBraced, 16);
        return cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
      }
      if (ch === '\n' || ch === '\r' || ch === '\r\n' || ch === '\u2028' || ch === '\u2029') return '';
      return JS_ESCAPES[ch] ?? ch;
    });
}

const DETAIL_RECORD_RE = /\bjobs\s*=\s*JSON\.parse\(\s*'((?:[^'\\]|\\[\s\S])*)'\s*\)/;

/**
 * The posting record embedded in a detail page, or null when the page carries
 * none (a removed posting, an error page, a markup change). Exported for
 * liveness-api.mjs and browser-extract.mjs.
 * @param {unknown} html
 * @returns {Record<string, any> | null}
 */
export function parseZohoDetailPage(html) {
  if (typeof html !== 'string') return null;
  const match = html.match(DETAIL_RECORD_RE);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(unescapeJsString(match[1]));
  } catch {
    return null;
  }
  const record = Array.isArray(parsed) ? parsed[0] : parsed;
  return record && typeof record === 'object' && !Array.isArray(record) ? record : null;
}

/**
 * Annual salary from a detail record's free-text `Salary` field, never
 * inferred. Currency: the one the text names, else the list record's
 * `Currency` field when the text names none, else unset. A non-annual period
 * ("$20-25/hr") or an unreadable amount yields null.
 * @param {unknown} salaryText
 * @param {unknown} [listCurrency]
 * @returns {{ min: number, max: number, currency?: string } | null}
 */
export function parseZohoSalary(salaryText, listCurrency) {
  const text = str(salaryText);
  if (!text) return null;
  const amount = parseAnnualCompensation(text);
  if (!amount || !(amount.max > 0)) return null;
  const named = compensationCurrency(text);
  const fallback = /^[A-Za-z]{3}$/.test(str(listCurrency)) ? str(listCurrency).toUpperCase() : '';
  const currency = named === undefined ? fallback : named;
  return { min: amount.min, max: amount.max, ...(currency ? { currency } : {}) };
}

/** @param {any} entry */
function parseZohoConfig(entry) {
  const cfg = (entry && entry.zohoRecruit) || {};
  return {
    fetchDetails: cfg.fetchDetails === true,
    detailLimit: intInRange(cfg.detailLimit, 25, 1, 100),
  };
}

/**
 * Fill description, postedAt and salary from each posting's own page.
 * Best-effort: a failed or unreadable detail fetch, or a page whose record is
 * not this posting's, keeps the list row.
 * @param {Array<{ job: import('./_types.js').Job, record: any }>} rows
 * @param {any} ctx
 */
async function enrichFromDetails(rows, ctx) {
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) await sleep(DETAIL_PACE_MS, ctx);
    const { job, record } = rows[i];
    try {
      const html = await fetchTextWithRetry(ctx, job.url, { redirect: 'error' });
      const detail = parseZohoDetailPage(html);
      if (!detail || String(detail.id) !== job.externalId) continue;
      const description = htmlToText(detail.Job_Description);
      if (description) job.description = description;
      if (job.postedAt === undefined) {
        const postedAt = toEpochMs(detail.Date_Opened);
        if (postedAt !== undefined) job.postedAt = postedAt;
      }
      const salary = parseZohoSalary(detail.Salary, record.Currency);
      if (salary) job.salary = salary;
    } catch {
      // Detail enrichment is opt-in; keep the list row as-is.
    }
  }
}

/** @type {Provider} */
export default {
  id: 'zoho-recruit',

  detect(entry) {
    const board = resolveZohoBoard(entry);
    return board ? { url: board.boardUrl } : null;
  },

  async fetch(entry, ctx) {
    const board = resolveZohoBoard(entry);
    if (!board) {
      throw new Error(`zoho-recruit: ${entry?.name || '(unnamed)'} needs an https://<tenant>.zohorecruit.com careers_url`);
    }
    const html = await fetchTextWithRetry(ctx, board.boardUrl, { redirect: 'error' });
    const rows = pairRecords(extractZohoListRecords(html), board, str(entry?.name));

    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const { fetchDetails, detailLimit } = parseZohoConfig(entry);
    if (fetchDetails && !probing) await enrichFromDetails(rows.slice(0, detailLimit), ctx);
    return rows.map(({ job }) => job);
  },
};
