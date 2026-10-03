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
// Fetching 272 detail pages per scan would be absurd, so the provider derives a
// readable title from the slug for every job and only enriches the ones whose
// slug looks security-adjacent (capped at DETAIL_BUDGET). Enrichment failure is
// never fatal: the job still ships with its slug-derived title and an empty
// location, which the central location_filter treats as pass. The RELEVANT
// pattern is deliberately wider than portals.yml's title_filter — it exists to
// pick enrichment candidates, not to filter, so a miss costs a location string
// and never a job.
//
// Wiring:
//   - name: BWI GmbH
//     provider: bwi
//     careers_url: https://www.bwi.de/karriere/stellenangebote
//     enabled: true

const LIST_URL = 'https://www.bwi.de/karriere/stellenangebote';
const ALLOWED_HOST = 'www.bwi.de';

/**
 * Reject anything that is not an HTTPS URL on the BWI careers host. Detail URLs
 * come out of the listing page's JSON-LD, i.e. from remote content, so they are
 * validated before being fetched (see assertGreenhouseUrl for the pattern).
 * @param {string} url
 */
function assertBwiUrl(url) {
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

    let spent = 0;
    for (const job of jobs) {
      if (spent >= DETAIL_BUDGET) break;
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
