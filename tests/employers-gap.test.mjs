// tests/employers-gap.test.mjs: employers-gap.mjs finds the boards an install
// knows that the registry does not, sets aside boards that are never public,
// and shares board addresses only.
//
// Run:  node --test tests/employers-gap.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectInstanceUrls, findGap, notPublicReason, shareList, boardsIn, loadRegistryIdentities } from '../employers-gap.mjs';

const known = new Set(['https://job-boards.greenhouse.io/vercel']);
const run = (urls, extra = {}) => findGap(urls.map((url) => ({ source: 's', url })), { known, aggregatorDomains: new Set(), ...extra });

test('a posting link counts as its board, and a board in the registry is not new', () => {
  const gap = run(['https://job-boards.greenhouse.io/vercel/jobs/123', 'https://jobs.lever.co/newco/abc-def']);
  assert.equal(gap.inRegistry.size, 1);
  assert.deepEqual(shareList(gap), ['https://jobs.lever.co/newco']);
});

test('the same board through several links and files is one new board with every source', () => {
  const gap = findGap([
    { source: 'pipeline.md', url: 'https://jobs.ashbyhq.com/acmeco/1' },
    { source: 'scan-history', url: 'https://jobs.ashbyhq.com/acmeco/2' },
  ], { known, aggregatorDomains: new Set() });
  assert.equal(gap.fresh.size, 1);
  assert.deepEqual([...gap.fresh.values()][0].sources, new Set(['pipeline.md', 'scan-history']));
});

test('boards that are never public are set aside with a reason', () => {
  for (const board of ['referralsuseonly', 'notexternal', 'internalclickstop', 'coupanginternal', 'linkedinjobs', 'episodesixlinkedin']) {
    assert.ok(notPublicReason({ ats: 'greenhouse', board }), board);
  }
  assert.ok(notPublicReason({ ats: 'ashby', board: 'jobs-page-3f2a9c1e-1234-4abc-9def-0123456789ab' }));
  assert.ok(notPublicReason({ ats: 'personio', board: 'example-gmbh' }));
  const gap = run(['https://job-boards.greenhouse.io/referralsuseonly']);
  assert.equal(gap.fresh.size, 0);
  assert.equal(gap.setAside.size, 1);
});

test('real employers whose names look like test words are not set aside', () => {
  for (const board of ['sandboxaq', 'testgorilla', 'employeenavigator', 'democracyforward', 'finitestate', 'modemobile', 'internationalsos']) {
    assert.equal(notPublicReason({ ats: 'greenhouse', board }), null, board);
  }
});

test('the template examples are set aside', () => {
  const templateBoards = boardsIn('careers_url: https://example-co.jobs.personio.de\ncareers_url: https://jobs.ashbyhq.com/templateco');
  const gap = run(['https://jobs.ashbyhq.com/templateco/123'], { templateBoards });
  assert.deepEqual(shareList(gap), []);
  assert.match([...gap.setAside.values()][0].why, /template/);
});

test('what is shared is board addresses only, sorted and without duplicates', () => {
  const gap = run(['https://jobs.lever.co/zeta/1?utm=x', 'https://jobs.lever.co/alpha/2', 'https://jobs.lever.co/zeta/3']);
  assert.deepEqual(shareList(gap), ['https://jobs.lever.co/alpha', 'https://jobs.lever.co/zeta']);
});

test('an install: portals, pipeline and scan history by default; applications and reports only when asked', () => {
  const root = mkdtempSync(join(tmpdir(), 'gap-'));
  try {
    mkdirSync(join(root, 'data')); mkdirSync(join(root, 'reports'));
    writeFileSync(join(root, 'portals.yml'), 'tracked_companies:\n  - careers_url: https://jobs.lever.co/p1\n');
    writeFileSync(join(root, 'data/pipeline.md'), '- [ ] https://jobs.lever.co/p2/abc | Role\n');
    writeFileSync(join(root, 'data/scan-history.tsv'), 'url\tfirst_seen\nhttps://jobs.lever.co/p3/x\t2026-11-01\n');
    writeFileSync(join(root, 'data/applications.md'), '| 1 | https://jobs.lever.co/p4/y |\n');
    writeFileSync(join(root, 'reports/001-x.md'), '**URL:** https://jobs.lever.co/p5/z\n');
    const base = collectInstanceUrls({ root }).map((u) => u.source);
    assert.deepEqual([...new Set(base)].sort(), ['pipeline.md', 'portals.yml', 'scan-history']);
    const all = collectInstanceUrls({ root, includeApplied: true }).map((u) => u.source);
    assert.ok(all.includes('applications.md') && all.includes('reports'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the real registry loads and a board from it is known', () => {
  const ids = loadRegistryIdentities(fileURLToPath(new URL('../employers/boards', import.meta.url)));
  assert.ok(ids.size > 1000);
  assert.ok(ids.has('https://job-boards.greenhouse.io/vercel'));
});

test('API URLs from portals.yml read as their board', async () => {
  const { readBoard } = await import('../employers-gap.mjs');
  const cases = {
    'https://boards-api.greenhouse.io/v1/boards/acme/jobs': 'https://job-boards.greenhouse.io/acme',
    'https://api.lever.co/v0/postings/acme?mode=json': 'https://jobs.lever.co/acme',
    'https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true': 'https://jobs.ashbyhq.com/acme',
    'https://apply.workable.com/api/v3/accounts/acme/jobs': 'https://apply.workable.com/acme',
    'https://api.smartrecruiters.com/v1/companies/Acme/postings': 'https://careers.smartrecruiters.com/Acme',
  };
  for (const [api, board] of Object.entries(cases)) assert.equal(readBoard(api).careers_url, board, api);
});

test('a LinkedIn "liboard" copy is set aside', () => {
  assert.ok(notPublicReason({ ats: 'greenhouse', board: 'rithumliboard' }));
});

test('a retired row still counts as known, so a board we took out is never proposed again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reg-'));
  try {
    mkdirSync(join(dir, 'lever'));
    writeFileSync(join(dir, 'lever/g.ndjson'), JSON.stringify({ ats: 'lever', region: 'us', board: 'goneco', careers_url: 'https://jobs.lever.co/goneco', name: 'Gone', source: 'community', contribution: 'x', added: '2026-11-01', retired: true, retired_reason: 'policy' }) + '\n');
    const ids = loadRegistryIdentities(dir);
    const gap = findGap([{ source: 's', url: 'https://jobs.lever.co/goneco/123' }], { known: ids, aggregatorDomains: new Set() });
    assert.deepEqual(shareList(gap), []);
    assert.equal(gap.inRegistry.size, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('with checks, only boards that list jobs are shared; empty and gone are set aside', async () => {
  const { settle } = await import('../employers-gap.mjs');
  const gap = run(['https://jobs.lever.co/liveco', 'https://jobs.lever.co/emptyco', 'https://jobs.lever.co/goneco', 'https://jobs.lever.co/odd']);
  const checks = new Map([
    ['https://jobs.lever.co/liveco', { status: 'live', jobs: 3 }],
    ['https://jobs.lever.co/emptyco', { status: 'empty', jobs: 0 }],
    ['https://jobs.lever.co/goneco', { status: 'gone', detail: 'HTTP 404' }],
    ['https://jobs.lever.co/odd', { status: 'unchecked', detail: 'timeout' }],
  ]);
  settle(gap, { checks });
  assert.deepEqual(shareList(gap), ['https://jobs.lever.co/liveco', 'https://jobs.lever.co/odd']);
  assert.equal(gap.setAside.size, 2);
});

test('offline, a company the registry has on another system is set aside (it moved)', async () => {
  const { settle } = await import('../employers-gap.mjs');
  const gap = run(['https://job-boards.greenhouse.io/doctolib', 'https://jobs.lever.co/brandnew']);
  settle(gap, { slugs: new Map([['doctolib', new Set(['ashby'])]]) });
  assert.deepEqual(shareList(gap), ['https://jobs.lever.co/brandnew']);
  assert.match([...gap.setAside.values()][0].why, /ashby/);
});

test('checkBoards asks the provider and reads 404 as gone, other errors as unchecked', async () => {
  const { checkBoards } = await import('../employers-gap.mjs');
  const provider = { id: 'fake', fetch: async (e) => {
    if (e.careers_url.endsWith('/live')) return [{}, {}];
    if (e.careers_url.endsWith('/empty')) return [];
    if (e.careers_url.endsWith('/gone')) throw Object.assign(new Error('HTTP 404'), { status: 404 });
    throw Object.assign(new Error('HTTP 503'), { status: 503 });
  } };
  const resolveProvider = (e) => (e.careers_url.includes('nobody') ? null : { provider });
  const urls = ['live', 'empty', 'gone', 'flaky', 'nobody'].map((s) => ({ careers_url: `https://x.test/${s}` }));
  const out = await checkBoards(urls, { providers: new Map(), ctx: {}, resolveProvider });
  assert.deepEqual([...out.values()].map((c) => c.status).sort(), ['empty', 'gone', 'live', 'unchecked', 'unchecked']);
});

test('a board whose own name marks a channel copy or a sourcing board is set aside', async () => {
  const { settle, NOT_PUBLIC_NAME } = await import('../employers-gap.mjs');
  for (const n of ['Stone - Linkedin', 'Stone - Indeed', 'Coursera Sourcing', 'Acme Referrals', 'Acme | Glassdoor']) assert.ok(NOT_PUBLIC_NAME.test(n), n);
  for (const n of ['Pulse Healthcare', 'Holonomy', 'LILT', 'Indeed', 'Internal Medicine Partners LLC'.replace('Internal ', ''), 'Seekr']) assert.ok(!NOT_PUBLIC_NAME.test(n), n);
  const gap = run(['https://job-boards.greenhouse.io/stone', 'https://job-boards.greenhouse.io/holonomy']);
  settle(gap, { checks: new Map([
    ['https://job-boards.greenhouse.io/stone', { status: 'live', jobs: 297, name: 'Stone - Linkedin' }],
    ['https://job-boards.greenhouse.io/holonomy', { status: 'live', jobs: 3, name: 'Holonomy' }],
  ]) });
  assert.deepEqual(shareList(gap), ['https://job-boards.greenhouse.io/holonomy']);
});

test('a board too large to read in one page counts as live', async () => {
  const { checkBoards } = await import('../employers-gap.mjs');
  const provider = { id: 'fake', fetch: async () => { throw new Error('body exceeded maxBytes (5242880)'); } };
  const out = await checkBoards([{ careers_url: 'https://x.test/big' }], { providers: new Map(), ctx: {}, resolveProvider: () => ({ provider }) });
  assert.equal(out.get('https://x.test/big').status, 'live');
});

test('a ClearCompany board, whose id is always a GUID, is not set aside as a UUID', async () => {
  const { readBoard } = await import('../employers-gap.mjs');
  const p = readBoard('https://careers-api.clearcompany.com/v1/3f2a9c1e-1234-4abc-9def-0123456789ab');
  assert.ok(!('error' in p), JSON.stringify(p));
  assert.equal(notPublicReason(p), null);
  assert.ok(notPublicReason({ ats: 'ashby', board: '3f2a9c1e-1234-4abc-9def-0123456789ab' }));
});

test('the CLI reads the install through the data-root helper, not the working directory', () => {
  const src = readFileSync(new URL('../employers-gap.mjs', import.meta.url), 'utf8');
  assert.match(src, /getCareerOpsRoot\(\)/);
  assert.doesNotMatch(src, /process\.cwd\(\)/);
});
