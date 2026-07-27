// tests/providers/avature.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — avature (career-site SearchJobs parser)');


try {
  const avatureModule = await import(pathToFileURL(join(ROOT, 'providers/avature.mjs')).href);
  const avature = avatureModule.default;
  const { parseArticles } = avatureModule;

  if (avature.id === 'avature') pass('avature.id is "avature"');
  else fail(`avature.id is ${JSON.stringify(avature.id)}`);

  if (avature.detect({ name: 'X', careers_url: 'https://acme.avature.net/careers/SearchJobs' })) pass('avature.detect() claims a *.avature.net URL');
  else fail('avature.detect() should claim *.avature.net');
  if (avature.detect({ name: 'X', careers_url: 'https://evil.example/x.avature.net/y' }) === null) pass('avature.detect() rejects a path-spoofed URL');
  else fail('avature.detect() must reject path-spoofed URLs');

  // parseArticles — a compact fragment: one article with a locale-prefixed
  // JobDetail path + a posted date, one with no JobDetail link (dropped).
  const origin = 'https://acme.avature.net';
  const fragment = `
    <article class="article article--result" id="article--1">
      <div class="article__header"><div class="article__header__text">
        <h3 class="title"><a class="link" href="https://acme.avature.net/careers/JobDetail/Senior-PLM-Engineer-17304/17304?businessTitle=PLM">Senior PLM Engineer &amp; Architect</a></h3>
        <div class="article__header__text__subtitle"><span class="list-item-jobId">Job ID 17304</span><span class="list-item-posted">Posted 02-May-2026</span></div>
      </div></div>
    </article>
    <article class="article article--result" id="article--2">
      <h3 class="title"><a class="link" href="/en_US/searchjobs/JobDetail/Data-Engineer-900/900">Data Engineer</a></h3>
      <span class="list-item-location">Munich, Germany</span>
    </article>
    <article class="article article--result" id="article--3">
      <h3 class="title"><span>No link here</span></h3>
    </article>`;
  const arts = parseArticles(fragment, origin);

  if (arts.length === 2) pass('parseArticles returns 2 articles (link-less one dropped)');
  else fail(`parseArticles returned ${arts.length}, expected 2`);
  const a1 = arts.find((a) => a.id === '17304');
  if (a1 && a1.title === 'Senior PLM Engineer & Architect') pass('parseArticles decodes the title entity');
  else fail(`parseArticles title wrong: ${JSON.stringify(a1 && a1.title)}`);
  if (a1 && a1.url === 'https://acme.avature.net/careers/JobDetail/Senior-PLM-Engineer-17304/17304?businessTitle=PLM') pass('parseArticles keeps the absolute JobDetail URL');
  else fail(`parseArticles url wrong: ${JSON.stringify(a1 && a1.url)}`);
  if (a1 && a1.postedAt === Date.UTC(2026, 4, 2)) pass('parseArticles parses "Posted 02-May-2026"');
  else fail(`parseArticles postedAt wrong: ${JSON.stringify(a1 && a1.postedAt)}`);
  const a2 = arts.find((a) => a.id === '900');
  if (a2 && a2.url === 'https://acme.avature.net/en_US/searchjobs/JobDetail/Data-Engineer-900/900') pass('parseArticles resolves a relative locale-prefixed JobDetail path');
  else fail(`parseArticles relative url wrong: ${JSON.stringify(a2 && a2.url)}`);
  if (a2 && a2.location === 'Munich, Germany') pass('parseArticles extracts a rendered location when present');
  else fail(`parseArticles location wrong: ${JSON.stringify(a2 && a2.location)}`);
  if (parseArticles('<div>no articles</div>', origin).length === 0) pass('parseArticles returns [] when no articles present');
  else fail('parseArticles should return [] for markup with no articles');

  // Tenant markup variants: Siemens appends a position index to the result
  // class ("article--result 1"); Rohde & Schwarz renders the title anchor with
  // no class="link". Both must still parse. (Regressions found on live tenants.)
  const variants = `
    <article class="article article--result 1" id="article--1">
      <h3 class="title"><a class="link" href="https://acme.avature.net/en_US/externaljobs/JobDetail/Head-of-PLM/511918">Head of PLM</a></h3>
    </article>
    <article class="article article--result" id="article--2">
      <h3 class="title"><a href="https://acme.avature.net/en_US/careers/JobDetail/Director-Platform/13672">Director Platform Engineering</a></h3>
    </article>`;
  const vArts = parseArticles(variants, origin);
  const vSuffix = vArts.find((a) => a.id === '511918');
  if (vSuffix && vSuffix.title === 'Head of PLM') pass('parseArticles handles the "article--result 1" class suffix (Siemens)');
  else fail(`parseArticles missed the class-suffix variant: ${JSON.stringify(vArts.map((a) => a.id))}`);
  const vNoClass = vArts.find((a) => a.id === '13672');
  if (vNoClass && vNoClass.title === 'Director Platform Engineering') pass('parseArticles falls back to a JobDetail anchor without class="link" (Rohde & Schwarz)');
  else fail(`parseArticles missed the no-class-link variant: ${JSON.stringify(vArts.map((a) => a.id))}`);

  // Pagination key — default `jobOffset`, self-heals to `offset` for tenants
  // that ignore it (Siemens). Mock fetchText with an article-less page so
  // fetch() stops after one request and we can read the URL it built.
  const captureFirstUrl = async (entry) => {
    let firstUrl;
    const ctx = { sleep: async () => {}, fetchText: async (url) => { if (firstUrl === undefined) firstUrl = url; return '<div>no articles</div>'; } };
    await avature.fetch(entry, ctx);
    return firstUrl;
  };
  const base = 'https://acme.avature.net/careers/SearchJobs';
  if (await captureFirstUrl({ name: 'X', api: base }) === `${base}?jobOffset=0`) pass('avature.fetch() defaults pagination to ?jobOffset=N');
  else fail('avature.fetch() should default to jobOffset');
  if (await captureFirstUrl({ name: 'X', api: base, offset_param: 'offset' }) === `${base}?offset=0`) pass('avature.fetch() honours offset_param override (Siemens: ?offset=N)');
  else fail('avature.fetch() should use offset_param when set');
  if (await captureFirstUrl({ name: 'X', api: base, offset_param: '  ' }) === `${base}?jobOffset=0`) pass('avature.fetch() falls back to jobOffset for a blank offset_param');
  else fail('avature.fetch() should ignore a blank offset_param');

  // Self-heal — jobOffset→offset when the primary key is inert.
  const originB = 'https://acme.avature.net';
  const mkHtml = (ids) => ids.map((id) =>
    `<article class="article article--result"><h3 class="title"><a class="link" href="${originB}/careers/JobDetail/Role-${id}/${id}">Role ${id}</a></h3></article>`).join('');
  // Build a ctx whose fetchText answers from a {param: (pageIndex)=>ids} map.
  const mkCtx = () => {
    const calls = [];
    let sleeps = 0;
    const ctx = {
      sleep: async () => { sleeps += 1; },
      fetchText: async (url) => {
        calls.push(url);
        const u = new URL(url);
        const jo = u.searchParams.get('jobOffset');
        const of = u.searchParams.get('offset');
        if (jo !== null) return mkHtml([1, 2, 3, 4, 5, 6]); // jobOffset inert: always page 0
        if (of !== null) {
          const n = Number(of) / 6;
          if (n === 0) return mkHtml([1, 2, 3, 4, 5, 6]);
          if (n === 1) return mkHtml([7, 8, 9, 10, 11, 12]); // offset advances
          if (n === 2) return mkHtml([13, 14]); // partial → last page
          return mkHtml([]);
        }
        return '<div>no articles</div>';
      },
    };
    return { ctx, calls, sleeps: () => sleeps };
  };
  const heal = mkCtx();
  const healed = await avature.fetch({ name: 'X', api: base }, heal.ctx);
  if (healed.length === 14) pass('avature.fetch() self-heals jobOffset→offset and walks the full board (14 jobs)');
  else fail(`avature.fetch() self-heal wrong count: ${healed.length} (expected 14)`);
  if (heal.calls.some((u) => /[?&]offset=/.test(u))) pass('avature.fetch() self-heal retries with ?offset=N');
  else fail('avature.fetch() self-heal should retry with offset');
  if (heal.sleeps() > 0) pass('avature.fetch() throttles between pages (sleep called)');
  else fail('avature.fetch() should sleep between pages');

  // No self-heal when jobOffset works: offset= must never be requested.
  const workingCtx = {
    calls: [],
    sleep: async () => {},
    fetchText: async function (url) {
      this.calls.push(url);
      const n = Number(new URL(url).searchParams.get('jobOffset')) / 6;
      if (n === 0) return mkHtml([1, 2, 3, 4, 5, 6]);
      if (n === 1) return mkHtml([7, 8, 9, 10, 11, 12]);
      return mkHtml([13, 14]); // last (partial)
    },
  };
  const worked = await avature.fetch({ name: 'X', api: base }, workingCtx);
  if (worked.length === 14 && workingCtx.calls.every((u) => /[?&]jobOffset=/.test(u))) pass('avature.fetch() does not self-heal when jobOffset already advances');
  else fail(`avature.fetch() spurious self-heal: ${worked.length} jobs, calls ${JSON.stringify(workingCtx.calls.map((u) => u.split('?')[1]))}`);

  // Self-heal must fire even when the inert primary key returns an EMPTY page 1
  // (not a repeat of page 0) — the empty-page break must not pre-empt the heal.
  const emptyP1Ctx = {
    calls: [],
    sleep: async () => {},
    fetchText: async function (url) {
      this.calls.push(url);
      const u = new URL(url);
      const jo = u.searchParams.get('jobOffset');
      const of = u.searchParams.get('offset');
      if (jo !== null) return Number(jo) === 0 ? mkHtml([1, 2, 3, 4, 5, 6]) : mkHtml([]); // page 1+ empty
      if (of !== null) {
        const n = Number(of) / 6;
        if (n === 1) return mkHtml([7, 8, 9, 10, 11, 12]);
        if (n === 2) return mkHtml([13, 14]);
        return mkHtml([]);
      }
      return '<div>no articles</div>';
    },
  };
  const emptyHealed = await avature.fetch({ name: 'X', api: base }, emptyP1Ctx);
  if (emptyHealed.length === 14 && emptyP1Ctx.calls.some((u) => /[?&]offset=/.test(u))) pass('avature.fetch() self-heals when the inert key returns an empty page 1');
  else fail(`avature.fetch() failed to heal empty page 1: ${emptyHealed.length} jobs`);
} catch (e) {
  fail(`avature provider tests crashed: ${e.message}`);
}
