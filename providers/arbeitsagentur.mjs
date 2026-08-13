// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Arbeitsagentur (Bundesagentur für Arbeit) provider — hits the public Jobsuche
// REST API (the same endpoint arbeitsagentur.de uses), so it lives in-process
// alongside the other JSON-API providers (greenhouse/ashby shape). One or more
// keywords are queried; scan.mjs applies title_filter + location_filter + dedup
// afterwards, so this provider over-fetches (recall-first).
//
// Configure via a `job_boards` (or `tracked_companies`) entry with
// `provider: arbeitsagentur` and an `arbeitsagentur:` block:
//
//   - name: Arbeitsagentur — ML/KI Deutschland
//     provider: arbeitsagentur
//     arbeitsagentur:
//       keywords: ["Machine Learning Engineer", "Data Scientist"]  # required
//       wo: Berlin              # optional anchor city; omit for nationwide
//       umkreis: 50             # km radius around `wo` (default 50)
//       days: 30                # recency window in days (default 30)
//       size: 100               # results per keyword (1–100, default 100)
//       remoteNationwide: true  # also run a nationwide pass keeping remote-eligible hits
//       remoteMatch: filter     # how that pass detects remote (default 'title'):
//                               #   'filter' — server-side `homeoffice=nv_true` query + pagination to narrow
//                               #              the set, then the same title check as 'title'. Recommended:
//                               #              same standard of proof, applied to a far better candidate set.
//                               #              (v4 confirmed `homeofficetyp: VOLLSTAENDIG` per hit via the
//                               #              detail endpoint; v6 no longer serves it to this key — #2494.)
//                               #   'title'  — regex on the job title only (cheap; misses body-level remote)
//                               #   'off'    — skip the remote pass entirely
//       remoteMaxPages: 10      # 'filter' mode: max pages to paginate (size each); default 1
//     enabled: true

// v6. The v4 search and detail endpoints both 404 as of 2026-08-04 (#2494);
// v5 does too. v6 keeps every query parameter this provider sends
// (was/wo/umkreis/veroeffentlichtseit/angebotsart/homeoffice/page/size) but
// renames the response fields — see normalizeJob().
const API_URL = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs';
const API_KEY = 'jobboerse-jobsuche'; // public client key the arbeitsagentur.de UI uses
const DETAIL_BASE = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/';
const REMOTE_RE = /(remote|homeoffice|home[-\s]?office|ortsunabh|deutschlandweit|bundesweit|100\s*%|full[-\s]?remote|fully remote)/i;

// Clamp a runtime integer into [min, max], falling back to `def` for NaN, so a
// stray portals.yml value can't produce empty (size=0) or pathological queries.
function intInRange(val, def, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

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
  };
}

/**
 * Assembles a human-readable location from v6's `stellenlokationen` array. Most
 * postings are in Germany; only a non-DE country is appended so the downstream
 * location_filter can act on it.
 *
 * v4 exposed a single `arbeitsort` object whose `region` was a display name, so
 * it was joined onto the city. v6 nests the address one level deeper and its
 * `region` is an uppercase federal-state enum (`BADEN_WUERTTEMBERG`), which
 * would only add noise to a string the commute filter has to match — so the
 * city stands alone. A posting may list several locations; the downstream shape
 * is one string, so the first is used, as v4's single field effectively was.
 * @param {any} lokationen
 */
export function buildLocation(lokationen) {
  if (!Array.isArray(lokationen)) return '';
  const adresse = lokationen[0] && lokationen[0].adresse;
  if (!adresse || typeof adresse !== 'object') return '';
  const loc = String(adresse.ort || '').trim();
  const land = adresse.land;
  if (land && !/deutschland|germany/i.test(land)) return loc ? `${loc}, ${land}` : String(land);
  return loc;
}

/**
 * Normalizes one raw Arbeitsagentur posting into a Job plus its `refnr` (kept
 * for dedup, stripped before the provider returns). Returns null when the
 * posting lacks a usable reference number or title.
 *
 * v6 renamed every field this reads — `refnr` → `referenznummer`, `titel` →
 * `stellenangebotsTitel`, `arbeitgeber` → `firma`, `arbeitsort` →
 * `stellenlokationen[]` (#2494). The public job-detail page still resolves by
 * reference number, so the outgoing URL is unchanged.
 * @param {any} job
 * @returns {({title: string, url: string, company: string, location: string, refnr: string}) | null}
 */
export function normalizeJob(job) {
  const refnr = job && job.referenznummer;
  const title = String((job && job.stellenangebotsTitel) || '').trim();
  if (!refnr || !title) return null;
  return {
    title,
    url: DETAIL_BASE + encodeURIComponent(String(refnr)),
    company: String((job && job.firma) || '').trim(),
    location: buildLocation(job && job.stellenlokationen),
    refnr: String(refnr),
  };
}

// What `remoteMatch: 'filter'` lost in the v6 move, and why it still exists.
//
// v4 proved a role was fully remote by reading `homeofficetyp: VOLLSTAENDIG`
// from the detail endpoint, because the `homeoffice=nv_true` query alone also
// returns `NACH_VEREINBARUNG` ("nach Absprache") — an office-anchored hybrid.
// That proof is gone: v6's detail endpoint answers 403 to this public client
// key, and the only home-office field on a v6 search hit is the boolean
// `homeofficemoeglich`, which is exactly what nv_true already filtered on (a
// sampled nv_true page was 100% `true`). A boolean that cannot separate
// fully-remote from hybrid is not evidence.
//
// So 'filter' keeps the half that still works — the server-side query narrows
// the candidate set far better than a nationwide sweep — and falls back to the
// posting's own title for the proof, the same standard 'title' mode uses. A
// candidate whose title makes no remote claim keeps its real city, which is the
// fail-closed behaviour an unverifiable lookup had in v4: the `Deutschlandweit
// (Homeoffice)` marker exempts a job from the commute location_filter, so
// tagging on nv_true alone would smuggle every hybrid past it.

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
    const { keywords, wo, umkreis, days, size, remoteNationwide, remoteMatch, remoteMaxPages } = parseArbeitsagenturConfig(entry);
    if (!keywords.length) {
      throw new Error(`arbeitsagentur: entry "${entry.name || '(unnamed)'}" has no arbeitsagentur.keywords[]`);
    }

    /** @param {string} was @param {Record<string,string>} [extra] */
    const fetchKeyword = async (was, extra = {}) => {
      const params = new URLSearchParams({
        was,
        size: String(size),
        page: '1',
        angebotsart: '1', // 1 = ARBEIT (employment; excludes Ausbildung/Selbständigkeit)
        veroeffentlichtseit: String(days),
        ...extra,
      });
      // redirect:'error' prevents SSRF via server-side redirects.
      const json = await ctx.fetchJson(`${API_URL}?${params.toString()}`, {
        headers: { 'X-API-Key': API_KEY, accept: 'application/json' },
        redirect: 'error',
        timeoutMs: 12_000,
      });
      return Array.isArray(json && json.ergebnisliste) ? json.ergebnisliste : [];
    };

    const byRef = new Map();
    const errors = [];
    let succeeded = 0; // keywords whose primary pass completed (i.e. the source answered)
    for (const kw of keywords) {
      let primary;
      try {
        // Pass A: commutable radius around `wo`, or a single nationwide pass.
        primary = wo
          ? await fetchKeyword(kw, { wo, umkreis: String(umkreis) })
          : await fetchKeyword(kw);
        succeeded++;
      } catch (err) {
        // Recall-first: tolerate a single failed keyword and keep going.
        errors.push(`"${kw}": ${(err && err.message) || err}`);
        continue;
      }
      // Pass B (optional): a nationwide pass for remote roles hosted at a far HQ
      // (which the radius pass misses). Detection is config-driven via `remoteMatch`:
      //   'filter' — server-side `homeoffice=nv_true` query + pagination, narrowing
      //              the candidate set; the title still has to claim remote (see
      //              the note on what v6 took away, above)
      //   'title'  — keep only nationwide hits whose title matches the remote regex
      // Its failure must NOT discard the primary results already fetched above.
      let wide = [];
      if (wo && remoteNationwide && remoteMatch !== 'off') {
        try {
          if (remoteMatch === 'filter') {
            // Server-side home-office filter: collect the candidates. `nv_true` only
            // means "home office is possible", so these are not yet known to be
            // remote — the title check below is what decides.
            for (let page = 1; page <= remoteMaxPages; page++) {
              const res = await fetchKeyword(kw, { homeoffice: 'nv_true', page: String(page) });
              wide.push(...res);
              if (res.length < size) break; // short page → done
            }
          } else { // 'title'
            const nationwide = await fetchKeyword(kw);
            wide = nationwide.filter(j => REMOTE_RE.test(String((j && j.stellenangebotsTitel) || '')));
          }
        } catch (err) {
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
      //   'title'  — the posting's own title claims remote; take it at face value.
      //   'filter' — `homeoffice=nv_true` narrowed the set but only means "home
      //              office possible", so the title is what proves it. Hits that
      //              make no such claim keep their real city.
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
        if (remoteMatch !== 'filter' || REMOTE_RE.test(job.title)) {
          job.location = job.location ? `${job.location} · Deutschlandweit (Homeoffice)` : 'Deutschlandweit (Homeoffice)';
        }
        if (!byRef.has(job.refnr)) byRef.set(job.refnr, job);
      }
    }

    // Total outage = every primary request failed. A keyword that answered with
    // zero results is not an outage, so key off the success count, not the
    // deduped result size — otherwise a legitimately-empty search throws.
    if (succeeded === 0 && errors.length) {
      throw new Error(`arbeitsagentur: all ${keywords.length} keyword request(s) failed — ${errors[0]}`);
    }

    return [...byRef.values()].map(({ refnr, ...job }) => job);
  },
};
