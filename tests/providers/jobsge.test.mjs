// tests/providers/jobsge.test.mjs — jobs.ge single-page listing-table provider.
//
// Fixtures reproduce the row shape measured on the live board on 2026-10-02:
// `#job_list_table` rows with a star image carrying the posting id, a title
// link `/en/?view=jobs&id=N`, the employer in the 4th cell and "01 October"
// style dates with no year.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — jobsge (jobs.ge listing table)');

const row = (id, title, company, published = '01 October') => `
  <tr>
    <td><img id="${id}" src="/i/unstar.gif" width="16" height="16" alt="" class="unstar" /></td>
    <td >
      <a href="/en/?view=jobs&id=${id}" class="vip">${title}</a>
      <a href="/en/?view=jobs&id=${id}" target="_blank"><img src="/i/newwindow.gif" /></a>
    </td>
    <td style="padding-right:10px;text-align:right;"><a href="/en/?view=client&client=x"><img src="/data/clients/logo.gif" alt="${company}" /></a></td>
    <td><a href="/en/?view=client&client=x" >
        ${company}
      </a></td>
    <td >${published}</td>
    <td >01 November</td>
  </tr>`;

const page = (rows) => `<html><body><table style="width:100%;" id="job_list_table">
  <tr><th></th><th>Standart Advertisements</th><th></th><th>Provided By</th><th>Published</th><th>Deadline</th></tr>
  ${rows.join('')}</table></body></html>`;

function stubCtx(answer) {
  const calls = [];
  return {
    calls,
    ctx: {
      sleep: async () => {},
      fetchText: async (url, opts) => { calls.push({ url, opts }); return answer(url); },
    },
  };
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/jobsge.mjs')).href);
  const jobsge = mod.default;
  const { resolveFilters, buildListUrl, locationLabel, parsePublished, parseListingPage } = mod;

  if (jobsge.id === 'jobsge') pass('jobsge.id is "jobsge"');
  else fail(`jobsge.id is ${JSON.stringify(jobsge.id)}`);

  // ── detect(): explicit-only ──
  const hit = jobsge.detect({ name: 'jobs.ge', provider: 'jobsge', location: 17 });
  if (hit && hit.url === 'https://jobs.ge/en/?page=1&q=&cid=6&lid=17') pass('detect() resolves provider:jobsge → IT category + location filter URL');
  else fail(`detect() returned ${JSON.stringify(hit)}`);
  const misses = [{ name: 'x' }, { name: 'x', careers_url: 'https://jobs.ge/en/?view=client&client=x' }, { name: 'x', provider: 'staffam' }, null, undefined];
  if (misses.every((e) => jobsge.detect(e) === null)) pass('detect() claims nothing without provider: jobsge');
  else fail('detect() claimed an entry it should not');

  // ── resolveFilters / buildListUrl ──
  {
    const d = resolveFilters({});
    const s = resolveFilters({ category: '3', location: '1' });
    if (d.category === 6 && d.location === null && s.category === 3 && s.location === 1
        && buildListUrl(d) === 'https://jobs.ge/en/?page=1&q=&cid=6') {
      pass('resolveFilters(): IT default, numeric strings accepted; no lid when location omitted');
    } else fail(`resolveFilters wrong: ${JSON.stringify([d, s])}`);
    const bad = [{ category: 'it' }, { location: -1 }, { location: 1.5 }];
    const threw = bad.filter((e) => { try { resolveFilters(e); return false; } catch { return true; } });
    if (threw.length === bad.length) pass('resolveFilters(): a non-numeric / negative / fractional id throws');
    else fail('resolveFilters() accepted a bad id');
  }

  // ── locationLabel ──
  if (locationLabel(17) === 'Georgia (Remote)' && locationLabel(1) === 'Tbilisi, Georgia' && locationLabel(null) === 'Georgia' && locationLabel(99) === 'Georgia') {
    pass('locationLabel(): remote / Tbilisi labels, "Georgia" otherwise');
  } else fail('locationLabel wrong');

  // ── parsePublished: year inference ──
  {
    const now = Date.UTC(2026, 9, 2, 12); // 2 Oct 2026
    const oct1 = parsePublished('01 October', now);
    const dec = parsePublished('20 December', Date.UTC(2027, 0, 5)); // read in January
    if (oct1 === Date.UTC(2026, 9, 1) - 4 * 3600e3 && new Date(dec).getUTCFullYear() === 2026
        && parsePublished('yesterday', now) === undefined && parsePublished('40 October', now) === undefined) {
      pass('parsePublished(): Tbilisi midnight, a future-looking date rolls back a year, junk → undefined');
    } else fail(`parsePublished wrong: ${oct1} ${dec}`);
  }

  // ── parseListingPage ──
  {
    const html = page([row(755545, 'Go/Golang Developer', 'Exxeta'), row(755546, 'Backend &amp; Data Engineer', 'Acme'), row(755545, 'Go/Golang Developer', 'Exxeta')]);
    const jobs = parseListingPage(html, 'u', { location: 17 }, Date.UTC(2026, 9, 2));
    if (jobs.length === 2 && jobs[0].url === 'https://jobs.ge/en/?view=jobs&id=755545' && jobs[0].company === 'Exxeta'
        && jobs[1].title === 'Backend & Data Engineer' && jobs.every((j) => j.location === 'Georgia (Remote)' && typeof j.postedAt === 'number')) {
      pass('parseListingPage(): title/company/url/date per row, entities decoded, duplicate ids collapsed');
    } else fail(`parseListingPage wrong: ${JSON.stringify(jobs)}`);

    const empty = parseListingPage(page([]), 'u', { location: null });
    let got;
    try { parseListingPage('<html>redesign</html>', 'u', { location: null }); } catch (e) { got = e; }
    if (Array.isArray(empty) && empty.length === 0 && got && /job_list_table/.test(got.message)) {
      pass('parseListingPage(): an empty table → []; no table → throws');
    } else fail('empty/markup-change handling wrong');
  }

  // ── fetch(): one request, browser-like UA, redirects refused ──
  {
    const { ctx, calls } = stubCtx(() => page([row(1, 'Java Developer', 'Acme')]));
    const jobs = await jobsge.fetch({ name: 'jobs.ge', provider: 'jobsge', location: 17 }, ctx);
    const opts = calls[0]?.opts;
    if (jobs.length === 1 && calls.length === 1 && calls[0].url.endsWith('cid=6&lid=17')
        && opts?.redirect === 'error' && /Mozilla/.test(opts?.headers?.['User-Agent'] ?? '')) {
      pass('fetch(): one request with the browser-like UA and redirect: error');
    } else fail(`fetch wrong: ${calls.length} calls, ${JSON.stringify(opts)}`);

    const err = new Error('boom');
    const { ctx: ctx2 } = stubCtx(() => { throw err; });
    let got;
    try { await jobsge.fetch({ name: 'x', provider: 'jobsge' }, ctx2); } catch (e) { got = e; }
    if (got === err) pass('fetch(): a failing request throws (a dead board is not an empty one)');
    else fail(`fetch failure should throw: ${got}`);
  }
} catch (e) {
  fail(`jobsge tests crashed: ${e.stack || e.message}`);
}
