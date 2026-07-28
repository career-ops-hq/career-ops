// tests/providers/tencent.test.mjs — Tencent careers provider (careers.tencent.com
// public JSON API). Added with the provider in the same PR; follows the
// discovered-test layout from #1440.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — tencent (careers.tencent.com JSON API)');
try {
  const tencent = (await import(pathToFileURL(join(ROOT, 'providers/tencent.mjs')).href)).default;
  const { parseTencentResponse } = await import(pathToFileURL(join(ROOT, 'providers/tencent.mjs')).href);

  if (tencent.id === 'tencent') pass('tencent.id is "tencent"');
  else fail(`tencent.id is ${JSON.stringify(tencent.id)}`);

  const hit = tencent.detect({ name: '腾讯', careers_url: 'https://careers.tencent.com/search.html' });
  if (hit && hit.url === 'https://careers.tencent.com/search.html') {
    pass('tencent.detect() claims careers.tencent.com URLs');
  } else {
    fail(`tencent.detect() returned ${JSON.stringify(hit)}`);
  }

  if (tencent.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('tencent.detect() returns null for non-Tencent URLs');
  } else {
    fail('tencent.detect() should return null for non-Tencent URLs');
  }

  if (tencent.detect({ name: 'X', careers_url: 'https://evil.example/careers.tencent.com' }) === null) {
    pass('tencent.detect() rejects path-spoofed hosts');
  } else {
    fail('tencent.detect() should reject path-spoofed hosts');
  }

  if (tencent.detect({ name: 'X', careers_url: 'http://careers.tencent.com/search.html' }) === null) {
    pass('tencent.detect() is HTTPS-only');
  } else {
    fail('tencent.detect() should reject http:// URLs');
  }

  if (tencent.detect({ name: 'X', careers_url: 12345 }) === null) {
    pass('tencent.detect() returns null for a non-string careers_url');
  } else {
    fail('tencent.detect() should return null for a non-string careers_url');
  }

  // parseTencentResponse
  const sample = {
    Data: {
      Count: 42,
      Posts: [
        {
          PostId: '1001',
          RecruitPostName: '大模型算法工程师',
          PostURL: 'http://careers.tencent.com/jobdesc.html?postId=1001',
          CountryName: '中国',
          LocationName: '深圳',
          BGName: 'TEG',
          CategoryName: '技术',
          RequireWorkYearsName: '3年',
          Responsibility: '负责大模型训练与推理优化。',
          LastUpdateTime: '2026年06月23日',
        },
        {
          PostId: '1002',
          RecruitPostName: 'AI产品经理',
          CountryName: '中国',
          LocationName: '北京',
          LastUpdateTime: 'not a date',
        },
        { PostId: '1003' },
      ],
    },
  };
  const { jobs, total } = parseTencentResponse(sample, '腾讯');

  if (total === 42) pass('parseTencentResponse() reads Data.Count as total');
  else fail(`parseTencentResponse() total = ${total}`);

  if (jobs.length === 2) pass('parseTencentResponse() keeps titled posts, drops title-less ones');
  else fail(`parseTencentResponse() returned ${jobs.length} jobs, expected 2`);

  const j1 = jobs[0];
  if (j1 && j1.url === 'http://careers.tencent.com/jobdesc.html?postId=1001' && j1.location === '中国-深圳') {
    pass('parseTencentResponse() maps PostURL and joins country-city location');
  } else {
    fail(`parseTencentResponse() job[0] = ${JSON.stringify(j1)}`);
  }

  if (j1 && j1.description.includes('BG: TEG') && j1.description.includes('负责大模型')) {
    pass('parseTencentResponse() packs BG/category/JD text into description');
  } else {
    fail(`parseTencentResponse() description = ${JSON.stringify(j1 && j1.description)}`);
  }

  if (j1 && j1.postedAt === Date.UTC(2026, 5, 23)) {
    pass('parseTencentResponse() parses 年月日 dates to epoch ms');
  } else {
    fail(`parseTencentResponse() postedAt = ${j1 && j1.postedAt}`);
  }

  const j2 = jobs[1];
  if (j2 && j2.url === 'https://careers.tencent.com/jobdesc.html?postId=1002' && j2.postedAt === undefined) {
    pass('parseTencentResponse() falls back to PostId URL, undefined postedAt on bad dates');
  } else {
    fail(`parseTencentResponse() job[1] = ${JSON.stringify(j2)}`);
  }

  const empty = parseTencentResponse({ Data: { Count: 0, Posts: null } }, '腾讯');
  if (empty.jobs.length === 0 && empty.total === 0) {
    pass('parseTencentResponse() handles a missing Posts array');
  } else {
    fail(`parseTencentResponse() empty payload → ${JSON.stringify(empty)}`);
  }

  // fetch() — pagination, cross-keyword dedup, page caps (mocked ctx)
  const TENCENT_URL = 'https://careers.tencent.com/search.html';
  const mkPost = (id, title) => ({
    PostId: String(id),
    RecruitPostName: title,
    CountryName: '中国',
    LocationName: '深圳',
    LastUpdateTime: '2026年07月01日',
  });
  const mkCtx = (impl) => {
    const calls = [];
    const sleeps = [];
    return {
      calls,
      sleeps,
      ctx: {
        sleep: async (ms) => { sleeps.push(ms); },
        fetchJson: async (url) => {
          const u = new URL(url);
          const keyword = u.searchParams.get('keyword');
          const page = Number(u.searchParams.get('pageIndex'));
          calls.push({ keyword, page });
          return impl(keyword, page);
        },
      },
    };
  };

  const paged = mkCtx((_kw, page) => ({
    Code: 200,
    Data: {
      Count: 150,
      Posts: page === 1
        ? Array.from({ length: 100 }, (_, i) => mkPost(1000 + i, `岗位A${i}`))
        : Array.from({ length: 50 }, (_, i) => mkPost(2000 + i, `岗位B${i}`)),
    },
  }));
  const pagedJobs = await tencent.fetch({ name: '腾讯', careers_url: TENCENT_URL, keywords: ['AI'] }, paged.ctx);
  if (pagedJobs.length === 150 && paged.calls.length === 2) {
    pass('tencent.fetch() paginates until Data.Count is exhausted (150 posts → 2 requests)');
  } else {
    fail(`tencent.fetch() pagination: ${pagedJobs.length} jobs, ${paged.calls.length} requests`);
  }

  if (paged.sleeps.length === 1 && paged.sleeps[0] > 0) {
    pass('tencent.fetch() paces follow-up pages via ctx.sleep (no delay before the first request)');
  } else {
    fail(`tencent.fetch() ctx.sleep calls: ${JSON.stringify(paged.sleeps)}`);
  }

  const overlap = mkCtx(() => ({
    Code: 200,
    Data: { Count: 1, Posts: [mkPost(42, '重复岗位')] },
  }));
  const overlapJobs = await tencent.fetch({ name: '腾讯', careers_url: TENCENT_URL, keywords: ['AI', '大模型'] }, overlap.ctx);
  if (overlapJobs.length === 1 && overlap.calls.length === 2) {
    pass('tencent.fetch() dedupes the same job URL across keywords');
  } else {
    fail(`tencent.fetch() cross-keyword dedup: ${overlapJobs.length} jobs, ${overlap.calls.length} requests`);
  }

  if (overlap.sleeps.length === 1) {
    pass('tencent.fetch() also paces keyword switches (page 1 of keyword 2 pays the delay)');
  } else {
    fail(`tencent.fetch() keyword-switch pacing: ${JSON.stringify(overlap.sleeps)}`);
  }

  const capped = mkCtx(() => ({
    Code: 200,
    Data: { Count: 500, Posts: Array.from({ length: 100 }, (_, i) => mkPost(3000 + i, `岗位C${i}`)) },
  }));
  await tencent.fetch({ name: '腾讯', careers_url: TENCENT_URL, keywords: ['AI'], max_pages: 1 }, capped.ctx);
  if (capped.calls.length === 1) {
    pass('tencent.fetch() honors entry.max_pages');
  } else {
    fail(`tencent.fetch() entry.max_pages=1 made ${capped.calls.length} requests`);
  }

  const probe = mkCtx(() => ({
    Code: 200,
    Data: { Count: 500, Posts: Array.from({ length: 100 }, (_, i) => mkPost(4000 + i, `岗位D${i}`)) },
  }));
  probe.ctx.maxPages = 1;
  const probeJobs = await tencent.fetch({ name: '腾讯', careers_url: TENCENT_URL }, probe.ctx);
  if (probe.calls.length === 1 && probe.calls[0].keyword === '' && probeJobs.length === 100) {
    pass('tencent.fetch() honors the ctx.maxPages probe hint and defaults to a whole-board (empty keyword) query');
  } else {
    fail(`tencent.fetch() ctx.maxPages=1: ${probe.calls.length} requests, keyword=${JSON.stringify(probe.calls[0] && probe.calls[0].keyword)}`);
  }

  const blip = mkCtx((keyword) => {
    if (keyword === '大模型') throw new Error('HTTP 503');
    return { Code: 200, Data: { Count: 1, Posts: [mkPost(7, '幸存岗位')] } };
  });
  const blipJobs = await tencent.fetch({ name: '腾讯', careers_url: TENCENT_URL, keywords: ['AI', '大模型'] }, blip.ctx);
  if (blipJobs.length === 1 && blipJobs[0].title === '幸存岗位') {
    pass('tencent.fetch() keeps already-collected jobs when a later request fails');
  } else {
    fail(`tencent.fetch() partial results on failure: ${JSON.stringify(blipJobs.map(j => j.title))}`);
  }

  const zeroThenBlip = mkCtx((keyword) => {
    if (keyword === '大模型') throw new Error('HTTP 503');
    return { Code: 200, Data: { Count: 0, Posts: [] } };
  });
  let zeroThenBlipJobs;
  let zeroThenBlipThrew = false;
  try {
    zeroThenBlipJobs = await tencent.fetch({ name: '腾讯', careers_url: TENCENT_URL, keywords: ['AI', '大模型'] }, zeroThenBlip.ctx);
  } catch { zeroThenBlipThrew = true; }
  if (!zeroThenBlipThrew && Array.isArray(zeroThenBlipJobs) && zeroThenBlipJobs.length === 0) {
    pass('tencent.fetch() treats a later failure as a blip even when earlier keywords matched 0 jobs (board is alive)');
  } else {
    fail(`tencent.fetch() 0-result keyword then 503: ${zeroThenBlipThrew ? 'threw' : JSON.stringify(zeroThenBlipJobs)}`);
  }

  let firstFailThrew = false;
  const dead = mkCtx(() => { throw new Error('HTTP 500'); });
  try {
    await tencent.fetch({ name: '腾讯', careers_url: TENCENT_URL, keywords: ['AI'] }, dead.ctx);
  } catch { firstFailThrew = true; }
  if (firstFailThrew) {
    pass('tencent.fetch() still throws when the very first request fails (dead board reads as failure)');
  } else {
    fail('tencent.fetch() swallowed a first-request failure');
  }
} catch (e) {
  fail(`tencent provider tests crashed: ${e.message}`);
}

