// tests/providers/icims-host-fallback.test.mjs — fetch() moves to a fallback
// host only when the previous host answers 404 on its first page.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — icims host fallback');

const icims = (await import(pathToFileURL(join(ROOT, 'providers/icims.mjs')).href)).default;

const PRIMARY = 'https://careers-acmefreight.icims.com';
const FALLBACK = 'https://acmefreight.icims.com';
const card = (origin, id, title) => `<li class="iCIMS_JobCardItem"><div class="col-xs-12 title">
<a href="${origin}/jobs/${id}/role-${id}/job?in_iframe=1" class="iCIMS_Anchor"><h3>${title}</h3></a></div></li>`;
const page = (...cards) => `<ul class="iCIMS_JobsTable">${cards.join('')}</ul>`;
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

// boards maps an origin to its pages (array), a per-page function, or an Error
// thrown for every page. An origin with no entry answers 404.
function mkCtx(boards) {
  const calls = [];
  return {
    calls,
    transport: 'http',
    sleep: async () => {},
    fetchJson: async () => { throw new Error('fetchJson should not be called'); },
    fetchText: async (url) => {
      const u = new URL(url);
      const pr = Number(u.searchParams.get('pr'));
      calls.push(`${u.origin}#${pr}`);
      const board = boards[u.origin];
      if (board === undefined) throw httpError(404);
      if (board instanceof Error) throw board;
      if (typeof board === 'function') return board(pr);
      return board[pr] ?? page();
    },
  };
}

const entry = {
  name: 'acmefreight',
  careers_url: `${PRIMARY}/jobs/search?ss=1&in_iframe=1`,
  fallback_urls: [`${FALLBACK}/jobs/search?ss=1&in_iframe=1`],
};
const onlyPrimary = (ctx) => ctx.calls.length > 0 && ctx.calls.every((c) => c.startsWith(`${PRIMARY}#`));

// Primary answers 404 on its first page: the fallback host is walked instead.
{
  const ctx = mkCtx({ [FALLBACK]: [page(card(FALLBACK, 1, 'Role A'))] });
  const jobs = await icims.fetch(entry, ctx);
  if (jobs.length === 1 && jobs[0].url.startsWith(`${FALLBACK}/jobs/1/`)) pass('first-page 404 on the primary host falls back to the next host');
  else fail(`fallback: jobs=${JSON.stringify(jobs)} calls=${ctx.calls.join(',')}`);
}

// A live primary never requests the fallback.
{
  const ctx = mkCtx({
    [PRIMARY]: [page(card(PRIMARY, 2, 'Role B'))],
    [FALLBACK]: new Error('fallback must not be requested'),
  });
  const jobs = await icims.fetch(entry, ctx);
  if (jobs.length === 1 && onlyPrimary(ctx)) pass('a live primary host never requests the fallback');
  else fail(`live primary: jobs=${jobs.length} calls=${ctx.calls.join(',')}`);
}

// Every host answers 404: the 404 surfaces, so dead-board tracking counts a miss.
{
  const ctx = mkCtx({});
  try {
    await icims.fetch(entry, ctx);
    fail('fetch resolved with no live host');
  } catch (err) {
    if (err.status === 404 && ctx.calls.join(',') === `${PRIMARY}#0,${FALLBACK}#0`) pass('all hosts 404: each tried once, then the 404 is thrown');
    else fail(`all 404: status=${err.status} calls=${ctx.calls.join(',')}`);
  }
}

// A throttle is not "no board here": rethrown without trying the fallback.
{
  const ctx = mkCtx({ [PRIMARY]: httpError(429), [FALLBACK]: [page(card(FALLBACK, 3, 'Role C'))] });
  try {
    await icims.fetch(entry, ctx);
    fail('fetch swallowed a 429');
  } catch (err) {
    if (err.status === 429 && onlyPrimary(ctx)) pass('non-404 failure is rethrown without falling back');
    else fail(`429: status=${err.status} calls=${ctx.calls.join(',')}`);
  }
}

// A 404 after the first page is a problem on a real board, not a missing board.
{
  const ctx = mkCtx({
    [PRIMARY]: (pr) => { if (pr === 0) return page(card(PRIMARY, 4, 'Role D')); throw httpError(404); },
    [FALLBACK]: [page(card(FALLBACK, 5, 'Role E'))],
  });
  try {
    await icims.fetch(entry, ctx);
    fail('fetch resolved despite a later-page 404');
  } catch (err) {
    if (err.status === 404 && onlyPrimary(ctx)) pass('a later-page 404 does not switch hosts');
    else fail(`later-page 404: status=${err.status} calls=${ctx.calls.join(',')}`);
  }
}

// Fallback URLs that are not https *.icims.com are ignored.
{
  const ctx = mkCtx({ 'https://evil.example': [page(card('https://evil.example', 6, 'Role F'))] });
  const hostile = { ...entry, fallback_urls: ['https://evil.example/jobs/search', 'http://acmefreight.icims.com/jobs/search'] };
  try {
    await icims.fetch(hostile, ctx);
    fail('fetch followed an off-host fallback');
  } catch (err) {
    if (err.status === 404 && onlyPrimary(ctx)) pass('fallback URLs off https *.icims.com are ignored');
    else fail(`hostile fallback: status=${err.status} calls=${ctx.calls.join(',')}`);
  }
}

// An entry with no fallback behaves exactly as before: the 404 is thrown.
{
  const ctx = mkCtx({});
  try {
    await icims.fetch({ name: 'acmefreight', careers_url: `${PRIMARY}/jobs/search?ss=1` }, ctx);
    fail('fetch resolved for a missing board without fallbacks');
  } catch (err) {
    if (err.status === 404 && ctx.calls.length === 1) pass('entry without fallback_urls: 404 thrown after one request');
    else fail(`no fallback: status=${err.status} calls=${ctx.calls.join(',')}`);
  }
}
