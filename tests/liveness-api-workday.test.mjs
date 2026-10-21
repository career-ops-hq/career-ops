import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLivenessViaApi, classifyWorkday403 } from '../liveness-api.mjs';

const posting = 'https://acme.wd3.myworkdayjobs.com/en-US/External/job/Berlin/QA-Engineer_R0419758-1';

// Response bodies in the shapes Workday's per-job CXS endpoint returns.
const LIVE = { jobPostingInfo: { title: 'QA Engineer', jobReqId: 'R0419758', canApply: true, posted: true } };
const WITHDRAWN = { errorCode: 'S22', errorCaseId: 'X', httpStatus: 403, message: 'permission denied', messageParams: {} };
// A 404 comes with either body depending on the tenant; the status alone decides.
const MISSING_S21 = { errorCode: 'S21', errorCaseId: 'X', httpStatus: 404, message: 'not found: Job_Posting_Anchor_ID=QA-Engineer_R0419758-1', messageParams: {} };
const MISSING_HTTP_404 = { errorCode: 'HTTP_404', errorCaseId: 'X', httpStatus: 404, message: '', messageParams: {} };
const OTHER_CODE_403 = { errorCode: 'HTTP_403', errorCaseId: 'X', httpStatus: 403, message: '', messageParams: {} };

async function withFetch(mock, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await run(); } finally { globalThis.fetch = previous; }
}

const json = (body, status) => async () => new Response(JSON.stringify(body), { status });

test('classifyWorkday403 reads only the S22 403 body as withdrawn', () => {
  assert.equal(classifyWorkday403(WITHDRAWN)?.result, 'expired');
  assert.equal(classifyWorkday403(WITHDRAWN)?.code, 'workday_api_withdrawn');
  assert.equal(classifyWorkday403(OTHER_CODE_403), null);
  assert.equal(classifyWorkday403({ ...WITHDRAWN, httpStatus: 401 }), null);
  assert.equal(classifyWorkday403({}), null);
  assert.equal(classifyWorkday403(null), null);
});

test('Workday 403 S22 is a withdrawn posting; any other 403 falls back to the browser', async () => {
  const withdrawn = await withFetch(json(WITHDRAWN, 403), () => checkLivenessViaApi(posting));
  assert.equal(withdrawn?.result, 'expired');
  assert.equal(withdrawn?.code, 'workday_api_withdrawn');
  const otherCode403 = await withFetch(json(OTHER_CODE_403, 403), () => checkLivenessViaApi(posting));
  assert.equal(otherCode403, null);
  const wafPage = await withFetch(async () => new Response('<html>Access denied</html>', { status: 403 }),
    () => checkLivenessViaApi(posting));
  assert.equal(wafPage, null);
});

test('Workday 200 stays live without reading the body, 404 stays expired, other errors stay inconclusive', async () => {
  const live = await withFetch(json(LIVE, 200), () => checkLivenessViaApi(posting));
  assert.equal(live?.result, 'active');
  assert.equal(live?.code, 'workday_api_ok');
  for (const body of [MISSING_S21, MISSING_HTTP_404]) {
    const missing = await withFetch(json(body, 404), () => checkLivenessViaApi(posting));
    assert.equal(missing?.result, 'expired');
    assert.equal(missing?.code, 'workday_api_gone');
  }
  const maintenance = await withFetch(json({ errorCode: 'HTTP_422', httpStatus: 422 }, 422),
    () => checkLivenessViaApi(posting));
  assert.equal(maintenance, null);
});

test('a 403 is read as a body only for providers that opt in', async () => {
  const greenhouse = await withFetch(json(WITHDRAWN, 403),
    () => checkLivenessViaApi('https://boards.greenhouse.io/acme/jobs/4567890'));
  assert.equal(greenhouse, null);
});
