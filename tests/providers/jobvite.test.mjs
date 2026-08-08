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
  <title>Malformed URL</title>
  <detail-url><![CDATA[not a url]]></detail-url>
</job>
</result>`;

  const jobs = parseJobviteXml(XML, 'Tyler Technologies');
  // Five <job> nodes in; three are dropped — empty title, no URL at all, and a
  // malformed detail-url that URL() rejects. Only two survive.
  eq('parseJobviteXml keeps only postings with a title AND a usable URL', jobs.length, 2);

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
    eq('fetch() returns parsed jobs', out.length, 2);
  }

  // Discovery path: slug only → board page, then feed.
  {
    const seen = [];
    const ctx = {
      fetchText: async (u) => {
        seen.push(u);
        return u.includes('jobs.jobvite.com') ? `companyEId: 'q6NaVfwI'` : XML;
      },
      fetchJson: async () => ({}),
    };
    const out = await jobvite.fetch({ name: 'Tyler', careers_url: 'https://jobs.jobvite.com/tylertech' }, ctx);
    eq('fetch() with only a slug makes two requests (board, then feed)', seen.length, 2);
    eq('fetch() discovery hits the board first', seen[0], 'https://jobs.jobvite.com/tylertech');
    eq('fetch() discovery then hits the feed with the scraped eId',
      seen[1], 'https://app.jobvite.com/CompanyJobs/Xml.aspx?c=q6NaVfwI');
    eq('fetch() discovery returns parsed jobs', out.length, 2);
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
} catch (e) {
  fail(`jobvite provider tests crashed: ${e.message}`);
}
