// tests/providers/bwi.test.mjs — provider-contract tests for the BWI careers
// scraper. Covers id/detect/fetch, the two JSON-LD parsers, the SSRF guard on
// detail URLs (they come out of remote page content), and the detail-fetch
// budget that keeps a 270+ posting board to a bounded number of requests.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — bwi');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/bwi.mjs')).href);
  const bwi = mod.default;
  const { assertBwiUrl, collectJobUrls, parseJobPosting, slugToTitle } = mod;

  if (bwi.id === 'bwi') pass('bwi.id is "bwi"');
  else fail(`bwi.id is ${JSON.stringify(bwi.id)}`);

  // ── detect() ────────────────────────────────────────────────────────────
  const explicit = bwi.detect({ name: 'BWI', provider: 'bwi' });
  if (explicit && explicit.url === 'https://www.bwi.de/karriere/stellenangebote') {
    pass('bwi.detect() claims an explicit provider: bwi entry');
  } else {
    fail(`bwi.detect() explicit: ${JSON.stringify(explicit)}`);
  }

  const byUrl = bwi.detect({ name: 'BWI', careers_url: 'https://www.bwi.de/karriere' });
  if (byUrl && byUrl.url === 'https://www.bwi.de/karriere/stellenangebote') {
    pass('bwi.detect() auto-detects a www.bwi.de careers_url');
  } else {
    fail(`bwi.detect() by url: ${JSON.stringify(byUrl)}`);
  }

  // Host must match exactly — a lookalike domain must not be claimed.
  const evil = bwi.detect({ name: 'Evil', careers_url: 'https://www.bwi.de.attacker.example/karriere' });
  if (evil === null) pass('bwi.detect() rejects a lookalike host (www.bwi.de.attacker.example)');
  else fail(`bwi.detect() claimed a lookalike host: ${JSON.stringify(evil)}`);

  if (bwi.detect({ name: 'Other', careers_url: 'https://example.com/jobs' }) === null) {
    pass('bwi.detect() returns null for an unrelated careers_url');
  } else {
    fail('bwi.detect() claimed an unrelated careers_url');
  }

  // ── collectJobUrls(): the listing page's CollectionPage → ItemList ───────
  const LISTING = `<html><head><script type="application/ld+json">
  {"@context":"https://schema.org","@type":"CollectionPage","mainEntity":{"@type":"ItemList","itemListElement":[
    {"@type":"ListItem","position":1,"url":"https://www.bwi.de/karriere/stellenangebote/job/security-analyst-m-w-d-11111"},
    {"@type":"ListItem","position":2,"url":"https://www.bwi.de/karriere/stellenangebote/job/consultant-cloud-22222"},
    {"@type":"ListItem","position":3,"url":"https://www.bwi.de/karriere/stellenangebote/job/security-analyst-m-w-d-11111"}
  ]}}
  </script></head><body></body></html>`;

  const urls = collectJobUrls(LISTING);
  if (urls.length === 2 && urls[0].endsWith('security-analyst-m-w-d-11111')) {
    pass('collectJobUrls() reads every ItemList entry and dedupes');
  } else {
    fail(`collectJobUrls() returned ${JSON.stringify(urls)}`);
  }

  // ── slugToTitle(): the ItemList carries no title, only the URL ───────────
  const t = slugToTitle('https://www.bwi.de/karriere/stellenangebote/job/senior-security-analyst-m-w-d-69624');
  if (t === 'Senior Security Analyst (m/w/d)') {
    pass('slugToTitle() rebuilds a readable title and restores the (m/w/d) marker');
  } else {
    fail(`slugToTitle() returned ${JSON.stringify(t)}`);
  }

  // ── parseJobPosting(): detail pages carry several ld+json blocks ─────────
  const DETAIL = `<html><head>
  <script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[]}</script>
  <script type="application/ld+json">{ not valid json </script>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"JobPosting","title":"Security Analyst - Incident Response &amp; Detection (m/w/d)",
   "datePosted":"2026-08-20","jobLocation":{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"Köln"}}}
  </script></head><body></body></html>`;

  const posting = parseJobPosting(DETAIL);
  if (posting && posting.title.includes('Incident Response') && posting.jobLocation.address.addressLocality === 'Köln') {
    pass('parseJobPosting() finds the JobPosting past a malformed and an unrelated ld+json block');
  } else {
    fail(`parseJobPosting() returned ${JSON.stringify(posting)}`);
  }

  if (parseJobPosting('<html><body>no ld+json here</body></html>') === null) {
    pass('parseJobPosting() returns null when no JobPosting is present');
  } else {
    fail('parseJobPosting() did not return null for a page without JobPosting');
  }

  // ── fetch(): listing + bounded enrichment, with redirect:"error" ─────────
  const requested = [];
  const ctx = {
    transport: 'http',
    fetchJson: async () => ({}),
    fetchText: async (url, opts) => {
      requested.push({ url, redirect: opts?.redirect });
      return url.endsWith('/stellenangebote') ? LISTING : DETAIL;
    },
  };

  const jobs = await bwi.fetch({ name: 'BWI GmbH' }, ctx);

  if (jobs.length === 2 && jobs.every(j => j.company === 'BWI GmbH' && j.url && j.title)) {
    pass('bwi.fetch() returns one normalized Job per listing entry');
  } else {
    fail(`bwi.fetch() returned ${JSON.stringify(jobs)}`);
  }

  if (requested.every(r => r.redirect === 'error')) {
    pass('bwi.fetch() passes redirect:"error" on every request');
  } else {
    fail(`bwi.fetch() request options: ${JSON.stringify(requested)}`);
  }

  // Only the security-adjacent slug is worth a detail request; the cloud
  // consultant keeps its slug-derived title and an empty location.
  const analyst = jobs.find(j => j.url.includes('security-analyst'));
  const consultant = jobs.find(j => j.url.includes('consultant-cloud'));

  if (analyst && analyst.location === 'Köln' && analyst.title.includes('Incident Response')) {
    pass('bwi.fetch() enriches a relevant posting with title and location from its detail page');
  } else {
    fail(`bwi.fetch() enrichment: ${JSON.stringify(analyst)}`);
  }

  if (consultant && consultant.location === '' && consultant.title === 'Consultant Cloud') {
    pass('bwi.fetch() leaves an irrelevant posting unenriched (slug title, empty location)');
  } else {
    fail(`bwi.fetch() non-enriched posting: ${JSON.stringify(consultant)}`);
  }

  if (requested.filter(r => r.url.includes('/job/')).length === 1) {
    pass('bwi.fetch() spends exactly one detail request for one relevant posting');
  } else {
    fail(`bwi.fetch() detail requests: ${JSON.stringify(requested.map(r => r.url))}`);
  }

  // Detail enrichment must never be fatal — a failing detail fetch keeps the job.
  const flaky = {
    transport: 'http',
    fetchJson: async () => ({}),
    fetchText: async url => {
      if (url.endsWith('/stellenangebote')) return LISTING;
      throw new Error('detail page down');
    },
  };
  const resilient = await bwi.fetch({ name: 'BWI GmbH' }, flaky);
  if (resilient.length === 2 && resilient.every(j => j.title)) {
    pass('bwi.fetch() survives a failing detail page and keeps the slug-derived title');
  } else {
    fail(`bwi.fetch() with failing detail page: ${JSON.stringify(resilient)}`);
  }

  // ── SSRF fetch guard: detail URLs come out of remote page content ────────
  // assertBwiUrl() is the last check before a detail fetch. Each of these must
  // throw; the valid URL must come back unchanged.
  const OK_URL = 'https://www.bwi.de/karriere/stellenangebote/job/security-analyst-m-w-d-11111';
  if (assertBwiUrl(OK_URL) === OK_URL) pass('assertBwiUrl() returns an HTTPS www.bwi.de URL unchanged');
  else fail('assertBwiUrl() did not return a valid URL unchanged');

  const HOSTILE = [
    ['a plain-HTTP URL', 'http://www.bwi.de/karriere/stellenangebote/job/security-analyst-11111'],
    ['a foreign host', 'https://attacker.example/karriere/stellenangebote/job/security-analyst-11111'],
    ['a lookalike host', 'https://www.bwi.de.attacker.example/karriere/stellenangebote/job/security-analyst-11111'],
    ['a userinfo spoof', 'https://www.bwi.de@attacker.example/karriere/stellenangebote/job/security-analyst-11111'],
    ['a cloud metadata address', 'https://169.254.169.254/karriere/stellenangebote/job/security-analyst-11111'],
    ['a non-URL string', 'not a url'],
  ];
  for (const [label, url] of HOSTILE) {
    let threw = false;
    try {
      assertBwiUrl(url);
    } catch {
      threw = true;
    }
    if (threw) pass(`assertBwiUrl() rejects ${label}`);
    else fail(`assertBwiUrl() accepted ${label}: ${url}`);
  }

  // A hostile listing: off-host URLs sit inside the JSON-LD next to a real one.
  // None of them may be collected, emitted as a job, or fetched.
  const HOSTILE_LISTING = `<html><head><script type="application/ld+json">
  {"@context":"https://schema.org","@type":"CollectionPage","mainEntity":{"@type":"ItemList","itemListElement":[
    {"@type":"ListItem","position":1,"url":"https://www.bwi.de/karriere/stellenangebote/job/security-analyst-m-w-d-11111"},
    {"@type":"ListItem","position":2,"url":"https://attacker.example/karriere/stellenangebote/job/security-engineer-m-w-d-33333"},
    {"@type":"ListItem","position":3,"url":"https://www.bwi.de.attacker.example/karriere/stellenangebote/job/soc-analyst-m-w-d-44444"},
    {"@type":"ListItem","position":4,"url":"http://www.bwi.de/karriere/stellenangebote/job/cyber-defense-m-w-d-55555"}
  ]}}
  </script></head><body></body></html>`;

  const spoofRequested = [];
  const spoofCtx = {
    transport: 'http',
    fetchJson: async () => ({}),
    fetchText: async url => {
      spoofRequested.push(url);
      return url.endsWith('/stellenangebote') ? HOSTILE_LISTING : DETAIL;
    },
  };
  const spoofJobs = await bwi.fetch({ name: 'BWI GmbH' }, spoofCtx);
  const onHost = u => u.startsWith('https://www.bwi.de/');

  if (spoofJobs.length === 1 && spoofJobs.every(j => onHost(j.url))) {
    pass('bwi.fetch() emits no job for an off-host or plain-HTTP URL in the listing');
  } else {
    fail(`bwi.fetch() emitted off-host jobs: ${JSON.stringify(spoofJobs.map(j => j.url))}`);
  }

  if (spoofRequested.length === 2 && spoofRequested.every(onHost)) {
    pass('bwi.fetch() never requests an off-host detail URL taken from the listing');
  } else {
    fail(`bwi.fetch() requested: ${JSON.stringify(spoofRequested)}`);
  }

  // ── Detail budget boundary: one request per relevant posting, capped at 45 ──
  const manyItems = Array.from({ length: 46 }, (_, i) =>
    `{"@type":"ListItem","position":${i + 1},"url":"https://www.bwi.de/karriere/stellenangebote/job/security-analyst-m-w-d-${10000 + i}"}`
  ).join(',');
  const BIG_LISTING = `<script type="application/ld+json">{"@type":"CollectionPage","mainEntity":{"@type":"ItemList","itemListElement":[${manyItems}]}}</script>`;

  let bigDetails = 0;
  const bigCtx = {
    transport: 'http',
    fetchJson: async () => ({}),
    fetchText: async url => {
      if (url.endsWith('/stellenangebote')) return BIG_LISTING;
      bigDetails++;
      return DETAIL;
    },
  };
  const bigJobs = await bwi.fetch({ name: 'BWI GmbH' }, bigCtx);
  if (bigJobs.length === 46 && bigDetails === 45) {
    pass('bwi.fetch() stops enriching at the 45-request detail budget and still returns every job');
  } else {
    fail(`bwi.fetch() budget: ${bigJobs.length} jobs, ${bigDetails} detail requests`);
  }

  // ── Health probe: ctx.maxPages means "listing only" ─────────────────────
  const probeRequested = [];
  const probeCtx = {
    transport: 'http',
    maxPages: 1,
    fetchJson: async () => ({}),
    fetchText: async url => {
      probeRequested.push(url);
      return url.endsWith('/stellenangebote') ? LISTING : DETAIL;
    },
  };
  const probeJobs = await bwi.fetch({ name: 'BWI GmbH' }, probeCtx);
  if (probeJobs.length === 2 && probeRequested.length === 1) {
    pass('bwi.fetch() skips detail enrichment when the health probe sets ctx.maxPages');
  } else {
    fail(`bwi.fetch() under probe: ${probeJobs.length} jobs, requests ${JSON.stringify(probeRequested)}`);
  }
} catch (err) {
  fail(`bwi provider tests threw: ${err.message}`);
}
