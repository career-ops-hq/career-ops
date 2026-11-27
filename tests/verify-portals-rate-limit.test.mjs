import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFetchError, printResults, verifyCompanies } from '../verify-portals.mjs';
import { computePortalRecommendations } from '../stats.mjs';

const rateLimit = () => Object.assign(new Error('HTTP 429'), { status: 429 });

test('classifyFetchError names HTTP 429 as a rate limit', () => {
  assert.equal(classifyFetchError({ status: 429 }), 'rate_limit');
  assert.equal(classifyFetchError(rateLimit()), 'rate_limit');
  assert.equal(classifyFetchError(new Error('HTTP 429 Too Many Requests')), 'rate_limit');
  assert.equal(classifyFetchError({ status: 404 }), 'slug_gone');
  assert.equal(classifyFetchError({ status: 503 }), 'server');
});

test('a rate-limited board is not reported as a healthy empty board', async () => {
  const fetchJson = async (url) => {
    if (String(url).includes('/fixtureco')) throw rateLimit();
    return [];
  };
  const fetchText = async () => '<title>Fixture Co jobs</title>';
  const [row] = await verifyCompanies(
    [{ name: 'Fixture Co', careers_url: 'https://jobs.lever.co/fixtureco' }],
    { fetchJson, fetchText },
  );
  assert.equal(row.status, 'missing');
  assert.equal(row.errorKind, 'rate_limit');
  assert.equal(row.suggested, undefined);

  const lines = [];
  const log = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    printResults([row]);
  } finally {
    console.log = log;
  }
  const printed = lines.join('\n');
  assert.match(printed, /rate limited/);
  assert.doesNotMatch(printed, /live but empty/);
});

test('a real empty board stays empty', async () => {
  const [row] = await verifyCompanies(
    [{ name: 'Fixture Co', careers_url: 'https://jobs.lever.co/fixtureco' }],
    { fetchJson: async () => [] },
  );
  assert.equal(row.status, 'empty');
  assert.equal(row.jobCount, 0);
});

test('repeated rate limits count as failures, not as a quiet empty board', () => {
  const now = Date.parse('2026-09-22T12:00:00Z');
  const config = 'tracked_companies:\n  - {name: Fixture Co}\n';
  const scan = 'https://jobs.example.com/1\t2026-07-01\tats\tEngineer\tFixture Co\tadded\n';
  const days = ['2026-09-20', '2026-09-21', '2026-09-22'];
  const limited = days.map((day) => `${day}\tFixture Co\trate_limit`).join('\n');
  const empty = days.map((day) => `${day}\tFixture Co\tempty`).join('\n');
  const limitedResult = computePortalRecommendations(config, scan, limited, now);
  const emptyResult = computePortalRecommendations(config, scan, empty, now);
  assert.deepEqual(limitedResult.rotted.map((row) => row.company), ['Fixture Co']);
  assert.match(limitedResult.rotted[0].recommendation, /reduce request frequency/);
  assert.doesNotMatch(limitedResult.rotted[0].recommendation, /ATS slug/);
  assert.deepEqual(limitedResult.healthyButQuiet, []);
  assert.deepEqual(emptyResult.rotted, []);
  assert.deepEqual(emptyResult.healthyButQuiet.map((row) => row.company), ['Fixture Co']);
});

test('unverified_zero counts in the failure streak', () => {
  const now = Date.parse('2026-09-22T12:00:00Z');
  const config = 'tracked_companies:\n  - {name: Fixture Co}\n';
  const scan = 'https://jobs.example.com/1\t2026-07-01\tats\tEngineer\tFixture Co\tadded\n';
  const mixed = [
    '2026-09-20\tFixture Co\trate_limit',
    '2026-09-21\tFixture Co\tunverified_zero',
    '2026-09-22\tFixture Co\trate_limit',
  ].join('\n');
  const onlyZero = [
    '2026-09-20\tFixture Co\tunverified_zero',
    '2026-09-21\tFixture Co\tunverified_zero',
    '2026-09-22\tFixture Co\tunverified_zero',
  ].join('\n');
  const mixedResult = computePortalRecommendations(config, scan, mixed, now);
  const zeroResult = computePortalRecommendations(config, scan, onlyZero, now);
  assert.deepEqual(mixedResult.rotted.map((row) => row.company), ['Fixture Co']);
  assert.equal(mixedResult.rotted[0].streak, 3);
  assert.match(mixedResult.rotted[0].recommendation, /reduce request frequency/);
  assert.deepEqual(zeroResult.rotted.map((row) => row.company), ['Fixture Co']);
  assert.match(zeroResult.rotted[0].recommendation, /ATS slug/);
});
