// tests/providers/pracecz.test.mjs
import { pass, fail, ROOT, rmSync } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { isDeepStrictEqual } from 'util';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nProvider — pracecz');

const ID = 'b2180f86-f899-4b62-85c0-bc5155591152';
const item = (over = {}) => ({
  searchInfo: { isPromoted: false },
  metadata: { advertId: ID, publishedAt: '2026-10-20T15:36:43+02:00' },
  advert: { title: 'Site Reliability Engineer', language: 'en',
    workLocation: { places: [{ city: 'Praha-Michle' }], type: 'PARTIALLY_REMOTE' },
    salary: { min: 100000, max: 115000, currency: 'czk', period: 'MONTH', displayMode: 'SHOW_ALL' } },
  company: { publicName: 'Thales DIS Czech Republic s.r.o.' },
  deprecated: { recruitmentId: 2001441278 },
  ...over,
});
const page = (items, totalItems = items.length) =>
  `<html><script>self.__next_f.push(${JSON.stringify([1, `14:["$","$L4e",null,${JSON.stringify({ totalItems, currentPageItems: items })}]\n`])})</script></html>`;

const advert = (over) => ({ ...item().advert, ...over });
const withSalary = (over) => item({ advert: advert({ salary: { ...item().advert.salary, ...over } }) });

const fullPage = (total) => (url) => {
  const n = new URL(url).searchParams.get('page') || '1';
  return page(Array.from({ length: 40 }, (_, i) => item({ metadata: { advertId: `${n}-${i}`, publishedAt: '2026-10-20T15:36:43+02:00' } })), total);
};

const stub = (respond, extra = {}) => {
  const calls = [];
  const ctx = { ...extra, sleep: async () => {}, fetchText: async (url, opts) => { calls.push({ url, opts }); return respond(url); } };
  return { calls, ctx };
};

const pageOf = (url) => new URL(url).searchParams.get('page') || '1';

const withTmpCwd = async (setup, run) => {
  const tmp = mkdtempSync(join(tmpdir(), 'career-ops-pracecz-fallback-'));
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
  const mod = await import(pathToFileURL(join(ROOT, 'providers/pracecz.mjs')).href);
  const pracecz = mod.default;
  const { buildSearchUrl, extractResults, normalizeItem } = mod;

  if (pracecz.id === 'pracecz') pass('pracecz.id is "pracecz"');
  else fail(`pracecz.id is ${JSON.stringify(pracecz.id)}`);

  {
    const hit = pracecz.detect({ provider: 'pracecz' });
    if (hit && hit.url === 'https://www.prace.cz/nabidky/') pass('pracecz.detect() claims explicit provider config');
    else fail(`pracecz.detect() returned ${JSON.stringify(hit)}`);

    for (const [label, entry] of [
      ['another provider id', { provider: 'jobscz' }],
      ['a bare careers_url', { careers_url: 'https://www.prace.cz/nabidky/' }],
      ['junk input', null],
    ]) {
      let out;
      try {
        out = pracecz.detect(entry);
      } catch (err) {
        fail(`pracecz.detect() threw on ${label}: ${err.message}`);
        continue;
      }
      if (out === null) pass(`pracecz.detect() returns null for ${label} (no throw)`);
      else fail(`pracecz.detect() should return null for ${label}, got ${JSON.stringify(out)}`);
    }
  }

  for (const [args, want] of [
    [['python', 1, ''], 'https://www.prace.cz/nabidky/?q=python'],
    [['backend developer', 2, 'brno'], 'https://www.prace.cz/nabidky/brno/?q=backend%20developer&page=2'],
  ]) {
    const got = buildSearchUrl(...args);
    if (got === want) pass(`buildSearchUrl(${JSON.stringify(args).slice(1, -1)}) → ${want}`);
    else fail(`buildSearchUrl(${JSON.stringify(args).slice(1, -1)}) = ${got}, want ${want}`);
  }

  {
    const got = extractResults(page([item()], 63));
    if (got.totalItems === 63 && got.items.length === 1) pass('extractResults reads totalItems and currentPageItems from the RSC chunk');
    else fail(`extractResults returned totalItems=${got.totalItems}, ${got.items.length} item(s)`);
  }

  {
    const title = 'Dev [Senior] "x" \\ y';
    const got = extractResults(page([item({ advert: advert({ title }) })])).items[0]?.advert?.title;
    if (got === title) pass('extractResults keeps brackets, quotes and backslashes inside strings intact');
    else fail(`title through extractResults = ${JSON.stringify(got)}`);

    const unbalanced = 'q "]" \\" [';
    let kept;
    try {
      kept = extractResults(page([item({ advert: advert({ title: unbalanced }) })])).items[0]?.advert?.title;
    } catch (err) {
      kept = `threw: ${err.message}`;
    }
    if (kept === unbalanced) pass('extractResults keeps an unbalanced bracket and an escaped quote inside a string intact');
    else fail(`unbalanced title through extractResults = ${JSON.stringify(kept)}`);
  }

  {
    const got = extractResults(page([], 0));
    if (isDeepStrictEqual(got, { totalItems: 0, items: [] })) pass('extractResults returns { totalItems: 0, items: [] } for an empty result');
    else fail(`empty page returned ${JSON.stringify(got)}`);
  }

  try {
    extractResults('<html></html>');
    fail('extractResults should throw for a page with no RSC payload');
  } catch (err) {
    if (/pracecz/.test(err.message)) pass('extractResults throws for a page with no RSC payload');
    else fail(`extractResults threw an unexpected error: ${err.message}`);
  }

  try {
    extractResults(`<html><script>self.__next_f.push(${JSON.stringify([1, '14:["$","$L4e",null,{"totalItems":63,"currentPageItems":"$L5"}]\n15:["a","b"]\n'])})</script></html>`);
    fail('extractResults should throw when currentPageItems is an RSC reference');
  } catch (err) {
    if (/pracecz/.test(err.message)) pass('extractResults throws when currentPageItems is an RSC reference instead of binding a later array');
    else fail(`extractResults threw an unexpected error: ${err.message}`);
  }

  {
    const want = {
      title: 'Site Reliability Engineer',
      url: 'https://www.prace.cz/nabidka/b2180f86-f899-4b62-85c0-bc5155591152/',
      company: 'Thales DIS Czech Republic s.r.o.',
      location: 'Praha-Michle',
      postedAt: Date.parse('2026-10-20T15:36:43+02:00'),
      language: 'en',
      salary: { min: 1200000, max: 1380000, currency: 'CZK' },
    };
    const got = normalizeItem(item());
    if (isDeepStrictEqual(got, want)) pass('normalizeItem maps title, url, company, location, postedAt, language and annualized salary');
    else fail(`normalizeItem returned ${JSON.stringify(got)}`);
  }

  {
    const got = normalizeItem(item({ extended: { careerPage: { url: 'https://rohde-schwarz.jobs.cz/pd/2001441162?originJobAdUuid=x' } } }))?.url;
    if (got === 'https://rohde-schwarz.jobs.cz/pd/2001441162') pass('normalizeItem uses a *.jobs.cz careerPage url without its query');
    else fail(`careerPage url = ${JSON.stringify(got)}`);

    for (const bad of ['https://evil.example/pd/1', 'http://a.jobs.cz/pd/1']) {
      const url = normalizeItem(item({ extended: { careerPage: { url: bad } } }))?.url;
      if (url === `https://www.prace.cz/nabidka/${ID}/`) pass(`normalizeItem ignores careerPage ${bad}`);
      else fail(`careerPage ${bad} gave url ${JSON.stringify(url)}`);
    }
  }

  for (const [label, over] of [
    ['displayMode NO', { displayMode: 'NO' }],
    ['period HOUR', { period: 'HOUR' }],
  ]) {
    const got = normalizeItem(withSalary(over));
    if (got && !('salary' in got)) pass(`normalizeItem omits salary for ${label}`);
    else fail(`${label}: ${JSON.stringify(got)}`);
  }

  {
    const got = normalizeItem(item({ advert: advert({ salary: { min: 900000, currency: 'czk', period: 'YEAR', displayMode: 'SHOW_ALL' } }) }))?.salary;
    if (isDeepStrictEqual(got, { min: 900000, currency: 'CZK' })) pass('normalizeItem keeps a yearly min-only salary as is');
    else fail(`yearly min-only salary = ${JSON.stringify(got)}`);
  }

  for (const [places, want] of [
    [[{ city: 'Brno' }], 'Remote, Brno'],
    [[], 'Remote'],
  ]) {
    const got = normalizeItem(item({ advert: advert({ workLocation: { places, type: 'FULL_REMOTE' } }) }))?.location;
    if (got === want) pass(`normalizeItem location for FULL_REMOTE with ${places.length} place(s) → ${want}`);
    else fail(`FULL_REMOTE location = ${JSON.stringify(got)}, want ${want}`);
  }

  for (const [label, bad] of [
    ['no advert.title', item({ advert: advert({ title: undefined }) })],
    ['no metadata.advertId', item({ metadata: { publishedAt: '2026-10-20T15:36:43+02:00' } })],
  ]) {
    const got = normalizeItem(bad);
    if (got === null) pass(`normalizeItem returns null for ${label}`);
    else fail(`normalizeItem with ${label} = ${JSON.stringify(got)}`);
  }

  {
    const { calls, ctx } = stub(() => page([item()]));
    await pracecz.fetch({ provider: 'pracecz', name: 'Acme', pracecz: { keywords: ['backend developer', 'data engineer'] } }, ctx);
    if (calls.length === 2 && calls.every((c) => new URL(c.url).searchParams.getAll('q').length === 1)) pass('pracecz.fetch() sends one request per keyword, each with one q value');
    else fail(`pracecz.fetch() requested ${JSON.stringify(calls.map((c) => c.url))}`);

    if (calls.length && calls.every((c) => c.opts?.redirect === 'error')) pass('pracecz.fetch() passes redirect:"error" on every request');
    else fail(`pracecz.fetch() opts = ${JSON.stringify(calls.map((c) => c.opts))}`);
  }

  {
    const { calls, ctx } = stub(fullPage(81));
    await pracecz.fetch({ provider: 'pracecz', name: 'Acme', pracecz: { keywords: ['x'] } }, ctx);
    const pages = calls.map((c) => pageOf(c.url));
    if (isDeepStrictEqual(pages, ['1', '2', '3'])) pass('pracecz.fetch() walks pages 1..ceil(total/40) and no further');
    else fail(`pracecz.fetch() requested pages ${JSON.stringify(pages)}`);
  }

  {
    const { calls, ctx } = stub(fullPage(400));
    const text = await captureStderr(() => pracecz.fetch({ provider: 'pracecz', name: 'Acme', pracecz: { keywords: ['x'] }, max_pages: 2 }, ctx));
    if (calls.length === 2 && text.includes('truncated at max_pages=2')) pass('pracecz.fetch() stops at max_pages and warns that the search was truncated');
    else fail(`max_pages=2: ${calls.length} request(s), stderr ${JSON.stringify(text)}`);
  }

  {
    const { calls, ctx } = stub(fullPage(400), { maxPages: 1 });
    const text = await captureStderr(() => pracecz.fetch({ provider: 'pracecz', name: 'Acme', pracecz: { keywords: ['x'] } }, ctx));
    if (calls.length === 1 && text === '') pass('pracecz.fetch() honors ctx.maxPages:1 with exactly one request and no warning');
    else fail(`ctx.maxPages=1: ${calls.length} request(s), stderr ${JSON.stringify(text)}`);

    const err = new Error('probe budget');
    let caught = null;
    try {
      await pracecz.fetch({ provider: 'pracecz', name: 'Acme', pracecz: { keywords: ['x'] } }, stub(() => { throw err; }, { maxPages: 1 }).ctx);
    } catch (e) {
      caught = e;
    }
    if (caught === err) pass('pracecz.fetch() propagates a fetch rejection unwrapped while ctx.maxPages is set');
    else fail(`probe rejection was rewrapped or swallowed: ${caught && caught.message}`);
  }

  {
    let fetched = [];
    const respond = (url) => {
      if (pageOf(url) === '2') throw new Error('boom');
      return fullPage(81)(url);
    };
    const text = await captureStderr(async () => {
      fetched = await pracecz.fetch({ provider: 'pracecz', name: 'Acme', pracecz: { keywords: ['x'] } }, stub(respond).ctx);
    });
    if (fetched.length === 40 && text.includes('pracecz')) pass('pracecz.fetch() keeps page-1 jobs and warns when page 2 fails');
    else fail(`page-2 failure: ${fetched.length} jobs, stderr ${JSON.stringify(text)}`);
  }

  {
    let fetched = [];
    const respond = (url) => {
      if (url.includes('q=bad')) throw new Error('boom');
      return page([item()]);
    };
    const text = await captureStderr(async () => {
      fetched = await pracecz.fetch({ provider: 'pracecz', name: 'Acme', pracecz: { keywords: ['bad', 'good'] } }, stub(respond).ctx);
    });
    if (fetched.length === 1 && text.includes('page 1 failed')) pass('pracecz.fetch() keeps the other keywords and warns when one keyword fails on page 1');
    else fail(`one keyword failing: ${fetched.length} jobs, stderr ${JSON.stringify(text)}`);
  }

  {
    try {
      await pracecz.fetch({ provider: 'pracecz', name: 'Acme', pracecz: { keywords: ['a', 'b'] } }, stub(() => { throw new Error('boom'); }).ctx);
      fail('pracecz.fetch() should throw when every keyword request fails');
    } catch (err) {
      if (/all 2 keyword request\(s\) failed/.test(err.message)) pass('pracecz.fetch() throws when every keyword fails');
      else fail(`pracecz.fetch() threw an unexpected error on total outage: ${err.message}`);
    }
  }

  {
    const fetched = await pracecz.fetch({ provider: 'pracecz', name: 'Acme', pracecz: { keywords: ['a', 'b'] } }, stub(() => page([item()])).ctx);
    if (fetched.length === 1) pass('pracecz.fetch() dedups an offer returned for two keywords');
    else fail(`pracecz.fetch() returned ${fetched.length} rows for one shared offer`);
  }

  {
    const branded = item({ extended: { careerPage: { url: 'https://acme.jobs.cz/pd/1' } } });
    const fetched = await pracecz.fetch({ provider: 'pracecz', name: 'Acme', pracecz: { keywords: ['a', 'b'] } }, stub((url) => page([url.includes('q=a') ? branded : item()])).ctx);
    if (fetched.length === 1) pass('pracecz.fetch() dedups one advertId seen under two URLs');
    else fail(`pracecz.fetch() returned ${fetched.length} rows for one advertId under two URLs`);
  }

  {
    let message = '';
    try {
      await pracecz.fetch({ provider: 'pracecz', name: 'Acme', pracecz: { keywords: ['x'] } }, stub(() => page([item({ advert: advert({ title: undefined }) })], 5)).ctx);
    } catch (err) {
      message = err.message;
    }
    if (/^pracecz: "x" reports 5 offers but none parsed/.test(message)) pass('pracecz.fetch() throws when the page reports offers but no item normalizes');
    else fail(`items without advert.title: ${JSON.stringify(message)}`);
  }

  {
    const { calls, ctx } = stub(() => page([item()]));
    await withTmpCwd(
      (tmp) => {
        mkdirSync(join(tmp, 'config'));
        writeFileSync(join(tmp, 'config', 'profile.yml'), 'target_roles:\n  primary:\n    - Data Engineer\n');
      },
      () => pracecz.fetch({ provider: 'pracecz', name: 'Acme' }, ctx),
    );
    if (calls.length && calls[0].url.includes('q=Data%20Engineer')) pass('pracecz.fetch() falls back to config/profile.yml target_roles');
    else fail(`pracecz.fetch() fallback requested ${JSON.stringify(calls.map((c) => c.url))}`);

    let message = '';
    try {
      await withTmpCwd(() => {}, () => pracecz.fetch({ provider: 'pracecz', name: 'Acme' }, stub(() => page([item()])).ctx));
    } catch (err) {
      message = err.message;
    }
    if (/no pracecz\.keywords/.test(message)) pass('pracecz.fetch() throws a clear error when no keywords and no profile fallback exist');
    else fail(`pracecz.fetch() with no keywords: ${JSON.stringify(message)}`);
  }
} catch (e) {
  fail(`pracecz provider tests crashed: ${e.message}`);
}
