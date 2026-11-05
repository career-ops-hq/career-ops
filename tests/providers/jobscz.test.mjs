// tests/providers/jobscz.test.mjs
import { pass, fail, ROOT, rmSync } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { isDeepStrictEqual } from 'util';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nProvider — jobscz');

const card = ({ id = '2001471915', title = 'SW Technical Leader – Java', status = '16. října', company = 'JISR Institute, a.s.', loc = 'Pardubice – Drozdice' } = {}) =>
  `<article\n  class="SearchResultCard" ><header class="SearchResultCard__header"><h2 data-test-ad-title="${title}" class="SearchResultCard__title"><a data-jobad-id="${id}" data-link="jd-detail" href="https://www.jobs.cz/rpd/${id}/?searchId=4ac05cfc&amp;rps=233" class="link-primary SearchResultCard__titleLink">${title}</a></h2><div data-test-ad-status="default" class="SearchResultCard__status">${status}</div></header><footer class="SearchResultCard__footer"><ul class="SearchResultCard__footerList"><li class="SearchResultCard__footerItem"><svg></svg><span translate="no">${company}</span></li><li data-test="serp-locality" class="SearchResultCard__footerItem"><svg></svg> ${loc} </li></ul></footer></article>`;
const page = (cards, total) => `<html><body><h1>Našli jsme <span>${total}</span> nabídek</h1>${cards.join('')}</body></html>`;
const EMPTY = '<html><body><h2>Nenašli jsme žádné nabídky práce odpovídající zadání</h2></body></html>';
const BROKEN = '<html><body><div>maintenance</div></body></html>';
const NOW = new Date(2026, 9, 20, 12).getTime();

const fullPage = (total) => (url) => {
  const n = new URL(url).searchParams.get('page') || '1';
  return page(Array.from({ length: 30 }, (_, i) => card({ id: `${n}${String(i).padStart(3, '0')}` })), total);
};

const stub = (respond, extra = {}) => {
  const calls = [];
  const ctx = { ...extra, sleep: async () => {}, fetchText: async (url, opts) => { calls.push({ url, opts }); return respond(url); } };
  return { calls, ctx };
};

const pageOf = (url) => new URL(url).searchParams.get('page') || '1';

const withTmpCwd = async (setup, run) => {
  const tmp = mkdtempSync(join(tmpdir(), 'career-ops-jobscz-fallback-'));
  const cwdBefore = process.cwd();
  const rootEnvBefore = { root: process.env.CAREER_OPS_ROOT, dir: process.env.CAREER_OPS_DATA_DIR };
  try {
    setup(tmp);
    process.chdir(tmp);
    process.env.CAREER_OPS_ROOT = tmp;
    process.env.CAREER_OPS_DATA_DIR = '';
    return await run();
  } finally {
    if (rootEnvBefore.root === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = rootEnvBefore.root;
    if (rootEnvBefore.dir === undefined) delete process.env.CAREER_OPS_DATA_DIR;
    else process.env.CAREER_OPS_DATA_DIR = rootEnvBefore.dir;
    process.chdir(cwdBefore);
    rmSync(tmp, { recursive: true, force: true });
  }
};

const captureStderr = async (run) => {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(' '));
  try {
    await run();
  } finally {
    console.error = original;
  }
  return lines.join('\n');
};

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/jobscz.mjs')).href);
  const jobscz = mod.default;
  const { buildSearchUrl, parsePostedAt, parseJobsCzPage } = mod;

  if (jobscz.id === 'jobscz') pass('jobscz.id is "jobscz"');
  else fail(`jobscz.id is ${JSON.stringify(jobscz.id)}`);

  {
    const hit = jobscz.detect({ provider: 'jobscz' });
    if (hit && hit.url === 'https://www.jobs.cz/prace/') pass('jobscz.detect() claims explicit provider config');
    else fail(`jobscz.detect() returned ${JSON.stringify(hit)}`);

    for (const [label, entry] of [
      ['another provider id', { provider: 'pracecz' }],
      ['a bare careers_url', { careers_url: 'https://www.jobs.cz/prace/' }],
      ['junk input', null],
    ]) {
      let out;
      try {
        out = jobscz.detect(entry);
      } catch (err) {
        fail(`jobscz.detect() threw on ${label}: ${err.message}`);
        continue;
      }
      if (out === null) pass(`jobscz.detect() returns null for ${label} (no throw)`);
      else fail(`jobscz.detect() should return null for ${label}, got ${JSON.stringify(out)}`);
    }
  }

  for (const [args, want] of [
    [['backend developer', 1, ''], 'https://www.jobs.cz/prace/?q%5B%5D=backend%20developer'],
    [['python', 3, 'praha'], 'https://www.jobs.cz/prace/praha/?q%5B%5D=python&page=3'],
    [['vývojář', 1, ''], 'https://www.jobs.cz/prace/?q%5B%5D=v%C3%BDvoj%C3%A1%C5%99'],
    [['python', 1, 'hlavní město'], 'https://www.jobs.cz/prace/hlavn%C3%AD%20m%C4%9Bsto/?q%5B%5D=python'],
  ]) {
    const got = buildSearchUrl(...args);
    if (got === want) pass(`buildSearchUrl(${JSON.stringify(args).slice(1, -1)}) → ${want}`);
    else fail(`buildSearchUrl(${JSON.stringify(args).slice(1, -1)}) = ${got}, want ${want}`);
  }

  for (const [text, now, want] of [
    ['16. října', NOW, new Date(2026, 9, 16).getTime()],
    ['Přidáno dnes', NOW, NOW],
    ['Přidáno včera', NOW, NOW - 86_400_000],
    ['Aktualizováno před 3 hodinami', NOW, NOW - 3 * 3_600_000],
    ['Aktualizováno před 5 minutami', NOW, NOW - 5 * 60_000],
    ['Příležitost dne', NOW, undefined],
    ['Končí za 3 dny', NOW, undefined],
    ['', NOW, undefined],
    ['24. prosince', new Date(2026, 0, 5).getTime(), new Date(2025, 11, 24).getTime()],
  ]) {
    const got = parsePostedAt(text, now);
    if (got === want) pass(`parsePostedAt(${JSON.stringify(text)}) → ${want}`);
    else fail(`parsePostedAt(${JSON.stringify(text)}) = ${got}, want ${want}`);
  }

  {
    const posted = new Date(2026, 9, 16).getTime();
    const got = parseJobsCzPage(page([card(), card({ id: '2', title: 'Java &amp; Python Developer' })], 281), NOW);
    const want = {
      total: 281,
      jobs: [
        { title: 'SW Technical Leader – Java', url: 'https://www.jobs.cz/rpd/2001471915/', company: 'JISR Institute, a.s.', location: 'Pardubice – Drozdice', postedAt: posted },
        { title: 'Java & Python Developer', url: 'https://www.jobs.cz/rpd/2/', company: 'JISR Institute, a.s.', location: 'Pardubice – Drozdice', postedAt: posted },
      ],
    };
    if (isDeepStrictEqual(got, want)) pass('parseJobsCzPage maps total, title, url, company, location and postedAt');
    else fail(`parseJobsCzPage returned ${JSON.stringify(got)}`);

    if (got.jobs[1]?.title === 'Java & Python Developer') pass('parseJobsCzPage decodes entities in the title');
    else fail(`second title = ${JSON.stringify(got.jobs[1]?.title)}`);
  }

  {
    const total = parseJobsCzPage(page([card()], '1 005')).total;
    if (total === 1005) pass('parseJobsCzPage reads a total with a non-breaking-space thousands separator');
    else fail(`total for "1\\u00a0005" = ${total}`);
  }

  {
    const total = parseJobsCzPage(page([card()], '1&nbsp;005')).total;
    if (total === 1005) pass('parseJobsCzPage reads a total with an &nbsp; thousands separator');
    else fail(`total for "1&nbsp;005" = ${total}`);
  }

  {
    const { jobs } = parseJobsCzPage(page([card().replace(' data-jobad-id="2001471915"', ''), card({ id: '7' })], 2), NOW);
    if (jobs.length === 1 && jobs[0].url === 'https://www.jobs.cz/rpd/7/') pass('parseJobsCzPage skips a card with no data-jobad-id and keeps the rest');
    else fail(`card without id: got ${JSON.stringify(jobs)}`);
  }

  {
    const [job] = parseJobsCzPage(page([card({ status: 'Příležitost dne' })], 1), NOW).jobs;
    if (job && !('postedAt' in job)) pass('parseJobsCzPage omits postedAt for an undated status');
    else fail(`undated card = ${JSON.stringify(job)}`);
  }

  {
    const got = parseJobsCzPage(EMPTY);
    if (isDeepStrictEqual(got, { total: 0, jobs: [] })) pass('parseJobsCzPage returns { total: 0, jobs: [] } for the empty-result notice');
    else fail(`empty page returned ${JSON.stringify(got)}`);
  }

  for (const [label, html] of [
    ['a page with no cards and no empty notice', BROKEN],
    ['cards with no result count', page([card()], 'x')],
  ]) {
    try {
      parseJobsCzPage(html);
      fail(`parseJobsCzPage should throw for ${label}`);
    } catch (err) {
      if (/jobscz/.test(err.message)) pass(`parseJobsCzPage throws for ${label}`);
      else fail(`parseJobsCzPage threw an unexpected error for ${label}: ${err.message}`);
    }
  }

  {
    const { calls, ctx } = stub(() => page([card()], 1));
    await jobscz.fetch({ provider: 'jobscz', name: 'Acme', jobscz: { keywords: ['backend developer', 'data engineer'] } }, ctx);
    if (calls.length === 2 && calls.every((c) => c.url.split('q%5B%5D=').length === 2)) pass('jobscz.fetch() sends one request per keyword, each with one q[] value');
    else fail(`jobscz.fetch() requested ${JSON.stringify(calls.map((c) => c.url))}`);

    if (calls.length && calls.every((c) => c.opts?.redirect === 'error')) pass('jobscz.fetch() passes redirect:"error" on every request');
    else fail(`jobscz.fetch() opts = ${JSON.stringify(calls.map((c) => c.opts))}`);
  }

  {
    const { calls, ctx } = stub(fullPage(61));
    await jobscz.fetch({ provider: 'jobscz', name: 'Acme', jobscz: { keywords: ['x'] } }, ctx);
    const pages = calls.map((c) => pageOf(c.url));
    if (isDeepStrictEqual(pages, ['1', '2', '3'])) pass('jobscz.fetch() walks pages 1..ceil(total/30) and no further');
    else fail(`jobscz.fetch() requested pages ${JSON.stringify(pages)}`);
  }

  {
    const { calls, ctx } = stub(fullPage(400));
    const text = await captureStderr(() => jobscz.fetch({ provider: 'jobscz', name: 'Acme', jobscz: { keywords: ['x'] }, max_pages: 2 }, ctx));
    if (calls.length === 2 && text.includes('truncated at max_pages=2')) pass('jobscz.fetch() stops at max_pages and warns that the search was truncated');
    else fail(`max_pages=2: ${calls.length} request(s), stderr ${JSON.stringify(text)}`);
  }

  {
    const { calls, ctx } = stub(fullPage(400), { maxPages: 1 });
    const text = await captureStderr(() => jobscz.fetch({ provider: 'jobscz', name: 'Acme', jobscz: { keywords: ['x'] } }, ctx));
    if (calls.length === 1 && text === '') pass('jobscz.fetch() honors ctx.maxPages:1 with exactly one request and no warning');
    else fail(`ctx.maxPages=1: ${calls.length} request(s), stderr ${JSON.stringify(text)}`);

    const err = new Error('probe budget');
    let caught = null;
    try {
      await jobscz.fetch({ provider: 'jobscz', name: 'Acme', jobscz: { keywords: ['x'] } }, stub(() => { throw err; }, { maxPages: 1 }).ctx);
    } catch (e) {
      caught = e;
    }
    if (caught === err) pass('jobscz.fetch() propagates a fetch rejection unwrapped while ctx.maxPages is set');
    else fail(`probe rejection was rewrapped or swallowed: ${caught && caught.message}`);
  }

  {
    let fetched = [];
    const respond = (url) => {
      if (pageOf(url) === '2') throw new Error('boom');
      return fullPage(61)(url);
    };
    const text = await captureStderr(async () => {
      fetched = await jobscz.fetch({ provider: 'jobscz', name: 'Acme', jobscz: { keywords: ['x'] } }, stub(respond).ctx);
    });
    if (fetched.length === 30 && text.includes('jobscz')) pass('jobscz.fetch() keeps page-1 jobs and warns when page 2 fails');
    else fail(`page-2 failure: ${fetched.length} jobs, stderr ${JSON.stringify(text)}`);
  }

  {
    let fetched = [];
    const respond = (url) => {
      if (url.includes('q%5B%5D=bad')) throw new Error('boom');
      return page([card()], 1);
    };
    const text = await captureStderr(async () => {
      fetched = await jobscz.fetch({ provider: 'jobscz', name: 'Acme', jobscz: { keywords: ['bad', 'good'] } }, stub(respond).ctx);
    });
    if (fetched.length === 1 && text.includes('page 1 failed')) pass('jobscz.fetch() keeps the other keywords and warns when one keyword fails on page 1');
    else fail(`one keyword failing: ${fetched.length} jobs, stderr ${JSON.stringify(text)}`);
  }

  {
    try {
      await jobscz.fetch({ provider: 'jobscz', name: 'Acme', jobscz: { keywords: ['a', 'b'] } }, stub(() => { throw new Error('boom'); }).ctx);
      fail('jobscz.fetch() should throw when every keyword request fails');
    } catch (err) {
      if (/all 2 keyword request\(s\) failed/.test(err.message)) pass('jobscz.fetch() throws when every keyword fails');
      else fail(`jobscz.fetch() threw an unexpected error on total outage: ${err.message}`);
    }
  }

  {
    const fetched = await jobscz.fetch({ provider: 'jobscz', name: 'Acme', jobscz: { keywords: ['a', 'b'] } }, stub(() => page([card()], 1)).ctx);
    if (fetched.length === 1) pass('jobscz.fetch() dedups an offer returned for two keywords');
    else fail(`jobscz.fetch() returned ${fetched.length} rows for one shared offer`);
  }

  {
    let message = '';
    try {
      await jobscz.fetch({ provider: 'jobscz', name: 'Acme', jobscz: { keywords: ['x'] } }, stub(() => page([card().replace('data-jobad-id=', 'data-ad-id=')], 5)).ctx);
    } catch (err) {
      message = err.message;
    }
    if (/^jobscz: "x" reports 5 offers but none parsed/.test(message)) pass('jobscz.fetch() throws when the page reports offers but no card parses');
    else fail(`renamed data-jobad-id: ${JSON.stringify(message)}`);
  }

  {
    const { calls, ctx } = stub(() => page([card()], 1));
    await withTmpCwd(
      (tmp) => {
        mkdirSync(join(tmp, 'config'));
        writeFileSync(join(tmp, 'config', 'profile.yml'), 'target_roles:\n  primary:\n    - Data Engineer\n');
      },
      () => jobscz.fetch({ provider: 'jobscz', name: 'Acme' }, ctx),
    );
    if (calls.length && calls[0].url.includes('q%5B%5D=Data%20Engineer')) pass('jobscz.fetch() falls back to config/profile.yml target_roles');
    else fail(`jobscz.fetch() fallback requested ${JSON.stringify(calls.map((c) => c.url))}`);

    let message = '';
    try {
      await withTmpCwd(() => {}, () => jobscz.fetch({ provider: 'jobscz', name: 'Acme' }, stub(() => page([card()], 1)).ctx));
    } catch (err) {
      message = err.message;
    }
    if (/no jobscz\.keywords/.test(message)) pass('jobscz.fetch() throws a clear error when no keywords and no profile fallback exist');
    else fail(`jobscz.fetch() with no keywords: ${JSON.stringify(message)}`);
  }
} catch (e) {
  fail(`jobscz provider tests crashed: ${e.message}`);
}
