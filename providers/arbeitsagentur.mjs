// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { intInRange } from './_config-utils.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';
import { fetchJsonWithRetry, sleep } from './_http.mjs';

// Arbeitsagentur (Bundesagentur für Arbeit) provider — an aggregator (one entry,
// many employers), so it goes in the `job_boards:` list of portals.yml.
//
// Hits the public Jobsuche REST API (the same endpoint arbeitsagentur.de uses),
// so it lives in-process alongside the other JSON-API providers
// (greenhouse/ashby shape). One or more keywords are queried; scan.mjs applies
// title_filter + location_filter + dedup afterwards, so this provider
// over-fetches (recall-first).
//
// Configure via a `job_boards:` entry with `provider: arbeitsagentur` and an
// `arbeitsagentur:` block:
//
//   - name: Arbeitsagentur — ML/KI Deutschland
//     provider: arbeitsagentur
//     arbeitsagentur:
//       keywords: ["Machine Learning Engineer", "Data Scientist"]  # required
//       wo: Berlin              # optional anchor city; omit for nationwide
//       umkreis: 50             # km radius around `wo` (default 50)
//       days: 30                # recency window in days (default 30)
//       size: 100               # results per keyword (1–100, default 100)
//       remoteNationwide: false # true also runs a nationwide pass keeping remote-eligible hits
//                               #   (only when `wo` is set; default false)
//       remoteMatch: title      # how that pass detects remote (default 'title'):
//                               #   'title'  — nationwide search; keeps hits whose title claims remote
//                               #              (cheap; misses body-level remote)
//                               #   'filter' — server-side home-office query (HOMEOFFICE_FILTER) + pagination to narrow
//                               #              the set, then the same title check as 'title'. Recommended:
//                               #              same standard of proof, applied to a far better candidate set.
//                               #   'off'    — skip the remote pass entirely
//                               # In 'filter' and 'title', a hit stating 100 % home office (`homeofficeprozent`)
//                               # also counts as remote; a lower share does not.
//       remoteMaxPages: 1       # 'filter' mode: max pages to paginate (size each; 1–20, default 1)
//       angebotsart: [1]        # offer types, one request each (default [1]): 1 ARBEIT, 2 SELBSTAENDIGKEIT,
//                               #   4 AUSBILDUNG, 34 PRAKTIKUM_TRAINEE (where most Werkstudent/Praktikum ads sit);
//                               #   [1, 34] queries both jobs and internships
//     enabled: true

// v6. The v4 search and detail endpoints both 404 as of 2026-08-04 (#2494);
// v5 does too. v6 keeps every query parameter this provider sends
// (was/wo/umkreis/veroeffentlichtseit/angebotsart/homeoffice/page/size) but
// renames the response fields — see normalizeJob().
const API_URL = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs';
const API_KEY = 'jobboerse-jobsuche'; // public client key the arbeitsagentur.de UI uses
const DETAIL_BASE = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/';
const INTER_PAGE_DELAY_MS = 200; // between filter-mode page requests
// 'filter' mode's server-side home-office query: every posting where home office
// is possible. The value is a `;` list: `prozentual_{N}` selects postings that
// state at least N % home office, and `nv_true` adds the ones that allow it
// without a percentage. This is what arbeitsagentur.de's own "Homeoffice
// möglich" filter sends.
const HOMEOFFICE_FILTER = 'prozentual_0;nv_true';
// Location marker for a role proven remote. Deliberately not a bare "Remote":
// location_filter is global across every provider, and "Remote" from a US or
// worldwide board says nothing about Germany. This marker lets a candidate
// rescue German remote roles past a commute filter (`always_allow:
// ["Deutschlandweit"]`) without also admitting every foreign "Remote" posting.
const REMOTE_MARKER = 'Deutschlandweit (Homeoffice)';
/** @param {string} location */
const withRemoteMarker = (location) =>
  location.includes(REMOTE_MARKER) ? location : (location ? `${location} · ${REMOTE_MARKER}` : REMOTE_MARKER);
const REMOTE_RE =/(remote|homeoffice|home[-\s]?office|ortsunabh|deutschlandweit|bundesweit|100\s*%|full[-\s]?remote|fully remote)/i;

/**
 * Reads and sanitizes the entry's `arbeitsagentur:` config block.
 * @param {{ arbeitsagentur?: any }} entry
 * @returns {{ keywords: string[], wo: string, umkreis: number, days: number, size: number, remoteNationwide: boolean, remoteMatch: 'title'|'filter'|'off', remoteMaxPages: number }}
 */
export function parseArbeitsagenturConfig(entry) {
  const cfg = (entry && entry.arbeitsagentur) || {};
  const keywords = Array.isArray(cfg.keywords)
    ? cfg.keywords.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim())
    : [];
  return {
    keywords,
    wo: typeof cfg.wo === 'string' ? cfg.wo.trim() : '',
    umkreis: intInRange(cfg.umkreis, 50, 0, 1000), // km; only used when `wo` is set
    days: intInRange(cfg.days, 30, 1, 1000),       // recency window
    size: intInRange(cfg.size, 100, 1, 100),       // results per keyword (API max 100)
    remoteNationwide: cfg.remoteNationwide === true,
    // Remote-detection mode is config-driven (not hardcoded).
    remoteMatch: ['title', 'filter', 'off'].includes(cfg.remoteMatch) ? cfg.remoteMatch : 'title',
    remoteMaxPages: intInRange(cfg.remoteMaxPages, 1, 1, 20),
    angebotsart: parseAngebotsart(cfg.angebotsart),
  };
}

// Jobsuche offer types. Werkstudent and Praktikum postings are mostly listed
// under 34, so a student search needs [1, 34]; the default stays ARBEIT only.
const ANGEBOTSART_CODES = new Set(['1', '2', '4', '34']); // ARBEIT, SELBSTAENDIGKEIT, AUSBILDUNG, PRAKTIKUM_TRAINEE

/**
 * Reads `angebotsart` as one code or a list of codes; unknown codes are
 * dropped, and an empty result falls back to ['1'].
 * @param {any} val
 * @returns {string[]}
 */
export function parseAngebotsart(val) {
  const list = Array.isArray(val) ? val : (val === undefined || val === null ? [] : [val]);
  const codes = [...new Set(list.map(v => String(v).trim()).filter(v => ANGEBOTSART_CODES.has(v)))];
  return codes.length ? codes : ['1'];
}

/**
 * Assembles a human-readable location from v6's `stellenlokationen` array: one
 * place per address, in the API's order. Most postings are in Germany; only a
 * non-DE country is appended to its place so the downstream location_filter can
 * act on it. The address `region` is an uppercase federal-state enum
 * (`BADEN_WUERTTEMBERG`), which would only add noise to a string the commute
 * filter has to match, so it is left out.
 *
 * A posting can list several addresses. Every place is kept, deduped and joined
 * with " · ", the separator the providers share for multi-place postings
 * (`grep -l "' · '" providers/*.mjs`): location_filter then sees every city the
 * role is open in, and scan.mjs's location-aware dedup
 * (`scan_history.dedup_include_location`) compares the set of places, not one.
 * @param {any} lokationen
 */
export function buildLocation(lokationen) {
  if (!Array.isArray(lokationen)) return '';
  const places = [];
  for (const entry of lokationen) {
    const adresse = entry && entry.adresse;
    if (!adresse || typeof adresse !== 'object') continue;
    const loc = String(adresse.ort || '').trim();
    const land = adresse.land;
    const place = land && !/deutschland|germany/i.test(land) ? (loc ? `${loc}, ${land}` : String(land)) : loc;
    if (place) places.push(place);
  }
  return [...new Set(places)].join(' · ');
}

/**
 * Whether a posting can be worked from Germany: at least one address in Germany
 * or with no country, or no address at all (this is the German federal job
 * board). The remote marker claims "anywhere in Germany", so a posting tied only
 * to addresses abroad never gets it, whatever its title or home-office share.
 * @param {any} lokationen
 */
export function hasGermanAddress(lokationen) {
  const adressen = Array.isArray(lokationen)
    ? lokationen.map(entry => entry && entry.adresse).filter(a => a && typeof a === 'object')
    : [];
  return !adressen.length || adressen.some(a => !a.land || /deutschland|germany/i.test(a.land));
}

/**
 * Normalizes one raw Arbeitsagentur posting into a Job plus its `refnr` (kept
 * for dedup) and `inGermany` (see hasGermanAddress), both stripped before the
 * provider returns. Returns null when the posting lacks a usable reference
 * number or title.
 *
 * v6 renamed every field this reads — `refnr` → `referenznummer`, `titel` →
 * `stellenangebotsTitel`, `arbeitgeber` → `firma`, `arbeitsort` →
 * `stellenlokationen[]` (#2494). The public job-detail page still resolves by
 * reference number, so the outgoing URL is unchanged.
 * @param {any} job
 * @returns {({title: string, url: string, company: string, location: string, refnr: string, inGermany: boolean}) | null}
 */
export function normalizeJob(job) {
  const refnr = job && job.referenznummer;
  const title = String((job && job.stellenangebotsTitel) || '').trim();
  if (!refnr || !title) return null;
  // A lone surrogate in refnr would throw URIError out of encodeURIComponent and
  // abort the per-job loop in fetch(); refnr is also the dedup key (byRef), so a
  // degraded-but-kept value would collide malformed postings. Drop this one.
  const encodedRefnr = safeEncodeURIComponent(refnr);
  if (encodedRefnr === null) return null;
  // The employer stated 100 % home office (homeofficetyp ANGABE_IN_PROZENT).
  // `stellenlokationen` names the company's city even then, so a fully remote
  // role from Augsburg would read as Augsburg-only to scan.mjs's location_filter.
  // Append the remote marker, keeping the city so city-based filters still work.
  // Applied here, so every pass carries it, not only the nationwide remote pass.
  const inGermany = hasGermanAddress(job && job.stellenlokationen);
  let location = buildLocation(job && job.stellenlokationen);
  if (inGermany && Number(job && job.homeofficeprozent) >= 100) location = withRemoteMarker(location);
  return {
    title,
    url: DETAIL_BASE + encodedRefnr,
    company: String((job && job.firma) || '').trim(),
    location,
    refnr: String(refnr),
    inGermany,
  };
}

// What counts as proof that a role is remote.
//
// The `Deutschlandweit (Homeoffice)` marker exempts a job from the commute
// location_filter, so it may only be applied on evidence. The home-office
// query matches every posting where home office is *possible*, which includes
// `homeofficetyp: NACH_VEREINBARUNG` ("nach Absprache") — an office-anchored
// hybrid — and the search hit's boolean `homeofficemoeglich` is `true` for all
// of them. The detail endpoint answers 403 to this public client key, so it
// cannot be asked either.
//
// Two signals on the search hit itself are accepted, in every pass and mode:
//   - the posting's own title claims remote (REMOTE_RE);
//   - `homeofficeprozent: 100`, the employer's stated share of home office
//     (`homeofficetyp: ANGABE_IN_PROZENT`).
// A lower share, `NACH_VEREINBARUNG`, or the boolean alone is not evidence: such
// a candidate keeps its real city and goes through the commute filter. Either
// signal counts only for a posting with an address in Germany
// (hasGermanAddress): a remote role tied to Austria is not remote in Germany.

/** @type {Provider} */
export default {
  id: 'arbeitsagentur',

  /**
   * Fetches and normalizes postings from the Arbeitsagentur Jobsuche API.
   * @param {{ name?: string, arbeitsagentur?: any }} entry
   * @param {{ fetchJson: (url: string, opts?: object) => Promise<any> }} ctx
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string}>>}
   */
  async fetch(entry, ctx) {
    const { keywords, wo, umkreis, days, size, remoteNationwide, remoteMatch, remoteMaxPages, angebotsart } = parseArbeitsagenturConfig(entry);
    if (!keywords.length) {
      throw new Error(`arbeitsagentur: entry "${entry.name || '(unnamed)'}" has no arbeitsagentur.keywords[]`);
    }
    // ctx.maxPages is set only by verify-portals.mjs's health probe. While
    // probing, a ctx.fetch* rejection (its budget sentinel included) must
    // propagate unwrapped instead of being swallowed by a recall-first catch.
    const probing = Number(ctx?.maxPages) > 0;
    // The probe's page budget covers every list request in the walk (all
    // keywords, offer types and passes), not one allowance per type.
    const probeBudget = probing ? Number(ctx.maxPages) : Infinity;
    let listRequests = 0;

    /** @param {string} was @param {Record<string,string>} [extra] @param {boolean} [retry] */
    const fetchKeyword = async (was, extra = {}, retry = false) => {
      if (listRequests >= probeBudget) return [];
      listRequests++;
      const params = new URLSearchParams({
        was,
        size: String(size),
        page: '1',
        angebotsart: angebotsart[0], // default 1 = ARBEIT; callers pass each configured code
        veroeffentlichtseit: String(days),
        ...extra,
      });
      // redirect:'error' prevents SSRF via server-side redirects.
      const url = `${API_URL}?${params.toString()}`;
      const opts = {
        headers: { 'X-API-Key': API_KEY, accept: 'application/json' },
        redirect: 'error',
        timeoutMs: 12_000,
      };
      const json = retry ? await fetchJsonWithRetry(ctx, url, opts) : await ctx.fetchJson(url, opts);
      return Array.isArray(json && json.ergebnisliste) ? json.ergebnisliste : [];
    };

    /**
     * One request per configured offer type, concatenated. A failed type does
     * not discard the others; it throws only when every type failed.
     * @param {string} was @param {Record<string,string>} [extra] @param {string} label
     */
    const fetchAllTypes = async (was, extra, label) => {
      const out = [];
      let firstErr = null;
      let ok = 0;
      for (const art of angebotsart) {
        try {
          out.push(...await fetchKeyword(was, { ...extra, angebotsart: art }));
          ok++;
        } catch (err) {
          if (probing) throw err;
          firstErr = firstErr || err;
          if (angebotsart.length > 1) errors.push(`"${was}"${label} angebotsart=${art}: ${(err && err.message) || err}`);
        }
      }
      if (!ok && firstErr) throw firstErr;
      return out;
    };

    const byRef = new Map();
    /** @type {string[]} */
    const errors = [];
    let succeeded = 0; // keywords whose primary pass completed (i.e. the source answered)
    for (const kw of keywords) {
      let primary;
      try {
        // Pass A: commutable radius around `wo`, or a single nationwide pass.
        primary = wo
          ? await fetchAllTypes(kw, { wo, umkreis: String(umkreis) }, '')
          : await fetchAllTypes(kw, {}, '');
        succeeded++;
      } catch (err) {
        if (probing) throw err;
        // Recall-first: tolerate a single failed keyword and keep going.
        errors.push(`"${kw}": ${(err && err.message) || err}`);
        continue;
      }
      // Pass B (optional): a nationwide pass for remote roles hosted at a far HQ
      // (which the radius pass misses). Detection is config-driven via `remoteMatch`:
      //   'filter' — server-side home-office query + pagination, narrowing
      //              the candidate set; the title or a stated 100 % share still
      //              has to prove remote (see "What counts as proof", above)
      //   'title'  — keep only nationwide hits whose title matches the remote
      //              regex or that state 100 % home office
      // Its failure must NOT discard the primary results already fetched above.
      let wide = [];
      if (wo && remoteNationwide && remoteMatch !== 'off') {
        try {
          if (remoteMatch === 'filter') {
            // Server-side home-office filter: collect the candidates. It only
            // means "home office is possible", so these are not yet known to be
            // remote — the title or the stated share decides, below.
            // Paced and retried: this walk is up to remoteMaxPages requests per
            // offer type, back to back.
            let requests = 0;
            // A type that exhausts its retries keeps the pages it already
            // returned and does not stop the next type.
            for (const art of angebotsart) {
              try {
                for (let page = 1; page <= remoteMaxPages && listRequests < probeBudget; page++) {
                  if (requests++ > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
                  const res = await fetchKeyword(kw, { homeoffice: HOMEOFFICE_FILTER, page: String(page), angebotsart: art }, true);
                  wide.push(...res);
                  if (res.length < size) break; // short page → done
                }
              } catch (err) {
                if (probing) throw err;
                errors.push(`"${kw}" (remote pass) angebotsart=${art}: ${(err && err.message) || err}`);
              }
            }
          } else { // 'title'
            const nationwide = await fetchAllTypes(kw, {}, ' (remote pass)');
            wide = nationwide.filter(j => REMOTE_RE.test(String((j && j.stellenangebotsTitel) || '')) || Number(j && j.homeofficeprozent) >= 100);
          }
        } catch (err) {
          if (probing) throw err;
          errors.push(`"${kw}" (remote pass): ${(err && err.message) || err}`);
        }
      }
      // Pass A (commutable) keeps its city as-is.
      for (const raw of primary) {
        const job = normalizeJob(raw);
        if (job && !byRef.has(job.refnr)) byRef.set(job.refnr, job);
      }
      // Pass B roles get a `Deutschlandweit (Homeoffice)` marker, which makes
      // scan.mjs's commute-based location_filter rescue them via always_allow
      // instead of dropping them on a far office city. A wrong marker therefore
      // smuggles an office-anchored hybrid past the distance check, so it may
      // only be applied on evidence:
      //   'title'  — the posting's own title claims remote, or it states 100 %
      //              home office; take it at face value.
      //   'filter' — the home-office query narrowed the set but only means "home
      //              office possible", so the title or a stated 100 % share is
      //              what proves it. Hits with neither keep their real city.
      // Dedup by refnr first: paginating a live index can return the same posting
      // on two pages.
      const wideJobs = [...new Map(
        wide
          .map(normalizeJob)
          .filter(Boolean)
          .filter(job => !byRef.has(job.refnr))
          .map(job => [job.refnr, job]),
      ).values()];
      for (const job of wideJobs) {
        // A 100 % home-office hit already carries the marker from normalizeJob().
        if (job.inGermany && (remoteMatch !== 'filter' || REMOTE_RE.test(job.title))) job.location = withRemoteMarker(job.location);
        if (!byRef.has(job.refnr)) byRef.set(job.refnr, job);
      }
    }

    // Total outage = every primary request failed. A keyword that answered with
    // zero results is not an outage, so key off the success count, not the
    // deduped result size — otherwise a legitimately-empty search throws.
    if (succeeded === 0 && errors.length) {
      throw new Error(`arbeitsagentur: all ${keywords.length} keyword request(s) failed — ${errors[0]}`);
    }
    if (errors.length) {
      console.warn(`arbeitsagentur: "${entry.name || '(unnamed)'}" returned partial results — ${errors.join('; ')}`);
    }

    return [...byRef.values()].map(({ refnr, inGermany, ...job }) => job);
  },
};
