// tests/providers/feishu-jobs.test.mjs — Feishu Jobs (飞书招聘) careers
// provider. Covers the dedicated host and a fictional shared-platform tenant,
// the UA header this provider always sends, and the
// parse/fetch behaviors shared with the other China-market providers.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — feishu-jobs (Feishu Jobs / ATSX search/job/posts JSON API)');
try {
  const modUrl = pathToFileURL(join(ROOT, 'providers/feishu-jobs.mjs')).href;
  const feishu = (await import(modUrl)).default;
  const { parseFeishuJobsResponse } = await import(modUrl);
  const { MACOS_BROWSER_LIKE_USER_AGENT } = await import(
    pathToFileURL(join(ROOT, 'providers/_http.mjs')).href
  );

  if (feishu.id === 'feishu-jobs') pass('feishu-jobs.id is "feishu-jobs"');
  else fail(`feishu-jobs.id is ${JSON.stringify(feishu.id)}`);

  const bd = feishu.detect({ name: 'Example Dedicated Host', careers_url: 'https://jobs.bytedance.com' });
  if (bd && bd.url === 'https://jobs.bytedance.com') {
    pass('feishu-jobs.detect() claims jobs.bytedance.com');
  } else {
    fail(`feishu-jobs.detect() on jobs.bytedance.com returned ${JSON.stringify(bd)}`);
  }

  const tenant = feishu.detect({ name: 'Example Labs', careers_url: 'https://example-labs.jobs.feishu.cn' });
  if (tenant && tenant.url === 'https://example-labs.jobs.feishu.cn') {
    pass('feishu-jobs.detect() claims any *.jobs.feishu.cn tenant subdomain');
  } else {
    fail(`feishu-jobs.detect() on a shared-platform tenant returned ${JSON.stringify(tenant)}`);
  }

  if (feishu.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('feishu-jobs.detect() returns null for unrelated URLs');
  } else {
    fail('feishu-jobs.detect() should return null for unrelated URLs');
  }

  if (feishu.detect({ name: 'X', careers_url: 'https://evil.example/jobs.feishu.cn' }) === null) {
    pass('feishu-jobs.detect() rejects path-spoofed hosts');
  } else {
    fail('feishu-jobs.detect() should reject path-spoofed hosts');
  }

  if (feishu.detect({ name: 'X', careers_url: 'http://jobs.bytedance.com' }) === null) {
    pass('feishu-jobs.detect() is HTTPS-only');
  } else {
    fail('feishu-jobs.detect() should reject http:// URLs');
  }

  if (feishu.detect({ name: 'X', careers_url: 12345 }) === null) {
    pass('feishu-jobs.detect() returns null for a non-string careers_url');
  } else {
    fail('feishu-jobs.detect() should return null for a non-string careers_url');
  }

  if (feishu.detect({ name: 'X', careers_url: 'not a url' }) === null) {
    pass('feishu-jobs.detect() returns null for a malformed URL string');
  } else {
    fail('feishu-jobs.detect() should return null for a malformed URL string');
  }

  // parseFeishuJobsResponse
  const sample = {
    code: 0,
    data: {
      count: 192,
      job_post_list: [
        {
          id: '7669788190274914586',
          title: '国内增长投放专家',
          description: '负责AI产品增长。',
          requirement: '3年以上经验。',
          job_category: { name: '广告投放' },
          recruit_type: { name: '全职' },
          publish_time: 1785762382342,
          city_list: [{ name: '上海' }, { name: '北京' }],
        },
        { id: '2', title: '无城市岗位', description: 'd', requirement: 'r' },
        { id: '3' },       // no title — dropped
        { title: '无ID岗位' }, // no id — dropped
      ],
    },
  };
  const { jobs, total } = parseFeishuJobsResponse(sample, 'Example Labs', 'https://example-labs.jobs.feishu.cn');

  if (total === 192) pass('parseFeishuJobsResponse() reads data.count as total');
  else fail(`parseFeishuJobsResponse() total = ${total}`);

  if (jobs.length === 2) pass('parseFeishuJobsResponse() keeps titled+ID posts, drops incomplete ones');
  else fail(`parseFeishuJobsResponse() returned ${jobs.length} jobs, expected 2`);

  const j1 = jobs[0];
  if (j1 && j1.url === 'https://example-labs.jobs.feishu.cn/index/position/7669788190274914586/detail' && j1.location === '上海/北京') {
    pass('parseFeishuJobsResponse() builds the shared-tenant detail URL and joins city_list');
  } else {
    fail(`parseFeishuJobsResponse() job[0] = ${JSON.stringify(j1)}`);
  }

  const byteDanceJob = parseFeishuJobsResponse(sample, 'Example Dedicated Host', 'https://jobs.bytedance.com').jobs[0];
  if (byteDanceJob?.url === 'https://jobs.bytedance.com/experienced/position/7669788190274914586/detail') {
    pass('parseFeishuJobsResponse() builds the ByteDance experienced-hire detail URL');
  } else {
    fail(`parseFeishuJobsResponse() ByteDance URL = ${JSON.stringify(byteDanceJob?.url)}`);
  }

  if (j1 && j1.description.includes('类别: 广告投放') && j1.description.includes('类型: 全职')
      && j1.description.includes('负责AI产品增长。') && j1.description.includes('3年以上经验。')) {
    pass('parseFeishuJobsResponse() packs category/recruit_type/description/requirement into description');
  } else {
    fail(`parseFeishuJobsResponse() description = ${JSON.stringify(j1 && j1.description)}`);
  }

  if (j1 && j1.postedAt === 1785762382342) {
    pass('parseFeishuJobsResponse() reads publish_time as postedAt');
  } else {
    fail(`parseFeishuJobsResponse() postedAt = ${j1 && j1.postedAt}`);
  }

  const j2 = jobs[1];
  if (j2 && j2.location === '') {
    pass('parseFeishuJobsResponse() handles a missing city_list as empty location');
  } else {
    fail(`parseFeishuJobsResponse() job[1].location = ${JSON.stringify(j2 && j2.location)}`);
  }

  const empty = parseFeishuJobsResponse({ code: 0, data: { count: 0, job_post_list: null } }, 'X', 'https://x.jobs.feishu.cn');
  if (empty.jobs.length === 0 && empty.total === 0) {
    pass('parseFeishuJobsResponse() handles a missing job_post_list array');
  } else {
    fail(`parseFeishuJobsResponse() empty payload → ${JSON.stringify(empty)}`);
  }

  // fetch() — UA/Referer header, pagination, cross-keyword dedup, page caps (mocked ctx)
  const TENANT_URL = 'https://example-labs.jobs.feishu.cn';
  const mkJob = (id, title) => ({ id, title, city_list: [{ name: '北京' }] });
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
          const call = {
            keyword: body.keyword,
            offset: body.offset,
            limit: body.limit,
            headers: opts.headers,
            redirect: opts.redirect,
          };
          calls.push(call);
          return impl(call, calls.length);
        },
      },
    };
  };

  const paged = mkCtx(({ offset }) => ({
    code: 0,
    data: {
      count: 150,
      job_post_list: offset === 0
        ? Array.from({ length: 100 }, (_, i) => mkJob(String(1000 + i), `岗位A${i}`))
        : Array.from({ length: 50 }, (_, i) => mkJob(String(2000 + i), `岗位B${i}`)),
    },
  }));
  const pagedJobs = await feishu.fetch({ name: 'Example Labs', careers_url: TENANT_URL, keywords: ['AI'] }, paged.ctx);
  if (pagedJobs.length === 150 && paged.calls.length === 2) {
    pass('feishu-jobs.fetch() paginates via offset until count is exhausted (150 posts → 2 requests)');
  } else {
    fail(`feishu-jobs.fetch() pagination: ${pagedJobs.length} jobs, ${paged.calls.length} requests`);
  }

  if (paged.calls[0].offset === 0 && paged.calls[1].offset === 100) {
    pass('feishu-jobs.fetch() advances offset by page size (100) across pages');
  } else {
    fail(`feishu-jobs.fetch() offsets = ${JSON.stringify(paged.calls.map(c => c.offset))}`);
  }

  if (paged.sleeps.length === 1 && paged.sleeps[0] > 0) {
    pass('feishu-jobs.fetch() paces follow-up requests via ctx.sleep (no delay before the first request)');
  } else {
    fail(`feishu-jobs.fetch() ctx.sleep calls: ${JSON.stringify(paged.sleeps)}`);
  }

  const inventoryCount = 2101;
  const deepInventory = mkCtx(({ offset }) => ({
    code: 0,
    data: {
      count: inventoryCount,
      job_post_list: Array.from(
        { length: Math.max(0, Math.min(100, inventoryCount - offset)) },
        (_, i) => mkJob(String(10_000 + offset + i), `全量岗位${offset + i}`),
      ),
    },
  }));
  const deepInventoryJobs = await feishu.fetch({ name: 'Example Labs', careers_url: TENANT_URL }, deepInventory.ctx);
  if (deepInventoryJobs.length === inventoryCount && deepInventory.calls.length === 22) {
    pass('feishu-jobs.fetch() default budget covers inventories larger than the old 20-page ceiling');
  } else {
    fail(`feishu-jobs.fetch() default inventory coverage: ${deepInventoryJobs.length} jobs, ${deepInventory.calls.length} requests`);
  }

  const h = paged.calls[0].headers || {};
  if (h['user-agent'] === MACOS_BROWSER_LIKE_USER_AGENT && h.referer === `${TENANT_URL}/`) {
    pass('feishu-jobs.fetch() uses the shared macOS browser UA + a same-origin Referer');
  } else {
    fail(`feishu-jobs.fetch() headers = ${JSON.stringify(h)}`);
  }

  if (paged.calls.every((call) => call.redirect === 'error')) {
    pass('feishu-jobs.fetch() refuses redirects on every request');
  } else {
    fail(`feishu-jobs.fetch() redirect policy = ${JSON.stringify(paged.calls.map(call => call.redirect))}`);
  }

  const overlap = mkCtx(() => ({
    code: 0,
    data: { count: 1, job_post_list: [mkJob('42', '重复岗位')] },
  }));
  const overlapJobs = await feishu.fetch({ name: 'Example Labs', careers_url: TENANT_URL, keywords: ['AI', '大模型'] }, overlap.ctx);
  if (overlapJobs.length === 1 && overlap.calls.length === 2 && overlap.sleeps.length === 1) {
    pass('feishu-jobs.fetch() dedupes across keywords and paces the keyword switch');
  } else {
    fail(`feishu-jobs.fetch() cross-keyword: ${overlapJobs.length} jobs, ${overlap.calls.length} requests, sleeps ${JSON.stringify(overlap.sleeps)}`);
  }

  const capped = mkCtx(() => ({
    code: 0,
    data: { count: 500, job_post_list: Array.from({ length: 100 }, (_, i) => mkJob(String(5000 + i), `岗位E${i}`)) },
  }));
  const capWarnings = [];
  const originalConsoleError = console.error;
  console.error = (...args) => capWarnings.push(args.join(' '));
  try {
    await feishu.fetch({ name: 'Example Labs', careers_url: TENANT_URL, keywords: ['AI'], max_pages: 1 }, capped.ctx);
  } finally {
    console.error = originalConsoleError;
  }
  if (capped.calls.length === 1) {
    pass('feishu-jobs.fetch() honors entry.max_pages');
  } else {
    fail(`feishu-jobs.fetch() entry.max_pages=1 made ${capped.calls.length} requests`);
  }
  if (capWarnings.some((line) => line.includes('truncated at 100 of 500 postings'))) {
    pass('feishu-jobs.fetch() warns when max_pages truncates a known inventory');
  } else {
    fail(`feishu-jobs.fetch() truncation warnings = ${JSON.stringify(capWarnings)}`);
  }

  const probe = mkCtx(() => ({
    code: 0,
    data: { count: 500, job_post_list: Array.from({ length: 100 }, (_, i) => mkJob(String(6000 + i), `岗位F${i}`)) },
  }));
  probe.ctx.maxPages = 1;
  const probeJobs = await feishu.fetch({ name: 'Example Labs', careers_url: TENANT_URL }, probe.ctx);
  if (probe.calls.length === 1 && !probe.calls[0].keyword && probeJobs.length === 100) {
    pass('feishu-jobs.fetch() honors the ctx.maxPages probe hint and defaults to a whole-board (no keyword) query');
  } else {
    fail(`feishu-jobs.fetch() ctx.maxPages=1: ${probe.calls.length} requests, keyword=${JSON.stringify(probe.calls[0] && probe.calls[0].keyword)}`);
  }

  const fractionalEntryLimit = mkCtx(() => ({
    code: 0,
    data: { count: 1, job_post_list: [mkJob('7001', '默认页数岗位')] },
  }));
  const fractionalEntryJobs = await feishu.fetch(
    { name: 'Example Labs', careers_url: TENANT_URL, max_pages: 0.5 },
    fractionalEntryLimit.ctx,
  );
  if (fractionalEntryLimit.calls.length === 1 && fractionalEntryJobs.length === 1) {
    pass('feishu-jobs.fetch() ignores a fractional entry.max_pages instead of making zero requests');
  } else {
    fail(`feishu-jobs.fetch() max_pages=0.5: ${fractionalEntryLimit.calls.length} requests, ${fractionalEntryJobs.length} jobs`);
  }

  const fractionalProbeLimit = mkCtx(() => ({
    code: 0,
    data: { count: 1, job_post_list: [mkJob('7002', '探测页数岗位')] },
  }));
  fractionalProbeLimit.ctx.maxPages = 0.5;
  const fractionalProbeJobs = await feishu.fetch(
    { name: 'Example Labs', careers_url: TENANT_URL },
    fractionalProbeLimit.ctx,
  );
  if (fractionalProbeLimit.calls.length === 1 && fractionalProbeJobs.length === 1) {
    pass('feishu-jobs.fetch() ignores a fractional ctx.maxPages instead of making zero requests');
  } else {
    fail(`feishu-jobs.fetch() ctx.maxPages=0.5: ${fractionalProbeLimit.calls.length} requests, ${fractionalProbeJobs.length} jobs`);
  }

  const malformedFirstPage = mkCtx(({ offset }) => ({
    code: 0,
    data: {
      count: 101,
      job_post_list: offset === 0
        ? Array.from({ length: 100 }, (_, i) => ({ id: String(8000 + i) }))
        : [mkJob('8100', '后续有效岗位')],
    },
  }));
  const jobsAfterMalformedPage = await feishu.fetch(
    { name: 'Example Labs', careers_url: TENANT_URL },
    malformedFirstPage.ctx,
  );
  if (malformedFirstPage.calls.length === 2
      && jobsAfterMalformedPage.length === 1
      && jobsAfterMalformedPage[0].title === '后续有效岗位') {
    pass('feishu-jobs.fetch() continues after a source page whose records are all filtered out');
  } else {
    fail(`feishu-jobs.fetch() stopped after filtered records: ${malformedFirstPage.calls.length} requests, ${JSON.stringify(jobsAfterMalformedPage)}`);
  }

  const emptyThenFail = mkCtx(({ keyword }) => {
    if (keyword === '失败关键词') throw new Error('HTTP 503');
    return { code: 0, data: { count: 0, job_post_list: [] } };
  });
  let emptyThenFailThrew = false;
  try {
    await feishu.fetch(
      { name: 'Example Labs', careers_url: TENANT_URL, keywords: ['空关键词', '失败关键词'] },
      emptyThenFail.ctx,
    );
  } catch {
    emptyThenFailThrew = true;
  }
  if (emptyThenFailThrew && emptyThenFail.calls.length === 2) {
    pass('feishu-jobs.fetch() throws when a later keyword fails before any job is collected');
  } else {
    fail(`feishu-jobs.fetch() swallowed a failure with no partial jobs (threw=${emptyThenFailThrew}, calls=${emptyThenFail.calls.length})`);
  }

  const blip = mkCtx(({ keyword }) => {
    if (keyword === '大模型') throw new Error('HTTP 503');
    return { code: 0, data: { count: 1, job_post_list: [mkJob('7', '幸存岗位')] } };
  });
  const blipJobs = await feishu.fetch({ name: 'Example Labs', careers_url: TENANT_URL, keywords: ['AI', '大模型'] }, blip.ctx);
  if (blipJobs.length === 1 && blipJobs[0].title === '幸存岗位') {
    pass('feishu-jobs.fetch() keeps already-collected jobs when a later request fails');
  } else {
    fail(`feishu-jobs.fetch() partial results on failure: ${JSON.stringify(blipJobs.map(j => j.title))}`);
  }

  const softFail = mkCtx(({ keyword }) => (keyword === '大模型'
    ? { code: 1, message: 'rate limited' }
    : { code: 0, data: { count: 1, job_post_list: [mkJob('8', '幸存岗位2')] } }));
  const softFailJobs = await feishu.fetch({ name: 'Example Labs', careers_url: TENANT_URL, keywords: ['AI', '大模型'] }, softFail.ctx);
  if (softFailJobs.length === 1 && softFailJobs[0].title === '幸存岗位2') {
    pass('feishu-jobs.fetch() treats an in-band code!=0 as a blip once jobs are collected');
  } else {
    fail(`feishu-jobs.fetch() code!=0 blip: ${JSON.stringify(softFailJobs.map(j => j.title))}`);
  }

  const untrusted = mkCtx(() => ({ code: 0, data: { count: 0, job_post_list: [] } }));
  let untrustedThrew = false;
  try {
    await feishu.fetch({ name: 'X', careers_url: 'https://127.0.0.1/internal', provider: 'feishu-jobs' }, untrusted.ctx);
  } catch { untrustedThrew = true; }
  if (untrustedThrew && untrusted.calls.length === 0) {
    pass('feishu-jobs.fetch() rejects an untrusted explicit-provider URL before any request');
  } else {
    fail(`feishu-jobs.fetch() must not request an untrusted explicit-provider URL (threw=${untrustedThrew}, calls=${untrusted.calls.length})`);
  }

  let firstFailThrew = false;
  const dead = mkCtx(() => { throw new Error('HTTP 500'); });
  try {
    await feishu.fetch({ name: 'Example Labs', careers_url: TENANT_URL, keywords: ['AI'] }, dead.ctx);
  } catch { firstFailThrew = true; }
  if (firstFailThrew) {
    pass('feishu-jobs.fetch() still throws when the very first request fails (dead board reads as failure)');
  } else {
    fail('feishu-jobs.fetch() swallowed a first-request failure');
  }
} catch (e) {
  fail(`feishu-jobs provider tests crashed: ${e.message}`);
}
