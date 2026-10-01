/** Collect vdab postings using the shared profile search terms. */
// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { providerKeywords } from './_profile-keywords.mjs';
import { intInRange } from './_config-utils.mjs';

const API_URL = 'https://www.vdab.be/rest/vindeenjob/v4/vacatureLight/zoek';
const DETAIL_API = 'https://www.vdab.be/rest/vindeenjob/v4/vacatures/';
const VEJ_KEY_MONITOR = 'b277002f-e1fa-4fc5-868a-fdab633c3851';
const DETAIL_BASE = 'https://www.vdab.be/vindeenjob/vacatures/';
const KEY_RE = /vej-key-monitor","([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i;
const BUNDLE_RE = /https:\/\/www\.vdab\.be\/webapps\/vindeenjob\/main-[\w-]+\.js/;
const DETAIL_BATCH = 5;
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
 * @returns {{ days: number, size: number, fetchDetails: boolean, detailLimit: number }}
 */
export function parseVdabConfig(entry) {
  const cfg = (entry && entry.vdab) || {};
  return {
    days: intInRange(cfg.days, 30, 1, 1000),
    size: intInRange(cfg.size, 100, 1, 100),
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
    const { days, size, fetchDetails, detailLimit } = parseVdabConfig(entry);
    const keywords = providerKeywords(ctx);
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
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const pageLimit = probing ? ctx.maxPages : MAX_PAGES_PER_KEYWORD;

    /** @param {string} trefwoord */
    const fetchKeyword = async (trefwoord) => {
      const out = [];
      for (let pagina = 0; pagina < pageLimit; pagina++) {
        const body = buildSearchBody(trefwoord, { days, size, pagina });
        const json = await postSearch(body);
        const page = Array.isArray(json && json.resultaten) ? json.resultaten : [];
        out.push(...page);
        if (page.length < size) break;
      }
      return out;
    };

    const byId = new Map();
    const errors = [];
    let succeeded = 0;
    for (const kw of keywords) {
      let raw;
      try {
        raw = await fetchKeyword(kw);
        succeeded++;
      } catch (err) {
        if (probing) throw err;
        errors.push(`"${kw}": ${(err && err.message) || err}`);
        continue;
      }
      for (const r of raw) {
        const job = normalizeJob(r);
        if (job && !byId.has(job.id)) byId.set(job.id, job);
      }
    }
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
          }
        }));
      }
    }
    if (succeeded === 0 && errors.length) {
      throw new Error(`vdab: all ${keywords.length} keyword request(s) failed — ${errors[0]}`);
    }

    return [...byId.values()].map(({ id, ...job }) => job);
  },
};
