/**
 * lib/naukri-url.mjs — what a Naukri posting URL says in its own bytes.
 *
 * Naukri has no zero-auth source an agent can read. Measured on 2026-11-20:
 *
 *   - `https://www.naukri.com/python-jobs` and a posting URL both answer 200
 *     with ~38 KB of client-rendered Next.js shell: no `<title>`, no cards, and
 *     the flight payload ships `jobDetailsResp: {data: null, loading: true}`.
 *   - The JSON the page's own client fetches,
 *     `GET /jobapi/v3/search?...`, answers
 *     `{"message":"recaptcha required","statusCode":406}` to a bare request.
 *   - `https://www.naukri.com/robots.txt` names the AI crawlers it blocks
 *     (`GPTBot`, `ClaudeBot`, `Claude-User`, …) with `Disallow: /`.
 *
 * So Naukri stays out of `providers/` (docs/NAUKRI.md has the full record and
 * docs/SOURCE_INDEXING_LOG.md the policy verdict), and the URL is the whole
 * surface: `job-listings-{slug}-{id}` names the posting in its `id` — the
 * identity tracker dedup needs — and encodes the experience band the poster
 * filled in. This module reads exactly that. It never fetches anything, and it
 * never guesses a company name out of the slug (the slug has no delimiter
 * between the title and the employer, so a guess would be wrong often enough to
 * send `confirm-at-employer.mjs` to the wrong board).
 */

const HOST = 'naukri.com';

// `/job-listings-{slug}-{id}`, with the slug optional: naukri.com resolves the
// id alone (`/job-listings-011026501721` answered 200 on 2026-11-20), and every
// one of the 11,626 posting URLs in one city sitemap
// (`/sitemap/jobDescPagesNoida.xml`) carried a 12-digit id.
const POSTING_PATH = /^\/job-listings-(?:.+-)?(\d{6,})$/;

/**
 * Is this hostname Naukri's? Label boundary, never a substring:
 * `naukri.com.evil.example` and `mynaukri.com` are both not Naukri.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
export function isNaukriHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return host === HOST || host.endsWith(`.${HOST}`);
}

/**
 * Experience band the poster picked, read from the slug (`5-to-8-years`).
 * null when the slug carries no recognizable band — never a guess.
 *
 * @param {string} slug
 * @returns {{min: number, max: number}|null}
 */
export function naukriExperienceFromSlug(slug) {
  const text = String(slug || '');
  const range = /(?:^|-)(\d{1,2})-to-(\d{1,2})-years$/.exec(text);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const single = /(?:^|-)(\d{1,2})-years$/.exec(text);
  if (single) return { min: Number(single[1]), max: Number(single[1]) };
  return null;
}

/**
 * Parse a Naukri posting URL. Returns null for anything that is not one,
 * including a search page, a company page, a look-alike host and junk — this
 * is called on untrusted pasted text, so it must not throw.
 *
 * @param {string} raw
 * @returns {{url: string, id: string, slug: string, experience: {min: number, max: number}|null}|null}
 */
export function parseNaukriPosting(raw) {
  if (typeof raw !== 'string') return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!isNaukriHost(url.hostname)) return null;
  const path = url.pathname.replace(/\/+$/, '');
  const match = POSTING_PATH.exec(path);
  if (!match) return null;
  const id = match[1];
  const slug = path.slice('/job-listings-'.length, path.length - id.length - 1);
  return {
    // Rebuilt on www: the mobile host (`m.naukri.com`) answers 403 to the same
    // path (measured 2026-11-20), so a link saved from it would never open.
    url: `https://www.naukri.com${path}`,
    id,
    slug,
    experience: naukriExperienceFromSlug(slug),
  };
}

/**
 * The posting id a Naukri URL carries, or null. This is the identity
 * `url-key.mjs` dedups on: the slug in front of the id is SEO text that changes
 * when the poster edits the title, so two spellings of one posting must reduce
 * to the same id.
 *
 * @param {string} raw
 * @returns {string|null}
 */
export function naukriPostingId(raw) {
  return parseNaukriPosting(raw)?.id ?? null;
}
