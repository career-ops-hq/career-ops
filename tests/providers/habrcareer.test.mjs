// tests/providers/habrcareer.test.mjs — Habr Career board-wide SSR-state provider.
//
// Fixtures reproduce the shape measured on the live board on 2026-10-02:
// `vacancies.list` holds 25 postings per page inside a
// `<script type="application/json" data-ssr-state="true">` block, with
// `vacancies.meta.totalPages`; a page past the end answers with `list: []`.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — habrcareer (career.habr.com SSR state)');

let nextId = 1000168000;
function row(over = {}) {
  const id = nextId++;
  return {
    id,
    href: `/vacancies/${id}`,
    title: `Java-разработчик ${id}`,
    isMarked: false,
    remoteWork: true,
    publishedDate: { date: '2026-10-02T08:27:17+03:00', title: '2 октября' },
    location: null,
    locations: [{ title: 'Москва', href: '/vacancies?city_id=678' }],
    company: { id: 1, alias_name: 'acme', href: '/companies/acme', title: 'Acme' },
    archived: false,
    hidden: false,
    ...over,
  };
}

const page = (list, totalPages = 1) =>
  `<html><body><script type="application/json" data-ssr-state="true">${JSON.stringify({
    isGuest: true,
    vacancies: { list, meta: { totalResults: list.length, perPage: 25, currentPage: 1, totalPages } },
  })}</script></body></html>`;

function stubCtx(answer, extra = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      sleep: async () => {},
      fetchText: async (url, opts) => {
        calls.push({ url, opts });
        return answer(url, calls.length);
      },
      ...extra,
    },
  };
}

const withQuietStderr = async (fn) => {
  const orig = console.error;
  const lines = [];
  console.error = (...a) => lines.push(a.join(' '));
  try { return { result: await fn(), lines }; } finally { console.error = orig; }
};

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/habrcareer.mjs')).href);
  const habr = mod.default;
  const { buildListUrl, extractSsrState, normalizeRow, parseListingPage } = mod;

  if (habr.id === 'habrcareer') pass('habrcareer.id is "habrcareer"');
  else fail(`habrcareer.id is ${JSON.stringify(habr.id)}`);

  // ── detect(): explicit-only ──
  const hit = habr.detect({ name: 'Habr', provider: 'habrcareer', remote: true });
  if (hit && hit.url === 'https://career.habr.com/vacancies?type=all&sort=date&remote=true') pass('detect() resolves provider:habrcareer (remote) → the listing URL');
  else fail(`detect() returned ${JSON.stringify(hit)}`);
  const misses = [{ name: 'x' }, { name: 'x', careers_url: 'https://career.habr.com/companies/acme' }, { name: 'x', provider: 'staffam' }, null, undefined];
  if (misses.every((e) => habr.detect(e) === null)) pass('detect() claims nothing without provider: habrcareer');
  else fail('detect() claimed an entry it should not');

  // ── buildListUrl ──
  if (buildListUrl({}, 1) === 'https://career.habr.com/vacancies?type=all&sort=date'
      && buildListUrl({ remote: true }, 3) === 'https://career.habr.com/vacancies?type=all&sort=date&remote=true&page=3') {
    pass('buildListUrl(): date-sorted, remote and page params only');
  } else fail(`buildListUrl wrong: ${buildListUrl({ remote: true }, 3)}`);

  // ── extractSsrState ──
  if (extractSsrState('<html></html>') === null && extractSsrState(42) === null
      && extractSsrState('<script type="application/json" data-ssr-state="true">{bad</script>') === null) {
    pass('extractSsrState(): null on missing / non-string / malformed JSON');
  } else fail('extractSsrState() should return null on bad input');

  // ── normalizeRow ──
  {
    const r = row({ title: 'Backend &amp; Data Engineer', locations: [{ title: 'Москва' }, { title: 'Минск' }] });
    const j = normalizeRow(r);
    if (j && j.title === 'Backend & Data Engineer' && j.url === `https://career.habr.com/vacancies/${r.id}`
        && j.company === 'Acme' && j.location === 'Москва, Минск (Remote)'
        && j.postedAt === Date.parse('2026-10-02T08:27:17+03:00')) {
      pass('normalizeRow(): title decoded, canonical URL from id, cities joined + remote flag, date parsed');
    } else fail(`normalizeRow wrong: ${JSON.stringify(j)}`);

    const remoteNoCity = normalizeRow(row({ locations: null }));
    const onsite = normalizeRow(row({ remoteWork: false }));
    if (remoteNoCity?.location === 'Remote' && onsite?.location === 'Москва') pass('normalizeRow(): remote-without-city → "Remote", on-site keeps the bare city');
    else fail(`location variants wrong: ${remoteNoCity?.location} / ${onsite?.location}`);

    const dropped = [row({ archived: true }), row({ hidden: true }), row({ title: '' }), row({ id: 'x' }), null, 7].map(normalizeRow);
    if (dropped.every((x) => x === null)) pass('normalizeRow(): archived / hidden / untitled / bad-id / non-object rows → null');
    else fail(`normalizeRow should drop bad rows: ${JSON.stringify(dropped)}`);
  }

  // ── parseListingPage: shape guard ──
  {
    let got;
    try { parseListingPage('<script type="application/json" data-ssr-state="true">{"vacancies":{}}</script>', 'u'); } catch (e) { got = e; }
    if (got && /vacancies\.list/.test(got.message)) pass('parseListingPage(): missing vacancies.list throws');
    else fail(`missing list should throw: ${got}`);
  }

  // ── fetch(): walks pages until totalPages, de-dupes, remote param sent ──
  {
    const p1 = Array.from({ length: 25 }, () => row());
    const p2 = [row(), p1[0]];
    const { ctx, calls } = stubCtx((url) => (url.includes('page=2') ? page(p2, 2) : page(p1, 2)));
    const jobs = await habr.fetch({ name: 'Habr', provider: 'habrcareer', remote: true }, ctx);
    if (jobs.length === 26 && calls.length === 2 && calls.every((c) => c.url.includes('remote=true') && c.opts?.redirect === 'error')
        && jobs.every((j) => !('id' in j))) {
      pass('fetch(): walks to the last page, de-dupes across pages, sends remote=true, refuses redirects');
    } else fail(`fetch walk wrong: ${jobs.length} jobs, ${calls.length} calls`);
  }

  // ── fetch(): max_pages truncation warns ──
  {
    const full = () => page(Array.from({ length: 25 }, () => row()), 10);
    const { ctx, calls } = stubCtx(full);
    const { result, lines } = await withQuietStderr(() => habr.fetch({ name: 'Habr', provider: 'habrcareer', max_pages: 2 }, ctx));
    if (result.length === 50 && calls.length === 2 && lines.some((l) => /truncated at max_pages=2/.test(l))) pass('fetch(): max_pages caps the walk and warns');
    else fail(`max_pages wrong: ${result.length} jobs, ${JSON.stringify(lines)}`);
  }

  // ── fetch(): probe mode reads only ctx.maxPages and does not warn ──
  {
    const { ctx, calls } = stubCtx(() => page(Array.from({ length: 25 }, () => row()), 10), { maxPages: 1 });
    const { lines } = await withQuietStderr(() => habr.fetch({ name: 'Habr', provider: 'habrcareer' }, ctx));
    if (calls.length === 1 && lines.length === 0) pass('fetch(): a health probe reads one page, silently');
    else fail(`probe wrong: ${calls.length} calls, ${JSON.stringify(lines)}`);
  }

  // ── fetch(): failures ──
  {
    const err = new Error('boom');
    const { ctx } = stubCtx(() => { throw err; });
    let got;
    try { await habr.fetch({ name: 'x', provider: 'habrcareer' }, ctx); } catch (e) { got = e; }
    if (got === err) pass('fetch(): a failing first page throws (a dead board is not an empty one)');
    else fail(`first-page failure should throw: ${got}`);

    const p1 = Array.from({ length: 25 }, () => row());
    const { ctx: ctx2 } = stubCtx((url) => { if (url.includes('page=2')) throw new Error('later'); return page(p1, 3); });
    const { result, lines } = await withQuietStderr(() => habr.fetch({ name: 'x', provider: 'habrcareer' }, ctx2));
    if (result.length === 25 && lines.some((l) => /stopped at page 2/.test(l))) pass('fetch(): a later-page failure keeps what was read and warns');
    else fail(`later-page failure wrong: ${result.length}, ${JSON.stringify(lines)}`);

    const { ctx: ctx3 } = stubCtx(() => '<html><body>new design</body></html>');
    got = undefined;
    try { await habr.fetch({ name: 'x', provider: 'habrcareer' }, ctx3); } catch (e) { got = e; }
    if (got && /data-ssr-state/.test(got.message)) pass('fetch(): a page with no SSR state throws');
    else fail(`markup change should throw: ${got}`);

    const { ctx: ctx4 } = stubCtx(() => page([], 0));
    const empty = await habr.fetch({ name: 'x', provider: 'habrcareer' }, ctx4);
    if (Array.isArray(empty) && empty.length === 0) pass('fetch(): an empty board → []');
    else fail('empty board should return []');
  }
} catch (e) {
  fail(`habrcareer tests crashed: ${e.stack || e.message}`);
}
