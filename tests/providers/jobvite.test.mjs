// tests/providers/jobvite.test.mjs — unit tests for the Jobvite provider.
//
// Rewritten 2026-08-08 alongside the provider. The previous suite exercised
// resolveCompanyId() and parseJobviteResponse(), which drove the retired JSON
// endpoint (jobs.jobvite.com/api/company/{slug}/jobs). That endpoint now 302s
// to search.jobvite.com?invalid=1 for every tenant, so those tests passed while
// the provider returned nothing in production — the failure mode this file now
// guards against.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — Jobvite');

try {
  const {
    default: jobvite,
    resolveSlug,
    resolveConfiguredEid,
    extractEidFromBoard,
    parseJobviteXml,
  } = await import(pathToFileURL(join(ROOT, 'providers/jobvite.mjs')).href);

  const eq = (label, actual, expected) => {
    if (actual === expected) pass(label);
    else fail(`${label} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  };

  eq('jobvite.id is "jobvite"', jobvite.id, 'jobvite');

  // ── resolveSlug ────────────────────────────────────────────────
  eq('resolveSlug reads a bare careers_url',
    resolveSlug({ careers_url: 'https://jobs.jobvite.com/tylertech' }), 'tylertech');
  eq('resolveSlug reads a careers_url with a trailing path',
    resolveSlug({ careers_url: 'https://jobs.jobvite.com/tylertech/search' }), 'tylertech');
  eq('resolveSlug rejects a foreign host',
    resolveSlug({ careers_url: 'https://evil.example.com/tylertech' }), null);
  eq('resolveSlug rejects http',
    resolveSlug({ careers_url: 'http://jobs.jobvite.com/tylertech' }), null);
  eq('resolveSlug rejects the api path prefix',
    resolveSlug({ careers_url: 'https://jobs.jobvite.com/api/company/x/jobs' }), null);
  eq('resolveSlug returns null with no careers_url', resolveSlug({}), null);

  // ── resolveConfiguredEid ───────────────────────────────────────
  eq('resolveConfiguredEid prefers an explicit company_eid',
    resolveConfiguredEid({ company_eid: 'q6NaVfwI' }), 'q6NaVfwI');
  eq('resolveConfiguredEid trims whitespace',
    resolveConfiguredEid({ company_eid: '  q6NaVfwI  ' }), 'q6NaVfwI');
  eq('resolveConfiguredEid reads ?c= from an api: URL',
    resolveConfiguredEid({ api: 'https://app.jobvite.com/CompanyJobs/Xml.aspx?c=q6NaVfwI' }), 'q6NaVfwI');
  eq('resolveConfiguredEid rejects an api: URL on a foreign host',
    resolveConfiguredEid({ api: 'https://evil.example.com/Xml.aspx?c=q6NaVfwI' }), null);
  eq('resolveConfiguredEid returns null when only a slug is known',
    resolveConfiguredEid({ careers_url: 'https://jobs.jobvite.com/tylertech' }), null);

  // ── extractEidFromBoard ────────────────────────────────────────
  eq('extractEidFromBoard finds a single-quoted eId',
    extractEidFromBoard(`var x=1; companyEId: 'q6NaVfwI', foo:2`), 'q6NaVfwI');
  eq('extractEidFromBoard tolerates double quotes and "="',
    extractEidFromBoard(`companyEId = "AbC123_-"`), 'AbC123_-');
  eq('extractEidFromBoard returns null when absent',
    extractEidFromBoard('<html>no id here</html>'), null);
  eq('extractEidFromBoard returns null for non-string input',
    extractEidFromBoard(null), null);

  // ── detect ─────────────────────────────────────────────────────
  {
    const d = jobvite.detect({ company_eid: 'q6NaVfwI', name: 'Tyler' });
    eq('detect() uses the feed URL when the eId is configured',
      d && d.url, 'https://app.jobvite.com/CompanyJobs/Xml.aspx?c=q6NaVfwI');
  }
  {
    const d = jobvite.detect({ careers_url: 'https://jobs.jobvite.com/tylertech', name: 'Tyler' });
    eq('detect() falls back to the board URL when only a slug is known',
      d && d.url, 'https://jobs.jobvite.com/tylertech');
  }
  eq('detect() returns null for a non-Jobvite entry',
    jobvite.detect({ careers_url: 'https://boards.greenhouse.io/acme' }), null);

  // ── parseJobviteXml ────────────────────────────────────────────
  const XML = `<?xml version="1.0" encoding="UTF-8"?>
<result>
<job>
  <id>ogO4zfwr</id>
  <title>Project Manager - Property &amp; Recording</title>
  <category>Professional Services</category>
  <location>Lakewood, CO, United States</location>
  <date>7/21/2026</date>
  <detail-url><![CDATA[http://app.jobvite.com/CompanyJobs/Job.aspx?c=q6NaVfwI&j=ogO4zfwr]]></detail-url>
  <apply-url><![CDATA[http://app.jobvite.com/CompanyJobs/Careers.aspx?c=q6NaVfwI&j=ogO4zfwr&k=Apply]]></apply-url>
</job>
<job>
  <id>noTitle</id>
  <title></title>
  <location>Nowhere</location>
  <detail-url><![CDATA[http://app.jobvite.com/x]]></detail-url>
</job>
<job>
  <id>noUrl</id>
  <title>Has A Title But No URL</title>
  <location>Nowhere</location>
</job>
<job>
  <id>applyOnly</id>
  <title>Apply URL Fallback</title>
  <location>Remote</location>
  <apply-url><![CDATA[https://careers.example.com/jobs/9]]></apply-url>
</job>
<job>
  <id>badUrl</id>
  <title>Malformed Detail, Good Apply</title>
  <detail-url><![CDATA[not a url]]></detail-url>
  <apply-url><![CDATA[https://careers.example.com/jobs/42]]></apply-url>
</job>
</result>`;

  const jobs = parseJobviteXml(XML, 'Tyler Technologies');
  // Five <job> nodes in, two dropped: an empty title and no URL at all. The
  // malformed detail-url is NOT a drop — its apply-url is good, so it survives.
  eq('parseJobviteXml keeps only postings with a title AND a usable URL', jobs.length, 3);

  const first = jobs[0];
  eq('parseJobviteXml decodes XML entities in the title',
    first.title, 'Project Manager - Property & Recording');
  eq('parseJobviteXml upgrades http feed URLs to https',
    first.url.startsWith('https://app.jobvite.com/CompanyJobs/Job.aspx'), true);
  eq('parseJobviteXml prefers detail-url over apply-url',
    first.url.includes('Job.aspx'), true);
  eq('parseJobviteXml stamps the company from the entry name',
    first.company, 'Tyler Technologies');
  eq('parseJobviteXml carries the location through',
    first.location, 'Lakewood, CO, United States');
  eq('parseJobviteXml parses the M/D/YYYY date to epoch ms',
    typeof first.postedAt === 'number' && new Date(first.postedAt).getUTCFullYear() === 2026, true);

  eq('parseJobviteXml falls back to apply-url when detail-url is absent',
    jobs[1].url, 'https://careers.example.com/jobs/9');
  eq('parseJobviteXml omits postedAt when the date is absent',
    Object.prototype.hasOwnProperty.call(jobs[1], 'postedAt'), false);


  // #2623 review: a present-but-malformed detail-url must not discard a posting
  // that has a valid apply-url beside it.
  eq('parseJobviteXml falls back to apply-url when detail-url is malformed',
    jobs[2].url, 'https://careers.example.com/jobs/42');

  // Numeric character references appear in real Jobvite titles (typographic
  // punctuation from the source ATS), so they must decode, not survive raw.
  {
    const numeric = parseJobviteXml(
      '<result><job><title>Sr Manager &#8217;26 &#x2013; Delivery</title>' +
      '<detail-url><![CDATA[https://app.jobvite.com/x]]></detail-url></job></result>', 'X');
    eq('parseJobviteXml decodes decimal and hex numeric character references',
      numeric[0].title, 'Sr Manager ’26 – Delivery');
  }

  // #2623 review: references outside XML 1.0 §2.2 Char must survive raw rather
  // than decode. NUL and a lone surrogate are the two that String.fromCodePoint
  // would otherwise emit straight into a job title.
  {
    const illegal = parseJobviteXml(
      '<result><job><title>Sr&#0;Manager&#xD800;Ops</title>' +
      '<detail-url><![CDATA[https://app.jobvite.com/x]]></detail-url></job></result>', 'X');
    eq('parseJobviteXml leaves XML-illegal numeric references undecoded',
      illegal[0].title, 'Sr&#0;Manager&#xD800;Ops');
  }

  // An unterminated tag must terminate the scan, not backtrack. Regression guard
  // for the ReDoS-shaped regex this parser deliberately avoids.
  {
    const t0 = Date.now();
    parseJobviteXml('<result><job><title>' + ' '.repeat(60000) + '</job></result>', 'X');
    eq('parseJobviteXml handles an unterminated tag without backtracking', Date.now() - t0 < 1000, true);
  }

  // #2623 review: the same guard one level out. Many `<job>` starts with no
  // closing tag made the old lazy outer matcher rescan to end-of-document from
  // every start — quadratic on input the feed host controls.
  //
  // 40k repeats is 820 KB, well under the 1.9 MB the real feed ships. Measured
  // on the regex this replaced: 15.4s. On the cursor scan: 1ms. The threshold
  // sits between two numbers four orders of magnitude apart, so it is a timing
  // assertion without being a flaky one.
  {
    const t0 = Date.now();
    const unclosed = parseJobviteXml('<result>' + '<job><title>x</title>'.repeat(40000) + '</result>', 'X');
    eq('parseJobviteXml handles many unterminated <job> tags in linear time',
      Date.now() - t0 < 1000, true);
    eq('parseJobviteXml yields nothing from unterminated <job> blocks', unclosed.length, 0);
  }

  eq('parseJobviteXml returns [] for an empty feed', parseJobviteXml('<result></result>', 'X').length, 0);
  eq('parseJobviteXml returns [] for non-string input', parseJobviteXml(null, 'X').length, 0);

  // ── host pinning ───────────────────────────────────────────────
  // A tenant whose configured api: host is foreign must not be fetched. The
  // eId resolver rejects it, so fetch falls through to slug discovery and — with
  // no usable slug — fails loudly rather than reaching the foreign host.
  {
    let reached = null;
    const ctx = { fetchText: async (u) => { reached = u; return ''; }, fetchJson: async () => ({}) };
    let threw = false;
    try {
      await jobvite.fetch({ name: 'Evil', api: 'https://evil.example.com/Xml.aspx?c=abc' }, ctx);
    } catch { threw = true; }
    eq('fetch() refuses an entry whose only id source is a foreign host', threw, true);
    eq('fetch() never issued a request to the foreign host', reached, null);
  }

  // Happy path: configured eId goes straight to the feed, no board request.
  {
    const seen = [];
    const ctx = {
      fetchText: async (u) => { seen.push(u); return XML; },
      fetchJson: async () => ({}),
    };
    const out = await jobvite.fetch({ name: 'Tyler Technologies', company_eid: 'q6NaVfwI' }, ctx);
    eq('fetch() with a configured eId makes exactly one request', seen.length, 1);
    eq('fetch() with a configured eId hits the XML feed',
      seen[0], 'https://app.jobvite.com/CompanyJobs/Xml.aspx?c=q6NaVfwI');
    eq('fetch() returns parsed jobs', out.length, 3);
  }

  // Discovery path: slug only → board page, then feed.
  {
    const seen = [];
    const opts = [];
    const ctx = {
      fetchText: async (u, o) => {
        seen.push(u);
        opts.push(o);
        // Compare the parsed hostname, not a substring of the URL. `u.includes(
        // 'jobs.jobvite.com')` also matches https://evil.example.com/jobs.jobvite.com
        // — CodeQL flags that shape (js/incomplete-url-substring-sanitization)
        // wherever it appears, and it is right to even in a stub: a board
        // response returned for a host that is not the board is exactly the
        // confusion these tests exist to catch.
        return new URL(u).hostname === 'jobs.jobvite.com' ? `companyEId: 'q6NaVfwI'` : XML;
      },
      fetchJson: async () => ({}),
    };
    const out = await jobvite.fetch({ name: 'Tyler', careers_url: 'https://jobs.jobvite.com/tylertech' }, ctx);
    eq('fetch() with only a slug makes two requests (board, then feed)', seen.length, 2);
    // #2623 review: the board carries fr=true&nl=1 so branded tenants render
    // the listing inline instead of 302ing to their own domain, which would
    // take the companyEId out of reach before discovery could start.
    eq('fetch() discovery hits the board with the un-redirect params',
      seen[0], 'https://jobs.jobvite.com/tylertech?fr=true&nl=1');
    eq('fetch() discovery then hits the feed with the scraped eId',
      seen[1], 'https://app.jobvite.com/CompanyJobs/Xml.aspx?c=q6NaVfwI');
    eq('fetch() discovery returns parsed jobs', out.length, 3);

    // #2623 review: pin the redirect mode on both requests. Three separate
    // behaviours ride on these two values — a retired slug must fail loudly
    // (board, 'error'), an empty board must read as [] rather than an error
    // (feed, 'manual'), and neither may ever follow a redirect off-host. A test
    // that only asserts the URLs lets any of that regress silently.
    eq("fetch() board request pins redirect:'error'", opts[0]?.redirect, 'error');
    eq("fetch() feed request pins redirect:'manual'", opts[1]?.redirect, 'manual');
  }

  // Discovery failure must name the fix rather than silently returning [].
  {
    const ctx = { fetchText: async () => '<html>no id</html>', fetchJson: async () => ({}) };
    let msg = '';
    try {
      await jobvite.fetch({ name: 'Tyler', careers_url: 'https://jobs.jobvite.com/tylertech' }, ctx);
    } catch (e) { msg = e.message; }
    eq('fetch() throws a fix-naming error when the eId cannot be discovered',
      msg.includes('company_eid'), true);
  }

  // ── #2623 review: rate limiting ────────────────────────────────
  // app.jobvite.com answers 429 Retry-After: 30 from the second request onward,
  // which a scan covering two Jobvite tenants back-to-back already trips. Live
  // sequence observed: 200, then an immediate 429, then 200 again once the 30s
  // was honoured — so the retry is not merely polite, it is what makes a
  // multi-tenant scan return anything at all.
  {
    let calls = 0;
    const slept = [];
    const ctx = {
      fetchText: async () => {
        calls++;
        if (calls === 1) {
          const err = new Error('HTTP 429 Too Many Requests');
          err.status = 429;
          err.retryAfter = '30';
          throw err;
        }
        return XML;
      },
      fetchJson: async () => ({}),
      sleep: async (ms) => { slept.push(ms); },   // test clock — never wall-clock waits
    };
    const out = await jobvite.fetch({ name: 'Tyler Technologies', company_eid: 'q6NaVfwI' }, ctx);
    eq('fetch() retries the feed after a 429', calls, 2);
    eq('fetch() returns the jobs the retry recovered', out.length, 3);
    // Honoured as advertised, not replaced by the exponential backoff. The
    // shared clamp is maxDelayMs * 4 = 60s under this provider's policy, so a
    // 30s header passes through intact rather than being truncated into another
    // guaranteed 429.
    eq('fetch() honours Retry-After exactly', slept[0], 30_000);
  }

  // A 4xx that is not 429 is the server rejecting the request itself; retrying
  // it just burns wall-clock on every scan.
  {
    let calls = 0;
    const ctx = {
      fetchText: async () => {
        calls++;
        const err = new Error('HTTP 404 Not Found');
        err.status = 404;
        throw err;
      },
      fetchJson: async () => ({}),
      sleep: async () => {},
    };
    let threw = false;
    try {
      await jobvite.fetch({ name: 'Tyler', company_eid: 'q6NaVfwI' }, ctx);
    } catch { threw = true; }
    eq('fetch() does not retry a non-retryable 4xx', calls, 1);
    eq('fetch() propagates a non-retryable 4xx', threw, true);
  }

  // ── #2623 review: empty board vs retired tenant ────────────────
  // A tenant with no open positions does not get an empty <result/>; the feed
  // 302s to NoJobs.htm. Zero vacancies is an answer, not a failure. Observed
  // live on leovegas, whose board renders "There are currently no open jobs."
  // and whose feed returns Location: NoJobs.htm — relative, hence resolved
  // against the request URL rather than string-compared.
  {
    const ctx = {
      fetchText: async () => {
        const err = new Error('HTTP 302 Found');
        err.status = 302;
        err.location = 'NoJobs.htm';   // exactly as the server writes it
        throw err;
      },
      fetchJson: async () => ({}),
      sleep: async () => {},
    };
    const out = await jobvite.fetch({ name: 'LeoVegas', company_eid: 'q1TaVfwJ' }, ctx);
    eq('fetch() reads a NoJobs.htm feed redirect as an empty board', Array.isArray(out) && out.length === 0, true);
  }

  // The inverse, and the reason the check above is scoped to one filename on one
  // host: a slug that is no longer a Jobvite tenant also answers with a 3xx, and
  // it means the opposite thing. Laundering it into "0 jobs today" would hide a
  // dead portal entry behind a plausible-looking empty result — the exact silent
  // failure this whole PR exists to remove.
  {
    const ctx = {
      fetchText: async () => {
        const err = new Error('HTTP 302 Found');
        err.status = 302;
        err.location = 'http://search.jobvite.com?invalid=1';
        throw err;
      },
      fetchJson: async () => ({}),
      sleep: async () => {},
    };
    let threw = false;
    try {
      await jobvite.fetch({ name: 'Zoom', company_eid: 'deadbeef' }, ctx);
    } catch { threw = true; }
    eq('fetch() still fails loudly for a retired tenant redirect', threw, true);
  }

  // A redirect to NoJobs.htm on some OTHER host is not Jobvite saying the board
  // is empty, and must not be read as one.
  {
    const ctx = {
      fetchText: async () => {
        const err = new Error('HTTP 302 Found');
        err.status = 302;
        err.location = 'https://evil.example.com/CompanyJobs/NoJobs.htm';
        throw err;
      },
      fetchJson: async () => ({}),
      sleep: async () => {},
    };
    let threw = false;
    try {
      await jobvite.fetch({ name: 'Evil', company_eid: 'abc' }, ctx);
    } catch { threw = true; }
    eq('fetch() does not accept NoJobs.htm from a foreign host', threw, true);
  }
} catch (e) {
  fail(`jobvite provider tests crashed: ${e.message}`);
}
