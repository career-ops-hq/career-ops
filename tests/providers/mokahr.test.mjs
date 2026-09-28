// tests/providers/mokahr.test.mjs — MokaHR careers provider. Unlike every
// other provider in this directory, the API response body is AES-encrypted;
// most of this suite exercises decryptMokaHrEnvelope() and parseMokaHrJobs()
// with a synthetic AES round-trip that uses the observed production envelope
// shape, fixed IV, and key size.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { createCipheriv } from 'crypto';

console.log('\nProvider — mokahr (MokaHR AES-encrypted jobs/v2 API)');
try {
  const modUrl = pathToFileURL(join(ROOT, 'providers/mokahr.mjs')).href;
  const mokahr = (await import(modUrl)).default;
  const { decryptMokaHrEnvelope, parseMokaHrJobs } = await import(modUrl);
  const { normalizeUrlForDedup } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
  const { normalizeUrl } = await import(pathToFileURL(join(ROOT, 'url-key.mjs')).href);

  if (mokahr.id === 'mokahr') pass('mokahr.id is "mokahr"');
  else fail(`mokahr.id is ${JSON.stringify(mokahr.id)}`);

  const social = mokahr.detect({ name: 'Example Labs', careers_url: 'https://app.mokahr.com/social-recruitment/example-labs/123456' });
  if (social && social.url === 'https://app.mokahr.com/social-recruitment/example-labs/123456') {
    pass('mokahr.detect() claims a /social-recruitment/{org}/{id} tenant URL');
  } else {
    fail(`mokahr.detect() on social-recruitment URL returned ${JSON.stringify(social)}`);
  }

  const apply = mokahr.detect({ name: 'Example Studio', careers_url: 'https://app.mokahr.com/apply/example-studio/234567' });
  if (apply && apply.url === 'https://app.mokahr.com/apply/example-studio/234567') {
    pass('mokahr.detect() claims a /apply/{org}/{id} tenant URL (alternate path prefix)');
  } else {
    fail(`mokahr.detect() on apply-path URL returned ${JSON.stringify(apply)}`);
  }

  const campus = mokahr.detect({ name: 'Example University', careers_url: 'https://app.mokahr.com/campus-recruitment/example-university/345678' });
  if (campus && campus.url === 'https://app.mokahr.com/campus-recruitment/example-university/345678') {
    pass('mokahr.detect() claims a /campus-recruitment/{org}/{id} tenant URL');
  } else {
    fail(`mokahr.detect() on campus-recruitment URL returned ${JSON.stringify(campus)}`);
  }

  if (mokahr.detect({ name: 'X', careers_url: 'https://app.mokahr.com/social-recruitment/example-labs' }) === null) {
    pass('mokahr.detect() rejects a tenant path missing the numeric siteId');
  } else {
    fail('mokahr.detect() should reject a path without a numeric siteId');
  }

  if (
    mokahr.detect({ name: 'X', careers_url: 'https://app.mokahr.com/social-recruitment/x/0' }) === null &&
    mokahr.detect({ name: 'X', careers_url: 'https://app.mokahr.com/social-recruitment/x/99999999999999999999' }) === null
  ) {
    pass('mokahr.detect() requires a positive safe-integer siteId');
  } else {
    fail('mokahr.detect() should reject zero or unsafe-integer site IDs');
  }

  if (mokahr.detect({ name: 'X', careers_url: 'https://app.mokahr.com/some-other-page' }) === null) {
    pass('mokahr.detect() rejects a non-tenant path on the same host');
  } else {
    fail('mokahr.detect() should reject a non-tenant path');
  }

  if (mokahr.detect({ name: 'X', careers_url: 'https://evil.example/app.mokahr.com/social-recruitment/x/1' }) === null) {
    pass('mokahr.detect() rejects path-spoofed hosts');
  } else {
    fail('mokahr.detect() should reject path-spoofed hosts');
  }

  if (mokahr.detect({ name: 'X', careers_url: 'http://app.mokahr.com/social-recruitment/example-labs/123456' }) === null) {
    pass('mokahr.detect() is HTTPS-only');
  } else {
    fail('mokahr.detect() should reject http:// URLs');
  }

  if (
    mokahr.detect({ name: 'X', careers_url: 'https://app.mokahr.com/social-recruitment/lingjuninvest/46355' }) === null &&
    mokahr.detect({ name: 'X', careers_url: 'https://app.mokahr.com/social-recruitment/shopee/74378' }) === null &&
    mokahr.detect({ name: 'X', careers_url: 'https://app.mokahr.com/apply/shopee/74378' }) !== null
  ) {
    pass('mokahr.detect() rejects only the exact tenant paths disallowed by app.mokahr.com/robots.txt');
  } else {
    fail('mokahr.detect() should apply Moka robots exclusions at exact-path scope');
  }

  if (mokahr.detect({ name: 'X', careers_url: 12345 }) === null) {
    pass('mokahr.detect() returns null for a non-string careers_url');
  } else {
    fail('mokahr.detect() should return null for a non-string careers_url');
  }

  if (mokahr.detect({ name: 'X', careers_url: 'not a url' }) === null) {
    pass('mokahr.detect() returns null for a malformed URL string');
  } else {
    fail('mokahr.detect() should return null for a malformed URL string');
  }

  // decryptMokaHrEnvelope() — build a synthetic AES-128-CBC envelope with the
  // same key size and fixed IV observed in production.
  const AES_IV = Buffer.from('de7c21ed8d6f50fe', 'utf8');
  function encryptFixture(plainObj, keyHex) {
    const key = Buffer.from(keyHex, 'utf8');
    const cipher = createCipheriv('aes-128-cbc', key, AES_IV);
    const plaintext = Buffer.from(JSON.stringify(plainObj), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { data: ciphertext.toString('base64'), necromancer: keyHex };
  }

  const innerPayload = {
    code: 0,
    success: true,
    data: {
      jobStats: { orgId: 'example-labs', total: 0 },
      jobs: [
        {
          id: '7dcd6fde-84f1-4deb-890c-f1f275df0efc',
          title: '多模态理解（数据/算法）研究员',
          commitment: '全职',
          department: { id: 1, name: 'AI院' },
          locations: [{ cityName: '拱墅区', provinceName: '浙江' }, { cityName: '海淀区', provinceName: '北京市' }],
          jobDescription: '<p><strong>【工作职责】</strong></p><ul><li>负责多模态基座模型的迭代。</li></ul>',
          createdAt: '2026-06-25T14:23:06',
        },
        { id: '2', title: '无城市岗位', jobDescription: '<p>d</p>' },
        { id: '3' },              // no title — dropped
        { title: '无ID岗位' },     // no id — dropped
      ],
    },
  };
  const envelope = encryptFixture(innerPayload, '0dd380dfddd01404');
  const decrypted = decryptMokaHrEnvelope(envelope);

  if (decrypted?.data?.jobs?.length === 4) {
    pass('decryptMokaHrEnvelope() round-trips a synthetic AES-128-CBC envelope back to the original JSON');
  } else {
    fail(`decryptMokaHrEnvelope() result = ${JSON.stringify(decrypted)}`);
  }

  let missingFieldThrew = false;
  try { decryptMokaHrEnvelope({ data: 'x' }); } catch { missingFieldThrew = true; }
  if (missingFieldThrew) pass('decryptMokaHrEnvelope() throws when necromancer is missing');
  else fail('decryptMokaHrEnvelope() should throw on a missing necromancer key');

  let shortKeyThrew = false;
  try { decryptMokaHrEnvelope({ data: 'AAAA', necromancer: 'tooshort' }); } catch { shortKeyThrew = true; }
  if (shortKeyThrew) pass('decryptMokaHrEnvelope() throws when necromancer is not 16 bytes');
  else fail('decryptMokaHrEnvelope() should throw on a wrong-length key');

  // parseMokaHrJobs()
  const tenantUrl = 'https://app.mokahr.com/social-recruitment/example-labs/123456';
  const jobs = parseMokaHrJobs(decrypted, 'Example Labs', tenantUrl);
  if (jobs.length === 2) pass('parseMokaHrJobs() keeps titled+ID posts, drops incomplete ones');
  else fail(`parseMokaHrJobs() returned ${jobs.length} jobs, expected 2`);

  const j1 = jobs[0];
  if (j1 && j1.url === `${tenantUrl}#/job/7dcd6fde-84f1-4deb-890c-f1f275df0efc` && j1.location === '浙江 拱墅区/北京市 海淀区') {
    pass('parseMokaHrJobs() builds the tenant SPA #/job/{id} route');
  } else {
    fail(`parseMokaHrJobs() job[0] = ${JSON.stringify(j1)}`);
  }

  const j2Key = jobs[1];
  if (
    j1 && j2Key &&
    normalizeUrlForDedup(j1.url) !== normalizeUrlForDedup(j2Key.url) &&
    normalizeUrl(j1.url) !== normalizeUrl(j2Key.url)
  ) {
    pass('distinct Moka jobs remain distinct through both scanner and tracker URL normalization');
  } else {
    fail('Moka job URLs collapse after fragment-stripping normalization');
  }

  if (j1 && j1.description.includes('类型: 全职') && j1.description.includes('部门: AI院')
      && j1.description.includes('负责多模态基座模型的迭代。') && !j1.description.includes('<li>')) {
    pass('parseMokaHrJobs() packs commitment/department/plaintext-JD into description, HTML stripped');
  } else {
    fail(`parseMokaHrJobs() description = ${JSON.stringify(j1 && j1.description)}`);
  }

  const entityJob = parseMokaHrJobs({
    data: { jobs: [{
      id: 'entity-fixture',
      title: '实体解码岗位',
      jobDescription: '<p>Gr&#252;ße &quot;Team&quot;</p>&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;',
    }] },
  }, 'Example Labs', 'https://app.mokahr.com/social-recruitment/example-labs/123456')[0];
  if (entityJob?.description === 'Grüße "Team"') {
    pass('parseMokaHrJobs() decodes text entities without reviving encoded active markup');
  } else {
    fail(`parseMokaHrJobs() entity-safe description = ${JSON.stringify(entityJob?.description)}`);
  }

  if (j1 && j1.postedAt === undefined) {
    pass('parseMokaHrJobs() omits timezone-less createdAt values instead of emitting host-dependent epochs');
  } else {
    fail(`parseMokaHrJobs() postedAt = ${j1 && j1.postedAt}`);
  }

  const zoned = parseMokaHrJobs({
    data: { jobs: [{ id: 'tz', title: '带时区岗位', createdAt: '2026-06-25T14:23:06+08:00' }] },
  }, 'X', tenantUrl)[0];
  if (zoned && zoned.postedAt === 1782368586000) {
    pass('parseMokaHrJobs() parses an explicitly-zoned createdAt into a deterministic epoch');
  } else {
    fail(`parseMokaHrJobs() zoned postedAt = ${zoned && zoned.postedAt}`);
  }

  const j2 = jobs[1];
  if (j2 && j2.location === '') {
    pass('parseMokaHrJobs() handles a missing locations array as empty location');
  } else {
    fail(`parseMokaHrJobs() job[1].location = ${JSON.stringify(j2 && j2.location)}`);
  }

  const empty = parseMokaHrJobs({ data: { jobs: null } }, 'X', tenantUrl);
  if (empty.length === 0) pass('parseMokaHrJobs() handles a missing jobs array');
  else fail(`parseMokaHrJobs() empty payload → ${JSON.stringify(empty)}`);

  // fetch() — limit/offset pagination, cross-keyword dedup, page caps
  // (mocked ctx: encrypt a synthetic envelope per call so fetch() exercises the
  // full decrypt path, not just a plaintext stub).
  const MOKA_URL = 'https://app.mokahr.com/social-recruitment/example-labs/123456';
  const mkJob = (id, title) => ({ id, title, locations: [{ cityName: '北京' }] });
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
            siteId: body.siteId,
            orgId: body.orgId,
            redirect: opts.redirect,
          };
          calls.push(call);
          const inner = impl(call, calls.length);
          return encryptFixture(inner, '00112233445566aa');
        },
      },
    };
  };

  const invalid = mkCtx(() => innerPayload);
  let invalidThrew = false;
  try {
    await mokahr.fetch({ name: 'X', careers_url: 'https://example.com/not-a-tenant', provider: 'mokahr' }, invalid.ctx);
  } catch { invalidThrew = true; }
  if (invalidThrew && invalid.calls.length === 0) {
    pass('mokahr.fetch() rejects an invalid explicit-provider tenant before any request');
  } else {
    fail(`mokahr.fetch() must reject invalid explicit-provider tenants (threw=${invalidThrew}, calls=${invalid.calls.length})`);
  }

  const paged = mkCtx(({ offset }) => ({
    success: true,
    data: {
      jobStats: { total: 0 },
      jobs: offset === 0
        ? Array.from({ length: 50 }, (_, i) => mkJob(`a${i}`, `岗位A${i}`))
        : Array.from({ length: 20 }, (_, i) => mkJob(`b${i}`, `岗位B${i}`)),
    },
  }));
  const pagedJobs = await mokahr.fetch({ name: 'Example Labs', careers_url: MOKA_URL, keywords: ['AI'] }, paged.ctx);
  if (pagedJobs.length === 70 && paged.calls.length === 2) {
    pass('mokahr.fetch() paginates via offset until a page returns fewer than 50 jobs (70 posts → 2 requests)');
  } else {
    fail(`mokahr.fetch() pagination: ${pagedJobs.length} jobs, ${paged.calls.length} requests`);
  }

  if (paged.calls[0].limit === 50 && paged.calls[0].offset === 0 && paged.calls[1].offset === 50) {
    pass('mokahr.fetch() always requests limit=50 (the server ceiling) and advances offset by 50');
  } else {
    fail(`mokahr.fetch() calls = ${JSON.stringify(paged.calls)}`);
  }

  const malformedFullPage = mkCtx(({ offset }) => ({
    success: true,
    data: {
      jobs: offset === 0
        ? [...Array.from({ length: 49 }, (_, i) => mkJob(`m${i}`, `有效岗位${i}`)), { id: 'missing-title' }]
        : [mkJob('next-page', '下一页岗位')],
    },
  }));
  const malformedFullPageJobs = await mokahr.fetch(
    { name: 'Example Labs', careers_url: MOKA_URL, keywords: ['AI'] },
    malformedFullPage.ctx,
  );
  if (malformedFullPageJobs.length === 50 && malformedFullPage.calls.length === 2) {
    pass('mokahr.fetch() paginates by raw page length when normalization drops a malformed row');
  } else {
    fail(`mokahr.fetch() malformed full page: ${malformedFullPageJobs.length} jobs, ${malformedFullPage.calls.length} requests`);
  }

  if (paged.calls[0].siteId === 123456 && paged.calls[0].orgId === 'example-labs') {
    pass('mokahr.fetch() extracts siteId/orgId from the tenant careers_url');
  } else {
    fail(`mokahr.fetch() siteId/orgId = ${JSON.stringify({ siteId: paged.calls[0].siteId, orgId: paged.calls[0].orgId })}`);
  }

  if (paged.calls.every((call) => call.redirect === 'error')) {
    pass('mokahr.fetch() refuses redirects on every request');
  } else {
    fail(`mokahr.fetch() redirect policy = ${JSON.stringify(paged.calls.map(call => call.redirect))}`);
  }

  if (paged.sleeps.length === 1 && paged.sleeps[0] > 0) {
    pass('mokahr.fetch() paces follow-up requests via ctx.sleep (no delay before the first request)');
  } else {
    fail(`mokahr.fetch() ctx.sleep calls: ${JSON.stringify(paged.sleeps)}`);
  }

  const overlap = mkCtx(() => ({ success: true, data: { jobStats: { total: 0 }, jobs: [mkJob('dup', '重复岗位')] } }));
  const overlapJobs = await mokahr.fetch({ name: 'Example Labs', careers_url: MOKA_URL, keywords: ['AI', '大模型'] }, overlap.ctx);
  if (overlapJobs.length === 1 && overlap.calls.length === 2 && overlap.sleeps.length === 1) {
    pass('mokahr.fetch() dedupes across keywords and paces the keyword switch');
  } else {
    fail(`mokahr.fetch() cross-keyword: ${overlapJobs.length} jobs, ${overlap.calls.length} requests, sleeps ${JSON.stringify(overlap.sleeps)}`);
  }

  const capped = mkCtx(() => ({ success: true, data: { jobStats: { total: 0 }, jobs: Array.from({ length: 50 }, (_, i) => mkJob(`c${i}`, `岗位C${i}`)) } }));
  await mokahr.fetch({ name: 'Example Labs', careers_url: MOKA_URL, keywords: ['AI'], max_pages: 1 }, capped.ctx);
  if (capped.calls.length === 1) {
    pass('mokahr.fetch() honors entry.max_pages');
  } else {
    fail(`mokahr.fetch() entry.max_pages=1 made ${capped.calls.length} requests`);
  }

  const probe = mkCtx(() => ({ success: true, data: { jobStats: { total: 0 }, jobs: Array.from({ length: 50 }, (_, i) => mkJob(`d${i}`, `岗位D${i}`)) } }));
  probe.ctx.maxPages = 1;
  const probeJobs = await mokahr.fetch({ name: 'Example Labs', careers_url: MOKA_URL }, probe.ctx);
  if (probe.calls.length === 1 && !probe.calls[0].keyword && probeJobs.length === 50) {
    pass('mokahr.fetch() honors the ctx.maxPages probe hint and defaults to a whole-board (no keyword) query');
  } else {
    fail(`mokahr.fetch() ctx.maxPages=1: ${probe.calls.length} requests, keyword=${JSON.stringify(probe.calls[0] && probe.calls[0].keyword)}`);
  }

  const blip = mkCtx(({ keyword }) => {
    if (keyword === '大模型') throw new Error('HTTP 503');
    return { success: true, data: { jobStats: { total: 0 }, jobs: [mkJob('e7', '幸存岗位')] } };
  });
  const blipJobs = await mokahr.fetch({ name: 'Example Labs', careers_url: MOKA_URL, keywords: ['AI', '大模型'] }, blip.ctx);
  if (blipJobs.length === 1 && blipJobs[0].title === '幸存岗位') {
    pass('mokahr.fetch() keeps already-collected jobs when a later request fails');
  } else {
    fail(`mokahr.fetch() partial results on failure: ${JSON.stringify(blipJobs.map(j => j.title))}`);
  }

  const softFail = mkCtx(({ keyword }) => (keyword === '大模型'
    ? { success: false, code: 102, msg: '参数错误。{0}' }
    : { success: true, data: { jobStats: { total: 0 }, jobs: [mkJob('e8', '幸存岗位2')] } }));
  const softFailJobs = await mokahr.fetch({ name: 'Example Labs', careers_url: MOKA_URL, keywords: ['AI', '大模型'] }, softFail.ctx);
  if (softFailJobs.length === 1 && softFailJobs[0].title === '幸存岗位2') {
    pass('mokahr.fetch() treats an in-band success:false as a blip once jobs are collected');
  } else {
    fail(`mokahr.fetch() success:false blip: ${JSON.stringify(softFailJobs.map(j => j.title))}`);
  }

  let firstFailThrew = false;
  const dead = mkCtx(() => { throw new Error('HTTP 500'); });
  try {
    await mokahr.fetch({ name: 'Example Labs', careers_url: MOKA_URL, keywords: ['AI'] }, dead.ctx);
  } catch { firstFailThrew = true; }
  if (firstFailThrew) {
    pass('mokahr.fetch() still throws when the very first request fails (dead board reads as failure)');
  } else {
    fail('mokahr.fetch() swallowed a first-request failure');
  }
} catch (e) {
  fail(`mokahr provider tests crashed: ${e.message}`);
}
