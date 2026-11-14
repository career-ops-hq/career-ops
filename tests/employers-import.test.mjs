// tests/employers-import.test.mjs: the public importer of the employer
// registry, seeds/employers-import.mjs, which turns a list of board URLs into
// employers/inbox/ files.
//
// The core is parseBoardUrl(), the reverse of the builders in
// lib/ats-board-url.mjs: every committed row's careers_url must read back to
// that row's coordinates, each ATS's other URL shapes (job links, legacy hosts,
// locale prefixes) must read back to their board, and anything else must be
// rejected with a reason. Then the list reader, the 5,000-line split, and the
// command from a list to an inbox the validator accepts.
//
// Run:  node --test tests/employers-import.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, copyEmployerRegistry, unlistedEmployerBoard } from './helpers.mjs';

import { BOARD_ATS, buildBoardUrl } from '../lib/ats-board-url.mjs';
import {
  chunkInbox, importList, nameFromBoard, normalizeWebsite, parseBoardUrl, parseCsv, readList,
} from '../seeds/employers-import.mjs';
import { inboxCareersUrl } from '../seeds/employers-inbox.mjs';
import { inboxLineProblems } from '../seeds/employers-validate.mjs';
import applicantpro from '../providers/applicantpro.mjs';
import homerun from '../providers/homerun.mjs';

const IMPORTER = join(ROOT, 'seeds', 'employers-import.mjs');
const VALIDATOR = join(ROOT, 'seeds', 'employers-validate.mjs');
const { GITHUB_ACTIONS: _ga, GITHUB_STEP_SUMMARY: _gss, ...PLAIN_ENV } = process.env;
const node = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: PLAIN_ENV });

/** Every committed row. */
function committedRows() {
  const out = [];
  const dir = join(ROOT, 'employers', 'boards');
  for (const ats of readdirSync(dir)) {
    for (const f of readdirSync(join(dir, ats))) {
      for (const l of readFileSync(join(dir, ats, f), 'utf8').split('\n').filter(Boolean)) out.push(JSON.parse(l));
    }
  }
  return out;
}
const coordsOf = (row) => {
  const c = { ats: row.ats };
  if (row.region !== undefined) c.region = row.region;
  c.board = row.board;
  if (row.workday_host !== undefined) c.workday_host = row.workday_host;
  return c;
};

// ── parseBoardUrl ────────────────────────────────────────────────────────

test('every committed careers_url reads back to its row, unchanged', () => {
  const rows = committedRows();
  assert.ok(rows.length >= 50, `expected the committed boards, found ${rows.length}`);
  for (const row of rows) {
    assert.deepEqual(parseBoardUrl(row.careers_url), { ...coordsOf(row), careers_url: row.careers_url }, row.careers_url);
  }
});

test('every ATS, region and Workday host form round-trips through its builder', () => {
  const samples = [
    { ats: 'greenhouse', region: 'us', board: 'acme' },
    { ats: 'greenhouse', region: 'eu', board: 'acme' },
    { ats: 'lever', region: 'us', board: 'acme' },
    { ats: 'lever', region: 'eu', board: 'acme' },
    { ats: 'ashby', board: 'AcmeLabs' },
    { ats: 'workable', board: 'acme_co' },
    { ats: 'smartrecruiters', board: 'AcmeGroup' },
    { ats: 'rippling', board: 'acme-inc' },
    { ats: 'join', board: 'acme' },
    { ats: 'recruitee', board: 'acme' },
    { ats: 'breezy', board: 'acme' },
    { ats: 'bamboohr', board: 'acme' },
    { ats: 'pinpoint', board: 'acme' },
    { ats: 'applicantpro', board: 'acme' },
    { ats: 'hibob', board: 'acme-641e1b39232b' },
    { ats: 'hirehive', board: 'acme' },
    { ats: 'homerun', board: 'acme' },
    { ats: 'jazzhr', board: 'acme' },
    { ats: 'keka', board: 'acme' },
    { ats: 'personio', board: 'acme-gmbh' },
    { ats: 'personio', region: 'com', board: 'acme-gmbh' },
    { ats: 'prevueaps', board: 'acme' },
    { ats: 'schoolspring', board: 'acme' },
    { ats: 'taleez', board: 'acme' },
    { ats: 'teamtailor', board: 'acme' },
    { ats: 'trakstar', board: 'acme' },
    { ats: 'turbohire', board: 'acme' },
    { ats: 'zoho-recruit', board: 'acme' },
    { ats: 'zoho-recruit', region: 'au', board: 'acme' },
    { ats: 'zoho-recruit', region: 'ca', board: 'acme' },
    { ats: 'zoho-recruit', region: 'cn', board: 'acme' },
    { ats: 'zoho-recruit', region: 'eu', board: 'acme' },
    { ats: 'zoho-recruit', region: 'in', board: 'acme' },
    { ats: 'zoho-recruit', region: 'jp', board: 'acme' },
    { ats: 'zoho-recruit', region: 'sa', board: 'acme' },
    { ats: 'workday', board: 'acme/wd5/External_Careers', workday_host: 'jobs' },
    { ats: 'workday', board: 'acme/wd103/Careers', workday_host: 'site' },
  ];
  assert.deepEqual([...new Set(samples.map((s) => s.ats))].sort(), [...BOARD_ATS].sort(), 'one sample per ATS at least');
  for (const c of samples) {
    const url = buildBoardUrl(c);
    assert.deepEqual(parseBoardUrl(url), { ...c, careers_url: url }, url);
  }
});

const VARIANTS = [
  // Workday
  ['https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Engineer_JR1', { ats: 'workday', board: 'nvidia/wd5/NVIDIAExternalCareerSite', workday_host: 'jobs' }],
  ['https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs', { ats: 'workday', board: 'nvidia/wd5/NVIDIAExternalCareerSite', workday_host: 'jobs' }],
  ['https://CrowdStrike.wd5.myworkdayjobs.com/crowdstrikecareers?q=x', { ats: 'workday', board: 'crowdstrike/wd5/crowdstrikecareers', workday_host: 'jobs' }],
  ['https://wd5.myworkdaysite.com/en-US/recruiting/Guidewire/external/job/Remote/Engineer_R1', { ats: 'workday', board: 'guidewire/wd5/external', workday_host: 'site' }],
  // Greenhouse
  ['https://boards.greenhouse.io/anthropic/jobs/4020305008', { ats: 'greenhouse', region: 'us', board: 'anthropic' }],
  ['https://boards.greenhouse.io/embed/job_board?for=vercel', { ats: 'greenhouse', region: 'us', board: 'vercel' }],
  ['http://job-boards.greenhouse.io/airtable/', { ats: 'greenhouse', region: 'us', board: 'airtable' }],
  ['https://boards.eu.greenhouse.io/eucorp', { ats: 'greenhouse', region: 'eu', board: 'eucorp' }],
  ['job-boards.greenhouse.io/stripe#app', { ats: 'greenhouse', region: 'us', board: 'stripe' }],
  // Lever
  ['https://jobs.lever.co/palantir/1d2c3b4a-aaaa-bbbb-cccc-1234567890ab/apply', { ats: 'lever', region: 'us', board: 'palantir' }],
  ['https://jobs.eu.lever.co/eurocorp?team=Eng', { ats: 'lever', region: 'eu', board: 'eurocorp' }],
  // Ashby
  ['https://jobs.ashbyhq.com/DeepL/8e2a-uuid', { ats: 'ashby', board: 'DeepL' }],
  ['jobs.ashbyhq.com/linear', { ats: 'ashby', board: 'linear' }],
  // The rest
  ['https://apply.workable.com/huggingface/j/ABC123/', { ats: 'workable', board: 'huggingface' }],
  ['https://jobs.smartrecruiters.com/Foo/7430000-engineer', { ats: 'smartrecruiters', board: 'Foo' }],
  ['https://ats.rippling.com/acme-inc/jobs/123', { ats: 'rippling', board: 'acme-inc' }],
  ['https://join.com/companies/acme/123-dev', { ats: 'join', board: 'acme' }],
  ['https://Acme.Recruitee.com/o/dev', { ats: 'recruitee', board: 'acme' }],
  ['https://acme.breezy.hr/p/abc', { ats: 'breezy', board: 'acme' }],
  ['https://acme.bamboohr.com/careers/12', { ats: 'bamboohr', board: 'acme' }],
  ['https://acme.pinpointhq.com/postings/1', { ats: 'pinpoint', board: 'acme' }],
  ['https://acme.applicantpro.com/jobs/3456789', { ats: 'applicantpro', board: 'acme' }],
  ['https://www.applicantpro.com/openings/acme/jobs/3456789', { ats: 'applicantpro', board: 'acme' }],
  ['https://www.applicantpro.com/OPENINGS/Acme/jobs/3456789', { ats: 'applicantpro', board: 'acme' }],
  ['https://acme-641e1b39232b.careers.hibob.com/jobs/2f9c1d1e-0000-4000-8000-000000000000/apply', { ats: 'hibob', board: 'acme-641e1b39232b' }],
  ['https://acme.hirehive.com/backend-engineer-x1y2z3', { ats: 'hirehive', board: 'acme' }],
  ['https://acme.homerun.co/backend-engineer', { ats: 'homerun', board: 'acme' }],
  ['https://feed.homerun.co/Acme', { ats: 'homerun', board: 'acme' }],
  ['https://acme.applytojob.com/apply/AbC123/Backend-Engineer', { ats: 'jazzhr', board: 'acme' }],
  ['https://acme.keka.com/careers/jobdetails/12345', { ats: 'keka', board: 'acme' }],
  ['https://acme-gmbh.jobs.personio.de/job/123456?language=en', { ats: 'personio', board: 'acme-gmbh' }],
  ['https://ACME-GMBH.jobs.personio.com/', { ats: 'personio', region: 'com', board: 'acme-gmbh' }],
  ['https://acme-gmbh.jobs.personio.com/job/123456?language=de', { ats: 'personio', region: 'com', board: 'acme-gmbh' }],
  ['https://acme.prevueaps.ca/jobs/1234/backend-engineer', { ats: 'prevueaps', board: 'acme' }],
  ['https://acme.schoolspring.com/job?id=1', { ats: 'schoolspring', board: 'acme' }],
  ['https://Acme.taleez.com/', { ats: 'taleez', board: 'acme' }],
  ['https://acme.teamtailor.com/jobs/12345-backend-engineer', { ats: 'teamtailor', board: 'acme' }],
  ['https://acme.hire.trakstar.com/jobs/fk0abcd', { ats: 'trakstar', board: 'acme' }],
  ['https://acme.recruiterbox.com/jobs/fk0abcd', { ats: 'trakstar', board: 'acme' }],
  ['https://acme.turbohire.co/job/publicjobs/abc', { ats: 'turbohire', board: 'acme' }],
  ['https://acme.zohorecruit.com/jobs/Careers/1234000000001/Backend-Engineer', { ats: 'zoho-recruit', board: 'acme' }],
  ['https://acme.zohorecruit.eu/jobs/Emplois', { ats: 'zoho-recruit', region: 'eu', board: 'acme' }],
  ['https://Acme.ZohoRecruit.com.au/recruit/Portal.na', { ats: 'zoho-recruit', region: 'au', board: 'acme' }],
  ['acme.zohorecruit.in', { ats: 'zoho-recruit', region: 'in', board: 'acme' }],
];

for (const [url, coords] of VARIANTS) {
  test(`reads ${url} back to its board`, () => {
    assert.deepEqual(parseBoardUrl(url), { ...coords, careers_url: buildBoardUrl(coords) });
  });
}

const REJECTS = [
  ['', /no URL/],
  ['not a url', /no spaces/],
  ['ftp://jobs.lever.co/acme', /not a web URL/],
  ['https://user:pw@jobs.lever.co/acme', /user name or password/],
  ['https://jobs.lever.co:8443/acme', /port/],
  ['https://www.linkedin.com/company/acme', /not a board host of a supported ATS/],
  ['https://example.com/careers', /not a board host/],
  ['https://acme.wd5.myworkday.com/acme/d/home.htmld', /not a board host/],
  ['https://boards.greenhouse.io/', /without a board id/],
  ['https://boards.greenhouse.io/embed/job_board', /without a board id/],
  ['https://jobs.lever.co/12345', /numeric-only/],
  ['https://jobs.ashbyhq.com/jobs', /placeholder/],
  ['https://apply.workable.com/j/ABC123', /does not name the company/],
  ['https://join.com/jobs/123', /join\.com\/companies/],
  ['https://app.recruitee.com/', /own site/],
  ['https://eu.acme.breezy.hr/', /the board is <company>\.breezy\.hr/],
  ['https://acme.wd5.myworkdayjobs.com/', /without a site/],
  ['https://acme.wd5.myworkdayjobs.com/en-US', /is a locale/],
  ['https://wd5.myworkdaysite.com/acme/careers', /recruiting\/<tenant>\/<site>/],
  ['https://jobs.ashbyhq.com/acme%20inc', /characters outside/],
  ['https://www.teamtailor.com/en', /"www" is a placeholder/],
  ['https://acme.na.teamtailor.com/jobs/1', /the board is <company>\.teamtailor\.com/],
  ['https://acme.eu.jobs.personio.de/', /the board is <company>\.jobs\.personio\.de/],
  ['https://jobs.personio.de/', /not a board host/],
  ['https://feeds.applicantpro.com/', /"feeds" is one of applicantpro's own subdomains/],
  ['https://accounts.hirehive.com/login', /"accounts" is one of hirehive's own subdomains/],
  ['https://feed.homerun.co/', /feed\.homerun\.co\/<company>/],
  ['https://static.homerun.co/app.js', /"static" is one of homerun's own subdomains/],
  ['https://mail.keka.com/', /"mail" is one of keka's own subdomains/],
  // Trakstar's API names the client in a query, but it is the API, not a board
  // address: only <id>.hire.trakstar.com and <id>.recruiterbox.com are read.
  ['https://jsapi.recruiterbox.com/v1/openings?client_name=acme', /"jsapi" is one of trakstar's own subdomains/],
  // The provider reads www.applicantpro.com/openings/…, not the bare domain.
  ['https://applicantpro.com/openings/acme/jobs/1', /not a board host/],
  ['https://aide.taleez.com/', /"aide" is one of taleez's own subdomains/],
  ['https://taleez.com/apply/backend-engineer-abc', /does not name the company/],
  ['https://app.turbohire.co/', /"app" is one of turbohire's own subdomains/],
  ['https://www.zohorecruit.com/', /"www" is a placeholder/],
  ['https://acme.personio.de/', /not a board host/],
  [`https://${'a'.repeat(64)}.teamtailor.com/`, /at most 63 characters/],
  ['https://acme.zohorecruit.de/jobs/Careers', /not a board host/],
  ['https://acme.portal.zohorecruit.eu/', /the board is <company>\.zohorecruit\.eu/],
  ['https://12345.teamtailor.com/', /numeric-only/],
];

for (const [url, why] of REJECTS) {
  test(`rejects ${JSON.stringify(url)}`, () => {
    const r = parseBoardUrl(url);
    assert.ok('error' in r, JSON.stringify(r));
    assert.match(r.error, why);
  });
}

// The aliases are read from the path the way their providers read it: an empty
// segment is not skipped, so a URL the provider refuses is refused here too.
const ALIAS_PROVIDERS = { homerun, applicantpro };
const ALIASES = [
  ['https://feed.homerun.co/acme', 'homerun', 'acme'],
  ['https://www.applicantpro.com/openings/acme/jobs/1', 'applicantpro', 'acme'],
  ['https://www.applicantpro.com/Openings/Acme', 'applicantpro', 'acme'],
  ['https://feed.homerun.co//acme', 'homerun', null],
  ['https://www.applicantpro.com//openings/acme/jobs/1', 'applicantpro', null],
  ['https://www.applicantpro.com/openings//acme/jobs/1', 'applicantpro', null],
];
for (const [url, ats, board] of ALIASES) {
  test(`${url}: ${board ? `board ${board}` : 'refused'}, as the ${ats} provider reads it`, () => {
    const parsed = parseBoardUrl(url);
    const detected = ALIAS_PROVIDERS[ats].detect({ name: 'Acme', careers_url: url });
    if (board) {
      assert.equal(parsed.board, board, JSON.stringify(parsed));
      assert.ok(detected, `${ats}.detect() refuses ${url}`);
    } else {
      assert.ok('error' in parsed, JSON.stringify(parsed));
      assert.equal(detected, null, `${ats}.detect() reads ${url}`);
    }
  });
}

// ── The list ─────────────────────────────────────────────────────────────

test('parseCsv: quotes, doubled quotes, commas and line breaks inside quotes, CRLF and a BOM', () => {
  assert.deepEqual(parseCsv('﻿url,name\r\n"https://x.example/a","Acme, Inc."\r\n\r\nb,"He said ""hi""\nthere"\nlast'), [
    { line: 1, cells: ['url', 'name'] },
    { line: 2, cells: ['https://x.example/a', 'Acme, Inc.'] },
    { line: 4, cells: ['b', 'He said "hi"\nthere'] },
    { line: 6, cells: ['last'] },
  ]);
});

test('readList: a header picks the url, name and website columns and ignores the rest', () => {
  const r = readList('Company,Careers URL,Domain,Headcount\nAcme,https://jobs.lever.co/acme,acme.example,40\n# a comment\n,,,\n');
  assert.equal(r.header, true);
  assert.deepEqual(r.ignoredColumns, ['Headcount']);
  assert.deepEqual(r.entries, [{ line: 2, url: 'https://jobs.lever.co/acme', name: 'Acme', website: 'acme.example' }]);
});

test('readList: without a header, a plain URL per line, optionally ,name,website', () => {
  const r = readList('https://jobs.lever.co/acme\nhttps://jobs.ashbyhq.com/beta, Beta Labs ,beta.example\n');
  assert.equal(r.header, false);
  assert.deepEqual(r.entries, [
    { line: 1, url: 'https://jobs.lever.co/acme', name: '', website: '' },
    { line: 2, url: 'https://jobs.ashbyhq.com/beta', name: 'Beta Labs', website: 'beta.example' },
  ]);
});

test('nameFromBoard and normalizeWebsite', () => {
  assert.equal(nameFromBoard({ ats: 'lever', board: 'acme-robotics' }), 'Acme Robotics');
  assert.equal(nameFromBoard({ ats: 'ashby', board: 'DeepL' }), 'DeepL');
  assert.equal(nameFromBoard({ ats: 'workday', board: 'nvidia/wd5/NVIDIAExternalCareerSite' }), 'Nvidia');
  assert.equal(normalizeWebsite(' https://WWW.Acme.example:443/about?x=1 '), 'acme.example');
  assert.equal(normalizeWebsite('acme.example.'), 'acme.example');
  assert.equal(normalizeWebsite(''), '');
});

test('importList: canonical inbox lines, every default written out; duplicates and bad cells rejected with the line', () => {
  const r = importList([
    'url,name,website',
    'https://boards.greenhouse.io/acme/jobs/1,Acme,https://www.acme.example/',
    'https://job-boards.greenhouse.io/ACME,Acme again,',
    'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite,NVIDIA,',
    'https://jobs.lever.co/beta,Beta jane@beta.example,',
    'https://jobs.lever.co/gamma,Gamma,not a domain',
    'https://jobs.lever.co/delta,,',
    'https://indeed.com/cmp/acme,Acme,',
  ].join('\n'), { aggregatorDomains: new Set() });
  assert.deepEqual(r.lines, [
    { ats: 'greenhouse', region: 'us', board: 'acme', name: 'Acme', website: 'acme.example' },
    { ats: 'workday', board: 'nvidia/wd5/NVIDIAExternalCareerSite', workday_host: 'jobs', name: 'NVIDIA' },
    { ats: 'lever', region: 'us', board: 'delta', name: 'Delta' },
  ]);
  assert.deepEqual(r.rejected.map((x) => [x.line, x.reason.split(';')[0]]), [
    [3, 'the same board as line 2'],
    [5, 'name contains an email address'],
    [6, 'website "not a domain" is not a domain name'],
    [8, 'indeed.com is not a board host of a supported ATS (greenhouse, ashby, lever, workable, smartrecruiters, rippling, join, recruitee, breezy, bamboohr, pinpoint, applicantpro, hibob, hirehive, homerun, jazzhr, keka, personio, prevueaps, schoolspring, taleez, teamtailor, trakstar, turbohire, zoho-recruit, workday)'],
  ]);
  assert.equal(r.derivedNames, 1);
  assert.equal(r.rewritten, 2);
  for (const line of r.lines) {
    assert.deepEqual(inboxLineProblems(line, new Set()), []);
    assert.ok(inboxCareersUrl(line));
  }
});

test('importList: a Personio or Zoho Recruit region is written only off the default host; an alias host is a duplicate', () => {
  const r = importList([
    'https://acme.zohorecruit.com/jobs/Careers',
    'https://acme.zohorecruit.eu/jobs/Careers',
    'https://ACME.zohorecruit.com/jobs/Careers/123/Engineer',
    'https://acme-gmbh.jobs.personio.de/',
    'https://acme-gmbh.jobs.personio.com/job/1',
    'https://acme.hire.trakstar.com/',
    'https://acme.recruiterbox.com/jobs/2',
    'https://feed.homerun.co/acme',
    'https://acme.homerun.co/',
  ].join('\n'), { aggregatorDomains: new Set() });
  assert.deepEqual(r.lines, [
    { ats: 'zoho-recruit', board: 'acme', name: 'Acme' },
    { ats: 'zoho-recruit', region: 'eu', board: 'acme', name: 'Acme' },
    { ats: 'personio', board: 'acme-gmbh', name: 'Acme Gmbh' },
    { ats: 'personio', region: 'com', board: 'acme-gmbh', name: 'Acme Gmbh' },
    { ats: 'trakstar', board: 'acme', name: 'Acme' },
    { ats: 'homerun', board: 'acme', name: 'Acme' },
  ]);
  // Personio's .de and .com hosts are two boards; Trakstar's and Homerun's other addresses are the same board.
  assert.deepEqual(r.rejected.map((x) => [x.line, x.reason]), [
    [3, 'the same board as line 1'],
    [7, 'the same board as line 6'],
    [9, 'the same board as line 8'],
  ]);
  assert.deepEqual(r.lines.map((l) => inboxCareersUrl(l)), [
    'https://acme.zohorecruit.com/jobs/Careers',
    'https://acme.zohorecruit.eu/jobs/Careers',
    'https://acme-gmbh.jobs.personio.de',
    'https://acme-gmbh.jobs.personio.com',
    'https://acme.hire.trakstar.com',
    'https://acme.homerun.co',
  ]);
  for (const line of r.lines) assert.deepEqual(inboxLineProblems(line, new Set()), []);
});

test('chunkInbox: one file up to 5,000 lines, then numbered parts', () => {
  const lines = (n) => Array.from({ length: n }, (_, i) => i);
  assert.deepEqual(chunkInbox([], 'id'), []);
  assert.deepEqual(chunkInbox(lines(5000), 'id').map((c) => [c.name, c.lines.length]), [['id.ndjson', 5000]]);
  assert.deepEqual(chunkInbox(lines(12001), 'id').map((c) => [c.name, c.lines.length]),
    [['id-001.ndjson', 5000], ['id-002.ndjson', 5000], ['id-003.ndjson', 2001]]);
});

// ── The command, from a list to an inbox the validator accepts ─────────────

function checkout() {
  const dir = mkdtempSync(join(tmpdir(), 'co-employers-import-'));
  copyEmployerRegistry(dir);
  return dir;
}

test('CLI: the committed boards and new ones become an inbox the validator accepts, known boards as a warning', () => {
  const dir = checkout();
  try {
    const known = committedRows().map((r) => r.careers_url);
    const list = join(dir, 'list.txt');
    writeFileSync(list, [...known, `https://jobs.lever.co/${unlistedEmployerBoard('lever', 'newco-one')}`, 'https://nope.example/jobs', ''].join('\n'));
    const r = node(IMPORTER, [list, '--login', 'OctoCat', '--date', '2026-11-10'], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`wrote ${known.length + 1} board\\(s\\) in 1 file\\(s\\)`));
    const inbox = join(dir, 'employers', 'inbox', '2026-11-10-octocat.ndjson');
    assert.equal(readFileSync(inbox, 'utf8').split('\n').filter(Boolean).length, known.length + 1);
    assert.equal(readFileSync(`${list}.rejected.csv`, 'utf8'), 'line,input,reason\n'
      + `${known.length + 2},https://nope.example/jobs,`
      + '"nope.example is not a board host of a supported ATS (greenhouse, ashby, lever, workable, smartrecruiters, rippling, join, recruitee, breezy, bamboohr, pinpoint, applicantpro, hibob, hirehive, homerun, jazzhr, keka, personio, prevueaps, schoolspring, taleez, teamtailor, trakstar, turbohire, zoho-recruit, workday)"\n');

    const v = node(VALIDATOR, [], dir);
    assert.equal(v.status, 0, v.stderr);
    assert.match(v.stderr, new RegExp(`warning: employers/inbox/2026-11-10-octocat.ndjson:1: ${known.length} boards are already in the registry`));
    assert.equal(v.stderr.trim().split('\n').length, 1, 'one warning, nothing else');

    // A second run for the same contribution does not overwrite it.
    const again = node(IMPORTER, [list, '--login', 'octocat', '--date', '2026-11-10'], dir);
    assert.equal(again.status, 2);
    assert.match(again.stderr, /already has files for 2026-11-10-octocat/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: more than 5,000 boards are split into parts that pass the validator', () => {
  const dir = checkout();
  try {
    const list = join(dir, 'big.csv');
    const n = 10001;
    const boards = Array.from({ length: n }, (_, i) => `company${i}x`);
    const listed = new Set(committedRows().filter((r) => r.ats === 'ashby').map((r) => r.board.toLowerCase()));
    writeFileSync(list, `url,name\n${boards.map((b, i) => `https://jobs.ashbyhq.com/${b},Company ${i}`).join('\n')}\n`);
    const r = node(IMPORTER, [list, '--login', 'big-org', '--date', '2026-11-10', '--rejects', join(dir, 'rejects.csv')], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(join(dir, 'employers', 'inbox')).sort(),
      ['2026-11-10-big-org-001.ndjson', '2026-11-10-big-org-002.ndjson', '2026-11-10-big-org-003.ndjson']);
    assert.ok(!existsSync(join(dir, 'rejects.csv')), 'no rejects, no file');
    const v = node(VALIDATOR, [], dir);
    assert.equal(v.status, 0, v.stderr);
    assert.match(v.stdout, new RegExp(`inbox: ${n} board\\(s\\) in 3 file\\(s\\), ${boards.filter((b) => listed.has(b)).length} already in the registry`));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: usage errors exit 2, a list with no board exits 1', () => {
  const dir = checkout();
  try {
    const list = join(dir, 'list.txt');
    writeFileSync(list, 'https://example.com/careers\n');
    assert.equal(node(IMPORTER, [list], dir).status, 2, 'no --login');
    assert.equal(node(IMPORTER, [list, '--login', '-bad-'], dir).status, 2, 'not a login');
    assert.equal(node(IMPORTER, [list, '--login', 'octocat', '--date', '2026-02-30'], dir).status, 2, 'not a date');
    assert.equal(node(IMPORTER, [join(dir, 'missing.txt'), '--login', 'octocat'], dir).status, 2, 'no list');
    assert.equal(node(IMPORTER, [list, '--login', 'octocat', '--frobnicate'], dir).status, 2, 'unknown flag');
    const r = node(IMPORTER, [list, '--login', 'octocat', '--date', '2026-11-10'], dir);
    assert.equal(r.status, 1);
    assert.ok(!existsSync(join(dir, 'employers', 'inbox')), 'nothing written to the inbox');
    assert.match(readFileSync(`${list}.rejected.csv`, 'utf8'), /example\.com is not a board host/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
