// tests/providers/careerpuck.test.mjs — CareerPuck public job-board provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — careerpuck (CareerPuck job board)');

const mod = await import(pathToFileURL(join(ROOT, 'providers/careerpuck.mjs')).href);
const careerpuck = mod.default;
const { parseCareerPuckBoard, parseCareerPuckJob, descriptionText, boardPermalinkOf, resolvePermalink } = mod;
const { loadProviders, resolveProvider } = await import(pathToFileURL(join(ROOT, 'providers/_registry.mjs')).href);

const BOARD_URL = 'https://app.careerpuck.com/job-board/acmeco';
const API_URL = 'https://api.careerpuck.com/v1/public/job-boards/acmeco';
const ENTRY = { name: 'Acme', careers_url: BOARD_URL };

if (careerpuck.id === 'careerpuck') pass('careerpuck.id is "careerpuck"');
else fail(`careerpuck.id is ${JSON.stringify(careerpuck.id)}`);

// detect() — claims the board and any path under it, rebuilds the API URL itself.
for (const [entry, label] of [
  [{ careers_url: BOARD_URL }, 'the board URL'],
  [{ careers_url: `${BOARD_URL}/` }, 'the board URL with a trailing slash'],
  [{ careers_url: `${BOARD_URL}/job/2026-1`, }, 'a posting link'],
  [{ careers_url: `${BOARD_URL}?department=Sales#top` }, 'a board URL with a query and fragment'],
  [{ careers_url: 'https://APP.careerpuck.com/job-board/acmeco' }, 'an upper-case host'],
  [{ careers_url: 'https://app.careerpuck.com:8443/job-board/acmeco' }, 'a host carrying a port'],
  [{ api: BOARD_URL }, 'the api: field'],
  [{ careers_url: 'https://careers.example.com/', api: BOARD_URL }, 'the api: field when careers_url is not a board'],
]) {
  const got = careerpuck.detect(entry);
  if (got?.url === API_URL) pass(`careerpuck.detect() claims ${label}`);
  else fail(`careerpuck.detect() ${label}: ${JSON.stringify(got)}`);
}
{
  const got = careerpuck.detect({ careers_url: 'https://app.careerpuck.com/job-board/Acme_Co-2' });
  if (got?.url === 'https://api.careerpuck.com/v1/public/job-boards/Acme_Co-2') pass('careerpuck.detect() keeps the permalink as written');
  else fail(`careerpuck.detect() permalink case: ${JSON.stringify(got)}`);
}
for (const [entry, label] of [
  [{ careers_url: 'http://app.careerpuck.com/job-board/acmeco' }, 'non-HTTPS'],
  [{ careers_url: 'https://app.careerpuck.com.evil.example/job-board/acmeco' }, 'a look-alike host (trailing suffix)'],
  [{ careers_url: 'https://evilapp.careerpuck.com/job-board/acmeco' }, 'a look-alike subdomain'],
  [{ careers_url: 'https://careerpuck.com/job-board/acmeco' }, 'the apex host'],
  [{ careers_url: 'https://api.careerpuck.com/v1/public/job-boards/acmeco' }, 'the API host itself'],
  [{ careers_url: 'https://app.careerpuck.com/' }, 'the app root with no board'],
  [{ careers_url: 'https://app.careerpuck.com/job-board/' }, 'an empty permalink'],
  [{ careers_url: 'https://app.careerpuck.com/job-board/-acme' }, 'a permalink starting with a hyphen'],
  [{ careers_url: 'https://app.careerpuck.com/job-board/ac%2Fme' }, 'a permalink carrying an escaped slash'],
  [{ careers_url: 'https://app.careerpuck.com/job-board/..' }, 'a dot-segment permalink'],
  [{ careers_url: 'https://app.careerpuck.com/other/acmeco' }, 'a path that is not a job board'],
  [{ careers_url: 'https://careers.example.com/jobs' }, 'a branded careers page'],
  [{ careers_url: 'not a url' }, 'a malformed URL'],
  [{ careers_url: null }, 'null careers_url'],
  [{ careers_url: 42 }, 'non-string careers_url'],
  [{}, 'missing careers_url'],
  [null, 'a null entry'],
]) {
  let got;
  try { got = careerpuck.detect(entry); } catch (err) { got = `threw ${err.message}`; }
  if (got === null) pass(`careerpuck.detect() returns null for ${label}`);
  else fail(`careerpuck.detect() ${label}: ${JSON.stringify(got)}`);
}
if (boardPermalinkOf(BOARD_URL) === 'acmeco' && boardPermalinkOf(42) === null && resolvePermalink({ api: 'https://x.example/', careers_url: BOARD_URL }) === 'acmeco') pass('boardPermalinkOf() / resolvePermalink() read the permalink and fall through to careers_url');
else fail('boardPermalinkOf() / resolvePermalink() wrong');

// The registry routes a board URL to this provider.
{
  const realError = console.error;
  console.error = () => {};
  const providers = await loadProviders(join(ROOT, 'providers'));
  console.error = realError;
  const routed = resolveProvider(ENTRY, providers);
  if (routed?.provider?.id === 'careerpuck') pass('the registry routes an app.careerpuck.com/job-board URL to careerpuck');
  else fail(`registry routed a careerpuck URL to ${routed?.provider?.id}`);
}

// A recorded row (fictional company; the entity style is what the live API sends).
const CONTENT = '&lt;h3&gt;What You&amp;apos&semi;ll Do&lt;&sol;h3&gt;&lt;p data-pm-slice&equals;&quot;1 1 &lbrack;&rbrack;&quot;&gt;'
  + 'Lead &lpar;PSC&rpar; work at Acme&amp;&num;x2019&semi;s team&comma; &amp;amp&semi; more&period;&lt;&sol;p&gt;'
  + '&lt;ul&gt;&lt;li&gt;Build things&lt;&sol;li&gt;&lt;li&gt;R&amp;D &#x25cf; 100&percnt;&lt;&sol;li&gt;&lt;&sol;ul&gt;';
const row = (id, extra = {}) => ({
  permalink: `pm${id}`,
  status: 'public',
  formType: 'third-party',
  atsSourcePlatform: 'icims-api',
  atsSourceId: `2026-${id}`,
  requisitionId: null,
  title: `Engineer ${id}`,
  content: CONTENT,
  location: 'Durham, North Carolina, United States',
  workType: 'Regular',
  workplaceType: 'remote',
  language: 'english',
  publicUrl: `${BOARD_URL}/job/2026-${id}`,
  applyUrl: `https://careers-acme.icims.com/jobs/${id}/job`,
  postedAt: '2026-11-15T15:07:44.691Z',
  ...extra,
});
const envelope = (rows) => ({ jobs: rows, employerProfile: { permalink: 'acmeco', name: 'Acme Corporation' }, departments: [], offices: [], permalink: 'acmeco' });

// descriptionText() — entity-escaped HTML to plain text.
{
  const text = descriptionText(CONTENT);
  if (text === 'What You\'ll Do Lead (PSC) work at Acme’s team, &amp; more. Build things R&D ● 100%'.replace('&amp;', '&')) pass('descriptionText() decodes the escaped HTML, punctuation entities included, and reduces it to text');
  else fail(`descriptionText(): ${JSON.stringify(text)}`);
  const leaked = descriptionText('&lt;script&gt;alert&lpar;1&rpar;&lt;&sol;script&gt;&lt;b&gt;ok&lt;&sol;b&gt;');
  if (!/[<>]/.test(leaked)) pass('descriptionText() leaves no markup behind');
  else fail(`descriptionText() leaked markup: ${JSON.stringify(leaked)}`);
  if (descriptionText(null) === '' && descriptionText(42) === '' && descriptionText('') === '') pass('descriptionText() returns "" for a missing or non-string body');
  else fail('descriptionText() non-string handling wrong');
}

// postingUrl() — the employer's https applyUrl wins; publicUrl on app.careerpuck.com is the fallback.
for (const [r, want, label] of [
  [{ applyUrl: 'https://jobs.acme.example/1', publicUrl: `${BOARD_URL}/job/1` }, 'https://jobs.acme.example/1', 'applyUrl over publicUrl'],
  [{ applyUrl: null, publicUrl: `${BOARD_URL}/job/1` }, `${BOARD_URL}/job/1`, 'publicUrl when applyUrl is missing'],
  [{ applyUrl: 'http://jobs.acme.example/1', publicUrl: `${BOARD_URL}/job/1` }, `${BOARD_URL}/job/1`, 'publicUrl when applyUrl is not https'],
  [{ applyUrl: 'not a url', publicUrl: `${BOARD_URL}/job/1` }, `${BOARD_URL}/job/1`, 'publicUrl when applyUrl is malformed'],
  [{ applyUrl: 'https://jobs.acme.example/1', publicUrl: null }, 'https://jobs.acme.example/1', 'applyUrl when publicUrl is missing'],
  [{ applyUrl: null, publicUrl: 'https://evil.example/job-board/acmeco/job/1' }, null, 'null when only a foreign publicUrl is left'],
  [{}, null, 'null for a row with neither'],
]) {
  if (mod.postingUrl(r) === want) pass(`postingUrl() picks ${label}`);
  else fail(`postingUrl() ${label}: ${mod.postingUrl(r)}`);
}

// parseCareerPuckBoard() — normalization of the live response shape.
{
  const jobs = parseCareerPuckBoard(envelope([
    row('1'),
    row('2', { postedAt: null, location: null, workplaceType: null, content: '', requisitionId: 'REQ-77' }),
    row('3', { status: 'draft' }),
    row('4', { status: 'closed' }),
    row('5', { title: '   ' }),
    row('6', { publicUrl: null, applyUrl: null }),
    row('7', { publicUrl: 'https://evil.example/job-board/acmeco/job/7', applyUrl: null }),
    row('8', { publicUrl: 'http://app.careerpuck.com/job-board/acmeco/job/8', applyUrl: 'javascript:alert(1)' }),
    row('9', { title: '  R&D   Lead  ' }),
    row('1'),
    null,
    'junk',
    42,
  ]), 'Acme', 'acmeco');
  const byTitle = Object.fromEntries(jobs.map((j) => [j.title, j]));
  if (jobs.length === 3) pass('parseCareerPuckBoard() keeps public rows with a title and a careerpuck posting URL, and de-duplicates by URL');
  else fail(`parseCareerPuckBoard() kept ${jobs.length}: ${JSON.stringify(jobs.map((j) => j.url))}`);
  const j1 = byTitle['Engineer 1'];
  if (
    j1?.url === 'https://careers-acme.icims.com/jobs/1/job' &&
    j1.language === 'english' &&
    j1.company === 'Acme' &&
    j1.location === 'Durham, North Carolina, United States' &&
    j1.workplaceType === 'remote' &&
    j1.postedAt === Date.parse('2026-11-15T15:07:44.691Z') &&
    j1.description?.startsWith('What You\'ll Do')
  ) pass('parseCareerPuckBoard() maps title/url/company/location/workplaceType/postedAt/description');
  else fail(`parseCareerPuckBoard() row 1 wrong: ${JSON.stringify(j1)}`);
  if (JSON.stringify(j1?.listingIdentity) === JSON.stringify({ ats_provider: 'careerpuck', board_slug: 'acmeco', posting_id: 'pm1' })) pass('parseCareerPuckBoard() sets listingIdentity from the payload permalink');
  else fail(`listingIdentity wrong: ${JSON.stringify(j1?.listingIdentity)}`);
  const j2 = byTitle['Engineer 2'];
  if (j2 && !('postedAt' in j2) && !('workplaceType' in j2) && !('description' in j2) && j2.location === '' && j2.requisitionId === 'REQ-77') pass('parseCareerPuckBoard() leaves optional fields unset when absent and reads a real requisitionId');
  else fail(`parseCareerPuckBoard() row 2 wrong: ${JSON.stringify(j2)}`);
  if (j1 && !('requisitionId' in j1)) pass('parseCareerPuckBoard() never invents a requisitionId from the ATS source id');
  else fail(`requisitionId invented: ${JSON.stringify(j1)}`);
  if (byTitle['R&D Lead']) pass('parseCareerPuckBoard() keeps a plain-text title as sent and collapses whitespace');
  else fail(`title not normalized: ${JSON.stringify(Object.keys(byTitle))}`);
  if (!jobs.some((j) => /evil\.example|^http:|javascript:/.test(j.url))) pass('parseCareerPuckBoard() never uses a foreign publicUrl, a non-https URL or a script URL as the job URL');
  else fail('a foreign or non-https URL leaked into a job URL');
}
{
  const [a, b, c] = parseCareerPuckBoard(envelope([
    row('1', { permalink: '' }),
    row('2', { permalink: ' padded ' }),
    row('3', { permalink: 'bad\u0007id' }),
  ]), 'Acme', 'acmeco');
  if (!('listingIdentity' in a) && !('listingIdentity' in b) && !('listingIdentity' in c)) pass('listingIdentity is omitted for an empty, padded or control-character permalink');
  else fail(`listingIdentity kept for unusable ids: ${JSON.stringify([a, b, c].map((j) => j.listingIdentity))}`);
}
if (parseCareerPuckBoard(envelope([row('1')]), '', 'acmeco')[0]?.company === 'Acme Corporation') pass('parseCareerPuckBoard() falls back to employerProfile.name when the entry has no name');
else fail('company fallback wrong');
if (parseCareerPuckJob(row('1', { status: 'public' }), 'Acme', 'acmeco') && parseCareerPuckJob(null, 'Acme', 'acmeco') === null) pass('parseCareerPuckJob() maps a public row and rejects null');
else fail('parseCareerPuckJob() wrong');

// Empty versus broken.
{
  const empty = parseCareerPuckBoard(envelope([]), 'Acme', 'acmeco');
  if (Array.isArray(empty) && empty.length === 0) pass('parseCareerPuckBoard() returns [] for a present, empty jobs array');
  else fail(`empty board: ${JSON.stringify(empty)}`);
}
for (const [body, label] of [
  [{}, 'an empty object'],
  [{ jobs: null }, 'a null jobs key'],
  [{ jobs: {} }, 'a non-array jobs key'],
  [{ jobs: 'x' }, 'a string jobs key'],
  [{ results: [] }, 'a different container key'],
  [[], 'a bare array'],
  [null, 'null'],
  ['', 'an empty body'],
  [42, 'a number'],
  ['<html>', 'an HTML body'],
]) {
  let msg = null;
  try { parseCareerPuckBoard(body, 'Acme', 'acmeco'); } catch (err) { msg = err.message; }
  if (msg && /careerpuck: unexpected response/.test(msg)) pass(`parseCareerPuckBoard() throws descriptively on ${label}`);
  else fail(`parseCareerPuckBoard() should throw on ${label}, got ${msg}`);
}
{
  let msg = '';
  try { parseCareerPuckBoard({ error: 'x', total: 1 }, 'Acme', 'acmeco'); } catch (err) { msg = err.message; }
  if (/\[error, total\]/.test(msg)) pass('the unexpected-response error names the keys it got');
  else fail(`error does not name the keys: ${msg}`);
}

/** A ctx whose fetchJson answers by URL; an Error item is thrown. Records every call. */
function routedCtx(routes, extra = {}) {
  const calls = [];
  const served = new Map();
  return {
    calls,
    sleep: async () => {},
    fetchJson: async (url, opts = {}) => {
      calls.push({ url, opts });
      const list = routes[url];
      if (!list) throw new Error(`unexpected request ${url}`);
      const i = served.get(url) ?? 0;
      served.set(url, i + 1);
      const answer = list[Math.min(i, list.length - 1)];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    ...extra,
  };
}

// fetch() — the host guard runs before any request.
for (const entry of [
  { name: 'Acme', careers_url: 'https://careers.example.com/jobs' },
  { name: 'Acme', careers_url: 'https://app.careerpuck.com/' },
  { name: 'Acme', careers_url: 'http://app.careerpuck.com/job-board/acmeco' },
  { name: 'Acme' },
]) {
  const ctx = routedCtx({});
  let err = null;
  try { await careerpuck.fetch(entry, ctx); } catch (e) { err = e; }
  if (err && /no app\.careerpuck\.com\/job-board/.test(err.message) && ctx.calls.length === 0) pass(`careerpuck.fetch() rejects ${entry.careers_url ?? 'an entry with no URL'} before any request`);
  else fail(`careerpuck.fetch() guard: err=${err?.message} calls=${ctx.calls.length}`);
}

// fetch() — one request, to the API URL rebuilt from the permalink, redirects refused.
{
  const ctx = routedCtx({ [API_URL]: [envelope([row('1'), row('2')])] });
  const jobs = await careerpuck.fetch({ name: 'Acme', careers_url: `https://app.careerpuck.com:9999/job-board/acmeco/job/2026-1?x=1` }, ctx);
  if (jobs.length === 2 && jobs[0].company === 'Acme') pass('careerpuck.fetch() returns the normalized jobs');
  else fail(`careerpuck.fetch() jobs: ${JSON.stringify(jobs)}`);
  if (ctx.calls.length === 1 && ctx.calls[0].url === API_URL) pass('careerpuck.fetch() makes exactly one request, to the public board endpoint, without the input port or path');
  else fail(`careerpuck.fetch() urls: ${JSON.stringify(ctx.calls.map((c) => c.url))}`);
  if (ctx.calls.every((c) => c.opts.redirect === 'error')) pass('careerpuck.fetch() passes redirect: error on every request');
  else fail(`careerpuck.fetch() redirect opts: ${JSON.stringify(ctx.calls.map((c) => c.opts.redirect))}`);
  if (!ctx.calls.some((c) => /\/employers\//.test(c.url))) pass('careerpuck.fetch() never calls the authenticated employer routes');
  else fail('an /employers/ route was requested');
}

// fetch() — an unknown board.
{
  const notFound = Object.assign(new Error('Not Found'), { status: 404 });
  const ctx = routedCtx({ [API_URL]: [notFound] });
  let err = null;
  try { await careerpuck.fetch(ENTRY, ctx); } catch (e) { err = e; }
  if (err?.status === 404 && /board "acmeco" answered 404/.test(err.message) && ctx.calls.length === 1) pass('careerpuck.fetch() names an unknown board on a 404, without retrying');
  else fail(`careerpuck.fetch() unknown board: ${err?.status} ${err?.message} after ${ctx.calls.length} calls`);
}

// fetch() — probe cooperation: a single request, rejections unwrapped.
{
  const ctx = routedCtx({ [API_URL]: [envelope([row('1')])] }, { maxPages: 1 });
  await careerpuck.fetch(ENTRY, ctx);
  if (ctx.calls.length === 1) pass('careerpuck.fetch() issues exactly one request under ctx.maxPages: 1');
  else fail(`careerpuck.fetch() probe: ${ctx.calls.map((c) => c.url)}`);
  const boom = new Error('budget');
  let got = null;
  // Repeated because the shared retry helper retries a transport-shaped error.
  try { await careerpuck.fetch(ENTRY, routedCtx({ [API_URL]: [boom, boom, boom] }, { maxPages: 1 })); } catch (e) { got = e; }
  if (got === boom) pass('careerpuck.fetch() propagates a failure unwrapped during a probe');
  else fail(`careerpuck.fetch() probe rejection was wrapped: ${got?.message}`);
}

// fetch() — failures in a real scan.
{
  const dead = Object.assign(new Error('Internal Server Error'), { status: 500 });
  const ctx = routedCtx({ [API_URL]: [dead, dead, dead] });
  let got = null;
  try { await careerpuck.fetch(ENTRY, ctx); } catch (e) { got = e; }
  if (got?.status === 500 && ctx.calls.length === 3) pass('careerpuck.fetch() throws when the board fails after retries, rather than reading as empty');
  else fail(`careerpuck.fetch() failure: ${got?.message} after ${ctx.calls.length} calls`);
}
{
  const unavailable = Object.assign(new Error('Service Unavailable'), { status: 503 });
  const ctx = routedCtx({ [API_URL]: [unavailable, envelope([row('1')])] });
  const jobs = await careerpuck.fetch(ENTRY, ctx);
  if (jobs.length === 1 && ctx.calls.length === 2) pass('careerpuck.fetch() retries a transient 503');
  else fail(`careerpuck.fetch() retry: ${jobs.length} jobs, ${ctx.calls.length} calls`);
}
{
  let msg = '';
  try { await careerpuck.fetch(ENTRY, routedCtx({ [API_URL]: [{ message: 'maintenance' }] })); } catch (e) { msg = e.message; }
  if (/unexpected response/.test(msg)) pass('careerpuck.fetch() throws on a broken envelope');
  else fail(`careerpuck.fetch() broken envelope: ${msg}`);
  const empty = await careerpuck.fetch(ENTRY, routedCtx({ [API_URL]: [envelope([])] }));
  if (Array.isArray(empty) && empty.length === 0) pass('careerpuck.fetch() returns [] for a live empty board');
  else fail(`careerpuck.fetch() empty: ${JSON.stringify(empty)}`);
}
