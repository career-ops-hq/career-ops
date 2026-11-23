import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { boardOfPosting, knownBoards } from '../confirm-at-employer.mjs';
import { loadProviders, resolveProvider } from '../providers/_registry.mjs';

const HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\tfingerprint\tposted_at\ttrust_score\ttrust_flags\tnormalized_company\n';

test('boardOfPosting maps myworkdaysite.com postings to their /recruiting/ board URL', () => {
  assert.equal(
    boardOfPosting('https://wd5.myworkdaysite.com/recruiting/guidewire/external/job/India---Bangalore/Staff-Product-Security-Engineer_JR_15441'),
    'https://wd5.myworkdaysite.com/recruiting/guidewire/external',
  );
  assert.equal(
    boardOfPosting('https://wd5.myworkdaysite.com/en-US/recruiting/Guidewire/external/job/Remote/Engineer_R1'),
    'https://wd5.myworkdaysite.com/recruiting/guidewire/external',
  );
  assert.equal(
    boardOfPosting('https://acme.wd5.myworkdayjobs.com/en-US/External/job/Remote/Engineer_R1'),
    'https://acme.wd5.myworkdayjobs.com/External',
  );
});

test('boardOfPosting resolves BambooHR, Breezy, Pinpoint, Rippling, HiBob, HireHive, and Zoho Recruit boards', async () => {
  const cases = [
    ['https://acme.bamboohr.com/careers/42', 'https://acme.bamboohr.com', 'bamboohr'],
    ['https://acme.breezy.hr/p/abc123-engineer', 'https://acme.breezy.hr', 'breezy'],
    ['https://acme.pinpointhq.com/en/postings/11111111-2222-3333-4444-555555555555', 'https://acme.pinpointhq.com', 'pinpoint'],
    ['https://ats.rippling.com/acme/jobs/11111111-2222-3333-4444-555555555555', 'https://ats.rippling.com/acme/jobs', 'rippling'],
    ['https://ats.rippling.com/acme-jobs/jobs/123', 'https://ats.rippling.com/acme-jobs/jobs', 'rippling'],
    ['https://acme.careers.hibob.com/jobs/11111111-2222-3333-4444-555555555555', 'https://acme.careers.hibob.com/jobs', 'hibob'],
    ['https://acme.hirehive.com/senior-engineer-abc123', 'https://acme.hirehive.com', 'hirehive'],
    ['https://acme.zohorecruit.eu/jobs/Careers/100000000001853029', 'https://acme.zohorecruit.eu/jobs/Careers', 'zoho-recruit'],
  ];

  const providers = await loadProviders(fileURLToPath(new URL('../providers', import.meta.url)));
  for (const [postingUrl, expectedBoard, expectedProvider] of cases) {
    const board = boardOfPosting(postingUrl);
    assert.equal(board, expectedBoard, postingUrl);
    const resolved = resolveProvider({ name: 'Acme', careers_url: board }, providers, { skipIds: ['local-parser'] });
    assert.equal(resolved?.provider?.id, expectedProvider, `board ${board} should resolve to ${expectedProvider}`);
  }
});

test('boardOfPosting rejects vendor non-tenant hosts, nested subdomains, and non-HTTPS fallback URLs', () => {
  for (const url of [
    'https://www.recruitee.com/pricing',
    'https://app.recruitee.com/dashboard',
    'https://foo.bar.recruitee.com/o/pm',
    'ftp://acme.recruitee.com/o/pm',
    'https://www.bamboohr.com/pricing',
    'https://foo.bar.bamboohr.com/careers/42',
    'https://www.breezy.hr/pricing',
    'https://www.pinpointhq.com/features',
    'https://ats.rippling.com/api/v2/health',
    'https://ats.rippling.com/acme.inc/jobs/123',
    'https://ats.rippling.com/acme_inc/jobs/123',
    'https://ats.rippling.com/-acme/jobs/123',
    'http://acme.jobs.personio.de/job/123',
    'ftp://join.com/companies/acme/1',
  ]) {
    assert.equal(boardOfPosting(url), '', url);
  }
});

test('knownBoards recovers myworkdaysite.com and BambooHR boards from scan history', () => {
  const historyText = HEADER
    + 'https://wd5.myworkdaysite.com/recruiting/guidewire/external/job/Remote/Engineer_R1\t2026-11-01\tworkday\tEngineer\tGuidewire\tadded\t\t\t\t\t\tguidewire\n'
    + 'https://acme.bamboohr.com/careers/42\t2026-11-01\tbamboohr\tPM\tAcme\tadded\t\t\t\t\t\tacme\n';

  assert.deepEqual(
    knownBoards('Guidewire', { historyText }),
    ['https://wd5.myworkdaysite.com/recruiting/guidewire/external'],
  );
  assert.deepEqual(
    knownBoards('Acme', { historyText }),
    ['https://acme.bamboohr.com'],
  );
});
