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

  // A transport failure on one keyword must not take down the whole board.
  const failingCtx = { async fetchText() { throw new Error('boom'); } };
  const resilient = await occ.fetch({ name: 'OCC', queries: ['a', 'b'], max_pages: 2 }, failingCtx);
  if (Array.isArray(resilient) && resilient.length === 0) {
    pass('fetch() survives transport errors and returns an empty array');
  } else {
    fail(`fetch() on failing ctx = ${JSON.stringify(resilient)}`);
  }

  // max_pages is bounded so a bad config cannot hammer the site.
  const manyPages = [];
  const countingCtx = {
    async fetchText(url) { manyPages.push(url); return FIXTURE.replace(/21319670/g, String(manyPages.length)); },
  };
  await occ.fetch({ name: 'OCC', queries: ['x'], max_pages: 999 }, countingCtx);
  if (manyPages.length <= 10) pass('fetch() caps max_pages at 10 regardless of config');
  else fail(`fetch() requested ${manyPages.length} pages with max_pages: 999`);

} catch (err) {
  fail(`occ provider test threw: ${err.message}`);
}
