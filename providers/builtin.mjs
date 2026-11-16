// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Built In provider — board-wide aggregator across the many employers that
// post to one US tech board (zero-token, no API key).
//
// Employers post to Built In directly and it does not index other job boards,
// so this is a board-wide aggregator like arbeitnow/flowxtra/thehub, not a
// per-company provider and not a cross-source index: scan.mjs's own filters
// narrow the result afterwards. It has NO detect() and is reached only via an
// explicit `provider: builtin` entry in portals.yml.
//
// ── Hosts ────────────────────────────────────────────────────────────────
// Built In runs one platform on several market hosts. Every one of them serves
// byte-identical markup (verified 2026-09-01: 25 ItemList entries + 25 job
// cards on /jobs/dev-engineering for all nine). `host:` selects which market a
// portals entry scans; the default stays builtin.com so an existing entry keeps
// its exact behaviour.
//
// A market host is NOT just a cosmetic filter — it is the only location scoping
// this board offers. Measured on the same four queries, one page each: the
// national host returned 89 rows spread across many metros, while a single
// market host returned 64 rows that were nearly all either in that metro or
// US-remote. Only 8 job ids appeared in both, and a market host carries that
// market's remote inventory too, so it is not "onsite only".
//
// ── What we parse ────────────────────────────────────────────────────────
// Two payloads on the SAME fetched page, joined on the numeric job id:
//
//   1. SPINE — the server-side `ItemList` JSON blob, one entry per job:
//        {"@type":"ListItem","position":N,"name":<title>,"url":<url>,"description":<~400ch>}
//      This is schema.org markup emitted for search engines, so it is the
//      stable half. It is also the ONLY half that is required: if card parsing
//      yields nothing, the provider still emits title, url and description
//      rather than dropping jobs.
//
//   2. ENRICHMENT — the rendered job card, keyed by `data-builtin-track-job-id`
//      (the same id that ends the ItemList url, so the join is 1:1 and free).
//      Fields are anchored on the card's FontAwesome icon classes, which are
//      far stabler than field order:
//        fa-clock          -> posted badge ("Yesterday", "Reposted 15 Days Ago")
//        fa-house-building -> workplace mode (Remote / Hybrid / In-Office / Remote or Hybrid)
//        fa-location-dot   -> location, or "N Locations" + a data-bs-title tooltip
//        fa-sack-dollar    -> salary band ("170K-230K Annually")
//      plus the /company/ anchor immediately preceding the card title.
//
// Enrichment is what makes scan.mjs's zero-token gates work for this provider.
// Without it `job.location` and `job.company` are always empty, so the
// blacklist gate, location_filter, posting-age filter and salary_filter are all
// inert here — off-policy rows reach data/pipeline.md and are only culled by a
// human or by an evaluation that costs a full report.
//
// ── Deliberate conservatism ──────────────────────────────────────────────
// Every enriched field is OPTIONAL and every unresolvable one is left empty
// rather than guessed. This matters most for location: per the Job contract an
// empty location PASSES location_filter, so a guess that parses wrong silently
// rejects real jobs, while an empty one simply leaves the field unset.
// A multi-location card whose tooltip we cannot read therefore yields '' — it
// keeps flowing through, instead of being dropped on a location string
// ("3 Locations") that names no city.
//
// The same reasoning drives the drift guard in fetch(): a card layout change
// would otherwise fail SILENTLY, emptying every location and re-opening the
// off-policy leak with no error anywhere. So a page that yields plenty of cards
// but almost no locations warns loudly.
//
// ── Config (portals.yml) ─────────────────────────────────────────────────
//   builtin:
//     host: www.builtinseattle.com   # optional, default builtin.com; allowlisted
//     scope: remote                  # optional path segment -> /jobs/remote/...
//     queries: ["platform engineer"]
//     categories: [dev-engineering]
//     max_pages: 3
// Legacy-flat `queries` / `categories` / `max_pages` keys still work.
//
// There is NO built-in default query set: builtin has no company scope, so a
// default would be one user's personal search criteria baked into shared code.
// An entry MUST supply `queries:` and/or `categories:` — otherwise there is
// nothing to scan and fetch() returns [].

import { BROWSER_LIKE_USER_AGENT, fetchTextWithRetry } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const DEFAULT_HOST = 'builtin.com';
const DEFAULT_MAX_PAGES = 3;  // builtin orders newest-first; a few pages = recent roles
const HARD_MAX_PAGES = 25;    // backstop against a misconfigured entry
const RETRY_POLICY = { retries: 2, baseDelayMs: 500, maxDelayMs: 8_000 };

// SSRF allowlist. Keys are the accepted spellings, values the CANONICAL host to
// request. The bare (www-less) market hosts 301 to www and we fetch with
// redirect:'error', so a bare spelling must be rewritten here rather than
// failing the fetch. builtinchicago is .org, not .com — not a typo.
const HOSTS = new Map([
  ['builtin.com', 'builtin.com'],
  ['www.builtin.com', 'builtin.com'],
  ['builtinseattle.com', 'www.builtinseattle.com'],
  ['www.builtinseattle.com', 'www.builtinseattle.com'],
  ['builtinnyc.com', 'www.builtinnyc.com'],
  ['www.builtinnyc.com', 'www.builtinnyc.com'],
  ['builtinsf.com', 'www.builtinsf.com'],
  ['www.builtinsf.com', 'www.builtinsf.com'],
  ['builtinla.com', 'www.builtinla.com'],
  ['www.builtinla.com', 'www.builtinla.com'],
  ['builtinboston.com', 'www.builtinboston.com'],
  ['www.builtinboston.com', 'www.builtinboston.com'],
  ['builtinaustin.com', 'www.builtinaustin.com'],
  ['www.builtinaustin.com', 'www.builtinaustin.com'],
  ['builtinchicago.org', 'www.builtinchicago.org'],
  ['www.builtinchicago.org', 'www.builtinchicago.org'],
  ['builtincolorado.com', 'www.builtincolorado.com'],
  ['www.builtincolorado.com', 'www.builtincolorado.com'],
]);

// Drift guard thresholds. Both are deliberately loose: the guard exists to
// catch a LAYOUT CHANGE (near-total loss), not to grade a page whose jobs
// genuinely lack a field.
const GUARD_MIN_ROWS = 5;      // below this a page is a test fixture or a stub, not a signal
const GUARD_MIN_LOCATION = 0.5; // fraction of cards that must yield a location

// One ItemList entry. builtin emits keys in a stable order (@type, position,
// name, url, description); description is occasionally absent. Capture the three
// JSON-string fields and JSON.parse them so escaping is handled correctly.
const ITEM = /\{"@type":"ListItem","position":\d+,"name":("(?:[^"\\]|\\.)*"),"url":("(?:[^"\\]|\\.)*")(?:,"description":("(?:[^"\\]|\\.)*"))?\}/g;

// Card anchors. CARD_ANCHOR marks the start of each rendered job card; the id
// attribute on the same anchor is the join key back to the ItemList url.
const CARD_ANCHOR = /data-id="job-card-title"/g;
const CARD_ID = /data-builtin-track-job-id="(\d+)"/;
const COMPANY_ANCHOR = /<a[^>]+href="\/company\/[^"]*"[^>]*>([\s\S]{0,240}?)<\/a>/g;
const LOCATION_TOOLTIP = /aria-label="Job locations"[^>]*data-bs-title="([^"]*)"/;
const CARD_CAP = 12_000; // chars; a card is ~3-6k, this bounds a missing next-anchor

const WORKPLACE_MODES = ['Remote or Hybrid', 'Remote', 'Hybrid', 'In-Office'];
const MULTI_LOCATION = /^\d+\s+Locations?$/i;
const SALARY_BAND = /^(\d+(?:\.\d+)?)K(?:-(\d+(?:\.\d+)?)K)?\s+Annually$/i;

/**
 * Resolve a configured host spelling to the canonical host to request.
 *
 * @param {unknown} raw
 * @returns {string|null} canonical host, or null when not allowlisted
 */
export function resolveHost(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_HOST;
  if (typeof raw !== 'string') return null;
  let h = raw.trim().toLowerCase();
  if (h === '') return DEFAULT_HOST;
  // Tolerate a pasted URL ("https://www.builtinseattle.com/jobs") as the host.
  if (h.includes('/')) {
    try { h = new URL(h.includes('://') ? h : `https://${h}`).hostname.toLowerCase(); } catch { return null; }
  }
  return HOSTS.get(h) ?? null;
}

/**
 * SSRF guard — every request URL passes through here before it is fetched. The
 * host comes from config, so this is the only thing standing between a
 * portals entry and an arbitrary fetch target. It checks the RESOLVED host
 * against the allowlist again rather than trusting the caller.
 *
 * @param {string} url
 * @returns {string}
 */
function assertHost(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`builtin: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`builtin: URL must use HTTPS: ${url}`);
  const host = parsed.hostname.toLowerCase();
  if (HOSTS.get(host) !== host) {
    throw new Error(`builtin: untrusted hostname "${parsed.hostname}" — must be one of ${[...new Set(HOSTS.values())].join(', ')}`);
  }
  return url;
}

/** @param {string} s */
function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Text of the first element following an icon marker inside a card.
 * Anchoring on the icon class (rather than on field order) is what keeps this
 * readable when Built In reshuffles the card layout.
 *
 * @param {string} seg  card HTML
 * @param {string} icon FontAwesome class, e.g. 'fa-location-dot'
 * @returns {string} '' when the icon or its text is absent
 */
function fieldAfterIcon(seg, icon) {
  const at = seg.indexOf(icon);
  if (at === -1) return '';
  // The icon sits in its own wrapper; the value is the next non-empty text node
  // within a short window. 600 chars covers the wrapper divs without spilling
  // into the following field.
  const window = seg.slice(at, at + 600);
  for (const m of window.matchAll(/>([^<>]+)</g)) {
    const t = stripTags(m[1]);
    if (t) return t;
  }
  return '';
}

/**
 * Parse a posted-freshness badge into epoch ms.
 *
 * Built In writes relative text ("2 Hours Ago", "Reposted 15 Days Ago",
 * "Yesterday", "30+ Days Ago"). Anything unrecognised returns undefined, which
 * scan.mjs treats as "no date" and passes.
 *
 * @param {string} text
 * @param {number} [now] epoch ms; injectable for tests
 * @returns {number|undefined}
 */
export function parsePostedAt(text, now = Date.now()) {
  if (typeof text !== 'string') return undefined;
  const t = text.replace(/^reposted\s+/i, '').trim();
  if (/^today$/i.test(t)) return now;
  if (/^yesterday$/i.test(t)) return now - 86_400_000;
  const m = /^(\d+|an?)\+?\s+(minute|hour|day|week|month|year)s?\s+ago$/i.exec(t);
  if (!m) return undefined;
  const n = /^an?$/i.test(m[1]) ? 1 : Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const unit = m[2].toLowerCase();
  const ms = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000, year: 31_536_000_000 }[unit];
  return ms ? now - n * ms : undefined;
}

/**
 * Parse a card salary band into the {min,max,currency} shape scan.mjs's
 * buildSalaryFilter expects.
 *
 * Two deliberate restrictions:
 *  - Only `Annually` bands are read. Built In also renders bands as
 *    "115K-130K Hourly", which is their own data error (nobody bills $115k/hr);
 *    reading it would hand salary_filter a number three orders of magnitude off.
 *  - `currency` is left UNSET. The card never states one, and buildSalaryFilter
 *    only rejects when BOTH sides declare a currency — so unset is the value
 *    that cannot cause a wrong rejection.
 *
 * @param {string} text
 * @returns {{min: number, max: number}|undefined}
 */
export function parseSalary(text) {
  if (typeof text !== 'string') return undefined;
  const m = SALARY_BAND.exec(text.trim());
  if (!m) return undefined;
  const min = Math.round(Number(m[1]) * 1000);
  const max = m[2] === undefined ? min : Math.round(Number(m[2]) * 1000);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0) return undefined;
  return { min, max };
}

/**
 * Compose the location string handed to scan.mjs's location_filter.
 *
 * Returns '' whenever the card names no place. That is the SAFE direction: an
 * empty location passes the filter (Job contract), so an unresolved
 * multi-location card keeps flowing through, whereas a placeholder like
 * "3 Locations" would be rejected by an allow-list that names cities and
 * remote markers.
 *
 * @param {string} mode      '' | 'Remote' | 'Hybrid' | 'In-Office' | 'Remote or Hybrid'
 * @param {string[]} places  resolved place strings, possibly empty
 * @returns {string}
 */
export function composeLocation(mode, places) {
  const list = (places || []).filter(Boolean);
  if (list.length === 0) {
    // Mode alone is only meaningful when it carries a remote marker the filter
    // can match; a bare "Hybrid"/"In-Office" names no place, so stay empty.
    return /remote/i.test(mode) ? mode : '';
  }
  return [mode, ...list].filter(Boolean).join(' · ');
}

/**
 * Parse the rendered job cards on a listing page into an id→enrichment map.
 * Pure; exported for unit tests. Never throws on odd markup — a card that
 * yields nothing simply contributes nothing.
 *
 * @param {string} html
 * @returns {Map<string, {company: string, location: string, salary?: {min: number, max: number}, postedAt?: number}>}
 */
export function parseCards(html, now = Date.now()) {
  /** @type {Map<string, any>} */
  const out = new Map();
  if (typeof html !== 'string') return out;

  const starts = [];
  CARD_ANCHOR.lastIndex = 0;
  for (const m of html.matchAll(CARD_ANCHOR)) starts.push(/** @type {number} */ (m.index));

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = Math.min(starts[i + 1] ?? html.length, start + CARD_CAP);
    const seg = html.slice(start, end);

    const idm = CARD_ID.exec(seg);
    if (!idm) continue;
    const id = idm[1];

    // Company sits in the anchor immediately BEFORE the card title. The window
    // is bounded by the previous card's title so we can never pick up a company
    // from two cards away; the LAST match in it is this card's.
    const preFrom = i === 0 ? Math.max(0, start - 2500) : starts[i - 1];
    const pre = html.slice(preFrom, start);
    let company = '';
    COMPANY_ANCHOR.lastIndex = 0;
    for (const cm of pre.matchAll(COMPANY_ANCHOR)) company = stripTags(cm[1]);

    const modeRaw = fieldAfterIcon(seg, 'fa-house-building');
    const mode = WORKPLACE_MODES.find((w) => w.toLowerCase() === modeRaw.toLowerCase()) ?? '';

    // Location: a single place renders as text; several render as "N Locations"
    // with the full list in a tooltip attribute.
    const locRaw = fieldAfterIcon(seg, 'fa-location-dot');
    /** @type {string[]} */
    let places = [];
    if (locRaw && !MULTI_LOCATION.test(locRaw)) {
      places = [locRaw];
    } else {
      const tip = LOCATION_TOOLTIP.exec(seg);
      if (tip) {
        places = decodeEntities(tip[1])
          .split(/<\/div>|<br\s*\/?>/i)
          .map(stripTags)
          .filter(Boolean);
      }
      // No tooltip → places stays empty on purpose (see composeLocation).
    }

    out.set(id, {
      company,
      location: composeLocation(mode, places),
      salary: parseSalary(fieldAfterIcon(seg, 'fa-sack-dollar')),
      postedAt: parsePostedAt(fieldAfterIcon(seg, 'fa-clock'), now),
    });
  }
  return out;
}

/** Numeric job id at the end of a Built In job url, or '' when absent. */
function jobIdFromUrl(url) {
  const m = /\/(\d+)(?:[/?#]|$)/.exec(String(url));
  return m ? m[1] : '';
}

/**
 * Pure normalizer for one listing page's HTML. Exported for unit tests. A
 * malformed ItemList entry is skipped, never allowed to abort the whole page.
 * Rows with no title or no url are dropped (url is the dedup key downstream).
 *
 * The ItemList is the spine; card data enriches it where the ids join. A page
 * with no parseable cards yields exactly what it yielded before enrichment
 * existed: title, url, description, and empty company/location.
 *
 * @param {string} html
 * @returns {Array<{title: string, url: string, company: string, location: string, description: string, salary?: object, postedAt?: number}>}
 */
export function parseListPage(html, now = Date.now()) {
  const jobs = [];
  if (typeof html !== 'string') return jobs;
  const cards = parseCards(html, now);
  for (const m of html.matchAll(ITEM)) {
    let title, url, description = '';
    try {
      title = JSON.parse(m[1]);
      url = JSON.parse(m[2]);
      if (m[3]) description = JSON.parse(m[3]);
    } catch {
      continue; // a malformed item must never abort the whole page
    }
    if (!title || !url) continue;
    const job = { title, url, company: '', location: '', description };
    const enrich = cards.get(jobIdFromUrl(url));
    if (enrich) {
      job.company = enrich.company || '';
      job.location = enrich.location || '';
      if (enrich.salary) job.salary = enrich.salary;
      if (enrich.postedAt !== undefined) job.postedAt = enrich.postedAt;
    }
    jobs.push(job);
  }
  return jobs;
}

/**
 * Read the scan config. The nested `builtin: {...}` block is canonical (matches
 * phenom's `entry.phenom`); flat `queries` / `categories` / `max_pages` keys are
 * honoured so a pre-existing portals.yml keeps working. Nested wins over flat.
 *
 * NO default queries: an empty result means "nothing to scan", which fetch()
 * handles by returning []. This is the neutralization of the old hardcoded
 * personal default — a shared provider must never ship one user's search terms.
 *
 * `host` resolves to null when the spelling is not allowlisted. fetch() then
 * refuses the entry rather than silently falling back to builtin.com: a typo'd
 * market host must not quietly scan the national board and re-introduce the
 * off-policy rows the market host exists to avoid.
 *
 * `scope` is an optional path segment inserted before the category
 * (`/jobs/remote`, `/jobs/remote/dev-engineering`). Restricted to a plain slug
 * so it can never inject a path traversal or a query string.
 *
 * @param {any} entry
 * @returns {{queries: string[], categories: string[], maxPages: number, host: string|null, scope: string}}
 */
export function readConfig(entry) {
  const nested = entry && typeof entry.builtin === 'object' && entry.builtin ? entry.builtin : {};
  const arr = (key) => {
    const nv = nested[key];
    if (Array.isArray(nv) && nv.length) return nv.map(String);
    const fv = entry?.[key];
    if (Array.isArray(fv) && fv.length) return fv.map(String);
    return [];
  };
  const rawMax = nested.max_pages ?? entry?.max_pages;
  const maxPages = Math.min(
    HARD_MAX_PAGES,
    Math.max(1, Number.isFinite(rawMax) ? Math.floor(rawMax) : DEFAULT_MAX_PAGES),
  );
  const host = resolveHost(nested.host ?? entry?.host);
  const rawScope = String(nested.scope ?? entry?.scope ?? '').trim();
  const scope = /^[a-z0-9-]+$/i.test(rawScope) ? rawScope.toLowerCase() : '';
  if (rawScope && !scope) {
    console.error(`⚠️  builtin: ignoring invalid scope ${JSON.stringify(rawScope)} — must be a plain slug like "remote"`);
  }
  return { queries: arr('queries'), categories: arr('categories'), maxPages, host, scope };
}

/**
 * Narrow the per-base page cap by ctx.maxPages when the caller is only probing
 * (verify-portals.mjs's health check passes 1).
 *
 * @param {number} entryMax
 * @param {any} ctx
 * @returns {number}
 */
function effectiveMaxPages(entryMax, ctx) {
  const hint = Number(ctx?.maxPages);
  return Number.isFinite(hint) && hint > 0 ? Math.min(entryMax, Math.floor(hint)) : entryMax;
}

/** @type {Provider} */
export default {
  id: 'builtin',

  async fetch(entry, ctx) {
    const { queries, categories, maxPages: entryMax, host, scope } = readConfig(entry);
    const maxPages = effectiveMaxPages(entryMax, ctx);
    const label = entry?.name ?? 'entry';

    if (host === null) {
      const raw = entry?.builtin?.host ?? entry?.host;
      console.error(`⚠️  builtin: ${label} has host ${JSON.stringify(raw)}, which is not a known Built In market — skipping (allowed: ${[...new Set(HOSTS.values())].join(', ')})`);
      return [];
    }

    // Build the base paths to paginate: keyword searches + category paths, both
    // under the optional scope segment.
    const prefix = scope ? `/jobs/${scope}` : '/jobs';
    const bases = [
      ...queries.map((q) => `${prefix}?search=${encodeURIComponent(q)}`),
      ...categories.map((c) => `${prefix}/${encodeURIComponent(c)}`),
    ];

    if (bases.length === 0) {
      // Neutralized default (see readConfig): no personal queries baked in, so
      // an entry with neither queries: nor categories: has nothing to scan.
      console.error(`⚠️  builtin: ${label} has no queries: or categories: — nothing to scan`);
      return [];
    }

    const seen = new Set();
    const out = [];
    // Drift-guard counters, aggregated across every page of this entry so one
    // odd page can't trip the warning on its own.
    let guardRows = 0, guardCards = 0, guardLocated = 0;

    for (const base of bases) {
      const sep = base.includes('?') ? '&' : '?';
      for (let page = 1; page <= maxPages; page++) {
        const url = `https://${host}${base}${sep}page=${page}`;
        assertHost(url); // SSRF guard before every fetch
        let html;
        try {
          html = /** @type {string} */ (await fetchTextWithRetry(
            /** @type {any} */ (ctx),
            url,
            { redirect: 'error', headers: { 'User-Agent': BROWSER_LIKE_USER_AGENT } },
            RETRY_POLICY,
          ));
        } catch {
          break; // network/HTTP error (e.g. past the last page) — stop this base
        }
        const jobs = parseListPage(html);
        guardRows += jobs.length;
        for (const j of jobs) {
          if (j.company || j.location) guardCards++;
          if (j.location) guardLocated++;
        }
        let added = 0;
        for (const j of jobs) {
          if (seen.has(j.url)) continue; // a job can surface across queries/pages
          seen.add(j.url);
          added++;
          out.push(j);
        }
        // No items at all → format changed or past the last page. Items but none
        // NEW → fully-overlapping tail. Either way, stop paginating this base.
        if (jobs.length === 0 || added === 0) break;
      }
    }

    // ── Drift guard ──────────────────────────────────────────────────────
    // Card enrichment failing is SILENT by construction: every field just comes
    // back empty, an empty location passes location_filter, and the entry keeps
    // returning jobs. That is precisely the failure that re-opens the
    // off-policy leak, so it gets a loud warning rather than a quiet degrade.
    if (guardRows >= GUARD_MIN_ROWS) {
      if (guardCards === 0) {
        console.error(`⚠️  builtin: ${label} parsed ${guardRows} rows but ZERO job cards — card markup changed. location_filter, salary_filter, the blacklist gate and posting-age are INERT for this entry until the parser is fixed.`);
      } else if (guardCards >= GUARD_MIN_ROWS && guardLocated / guardCards < GUARD_MIN_LOCATION) {
        console.error(`⚠️  builtin: ${label} resolved a location for only ${guardLocated}/${guardCards} cards — location markup may have changed; off-policy rows will pass location_filter.`);
      }
    }

    return out;
  },
};
