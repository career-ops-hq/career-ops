// tests/providers/homerun.test.mjs — offline contract coverage for the
// Homerun per-tenant Atom feed provider. The fixture is a trimmed copy of the
// live feed shape with fictional content.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — homerun');

const FEED_URL = 'https://feed.homerun.co/acme';

const FEED = `<?xml version="1.0" encoding="UTF-8" ?>

<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Acme | Vacatures</title>
  <link href="https://feed.homerun.co/acme_atom_0000.xml"></link>
  <id>https://jobs.acme.example/</id>
  <link rel="self" type="application/atom+xml" href="https://jobs.acme.example/" ></link>
  <updated>2026-10-21T07:43:57+00:00</updated>
  <entry>
    <author>
      <name>Acme</name>
    </author>
    <title type="text">R&amp;D Engineer</title>
    <link rel="alternate" type="text/html" href="https://jobs.acme.example/rd-engineer"></link>
    <id>job_AAAAAAAAAAAAAAAAAAAA</id>
    <summary type="html"><![CDATA[We&#039;re looking for a R&amp;D Engineer at Acme.]]></summary>
    <description type="html"><![CDATA[<p>Build things at Acme&#039;s lab.</p><title>Not the title</title><location><name>Not the location</name></location><link rel="alternate" href="https://evil.example/x">]]></description>
    <department>
      <name>Engineering</name>
    </department>
    <location>
      <name>Amsterdam</name>
    </location>
    <type>
      <name>Full-time</name>
    </type>
    <salary_indication>€60000.00 to €70000.00 per year</salary_indication>
    <updated>2026-10-21 07:43:57</updated>
  </entry>
  <entry>
    <author>
      <name>Acme</name>
    </author>
    <title type="text">Support Specialist</title>
    <link rel="alternate" type="text/html" href="https://acme.homerun.co/support-specialist"></link>
    <id>job_BBBBBBBBBBBBBBBBBBBB</id>
    <description type="html"><![CDATA[]]></description>
    <location>
      <name>Remote UTC-5 - UTC+3</name>
    </location>
    <salary_indication>N/A</salary_indication>
    <updated>not a date</updated>
  </entry>
  <entry>
    <title type="text">No link</title>
  </entry>
  <entry>
    <title type="text">Plain http</title>
    <link rel="alternate" type="text/html" href="http://acme.homerun.co/insecure"></link>
  </entry>
  <entry>
    <title type="text"></title>
    <link rel="alternate" type="text/html" href="https://acme.homerun.co/untitled"></link>
  </entry>
</feed>`;

const EMPTY_FEED = `<?xml version="1.0" encoding="UTF-8" ?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Acme</title>
  <id>https://acme.homerun.co/</id>
  <updated></updated>
</feed>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/homerun.mjs')).href);
  const homerun = mod.default;
  const { parseHomerunFeed, parseHomerunSalary } = mod;

  if (homerun.id === 'homerun') pass('homerun.id is "homerun"');
  else fail(`homerun.id=${JSON.stringify(homerun.id)}`);

  // ── detect() ──
  // The careers subdomain is the slug; any path on it, and the feed URL
  // itself, resolve to the one feed on the fixed feed host.
  for (const [field, value] of [
    ['careers_url', 'https://acme.homerun.co'],
    ['careers_url', 'https://acme.homerun.co/'],
    ['careers_url', 'https://ACME.homerun.co/backend-engineer?lang=en#apply'],
    ['careers_url', 'https://acme.homerun.co:8443/'],
    ['careers_url', 'https://feed.homerun.co/acme'],
    ['careers_url', 'https://feed.homerun.co/acme/'],
    ['api', 'https://feed.homerun.co/acme'],
  ]) {
    const hit = homerun.detect({ name: 'Acme', [field]: value });
    if (hit?.url === FEED_URL) pass(`detect claims ${field} ${value}`);
    else fail(`detect(${field}: ${value}) = ${JSON.stringify(hit)}, want ${FEED_URL}`);
  }

  for (const careers_url of [
    'http://acme.homerun.co/',
    'https://www.homerun.co/',
    'https://app.homerun.co/login',
    'https://help.homerun.co/en/',
    'https://homerun.co/',
    'https://feed.homerun.co/',
    'https://feed.homerun.co/acme_atom_0000.xml',
    'https://feed.homerun.co/..%2Fadmin',
    'https://acme.homerun.co.evil.example/',
    'https://acme.evilhomerun.co/',
    'https://a.b.homerun.co/',
    'https://evil.example/acme.homerun.co/',
    'https://jobs.acme.example/',
    'not a url',
    '',
    null,
    42,
    undefined,
  ]) {
    let hit;
    try { hit = homerun.detect({ name: 'Acme', careers_url }); }
    catch (err) { fail(`detect(${JSON.stringify(careers_url)}) threw: ${err.message}`); continue; }
    if (hit === null) pass(`detect rejects ${JSON.stringify(careers_url)}`);
    else fail(`detect(${JSON.stringify(careers_url)}) = ${JSON.stringify(hit)}, want null`);
  }
  if (homerun.detect(null) === null && homerun.detect({}) === null) pass('detect(null) / detect({}) → null');
  else fail('detect should return null for a missing entry or URL');

  // ── parseHomerunFeed ──
  const jobs = parseHomerunFeed(FEED, 'Acme Inc');
  if (jobs.length === 2) pass('parse keeps the 2 well-formed entries, drops no-link / http / untitled ones');
  else fail(`parse returned ${jobs.length} jobs, want 2: ${JSON.stringify(jobs)}`);

  const [rd, support] = jobs;
  if (rd?.title === 'R&D Engineer') pass('title entities are decoded before any keyword match (R&amp;D → R&D)');
  else fail(`title=${JSON.stringify(rd?.title)}`);
  if (rd?.url === 'https://jobs.acme.example/rd-engineer') pass('url is the entry\'s alternate link, branded host kept as-is');
  else fail(`url=${JSON.stringify(rd?.url)}`);
  if (rd?.location === 'Amsterdam') pass('location from <location><name>, not from markup inside the CDATA description');
  else fail(`location=${JSON.stringify(rd?.location)}`);
  if (rd?.company === 'Acme Inc') pass('company is the portals.yml entry name when set');
  else fail(`company=${JSON.stringify(rd?.company)}`);
  if (rd?.postedAt === Date.UTC(2026, 9, 21, 7, 43, 57)) pass('offset-less <updated> is read as UTC');
  else fail(`postedAt=${rd?.postedAt}`);
  if (rd?.description?.startsWith("Build things at Acme's lab.") && !rd.description.includes('<')) {
    pass('description is the CDATA HTML as plain text');
  } else {
    fail(`description=${JSON.stringify(rd?.description)}`);
  }
  if (rd?.salary?.min === 60000 && rd.salary.max === 70000 && rd.salary.currency === 'EUR') pass('"€X to €Y per year" → salary range in EUR');
  else fail(`salary=${JSON.stringify(rd?.salary)}`);

  if (support?.location === 'Remote UTC-5 - UTC+3') pass('a timezone-band location passes through unchanged');
  else fail(`support location=${JSON.stringify(support?.location)}`);
  if (support && !('postedAt' in support) && !('salary' in support) && !('description' in support)) {
    pass('unparseable date, N/A salary and empty description are omitted, not faked');
  } else {
    fail(`support=${JSON.stringify(support)}`);
  }

  // <updated> without Z or an offset (other than the feed's naive form) is local
  // time to Date.parse, so it is omitted rather than read in the host timezone.
  const [offsetless] = parseHomerunFeed(FEED.replace('not a date', '2026-10-21T07:43:57'), 'Acme Inc').slice(1);
  if (offsetless && !('postedAt' in offsetless)) pass('an offset-less ISO <updated> is omitted, not read as local time');
  else fail(`offset-less ISO postedAt=${offsetless?.postedAt}`);
  const [zoned] = parseHomerunFeed(FEED.replace('not a date', '2026-10-21T07:43:57+00:00'), 'Acme Inc').slice(1);
  if (zoned?.postedAt === Date.UTC(2026, 9, 21, 7, 43, 57)) pass('an ISO <updated> with an offset is read');
  else fail(`zoned ISO postedAt=${zoned?.postedAt}`);

  const authorCompany = parseHomerunFeed(FEED);
  if (authorCompany[0]?.company === 'Acme') pass('company falls back to the entry <author><name>');
  else fail(`fallback company=${JSON.stringify(authorCompany[0]?.company)}`);

  // ── salary text ──
  for (const [text, want] of [
    ['€75000.00 per year', { min: 75000, max: 75000, currency: 'EUR' }],
    ['€3000.00 to €4000.00 per month', undefined],
    ['$50.00 per hour', undefined],
    ['N/A', undefined],
    ['', undefined],
  ]) {
    const got = parseHomerunSalary(text);
    if (JSON.stringify(got) === JSON.stringify(want)) pass(`salary ${JSON.stringify(text)} → ${JSON.stringify(want)}`);
    else fail(`salary ${JSON.stringify(text)} = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }

  // Raw </entry> inside CDATA must not end the entry early and lose its fields.
  const [inner] = parseHomerunFeed(FEED.replace('<p>Build', '</entry><p>Build'), 'Acme Inc');
  if (inner?.title === 'R&D Engineer' && inner.location === 'Amsterdam' && inner.salary?.max === 70000 && inner.postedAt !== undefined) {
    pass('a raw </entry> inside CDATA does not cut the entry short');
  } else {
    fail(`CDATA </entry> entry=${JSON.stringify(inner)}`);
  }

  // ── empty vs broken ──
  const empty = parseHomerunFeed(EMPTY_FEED, 'Acme');
  if (Array.isArray(empty) && empty.length === 0) pass('a <feed> with no <entry> is an empty board → []');
  else fail(`empty feed returned ${JSON.stringify(empty)}`);

  for (const [label, body] of [
    ['an HTML page', '<!doctype html><html><body>Not found</body></html>'],
    ['an empty body', ''],
    ['a JSON error', '{"error":true,"message":"Company not found","code":404}'],
    ['a non-string', null],
    ['entries that all fail to parse', '<feed><entry><title>X</title></entry><entry><link href="https://a.example/"/></entry></feed>'],
    ['a feed truncated before </feed>', EMPTY_FEED.replace('</feed>', '')],
    ['a feed truncated mid-entry', FEED.slice(0, FEED.indexOf('<title type="text">Support Specialist'))],
    ['an unclosed <entry> in an otherwise closed feed', '<feed><entry><title>X</title></feed>'],
    ['an unclosed <entry> before a complete one', FEED.replace('<entry>', '<entry><title>Orphan</title>\n  <entry>')],
    ['a </feed> only inside CDATA', FEED.replace(/<\/feed>$/, '').replace('<p>Build', '</feed><p>Build')],
  ]) {
    let threw = null;
    try { parseHomerunFeed(body, 'Acme'); } catch (err) { threw = err; }
    if (threw && /^homerun: /.test(threw.message)) pass(`${label} throws a descriptive error`);
    else fail(`${label} should throw, got ${threw ? threw.message : 'no throw'}`);
  }

  // ── fetch() ──
  /** @type {Array<{url: string, opts: any}>} */
  const calls = [];
  const fetched = await homerun.fetch(
    { name: 'Acme', careers_url: 'https://acme.homerun.co/some-job' },
    {
      transport: 'http',
      fetchText: async (url, opts) => { calls.push({ url, opts }); return FEED; },
      fetchJson: async () => { throw new Error('fetchJson should not be called'); },
    },
  );
  if (fetched.length === 2 && calls.length === 1 && calls[0].url === FEED_URL) pass('fetch issues exactly one request, to the fixed feed host');
  else fail(`fetch: ${fetched.length} jobs, calls=${JSON.stringify(calls)}`);
  // The one request inspects a 3xx (redirect:'manual') to name an unknown
  // tenant; it never follows one.
  if (calls.every((c) => c.opts?.redirect === 'manual')) pass('fetch passes redirect:\'manual\' (never follow) on its request');
  else fail(`redirect opts=${JSON.stringify(calls.map((c) => c.opts))}`);

  // Unknown slug: feed.homerun.co answers 302 → 404.homerun.co.
  let notFound = null;
  try {
    await homerun.fetch({ name: 'Acme', careers_url: 'https://acme.homerun.co/' }, {
      fetchText: async () => {
        const err = /** @type {any} */ (new Error('HTTP 302'));
        err.status = 302;
        err.location = 'https://404.homerun.co/feeds/acme';
        throw err;
      },
    });
  } catch (err) { notFound = err; }
  if (notFound?.status === 404 && /no such tenant/.test(notFound.message)) pass('a redirect to 404.homerun.co becomes a named 404 "no such tenant"');
  else fail(`unknown tenant: ${notFound?.status} ${notFound?.message}`);

  let otherRedirect = null;
  try {
    await homerun.fetch({ name: 'Acme', careers_url: 'https://acme.homerun.co/' }, {
      fetchText: async () => {
        const err = /** @type {any} */ (new Error('HTTP 301'));
        err.status = 301;
        err.location = 'https://evil.example/';
        throw err;
      },
    });
  } catch (err) { otherRedirect = err; }
  if (otherRedirect && otherRedirect.status !== 404 && /redirected \(301 -> https:\/\/evil\.example\/\)/.test(otherRedirect.message)) {
    pass('any other redirect is reported, not followed, and not called a missing tenant');
  } else {
    fail(`other redirect: ${otherRedirect?.status} ${otherRedirect?.message}`);
  }

  // A branded host under an explicit provider: names the fix, before any request.
  let brandedCalls = 0;
  let brandedErr = null;
  try {
    await homerun.fetch({ name: 'Acme', provider: 'homerun', careers_url: 'https://jobs.acme.example/' }, {
      fetchText: async () => { brandedCalls++; return FEED; },
    });
  } catch (err) { brandedErr = err; }
  if (brandedErr && /api: to the https:\/\/feed\.homerun\.co\/<slug> feed/.test(brandedErr.message) && brandedCalls === 0) {
    pass('a branded careers host throws a named error before any request');
  } else {
    fail(`branded host: calls=${brandedCalls} err=${brandedErr?.message}`);
  }

  // Probe: a ctx.fetch* rejection propagates unwrapped.
  class ProbePageBudgetReached extends Error {}
  let probeErr = null;
  try {
    await homerun.fetch({ name: 'Acme', careers_url: FEED_URL }, {
      maxPages: 1,
      fetchText: async () => { throw new ProbePageBudgetReached('budget'); },
    });
  } catch (err) { probeErr = err; }
  if (probeErr instanceof ProbePageBudgetReached) pass('a ctx.fetch* rejection during a probe propagates unwrapped');
  else fail(`probe rejection was rewrapped: ${probeErr}`);
} catch (err) {
  fail(`homerun provider tests crashed: ${err.stack || err.message}`);
}
