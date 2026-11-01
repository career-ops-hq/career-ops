// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */

// Factorial (factorial.com, the HR software company) — the careers sites its
// ATS hosts for each customer, one tenant per `tracked_companies:` entry:
//
//   - name: Acme
//     careers_url: https://acme.factorialhr.com
//
// A tenant lives at `<tenant>.factorialhr.com`, which 301s to
// `<tenant>.factorial.com`; both are claimed, and the request goes straight to
// the `.factorial.com` origin because redirects are refused. Factorial's own
// board is the `careers` tenant (careers.factorialhr.com). Hosts that are
// Factorial's product rather than a board (www, app, api, help, blog) are not
// claimed. A tenant that does not exist answers 404, so a mistyped slug is a
// loud error, not an empty board.
//
// The board's home page server-renders every posting, grouped by office:
//
//   <div data-target='job-filters.officeGroup'>
//     <h3 …>Barcelona</h3>
//     <li class='job-offer-item …' data-is-remote='false'
//         data-job-postings-url='https://<tenant>.factorial.com/job_posting/<slug>-<id>' …>
//       <div class="… factorial__headingFontFamily">Account Executive</div>
//
// One request reads the whole board (94 postings on Factorial's own board,
// measured 2026-11-01; no pagination was seen). The list carries no date and
// no description: those are on each posting page, which is not fetched.
// robots.txt on the tenants read was `User-agent: * / Allow: /`.

import { decodeEntities } from './_html-entities.mjs';

const TENANT_HOST_RE = /^([a-z0-9][a-z0-9-]*)\.(?:factorialhr|factorial)\.com$/;
/** Subdomains that are Factorial's product or marketing, not a careers board. */
const NOT_A_BOARD = new Set(['www', 'app', 'api', 'help', 'blog']);

/**
 * The tenant's board origin (`https://<tenant>.factorial.com`), or null when
 * the URL is not a Factorial tenant board.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function resolveFactorialOrigin(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const m = TENANT_HOST_RE.exec(parsed.hostname.toLowerCase());
  if (!m || NOT_A_BOARD.has(m[1])) return null;
  return `https://${m[1]}.factorial.com`;
}

/** @param {string} html */
function text(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Reads one attribute value from a start tag (single or double quotes).
 * @param {string} tag
 * @param {string} name
 */
function attr(tag, name) {
  const m = new RegExp(`\\s${name}=(?:'([^']*)'|"([^"]*)")`).exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? '') : '';
}

const POSTING_HREF_RE = /\/job_posting\/[a-z0-9-]+/i;

/**
 * Parses a tenant board's home page. Exported for unit tests.
 *
 * Throws when the page links to postings but no card could be read (the
 * markup changed); a page with no posting links is an empty board.
 *
 * @param {string} html
 * @param {string} origin - the board origin the page was read from
 * @param {string} company
 * @returns {Job[]}
 */
export function parseFactorialBoard(html, origin, company) {
  const page = String(html ?? '');
  const host = new URL(origin).hostname;
  // One entry per posting URL. Offices and the remote flag are kept apart and
  // the location is rendered once at the end, so a posting listed under a
  // second office cannot repeat a place already in its location.
  /** @type {Map<string, { job: Job, offices: string[], remote: boolean }>} */
  const byUrl = new Map();

  // Each office group starts at its marker; a card's office is the heading of
  // the group it sits in. Cards before the first marker get no office.
  const parts = page.split(/data-target=['"]job-filters\.officeGroup['"]/);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const heading = i === 0 ? '' : text((/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(part) || [])[1] || '');
    const cards = part.split(/<li\s+class=['"]job-offer-item\b/).slice(1);
    for (const card of cards) {
      const tag = card.slice(0, card.indexOf('>') + 1);
      const rawUrl = attr(tag, 'data-job-postings-url');
      let url;
      try {
        url = new URL(rawUrl);
      } catch {
        continue;
      }
      if (url.protocol !== 'https:' || url.hostname !== host || !POSTING_HREF_RE.test(url.pathname)) continue;
      const titleMatch = /factorial__headingFontFamily[^>]*>([\s\S]*?)<\//.exec(card);
      const title = titleMatch ? text(titleMatch[1]) : '';
      if (!title) continue;

      const remote = attr(tag, 'data-is-remote') === 'true';
      const office = heading || attr(tag, 'data-location-key').replace(/^city:/, '');

      const key = url.href;
      let entry = byUrl.get(key);
      if (!entry) {
        /** @type {Job} */
        const job = { title, url: key, company, location: '' };
        const id = /-(\d+)\/?$/.exec(url.pathname);
        if (id) job.externalId = id[1];
        entry = { job, offices: [], remote: false };
        byUrl.set(key, entry);
      }
      // The same posting listed under a second office: one row, both places.
      if (office && !entry.offices.includes(office)) entry.offices.push(office);
      entry.remote ||= remote;
    }
  }

  const jobs = [...byUrl.values()].map(({ job, offices, remote }) => {
    const places = [offices.join(' / ')];
    if (remote && !offices.some((o) => /\bremote\b/i.test(o))) places.push('Remote');
    job.location = places.filter(Boolean).join(' · ');
    return job;
  });
  if (jobs.length === 0 && POSTING_HREF_RE.test(page)) {
    throw new Error(`factorial: ${origin} links to job postings but none could be parsed — the board markup changed`);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'factorial',

  /**
   * Claims an entry whose careers_url (or api) is a Factorial tenant board.
   * @param {{ careers_url?: unknown, api?: unknown }} entry
   */
  detect(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const origin = resolveFactorialOrigin(entry.api) || resolveFactorialOrigin(entry.careers_url);
    return origin ? { url: `${origin}/` } : null;
  },

  /**
   * One request for the whole board. The origin is rebuilt from the matched
   * tenant label, so no path or port from the entry reaches the request.
   * @param {{ name?: string, careers_url?: unknown, api?: unknown }} entry
   * @param {{ fetchText: (url: string, opts?: object) => Promise<string> }} ctx
   */
  async fetch(entry, ctx) {
    const origin = resolveFactorialOrigin(entry?.api) || resolveFactorialOrigin(entry?.careers_url);
    if (!origin) throw new Error(`factorial: ${entry?.name ?? 'entry'} is not a <tenant>.factorialhr.com or <tenant>.factorial.com board`);
    const html = await ctx.fetchText(`${origin}/`, { redirect: 'error' });
    return parseFactorialBoard(html, origin, String(entry?.name ?? ''));
  },
};
