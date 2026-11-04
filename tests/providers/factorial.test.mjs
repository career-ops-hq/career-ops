// tests/providers/factorial.test.mjs — Factorial-hosted careers sites
// (<tenant>.factorialhr.com / <tenant>.factorial.com).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — factorial');

const ORIGIN = 'https://acme.factorial.com';

// The shape of a live board home page, trimmed: office groups, each an <h3>
// heading over a list of job-offer-item cards. Values are fictional.
const card = ({ url, title, remote = 'false', loc = 'city:barcelona', workplace = 'Híbrido' }) => `
<li class='job-offer-item w-full' data-action='click-&gt;job-postings#goToJob' data-contract-type='indefinite' data-controller='job-postings' data-is-remote='${remote}' data-job-postings-url='${url}' data-location-key='${loc}' data-target='job-filters.job' role='button'>
<div class='mb-4'><div class='md:flex justify-between items-center p-8'>
<span class='md:w-3/6'>
<div class="text-sm sm:text-base font-bold text-gray-500 text-left factorial__headingFontFamily">${title}

</div></span>
<div class='flex-grow md:w-1/6'><div class="text-sm font-normal text-gray-350 text-left">${workplace}
</div></div>
<a class='buttonSecondary' href='${url}'>Apply now</a>
</div></div>
</li>`;
const group = (heading, cards) => `
<div data-target='job-filters.officeGroup'>
<div class='mb-12'><div class='mb-2 sm:mb-4'><h3 class="text-xl font-bold factorial__headingFontFamily">${heading}

</h3></div>
<ul class='w-full text-left'>${cards.join('')}</ul></div></div>`;
const page = (body) => `<!DOCTYPE html><html><head><meta name="csrf-token" content="x"></head><body>
<a data-action="nav#toggleMobileMenu" href="/#jobs">Jobs</a>
<div data-controller='job-filters'>${body}</div><footer>Powered by Factorial</footer></body></html>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/factorial.mjs')).href);
  const provider = mod.default;
  const { parseFactorialBoard, resolveFactorialOrigin } = mod;

  if (provider.id === 'factorial') pass('factorial.id is "factorial"');
  else fail(`factorial.id is ${JSON.stringify(provider.id)}`);

  // ── detect() ──
  const claims = [
    [{ careers_url: 'https://acme.factorialhr.com' }, 'https://acme.factorial.com/'],
    [{ careers_url: 'https://acme.factorialhr.com/job_posting/ops-lead-123' }, 'https://acme.factorial.com/'],
    [{ careers_url: 'https://ACME.factorial.com/' }, 'https://acme.factorial.com/'],
    [{ careers_url: 'https://careers.factorialhr.com' }, 'https://careers.factorial.com/'],
    [{ careers_url: 'https://acme-group.factorialhr.com:8443/x?y=1' }, 'https://acme-group.factorial.com/'],
    [{ api: 'https://acme.factorial.com/' }, 'https://acme.factorial.com/'],
    // Other Factorial domains are read where they are; only .factorialhr.com,
    // which redirects, is read at .factorial.com.
    [{ careers_url: 'https://acme.factorialhr.pt/' }, 'https://acme.factorialhr.pt/'],
    [{ careers_url: 'https://acme.factorialhr.de/job_posting/x-1' }, 'https://acme.factorialhr.de/'],
    [{ careers_url: 'https://acme.factorialhr.com.br' }, 'https://acme.factorialhr.com.br/'],
    [{ careers_url: 'https://acme.factorial.es' }, 'https://acme.factorial.es/'],
  ];
  const claimBad = claims.filter(([e, want]) => provider.detect(e)?.url !== want);
  if (claimBad.length === 0) pass('detect() claims <tenant>.factorialhr.com and <tenant>.factorial.com, rebuilt as the .factorial.com origin with no path or port');
  else fail(`detect() mismatches: ${claimBad.map(([e, want]) => `${JSON.stringify(e)} → ${JSON.stringify(provider.detect(e))}, want ${want}`).join('; ')}`);

  const refused = [
    { careers_url: 'http://acme.factorialhr.com' },              // not https
    { careers_url: 'https://factorialhr.com/careers' },          // marketing apex
    { careers_url: 'https://www.factorialhr.com' },              // product, not a board
    { careers_url: 'https://app.factorialhr.com' },
    { careers_url: 'https://help.factorialhr.com/en_US/x' },
    { careers_url: 'https://api.factorialhr.com' },
    { careers_url: 'https://blog.factorialhr.com' },
    { careers_url: 'https://a.b.factorialhr.com' },              // nested label
    { careers_url: 'https://acme.factorialhr.net' },             // not a Factorial domain
    { careers_url: 'https://acme.factorialhr.com.evil.example' },
    { careers_url: 'https://acme.factorialhr.pt.evil.example' },
    { careers_url: 'https://www.factorialhr.pt' },               // product, not a board
    { careers_url: 'https://evilfactorialhr.com' },
    { careers_url: 'https://-acme.factorialhr.com' },
    { careers_url: 'not a url' },
    { careers_url: '' },
    { careers_url: null },
    { careers_url: 42 },
    {},
    null,
    undefined,
  ];
  const detectBad = [];
  for (const e of refused) {
    try {
      if (provider.detect(e) !== null) detectBad.push(JSON.stringify(e));
    } catch (err) {
      detectBad.push(`${JSON.stringify(e)} threw ${err.message}`);
    }
  }
  if (detectBad.length === 0) pass('detect() returns null (no throw) for product hosts, other domains, http, nested labels and junk');
  else fail(`detect() misfired on: ${detectBad.join('; ')}`);

  if (resolveFactorialOrigin('https://acme.factorialhr.com/a/b') === ORIGIN) pass('resolveFactorialOrigin drops the path');
  else fail(`resolveFactorialOrigin = ${resolveFactorialOrigin('https://acme.factorialhr.com/a/b')}`);

  // ── parseFactorialBoard ──
  const html = page(
    group('Barcelona', [
      card({ url: `${ORIGIN}/job_posting/ops-lead-101`, title: 'Ops &amp; Strategy Lead' }),
      card({ url: `${ORIGIN}/job_posting/data-analyst-102`, title: 'Data Analyst', remote: 'true' }),
      card({ url: 'https://other.factorial.com/job_posting/foreign-103', title: 'Other Tenant' }),
      card({ url: `${ORIGIN}/careers/not-a-posting`, title: 'Not A Posting' }),
      card({ url: 'not a url', title: 'Broken Url' }),
      card({ url: `${ORIGIN}/job_posting/no-title-104`, title: '' }),
    ])
    + group('Madrid', [
      card({ url: `${ORIGIN}/job_posting/ops-lead-101`, title: 'Ops &amp; Strategy Lead', loc: 'city:madrid' }),
    ])
    + group('Remote', [
      card({ url: `${ORIGIN}/job_posting/support-105`, title: 'Support Engineer', remote: 'true', loc: 'remote' }),
    ]),
  );
  const jobs = parseFactorialBoard(html, ORIGIN, 'Acme');
  const want = [
    { title: 'Ops & Strategy Lead', url: `${ORIGIN}/job_posting/ops-lead-101`, company: 'Acme', location: 'Barcelona / Madrid', externalId: '101' },
    { title: 'Data Analyst', url: `${ORIGIN}/job_posting/data-analyst-102`, company: 'Acme', location: 'Barcelona · Remote', externalId: '102' },
    { title: 'Support Engineer', url: `${ORIGIN}/job_posting/support-105`, company: 'Acme', location: 'Remote', externalId: '105' },
  ];
  if (JSON.stringify(jobs) === JSON.stringify(want)) {
    pass('parseFactorialBoard maps title (entities decoded), url, office, remote and id; one row per posting across offices');
  } else {
    fail(`parseFactorialBoard = ${JSON.stringify(jobs)}`);
  }
  if (!jobs.some((j) => /Other Tenant|Not A Posting|Broken Url/.test(j.title)) && jobs.every((j) => j.title)) {
    pass('parseFactorialBoard drops cards on another host, off the /job_posting/ path, with a bad URL or no title');
  } else {
    fail(`parseFactorialBoard kept a card it should drop: ${JSON.stringify(jobs.map((j) => j.title))}`);
  }

  // A tenant whose cards sit outside any office group falls back to the location key.
  const ungrouped = parseFactorialBoard(page(card({ url: `${ORIGIN}/job_posting/x-9`, title: 'X', loc: 'city:valencia' })), ORIGIN, 'Acme');
  if (ungrouped.length === 1 && ungrouped[0].location === 'valencia') pass('a card outside an office group takes its place from data-location-key');
  else fail(`ungrouped card = ${JSON.stringify(ungrouped)}`);

  // A remote posting listed under an office and under the Remote group names Remote once.
  const twice = parseFactorialBoard(page(
    group('Barcelona', [card({ url: `${ORIGIN}/job_posting/r-7`, title: 'R', remote: 'true' })])
    + group('Remote', [card({ url: `${ORIGIN}/job_posting/r-7`, title: 'R', remote: 'true', loc: 'remote' })]),
  ), ORIGIN, 'Acme');
  if (twice.length === 1 && twice[0].location === 'Barcelona / Remote') pass('a remote posting under an office and the Remote group names Remote once');
  else fail(`remote posting under two groups = ${JSON.stringify(twice)}`);

  // A board read at .factorial.com can link its postings to the tenant's home
  // domain (casafari.factorial.com links to casafari.factorialhr.pt). Those are
  // the tenant's own postings; another tenant's, or a lookalike host, are not.
  const homeDomain = parseFactorialBoard(page(group('Lisboa', [
    card({ url: 'https://acme.factorialhr.pt/job_posting/customer-success-317963', title: 'Customer Success' }),
    card({ url: 'https://other.factorialhr.pt/job_posting/foreign-2', title: 'Other Tenant' }),
    card({ url: 'https://acme.factorialhr.pt.evil.example/job_posting/x-3', title: 'Lookalike' }),
  ])), ORIGIN, 'Acme');
  if (homeDomain.length === 1 && homeDomain[0].title === 'Customer Success'
      && homeDomain[0].url === 'https://acme.factorialhr.pt/job_posting/customer-success-317963') {
    pass('parseFactorialBoard keeps the tenant\'s postings on its home domain and drops other tenants and lookalike hosts');
  } else {
    fail(`home-domain postings = ${JSON.stringify(homeDomain)}`);
  }

  // Empty board vs changed markup.
  const empty = parseFactorialBoard(page('<p>No open positions right now.</p>'), ORIGIN, 'Acme');
  if (Array.isArray(empty) && empty.length === 0) pass('a board page with no posting links is an empty board → []');
  else fail(`empty board = ${JSON.stringify(empty)}`);

  let threw;
  try {
    parseFactorialBoard(page(`<div class="new-card"><a href="${ORIGIN}/job_posting/ops-lead-101">Ops Lead</a></div>`), ORIGIN, 'Acme');
  } catch (e) { threw = e; }
  if (threw && /links to job postings but none could be parsed/.test(threw.message)) {
    pass('posting links with no readable card throw (the markup changed), instead of reading as an empty board');
  } else {
    fail(`changed markup did not throw descriptively: ${threw?.message ?? 'no throw'}`);
  }

  // ── fetch() ──
  const seen = [];
  const ctx = {
    fetchText: async (url, opts) => { seen.push({ url, opts }); return html; },
  };
  const fetched = await provider.fetch({ name: 'Acme', careers_url: 'https://acme.factorialhr.com/job_posting/ops-lead-101' }, ctx);
  if (seen.length === 1 && seen[0].url === `${ORIGIN}/` && seen[0].opts?.redirect === 'error' && fetched.length === 3) {
    pass('fetch() makes one request to the rebuilt .factorial.com origin with redirect: "error"');
  } else {
    fail(`fetch() calls = ${JSON.stringify(seen)}, jobs = ${fetched.length}`);
  }

  let entered = 0;
  let refusedErr;
  try {
    await provider.fetch({ name: 'Acme', careers_url: 'https://acme.example.com' }, { fetchText: async () => { entered += 1; return ''; } });
  } catch (e) { refusedErr = e; }
  if (refusedErr && entered === 0) pass('fetch() refuses a non-Factorial URL before any request');
  else fail(`fetch() on a foreign host: entered=${entered}, error=${refusedErr?.message}`);

  // The probe (ctx.maxPages: 1) is the same single request, and a rejection
  // propagates unwrapped so verify-portals can tell a budget cut-off apart.
  class Sentinel extends Error {}
  const sentinel = new Sentinel('budget');
  let caught;
  try {
    await provider.fetch({ name: 'Acme', careers_url: 'https://acme.factorialhr.com' }, { maxPages: 1, fetchText: async () => { throw sentinel; } });
  } catch (e) { caught = e; }
  if (caught === sentinel) pass('fetch() propagates a ctx.fetchText rejection unwrapped');
  else fail(`fetch() rejection was ${caught === undefined ? 'swallowed' : `rewrapped: ${caught?.message}`}`);
} catch (e) {
  fail(`factorial provider tests crashed: ${e.message}`);
}
