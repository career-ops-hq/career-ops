// tests/liveness-api-vdab.test.mjs — the VDAB rung of the liveness ladder.
//
// A closed VDAB vacancy keeps its page and its "Solliciteer nu" button; only a
// banner, "Deze vacature is niet meer gepubliceerd", says it is closed (#5244).
// The browser reads the page while it renders, so a closed vacancy can read
// active (the button rendered, the banner not yet) or no_apply_control (neither
// rendered within the poll).
//
// The rung reads the detail endpoint the page itself calls, which needs no browser:
//
//   GET https://www.vdab.be/rest/vindeenjob/v4/vacatures/{id}?preview=false
//   (with the public frontend key providers/vdab.mjs sends)
//   200 {"gepubliceerd":true}                    -> active
//   200 {"gepubliceerd":false,"status":"PASSIEF"} -> expired
//   200 {"gepubliceerd":false,"status":"HANGEND"} -> uncertain (pending), never expired
//   404 {"code":"NOT_FOUND"}                      -> expired (gone)
//   a record for another id, no flag, any other 404, 410, 403 -> null (the browser decides)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAtsApi, checkLivenessViaApi, classifyVdabVacancy } from '../liveness-api.mjs';
import { VEJ_KEY_MONITOR } from '../providers/vdab.mjs';

const ID = '74748133';
const POSTING = `https://www.vdab.be/vindeenjob/vacatures/${ID}`;
const API = `https://www.vdab.be/rest/vindeenjob/v4/vacatures/${ID}?preview=false`;

async function withFetch(mock, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await run(); } finally { globalThis.fetch = previous; }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const vacancy = (fields) => ({ referentie: { id: Number(ID), uuid: '92f8b51b-9305-419c-a7e0-827f967a6760' }, aantalJobs: 1, ...fields });

test('the vacancy URL shapes resolve to the detail API, and only on vdab.be', () => {
  for (const url of [
    POSTING,
    `${POSTING}/`,
    `${POSTING}?utm_source=jobat&utm_medium=feed`,
    `${POSTING}/embedded-software-developer`,
    `https://vdab.be/vindeenjob/vacatures/${ID}`,
  ]) {
    const resolved = resolveAtsApi(url);
    assert.equal(resolved?.ats, 'vdab', url);
    assert.equal(resolved.apiUrl, API, url);
  }

  // A look-alike host, the search page, a traversal attempt, the singular form
  // (VDAB redirects it to the listing), a deeper path and a municipality page
  // must not resolve.
  for (const url of [
    `https://www.vdab.be.evil.test/vindeenjob/vacatures/${ID}`,
    'https://www.vdab.be/vindeenjob/vacatures',
    'https://www.vdab.be/vindeenjob/vacatures/%2e%2e',
    `https://www.vdab.be/vindeenjob/vacature/${ID}`,
    `${POSTING}/embedded-software-developer/solliciteer`,
    'https://www.vdab.be/vindeenjob/vacatures-in-gemeente/Ardooie',
  ]) {
    assert.equal(resolveAtsApi(url), null, url);
  }
});

test('a published vacancy answers active, from one request to the fixed API host with the public key', async () => {
  const calls = [];
  const verdict = await withFetch(async (url, opts) => {
    calls.push([String(url), opts.headers['vej-key-monitor'], opts.redirect]);
    return json(vacancy({ gepubliceerd: true, gesloten: false, status: 'ACTIEF' }));
  }, () => checkLivenessViaApi(POSTING));
  assert.equal(verdict.result, 'active');
  assert.equal(verdict.code, 'vdab_api_published');
  assert.deepEqual(calls, [[API, VEJ_KEY_MONITOR, 'error']]);
});

test('a closed vacancy (PASSIEF) answers expired, though the API says 200', async () => {
  const verdict = await withFetch(async () => json(vacancy({ gepubliceerd: false, gesloten: false, status: 'PASSIEF', aantalJobs: 0 })),
    () => checkLivenessViaApi(POSTING));
  assert.equal(verdict.result, 'expired');
  assert.equal(verdict.code, 'vdab_api_closed');
});

test('a pending vacancy (HANGEND) stays uncertain, never expired', async () => {
  // VDAB holds vacancies it has not published yet as HANGEND too (no
  // eerstePublicatieDatum), so pending is not closed, and expired is a verdict
  // scan --verify records for good.
  for (const body of [
    vacancy({ gepubliceerd: false, status: 'HANGEND' }),
    vacancy({ gepubliceerd: false, status: 'HANGEND', eerstePublicatieDatum: '2026-10-20T13:33:21Z' }),
  ]) {
    const verdict = await withFetch(async () => json(body), () => checkLivenessViaApi(POSTING));
    assert.equal(verdict.result, 'uncertain');
    assert.equal(verdict.code, 'vdab_api_pending');
  }
});

test('an id VDAB does not have (404 NOT_FOUND) is gone; any other 404, or a 410, falls back to the browser', async () => {
  const gone = await withFetch(async () => json({ code: 'NOT_FOUND', application: 'vindeenjob', httpStatus: 404, message: `Vacature met ID of UUID [${ID}] niet gevonden` }, 404),
    () => checkLivenessViaApi(POSTING));
  assert.equal(gone.result, 'expired');
  assert.equal(gone.code, 'vdab_api_gone');

  for (const response of [
    () => new Response('<!DOCTYPE html><html><body>Not Found</body></html>', { status: 404 }),
    () => json({ code: 'ROUTE_NOT_FOUND', httpStatus: 404 }, 404),
    () => new Response('', { status: 410 }),
  ]) {
    const verdict = await withFetch(async () => response(), () => checkLivenessViaApi(POSTING));
    assert.equal(verdict, null);
  }
});

test('a refused key, a rate limit, an unreadable body, or a record that is not this vacancy falls back to the browser (null)', async () => {
  for (const response of [
    () => new Response('', { status: 403 }),
    () => new Response('', { status: 429 }),
    () => new Response('<!DOCTYPE html><html></html>', { status: 200 }),
    () => json(vacancy({ gepubliceerd: true, referentie: { id: 74670114 } })),
    () => json(vacancy({ status: 'ACTIEF' })),
  ]) {
    const verdict = await withFetch(async () => response(), () => checkLivenessViaApi(POSTING));
    assert.equal(verdict, null);
  }
});

test('classifyVdabVacancy is pure and conservative', () => {
  // gesloten is not a closure: a published vacancy with gesloten true shows its
  // page with "Solliciteer nu" and no banner.
  assert.equal(classifyVdabVacancy(vacancy({ gepubliceerd: true, gesloten: true, status: 'ACTIEF' }), ID).result, 'active');
  assert.equal(classifyVdabVacancy(vacancy({ gepubliceerd: false, status: 'PASSIEF' }), ID).result, 'expired');
  assert.equal(classifyVdabVacancy(vacancy({ gepubliceerd: false, status: 'HANGEND' }), ID).result, 'uncertain');
  // Only PASSIEF closes a vacancy; an unpublished status this rung has not seen stays uncertain.
  const unknown = classifyVdabVacancy(vacancy({ gepubliceerd: false, status: 'GEARCHIVEERD' }), ID);
  assert.equal(unknown.result, 'uncertain');
  assert.equal(unknown.code, 'vdab_status_unrecognised');
  assert.equal(classifyVdabVacancy(vacancy({ gepubliceerd: false }), ID).result, 'uncertain');
  assert.equal(classifyVdabVacancy({ code: 'NOT_FOUND' }, ID, 404).result, 'expired');
  // On a 404 only NOT_FOUND is a verdict; a record for another id or without the flag is no answer.
  assert.equal(classifyVdabVacancy(vacancy({ gepubliceerd: false, status: 'PASSIEF' }), ID, 404), null);
  assert.equal(classifyVdabVacancy(vacancy({ gepubliceerd: true, referentie: { id: '74748133' } }), ID).result, 'active');
  assert.equal(classifyVdabVacancy(vacancy({ gepubliceerd: true, referentie: { id: 74748134 } }), ID), null);
  assert.equal(classifyVdabVacancy(vacancy({ gepubliceerd: true, referentie: undefined }), ID), null);
  assert.equal(classifyVdabVacancy(vacancy({ gepubliceerd: 'true' }), ID), null);
  assert.equal(classifyVdabVacancy(null, ID), null);
  assert.equal(classifyVdabVacancy('nope', ID), null);
});
