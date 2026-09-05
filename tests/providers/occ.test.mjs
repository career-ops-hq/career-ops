// tests/providers/occ.test.mjs — OCC Mundial (occ.com.mx) provider.
// Offline only: every assertion runs against a fixture of the real card markup,
// so CI never depends on occ.com.mx being reachable.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — occ');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/occ.mjs')).href);
  const occ = mod.default;
  const { buildSearchUrl, parseCards } = mod;

  if (occ.id === 'occ') pass('occ.id is "occ"');
  else fail(`occ.id is ${JSON.stringify(occ.id)}`);

  if (typeof occ.fetch === 'function') pass('occ.fetch is a function');
  else fail('occ.fetch is not a function');

  // ── URL shape ────────────────────────────────────────────────────────────
  // Page 1 carries no suffix.
  if (buildSearchUrl('automatizacion', null, 1) === 'https://www.occ.com.mx/empleos/de-automatizacion/') {
    pass('buildSearchUrl() page 1 has no pagination suffix');
  } else {
    fail(`page 1 = ${buildSearchUrl('automatizacion', null, 1)}`);
  }

  // Pagination is a SLUG suffix. ?page=N silently returns page 1 on the live
  // site, so this assertion guards the one shape that actually advances.
  if (buildSearchUrl('automatizacion', null, 3) === 'https://www.occ.com.mx/empleos/de-automatizacion-pagina-3/') {
    pass('buildSearchUrl() paginates via the -pagina-N slug, not a query param');
  } else {
    fail(`page 3 = ${buildSearchUrl('automatizacion', null, 3)}`);
  }

  // Accents fold and the state becomes an en-{slug} path segment.
  if (buildSearchUrl('robótica', 'Nuevo León', 2) === 'https://www.occ.com.mx/empleos/de-robotica-pagina-2/en-nuevo-leon/') {
    pass('buildSearchUrl() folds accents and appends the state segment');
  } else {
    fail(`accented+state = ${buildSearchUrl('robótica', 'Nuevo León', 2)}`);
  }

  // Every generated URL must stay on the occ.com.mx origin.
  const origins = [
    buildSearchUrl('../../evil', null, 1),
    buildSearchUrl('automatizacion', 'https://evil.example', 1),
  ].map(u => new URL(u).origin);
  if (origins.every(o => o === 'https://www.occ.com.mx')) {
    pass('buildSearchUrl() cannot be steered off the occ.com.mx origin');
  } else {
    fail(`origins = ${JSON.stringify(origins)}`);
  }

  // ── Card parsing ─────────────────────────────────────────────────────────
  const FIXTURE = `
    <div class="card-job-offer is-highlighted" data-id='21319670' id="jobcard-21319670">
      <h2 class="text-grey-900">INGENIERO DE AUTOMATIZACI&#xD3;N</h2>
      <span class="mr-2 text-grey-900 font-base font-light">$ 40,000 - $ 50,000 Mensual</span>
      <div class="h-[21px] flex items-center gap-1">
        <span class="text-grey-900 no-underline"> Tecnoap </span>
      </div>
      <div class="no-alter-loc-text mt-1">
        <span class="text-grey-900"></span><p class="text-grey-900">San Nicol&#xE1;s de los Garza, Nuevo Le&#xF3;n</p>
      </div>
    </div>
    <div class="card-job-offer" data-id='21321698' id="jobcard-21321698">
      <h2>T&#xE9;cnico de automatizaci&#xF3;n</h2>
      <div class="h-[21px] flex items-center gap-1">
        <span class="text-grey-900"> Empresa confidencial </span>
      </div>
      <div class="no-alter-loc-text mt-1"><span></span><p>Apodaca, Nuevo Le&#xF3;n</p></div>
    </div>
    <div class="card-job-offer" id="jobcard-broken"><h2>Sin data-id</h2></div>
    <div class="card-job-offer" data-id='999'><h2>   </h2></div>
  `;
  const cards = parseCards(FIXTURE);

  if (cards.length === 2) pass('parseCards() drops cards missing data-id or a non-empty title');
  else fail(`parseCards() returned ${cards.length} cards, expected 2`);

  const [a, b] = cards;

  if (a?.title === 'INGENIERO DE AUTOMATIZACIÓN') pass('parseCards() decodes HTML entities in the title');
  else fail(`title = ${JSON.stringify(a?.title)}`);

  if (a?.url === 'https://www.occ.com.mx/empleo/oferta/21319670/') pass('parseCards() builds the posting URL from data-id');
  else fail(`url = ${JSON.stringify(a?.url)}`);

  if (a?.company === 'Tecnoap') pass('parseCards() extracts the company name');
  else fail(`company = ${JSON.stringify(a?.company)}`);

  if (a?.location === 'San Nicolás de los Garza, Nuevo León') pass('parseCards() extracts and decodes the location');
  else fail(`location = ${JSON.stringify(a?.location)}`);

  // "Empresa confidencial" is OCC's own placeholder, not an employer name.
  // It must become the locale-invariant "?" marker (#1596) so the Spanish
  // string never reaches the tracker or a report.
  if (b?.company === '?') pass('parseCards() normalizes "Empresa confidencial" to the "?" marker');
  else fail(`confidential company = ${JSON.stringify(b?.company)}`);

  if (parseCards('').length === 0 && parseCards('<html></html>').length === 0) {
    pass('parseCards() returns [] for empty and card-less HTML');
  } else {
    fail('parseCards() did not return [] for empty input');
  }

  // ── fetch() end-to-end against a stub ctx (no network) ───────────────────
  const pagesRequested = [];
  const stubCtx = {
    // No-op clock: the provider paces requests (INTER_REQUEST_DELAY_MS) and
    // backs off on retry. Without this the suite would sleep for real.
    async sleep() {},
    async fetchText(url) {
      pagesRequested.push(url);
      // Mirror the live quirk: an out-of-range page re-serves page 1.
      return FIXTURE;
    },
  };
  const jobs = await occ.fetch({ name: 'OCC', queries: ['automatizacion'], states: ['nuevo-leon'], max_pages: 3 }, stubCtx);

  if (jobs.length === 2) pass('fetch() dedups by posting id when OCC re-serves page 1');
  else fail(`fetch() returned ${jobs.length} jobs, expected 2 after dedup`);

  if (pagesRequested.length === 2) pass('fetch() stops after the first page that yields no new ids');
  else fail(`fetch() requested ${pagesRequested.length} pages: ${JSON.stringify(pagesRequested)}`);

  if (jobs.every(j => j.title && j.url && typeof j.company === 'string' && typeof j.location === 'string')) {
    pass('fetch() returns the normalized {title, url, company, location} shape');
  } else {
    fail(`fetch() shape = ${JSON.stringify(jobs)}`);
  }

  // ── Outage vs. empty board ───────────────────────────────────────────────
  // A board answering every request with a Cloudflare challenge (HTTP 403) must
  // NOT read downstream as a live board with no matching jobs, so a total
  // outage throws instead of returning [].
  const failingCtx = { async sleep() {}, async fetchText() { throw new Error('boom'); } };
  let outage = null;
  try {
    await occ.fetch({ name: 'OCC', queries: ['a', 'b'], max_pages: 2 }, failingCtx);
  } catch (err) { outage = err; }
  if (outage && /all \d+ search request\(s\) failed/.test(outage.message)) {
    pass('fetch() throws on a total outage instead of returning an empty board');
  } else {
    fail(`total outage did not throw as expected: ${outage && outage.message}`);
  }

  // Recall-first still holds for a PARTIAL failure: one dead keyword must not
  // take down a board that otherwise answered.
  let firstQuery = true;
  const partialCtx = {
    async sleep() {},
    async fetchText(url) {
      if (firstQuery && url.includes('de-dead')) throw new Error('boom');
      firstQuery = false;
      return FIXTURE;
    },
  };
  const partial = await occ.fetch({ name: 'OCC', queries: ['dead', 'alive'], max_pages: 1 }, partialCtx);
  if (Array.isArray(partial) && partial.length === 2) {
    pass('fetch() tolerates one failed keyword when another answers');
  } else {
    fail(`partial failure = ${JSON.stringify(partial)}`);
  }

  // ── queries is required ──────────────────────────────────────────────────
  // No DEFAULT_QUERIES: a built-in keyword list would be one user's search
  // profile silently applied to everyone else's scan.
  for (const badEntry of [{ name: 'OCC' }, { name: 'OCC', queries: [] }, { name: 'OCC', queries: ['  '] }]) {
    let threw = null;
    try {
      await occ.fetch(badEntry, stubCtx);
    } catch (err) { threw = err; }
    if (threw && /requires a non-empty queries/.test(threw.message)) {
      pass(`fetch() rejects ${JSON.stringify(badEntry.queries ?? null)} queries with a clear message`);
    } else {
      fail(`missing queries did not throw: ${threw && threw.message}`);
    }
  }

  // ── ctx.maxPages (verify-portals.mjs health probe) ───────────────────────
  const probeRequests = [];
  const probeCtx = {
    async sleep() {},
    async fetchText(url) {
      probeRequests.push(url);
      // Every page yields fresh ids, so only ctx.maxPages can stop the loop.
      return FIXTURE.replace(/2131967\d/g, String(1000 + probeRequests.length));
    },
  };
  await occ.fetch({ name: 'OCC', queries: ['x'], max_pages: 10 }, { ...probeCtx, maxPages: 1 });
  if (probeRequests.length === 1) {
    pass('fetch() honours ctx.maxPages=1 even when max_pages says 10');
  } else {
    fail(`ctx.maxPages=1 issued ${probeRequests.length} requests`);
  }

  // While probing, a per-request error must propagate UNWRAPPED so
  // verify-portals.mjs's `err instanceof ProbePageBudgetReached` still works.
  class FakeSentinel extends Error {}
  let sentinel = null;
  let sentinelAttempts = 0;
  try {
    await occ.fetch(
      { name: 'OCC', queries: ['a', 'b'], max_pages: 3 },
      { async sleep() {}, maxPages: 1, async fetchText() { sentinelAttempts++; throw new FakeSentinel(); } },
    );
  } catch (err) { sentinel = err; }
  if (sentinel instanceof FakeSentinel) {
    pass('fetch() propagates a probe sentinel unwrapped instead of flattening it to []');
  } else {
    fail(`probe sentinel = ${sentinel && sentinel.constructor.name}`);
  }
  if (sentinelAttempts === 1) {
    pass('fetch() does not retry while probing, so the sentinel costs one request');
  } else {
    fail(`probe sentinel took ${sentinelAttempts} requests`);
  }

  // ── source-policy rule 1: never fabricate an employer ────────────────────
  const NO_COMPANY = `
    <div class="card-job-offer" data-id='777'><h2>Sin empresa</h2>
      <div class="no-alter-loc-text"><span></span><p>Monterrey</p></div>
    </div>`;
  const anonCtx = { async sleep() {}, async fetchText() { return NO_COMPANY; } };
  const anon = await occ.fetch({ name: 'OCC Mundial', queries: ['x'], max_pages: 1 }, anonCtx);
  if (anon[0]?.company === '?') {
    pass('fetch() emits the "?" marker for an unparsed employer, not the board name');
  } else {
    fail(`unparsed company = ${JSON.stringify(anon[0]?.company)}`);
  }

  // max_pages is bounded so a bad config cannot hammer the site.
  const manyPages = [];
  const countingCtx = {
    async sleep() {},
    async fetchText(url) { manyPages.push(url); return FIXTURE.replace(/21319670/g, String(manyPages.length)); },
  };
  await occ.fetch({ name: 'OCC', queries: ['x'], max_pages: 999 }, countingCtx);
  if (manyPages.length <= 10) pass('fetch() caps max_pages at 10 regardless of config');
  else fail(`fetch() requested ${manyPages.length} pages with max_pages: 999`);

} catch (err) {
  fail(`occ provider test threw: ${err.message}`);
}
