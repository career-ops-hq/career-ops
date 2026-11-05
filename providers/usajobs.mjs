// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// USAJobs provider — US federal job board, documented public Search API
// (https://developer.usajobs.gov/APIs/Search). Listings are published by the
// hiring agency, free to read and apply to. Explicit-only: wire in via a
// `job_boards:` entry with `provider: usajobs`.
//
// Credentials stay out of this file and out of git. Both come from the
// data-root `.env` (loaded by scan.mjs):
//   USAJOBS_API_KEY        — key from https://developer.usajobs.gov/APIKeyRequest
//   USAJOBS_CONTACT_EMAIL  — the address the API requires in its User-Agent header
// Without both, the provider returns nothing and says so, so a missing key never
// turns into a silent empty scan.

const SEARCH_URL = 'https://data.usajobs.gov/api/search';
const PAGE_SIZE = 500; // API maximum
const MAX_PAGES = 4;   // hard cap: 2,000 results per search term

// Early-career software, data and ML terms. Overridable per entry via
// `search_terms: [...]`; the scan's title_filter still decides what is kept.
const DEFAULT_TERMS = [
  'software engineer intern',
  'software engineer new grad',
  'data science intern',
  'machine learning intern',
  'data analyst intern',
];

/** @param {unknown} v */
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Maps one SearchResultItem to the scanner's Job shape. Returns null when the
 * item lacks the fields the scanner needs (title and a public URL).
 * @param {any} item
 * @returns {{title: string, url: string, company: string, location: string, postedAt?: number, requisitionId?: string, description?: string} | null}
 */
export function mapItem(item) {
  const d = item?.MatchedObjectDescriptor;
  if (!d) return null;
  const title = str(d.PositionTitle);
  const url = str(d.PositionURI);
  if (!title || !/^https:\/\/(www\.)?usajobs\.gov\//i.test(url)) return null;

  const locs = Array.isArray(d.PositionLocation) ? d.PositionLocation : [];
  const location = locs.map((l) => str(l?.LocationName)).filter(Boolean).join('; ');
  const agency = str(d.OrganizationName) || str(d.DepartmentName) || 'USAJobs';
  const posted = Date.parse(str(d.PublicationStartDate));

  /** @type {any} */
  const job = { title, url, company: agency, location };
  if (Number.isFinite(posted)) job.postedAt = posted;
  const reqId = str(d.PositionID) || str(item.MatchedObjectId);
  if (reqId) job.requisitionId = reqId;
  const desc = str(d.QualificationSummary) || str(d.UserArea?.Details?.JobSummary);
  if (desc) job.description = desc;
  return job;
}

/** @type {Provider} */
export default {
  id: 'usajobs',

  // No detect(): reachable only through an explicit `provider: usajobs` entry,
  // so this provider never claims a careers URL the user did not point at it.

  /**
   * @param {{ name?: string, search_terms?: string[] }} entry
   * @param {{ fetchJson: (url: string, opts?: any) => Promise<any>, sleep?: (ms: number) => Promise<void> }} ctx
   * @returns {Promise<any[]>}
   */
  async fetch(entry, ctx) {
    const key = str(process.env.USAJOBS_API_KEY);
    const email = str(process.env.USAJOBS_CONTACT_EMAIL);
    if (!key || !email) {
      console.warn(`usajobs: skipped — set USAJOBS_API_KEY and USAJOBS_CONTACT_EMAIL in the data-root .env`);
      return [];
    }

    const terms = Array.isArray(entry.search_terms) && entry.search_terms.length
      ? entry.search_terms.map(str).filter(Boolean)
      : DEFAULT_TERMS;

    /** @type {Map<string, any>} */
    const seen = new Map();
    for (const term of terms) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const params = new URLSearchParams({
          Keyword: term,
          ResultsPerPage: String(PAGE_SIZE),
          Page: String(page),
          DatePosted: '30', // last 30 days; the scanner's age filter applies on top
        });
        // The API requires the contact email in User-Agent and the key in a header.
        const json = await ctx.fetchJson(`${SEARCH_URL}?${params}`, {
          redirect: 'error',
          headers: { 'Authorization-Key': key, 'User-Agent': email },
        });
        const items = json?.SearchResult?.SearchResultItems;
        if (!Array.isArray(items)) {
          throw new Error(`usajobs: unexpected API response — missing SearchResult.SearchResultItems`);
        }
        for (const it of items) {
          const job = mapItem(it);
          if (job && !seen.has(job.url)) seen.set(job.url, job);
        }
        const total = Number(json?.SearchResult?.SearchResultCountAll) || 0;
        if (items.length < PAGE_SIZE || page * PAGE_SIZE >= total) break;
        if (ctx.sleep) await ctx.sleep(500);
      }
    }
    return [...seen.values()];
  },
};
