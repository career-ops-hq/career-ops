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
    ['https://careers.example.com/jobs/1', 'careers.example.com'],
    ['https://evil.example/https://jobs.lever.co/acme', 'evil.example'],
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
  pass('posting URLs collapse to provider-compatible board URLs without query or fragment data');

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
