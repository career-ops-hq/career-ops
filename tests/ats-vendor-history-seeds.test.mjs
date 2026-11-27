import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { atsVendorOf } from '../ats-vendor.mjs';
import { knownAtsVendorOf } from '../analyze-patterns.mjs';
import {
  atsBoardUrlOf,
  loadHistoryAtsSeeds,
  parseScanHistoryAtsSeeds,
  parseTrackerAtsSeeds,
} from '../history-ats-seeds.mjs';
import { parseArgs, runHistorySeedScan } from '../scan-ats-full.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nATS vendor + user-history reverse-scan seeds (#3697)');

try {
  assert.equal(parseArgs(['node', 'scan-ats-full.mjs']).historySeeds, false);
  assert.throws(
    () => parseArgs(['node', 'scan-ats-full.mjs', '--ats', 'successfactors']),
    /--ats successfactors has no public directory source.*--history-seeds/,
  );
  assert.throws(
    () => parseArgs(['node', 'scan-ats-full.mjs', '--ats', 'greenhouse,successfactors']),
    /--ats successfactors has no public directory source.*--history-seeds/,
  );
  assert.equal(parseArgs(['node', 'scan-ats-full.mjs', '--history-seeds']).historySeeds, true);
  assert.equal(
    parseArgs(['node', 'scan-ats-full.mjs', '--history-seeds', '--ats', 'successfactors']).historySeeds,
    true,
  );
  pass('application-history board discovery is disabled by default and requires --history-seeds');

  const cases = [
    ['https://job-boards.eu.greenhouse.io/acme/jobs/1', 'greenhouse'],
    ['https://jobs.lever.co/acme/id', 'lever'],
    ['https://jobs.ashbyhq.com/acme/id', 'ashby'],
    ['https://acme.wd5.myworkdayjobs.com/Careers/job/X/R1', 'workday'],
    ['https://careers-acme.icims.com/jobs/1/x', 'icims'],
    ['https://acme.successfactors.eu/job/X/1', 'successfactors'],
    ['https://jobs.dayforcehcm.com/en-US/acme/jobs/1', 'dayforce'],
    ['https://recruiting.ultipro.com/ACM1000/jobs/1', 'ultipro'],
    ['https://acme.taleo.net/careersection/jobdetail.ftl', 'taleo'],
    ['https://acme.hirehive.com/backend-engineer-berlin-Ab12Cd', 'hirehive'],
    ['https://acme.hirehive.com.evil.example/backend-engineer-Ab12Cd', 'acme.hirehive.com.evil.example'],
    ['https://acme-641e1b39232b.careers.hibob.com/jobs/0b1c2d3e/apply', 'hibob'],
    ['https://careers.hibob.com.evil.example/jobs/1', 'careers.hibob.com.evil.example'],
    ['https://acme.recruitmentplatform.com/details.html?jobId=4001', 'talentlink'],
    ['https://acme.recruitmentplatform.com.evil.example/details.html', 'acme.recruitmentplatform.com.evil.example'],
    ['https://careers.example.com/jobs/1', 'careers.example.com'],
    ['https://evil.example/https://jobs.lever.co/acme', 'evil.example'],
    // Shared hosts of the other zero-auth providers. Tenant-subdomain vendors
    // match by suffix; vendors whose provider pins hosts match those exactly.
    ['https://acme.applicantpro.com/jobs/12345.html', 'applicantpro'],
    ['https://acme.applytojob.com/apply/AbC123/Backend', 'jazzhr'],
    ['https://acme.breezy.hr/p/abc123-backend', 'breezy'],
    ['https://acme.hire.trakstar.com/jobs/fk0abc', 'trakstar'],
    ['https://acme.homerun.co/backend-engineer', 'homerun'],
    ['https://acme.jobs.personio.com/job/7001', 'personio'],
    ['https://acme.jobs.personio.de/job/7001', 'personio'],
    ['https://acme.keka.com/careers/jobdetails/123', 'keka'],
    ['https://acme.pinpointhq.com/en/postings/1234', 'pinpoint'],
    ['https://acme.prevueaps.ca/jobs/123', 'prevueaps'],
    ['https://acme.recruitee.com/o/backend-engineer', 'recruitee'],
    ['https://acme.recruiterbox.com/jobs/fk0abc', 'trakstar'],
    ['https://acme.schoolspring.com/?jobid=1', 'schoolspring'],
    ['https://acme.taleez.com/offres/123', 'taleez'],
    ['https://acme.teamtailor.com/jobs/123-backend', 'teamtailor'],
    ['https://acme.turbohire.co/job/123', 'turbohire'],
    ['https://acme.zohorecruit.com.au/jobs/Careers/123', 'zoho-recruit'],
    ['https://acme.zohorecruit.com/jobs/Careers/123', 'zoho-recruit'],
    ['https://acme.zohorecruit.eu/jobs/Careers/123', 'zoho-recruit'],
    ['https://app.jobvite.com/CompanyJobs/Xml.aspx?c=qAB', 'jobvite'],
    ['https://app.mokahr.com/social-recruitment/acme/12345#/job/1', 'mokahr'],
    ['https://apply.workable.com/acme/j/ABC123/', 'workable'],
    ['https://ats.rippling.com/acme/jobs/1b2c3d4e', 'rippling'],
    ['https://feed.homerun.co/acme', 'homerun'],
    ['https://hire-r1.mokahr.com/apply/acme/12345#/job/1', 'mokahr'],
    ['https://jobs.gem.com/acme/am9icG9zdDox', 'gem'],
    ['https://jobs.jobvite.com/acme/job/oABC123', 'jobvite'],
    ['https://jobs.polymer.co/acme/12345', 'polymer'],
    ['https://join.com/companies/acme/12345-backend', 'join'],
    ['https://recruiting.paylocity.com/Recruiting/Jobs/Details/123', 'paylocity'],
    ['https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=c1&ccId=c2', 'adp-workforcenow'],
    ['https://www.comeet.co/careers-api/2.0/company/12.345/positions', 'comeet'],
    ['https://www.comeet.com/jobs/acme/12.345/backend/67.890', 'comeet'],
    // A vendor domain inside a longer host is not that vendor.
    ['https://acme.breezy.hr.evil.example/p/1', 'acme.breezy.hr.evil.example'],
    ['https://acme.recruitee.com.evil.example/o/1', 'acme.recruitee.com.evil.example'],
    ['https://acme.zohorecruit.com.evil.example/jobs/1', 'acme.zohorecruit.com.evil.example'],
    ['https://evilbreezy.hr/p/1', 'evilbreezy.hr'],
    // Off the pinned hosts, the vendor's domain is its own site or another product.
    ['https://careers.jobvite.com/jobs', 'careers.jobvite.com'],
    ['https://jobs.adp.com/job/1', 'jobs.adp.com'],
    ['https://myjobs.adp.com/acme/cx/job-details?reqId=1', 'myjobs.adp.com'],
    ['https://www.gem.com/careers', 'www.gem.com'],
    ['https://www.paylocity.com/careers', 'www.paylocity.com'],
    ['https://www.rippling.com/careers', 'www.rippling.com'],
    ['https://www.workable.com/careers', 'www.workable.com'],
  ];
  for (const [url, expected] of cases) assert.equal(atsVendorOf(url), expected, url);
  for (const invalid of ['', null, 'not a url', 'file:///tmp/jobs']) assert.equal(atsVendorOf(invalid), null);
  pass('atsVendorOf identifies known ATS hosts, rejects spoofing, and preserves an unknown hostname');

  assert.equal(knownAtsVendorOf('https://jobs.lever.co/acme/id'), 'lever');
  assert.equal(knownAtsVendorOf('https://jobs.dayforcehcm.com/en-US/acme/jobs/1'), null);
  assert.equal(knownAtsVendorOf('https://careers.bigco.com/jobs/1'), null);
  assert.equal(knownAtsVendorOf('not a url'), null);
  pass('analyze-patterns keeps only known ATS vendors and drops employer hostnames');

  assert.equal(
    atsBoardUrlOf('https://boards.greenhouse.io/acme/jobs/123?gh_src=history', 'greenhouse'),
    'https://job-boards.greenhouse.io/acme',
  );
  assert.equal(
    atsBoardUrlOf('https://job-boards.eu.greenhouse.io/acme/jobs/123', 'greenhouse'),
    'https://job-boards.eu.greenhouse.io/acme',
  );
  pass('legacy Greenhouse history URLs normalize to the host detected by the provider');

  assert.equal(
    atsBoardUrlOf('https://jobs.lever.co/acme/role-id?lever-source=x', 'lever'),
    'https://jobs.lever.co/acme',
  );
  assert.equal(
    atsBoardUrlOf('https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Toronto/Role_R1', 'workday'),
    'https://acme.wd5.myworkdayjobs.com/Careers',
  );
  assert.equal(
    atsBoardUrlOf('https://acme.successfactors.eu/Brand/job/Toronto/Role/1/', 'successfactors'),
    'https://acme.successfactors.eu/Brand',
  );
  for (const posting of [
    'https://acme.hirehive.com/backend-engineer-berlin-Ab12Cd?source=x',
    'https://acme.hirehive.com/job/214176/backend-engineer',
  ]) {
    assert.equal(atsBoardUrlOf(posting, 'hirehive'), 'https://acme.hirehive.com', posting);
  }
  for (const refused of [
    'http://acme.hirehive.com/backend-engineer-berlin-Ab12Cd',
    'https://apply.hirehive.com/214176/apply',
    'https://www.hirehive.com/pricing-plans',
    'https://a.b.hirehive.com/backend-engineer-Ab12Cd',
  ]) {
    assert.equal(atsBoardUrlOf(refused, 'hirehive'), null, refused);
  }
  assert.equal(
    atsBoardUrlOf('https://acme.careers.hibob.com/jobs/0b1c2d3e-0000-4000-8000-000000000001/apply', 'hibob'),
    'https://acme.careers.hibob.com',
  );
  for (const refused of [
    'http://acme.careers.hibob.com/jobs/1',
    'https://careers.hibob.com/jobs/1',
    'https://a.b.careers.hibob.com/jobs/1',
  ]) {
    assert.equal(atsBoardUrlOf(refused, 'hibob'), null, refused);
  }
  assert.equal(atsBoardUrlOf('http://acme.bamboohr.com/careers/1', 'bamboohr'), 'http://acme.bamboohr.com');
  assert.equal(
    atsBoardUrlOf('https://acme.recruitmentplatform.com/internal/details.html?jobId=4001&jobTitle=Role', 'talentlink'),
    'https://acme.recruitmentplatform.com/internal',
  );
  assert.equal(
    atsBoardUrlOf('https://acme.recruitmentplatform.com/FO/ABC123/components/details.html?jobId=4001', 'talentlink'),
    'https://acme.recruitmentplatform.com/FO/ABC123/components',
  );
  assert.equal(
    atsBoardUrlOf('https://acme.recruitmentplatform.com/details.html?jobId=4001', 'talentlink'),
    'https://acme.recruitmentplatform.com',
  );
  for (const refused of [
    'http://acme.recruitmentplatform.com/details.html?jobId=4001',
    'https://recruitmentplatform.com/details.html?jobId=4001',
    'https://a.b.recruitmentplatform.com/details.html?jobId=4001',
    'https://emea3.recruitmentplatform.com/syndicated/lay/jsoutputinitrapido.cfm?component=lay9999_lst',
  ]) {
    assert.equal(atsBoardUrlOf(refused, 'talentlink'), null, refused);
  }
  pass('posting URLs collapse to provider-compatible board URLs without query or fragment data');

  // Two postings on one board give one board URL, and the provider whose id
  // the vendor label names accepts that URL: --history-seeds can reach it.
  const sharedBoards = [
    ['adp-workforcenow',
      'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=c1&ccId=19000101_000001&jobId=55&lang=en_CA',
      'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?lang=en_CA&jobId=66&ccId=19000101_000001&cid=c1',
      'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=c1&ccId=19000101_000001&lang=en_CA'],
    ['applicantpro', 'https://acme.applicantpro.com/jobs/12345.html', 'https://www.applicantpro.com/openings/acme/jobs/67890', 'https://acme.applicantpro.com'],
    ['breezy', 'https://acme.breezy.hr/p/abc123-backend', 'https://acme.breezy.hr/p/def456-frontend', 'https://acme.breezy.hr'],
    ['gem', 'https://jobs.gem.com/acme/am9icG9zdDox', 'https://jobs.gem.com/acme/am9icG9zdDoy', 'https://jobs.gem.com/acme'],
    ['homerun', 'https://acme.homerun.co/backend-engineer', 'https://feed.homerun.co/Acme', 'https://feed.homerun.co/acme'],
    ['jazzhr', 'https://acme.applytojob.com/apply/AbC123/Backend', 'https://acme.applytojob.com/apply/XyZ/Frontend', 'https://acme.applytojob.com'],
    ['jobvite', 'https://jobs.jobvite.com/acme/job/oABC123', 'https://jobs.jobvite.com/acme/job/oDEF456', 'https://jobs.jobvite.com/acme'],
    ['join', 'https://join.com/companies/acme/12345-backend', 'https://join.com/companies/acme/67890-frontend', 'https://join.com/companies/acme'],
    ['keka', 'https://acme.keka.com/careers/jobdetails/123', 'https://acme.keka.com/careers/jobdetails/456', 'https://acme.keka.com'],
    ['mokahr', 'https://app.mokahr.com/social-recruitment/acme/12345#/job/1', 'https://app.mokahr.com/social-recruitment/acme/12345/#/job/2', 'https://app.mokahr.com/social-recruitment/acme/12345'],
    ['paylocity',
      'https://recruiting.paylocity.com/Recruiting/Jobs/All/0A1B2C3D-4E5F-6A7B-8C9D-0E1F2A3B4C5D?x=1',
      'https://recruiting.paylocity.com/recruiting/jobs/all/0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d',
      'https://recruiting.paylocity.com/Recruiting/Jobs/All/0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d'],
    ['personio', 'https://acme.jobs.personio.de/job/7001?language=en', 'https://acme.jobs.personio.de/job/7002', 'https://acme.jobs.personio.de'],
    ['pinpoint', 'https://acme.pinpointhq.com/en/postings/1234', 'https://acme.pinpointhq.com/en/postings/9999', 'https://acme.pinpointhq.com'],
    ['polymer', 'https://jobs.polymer.co/acme/12345', 'https://jobs.polymer.co/acme/67890', 'https://jobs.polymer.co/acme'],
    ['prevueaps', 'https://acme.prevueaps.ca/jobs/123', 'https://acme.prevueaps.ca/jobs/456', 'https://acme.prevueaps.ca'],
    ['recruitee', 'https://acme.recruitee.com/o/backend', 'https://acme.recruitee.com/o/frontend?lang=en', 'https://acme.recruitee.com'],
    ['rippling', 'https://ats.rippling.com/acme/jobs/1b2c3d4e', 'https://ats.rippling.com/acme/jobs', 'https://ats.rippling.com/acme'],
    ['schoolspring', 'https://acme.schoolspring.com/?jobid=1', 'https://acme.schoolspring.com/jobs/2', 'https://acme.schoolspring.com'],
    ['taleez', 'https://acme.taleez.com/offres/123', 'https://acme.taleez.com/offres/456', 'https://acme.taleez.com'],
    ['teamtailor', 'https://acme.teamtailor.com/jobs/123-backend', 'https://acme.teamtailor.com/jobs/456-frontend', 'https://acme.teamtailor.com'],
    ['trakstar', 'https://acme.hire.trakstar.com/jobs/fk0abc', 'https://acme.hire.trakstar.com/jobs/fk0def', 'https://acme.hire.trakstar.com'],
    ['trakstar', 'https://acme.recruiterbox.com/jobs/fk0abc', 'https://acme.hire.trakstar.com/jobs/fk0def', 'https://acme.hire.trakstar.com'],
    ['trakstar', 'https://jsapi.recruiterbox.com/v1/openings?client_name=Acme&limit=50', 'https://jsapi.recruiterbox.com/v1/openings/?offset=100&client_name=acme', 'https://acme.hire.trakstar.com'],
    ['turbohire', 'https://acme.turbohire.co/job/123', 'https://acme.turbohire.co/job/456', 'https://acme.turbohire.co'],
    ['workable', 'https://apply.workable.com/acme/j/ABC123/', 'https://apply.workable.com/acme/', 'https://apply.workable.com/acme'],
    ['zoho-recruit', 'https://acme.zohorecruit.com/jobs/Careers/123/Backend', 'https://acme.zohorecruit.com/jobs/Careers/456', 'https://acme.zohorecruit.com'],
  ];
  for (const [vendor, first, second, board] of sharedBoards) {
    assert.equal(atsBoardUrlOf(first), board, first);
    assert.equal(atsBoardUrlOf(second), board, second);
    const { default: provider } = await import(`../providers/${vendor}.mjs`);
    assert.equal(provider.id, vendor);
    assert.ok(provider.detect({ name: 'Acme', careers_url: board, provider: vendor }), `${vendor} detect() accepts ${board}`);
  }
  for (const refused of [
    'https://api.gem.com/job_board/v0/acme',
    'https://app.jobvite.com/CompanyJobs/Xml.aspx?c=qAB',
    'https://app.mokahr.com/social-recruitment/acme',
    'https://apply.workable.com/',
    'https://apply.workable.com/j/ABC123',
    'https://ats.rippling.com/',
    'https://jobs.gem.com/',
    'https://jobs.jobvite.com/',
    'https://jobs.jobvite.com/api/x',
    'https://jobs.lever.co/',
    'https://join.com/acme',
    'https://jsapi.recruiterbox.com/v1/openings',
    'https://jsapi.recruiterbox.com/v1/openings?client_name=a.b',
    'https://jsapi.recruiterbox.com/v1/openings?client_name=api',
    'https://jsapi.recruiterbox.com/v1/other?client_name=acme',
    'https://recruiting.paylocity.com/Recruiting/Jobs/All/not-a-guid',
    'https://recruiting.paylocity.com/Recruiting/Jobs/Details/123',
    'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?jobId=1',
    'https://www.applicantpro.com/pricing',
    'https://www.comeet.com/jobs/acme/12.345/backend/67.890',
  ]) {
    assert.equal(atsBoardUrlOf(refused), null, refused);
  }
  // These providers read only HTTPS boards, so an http:// posting link is
  // upgraded rather than kept as a seed detect() refuses.
  for (const [vendor, , , board] of sharedBoards) {
    const http = board.replace(/^https:/, 'http:');
    assert.equal(atsBoardUrlOf(http, vendor), board, http);
  }
  assert.equal(atsBoardUrlOf('http://jobs.jobvite.com/acme/job/123'), 'https://jobs.jobvite.com/acme');
  pass('postings on the newly known shared ATS hosts reduce to one board their provider detects');

  const trackerWithUrl = [
    '# Applications Tracker',
    '',
    '| Role | Company | Status | Score | # | URL | Date | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|---|',
    '| Engineer | Acme | Applied | 4/5 | 1 | https://jobs.lever.co/acme/job-1 | 2026-09-01 | - | - | |',
    '| Analyst | No URL | Applied | 4/5 | 2 | - | 2026-09-01 | - | [2](https://evidence.example/report) | https://jobs.ashbyhq.com/wrong/not-a-seed |',
  ].join('\n');
  const trackerSeeds = parseTrackerAtsSeeds(trackerWithUrl);
  assert.deepEqual(trackerSeeds, [{
    company: 'Acme', vendor: 'lever', careersUrl: 'https://jobs.lever.co/acme', source: 'tracker',
  }]);
  pass('tracker seeds use the named URL column and ignore report/notes links');

  const history = [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation',
    'https://jobs.lever.co/acme/job-2\t2026-09-02\tlever\tEngineer\tAcme Inc\tadded\tRemote',
    'malformed\t2026-09-02\tx\tBad\tBad\tadded\tRemote',
    'https://jobs.dayforcehcm.com/en-US/acme/jobs/3\t2026-09-02\tdayforce\tOps\tDay Co\tadded\tRemote',
  ].join('\n');
  assert.equal(parseScanHistoryAtsSeeds(history).length, 2);
  pass('scan-history parsing is backward-compatible with positional TSV rows and skips malformed URLs');

  const root = mkdtempSync(join(tmpdir(), 'career-ops-history-seeds-'));
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    const trackerPath = join(root, 'custom-applications.md');
    writeFileSync(trackerPath, [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 1 | 2026-09-01 | Acme | Engineer | 4/5 | Applied | - | [1](../reports/001-acme.md) | |',
    ].join('\n'), 'utf-8');
    mkdirSync(join(root, 'reports'), { recursive: true });
    writeFileSync(
      join(root, 'reports/001-acme.md'),
      '# Evaluation\n\n**Score:** 4/5 | **URL:** https://jobs.lever.co/acme/job-1 | **Legitimacy:** High\n',
      'utf-8',
    );
    writeFileSync(
      join(root, 'reports/002-other.md'),
      '# Evaluation\n\n**Score:** 4/5 | **URL:** https://jobs.ashbyhq.com/other/job-2 | **Legitimacy:** High\n',
      'utf-8',
    );
    const mismatchedReportLink = trackerWithUrl
      .replace('https://jobs.lever.co/acme/job-1', '-')
      .replace('| - | - | |', '| - | [1](../reports/002-other.md) | |');
    assert.deepEqual(
      parseTrackerAtsSeeds(mismatchedReportLink, { reportsRoot: join(root, 'reports') }),
      [],
      'a numeric link label may not redirect seed derivation to a different report target',
    );
    const matchedReportLink = mismatchedReportLink.replace('[1](../reports/002-other.md)', '[2](../reports/002-other.md)');
    assert.equal(
      parseTrackerAtsSeeds(matchedReportLink, { reportsRoot: join(root, 'reports') })[0]?.vendor,
      'ashby',
      'the linked report target is used when its label agrees',
    );
    const externalReportLink = matchedReportLink.replace(
      '[2](../reports/002-other.md)',
      '[2](https://example.com/002-other.md)',
    );
    assert.deepEqual(
      parseTrackerAtsSeeds(externalReportLink, { reportsRoot: join(root, 'reports') }),
      [],
      'an external report-looking target may not select a same-numbered local report',
    );
    writeFileSync(join(root, 'data/scan-history.tsv'), history, 'utf-8');
    const oldTracker = process.env.CAREER_OPS_TRACKER;
    process.env.CAREER_OPS_TRACKER = trackerPath;
    try {
      const seeds = loadHistoryAtsSeeds({
        dataRoot: root,
        scanHistoryPath: join(root, 'data/scan-history.tsv'),
      });
      assert.equal(seeds.length, 2, 'two Lever postings must collapse to one board, plus Dayforce');
      assert.deepEqual(seeds.map((seed) => seed.vendor).sort(), ['dayforce', 'lever']);
    } finally {
      if (oldTracker === undefined) delete process.env.CAREER_OPS_TRACKER;
      else process.env.CAREER_OPS_TRACKER = oldTracker;
    }
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
  pass('the nine-column tracker resolves linked report URLs, honors CAREER_OPS_TRACKER, and deduplicates boards');

  const calls = [];
  const mockProvider = {
    id: 'lever',
    detect: () => ({ url: 'mock' }),
    async fetch(entry) {
      calls.push(entry);
      return [{ title: 'Engineer', url: 'https://jobs.lever.co/acme/new', company: entry.name, postedAt: Date.now() }];
    },
  };
  const processed = [];
  const run = await runHistorySeedScan(
    [
      { company: 'Acme', vendor: 'lever', careersUrl: 'https://jobs.lever.co/acme' },
      { company: 'Long tail', vendor: 'careers.example.com', careersUrl: 'https://careers.example.com/jobs/1' },
    ],
    new Map([['lever', mockProvider]]),
    { atsExplicit: false, ats: [], limit: Infinity, shuffle: false, verbose: false },
    {},
    async (jobs, source, provider, company) => processed.push({ jobs, source, provider, company }),
  );
  assert.equal(calls.length, 1);
  assert.equal(processed[0].source, 'lever-history');
  assert.deepEqual(run, { total: 1, derived: 2, unsupported: 1, errors: 0 });
  pass('history scan fetches only locally installed providers and keeps unsupported host labels inert');

  let lateProcessCalls = 0;
  const slowProvider = {
    id: 'lever',
    detect: () => ({ url: 'mock' }),
    async fetch() {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return [{ title: 'Late', url: 'https://jobs.lever.co/acme/late' }];
    },
  };
  const timedOut = await runHistorySeedScan(
    [{ company: 'Acme', vendor: 'lever', careersUrl: 'https://jobs.lever.co/acme' }],
    new Map([['lever', slowProvider]]),
    { atsExplicit: false, ats: [], limit: Infinity, shuffle: false, verbose: false, companyTimeoutMs: 5 },
    {},
    async () => { lateProcessCalls++; },
  );
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(timedOut.errors, 1);
  assert.equal(lateProcessCalls, 0);
  pass('timed-out history fetches cannot send late results into the shared processor');

  let lateProcessorMutations = 0;
  const processingTimedOut = await runHistorySeedScan(
    [{ company: 'Acme', vendor: 'lever', careersUrl: 'https://jobs.lever.co/acme' }],
    new Map([['lever', mockProvider]]),
    { atsExplicit: false, ats: [], limit: Infinity, shuffle: false, verbose: false, companyTimeoutMs: 5 },
    {},
    async (_jobs, _source, _provider, _company, isActive) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (isActive()) lateProcessorMutations++;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(processingTimedOut.errors, 1);
  assert.equal(lateProcessorMutations, 0);
  pass('a timeout invalidates work already waiting inside the shared processor');

  let activeTotal = 0;
  let maxTotal = 0;
  const activeByHost = new Map();
  const maxByHost = new Map();
  const cappedProvider = (id) => ({
    id,
    detect: () => ({ url: 'mock' }),
    async fetch(entry) {
      const host = new URL(entry.careers_url).hostname;
      activeTotal++;
      maxTotal = Math.max(maxTotal, activeTotal);
      const active = (activeByHost.get(host) || 0) + 1;
      activeByHost.set(host, active);
      maxByHost.set(host, Math.max(maxByHost.get(host) || 0, active));
      await new Promise((resolve) => setTimeout(resolve, 15));
      activeByHost.set(host, activeByHost.get(host) - 1);
      activeTotal--;
      return [];
    },
  });
  const concurrencySeeds = [
    ...Array.from({ length: 10 }, (_, i) => ({ company: `GH ${i}`, vendor: 'greenhouse', careersUrl: `https://job-boards.greenhouse.io/gh-${i}` })),
    ...Array.from({ length: 10 }, (_, i) => ({ company: `Lever ${i}`, vendor: 'lever', careersUrl: `https://jobs.lever.co/lever-${i}` })),
  ];
  await runHistorySeedScan(
    concurrencySeeds,
    new Map([['greenhouse', cappedProvider('greenhouse')], ['lever', cappedProvider('lever')]]),
    { atsExplicit: false, ats: [], limit: Infinity, shuffle: false, verbose: false },
    {},
    async () => {},
  );
  assert.ok([...maxByHost.values()].every((peak) => peak <= 6), `per-host peaks: ${JSON.stringify([...maxByHost])}`);
  assert.ok(maxTotal > 6, `different hosts should still overlap; peak was ${maxTotal}`);
  pass('history scanning caps each shared provider host at six while different hosts overlap');

  let pendingActive = 0;
  let pendingPeak = 0;
  const pendingProvider = {
    id: 'lever',
    detect: () => ({ url: 'mock' }),
    async fetch() {
      pendingActive++;
      pendingPeak = Math.max(pendingPeak, pendingActive);
      await new Promise((resolve) => setTimeout(resolve, 30));
      pendingActive--;
      return [];
    },
  };
  const pendingTimeoutRun = await runHistorySeedScan(
    Array.from({ length: 12 }, (_, i) => ({
      company: `Pending ${i}`,
      vendor: 'lever',
      careersUrl: `https://jobs.lever.co/pending-${i}`,
    })),
    new Map([['lever', pendingProvider]]),
    { atsExplicit: false, ats: [], limit: Infinity, shuffle: false, verbose: false, companyTimeoutMs: 5 },
    {},
    async () => {},
  );
  assert.equal(pendingTimeoutRun.errors, 12);
  assert.equal(pendingPeak, 6, 'timed-out but unsettled fetches must keep occupying their host slots');
  pass('pending fetches retain the host cap after their outer timeout fires');

  let foreverActive = 0;
  let foreverPeak = 0;
  const neverSettlesProvider = {
    id: 'lever',
    detect: () => ({ url: 'mock' }),
    async fetch() {
      foreverActive++;
      foreverPeak = Math.max(foreverPeak, foreverActive);
      return new Promise(() => {});
    },
  };
  const foreverRun = await Promise.race([
    runHistorySeedScan(
      Array.from({ length: 12 }, (_, i) => ({
        company: `Forever ${i}`,
        vendor: 'lever',
        careersUrl: `https://jobs.lever.co/forever-${i}`,
      })),
      new Map([['lever', neverSettlesProvider]]),
      { atsExplicit: false, ats: [], limit: Infinity, shuffle: false, verbose: false, companyTimeoutMs: 5 },
      {},
      async () => {},
    ),
    new Promise((_, reject) => setTimeout(() => reject(new Error('history scan remained stuck on pending fetches')), 250)),
  ]);
  assert.equal(foreverRun.errors, 12, 'timed-out and quarantined boards must all be reported as errors');
  assert.equal(foreverPeak, 6, 'a quarantined host must not replace its six permanently pending requests');
  pass('a permanently pending provider cannot hang the sweep or exceed the per-host cap');
} catch (error) {
  fail(`ATS history seed regression: ${error.stack || error.message}`);
}
