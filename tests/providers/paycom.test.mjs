// tests/providers/paycom.test.mjs
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — paycom');

const mod = await import(pathToFileURL(join(ROOT, 'providers/paycom.mjs')).href);
const paycom = mod.default;
const { parsePaycom, extractPaycomSession, resolvePaycomClientKey } = mod;
const { isOfferSeen, markOfferSeen } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

const KEY = '0123456789ABCDEF0123456789ABCDEF';
const CAREERS = `https://www.paycomonline.net/v4/ats/web.php/portal/${KEY}/career-page`;
const SVC = 'https://portal-applicant-tracking.us-cent.paycomonline.net/';
const JWT = ['eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9', 'e30', 'c2ln'].join('.');
const pageHtml = (svc = SVC) =>
  `<script>window.__data = {"anonToken":"${JWT}",` +
  `"atsPortalMantleServiceUrl":"${svc.replace(/\\/g, '\\\\').replace(/\//g, '\\/')}"};</script>`;

const row = (jobId, jobTitle, locations = 'Springfield, IL 62701') => ({
  jobId, jobTitle, positionType: '', remoteType: '', locations,
  description: 'A short teaser...', postedOn: '', isHotJob: false,
});

function makeCtx(payload, html = pageHtml()) {
  const calls = [];
  return {
    calls,
    async fetchText(url, opts) { calls.push({ kind: 'text', url, opts }); return html; },
    async fetchJson(url, opts) { calls.push({ kind: 'json', url, opts }); return payload; },
  };
}

const entry = { name: 'Acme', careers_url: CAREERS };

if (paycom.id === 'paycom') pass('paycom.id is "paycom"');
else fail(`paycom.id is ${JSON.stringify(paycom.id)}`);

// resolvePaycomClientKey() / detect()
{
  if (resolvePaycomClientKey({ name: 'X', careers_url: CAREERS }) === KEY) pass('client key from careers_url path');
  else fail('client key not resolved from path');
  if (resolvePaycomClientKey({ name: 'X', careers_url: `https://www.paycomonline.net/v4/ats/web.php/portal/${KEY}/jobs/101` }) === KEY) pass('client key from a posting link');
  else fail('posting link not claimed');
  if (resolvePaycomClientKey({ name: 'X', client_key: KEY }) === KEY) pass('client key from explicit field');
  else fail('explicit client_key not honoured');

  const junk = [
    { careers_url: 'https://www.paycomonline.net/v4/ats/web.php/foo' },
    { careers_url: `https://evil.example.com/v4/ats/web.php/portal/${KEY}/career-page` },
    { careers_url: `https://www.paycomonline.net.evil.example/v4/ats/web.php/portal/${KEY}/career-page` },
    { careers_url: `http://www.paycomonline.net/v4/ats/web.php/portal/${KEY}/career-page` },
    { careers_url: 'https://www.paycomonline.net/v4/ats/web.php/portal/not-hex!/career-page' },
    { careers_url: 'not a url' },
    { careers_url: 42 },
    { careers_url: null },
    {},
    null,
  ];
  let ok = true;
  for (const e of junk) {
    try { if (paycom.detect(e) !== null) { ok = false; fail(`detect() claimed ${JSON.stringify(e)}`); } }
    catch (err) { ok = false; fail(`detect() threw on ${JSON.stringify(e)}: ${err.message}`); }
  }
  if (ok) pass('detect() returns null without throwing on junk, foreign hosts, http and bad keys');

  const hit = paycom.detect(entry);
  if (hit && hit.url === CAREERS) pass('detect() builds the career-page url');
  else fail(`detect(): ${JSON.stringify(hit)}`);
}

// extractPaycomSession()
{
  const s = extractPaycomSession(pageHtml());
  if (s && s.jwt === JWT) pass('anonymous JWT extracted');
  else fail(`jwt: ${JSON.stringify(s?.jwt)}`);
  if (s && s.serviceUrl === SVC) pass('service url unescaped, trailing slash kept');
  else fail(`serviceUrl: ${JSON.stringify(s?.serviceUrl)}`);
  if (extractPaycomSession('<html>no token here</html>') === null) pass('null when token or url absent');
  else fail('returned a session for tokenless html');
}

// fetch(): normalization, redirect: 'error' on both requests, identity
{
  const ctx = makeCtx({
    jobPostingPreviews: [
      row(101, 'Relationship Banker', 'Main Branch - Springfield, IL 62701'),
      row(102, ''),
      row(101, 'Duplicate'),
      row(null, 'No id'),
      row(103, '  Teller  ', ''),
    ],
    jobPostingPreviewsCount: 5,
  });
  const jobs = await paycom.fetch(entry, ctx);
  if (jobs.length === 2) pass('fetch() keeps 2 rows (empty title, duplicate and missing id dropped)');
  else fail(`expected 2, got ${jobs.length}: ${JSON.stringify(jobs.map(j => j.title))}`);

  const [a, b] = jobs;
  if (a?.url === `https://www.paycomonline.net/v4/ats/web.php/portal/${KEY}/jobs/101`) pass('posting url is portal/<key>/jobs/<jobId>');
  else fail(`url: ${a?.url}`);
  if (a?.title === 'Relationship Banker' && a?.company === 'Acme' && a?.location === 'Main Branch - Springfield, IL 62701') pass('title, company and location mapped');
  else fail(`row: ${JSON.stringify(a)}`);
  if (b?.title === 'Teller' && b?.location === '') pass('title trimmed, empty location kept empty');
  else fail(`row b: ${JSON.stringify(b)}`);
  if (!('description' in (a || {}))) pass('teaser description is not used as description');
  else fail('teaser leaked into description');

  if (ctx.calls.length === 2 && ctx.calls.every(c => c.opts?.redirect === 'error')) pass("both requests pass redirect: 'error'");
  else fail(`calls: ${JSON.stringify(ctx.calls.map(c => [c.kind, c.opts?.redirect]))}`);
  const post = ctx.calls[1];
  if (post?.url === `${SVC}api/ats/job-posting-previews/search` && post.opts?.method === 'POST' && post.opts?.headers?.authorization === JWT) pass('search POSTed to the service url with the page token');
  else fail(`post: ${JSON.stringify({ url: post?.url, method: post?.opts?.method })}`);

  const id = a?.listingIdentity;
  if (id?.ats_provider === 'paycom' && id?.board_slug === KEY && id?.posting_id === '101' && Object.keys(id).length === 3) pass('listingIdentity is paycom/<client key>/<jobId>');
  else fail(`identity: ${JSON.stringify(id)}`);

  // Paycom's older ViewJobDetails link reaches the same posting at a URL that URL dedup treats as new.
  const legacy = { ...a, url: `https://www.paycomonline.net/v4/ats/web.php/jobs/ViewJobDetails?job=101&clientkey=${KEY}` };
  const seen = new Set();
  markOfferSeen(a, seen);
  if (isOfferSeen(legacy, seen)) pass('the same posting at its ViewJobDetails url is already seen');
  else fail('legacy url not recognised as the same posting');
  if (!isOfferSeen(b, seen)) pass('a different jobId is a different listing');
  else fail('different jobId collided');

  const [str] = await paycom.fetch(entry, makeCtx({ jobPostingPreviews: [row('104', 'String id')] }));
  if (str?.listingIdentity?.posting_id === '104' && str.listingIdentity.board_slug === KEY) pass('a string jobId keeps its listingIdentity, uncoerced');
  else fail(`string-id row: ${JSON.stringify(str)}`);
  for (const bad of [' 104', '104 ', 'a\nb', 1.5, 0, -3]) {
    const [r] = parsePaycom({ jobPostingPreviews: [row(bad, 'Odd id')] }, KEY, 'Acme');
    if (r && !('listingIdentity' in r)) pass(`jobId ${JSON.stringify(bad)} leaves listingIdentity off`);
    else fail(`jobId ${JSON.stringify(bad)}: ${JSON.stringify(r)}`);
  }
}

// fetch(): a tenant reporting more postings than were returned is marked truncated
{
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (m) => warnings.push(String(m));
  try {
    const capped = await paycom.fetch(entry, makeCtx({ jobPostingPreviews: [row(1, 'A'), row(2, 'B')], jobPostingPreviewsCount: 5 }));
    if (capped.length === 2 && capped.truncated?.reason === 'page-cap' && capped.truncated.fetched === 2 && capped.truncated.total === 5 && warnings.length === 1) pass('a reported total above the rows read marks the list truncated and warns');
    else fail(`capped: ${JSON.stringify(capped.truncated)} warnings=${warnings.length}`);
    const whole = await paycom.fetch(entry, makeCtx({ jobPostingPreviews: [row(1, 'A'), row(2, 'B')], jobPostingPreviewsCount: 2 }));
    if (!('truncated' in whole)) pass('a complete board is not marked truncated');
    else fail(`complete board marked: ${JSON.stringify(whole.truncated)}`);
  } finally {
    console.warn = origWarn;
  }
}

// parsePaycom(): one malformed row never aborts the board
{
  const jobs = parsePaycom({ jobPostingPreviews: [
    row({ toString: null }, 'Object id'),
    row([7], 'Array id'),
    row(true, 'Boolean id'),
    row(201, 'Good'),
  ] }, KEY, 'Acme');
  if (jobs.length === 1 && jobs[0].title === 'Good') pass('rows with a non-string, non-number jobId are skipped, the rest kept');
  else fail(`malformed ids: ${JSON.stringify(jobs)}`);
}

// fetch(): guards that run before the search request
{
  const ctx = makeCtx({ jobPostingPreviews: [] }, pageHtml('https://evil.example/'));
  let threw = false;
  try { await paycom.fetch(entry, ctx); } catch { threw = true; }
  if (threw && !ctx.calls.some(c => c.kind === 'json')) pass('a service url off paycomonline.net throws before the search request');
  else fail(`threw=${threw} calls=${ctx.calls.length}`);

  const ctx2 = makeCtx({ jobPostingPreviews: [] }, '<html>maintenance</html>');
  threw = false;
  try { await paycom.fetch(entry, ctx2); } catch { threw = true; }
  if (threw && !ctx2.calls.some(c => c.kind === 'json')) pass('a page without a token throws before the search request');
  else fail('tokenless page did not throw before the search');

  const ctx3 = makeCtx({ jobPostingPreviews: [] });
  threw = false;
  try { await paycom.fetch({ name: 'Bad', careers_url: 'https://evil.example.com/x' }, ctx3); } catch { threw = true; }
  if (threw && ctx3.calls.length === 0) pass('an entry with no client key throws before any request');
  else fail('bad entry reached the network');
}

// Empty board vs broken envelope
{
  if (parsePaycom({ jobPostingPreviews: [], jobPostingPreviewsCount: 0 }, KEY, 'X').length === 0) pass('present, empty jobPostingPreviews → []');
  else fail('empty board did not yield []');
  for (const [label, body] of [['null', null], ['{}', {}], ['non-array', { jobPostingPreviews: 'nope' }], ['string', '']]) {
    try { parsePaycom(body, KEY, 'X'); fail(`${label} body did not throw`); }
    catch (err) {
      if (/expected jobPostingPreviews\[\]/.test(err.message)) pass(`${label} body throws naming the envelope`);
      else fail(`${label} body threw: ${err.message}`);
    }
  }
}
