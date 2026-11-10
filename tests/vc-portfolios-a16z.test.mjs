// tests/vc-portfolios-a16z.test.mjs — the a16z seed must read the company list
// a16z.com/portfolio/ actually embeds, fail loudly when it finds none, and seed
// companies must be probed on Ashby, Greenhouse and Lever, not Greenhouse only.
//
// The parser had targeted JSON-LD Organization blocks, data-company-name
// attributes and portfolio-card anchors. The live page has none of them, so
// `--seeds a16z` returned 0 companies and reported it as a clean run. The
// fixture is the real page cut to five companies: the data-companies attribute,
// the inline window.a16z_portfolio_companies script, and a logo-ticker element.

import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nvc-portfolios — a16z portfolio markup and seed ATS probing');

const seeds = await import(pathToFileURL(join(ROOT, 'seeds/vc-portfolios.mjs')).href);
const { parseA16zPayload, fetchA16zCompanies, fetchYCCompanies, toPortalEntries, toPortalEntry } = seeds;
const { probeSeedBoards } = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);

const FIXTURE = readFileSync(join(ROOT, 'tests/fixtures/a16z-portfolio-trimmed.html'), 'utf8');
const ATTR_RE = /\sdata-companies="[^"]*"/;
const SCRIPT_RE = /<script>window\.a16z_portfolio_companies[\s\S]*?<\/script>/;

const names = (list) => list.map((c) => c.name);
const bySlug = (list, slug) => list.find((c) => c.slug === slug);

// ── Parser: data-companies attribute ─────────────────────────────────

{
  const out = parseA16zPayload(FIXTURE);
  const want = ['Figma', 'Groupon, Inc.', 'Abridge'];
  if (JSON.stringify(names(out)) === JSON.stringify(want)
    && out.every((c) => c.source === 'a16z')
    && bySlug(out, 'figma')?.url === 'https://figma.com'
    && bySlug(out, 'abridge')?.url === 'https://abridge.com') {
    pass('a16z: reads the data-companies attribute; acquired companies are left out by default');
  } else {
    fail(`a16z: attribute parse wrong — got ${JSON.stringify(out)}`);
  }

  if (bySlug(out, 'groupon') && !bySlug(out, 'groupon-inc')) {
    pass('a16z: a legal-name suffix ("Groupon, Inc.") is dropped from the slug, kept in the name');
  } else {
    fail(`a16z: legal-suffix slug wrong — slugs ${JSON.stringify(out.map((c) => c.slug))}`);
  }

  if (!out.some((c) => /spacex/i.test(c.name))) {
    pass('a16z: the logo-ticker data-company element is not read as the list');
  } else {
    fail('a16z: the logo-ticker entry leaked into the company list');
  }
}

{
  const out = parseA16zPayload(FIXTURE, { includeAcquired: true });
  const walker = bySlug(out, 'walker-company-brands');
  const amiato = bySlug(out, 'amiato');
  if (out.length === 5 && walker?.name === 'Walker & Company Brands' && amiato && amiato.url === '') {
    pass('a16z: includeAcquired keeps them; entities decode; an a16z.com profile URL is not used as the website');
  } else {
    fail(`a16z: includeAcquired parse wrong — got ${JSON.stringify(out)}`);
  }
}

// ── Parser: inline script fallback ───────────────────────────────────

{
  const noAttr = FIXTURE.replace(ATTR_RE, '');
  const out = parseA16zPayload(noAttr);
  if (JSON.stringify(names(out)) === JSON.stringify(['Figma', 'Groupon, Inc.', 'Abridge'])
    && bySlug(out, 'figma')?.url === 'https://figma.com') {
    pass('a16z: falls back to window.a16z_portfolio_companies, trimming the trailing ";</script>"');
  } else {
    fail(`a16z: script fallback wrong — got ${JSON.stringify(out)}`);
  }
}

{
  const tickerOnly = FIXTURE.replace(ATTR_RE, '').replace(SCRIPT_RE, '');
  const broken = FIXTURE.replace(SCRIPT_RE, '').replace(/data-companies="\[/, 'data-companies="[{');
  if (parseA16zPayload(tickerOnly).length === 0
    && parseA16zPayload(broken).length === 0
    && parseA16zPayload('').length === 0) {
    pass('a16z: a page with neither list, or a list that is not JSON, parses to []');
  } else {
    fail('a16z: expected [] for a page with no readable list');
  }
}

// ── fetchA16zCompanies / fetchYCCompanies: zero companies is an error ─

const realFetch = global.fetch;
const serve = (body) => {
  global.fetch = async () => ({
    ok: true,
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
    async json() { return body; },
  });
};

try {
  serve(FIXTURE);
  const live = await fetchA16zCompanies();
  if (live.length === 3) pass('fetchA16zCompanies: returns the parsed companies');
  else fail(`fetchA16zCompanies: expected 3 companies, got ${live.length}`);

  serve(FIXTURE.replace(ATTR_RE, '').replace(SCRIPT_RE, ''));
  let threw = null;
  try { await fetchA16zCompanies(); } catch (err) { threw = err; }
  if (threw && /parsed to 0 companies/.test(threw.message)) {
    pass('fetchA16zCompanies: a page that parses to 0 companies throws instead of returning []');
  } else {
    fail(`fetchA16zCompanies: expected a 0-companies error, got ${threw ? threw.message : 'no error'}`);
  }

  serve({ companies: [], page: 1, totalPages: 256 });
  threw = null;
  try { await fetchYCCompanies(); } catch (err) { threw = err; }
  if (threw && /page 1 parsed to 0 companies/.test(threw.message)) {
    pass('fetchYCCompanies: an empty first page throws instead of returning []');
  } else {
    fail(`fetchYCCompanies: expected a page-1 error, got ${threw ? threw.message : 'no error'}`);
  }
} finally {
  global.fetch = realFetch;
}

// ── toPortalEntries: candidate order ─────────────────────────────────

{
  const urls = toPortalEntries({ name: 'NewCo', slug: 'newco', url: 'https://newco.io', source: 'yc' }).map((e) => e.careers_url);
  const want = ['https://jobs.ashbyhq.com/newco', 'https://job-boards.greenhouse.io/newco', 'https://jobs.lever.co/newco'];
  if (JSON.stringify(urls) === JSON.stringify(want)) {
    pass('toPortalEntries: no ATS hint → Ashby, Greenhouse, Lever candidates from the slug, in that order');
  } else {
    fail(`toPortalEntries order wrong — got ${JSON.stringify(urls)}`);
  }

  const hinted = toPortalEntries({ name: 'Acme', slug: 'acme', url: '', source: 'yc', ats: 'lever', ats_id: 'acme-inc' });
  const unknownHint = toPortalEntries({ name: 'Acme', slug: 'acme', url: '', source: 'yc', ats: 'workday', ats_id: 'acme' });
  if (hinted.length === 1 && hinted[0].careers_url === 'https://jobs.lever.co/acme-inc' && unknownHint.length === 3) {
    pass('toPortalEntries: a known ATS hint gives one candidate; an unknown one falls back to the slug probes');
  } else {
    fail(`toPortalEntries hint wrong — hinted ${JSON.stringify(hinted)}, unknown ${unknownHint.length}`);
  }

  if (toPortalEntry({ name: 'NewCo', slug: 'newco', url: '', source: 'yc' }).careers_url === want[0]) {
    pass('toPortalEntry: returns the first candidate');
  } else {
    fail('toPortalEntry: did not return the first candidate');
  }
}

// ── probeSeedBoards: 404 moves on, anything else is an error ─────────

const host = (h) => ({ id: h, detect: (e) => new URL(e.careers_url).hostname === h });
const PROVIDERS = [host('job-boards.greenhouse.io'), host('jobs.lever.co'), host('jobs.ashbyhq.com')];
const CANDIDATES = toPortalEntries({ name: 'NewCo', slug: 'newco', url: '', source: 'yc' });
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

/** @param {Record<string, any[] | Error>} answers  keyed by provider id */
const board = (answers, calls) => async (p) => {
  calls.push(p.id);
  const a = answers[p.id];
  if (a instanceof Error) throw a;
  return a;
};

{
  const calls = [];
  const r = await probeSeedBoards(CANDIDATES, PROVIDERS, board({
    'jobs.ashbyhq.com': httpError(404),
    'job-boards.greenhouse.io': [],
    'jobs.lever.co': [{ title: 'never asked' }],
  }, calls));
  if (r.found && r.provider.id === 'job-boards.greenhouse.io' && r.jobs.length === 0
    && JSON.stringify(calls) === JSON.stringify(['jobs.ashbyhq.com', 'job-boards.greenhouse.io'])) {
    pass('probeSeedBoards: a 404 moves to the next ATS; the first board that exists wins, even with 0 jobs');
  } else {
    fail(`probeSeedBoards fall-through wrong — ${JSON.stringify({ found: r.found, provider: r.provider?.id, calls })}`);
  }
}

{
  const calls = [];
  const r = await probeSeedBoards(CANDIDATES, PROVIDERS, board({
    'jobs.ashbyhq.com': httpError(404),
    'job-boards.greenhouse.io': httpError(404),
    'jobs.lever.co': httpError(404),
  }, calls));
  if (r.found === false && calls.length === 3) {
    pass('probeSeedBoards: 404 on every ATS is "no board found", not an error');
  } else {
    fail(`probeSeedBoards all-404 wrong — ${JSON.stringify({ r, calls })}`);
  }
}

{
  const calls = [];
  let threw = null;
  try {
    await probeSeedBoards(CANDIDATES, PROVIDERS, board({
      'jobs.ashbyhq.com': httpError(503),
      'job-boards.greenhouse.io': [{ title: 'never asked' }],
    }, calls));
  } catch (err) { threw = err; }
  if (threw?.status === 503 && calls.length === 1) {
    pass('probeSeedBoards: a non-404 failure throws (counted as an unreachable board), no further probes');
  } else {
    fail(`probeSeedBoards non-404 wrong — ${threw ? threw.message : 'no error'}, calls ${JSON.stringify(calls)}`);
  }
}

{
  const single = toPortalEntries({ name: 'Acme', slug: 'acme', url: '', source: 'yc', ats: 'lever', ats_id: 'acme' });
  let threw = null;
  try {
    await probeSeedBoards(single, PROVIDERS, board({ 'jobs.lever.co': httpError(404) }, []));
  } catch (err) { threw = err; }
  if (threw?.status === 404) {
    pass('probeSeedBoards: a 404 on the one board the source named is an error, not "no board"');
  } else {
    fail(`probeSeedBoards hinted-404 wrong — ${threw ? threw.message : 'no error'}`);
  }
}

{
  const exploding = [{ id: 'boom', detect: () => { throw new Error('bad url'); } }, ...PROVIDERS];
  const r = await probeSeedBoards(CANDIDATES, exploding, board({ 'jobs.ashbyhq.com': [{ title: 'Eng' }] }, []));
  const none = await probeSeedBoards([{ name: 'Site', careers_url: 'https://site.example' }], PROVIDERS, board({}, []));
  if (r.found && r.provider.id === 'jobs.ashbyhq.com' && none.found === false) {
    pass('probeSeedBoards: a detect() that throws is skipped; a URL no provider claims is "no board found"');
  } else {
    fail(`probeSeedBoards detect handling wrong — ${JSON.stringify({ r: r.provider?.id, none })}`);
  }
}

// ── runSeedScan: per-host cap on concurrent probes ───────────────────
// Each company can cost a request at each ATS API, and those APIs serve every
// board from one host. With 20 companies in flight, an uncapped probe sends 20
// requests to api.ashbyhq.com at once; runSeedScan caps each host at the
// directory sweeps' single-host limit (6).

{
  const { runSeedScan } = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);
  const inFlight = new Map();
  const peak = new Map();
  const ctx = {
    async fetchJson(url) {
      const h = new URL(url).hostname;
      inFlight.set(h, (inFlight.get(h) || 0) + 1);
      peak.set(h, Math.max(peak.get(h) || 0, inFlight.get(h)));
      await new Promise((r) => setTimeout(r, 15));
      inFlight.set(h, inFlight.get(h) - 1);
      throw httpError(404);
    },
  };
  const companies = Array.from({ length: 40 }, (_, i) => ({ name: `Co ${i}`, slug: `co-${i}`, url: '', source: 'test' }));
  seeds.SEED_SOURCES.__capTest = { fetch: async () => companies, label: 'cap test' };
  const realError = console.error;
  console.error = () => {};
  let result;
  try {
    result = await runSeedScan('__capTest', { limit: Infinity, sinceDays: 3, verbose: false }, ctx, new Set(), 'cap test');
  } finally {
    console.error = realError;
    delete seeds.SEED_SOURCES.__capTest;
  }
  const hosts = [...peak.keys()].sort();
  const maxPeak = Math.max(...peak.values());
  if (result.noBoard === 40 && result.errors === 0
    && hosts.length === 3 && maxPeak <= 6 && peak.get('api.ashbyhq.com') === 6) {
    pass(`runSeedScan: at most 6 concurrent probes per ATS host (peaks ${hosts.map((h) => `${h}=${peak.get(h)}`).join(', ')}); all-404 companies count as no board`);
  } else {
    fail(`runSeedScan per-host cap wrong — ${JSON.stringify({ noBoard: result?.noBoard, errors: result?.errors, peak: Object.fromEntries(peak) })}`);
  }
}
