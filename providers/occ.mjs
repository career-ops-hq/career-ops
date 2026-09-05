// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// OCC Mundial provider — occ.com.mx, the dominant general job board in Mexico.
//
// Why this exists: a large share of Mexican employers (mid-size industrials,
// domestic groups like Xignux and Deacero) never appear on Greenhouse, Lever,
// Ashby, Workday or SuccessFactors. They post to OCC and Computrabajo. Without
// this provider the scanner's Mexico coverage has a structural hole no amount
// of ATS probing can close.
//
// There is no public JSON API: /api/* returns 403. The search pages are
// server-rendered HTML, so we parse the job cards out of the markup with the
// same tiny-tag-extractor approach used by providers/weworkremotely.mjs and
// providers/successfactors.mjs, rather than adding an HTML-parser dependency.
//
// URL shapes (both verified live 2026-09-03):
//   https://www.occ.com.mx/empleos/de-{keyword-slug}/
//   https://www.occ.com.mx/empleos/de-{keyword-slug}/en-{state-slug}/
// Pagination is a SLUG suffix, not a query parameter. `?page=2`, `?pagina=2`,
// `?start=20` and `/2/` all silently return page 1 — the only shape that
// actually advances is:
//   https://www.occ.com.mx/empleos/de-{keyword-slug}-pagina-{N}/
// Getting this wrong looks like success (HTTP 200, 20 cards) while re-reading
// page 1 forever, so the loop below stops as soon as a page yields no new ids.
//
// Card shape (one per posting):
//   <div class="card-job-offer ..." data-id='21319670' id="jobcard-21319670">
//     <h2 ...>TITLE</h2>
//     <span class="mr-2 text-grey-900 font-base font-light ...">$ 40,000 - $ 50,000 Mensual</span>
//     <div class="h-[21px] flex items-center gap-1"><span ...>COMPANY</span>
//     <div class="no-alter-loc-text ..."><span...></span><p ...>CITY, STATE</p></div>
//
// OCC has no detect(): it is a board-wide aggregator on one host, not a
// per-employer tenant, so it is only reachable through an explicit
// `provider: occ` entry.
//
// Wire in via a `job_boards:` entry with `provider: occ`:
//   - name: OCC Mundial
//     provider: occ
//     queries: ["automatizacion", "robotica"] # REQUIRED — see below
//     states: ["nuevo-leon", "jalisco"]       # optional; omit for nationwide
//     max_pages: 3                            # optional, default 3, hard cap 10
//
// `queries` is required and has no default. OCC is a keyword-search board with
// no browsable "all jobs" listing, so a built-in default would not be a board
// default at all — it would be one user's search profile silently applied to
// everyone else's scan. Same contract as wttj and builtin.
//
// Availability note: a reviewer measured (2026-09-04) HTTP 403 with
// `cf-mitigated: challenge` from two non-Mexican egresses, on both the search
// paths and /robots.txt. Node's fetch cannot clear a JS challenge, and a
// challenge page parses to zero cards. A board that answers every request with
// a challenge therefore now throws (see the outage guard in fetch) instead of
// returning [], which would have read as a healthy but empty board.

import { BROWSER_LIKE_USER_AGENT, fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const ORIGIN = 'https://www.occ.com.mx';
const DEFAULT_MAX_PAGES = 3;
const HARD_PAGE_CAP = 10;

/** Pacing between page requests, matching the parser providers (jobbankca, careerviet). */
const INTER_REQUEST_DELAY_MS = 750;

/** Strip tags, decode entities, collapse whitespace. */
function text(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Slugify a user-supplied query into the shape OCC's path expects.
 * Accents are folded because OCC's own slugs are unaccented
 * ("automatizacion", not "automatización").
 */
function slugify(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Build one search URL. Page 1 has no suffix; later pages take `-pagina-N`
 * on the KEYWORD segment (see the URL-shape note above).
 */
export function buildSearchUrl(query, state, page) {
  const q = slugify(query);
  const kw = page > 1 ? `de-${q}-pagina-${page}` : `de-${q}`;
  const st = state ? `${slugify(state)}/` : '';
  return `${ORIGIN}/empleos/${kw}/${st ? 'en-' + st : ''}`;
}

/**
 * Parse the job cards out of one rendered search page.
 * @param {string} html
 * @returns {Array<{title:string,url:string,company:string,location:string,id:string}>}
 */
export function parseCards(html) {
  const out = [];
  // Split on the card class rather than regex-matching the whole card: the
  // markup nests divs several levels deep and a greedy match would swallow
  // the next card.
  const chunks = String(html).split('class="card-job-offer');
  for (const chunk of chunks.slice(1)) {
    const idM = chunk.match(/data-id='(\d+)'/);
    if (!idM) continue;
    const id = idM[1];

    const titleM = chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    const title = titleM ? text(titleM[1]) : '';
    if (!title) continue;

    // Company sits in the first span inside the h-[21px] row.
    const compM = chunk.match(/h-\[21px\][^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/);
    const company = compM ? text(compM[1]) : '';

    // Location is the <p> inside .no-alter-loc-text.
    const locM = chunk.match(/no-alter-loc-text[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
    const location = locM ? text(locM[1]) : '';

    out.push({
      id,
      title,
      url: `${ORIGIN}/empleo/oferta/${id}/`,
      // "Empresa confidencial" is OCC's own placeholder, not a company name.
      // Normalize it to the locale-invariant marker the tracker expects (#1596)
      // instead of letting the Spanish string leak into reports.
      company: /^empresa confidencial$/i.test(company) ? '?' : company,
      location,
    });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'occ',

  async fetch(entry, ctx) {
    // No default queries: OCC is a keyword-search board with no browsable
    // "all jobs" listing, so a built-in list would be one profile's search
    // silently applied to every user. Fail loudly instead (cf. wttj, builtin).
    const queries = Array.isArray(entry.queries)
      ? entry.queries.map((q) => String(q).trim()).filter(Boolean)
      : [];
    if (!queries.length) {
      throw new Error(
        `occ: entry "${entry.name || 'OCC'}" requires a non-empty queries: [...] list `
        + '(e.g. queries: ["automatizacion", "robotica"]) — OCC is a keyword-search '
        + 'board and has no default listing to scan.',
      );
    }

    const states = Array.isArray(entry.states) && entry.states.length
      ? entry.states : [null];

    // verify-portals.mjs's health probe sets ctx.maxPages (1): it only needs the
    // first page to tell a live board from a broken one and must not walk the
    // whole board. Honour it as a ceiling over the entry's own cap.
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const entryMaxPages = Math.min(
      Number.isInteger(entry.max_pages) && entry.max_pages > 0 ? entry.max_pages : DEFAULT_MAX_PAGES,
      HARD_PAGE_CAP,
    );
    const maxPages = probing ? Math.min(entryMaxPages, ctx.maxPages) : entryMaxPages;

    const seen = new Set();
    const jobs = [];
    const errors = [];
    let succeeded = 0; // query/state pairs whose first request the board answered

    for (const query of queries) {
      for (const state of states) {
        let answered = false;
        for (let page = 1; page <= maxPages; page++) {
          await sleep(INTER_REQUEST_DELAY_MS, ctx);

          const url = buildSearchUrl(query, state, page);
          let html;
          try {
            html = await fetchTextWithRetry(ctx, url, {
              headers: { 'User-Agent': BROWSER_LIKE_USER_AGENT },
              redirect: 'error',
            // isRetryableError() treats a status-less rejection as retryable, and
            // verify-portals.mjs's budget sentinel is status-less: retrying it
            // would burn the probe's remaining budget re-raising the same stop
            // signal. The probe wants one page, so it gets one request.
            }, probing ? { retries: 0 } : {});
            answered = true;
          } catch (err) {
            // While probing, propagate unwrapped so verify-portals.mjs's
            // error-identity checks (e.g. ProbePageBudgetReached) still work —
            // flattening it here would turn the sentinel into an empty board.
            if (probing) throw err;
            // Otherwise recall-first: one bad keyword/state/page must not kill
            // the whole board, but record it for the outage guard below.
            if (page === 1) errors.push(`"${query}"${state ? `/${state}` : ''}: ${(err && err.message) || err}`);
            break;
          }

          const cards = parseCards(html);
          if (!cards.length) break;

          // OCC answers an out-of-range page with page 1 rather than an empty
          // result, so "no new ids on this page" is the real end-of-results
          // signal. Without this the loop would re-add page 1 max_pages times.
          let fresh = 0;
          for (const c of cards) {
            if (seen.has(c.id)) continue;
            seen.add(c.id);
            fresh++;
            jobs.push({
              title: c.title,
              url: c.url,
              // Never substitute the board's own name for a missing employer:
              // source-policy rule 1. parseCards already emits the '?' marker
              // for OCC's "Empresa confidencial" placeholder; an unparsed row
              // gets the same marker rather than a fabricated company.
              company: c.company || '?',
              location: c.location,
            });
          }
          if (fresh === 0) break;
        }
        if (answered) succeeded++;
      }
    }

    // Total outage: every query/state pair's first request failed. A Cloudflare
    // challenge answers every request with 403, and returning [] here would read
    // downstream as a live board that simply has no matching jobs.
    if (succeeded === 0 && errors.length) {
      throw new Error(`occ: all ${errors.length} search request(s) failed — ${errors[0]}`);
    }

    return jobs;
  },
};
