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
  const { collectJobUrls, parseJobPosting, slugToTitle } = mod;

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
} catch (err) {
  fail(`bwi provider tests threw: ${err.message}`);
}
