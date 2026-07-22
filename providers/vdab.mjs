// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { resolveProfileKeywords } from './_profile-keywords.mjs';
import { intInRange } from './_config-utils.mjs';

// VDAB (Flanders' public employment service) provider — hits the public
// vindeenjob search API directly (the same endpoint vdab.be's own frontend
// uses), so it lives in-process alongside the other JSON-API providers
// (greenhouse/ashby/arbeitsagentur shape). One or more `vdab.keywords` are
// queried; scan.mjs applies title_filter + location_filter +
// dedup afterwards, so this provider over-fetches (recall-first) — same
// philosophy as arbeitsagentur.mjs.
//
// Configure via a `job_boards` (or `tracked_companies`) entry with
// `provider: vdab` and a `vdab:` block:
//
//   - name: VDAB — AI/ML Vlaanderen
//     provider: vdab
//     vdab:
//       keywords: ["Machine Learning Engineer", "Data Scientist"]  # required
//       days: 30    # recency window in days, maps to onlineSindsCode (default 30)
//       size: 100   # results per keyword page (1–100, default 100)
//       fetchDetails: false  # optional: fetch detail JSON for descriptions
//       detailLimit: 25      # optional max detail calls when fetchDetails=true
//     enabled: true
//
// Resilience: VEJ_KEY_MONITOR is a public frontend constant, not a secret —
// but it could rotate on a VDAB redeploy. A 403 triggers one self-heal
// attempt (deriveKeyFromBundle) that reads the current key straight off
// VDAB's own live bundle before giving up, so a rotation doesn't require a
// code patch to recover.
//
// Known limitation: VDAB's search API has no working location/geo field we
// could find (its own frontend appears to resolve place names via Google's
// Geocoding API client-side before searching, which this provider does not
// replicate). So there is no `wo`/`umkreis`-style radius config here — every
// keyword search is nationwide, and precision on location is left entirely to
// scan.mjs's existing location_filter, consistent with the recall-first design.

const API_URL = 'https://www.vdab.be/rest/vindeenjob/v4/vacatureLight/zoek';
const DETAIL_API = 'https://www.vdab.be/rest/vindeenjob/v4/vacatures/';
// Public, build-time constant baked into VDAB's own frontend JS bundle (an
// Angular HTTP interceptor stamps this on every request) — not a per-visitor
// session token. Verified live: works from a cold request with no cookies.
// Same trust tier as arbeitsagentur.mjs's public API_KEY below.
const VEJ_KEY_MONITOR = 'b277002f-e1fa-4fc5-868a-fdab633c3851';
// Plural + no slug is the correct canonical form and resolves without a
// redirect (verified live). The singular form ("/vacature/{id}", no 's')
// looks plausible but silently redirects to the generic listing page —
// Angular's router has no matching route for it.
const DETAIL_BASE = 'https://www.vdab.be/vindeenjob/vacatures/';

// Self-heal if VDAB rotates VEJ_KEY_MONITOR on a frontend redeploy: read the
// current key straight off VDAB's own live bundle instead of needing a code
// patch. Only invoked on a 403 (see postSearch in fetch() below) — the fast
// path (hardcoded key still valid) never pays this extra round trip.
const KEY_RE = /vej-key-monitor","([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i;
const BUNDLE_RE = /https:\/\/www\.vdab\.be\/webapps\/vindeenjob\/main-[\w-]+\.js/;
// Batch detail calls so a large detailLimit can't fire dozens of concurrent
// requests at once (mirrors arbeitsagentur.mjs's VERIFY_BATCH).
const DETAIL_BATCH = 5;
// Real-scan safety cap (mirrors workday.mjs's DEFAULT_MAX_PAGES pattern):
// fetchKeyword() otherwise only stops on a short page, trusting VDAB's
// pagination to behave. At the max page size (100) this is ~5,000 postings
// per keyword — far beyond any keyword's real volume observed live — so it
// never fires in practice; it only guards against a runaway loop if the API
// ever returned full pages indefinitely.
const MAX_PAGES_PER_KEYWORD = 50;

/**
 * @param {{ fetchText: (url: string, opts?: object) => Promise<string> }} ctx
 * @returns {Promise<string|null>}
 */
async function deriveKeyFromBundle(ctx) {
  const html = await ctx.fetchText('https://www.vdab.be/vindeenjob/vacatures', { timeoutMs: 12_000, redirect: 'error' });
  const bundleUrl = html.match(BUNDLE_RE)?.[0];
  if (!bundleUrl) return null;
  const js = await ctx.fetchText(bundleUrl, { timeoutMs: 15_000, redirect: 'error' });
  return js.match(KEY_RE)?.[1] || null;
}

/**
 * Reads and sanitizes the entry's `vdab:` config block.
 * @param {{ vdab?: any }} entry
 * @returns {{ keywords: string[], days: number, size: number, fetchDetails: boolean, detailLimit: number }}
 */
export function parseVdabConfig(entry) {
  const cfg = (entry && entry.vdab) || {};
  const keywords = [...new Set(
    (Array.isArray(cfg.keywords) ? cfg.keywords : [])
      .filter(k => typeof k === 'string' && k.trim())
      .map(k => k.trim())
  )];
  return {
    keywords,
    days: intInRange(cfg.days, 30, 1, 1000),      // recency window (onlineSindsCode)
    size: intInRange(cfg.size, 100, 1, 100),       // results per page
    fetchDetails: cfg.fetchDetails === true,
    detailLimit: intInRange(cfg.detailLimit, 25, 1, 100),
  };
}

/**
 * Extracts the best plain-text description from VDAB's detail JSON.
 * @param {any} detail
 * @returns {string}
 */
export function extractDescription(detail) {
  const omschrijving = detail && detail.functie && detail.functie.omschrijving;
  return String(
    (omschrijving && (omschrijving.markdown || omschrijving.plainText))
    || ''
  ).trim();
}

/**
 * Normalizes one raw VDAB `resultaten[]` record into a Job plus its numeric
 * id (kept for dedup, stripped before the provider returns). Returns null
 * when the posting lacks a usable id or title.
 * @param {any} job
 * @returns {({title: string, url: string, company: string, location: string, postedAt?: number, id: string}) | null}
 */
export function normalizeJob(job) {
  const id = job && job.id && job.id.id;
  const title = String((job && job.vacaturefunctie && job.vacaturefunctie.naam) || '').trim();
  if (!id || !title) return null;
  const result = {
    title,
    url: DETAIL_BASE + encodeURIComponent(String(id)),
    company: String((job && job.vacatureBedrijfsnaam) || '').trim(),
    location: String((job && job.tewerkstellingsLocatieRegioOfAdres) || '').trim(),
    id: String(id),
  };
  const posted = job && job.eerstePublicatieDatum && Date.parse(job.eerstePublicatieDatum);
  if (Number.isFinite(posted)) result.postedAt = posted;
  return result;
}

/**
 * Builds the VDAB vacatureLight search request body for one keyword/page.
 * `sorteerVeld`/`zoekmodus` and the facet-code array shape are captured
 * verbatim from VDAB's own frontend network trace. Facet-code arrays are
 * kept empty/default deliberately (over-fetch, recall-first) — see the
 * module header's "Known limitation" note on filtering.
 * @param {string} trefwoord
 * @param {{ days: number, size: number, pagina: number }} opts
 * @returns {object}
 */
export function buildSearchBody(trefwoord, { days, size, pagina }) {
  return {
    criteria: {
      trefwoord,
      diplomaCodes: [],
      arbeidsduurCodes: [],
      arbeidsregimeCodes: [],
      contractTypeCodes: [],
      jobdomeinCodes: [],
      internationaalCodes: [],
      beroepCodes: [],
      ervaringCodes: [],
      rijbewijsCodes: [],
      attestCodes: [],
      taalCriteria: { taalSelecties: [] },
      onlineSindsCode: String(days),
      sorteerVeld: 'STANDAARD',
    },
    pagina,
    zoekmodus: 'C2',
    paginaGrootte: size,
  };
}

/** @type {Provider} */
export default {
  id: 'vdab',

  /**
   * Fetches and normalizes postings from VDAB's vacatureLight search API.
   * @param {{ name?: string, vdab?: any }} entry
   * @param {{ fetchJson: (url: string, opts?: object) => Promise<any>, fetchText: (url: string, opts?: object) => Promise<string> }} ctx
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string, postedAt?: number}>>}
   */
  async fetch(entry, ctx) {
    const { days, size, fetchDetails, detailLimit, keywords: ownKeywords } = parseVdabConfig(entry);
    let keywords = ownKeywords;
    // Fall back to config/profile.yml's target_roles when this entry has no
    // vdab.keywords[] of its own — most users who onboarded already have
    // target roles recorded, so this avoids duplicating that into every
    // keyword-required provider's config by hand.
    if (!keywords.length) keywords = resolveProfileKeywords();
    if (!keywords.length) {
      throw new Error(`vdab: entry "${entry.name || '(unnamed)'}" has no vdab.keywords[] and no config/profile.yml target_roles to fall back to`);
    }

    // Scoped to this fetch() call: try the hardcoded key first (fast path);
    // on a 403 (VDAB rotated it), re-derive once from the live bundle and
    // keep using the fresh key for every remaining request this run.
    let activeKey = VEJ_KEY_MONITOR;
    let rederiveAttempted = false;

    /**
     * Runs a VDAB JSON request with the active public frontend key. If VDAB
     * rotates that key, re-derive it once from the live bundle and retry.
     *
     * @param {string} url
     * @param {object} requestOpts
     */
    const keyedFetchJson = async (url, requestOpts) => {
      const opts = {
        ...requestOpts,
        headers: { ...(requestOpts.headers || {}), 'vej-key-monitor': activeKey },
        redirect: 'error',
        timeoutMs: 12_000,
      };
      try {
        return await ctx.fetchJson(url, opts);
      } catch (err) {
        if (err?.status !== 403 || rederiveAttempted) throw err;
        rederiveAttempted = true;
        const fresh = await deriveKeyFromBundle(ctx).catch(() => null);
        if (!fresh) throw err;
        activeKey = fresh;
        return ctx.fetchJson(url, { ...opts, headers: { ...opts.headers, 'vej-key-monitor': activeKey } });
      }
    };

    /** @param {object} body */
    const postSearch = async (body) => keyedFetchJson(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    // ctx.maxPages is set only by verify-portals.mjs's bounded health-check
    // probe (never during a real scan). While probing: (a) cap pagination
    // per keyword so a popular keyword (e.g. "Python" with 200+ live
    // postings) doesn't burn the probe's whole request budget on one
    // keyword alone, and (b) let the first per-keyword error propagate
    // as-is instead of being flattened into a generic summary Error —
    // verify-portals.mjs's probeProvider() specifically recognizes its own
    // budget-exhaustion sentinel (instanceof check) to report a bounded
    // probe as "live, partial" rather than "board is down"; recall-first
    // tolerance would swallow that sentinel's identity and misreport a live
    // board as missing. Real scans (ctx.maxPages unset) keep full
    // recall-first tolerance and paginate up to MAX_PAGES_PER_KEYWORD.
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const pageLimit = probing ? ctx.maxPages : MAX_PAGES_PER_KEYWORD;

    /** @param {string} trefwoord */
    const fetchKeyword = async (trefwoord) => {
      const out = [];
      for (let pagina = 0; pagina < pageLimit; pagina++) {
        const body = buildSearchBody(trefwoord, { days, size, pagina });
        // redirect:'error' prevents SSRF via server-side redirects.
        const json = await postSearch(body);
        const page = Array.isArray(json && json.resultaten) ? json.resultaten : [];
        out.push(...page);
        if (page.length < size) break; // short page → done
      }
      return out;
    };

    const byId = new Map();
    const errors = [];
    let succeeded = 0; // keywords whose request completed (i.e. the source answered)
    for (const kw of keywords) {
      let raw;
      try {
        raw = await fetchKeyword(kw);
        succeeded++;
      } catch (err) {
        if (probing) throw err;
        // Recall-first: tolerate a single failed keyword and keep going.
        errors.push(`"${kw}": ${(err && err.message) || err}`);
        continue;
      }
      for (const r of raw) {
        const job = normalizeJob(r);
        if (job && !byId.has(job.id)) byId.set(job.id, job);
      }
    }

    // Detail enrichment answers "what does this job say", not "is this
    // endpoint alive" — skip it entirely while probing so it never spends
    // budget a liveness check has no use for.
    if (fetchDetails && byId.size && !probing) {
      const jobs = [...byId.values()].slice(0, detailLimit);
      for (let i = 0; i < jobs.length; i += DETAIL_BATCH) {
        const batch = jobs.slice(i, i + DETAIL_BATCH);
        await Promise.all(batch.map(async (job) => {
          try {
            const detail = await keyedFetchJson(`${DETAIL_API}${encodeURIComponent(job.id)}?preview=false`, {
              method: 'GET',
              headers: { accept: 'application/json' },
            });
            const description = extractDescription(detail);
            if (description) job.description = description;
          } catch {
            // Detail fetch is an enrichment only. Keep the listing result.
          }
        }));
      }
    }

    // Total outage = every keyword request failed. A keyword that answered with
    // zero results is not an outage, so key off the success count, not the
    // deduped result size — otherwise a legitimately-empty search throws.
    if (succeeded === 0 && errors.length) {
      throw new Error(`vdab: all ${keywords.length} keyword request(s) failed — ${errors[0]}`);
    }

    return [...byId.values()].map(({ id, ...job }) => job);
  },
};
