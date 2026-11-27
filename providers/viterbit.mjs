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

/**
 * Classes that only a posting's card carries, independent of the title
 * anchor's class: the title link's `kt-widget4__username` and the apply
 * button's `vb-label-custom`. `vb-jobs-tab` is also the list container and
 * sits inside the "no offers" block, and `vb-job-title` is in the page's
 * inline CSS, so neither counts. */
const CARD_ONLY_CLASSES = new Set(['kt-widget4__username', 'vb-label-custom']);
/** An element's `class` attribute (whitespace before the name, so `data-class` is not one). */
const CLASS_ATTR = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const STYLE_OR_SCRIPT = /<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/**
 * Whether any element outside <style> and <script> has a card-only class as
 * one whole token of its class attribute (`hover:vb-label-custom` is another
 * class, and a stylesheet or script that names one is not a card).
 * @param {string} page
 */
function hasCardMarkup(page) {
  for (const m of page.replace(STYLE_OR_SCRIPT, ' ').matchAll(CLASS_ATTR)) {
    if ((m[1] ?? m[2] ?? m[3]).split(/\s+/).some((token) => CARD_ONLY_CLASSES.has(token))) return true;
  }
  return false;
}

/** @param {string} html */
function text(html) {
  return decodeEntities(html.replace(/<[^>]*(>?)/g, (tag, close) => (close ? ' ' : tag))).replace(/\s+/g, ' ').trim();
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Age units in the Spanish and English the sites render, in milliseconds. */
const UNIT_MS = /** @type {Array<[RegExp, number]>} */ ([
  [/^(segundo|second)/i, 1000],
  [/^(minuto|minute)/i, 60_000],
  [/^(hora|hour)/i, HOUR_MS],
  [/^(d[ií]a|day)/i, DAY_MS],
  [/^(semana|week)/i, 7 * DAY_MS],
  [/^(mes|month)/i, 30 * DAY_MS],
  [/^(a[nñ]o|year)/i, 365 * DAY_MS],
]);

/**
 * "hace 3 días", "hace 19 horas", "2 days ago", "hoy": the UTC midnight of the
 * calendar day that age implies (the elapsed time is subtracted from `nowMs`
 * first, so "19 hours ago" at 15:30 UTC is the day before), so the same
 * posting keeps the same date from one run to the next. Undefined when the
 * text says nothing parseable.
 * @param {string} label
 * @param {number} [nowMs]
 * @returns {number | undefined}
 */
export function parsePostedAt(label, nowMs = Date.now()) {
  let ageMs;
  if (/\b(hoy|today)\b/i.test(label)) ageMs = 0;
  else if (/\b(ayer|yesterday)\b/i.test(label)) ageMs = DAY_MS;
  else {
    const m = /(\d+)\s*([a-zñáíé]+)/i.exec(label);
    const unit = m && UNIT_MS.find(([re]) => re.test(m[2]));
    if (m && unit) ageMs = Number(m[1]) * unit[1];
  }
  if (ageMs === undefined) return undefined;
  const then = new Date(nowMs - ageMs);
  return Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate());
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
 * means this is not a Viterbit careers page or its markup changed. The "no
 * offers" block is also on pages that list postings, so it only counts when
 * nothing else on the page looks like a listing (the title link's or the apply
 * button's card-only class, as a whole token of a class attribute; text in a
 * <style> or <script> never counts): a page with the block and either of those
 * but no readable card throws. A page with the block and no such evidence is
 * an empty board.
 *
 * @param {string} html
 * @param {string} origin - the origin the page was read from
 * @param {string} company
 * @param {number} [nowMs] - clock for the card ages (tests)
 * @returns {Job[]}
 */
export function parseViterbitBoard(html, origin, company, nowMs = Date.now()) {
  const page = String(html ?? '');
  const anchors = [...page.matchAll(/<a\b([^>]*\bvb-job-title\b[^>]*)>([\s\S]*?)<\/a>/g)];
  /** @type {Map<string, Job>} */
  const byUrl = new Map();
  anchors.forEach((a, i) => {
    const href = /\bhref=(?:"([^"]*)"|'([^']*)')/.exec(a[1]);
    const title = text(a[2]);
    const hrefText = href ? decodeEntities(href[1] ?? href[2] ?? '').trim() : '';
    if (!hrefText || !title) return; // a blank href would resolve to the board's home page
    let url;
    try {
      url = new URL(hrefText, `${origin}/`);
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
    const postedAt = parsePostedAt(age, nowMs);
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
    if (hasCardMarkup(page)) {
      throw new Error(`viterbit: ${origin} shows the "no offers" block but its page still carries job card markup — the board markup changed`);
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
