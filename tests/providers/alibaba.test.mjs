// tests/providers/alibaba.test.mjs — Alibaba Group careers provider
// (talent.alibaba.com public JSON API). Added with the provider in the same
// PR; follows the discovered-test layout from #1440.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — alibaba (talent.alibaba.com JSON API)');
try {
  const alibaba = (await import(pathToFileURL(join(ROOT, 'providers/alibaba.mjs')).href)).default;
  const { parseAlibabaResponse } = await import(pathToFileURL(join(ROOT, 'providers/alibaba.mjs')).href);

  if (alibaba.id === 'alibaba') pass('alibaba.id is "alibaba"');
  else fail(`alibaba.id is ${JSON.stringify(alibaba.id)}`);

  const hit = alibaba.detect({ name: '阿里巴巴', careers_url: 'https://talent.alibaba.com/off-campus/position-list' });
  if (hit && hit.url === 'https://talent.alibaba.com/off-campus/position-list') {
    pass('alibaba.detect() claims talent.alibaba.com URLs');
  } else {
    fail(`alibaba.detect() returned ${JSON.stringify(hit)}`);
  }

  if (alibaba.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('alibaba.detect() returns null for non-Alibaba URLs');
  } else {
    fail('alibaba.detect() should return null for non-Alibaba URLs');
  }

  if (alibaba.detect({ name: 'X', careers_url: 'https://evil.example/talent.alibaba.com' }) === null) {
    pass('alibaba.detect() rejects path-spoofed hosts');
  } else {
    fail('alibaba.detect() should reject path-spoofed hosts');
  }

  if (alibaba.detect({ name: 'X', careers_url: 'http://talent.alibaba.com/off-campus/position-list' }) === null) {
    pass('alibaba.detect() is HTTPS-only');
  } else {
    fail('alibaba.detect() should reject http:// URLs');
  }

  if (alibaba.detect({ name: 'X', careers_url: 12345 }) === null) {
    pass('alibaba.detect() returns null for a non-string careers_url');
  } else {
    fail('alibaba.detect() should return null for a non-string careers_url');
  }

  // parseAlibabaResponse
  const sample = {
    success: true,
    content: {
      totalCount: 42,
      currentPage: 1,
      datas: [
        {
          id: 100009135010,
          name: '大模型后训练工程师',
          workLocations: ['杭州', '北京'],
          categories: ['技术类-开发'],
          experience: { from: 3, to: 5 },
          description: '负责大模型后训练服务。',
          requirement: '熟练掌握 Python。',
          publishTime: 1783501139000,
          modifyTime: 1783600000000,
          positionUrl: '/off-campus/position-detail?positionId=100009135010&track_id=SSPabc123',
        },
        {
          id: 100018660002,
          name: '大模型算法专家',
          workLocations: ['杭州'],
          experience: { from: 10, to: null },
          modifyTime: 1784197983000,
        },
        { id: 100025100003 },
        { name: '无ID岗位' },
      ],
    },
  };
  const { jobs, total } = parseAlibabaResponse(sample, '阿里巴巴');

  if (total === 42) pass('parseAlibabaResponse() reads content.totalCount as total');
  else fail(`parseAlibabaResponse() total = ${total}`);

  if (jobs.length === 2) pass('parseAlibabaResponse() keeps titled+ID posts, drops incomplete ones');
  else fail(`parseAlibabaResponse() returned ${jobs.length} jobs, expected 2`);

  const j1 = jobs[0];
  if (j1 && j1.url === 'https://talent.alibaba.com/off-campus/position-detail?positionId=100009135010' && j1.location === '杭州/北京') {
    pass('parseAlibabaResponse() builds a track_id-free detail URL from the id and joins workLocations');
  } else {
    fail(`parseAlibabaResponse() job[0] = ${JSON.stringify(j1)}`);
  }

  if (j1 && j1.description.includes('类别: 技术类-开发') && j1.description.includes('经验: 3-5年') && j1.description.includes('负责大模型后训练服务。')) {
    pass('parseAlibabaResponse() packs categories/experience/description/requirement into description');
  } else {
    fail(`parseAlibabaResponse() description = ${JSON.stringify(j1 && j1.description)}`);
  }

  if (j1 && j1.postedAt === 1783501139000) {
    pass('parseAlibabaResponse() prefers publishTime for postedAt');
  } else {
    fail(`parseAlibabaResponse() postedAt = ${j1 && j1.postedAt}`);
  }

  const j2 = jobs[1];
  if (j2 && j2.postedAt === 1784197983000 && j2.description.includes('经验: 10年以上')) {
    pass('parseAlibabaResponse() falls back to modifyTime and formats open-ended experience');
  } else {
    fail(`parseAlibabaResponse() job[1] = ${JSON.stringify(j2)}`);
  }

  const empty = parseAlibabaResponse({ success: true, content: { totalCount: 0, datas: null } }, '阿里巴巴');
  if (empty.jobs.length === 0 && empty.total === 0) {
    pass('parseAlibabaResponse() handles a missing datas array');
  } else {
    fail(`parseAlibabaResponse() empty payload → ${JSON.stringify(empty)}`);
  }

  // fetch() — CSRF pairing, pagination, cross-keyword dedup, page caps (mocked ctx)
  const ALI_URL = 'https://talent.alibaba.com/off-campus/position-list';
  const mkJob = (id, title) => ({ id, name: title, workLocations: ['杭州'] });
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
          const call = { key: body.key, pageIndex: body.pageIndex, headers: opts.headers };
          calls.push(call);
          return impl(call, calls.length);
        },
      },
    };
  };

  const paged = mkCtx(({ pageIndex }) => ({
    success: true,
    content: {
      totalCount: 150,
      datas: pageIndex === 1
        ? Array.from({ length: 100 }, (_, i) => mkJob(1000 + i, `岗位A${i}`))
        : Array.from({ length: 50 }, (_, i) => mkJob(2000 + i, `岗位B${i}`)),
    },
  }));
  const pagedJobs = await alibaba.fetch({ name: '阿里巴巴', careers_url: ALI_URL, keywords: ['AI'] }, paged.ctx);
  if (pagedJobs.length === 150 && paged.calls.length === 2) {
    pass('alibaba.fetch() paginates until totalCount is exhausted (150 posts → 2 requests)');
  } else {
    fail(`alibaba.fetch() pagination: ${pagedJobs.length} jobs, ${paged.calls.length} requests`);
  }

  if (paged.sleeps.length === 1 && paged.sleeps[0] > 0) {
    pass('alibaba.fetch() paces follow-up requests via ctx.sleep (no delay before the first request)');
  } else {
    fail(`alibaba.fetch() ctx.sleep calls: ${JSON.stringify(paged.sleeps)}`);
  }

  const h = paged.calls[0].headers || {};
  const cookieToken = /^XSRF-TOKEN=(.+)$/.exec(h.cookie || '')?.[1];
  if (cookieToken && h['x-xsrf-token'] === cookieToken) {
    pass('alibaba.fetch() sends a matching XSRF-TOKEN cookie / x-xsrf-token header pair');
  } else {
    fail(`alibaba.fetch() CSRF headers = ${JSON.stringify(h)}`);
  }

  const overlap = mkCtx(() => ({
    success: true,
    content: { totalCount: 1, datas: [mkJob(42, '重复岗位')] },
  }));
  const overlapJobs = await alibaba.fetch({ name: '阿里巴巴', careers_url: ALI_URL, keywords: ['AI', '大模型'] }, overlap.ctx);
  if (overlapJobs.length === 1 && overlap.calls.length === 2 && overlap.sleeps.length === 1) {
    pass('alibaba.fetch() dedupes across keywords and paces the keyword switch');
  } else {
    fail(`alibaba.fetch() cross-keyword: ${overlapJobs.length} jobs, ${overlap.calls.length} requests, sleeps ${JSON.stringify(overlap.sleeps)}`);
  }

  const capped = mkCtx(() => ({
    success: true,
    content: { totalCount: 500, datas: Array.from({ length: 100 }, (_, i) => mkJob(5000 + i, `岗位E${i}`)) },
  }));
  await alibaba.fetch({ name: '阿里巴巴', careers_url: ALI_URL, keywords: ['AI'], max_pages: 1 }, capped.ctx);
  if (capped.calls.length === 1) {
    pass('alibaba.fetch() honors entry.max_pages');
  } else {
    fail(`alibaba.fetch() entry.max_pages=1 made ${capped.calls.length} requests`);
  }

  const probe = mkCtx(() => ({
    success: true,
    content: { totalCount: 500, datas: Array.from({ length: 100 }, (_, i) => mkJob(6000 + i, `岗位F${i}`)) },
  }));
  probe.ctx.maxPages = 1;
  const probeJobs = await alibaba.fetch({ name: '阿里巴巴', careers_url: ALI_URL }, probe.ctx);
  if (probe.calls.length === 1 && probe.calls[0].key === '' && probeJobs.length === 100) {
    pass('alibaba.fetch() honors the ctx.maxPages probe hint and defaults to a whole-board (empty keyword) query');
  } else {
    fail(`alibaba.fetch() ctx.maxPages=1: ${probe.calls.length} requests, key=${JSON.stringify(probe.calls[0] && probe.calls[0].key)}`);
  }

  const blip = mkCtx(({ key }) => {
    if (key === '大模型') throw new Error('HTTP 503');
    return { success: true, content: { totalCount: 1, datas: [mkJob(7, '幸存岗位')] } };
  });
  const blipJobs = await alibaba.fetch({ name: '阿里巴巴', careers_url: ALI_URL, keywords: ['AI', '大模型'] }, blip.ctx);
  if (blipJobs.length === 1 && blipJobs[0].title === '幸存岗位') {
    pass('alibaba.fetch() keeps already-collected jobs when a later request fails');
  } else {
    fail(`alibaba.fetch() partial results on failure: ${JSON.stringify(blipJobs.map(j => j.title))}`);
  }

  const softFail = mkCtx(({ key }) => (key === '大模型'
    ? { success: false, errorMsg: 'rate limited' }
    : { success: true, content: { totalCount: 1, datas: [mkJob(8, '幸存岗位2')] } }));
  const softFailJobs = await alibaba.fetch({ name: '阿里巴巴', careers_url: ALI_URL, keywords: ['AI', '大模型'] }, softFail.ctx);
  if (softFailJobs.length === 1 && softFailJobs[0].title === '幸存岗位2') {
    pass('alibaba.fetch() treats an in-band success:false as a blip once jobs are collected');
  } else {
    fail(`alibaba.fetch() success:false blip: ${JSON.stringify(softFailJobs.map(j => j.title))}`);
  }

  let softDeadThrew = false;
  const softDead = mkCtx(() => ({ success: false, errorCode: 'SYS_ERROR' }));
  try {
    await alibaba.fetch({ name: '阿里巴巴', careers_url: ALI_URL, keywords: ['AI'] }, softDead.ctx);
  } catch { softDeadThrew = true; }
  if (softDeadThrew) {
    pass('alibaba.fetch() throws when the very first response reports success:false (dead board, not empty board)');
  } else {
    fail('alibaba.fetch() swallowed a first-response success:false');
  }

  let firstFailThrew = false;
  const dead = mkCtx(() => { throw new Error('HTTP 500'); });
  try {
    await alibaba.fetch({ name: '阿里巴巴', careers_url: ALI_URL, keywords: ['AI'] }, dead.ctx);
  } catch { firstFailThrew = true; }
  if (firstFailThrew) {
    pass('alibaba.fetch() still throws when the very first request fails (dead board reads as failure)');
  } else {
    fail('alibaba.fetch() swallowed a first-request failure');
  }
} catch (e) {
  fail(`alibaba provider tests crashed: ${e.message}`);
}
