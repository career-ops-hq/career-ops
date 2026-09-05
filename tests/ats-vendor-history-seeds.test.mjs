import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { atsVendorOf } from '../ats-vendor.mjs';
import {
  atsBoardUrlOf,
  loadHistoryAtsSeeds,
  parseScanHistoryAtsSeeds,
  parseTrackerAtsSeeds,
} from '../history-ats-seeds.mjs';
import { runHistorySeedScan } from '../scan-ats-full.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nATS vendor + user-history reverse-scan seeds (#3697)');

try {
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
    writeFileSync(join(root, 'data/scan-history.tsv'), history, 'utf-8');
    const oldTracker = process.env.CAREER_OPS_TRACKER;
    process.env.CAREER_OPS_TRACKER = trackerPath;
    try {
      const seeds = loadHistoryAtsSeeds({ dataRoot: root });
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
} catch (error) {
  fail(`ATS history seed regression: ${error.stack || error.message}`);
}
