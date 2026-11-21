// Offline coverage for lib/jd-host-readers.mjs: URL routing, each normalizer
// over a payload shaped like the live one (synthetic text, real structure),
// the "is this the posting that was asked for" checks, and the fetch path with
// a stubbed transport. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveHostReader,
  canonicalPageUrl,
  fetchJdViaHostReader,
  normalizeOracleDetail,
  normalizeGooglePage,
  normalizeAppleDetail,
  normalizeAmazonPage,
  normalizeEightfoldDetail,
  normalizeWalmartPage,
  normalizeGoldmanPage,
  normalizeRipplingPage,
  normalizeAvaturePage,
} from '../lib/jd-host-readers.mjs';
import { parseYearsRequirement } from '../jd-years.mjs';

const nextPage = (data) => `<html><body><div>shell</div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;

test('routing: each supported posting URL maps to its reader and API', () => {
  const cases = [
    ['https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210806454', 'oraclecloud',
      'https://jpmc.fa.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22210806454%22,siteNumber=CX_1001'],
    ['https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/298503', 'oraclecloud',
      'https://enterpriseplatform.dell.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22298503%22,siteNumber=CX_1001'],
    ['https://www.google.com/about/careers/applications/jobs/results/80316908812804806-some-title', 'google',
      'https://www.google.com/about/careers/applications/jobs/results/80316908812804806'],
    ['https://jobs.apple.com/en-us/details/200693769-0836/corporate-fp-a-analyst?team=CORSV', 'apple',
      'https://jobs.apple.com/api/v1/jobDetails/200693769-0836'],
    ['https://www.amazon.jobs/en/jobs/10607495/finance-manager', 'amazon', 'https://www.amazon.jobs/en/jobs/10607495/finance-manager'],
    ['https://explore.jobs.netflix.net/careers/job/790319298965', 'eightfold',
      'https://explore.jobs.netflix.net/api/pcsx/position_details?position_id=790319298965'],
    ['https://autodesk.eightfold.ai/careers?pid=1443153475673&domain=autodesk.com', 'eightfold',
      'https://autodesk.eightfold.ai/api/pcsx/position_details?position_id=1443153475673&domain=autodesk.com'],
    ['https://apply.careers.microsoft.com/careers?pid=1970393557050905', 'eightfold',
      'https://apply.careers.microsoft.com/api/pcsx/position_details?position_id=1970393557050905'],
    ['https://careers.walmart.com/us/en/jobs/R-2647437', 'walmart', 'https://careers.walmart.com/us/en/jobs/R-2647437'],
    ['https://higher.gs.com/roles/185190', 'goldman', 'https://higher.gs.com/roles/185190'],
    ['https://careers.servicenow.com/jobs/744000162378899/senior-manager/', 'servicenow',
      'https://api.smartrecruiters.com/v1/companies/ServiceNow/postings/744000162378899'],
    ['https://ats.rippling.com/rippling/jobs/a28cd7c6-f8b8-475f-942d-9201e3d075df', 'rippling',
      'https://ats.rippling.com/rippling/jobs/a28cd7c6-f8b8-475f-942d-9201e3d075df'],
    ['https://ats.rippling.com/en-GB/acme/jobs/6fd9796c-29e6-4a8a-b9af-50333b4f8216?src=x', 'rippling',
      'https://ats.rippling.com/acme/jobs/6fd9796c-29e6-4a8a-b9af-50333b4f8216'],
    ['https://avature.sandisk.com/Careers/JobDetail/Chief-of-Staff-Memory-Technology-Productization/4622', 'avature',
      'https://avature.sandisk.com/Careers/JobDetail/Chief-of-Staff-Memory-Technology-Productization/4622'],
    ['https://jobs.ea.com/en_US/careers/JobDetail/Director-FP-A/216566?source=li#top', 'avature',
      'https://jobs.ea.com/en_US/careers/JobDetail/Director-FP-A/216566'],
    ['https://bloomberg.avature.net/careers/JobDetail?jobId=46057', 'avature',
      'https://bloomberg.avature.net/careers/JobDetail?jobId=46057'],
  ];
  for (const [url, reader, apiUrl] of cases) {
    const r = resolveHostReader(url);
    assert.ok(r, url);
    assert.equal(r.reader, reader, url);
    assert.equal(r.apiUrl, apiUrl, url);
  }
});

test('routing: unrelated URLs, slug-less Amazon and listing pages get no reader', () => {
  for (const url of [
    'https://careers.example.com/jobs/42',
    'https://www.amazon.jobs/en/jobs/10607495',
    'https://www.google.com/about/careers/applications/jobs/results/?q=strategy',
    'https://eaton.eightfold.ai/careers?query=finance',
    'https://eaton.eightfold.ai/careers?pid=../../etc',
    'https://ats.rippling.com/rippling/jobs',
    'https://ats.rippling.com/rippling/jobs/not-a-uuid',
    'https://avature.sandisk.com/Careers/SearchJobs?jobId=4622',
    'https://bloomberg.avature.net/careers/JobDetail?jobId=abc',
    'ftp://jobs.apple.com/en-us/details/1-2',
    'not a url',
  ]) assert.equal(resolveHostReader(url), null, url);
  // A domain query value that is not a bare host name is not passed on.
  assert.equal(
    resolveHostReader('https://x.eightfold.ai/careers?pid=5&domain=a%26b%3Dc').apiUrl,
    'https://x.eightfold.ai/api/pcsx/position_details?position_id=5',
  );
});

test('canonicalPageUrl rewrites the Jibe redirect and leaves everything else', () => {
  assert.equal(canonicalPageUrl('https://careers.amd.com/jobs/99921'), 'https://careers.amd.com/careers-home/jobs/99921');
  assert.equal(canonicalPageUrl('https://careers.se.com/jobs/142115'), 'https://careers.se.com/jobs/142115');
  assert.equal(canonicalPageUrl('nope'), 'nope');
  // iCIMS: the framed document carries the JD.
  assert.equal(
    canonicalPageUrl('https://uscareers-msci.icims.com/jobs/6084/inside-sales/job'),
    'https://uscareers-msci.icims.com/jobs/6084/inside-sales/job?in_iframe=1',
  );
  assert.equal(
    canonicalPageUrl('https://careers-x.icims.com/jobs/5663/fp%26a/job?in_iframe=1'),
    'https://careers-x.icims.com/jobs/5663/fp%26a/job?in_iframe=1',
  );
  assert.equal(canonicalPageUrl('https://careers-x.icims.com/jobs/search?ss=1'), 'https://careers-x.icims.com/jobs/search?ss=1');
  assert.equal(canonicalPageUrl('https://icims.com.evil.example/jobs/1/a/job'), 'https://icims.com.evil.example/jobs/1/a/job');
  // Franklin Templeton's global locale redirects to the home page; the job is under /us/.
  assert.equal(
    canonicalPageUrl('https://careers.franklintempleton.com/global/en/job/870008/Business-Development-Associate'),
    'https://careers.franklintempleton.com/us/en/job/870008/Business-Development-Associate',
  );
  assert.equal(canonicalPageUrl('https://careers.other.com/global/en/job/1/x'), 'https://careers.other.com/global/en/job/1/x');
});

test('Oracle: description, responsibilities and qualifications, matched by Id', () => {
  const json = { items: [{
    Id: '210806454', Title: 'Business Operations Manager',
    ExternalDescriptionStr: '<p>You will partner with leadership.</p>',
    ExternalResponsibilitiesStr: '<ul><li>Run the operating cadence</li></ul>',
    ExternalQualificationsStr: '<ul><li>5+ years of experience in operations</li></ul>',
    CorporateDescriptionStr: '<p>Founded over 200 years ago.</p>',
  }] };
  const r = normalizeOracleDetail(json, '210806454');
  assert.equal(r.title, 'Business Operations Manager');
  assert.match(r.text, /partner with leadership/);
  assert.match(r.text, /Responsibilities\n- Run the operating cadence/);
  assert.match(r.text, /5\+ years of experience/);
  assert.doesNotMatch(r.text, /200 years/, 'corporate boilerplate is left out');
  assert.equal(parseYearsRequirement(r.text).display, '5+');
  assert.equal(normalizeOracleDetail(json, '999'), null, 'another requisition is not this one');
  assert.equal(normalizeOracleDetail({ items: [] }, '210806454'), null, 'a closed requisition answers no items');
});

test('Google: reads the posting from ds:0 and ignores the other jobs in ds:1', () => {
  const job = ['80316908812804806', 'Partner Marketing Manager', 'https://x', [null, '<ul><li>Lead co-marketing</li></ul>'],
    [null, '<h3>Minimum qualifications:</h3><ul><li>6 years of marketing experience.</li></ul>'],
    'projects/x', null, 'Google', 'en-US', [], [null, '<p>About the job.</p>']];
  const other = ['111', 'Other job', 'https://y', [null, ''], [null, '<ul><li>12 years of experience.</li></ul>']];
  const html = `<script>AF_initDataCallback({key: 'ds:0', hash: '1', data:${JSON.stringify([job])}, sideChannel: {}});</script>`
    + `<script>AF_initDataCallback({key: 'ds:1', hash: '2', data:${JSON.stringify([[other]])}, sideChannel: {}});</script>`;
  const r = normalizeGooglePage(html, '80316908812804806');
  assert.equal(r.title, 'Partner Marketing Manager');
  assert.match(r.text, /About the job/);
  assert.match(r.text, /6 years of marketing experience/);
  assert.doesNotMatch(r.text, /12 years/);
  assert.equal(parseYearsRequirement(r.text).display, '6+');
  assert.equal(normalizeGooglePage(html, '111'), null, 'ds:0 must be the requested posting');
  assert.equal(normalizeGooglePage('<html>no data</html>', '1'), null);
});

test('Apple: summary, description and both qualification blocks', () => {
  const json = { res: {
    jobNumber: '200693769-0836', positionId: '200693769', postingTitle: 'Corporate FP&A Analyst',
    jobSummary: 'Imagine what you could do here.', description: 'Partner with finance leads.',
    minimumQualifications: '4-6 years of professional Finance experience\nBS/BA in Finance',
    preferredQualifications: 'CPA a plus',
  } };
  const r = normalizeAppleDetail(json, '200693769-0836');
  assert.equal(r.title, 'Corporate FP&A Analyst');
  assert.match(r.text, /Minimum Qualifications\n4-6 years/);
  assert.equal(parseYearsRequirement(r.text).display, '4-6');
  assert.equal(normalizeAppleDetail(json, '111-2'), null);
  assert.equal(normalizeAppleDetail({}, '200693769-0836'), null);
});

test('Amazon: the section blocks, checked against the page job id', () => {
  const html = `<script>talentbrew_pixel.fire({'job_id':'10607495'});</script><h1 class="title">Finance Manager</h1>
    <div id="job-detail-body"><div class="section description"></div>
    <div class="section"><h2>Description</h2><p>Own the ads P&amp;L.</p></div>
    <div class="section"><h2>Basic Qualifications</h2><p>- 5+ years of finance experience<br/>- Bachelor's degree</p></div>
    <div class="section"><h2>Preferred Qualifications</h2><p>- MBA</p></div></div>`;
  const r = normalizeAmazonPage(html, '10607495');
  assert.equal(r.title, 'Finance Manager');
  assert.match(r.text, /Basic Qualifications\n- 5\+ years of finance experience/);
  assert.equal(parseYearsRequirement(r.text).display, '5+');
  assert.equal(normalizeAmazonPage(html, '1'), null, 'a page for another job id is refused');
  assert.equal(normalizeAmazonPage('<html></html>', '10607495'), null);
});

test('Eightfold PCSX: jobDescription, matched by position id', () => {
  const json = { status: 200, data: { id: 790319298965, name: 'Associate, Corporate FP&A', jobDescription: '<p>3+ years of FP&amp;A experience.</p>' } };
  const r = normalizeEightfoldDetail(json, '790319298965');
  assert.equal(r.title, 'Associate, Corporate FP&A');
  assert.match(r.text, /3\+ years of FP&A experience/);
  assert.equal(normalizeEightfoldDetail(json, '1'), null);
  assert.equal(normalizeEightfoldDetail({ status: 404 }, '790319298965'), null);
});

test('Walmart: the posting description from __NEXT_DATA__, matched by job id', () => {
  const html = nextPage({ props: { pageProps: { jobId: 'R-2647437', jobDetails: {
    jobId: 'R-2647437', jobPostingTitle: 'Senior Manager, Project Management',
    description: '<p>Summary only.</p>',
    jobPostingDescription: '<h2>Minimum Qualifications</h2><p>Bachelor’s degree and 4 years’ experience in operations.</p>',
  } } } });
  const r = normalizeWalmartPage(html, 'R-2647437');
  assert.equal(r.title, 'Senior Manager, Project Management');
  assert.match(r.text, /4 years’ experience/);
  assert.equal(normalizeWalmartPage(html, 'R-1'), null);
  // No full posting description: summary plus the qualification fields.
  const thin = nextPage({ props: { pageProps: { jobDetails: { jobId: 'R-9', description: '<p>Summary.</p>', minimumQualification: ['3 years of experience in retail'] } } } });
  assert.match(normalizeWalmartPage(thin, 'R-9').text, /Minimum Qualifications\n3 years of experience/);
});

test('Goldman: role.descriptionHtml, matched by role id', () => {
  const html = nextPage({ props: { pageProps: { role: {
    roleId: '185190_GS_EARLY_CAREER', jobTitle: 'Vendor Management, Analyst',
    descriptionHtml: '<p><strong>Qualifications</strong></p><ul><li>Typically 1-3 years of relevant experience</li></ul>',
    externalSource: { sourceId: '185190' },
  } } } });
  const r = normalizeGoldmanPage(html, '185190');
  assert.equal(r.title, 'Vendor Management, Analyst');
  assert.equal(parseYearsRequirement(r.text).display, '1-3');
  assert.equal(normalizeGoldmanPage(html, '9'), null);
  assert.equal(normalizeGoldmanPage('<html></html>', '185190'), null);
});

/** Transport stub: answers from a map by URL, records each call and its headers. */
function stubCtx(answers) {
  const calls = [];
  const answer = async (url, opts) => {
    calls.push({ url, opts });
    if (!(url in answers)) throw Object.assign(new Error(`unexpected ${url}`), { status: 404 });
    const a = answers[url];
    if (a instanceof Error) throw a;
    return a;
  };
  return { calls, ctx: { fetchJson: answer, fetchText: answer, sleep: async () => {} } };
}

test('fetchJdViaHostReader: JSON and HTML readers through the transport, capped', async () => {
  const oracleUrl = 'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/42';
  const oracleApi = resolveHostReader(oracleUrl).apiUrl;
  const goldmanUrl = 'https://higher.gs.com/roles/7';
  const { ctx, calls } = stubCtx({
    [oracleApi]: { items: [{ Id: '42', Title: 'Analyst', ExternalDescriptionStr: '<p>2+ years of experience.</p>' }] },
    [goldmanUrl]: nextPage({ props: { pageProps: { role: { roleId: '7', jobTitle: 'Analyst', descriptionHtml: '<p>3+ years of experience.</p>' } } } }),
  });
  const a = await fetchJdViaHostReader(oracleUrl, { ctx });
  assert.equal(a.reader, 'oraclecloud');
  assert.match(a.text, /2\+ years/);
  assert.equal(calls[0].opts.headers.accept, 'application/json');
  const b = await fetchJdViaHostReader(goldmanUrl, { ctx, textCap: 10 });
  assert.equal(b.reader, 'goldman');
  assert.equal(b.text.length, 10, 'text is capped');
  assert.match(calls[1].opts.headers.accept, /text\/html/);
});

test('fetchJdViaHostReader: null with no reader, throws when the answer has no JD for the posting', async () => {
  const { ctx, calls } = stubCtx({});
  assert.equal(await fetchJdViaHostReader('https://careers.example.com/jobs/1', { ctx }), null);
  assert.equal(calls.length, 0);
  const url = 'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/42';
  const closed = stubCtx({ [resolveHostReader(url).apiUrl]: { items: [] } });
  await assert.rejects(fetchJdViaHostReader(url, { ctx: closed.ctx }), /oraclecloud answered without a JD/);
});

test('Rippling: jobPost role and company HTML from __NEXT_DATA__, matched by uuid', () => {
  const uuid = 'a28cd7c6-f8b8-475f-942d-9201e3d075df';
  const html = nextPage({ props: { pageProps: { apiData: { jobPost: {
    uuid, name: 'Marketing Strategy & Planning Manager',
    description: { company: '<p>About Rippling.</p>', role: '<h2>What you will do</h2><ul><li>4+ years in marketing strategy</li></ul>' },
  } } } } });
  const r = normalizeRipplingPage(html, uuid.toUpperCase());
  assert.equal(r.title, 'Marketing Strategy & Planning Manager');
  assert.match(r.text, /^What you will do/);
  assert.match(r.text, /About Rippling\.$/);
  assert.equal(parseYearsRequirement(r.text).display, '4+');
  assert.equal(normalizeRipplingPage(html, '6fd9796c-29e6-4a8a-b9af-50333b4f8216'), null);
  assert.equal(normalizeRipplingPage('<html></html>', uuid), null);
});

// Avature job page: field articles plus a collapsible <details> Description
// block (avature.sandisk.com), with the job id in the page's own job links.
const avaturePage = (id) => `<html><head><meta property="og:title" content="Chief of Staff, Memory &amp;amp; Storage"></head><body class="body--jobDetail">
<article class="article article--details regular-fields--cols-2Z"><header class="article__header"><div class="article__header__text">
<h2 class="article__header__text__title title title--h4">General Information</h2></div></header>
<div class="article__content"><div class="article__content__view__field"><div class="article__content__view__field__label">Job Name</div>
<div class="article__content__view__field__value">Chief of Staff</div></div></div></article>
<details class="article article--details article--collapsible article--open" open><summary class="article__header">
<div class="article__header__text"><h2 class="article__header__text__title">Description</h2></div></summary>
<div class="article__content"><article class="article article--details "><p>Inner block read once.</p></article><ul><li>8+ years of program management experience</li></ul></div></details>
<article class="article article--actions"><a href="/Careers/ApplicationMethods?jobId=${id}">Apply</a></article>
<article class="article article--share">Share this job</article>
</body></html>`;

test('Avature: the details sections (article and details), matched by jobId', () => {
  const r = normalizeAvaturePage(avaturePage('4622'), '4622');
  assert.equal(r.title, 'Chief of Staff, Memory & Storage');
  assert.match(r.text, /Job Name\s+Chief of Staff/);
  assert.match(r.text, /8\+ years of program management/);
  assert.equal(r.text.match(/Inner block read once/g).length, 1);
  assert.doesNotMatch(r.text, /Share this job|Apply/);
  assert.equal(parseYearsRequirement(r.text).display, '8+');
  // Another job's page, or an id that only prefixes the page's id, is not this posting.
  assert.equal(normalizeAvaturePage(avaturePage('4622'), '3000'), null);
  assert.equal(normalizeAvaturePage(avaturePage('46220'), '4622'), null);
});

test('fetchJdViaHostReader: Rippling and Avature read the posting page as HTML', async () => {
  const rUrl = 'https://ats.rippling.com/rippling/jobs/a28cd7c6-f8b8-475f-942d-9201e3d075df';
  const aUrl = 'https://avature.sandisk.com/Careers/JobDetail/Chief-of-Staff/4622';
  const { ctx, calls } = stubCtx({
    [rUrl]: nextPage({ props: { pageProps: { apiData: { jobPost: { uuid: 'a28cd7c6-f8b8-475f-942d-9201e3d075df', name: 'M', description: { role: '<p>5+ years.</p>' } } } } } }),
    [aUrl]: avaturePage('4622'),
  });
  assert.equal((await fetchJdViaHostReader(rUrl, { ctx })).reader, 'rippling');
  assert.equal((await fetchJdViaHostReader(aUrl, { ctx })).reader, 'avature');
  assert.match(calls[1].opts.headers.accept, /text\/html/);
});
