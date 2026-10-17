// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */

import { decodeEntities } from './_html-entities.mjs';

// BWI provider — scrapes the self-hosted careers site of BWI GmbH (the German
// armed forces' IT service provider). No third-party ATS is involved, so none
// of the feed-based providers match.
//
// Two structured sources, both server-rendered, both zero-token:
//
//   1. The listing page embeds ONE `application/ld+json` CollectionPage whose
//      `mainEntity` is an ItemList of EVERY open position (272 on 2026-08-21) —
//      not just the ~15 cards painted above the fold. Items carry a `url` and
//      nothing else, so the title has to come from the slug.
//   2. Each detail page embeds a proper `JobPosting` with title, datePosted and
//      a `jobLocation.address.addressLocality`.
//
// By default a scan is ONE request: the listing. Every job ships with a title
// rebuilt from its slug and an empty location, which the central
// location_filter treats as pass.
//
// Detail enrichment is opt-in (providers/ADDING_A_PROVIDER.md): with
// `bwi.fetchDetails: true` the provider also reads the detail page of the
// postings whose slug looks security-adjacent, for the real title and the
// city, capped at `bwi.detailLimit` requests (default 45) and skipped while a
// health probe runs. Enrichment failure is never fatal: the job keeps its
// slug-derived title. The RELEVANT pattern is deliberately wider than
// portals.yml's title_filter — it exists to pick enrichment candidates, not to
// filter, so a miss costs a location string and never a job.
//
// Wiring (a single employer, so it goes under tracked_companies:):
//   - name: BWI GmbH
//     provider: bwi
//     careers_url: https://www.bwi.de/karriere/stellenangebote
//     enabled: true
//     bwi:
//       fetchDetails: true   # optional: real title + city for security-adjacent postings
//       detailLimit: 45      # optional max detail requests when fetchDetails=true (1-100)

const LIST_URL = 'https://www.bwi.de/karriere/stellenangebote';
const ALLOWED_HOST = 'www.bwi.de';

/**
 * Reject anything that is not an HTTPS URL on the BWI careers host. Detail URLs
 * come out of the listing page's JSON-LD, i.e. from remote content, so they are
 * validated before being fetched (see assertGreenhouseUrl for the pattern).
 * @param {string} url
 */
export function assertBwiUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`bwi: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`bwi: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== ALLOWED_HOST)
    throw new Error(`bwi: untrusted hostname "${parsed.hostname}" — must be ${ALLOWED_HOST}`);
  return url;
}
const JOB_URL_RE = /"url":\s*"(https:\/\/www\.bwi\.de\/karriere\/stellenangebote\/job\/[^"]+)"/g;
const LD_JSON_RE = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;

// Wide on purpose — see the note above. Picks enrichment candidates only.
const RELEVANT = /security|secops|sicherheit|soc|cyber|forensik|forensic|incident|detection|siem|analyst|defense|abwehr/i;
const DETAIL_BUDGET = 45;
const DETAIL_LIMIT_MAX = 100;

/**
 * @param {any} entry
 * @returns {{ fetchDetails: boolean, detailLimit: number }}
 */
export function parseBwiConfig(entry) {
  const cfg = (entry && entry.bwi) || {};
  const n = Number(cfg.detailLimit);
  return {
    fetchDetails: cfg.fetchDetails === true,
    detailLimit: Number.isInteger(n) && n >= 1 && n <= DETAIL_LIMIT_MAX ? n : DETAIL_BUDGET,
  };
}

// Trailing `-m-w-d-69624` / `-m-d-w-69624` / bare `-69624` is boilerplate, not title.
const SLUG_TAIL_RE = /-(?:m-w-d|m-d-w|w-m-d|d-m-w)?-?\d{4,6}$/i;

export function slugToTitle(url) {
  let slug;
  try {
    slug = new URL(url).pathname.split('/').pop() || '';
  } catch {
    return '';
  }
  const gendered = /-(?:m-w-d|m-d-w|w-m-d|d-m-w)-?\d{4,6}$/i.test(slug);
  const core = slug.replace(SLUG_TAIL_RE, '');
  if (!core) return '';
  const words = core
    .split('-')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(' ') + (gendered ? ' (m/w/d)' : '');
}

export function collectJobUrls(html) {
  const urls = [];
  const seen = new Set();
  for (const m of html.matchAll(JOB_URL_RE)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      urls.push(m[1]);
    }
  }
  return urls;
}

// Detail pages carry several ld+json blocks; only the JobPosting is useful.
export function parseJobPosting(html) {
  for (const m of html.matchAll(LD_JSON_RE)) {
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue; // malformed block — try the next one
    }
    if (data && data['@type'] === 'JobPosting') return data;
  }
  return null;
}

function localityOf(posting) {
  const loc = posting?.jobLocation;
  const first = Array.isArray(loc) ? loc[0] : loc;
  const city = first?.address?.addressLocality;
  return typeof city === 'string' ? city.trim() : '';
}

/** @type {Provider} */
export default {
  id: 'bwi',

  detect(entry) {
    if (entry.provider === 'bwi') return { url: LIST_URL };
    const raw = entry.careers_url || '';
    try {
      if (new URL(raw).hostname === ALLOWED_HOST) return { url: LIST_URL };
    } catch {
      /* not a URL → no match */
    }
    return null;
  },

  async fetch(entry, ctx) {
    const listing = await ctx.fetchText(LIST_URL, { redirect: 'error' });
    const urls = collectJobUrls(listing);

    /** @type {Job[]} */
    const jobs = urls
      .map(url => ({ title: slugToTitle(url), url, company: entry.name, location: '' }))
      .filter(j => j.title);

    // Detail enrichment is opt-in, and never runs under verify-portals' health
    // probe (ctx.maxPages = 1): the listing alone tells a live board from a
    // broken one. detailLimit caps the loop; it is never what turns it on.
    const { fetchDetails, detailLimit } = parseBwiConfig(entry);
    const probing = Number(ctx?.maxPages) > 0;
    if (!fetchDetails || probing) return jobs;

    let spent = 0;
    for (const job of jobs) {
      if (spent >= detailLimit) break;
      if (!RELEVANT.test(job.url)) continue;
      spent++;
      try {
        const posting = parseJobPosting(await ctx.fetchText(assertBwiUrl(job.url), { redirect: 'error' }));
        if (!posting) continue;
        if (typeof posting.title === 'string' && posting.title.trim()) {
          job.title = decodeEntities(posting.title);
        }
        job.location = decodeEntities(localityOf(posting));
      } catch {
        // Detail enrichment is best-effort — keep the slug-derived title.
      }
    }

    return jobs;
  },
};
