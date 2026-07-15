// tests/providers/meituan.test.mjs — Meituan careers provider (zhaopin.meituan.com
// public JSON API). Added with the provider in the same PR; follows the
// discovered-test layout from #1440.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — meituan (zhaopin.meituan.com JSON API)');
try {
  const meituan = (await import(pathToFileURL(join(ROOT, 'providers/meituan.mjs')).href)).default;
  const { parseMeituanResponse } = await import(pathToFileURL(join(ROOT, 'providers/meituan.mjs')).href);

  if (meituan.id === 'meituan') pass('meituan.id is "meituan"');
  else fail(`meituan.id is ${JSON.stringify(meituan.id)}`);

  const hit = meituan.detect({ name: '美团', careers_url: 'https://zhaopin.meituan.com/web/social' });
  if (hit && hit.url === 'https://zhaopin.meituan.com/web/social') {
    pass('meituan.detect() claims zhaopin.meituan.com URLs');
  } else {
    fail(`meituan.detect() returned ${JSON.stringify(hit)}`);
  }

  if (meituan.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('meituan.detect() returns null for non-Meituan URLs');
  } else {
    fail('meituan.detect() should return null for non-Meituan URLs');
  }

  if (meituan.detect({ name: 'X', careers_url: 'https://evil.example/zhaopin.meituan.com' }) === null) {
    pass('meituan.detect() rejects path-spoofed hosts');
  } else {
    fail('meituan.detect() should reject path-spoofed hosts');
  }

  if (meituan.detect({ name: 'X', careers_url: 'http://zhaopin.meituan.com/web/social' }) === null) {
    pass('meituan.detect() is HTTPS-only');
  } else {
    fail('meituan.detect() should reject http:// URLs');
  }

  if (meituan.detect({ name: 'X', careers_url: 12345 }) === null) {
    pass('meituan.detect() returns null for a non-string careers_url');
  } else {
    fail('meituan.detect() should return null for a non-string careers_url');
  }

  // parseMeituanResponse
  const sample = {
    data: {
      page: { pageNo: 1, pageSize: 100, totalCount: 42 },
      list: [
        {
          jobUnionId: 'abc-123',
          name: '大模型算法工程师',
          cityList: [{ name: '北京市' }, { name: '上海市' }],
          department: [{ name: '核心本地商业-测试部' }],
          jobFamily: '技术类',
          workYear: '3-5年',
          jobDuty: '负责大模型训练。',
          jobRequirement: '熟悉深度学习框架。',
          refreshTime: 1751500800000,
        },
        {
          jobUnionId: 'def-456',
          name: 'AI产品经理',
          cityList: [{ name: '深圳市' }],
          firstPostTime: '2026-06-20T00:00:00.000Z',
        },
        { jobUnionId: 'ghi-789' },
        { name: '无ID岗位' },
      ],
    },
  };
  const { jobs, total } = parseMeituanResponse(sample, '美团');

  if (total === 42) pass('parseMeituanResponse() reads data.page.totalCount as total');
  else fail(`parseMeituanResponse() total = ${total}`);

  if (jobs.length === 2) pass('parseMeituanResponse() keeps titled+ID posts, drops incomplete ones');
  else fail(`parseMeituanResponse() returned ${jobs.length} jobs, expected 2`);

  const j1 = jobs[0];
  if (j1 && j1.url === 'https://zhaopin.meituan.com/web/position/detail?jobUnionId=abc-123' && j1.location === '北京市/上海市') {
    pass('parseMeituanResponse() builds detail URL from jobUnionId and joins cityList names');
  } else {
    fail(`parseMeituanResponse() job[0] = ${JSON.stringify(j1)}`);
  }

  if (j1 && j1.description.includes('部门: 核心本地商业-测试部') && j1.description.includes('负责大模型训练。')) {
    pass('parseMeituanResponse() packs department/family/duty/requirement into description');
  } else {
    fail(`parseMeituanResponse() description = ${JSON.stringify(j1 && j1.description)}`);
  }

  if (j1 && j1.postedAt === 1751500800000) {
    pass('parseMeituanResponse() passes epoch-ms refreshTime through');
  } else {
    fail(`parseMeituanResponse() postedAt = ${j1 && j1.postedAt}`);
  }

  const j2 = jobs[1];
  if (j2 && j2.postedAt === Date.parse('2026-06-20T00:00:00.000Z')) {
    pass('parseMeituanResponse() falls back to firstPostTime when refreshTime is absent');
  } else {
    fail(`parseMeituanResponse() job[1].postedAt = ${j2 && j2.postedAt}`);
  }

  const empty = parseMeituanResponse({ data: { page: { totalCount: 0 }, list: null } }, '美团');
  if (empty.jobs.length === 0 && empty.total === 0) {
    pass('parseMeituanResponse() handles a missing list array');
  } else {
    fail(`parseMeituanResponse() empty payload → ${JSON.stringify(empty)}`);
  }

  // fetch() — pagination, retry-on-empty, cross-keyword dedup, page caps (mocked ctx)
  const MEITUAN_URL = 'https://zhaopin.meituan.com/web/social';
  const mkJob = (id, title) => ({ jobUnionId: String(id), name: title, cityList: [{ name: '北京市' }] });
  const mkCtx = (impl) => {
    const calls = [];
    const sleeps = [];
    return {
      calls,
      sleeps,
      ctx: {
        sleep: async (ms) => { sleeps.push(ms); },
        fetchJson: async (_url, opts) => {
          const body = JSON.parse(opts.body);
          const call = { keywords: body.keywords, pageNo: body.page.pageNo };
          calls.push(call);
          return impl(call, calls.length);
        },
      },
    };
  };

  const paged = mkCtx(({ pageNo }) => ({
    data: {
      page: { totalCount: 150 },
      list: pageNo === 1
        ? Array.from({ length: 100 }, (_, i) => mkJob(1000 + i, `岗位A${i}`))
        : Array.from({ length: 50 }, (_, i) => mkJob(2000 + i, `岗位B${i}`)),
    },
  }));
  const pagedJobs = await meituan.fetch({ name: '美团', careers_url: MEITUAN_URL, keywords: ['AI'] }, paged.ctx);
  if (pagedJobs.length === 150 && paged.calls.length === 2) {
    pass('meituan.fetch() paginates until totalCount is exhausted (150 posts → 2 requests)');
  } else {
    fail(`meituan.fetch() pagination: ${pagedJobs.length} jobs, ${paged.calls.length} requests`);
  }

  if (paged.sleeps.length === 1 && paged.sleeps[0] > 0) {
    pass('meituan.fetch() paces follow-up requests via ctx.sleep (no delay before the first request)');
  } else {
    fail(`meituan.fetch() ctx.sleep calls: ${JSON.stringify(paged.sleeps)}`);
  }

  const flaky = mkCtx((_call, n) => (n === 2
    ? { data: { page: { totalCount: 120 }, list: [] } }   // page 2, attempt 1: rate-limit flake
    : {
        data: {
          page: { totalCount: 120 },
          list: n === 1
            ? Array.from({ length: 100 }, (_, i) => mkJob(3000 + i, `岗位C${i}`))
            : Array.from({ length: 20 }, (_, i) => mkJob(4000 + i, `岗位D${i}`)),
        },
      }));
  const flakyJobs = await meituan.fetch({ name: '美团', careers_url: MEITUAN_URL, keywords: ['AI'] }, flaky.ctx);
  if (flakyJobs.length === 120 && flaky.calls.length === 3) {
    pass('meituan.fetch() retries an empty mid-pagination page instead of truncating (flake → retry → 120 jobs)');
  } else {
    fail(`meituan.fetch() retry-on-empty: ${flakyJobs.length} jobs, ${flaky.calls.length} requests`);
  }

  const overlap = mkCtx(() => ({
    data: { page: { totalCount: 1 }, list: [mkJob(42, '重复岗位')] },
  }));
  const overlapJobs = await meituan.fetch({ name: '美团', careers_url: MEITUAN_URL, keywords: ['AI', '大模型'] }, overlap.ctx);
  if (overlapJobs.length === 1 && overlap.calls.length === 2 && overlap.sleeps.length === 1) {
    pass('meituan.fetch() dedupes across keywords and paces the keyword switch');
  } else {
    fail(`meituan.fetch() cross-keyword: ${overlapJobs.length} jobs, ${overlap.calls.length} requests, sleeps ${JSON.stringify(overlap.sleeps)}`);
  }

  const capped = mkCtx(() => ({
    data: { page: { totalCount: 500 }, list: Array.from({ length: 100 }, (_, i) => mkJob(5000 + i, `岗位E${i}`)) },
  }));
  await meituan.fetch({ name: '美团', careers_url: MEITUAN_URL, keywords: ['AI'], max_pages: 1 }, capped.ctx);
  if (capped.calls.length === 1) {
    pass('meituan.fetch() honors entry.max_pages');
  } else {
    fail(`meituan.fetch() entry.max_pages=1 made ${capped.calls.length} requests`);
  }

  const probe = mkCtx(() => ({
    data: { page: { totalCount: 500 }, list: Array.from({ length: 100 }, (_, i) => mkJob(6000 + i, `岗位F${i}`)) },
  }));
  probe.ctx.maxPages = 1;
  const probeJobs = await meituan.fetch({ name: '美团', careers_url: MEITUAN_URL }, probe.ctx);
  if (probe.calls.length === 1 && probe.calls[0].keywords === '' && probeJobs.length === 100) {
    pass('meituan.fetch() honors the ctx.maxPages probe hint and defaults to a whole-board (empty keyword) query');
  } else {
    fail(`meituan.fetch() ctx.maxPages=1: ${probe.calls.length} requests, keywords=${JSON.stringify(probe.calls[0] && probe.calls[0].keywords)}`);
  }

  const blip = mkCtx(({ keywords }) => {
    if (keywords === '大模型') throw new Error('HTTP 503');
    return { data: { page: { totalCount: 1 }, list: [mkJob(7, '幸存岗位')] } };
  });
  const blipJobs = await meituan.fetch({ name: '美团', careers_url: MEITUAN_URL, keywords: ['AI', '大模型'] }, blip.ctx);
  if (blipJobs.length === 1 && blipJobs[0].title === '幸存岗位') {
    pass('meituan.fetch() keeps already-collected jobs when a later request fails');
  } else {
    fail(`meituan.fetch() partial results on failure: ${JSON.stringify(blipJobs.map(j => j.title))}`);
  }

  const zeroThenBlip = mkCtx(({ keywords }) => {
    if (keywords === '大模型') throw new Error('HTTP 503');
    return { data: { page: { totalCount: 0 }, list: [] } };
  });
  let zeroThenBlipJobs;
  let zeroThenBlipThrew = false;
  try {
    zeroThenBlipJobs = await meituan.fetch({ name: '美团', careers_url: MEITUAN_URL, keywords: ['AI', '大模型'] }, zeroThenBlip.ctx);
  } catch { zeroThenBlipThrew = true; }
  if (!zeroThenBlipThrew && Array.isArray(zeroThenBlipJobs) && zeroThenBlipJobs.length === 0) {
    pass('meituan.fetch() treats a later failure as a blip even when earlier keywords matched 0 jobs (board is alive)');
  } else {
    fail(`meituan.fetch() 0-result keyword then 503: ${zeroThenBlipThrew ? 'threw' : JSON.stringify(zeroThenBlipJobs)}`);
  }

  let firstFailThrew = false;
  const dead = mkCtx(() => { throw new Error('HTTP 500'); });
  try {
    await meituan.fetch({ name: '美团', careers_url: MEITUAN_URL, keywords: ['AI'] }, dead.ctx);
  } catch { firstFailThrew = true; }
  if (firstFailThrew) {
    pass('meituan.fetch() still throws when the very first request fails (dead board reads as failure)');
  } else {
    fail('meituan.fetch() swallowed a first-request failure');
  }
} catch (e) {
  fail(`meituan provider tests crashed: ${e.message}`);
}
