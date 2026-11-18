// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */

import { decodeEntities } from './_html-entities.mjs';
import { fetchTextWithRetry, isCloudflareChallenge } from './_http.mjs';
import { workplaceField } from './_workplace-type.mjs';

// Viterbit (viterbit.com) — the Spanish ATS behind the careers sites of
// employers such as Prosegur, one `tracked_companies:` entry per site:
//
//   - name: Acme
//     provider: viterbit
//     careers_url: https://careers.acme.example/
//
// Explicit-only (no `detect()`): the sites seen run on the employer's own
// domain (careers.prosegur.com, careers.viterbit.com). The vendor-hosted
// `<slug>.viterbit.site` hosts answered a Cloudflare challenge
// (`cf-mitigated: challenge`, HTTP 403) to a plain request on 2026-11-18, so
// there is no vendor host this provider can claim and read. When a site does
// answer with such a challenge, `fetch()` says so and stops; it does not try
// to get past it.
//
// The home page is server-rendered with every posting at once (its paginator
// runs in the browser: `data-pagination="10"` over a single response), one
// card per posting:
//
//   <a href="/<slug>-<id>/" class="kt-widget4__username vb-job-title">Title</a>
//   <p class="kt-widget4__text …"><i class="la la-map-marker"></i> City (Híbrido)</p>
//   <p class="kt-widget4__text …"><i class="la la-clock-o"></i> hace 3 días</p>
//
// One request returns the whole board (176 postings on careers.prosegur.com,
// 3 on careers.viterbit.com, measured 2026-11-18; the Prosegur page is about
// 1 MB). The card carries no absolute date, only an age in words, so `postedAt`
// is the calendar day that age implies; it carries no description. Both pages'
// robots.txt allowed everything on 2026-11-18.

/** @param {unknown} raw @returns {string | null} `https://<hostname>`, or null */
export function resolveViterbitOrigin(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  // Only the host is taken: no path, port or credentials from the entry
  // reach the request.
  return `https://${parsed.hostname}`;
}

/** @param {string} html */
function text(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Age units in the Spanish and English the sites render, in days. */
const UNIT_DAYS = /** @type {Array<[RegExp, number]>} */ ([
  [/^(segundo|minuto|hora|second|minute|hour)/i, 0],
  [/^(d[ií]a|day)/i, 1],
  [/^(semana|week)/i, 7],
  [/^(mes|month)/i, 30],
  [/^(a[nñ]o|year)/i, 365],
]);

/**
 * "hace 3 días", "hace 1 mes", "2 days ago", "hoy": the UTC midnight of the
 * calendar day that age implies, so the same posting keeps the same date from
 * one run to the next. Undefined when the text says nothing parseable.
 * @param {string} label
 * @param {number} [nowMs]
 * @returns {number | undefined}
 */
export function parsePostedAt(label, nowMs = Date.now()) {
  let days;
  if (/\b(hoy|today)\b/i.test(label)) days = 0;
  else if (/\b(ayer|yesterday)\b/i.test(label)) days = 1;
  else {
    const m = /(\d+)\s*([a-zñáíé]+)/i.exec(label);
    const unit = m && UNIT_DAYS.find(([re]) => re.test(m[2]));
    if (m && unit) days = Number(m[1]) * unit[1];
  }
  if (days === undefined) return undefined;
  const now = new Date(nowMs);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days);
}

/** The work model the card puts in brackets after the city. */
const WORKPLACE = /** @type {Array<[RegExp, string]>} */ ([
  [/remot|remote/i, 'remote'],
  [/h[ií]brid|hybrid/i, 'hybrid'],
  [/presencial|on-?site/i, 'onsite'],
]);

/**
 * Parses a site's home page. Exported for unit tests.
 *
 * Throws when the page has job cards but none could be read, and when it has
 * neither cards nor Viterbit's "no offers" block (`id="empty-jobs"`), which
 * means this is not a Viterbit careers page or its markup changed. A page
 * with the "no offers" block and no cards is an empty board.
 *
 * @param {string} html
 * @param {string} origin - the origin the page was read from
 * @param {string} company
 * @returns {Job[]}
 */
export function parseViterbitBoard(html, origin, company) {
  const page = String(html ?? '');
  const anchors = [...page.matchAll(/<a\b([^>]*\bvb-job-title\b[^>]*)>([\s\S]*?)<\/a>/g)];
  /** @type {Map<string, Job>} */
  const byUrl = new Map();
  anchors.forEach((a, i) => {
    const href = /\bhref=(?:"([^"]*)"|'([^']*)')/.exec(a[1]);
    const title = text(a[2]);
    if (!href || !title) return;
    let url;
    try {
      url = new URL(decodeEntities(href[1] ?? href[2] ?? ''), `${origin}/`);
    } catch {
      return;
    }
    if (url.origin !== origin || byUrl.has(url.href)) return;
    // The card's own <p>s sit between its title and the next card's title.
    const from = (a.index ?? 0) + a[0].length;
    const paras = [...page.slice(from, anchors[i + 1]?.index ?? from + 3000).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
    const place = text(paras.find((p) => /map-marker/.test(p)) ?? '');
    const age = text(paras.find((p) => /la-clock/.test(p)) ?? '');
    const withModel = /^(.*?)\s*\(([^)]+)\)$/.exec(place); // "Madrid (Híbrido)"
    const city = (withModel ? withModel[1] : place).trim();
    const model = withModel ? WORKPLACE.find(([re]) => re.test(withModel[2]))?.[1] : undefined;
    /** @type {Job} */
    const job = {
      title,
      url: url.href,
      company,
      location: model === 'remote' && !/remot|remote/i.test(city) ? [city, 'Remote'].filter(Boolean).join(' · ') : city,
      ...workplaceField(model),
    };
    if (city) job.locations = [city];
    const postedAt = parsePostedAt(age);
    if (postedAt !== undefined) job.postedAt = postedAt;
    byUrl.set(url.href, job);
  });
  const jobs = [...byUrl.values()];
  if (jobs.length === 0) {
    if (anchors.length > 0) {
      throw new Error(`viterbit: ${origin} has job cards but none could be parsed — the board markup changed`);
    }
    if (!/id=["']empty-jobs["']/.test(page)) {
      throw new Error(`viterbit: no job list found at ${origin} — not a Viterbit careers site, or its markup changed`);
    }
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'viterbit',

  /**
   * One request for the whole board. The origin is rebuilt from the entry's
   * hostname; a Cloudflare challenge or any other HTTP error is a failure
   * for this entry, never worked around.
   * @param {{ name?: string, careers_url?: unknown }} entry
   * @param {{ fetchText: (url: string, opts?: object) => Promise<string> }} ctx
   */
  async fetch(entry, ctx) {
    const origin = resolveViterbitOrigin(entry?.careers_url);
    if (!origin) throw new Error(`viterbit: ${entry?.name ?? 'entry'} needs an https careers_url, e.g. https://careers.acme.example/`);
    let html;
    try {
      html = await fetchTextWithRetry(ctx, `${origin}/`, { redirect: 'error' });
    } catch (err) {
      if (isCloudflareChallenge(err)) {
        throw new Error(`viterbit: ${origin} answered with a Cloudflare challenge; not bypassed (${/** @type {Error} */ (err).message})`);
      }
      throw err;
    }
    return parseViterbitBoard(html, origin, String(entry?.name ?? ''));
  },
};
