// tests/providers/germantechjobs.test.mjs — provider-contract tests for the
// GermanTechJobs board-wide RSS provider (providers/germantechjobs.mjs).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — germantechjobs');

// Two postings in the board's real shape: "{Role} @ {Company} [{salary}]",
// a CDATA description, and the utm_* tail the feed appends to every <link>.
const SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>GermanTechJobs - tech &amp; IT jobs with salary info in Germany</title>
    <link>https://germantechjobs.de/</link>
    <item>
      <title>Data Architect (all Genders) @ BORA Gruppe Deutschland [48.000 - 70.000 €]</title>
      <link>https://germantechjobs.de/jobs/Data-Architect-BORA?utm_source=our_rss_feed&amp;utm_medium=our_rss_feed</link>
      <guid>https://germantechjobs.de/jobs/Data-Architect-BORA?utm_source=our_rss_feed&amp;utm_medium=our_rss_feed</guid>
      <pubDate>Thu, 29 Oct 2026 09:30:00 GMT</pubDate>
      <description><![CDATA[<p><b>Salary: 48.000 - 70.000 € per year</b></p><p>Build pipelines.</p>]]></description>
    </item>
    <item>
      <title>Platform Engineer @ SEW-EURODRIVE GmbH &amp; Co KG</title>
      <link>https://germantechjobs.de/jobs/Platform-Engineer-SEW?utm_source=our_rss_feed</link>
      <guid>https://germantechjobs.de/jobs/Platform-Engineer-SEW?utm_source=our_rss_feed</guid>
      <pubDate>Wed, 28 Oct 2026 11:00:00 GMT</pubDate>
      <description><![CDATA[<p>Own the platform.</p>]]></description>
    </item>
  </channel>
</rss>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/germantechjobs.mjs')).href);
  const germantechjobs = mod.default;
  const { parseGermantechjobsFeed } = mod;

  if (germantechjobs.id === 'germantechjobs') pass('germantechjobs.id is "germantechjobs"');
  else fail(`germantechjobs.id is ${JSON.stringify(germantechjobs.id)}`);

  // detect() — explicit provider selection only (board-wide feed, no per-entry
  // URL). It must never claim an entry the user did not point at it.
  const hit = germantechjobs.detect({ name: 'GermanTechJobs', provider: 'germantechjobs' });
  if (hit && hit.url === 'https://germantechjobs.de/rss') {
    pass('detect() resolves provider:germantechjobs → the board-wide feed');
  } else {
    fail(`detect() returned ${JSON.stringify(hit)}`);
  }

  for (const [label, entry] of [
    ['no provider field', { name: 'Something' }],
    ['a different provider', { provider: 'startup-jobs' }],
    ['null', null],
    ['a non-object', 'germantechjobs'],
  ]) {
    const res = germantechjobs.detect(entry);
    if (res === null) pass(`detect() returns null for ${label}`);
    else fail(`detect() returned ${JSON.stringify(res)} for ${label}`);
  }

  // ── parse ────────────────────────────────────────────────────────────
  const jobs = parseGermantechjobsFeed(SAMPLE);
  if (jobs.length === 2) pass('parse: two items → two jobs');
  else fail(`parse returned ${jobs.length} jobs, expected 2`);

  const [first, second] = jobs;

  if (first.title === 'Data Architect (all Genders)' && first.company === 'BORA Gruppe Deutschland') {
    pass('parse: employer comes from the last " @ ", salary bracket stripped from the role');
  } else {
    fail(`parse: title/company split produced ${first.title} / ${first.company}`);
  }

  // Source Indexing Policy rule 2 — the feed's own utm_* attribution is not
  // part of the shortest verifiable path to the posting.
  if (first.url === 'https://germantechjobs.de/jobs/Data-Architect-BORA') {
    pass('parse: utm_* tracking is stripped from the canonical posting URL');
  } else {
    fail(`parse: url is ${first.url}`);
  }

  if (jobs.every((j) => !j.url.includes('utm_'))) pass('parse: no row keeps a utm_* parameter');
  else fail('parse: a row kept a utm_* parameter');

  // HTML entities in the title are decoded before the " @ " split.
  if (second.company === 'SEW-EURODRIVE GmbH & Co KG') {
    pass('parse: entities in the title are decoded');
  } else {
    fail(`parse: second company is ${JSON.stringify(second.company)}`);
  }

  // A title with no " @ " keeps the whole string and falls back to the entry
  // name — never an invented employer.
  const noAt = parseGermantechjobsFeed(
    '<rss><channel><item><title>Werkstudent IT</title><link>https://germantechjobs.de/jobs/x</link></item></channel></rss>',
    'Acme Board',
  );
  if (noAt.length === 1 && noAt[0].title === 'Werkstudent IT' && noAt[0].company === 'Acme Board') {
    pass('parse: a title with no employer keeps the entry-name fallback');
  } else {
    fail(`parse: unsplittable title produced ${JSON.stringify(noAt[0])}`);
  }

  if (first.postedAt === Date.parse('Thu, 29 Oct 2026 09:30:00 GMT')) {
    pass('parse: pubDate becomes an epoch-ms postedAt');
  } else {
    fail(`parse: postedAt is ${first.postedAt}`);
  }

  if (typeof first.description === 'string' && first.description.includes('Build pipelines')) {
    pass('parse: the CDATA description is flattened to plain text');
  } else {
    fail(`parse: description is ${JSON.stringify(first.description).slice(0, 80)}`);
  }

  // 20 of 626 live items mention a location; the rest carry none. The row is
  // still emitted, with location '' — the documented "unknown" value.
  if (jobs.every((j) => j.location === '')) pass("parse: location is '' when the feed carries none");
  else fail('parse: a row invented a location');

  // ── defensive parsing (ADDING_A_PROVIDER.md) ─────────────────────────
  // A malformed envelope is a descriptive throw, never a quiet []. An empty
  // channel is the genuine empty-board case and stays [].
  for (const [label, body] of [
    ['a non-string body', null],
    ['an HTML error page', '<html><body>502 Bad Gateway</body></html>'],
    ['an empty body', ''],
  ]) {
    let threw = false;
    try {
      parseGermantechjobsFeed(body);
    } catch (e) {
      threw = /unexpected feed response/.test(e.message);
    }
    if (threw) pass(`parse: ${label} throws a descriptive envelope error`);
    else fail(`parse: ${label} did not throw an envelope error`);
  }

  const empty = parseGermantechjobsFeed('<rss><channel><title>x</title></channel></rss>');
  if (Array.isArray(empty) && empty.length === 0) pass('parse: an empty channel is an empty board, not an error');
  else fail('parse: an empty channel did not return []');

  // A feed truncated mid-item reads as broken, not as "zero jobs".
  let truncatedThrew = false;
  try {
    parseGermantechjobsFeed(
      '<rss><channel><item><title>A @ B</title><link>https://germantechjobs.de/jobs/a</link></item><item><title>C @ D</title></channel></rss>',
    );
  } catch (e) {
    truncatedThrew = /truncated|open tag/.test(e.message);
  }
  if (truncatedThrew) pass('parse: a feed truncated mid-item throws instead of returning a short board');
  else fail('parse: a truncated feed was silently read as an empty/short board');

  // A row missing its URL is skipped; the rest of the board stands.
  const mixed = parseGermantechjobsFeed(
    '<rss><channel><item><title>No Link @ Co</title></item><item><title>Has Link @ Co</title><link>https://germantechjobs.de/jobs/ok</link></item></channel></rss>',
  );
  if (mixed.length === 1 && mixed[0].url.endsWith('/jobs/ok')) pass('parse: a row with no usable URL is dropped, the rest survive');
  else fail(`parse: mixed board produced ${mixed.length} rows`);

  // An off-board or non-https link is not a usable canonical URL.
  const offBoard = parseGermantechjobsFeed(
    '<rss><channel><item><title>X @ Y</title><link>https://evil.example/jobs/x</link></item></channel></rss>',
  );
  if (offBoard.length === 0) pass('parse: a link off the board is rejected');
  else fail(`parse: an off-board link survived: ${offBoard[0]?.url}`);

  // ── fetch ────────────────────────────────────────────────────────────
  let calls = 0;
  const fetched = await germantechjobs.fetch(
    { name: 'GermanTechJobs', provider: 'germantechjobs' },
    {
      fetchText: async (url, options) => {
        calls += 1;
        if (url !== 'https://germantechjobs.de/rss') throw new Error(`fetchText hit an unexpected URL: ${url}`);
        if (options?.redirect !== 'error') throw new Error(`fetchText called without redirect:'error': ${JSON.stringify(options)}`);
        return SAMPLE;
      },
      fetchJson: async () => { throw new Error('fetchJson should not be called'); },
    },
  );
  if (calls === 1 && fetched.length === 2) pass("fetch() reads the feed with redirect:'error' and returns the parsed jobs");
  else fail(`fetch() made ${calls} call(s) and returned ${fetched.length} jobs`);

  // A feed_url override is allowlisted BEFORE the request goes out: a stub
  // that only throws would pass whether the guard fired or a fetch was
  // wrongly attempted, so assert the fetch was never entered.
  for (const [label, badUrl] of [
    ['an untrusted host', 'https://evil.example/rss'],
    ['a non-HTTPS URL', 'http://germantechjobs.de/rss'],
  ]) {
    let fetchEntered = false;
    let threw = false;
    try {
      await germantechjobs.fetch(
        { name: 'GermanTechJobs', provider: 'germantechjobs', feed_url: badUrl },
        {
          fetchText: async () => { fetchEntered = true; return SAMPLE; },
          fetchJson: async () => { throw new Error('fetchJson should not be called'); },
        },
      );
    } catch (e) {
      threw = /untrusted hostname|must use HTTPS/.test(e.message);
    }
    if (threw && !fetchEntered) pass(`fetch(): ${label} in feed_url is rejected before any request`);
    else fail(`fetch(): ${label} in feed_url — threw=${threw}, fetch entered=${fetchEntered}`);
  }
} catch (e) {
  fail(`germantechjobs provider tests crashed: ${e.message}`);
}
