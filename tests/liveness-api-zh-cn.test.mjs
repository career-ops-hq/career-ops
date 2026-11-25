// tests/liveness-api-zh-cn.test.mjs — the Tencent, Meituan and Alibaba rungs of
// the liveness ladder.
//
// The browser misreads all three boards (#4832): live Tencent and Meituan
// postings show an Apply label it does not know (no_apply_control, dropped by
// scan --verify), a closed Tencent posting is a /404.html served with 200, a
// closed Meituan page keeps its 立即申请 button, and Alibaba does not deep-link
// at all (#2055). Each board has a per-posting endpoint that needs no browser:
//
//   Tencent  GET  /tencentcareer/api/post/ByPostId?postId={id}
//            200 {"Code":200,"Data":{"PostId":id}}   -> active
//            500 {"Code":500,"Data":"E1005"}         -> expired
//   Meituan  POST /api/official/job/getJobDetail {"jobUnionId":id,"jobShareType":"1"}
//            200 {"status":1,"data":{"jobStatus":"000"}} -> active
//            200 {"status":1,"data":{"jobStatus":"001"}} -> expired
//            200 {"status":0}                            -> uncertain (seen only for ids that never existed)
//   Alibaba  POST /position/detail {"id":id,"channel":"group_official_site"}, XSRF pair
//            200 {"success":true,"content":{"id":id}} -> active
//            200 {"success":true,"content":null}      -> expired
//   all three: any other readable answer              -> uncertain, never expired
//
// The browser misreads these boards, so an answer the rung does not know stays
// uncertain rather than falling to it. Only a body that is not JSON, a 404 or a
// failed request is null, and the browser rung decides as it does without them.
// Each rung throttles itself to one request a second, so the end-to-end tests
// send the three boards' requests side by side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAtsApi, checkLivenessViaApi,
  classifyTencentPost, classifyMeituanJob, classifyAlibabaPosition,
} from '../liveness-api.mjs';

const TENCENT_ID = '2047225595858944000';
const MEITUAN_ID = '4713288261';
const ALIBABA_ID = '100031260010';

// The URLs providers/{tencent,meituan,alibaba}.mjs write. Tencent's comes from
// the API's own PostURL, which is plain http.
const TENCENT = `http://careers.tencent.com/jobdesc.html?postId=${TENCENT_ID}`;
const MEITUAN = `https://zhaopin.meituan.com/web/position/detail?jobUnionId=${MEITUAN_ID}`;
const ALIBABA = `https://talent.alibaba.com/off-campus/position-detail?positionId=${ALIBABA_ID}`;

const TENCENT_API = `https://careers.tencent.com/tencentcareer/api/post/ByPostId?postId=${TENCENT_ID}&language=zh-cn`;
const MEITUAN_API = 'https://zhaopin.meituan.com/api/official/job/getJobDetail';
const ALIBABA_API = 'https://talent.alibaba.com/position/detail';

async function withFetch(mock, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await run(); } finally { globalThis.fetch = previous; }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// One mock for all three boards, answering by API host.
function boards({ tencent, meituan, alibaba }, calls = []) {
  return async (url, opts) => {
    calls.push({ url: String(url), ...opts });
    const host = new URL(url).hostname;
    if (host === 'careers.tencent.com') return tencent();
    if (host === 'zhaopin.meituan.com') return meituan();
    if (host === 'talent.alibaba.com') return alibaba();
    throw new Error(`unexpected request to ${url}`);
  };
}
const checkAll = () => Promise.all([TENCENT, MEITUAN, ALIBABA].map((url) => checkLivenessViaApi(url)));

test('the posting URLs resolve to each board\'s fixed API host, and nothing else does', () => {
  for (const [url, ats, apiUrl] of [
    [TENCENT, 'tencent', TENCENT_API],
    [`https://careers.tencent.com/jobdesc.html?postId=${TENCENT_ID}`, 'tencent', TENCENT_API],
    [MEITUAN, 'meituan', MEITUAN_API],
    [`${MEITUAN}&highlightType=social`, 'meituan', MEITUAN_API],
    [ALIBABA, 'alibaba', ALIBABA_API],
  ]) {
    const resolved = resolveAtsApi(url);
    assert.equal(resolved?.ats, ats, url);
    assert.equal(resolved.apiUrl, apiUrl, url);
    assert.equal(resolved.throttleMs, 1_000, url);
    assert.equal(resolved.api404Authoritative, false, url);
  }

  for (const url of [
    // look-alike hosts
    `https://careers.tencent.com.evil.test/jobdesc.html?postId=${TENCENT_ID}`,
    `https://zhaopin.meituan.com.evil.test/web/position/detail?jobUnionId=${MEITUAN_ID}`,
    `https://talent.alibaba.com.evil.test/off-campus/position-detail?positionId=${ALIBABA_ID}`,
    // Alibaba's holding-company site is another board, with its own ids
    `https://talent-holding.alibaba.com/off-campus/position-detail?positionId=${ALIBABA_ID}`,
    // a missing, non-numeric or injected id
    'https://careers.tencent.com/jobdesc.html',
    'https://careers.tencent.com/jobdesc.html?postId=abc',
    `https://careers.tencent.com/jobdesc.html?postId=${TENCENT_ID}%26language%3Den-us`,
    'https://zhaopin.meituan.com/web/position/detail?jobUnionId=../../x',
    'https://talent.alibaba.com/off-campus/position-detail?positionId=1e3',
    // an Alibaba id too long to send as an exact JSON number
    'https://talent.alibaba.com/off-campus/position-detail?positionId=1234567890123456',
    // other pages on the same hosts
    'https://careers.tencent.com/search.html',
    'https://zhaopin.meituan.com/web/social',
    'https://talent.alibaba.com/off-campus/position-list',
    // plain http stays refused where the provider writes https
    `http://zhaopin.meituan.com/web/position/detail?jobUnionId=${MEITUAN_ID}`,
    `http://talent.alibaba.com/off-campus/position-detail?positionId=${ALIBABA_ID}`,
  ]) {
    assert.equal(resolveAtsApi(url), null, url);
  }
});

test('a rung that declares no method still sends a GET with no body', async () => {
  const calls = [];
  const verdict = await withFetch(async (url, opts) => {
    calls.push({ url: String(url), ...opts });
    return json({ id: 4567890, title: 'Engineer' });
  }, () => checkLivenessViaApi('https://boards.greenhouse.io/acme/jobs/4567890'));
  assert.equal(verdict.result, 'active');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].body, undefined);
});

test('live postings answer active, each from one request shaped the way the board takes it', async () => {
  const calls = [];
  const verdicts = await withFetch(boards({
    tencent: () => json({ Code: 200, Data: { PostId: TENCENT_ID, RecruitPostName: 'LLM & Agent Research' } }),
    meituan: () => json({ status: 1, message: '成功', data: { jobUnionId: MEITUAN_ID, jobStatus: '000' } }),
    alibaba: () => json({ success: true, errorCode: null, content: { id: 100031260010, name: '算法工程师' } }),
  }, calls), checkAll);

  assert.deepEqual(verdicts.map((v) => [v.result, v.code]), [
    ['active', 'tencent_api_active'],
    ['active', 'meituan_api_open'],
    ['active', 'alibaba_api_active'],
  ]);

  const byUrl = Object.fromEntries(calls.map((c) => [c.url, c]));
  assert.equal(calls.length, 3);

  const tencent = byUrl[TENCENT_API];
  assert.equal(tencent.method, 'GET');
  assert.equal(tencent.body, undefined);
  assert.equal(tencent.redirect, 'error');

  const meituan = byUrl[MEITUAN_API];
  assert.equal(meituan.method, 'POST');
  assert.equal(meituan.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(meituan.body), { jobUnionId: MEITUAN_ID, jobShareType: '1' });
  assert.equal(meituan.redirect, 'error');

  const alibaba = byUrl[ALIBABA_API];
  assert.equal(alibaba.method, 'POST');
  assert.equal(alibaba.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(alibaba.body), { id: 100031260010, channel: 'group_official_site' });
  assert.equal(alibaba.redirect, 'error');
  // The double-submit pair: the cookie's token and the header must match.
  assert.equal(alibaba.headers.cookie, `XSRF-TOKEN=${alibaba.headers['x-xsrf-token']}`);
  assert.ok(alibaba.headers['x-xsrf-token']);

  for (const call of calls) assert.match(call.headers['user-agent'], /career-ops/);
});

test('closed postings answer expired: Tencent on its HTTP 500, the other two on a 200', async () => {
  const verdicts = await withFetch(boards({
    tencent: () => json({ Code: 500, Data: 'E1005' }, 500),
    meituan: () => json({ status: 1, message: '成功', data: { jobUnionId: MEITUAN_ID, jobStatus: '001' } }),
    alibaba: () => json({ success: true, errorCode: null, content: null }),
  }), checkAll);

  assert.deepEqual(verdicts.map((v) => [v.result, v.code]), [
    ['expired', 'tencent_api_e1005'],
    ['expired', 'meituan_api_closed'],
    ['expired', 'alibaba_api_no_content'],
  ]);
});

test('a readable answer the rung does not know stays uncertain, never expired', async () => {
  const verdicts = await withFetch(boards({
    tencent: () => json({ Code: 500, Data: 'E1001' }, 500),
    meituan: () => json({ status: 1, message: '成功', data: { jobUnionId: MEITUAN_ID, jobStatus: '002' } }),
    alibaba: () => json({ success: false, errorCode: 'SYSTEM_ERROR', content: null }),
  }), checkAll);

  assert.deepEqual(verdicts.map((v) => [v?.result, v?.code]), [
    ['uncertain', 'tencent_answer_unrecognised'],
    ['uncertain', 'meituan_answer_unrecognised'],
    ['uncertain', 'alibaba_answer_unrecognised'],
  ]);
});

test('a 404 or a body that is not JSON leaves the posting to the browser (null)', async () => {
  // Closed postings have an answer of their own, so a 404 is not read as one.
  const notFound = await withFetch(boards({
    tencent: () => new Response('', { status: 404 }),
    meituan: () => new Response('', { status: 404 }),
    alibaba: () => new Response('', { status: 404 }),
  }), checkAll);
  assert.deepEqual(notFound, [null, null, null]);

  // An HTML page on a status the rung reads: a gateway error on Tencent's 500,
  // a WAF or maintenance page on the others' 200.
  const html = await withFetch(boards({
    tencent: () => new Response('<html>Internal Server Error</html>', { status: 500 }),
    meituan: () => new Response('<!DOCTYPE html><html><body>访问受限</body></html>', { status: 200 }),
    alibaba: () => new Response('<!DOCTYPE html><html><body>系统维护中</body></html>', { status: 200 }),
  }), checkAll);
  assert.deepEqual(html, [null, null, null]);
});

test('classifyTencentPost reads only Code 200 for this PostId and Code 500 E1005', () => {
  assert.equal(classifyTencentPost({ Code: 200, Data: { PostId: TENCENT_ID } }, TENCENT_ID).result, 'active');
  assert.equal(classifyTencentPost({ Code: 500, Data: 'E1005' }, TENCENT_ID).result, 'expired');
  for (const [answer, seen] of [
    [{ Code: 200, Data: { PostId: '1' } }, /Code 200 without this PostId/],
    [{ Code: 200, Data: null }, /Code 200 without this PostId/],
    // the id must be the same string or the same safe integer: an array never
    // matches, nor does a 19-digit id parsed as a number, even one that rounds
    // to this id
    [{ Code: 200, Data: { PostId: [TENCENT_ID] } }, /Code 200 without this PostId/],
    [JSON.parse('{"Code":200,"Data":{"PostId":2047225595858944001}}'), /Code 200 without this PostId/],
    [{ Code: 500, Data: 'E1001' }, /Code 500, Data E1001/],
    [{ Code: 403, Data: 'E1005' }, /Code 403, Data E1005/],
    // the posting itself, but under a Code other than 200
    [{ Code: 500, Data: { PostId: TENCENT_ID } }, /Code 500, Data object/],
  ]) {
    const verdict = classifyTencentPost(answer, TENCENT_ID);
    assert.deepEqual([verdict?.result, verdict?.code], ['uncertain', 'tencent_answer_unrecognised'], JSON.stringify(answer));
    assert.match(verdict.reason, seen);
  }
  assert.equal(classifyTencentPost(null, TENCENT_ID), null);
  assert.equal(classifyTencentPost('E1005', TENCENT_ID), null);
});

test('classifyMeituanJob reads jobStatus only on a status 1 record for this id', () => {
  const record = (jobStatus, jobUnionId = MEITUAN_ID) => ({ status: 1, data: { jobUnionId, jobStatus } });
  assert.equal(classifyMeituanJob(record('000'), MEITUAN_ID).result, 'active');
  assert.equal(classifyMeituanJob(record('001'), MEITUAN_ID).result, 'expired');
  for (const [answer, seen] of [
    [record('002'), /jobStatus 002/],
    [record(undefined), /jobStatus undefined/],
    [record('001', '1'), /status 1 without this jobUnionId/],
    [record('001', [MEITUAN_ID]), /status 1 without this jobUnionId/],
    // status 0 has only been seen for ids that never existed and for a wrong
    // request method, so it is no verdict either way.
    [{ status: 0, message: '职位已下线或不存在！', data: null }, /status 0/],
    [{ status: 0, message: '请求方式不正确！' }, /status 0/],
    // a closed-looking record under status 0 is still no verdict
    [{ status: 0, data: { jobUnionId: MEITUAN_ID, jobStatus: '001' } }, /status 0/],
  ]) {
    const verdict = classifyMeituanJob(answer, MEITUAN_ID);
    assert.deepEqual([verdict?.result, verdict?.code], ['uncertain', 'meituan_answer_unrecognised'], JSON.stringify(answer));
    assert.match(verdict.reason, seen);
  }
  assert.equal(classifyMeituanJob(null, MEITUAN_ID), null);
  assert.equal(classifyMeituanJob('<html></html>', MEITUAN_ID), null);
});

test('classifyAlibabaPosition reads content only on a successful answer', () => {
  assert.equal(classifyAlibabaPosition({ success: true, content: { id: 100031260010 } }, ALIBABA_ID).result, 'active');
  assert.equal(classifyAlibabaPosition({ success: true, content: null }, ALIBABA_ID).result, 'expired');
  for (const [answer, seen] of [
    [{ success: true, content: { id: 1 } }, /success true without this position id/],
    [{ success: true, content: { id: [100031260010] } }, /success true without this position id/],
    [{ success: true }, /success true without this position id/],
    // An in-band failure is not a closed posting.
    [{ success: false, errorCode: 'SYSTEM_ERROR', content: null }, /success false, errorCode SYSTEM_ERROR/],
    [{ success: false, content: { id: 100031260010 } }, /success false/],
  ]) {
    const verdict = classifyAlibabaPosition(answer, ALIBABA_ID);
    assert.deepEqual([verdict?.result, verdict?.code], ['uncertain', 'alibaba_answer_unrecognised'], JSON.stringify(answer));
    assert.match(verdict.reason, seen);
  }
  assert.equal(classifyAlibabaPosition(null, ALIBABA_ID), null);
  assert.equal(classifyAlibabaPosition('<html></html>', ALIBABA_ID), null);
});
