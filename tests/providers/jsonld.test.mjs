// tests/providers/jsonld.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — jsonld');

try {
  const jsonldModule = await import(pathToFileURL(join(ROOT, 'providers/jsonld.mjs')).href);
  const jsonld = jsonldModule.default;
  const { parseJsonLdJobs, normalizeJsonLdJobs } = jsonldModule;

  if (jsonld.id === 'jsonld') pass('jsonld.id is "jsonld"');
  else fail(`jsonld.id is ${JSON.stringify(jsonld.id)}`);

  // --- detect(): explicit opt-in only, never auto-detected ---------------

  if (jsonld.detect({ provider: 'jsonld', careers_url: 'https://example.com/careers' })) {
    pass('detect() matches with explicit provider: jsonld + a valid https host');
  } else {
    fail('detect() should match with explicit provider: jsonld');
  }

  if (jsonld.detect({ careers_url: 'https://example.com/careers' }) === null) {
    pass('detect() returns null with NO explicit provider field — never auto-detects');
  } else {
    fail('detect() should never auto-detect without provider: jsonld');
  }

  if (jsonld.detect({ provider: 'greenhouse', careers_url: 'https://example.com/careers' }) === null) {
    pass('detect() returns null when another provider is explicitly set');
  } else {
    fail('detect() should defer to an explicitly-set different provider');
  }

  if (jsonld.detect({ provider: 'jsonld', careers_url: 'http://example.com/careers' }) === null) {
    pass('detect() rejects a plain-http careers_url');
  } else {
    fail('detect() should reject non-https');
  }

  if (jsonld.detect({ provider: 'jsonld', careers_url: 'https://127.0.0.1/careers' }) === null) {
    pass('detect() rejects an IPv4-literal host');
  } else {
    fail('detect() should reject an IP-literal host');
  }

  if (jsonld.detect({ provider: 'jsonld', careers_url: 'https://localhost/careers' }) === null) {
    pass('detect() rejects localhost');
  } else {
    fail('detect() should reject localhost');
  }

  if (jsonld.detect({ provider: 'jsonld', careers_url: 'https://intranet.internal/careers' }) === null) {
    pass('detect() rejects a .internal host');
  } else {
    fail('detect() should reject a .internal host');
  }

  if (jsonld.detect({ provider: 'jsonld', careers_url: 'not a url' }) === null) {
    pass('detect() rejects an unparseable careers_url');
  } else {
    fail('detect() should reject an unparseable URL');
  }

  // --- parseJsonLdJobs() — bare object -------------------------------------

  const bareHtml = `<html><head>
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"JobPosting","title":"Backend Engineer",
       "url":"https://example.com/jobs/42","datePosted":"2026-01-15",
       "description":"<p>Ships <strong>APIs</strong>.</p>",
       "hiringOrganization":{"@type":"Organization","name":"Acme Corp"},
       "jobLocation":{"@type":"Place","address":{"addressLocality":"Berlin","addressCountry":"DE"}}}
    </script>
  </head><body></body></html>`;
  const bareJobs = parseJsonLdJobs(bareHtml, 'https://example.com/jobs/42', { name: 'Acme' });
  if (bareJobs.length === 1) pass('parseJsonLdJobs extracts a bare JobPosting object');
  else fail(`bareJobs.length = ${bareJobs.length}`);
  if (bareJobs[0]?.title === 'Backend Engineer') pass('parseJsonLdJobs maps title');
  else fail(`bareJobs[0].title = ${JSON.stringify(bareJobs[0]?.title)}`);
  if (bareJobs[0]?.url === 'https://example.com/jobs/42') pass('parseJsonLdJobs maps url');
  else fail(`bareJobs[0].url = ${JSON.stringify(bareJobs[0]?.url)}`);
  if (bareJobs[0]?.company === 'Acme Corp') pass('parseJsonLdJobs maps hiringOrganization.name to company');
  else fail(`bareJobs[0].company = ${JSON.stringify(bareJobs[0]?.company)}`);
  if (bareJobs[0]?.location === 'Berlin, DE') pass('parseJsonLdJobs maps jobLocation to "Locality, Country"');
  else fail(`bareJobs[0].location = ${JSON.stringify(bareJobs[0]?.location)}`);
  if (bareJobs[0]?.description === 'Ships APIs .') pass('parseJsonLdJobs strips HTML from description');
  else fail(`bareJobs[0].description = ${JSON.stringify(bareJobs[0]?.description)}`);
  if (typeof bareJobs[0]?.postedAt === 'number') pass('parseJsonLdJobs parses datePosted to an epoch ms number');
  else fail(`bareJobs[0].postedAt = ${JSON.stringify(bareJobs[0]?.postedAt)}`);

  // --- parseJsonLdJobs() — array of JobPostings, each with its own url ----

  const arrayHtml = `<script type="application/ld+json">
    [
      {"@type":"JobPosting","title":"Role A","url":"https://example.com/jobs/a"},
      {"@type":"JobPosting","title":"Role B","url":"https://example.com/jobs/b"},
      {"@type":"Organization","name":"Not a job"}
    ]
  </script>`;
  const arrayJobs = parseJsonLdJobs(arrayHtml, 'https://example.com/careers', {});
  if (arrayJobs.length === 2) pass('parseJsonLdJobs extracts a list of JobPostings and ignores non-JobPosting nodes');
  else fail(`arrayJobs.length = ${arrayJobs.length}, titles = ${JSON.stringify(arrayJobs.map(j => j.title))}`);

  // --- parseJsonLdJobs() — @graph document ---------------------------------

  const graphHtml = `<script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"WebPage","name":"Careers"},
      {"@type":"JobPosting","title":"Graph Role","url":"https://example.com/jobs/g"}
    ]}
  </script>`;
  const graphJobs = parseJsonLdJobs(graphHtml, 'https://example.com/careers', {});
  if (graphJobs.length === 1 && graphJobs[0].title === 'Graph Role') pass('parseJsonLdJobs extracts a JobPosting nested inside @graph');
  else fail(`graphJobs = ${JSON.stringify(graphJobs)}`);

  // --- parseJsonLdJobs() — array with @type as a list ----------------------

  const typeArrayHtml = `<script type="application/ld+json">
    {"@type":["JobPosting","Thing"],"title":"Multi-typed Role","url":"https://example.com/jobs/mt"}
  </script>`;
  const typeArrayJobs = parseJsonLdJobs(typeArrayHtml, 'https://example.com/careers', {});
  if (typeArrayJobs.length === 1) pass('parseJsonLdJobs matches @type as an array containing "JobPosting"');
  else fail(`typeArrayJobs.length = ${typeArrayJobs.length}`);

  // --- normalizeJsonLdJobs() — url fallback rules --------------------------

  const singleNoUrl = normalizeJsonLdJobs(
    [{ '@type': 'JobPosting', title: 'Solo Posting' }],
    'https://example.com/jobs/solo',
    {},
  );
  if (singleNoUrl.length === 1 && singleNoUrl[0].url === 'https://example.com/jobs/solo') {
    pass('normalizeJsonLdJobs falls back to the page URL when the lone JobPosting has no url');
  } else {
    fail(`singleNoUrl = ${JSON.stringify(singleNoUrl)}`);
  }

  const multiNoUrl = normalizeJsonLdJobs(
    [
      { '@type': 'JobPosting', title: 'Has URL', url: 'https://example.com/jobs/1' },
      { '@type': 'JobPosting', title: 'No URL At All' },
    ],
    'https://example.com/careers',
    {},
  );
  if (multiNoUrl.length === 1 && multiNoUrl[0].title === 'Has URL') {
    pass('normalizeJsonLdJobs drops a URL-less posting when the page lists more than one (no reliable dedup key)');
  } else {
    fail(`multiNoUrl = ${JSON.stringify(multiNoUrl)}`);
  }

  // --- normalizeJsonLdJobs() — location shapes ------------------------------

  const arrayLocation = normalizeJsonLdJobs(
    [{ '@type': 'JobPosting', title: 'Multi-city', url: 'https://example.com/jobs/mc',
       jobLocation: [{ address: { addressLocality: 'Paris' } }, { address: { addressLocality: 'Lyon' } }] }],
    'https://example.com/careers',
    {},
  );
  if (arrayLocation[0]?.location === 'Paris, Lyon') pass('normalizeJsonLdJobs joins multiple Place entries with ", "');
  else fail(`arrayLocation[0].location = ${JSON.stringify(arrayLocation[0]?.location)}`);

  const remoteLocation = normalizeJsonLdJobs(
    [{ '@type': 'JobPosting', title: 'Remote Role', url: 'https://example.com/jobs/r', jobLocationType: 'TELECOMMUTE' }],
    'https://example.com/careers',
    {},
  );
  if (remoteLocation[0]?.location === 'Remote') pass('normalizeJsonLdJobs maps jobLocationType: TELECOMMUTE to "Remote" when jobLocation is absent');
  else fail(`remoteLocation[0].location = ${JSON.stringify(remoteLocation[0]?.location)}`);

  // --- normalizeJsonLdJobs() — title/company fallbacks ----------------------

  const titlelessDropped = normalizeJsonLdJobs(
    [{ '@type': 'JobPosting', url: 'https://example.com/jobs/notitle' }],
    'https://example.com/careers',
    {},
  );
  if (titlelessDropped.length === 0) pass('normalizeJsonLdJobs drops a JobPosting with no title/name');
  else fail(`titlelessDropped = ${JSON.stringify(titlelessDropped)}`);

  const entryFallbackCompany = normalizeJsonLdJobs(
    [{ '@type': 'JobPosting', title: 'No Org Field', url: 'https://example.com/jobs/no-org' }],
    'https://example.com/careers',
    { name: 'Fallback Co' },
  );
  if (entryFallbackCompany[0]?.company === 'Fallback Co') pass('normalizeJsonLdJobs falls back to entry.name when hiringOrganization is absent');
  else fail(`entryFallbackCompany[0].company = ${JSON.stringify(entryFallbackCompany[0]?.company)}`);

  // --- parseJsonLdJobs() — throws when nothing matches ----------------------

  let noScriptThrew = false;
  try { parseJsonLdJobs('<html><body>no structured data here</body></html>', 'https://example.com/careers', {}); }
  catch { noScriptThrew = true; }
  if (noScriptThrew) pass('parseJsonLdJobs throws when the page has no application/ld+json at all');
  else fail('parseJsonLdJobs should throw when no ld+json script is present');

  let wrongTypeThrew = false;
  try {
    parseJsonLdJobs(
      '<script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>',
      'https://example.com/careers',
      {},
    );
  } catch { wrongTypeThrew = true; }
  if (wrongTypeThrew) pass('parseJsonLdJobs throws when ld+json is present but none of it is a JobPosting');
  else fail('parseJsonLdJobs should throw when no JobPosting node is found');

  let malformedJsonSkipped = false;
  try {
    const jobs = parseJsonLdJobs(
      `<script type="application/ld+json">{not valid json</script>
       <script type="application/ld+json">{"@type":"JobPosting","title":"Still Works","url":"https://example.com/jobs/ok"}</script>`,
      'https://example.com/careers',
      {},
    );
    malformedJsonSkipped = jobs.length === 1 && jobs[0].title === 'Still Works';
  } catch { /* leave false */ }
  if (malformedJsonSkipped) pass('parseJsonLdJobs skips an unparseable ld+json block and keeps parsing the rest of the page');
  else fail('parseJsonLdJobs should skip malformed JSON in one block without failing the whole page');

  // --- fetch() — GET with redirect:'error', returns parsed jobs -----------

  let calledUrl = null, calledOpts = null;
  const mockCtx = {
    fetchText: async (url, opts) => {
      calledUrl = url;
      calledOpts = opts;
      return '<script type="application/ld+json">{"@type":"JobPosting","title":"Mocked Role","url":"https://example.com/jobs/mocked"}</script>';
    },
  };
  const fetched = await jsonld.fetch({ name: 'Acme', provider: 'jsonld', careers_url: 'https://example.com/careers' }, mockCtx);
  if (calledUrl === 'https://example.com/careers') pass('fetch() GETs the configured careers_url');
  else fail(`fetch() called url = ${JSON.stringify(calledUrl)}`);
  if (calledOpts?.redirect === 'error') pass('fetch() passes redirect:"error" (SSRF guard)');
  else fail(`fetch() opts = ${JSON.stringify(calledOpts)}`);
  if (fetched.length === 1 && fetched[0].title === 'Mocked Role') pass('fetch() returns jobs parsed from the mock response');
  else fail(`fetch() returned ${JSON.stringify(fetched)}`);

  let fetchRejected = false;
  try {
    await jsonld.fetch({ name: 'Bad', careers_url: 'http://example.com/careers' }, mockCtx);
  } catch { fetchRejected = true; }
  if (fetchRejected) pass('fetch() throws for a non-https careers_url instead of silently fetching it');
  else fail('fetch() should reject a non-https careers_url');

} catch (e) {
  fail(`jsonld provider tests crashed: ${e.message}`);
}
