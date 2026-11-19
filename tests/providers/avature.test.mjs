// tests/providers/avature.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — avature (career-site SearchJobs parser)');


try {
  const avatureModule = await import(pathToFileURL(join(ROOT, 'providers/avature.mjs')).href);
  const avature = avatureModule.default;
  const { parseArticles, countArticles, assertParsedSomething } = avatureModule;

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

  // Deloitte USI renders `article--result` without the leading `article` class.
  const bareResult = `
    <article class="article--result " data-total="573">
      <h3 class="article__header__text__title"><a href="https://usijobs.deloitte.com/en_US/careersUSI/JobDetail/USI-Data-Engineer/374504" class="link">Data Engineer</a></h3>
    </article>`;
  const bArts = parseArticles(bareResult, 'https://usijobs.deloitte.com');
  if (bArts.length === 1 && bArts[0].id === '374504' && bArts[0].title === 'Data Engineer') pass('parseArticles reads an article--result card with no leading article class');
  else fail(`parseArticles bare article--result wrong: ${JSON.stringify(bArts)}`);

  // Protocol-relative (//host/...) hrefs must resolve like a browser does —
  // string concatenation would produce "https://acme.avature.net//other/...".
  // A href new URL cannot resolve is dropped instead of emitted broken.
  const protocolRel = `
    <article class="article article--result" id="article--1">
      <h3 class="title"><a class="link" href="//jobs.acme-cdn.example/JobDetail?jobId=4242">Rel Host Engineer</a></h3>
    </article>
    <article class="article article--result" id="article--2">
      <h3 class="title"><a class="link" href="//[bad/JobDetail?jobId=1">Broken Link</a></h3>
    </article>`;
  const pArts = parseArticles(protocolRel, origin);
  const pOk = pArts.find((a) => a.id === '4242');
  if (pOk && pOk.url === 'https://jobs.acme-cdn.example/JobDetail?jobId=4242') pass('parseArticles resolves a protocol-relative href against the page scheme');
  else fail(`parseArticles protocol-relative url wrong: ${JSON.stringify(pOk && pOk.url)}`);
  if (pArts.length === 1) pass('parseArticles drops an unresolvable href instead of emitting a broken URL');
  else fail(`parseArticles returned ${pArts.length}, expected 1 (unresolvable href dropped)`);

  // A href with its own non-http scheme stays absolute through new URL, so it
  // would reach the pipeline as is: only http(s) links are job links.
  const schemes = `
    <article class="article article--result" id="article--1">
      <h3 class="title"><a class="link" href="javascript:alert(1)//JobDetail?jobId=42">Script Link</a></h3>
    </article>
    <article class="article article--result" id="article--2">
      <h3 class="title"><a class="link" href="data:text/html,x/JobDetail?jobId=43">Data Link</a></h3>
    </article>
    <article class="article article--result" id="article--3">
      <h3 class="title"><a class="link" href="/careers/JobDetail?jobId=44">Real Link</a></h3>
    </article>`;
  const sArts = parseArticles(schemes, origin);
  if (sArts.length === 1 && sArts[0].id === '44' && sArts[0].url.startsWith('https://')) pass('parseArticles drops javascript: and data: hrefs and keeps the http(s) one');
  else fail(`parseArticles non-http schemes wrong: ${JSON.stringify(sArts.map((a) => a.url))}`);

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

  // careers.avature.net (the vendor's own board, seen 2026-09-28) renders
  // `article--jobs` cards: the title anchor sits in the h3 header with no class,
  // and the only class="link" anchor is a "View more" button in the footer, so
  // preferring class="link" would title every job "View more". Location is a
  // footer <p> after an `icon-address` span.
  const jobsCard = `
    <article class="article article--jobs js_collapsible js_collapsible--enabled">
      <div class="article__header js_collapsible__header"><div class="article__header__text">
        <h3 class="article__header__text__title article__header__text__title--8">
          <a href="https://careers.avature.net/en_US/main/JobDetail/Argentina-Cloud-Engineer-Argentina/7739">
            Cloud Engineer
          </a>
        </h3>
      </div></div>
      <div class="article__footer"><div class="article__footer__info">
        <p><span class="icon icon-tag" aria-hidden="true"></span> Cloud Services</p>
        <p><span class="icon icon-address" aria-hidden="true"></span> Argentina</p>
      </div><div class="article__footer__actions">
        <a class="link" href="https://careers.avature.net/en_US/main/JobDetail/Argentina-Cloud-Engineer-Argentina/7739" aria-label="View more of job:Cloud Engineer">View more</a>
      </div></div>
    </article>`;
  const jArts = parseArticles(jobsCard, 'https://careers.avature.net');
  const j1 = jArts.find((a) => a.id === '7739');
  if (jArts.length === 1 && j1 && j1.title === 'Cloud Engineer') pass('parseArticles reads the h3 title of an "article--jobs" card, not the "View more" link');
  else fail(`parseArticles article--jobs card wrong: ${JSON.stringify(jArts)}`);
  if (j1 && j1.location === 'Argentina') pass('parseArticles extracts the icon-address location of an "article--jobs" card');
  else fail(`parseArticles article--jobs location wrong: ${JSON.stringify(j1 && j1.location)}`);

  // Query-style links (Macquarie): `/JobDetail?jobId=<id>`, no slug segment.
  // The path-only regex dropped every article, so the board read as empty.
  const queryStyle = `
    <article class="article article--result clearfix ">
      <h3 class="article__header__text__title title title--02">
        <a class="link" href="https://recruitment.macquarie.com/en_US/careers/JobDetail?jobId=24224">
          Quality Engineer
        </a>
      </h3>
      <a class="share" href="mailto:?body=https%3A%2F%2Frecruitment.macquarie.com%2Fen_US%2Fcareers%2FJobDetail%3FjobId%3D24224">Share</a>
    </article>
    <article class="article article--result">
      <h3 class="title"><a class="link" href="/en_US/careers/JobDetail?lang=en&amp;jobId=24335">Platform Engineer</a></h3>
    </article>`;
  const qArts = parseArticles(queryStyle, 'https://recruitment.macquarie.com');
  const q1 = qArts.find((a) => a.id === '24224');
  if (qArts.length === 2 && q1 && q1.title === 'Quality Engineer' && q1.url === 'https://recruitment.macquarie.com/en_US/careers/JobDetail?jobId=24224') {
    pass('parseArticles accepts query-style /JobDetail?jobId=<id> links (Macquarie)');
  } else {
    fail(`parseArticles missed query-style links: ${JSON.stringify(qArts)}`);
  }
  const q2 = qArts.find((a) => a.id === '24335');
  if (q2 && q2.url === 'https://recruitment.macquarie.com/en_US/careers/JobDetail?lang=en&jobId=24335') {
    pass('parseArticles extracts jobId when it is not the first query param');
  } else {
    fail(`parseArticles jobId extraction wrong: ${JSON.stringify(qArts.map((a) => a.id))}`);
  }

  // A listing page with no rows: the result-list toolbar every real Avature listing page carries
  // (captured on Enel, Siemens, Macquarie, Deloitte USI, careers.avature.net), here without cards.
  const emptyListing = '<div class="list-controls list-controls--top"></div>';
  // What those tenants serve past the last page: the toolbar and one card that says "No jobs found".
  const noJobsPage = '<div class="list-controls list-controls--top"></div><div class="article article--result"><div class="article__header"><h3 class="article__header__text__title">No jobs found</h3></div></div>';
  // A bot-wall or error page served with HTTP 200: no rows, no toolbar.
  const challengePage = '<html><head><title>Just a moment...</title></head><body><div id="challenge-form">Checking your browser before accessing the site.</div></body></html>';
  // Pagination key — default `jobOffset`, self-heals to `offset` for tenants
  // that ignore it (Siemens). Mock fetchText with an article-less page so
  // fetch() stops after one request and we can read the URL it built.
  const captureFirstUrl = async (entry) => {
    let firstUrl;
    const ctx = { sleep: async () => {}, fetchText: async (url) => { if (firstUrl === undefined) firstUrl = url; return emptyListing; } };
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
    `<article class="article article--result"><h3 class="title"><a class="link" href="${originB}/careers/JobDetail/Role-${id}/${id}">Role ${id}</a></h3></article>`).join('') || emptyListing;
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
        return emptyListing;
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

  // The short-page stop compares the number of result cards the SOURCE returned,
  // not the number parseArticles() kept (ADDING_A_PROVIDER.md, "Defensive
  // parsing"): one card without a JobDetail link on a full page must not end
  // the walk.
  const noLinkCard = '<article class="article article--result"><h3 class="title">Card without a link</h3></article>';
  const mkPagedCtx = (pages) => ({
    calls: [],
    sleep: async () => {},
    fetchText: async function (url) {
      this.calls.push(url);
      return pages[Number(new URL(url).searchParams.get('jobOffset')) / 6] ?? mkHtml([]);
    },
  });
  const droppedCardCtx = mkPagedCtx([mkHtml([1, 2, 3, 4, 5]) + noLinkCard, mkHtml([7, 8, 9, 10, 11, 12]), mkHtml([13, 14])]);
  const droppedCardJobs = await avature.fetch({ name: 'X', api: base }, droppedCardCtx);
  if (droppedCardJobs.length === 13 && droppedCardCtx.calls.length === 3) pass('avature.fetch() keeps paging past a full page that carries a card without a JobDetail link');
  else fail(`avature.fetch() returned ${droppedCardJobs.length} jobs after ${droppedCardCtx.calls.length} calls, expected 13 after 3`);

  // Control: a genuinely short page still ends the walk.
  const shortPageCtx = mkPagedCtx([mkHtml([1, 2, 3])]);
  const shortPageJobs = await avature.fetch({ name: 'X', api: base }, shortPageCtx);
  if (shortPageJobs.length === 3 && shortPageCtx.calls.length === 1) pass('avature.fetch() still stops after a short page of valid cards');
  else fail(`avature.fetch() returned ${shortPageJobs.length} jobs after ${shortPageCtx.calls.length} calls, expected 3 after 1`);

  // A full page whose links are all dropped (non-http scheme) is not an empty or
  // repeated page: the walk must go on to the next one instead of stopping there.
  const scriptCard = (id) => `<article class="article article--result"><h3 class="title"><a class="link" href="javascript:void(0)//JobDetail?jobId=${id}">Role ${id}</a></h3></article>`;
  const droppedPageCtx = mkPagedCtx([mkHtml([1, 2, 3, 4, 5, 6]), emptyListing + [7, 8, 9, 10, 11, 12].map(scriptCard).join(''), mkHtml([13, 14])]);
  const droppedPageJobs = await avature.fetch({ name: 'X', api: base }, droppedPageCtx);
  if (droppedPageJobs.length === 8 && droppedPageCtx.calls.length === 3) pass('avature.fetch() keeps paging past a full page whose links were all dropped');
  else fail(`avature.fetch() returned ${droppedPageJobs.length} jobs after ${droppedPageCtx.calls.length} calls, expected 8 after 3`);

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
      return emptyListing;
    },
  };
  const emptyHealed = await avature.fetch({ name: 'X', api: base }, emptyP1Ctx);
  if (emptyHealed.length === 14 && emptyP1Ctx.calls.some((u) => /[?&]offset=/.test(u))) pass('avature.fetch() self-heals when the inert key returns an empty page 1');
  else fail(`avature.fetch() failed to heal empty page 1: ${emptyHealed.length} jobs`);

  // Facet pass-through (Siemens) — an entry pinned to a pre-narrowed board
  // (e.g. ?42386=[812132]&42390=[102157,102158] — country/experience facets
  // picked in the site's own filter UI) must keep those facets on EVERY
  // paginated request, not just page 0, or the "narrowed" board silently
  // widens back out to the full unfiltered board past page 1.
  {
    const facetBase = 'https://acme.avature.net/careers/SearchJobs/?42386=%5B812132%5D&listFilterMode=1&folderRecordsPerPage=6';
    const capturedUrls = [];
    const facetCtx = {
      sleep: async () => {},
      fetchText: async (url) => { capturedUrls.push(url); return emptyListing; },
    };
    await avature.fetch({ name: 'X', api: facetBase }, facetCtx);
    const firstUrl = capturedUrls[0] ? new URL(capturedUrls[0]) : null;
    if (firstUrl && firstUrl.searchParams.get('42386') === '[812132]' && firstUrl.searchParams.get('jobOffset') === '0') {
      pass('avature.fetch() carries a pinned facet query param through to the request');
    } else {
      fail(`avature.fetch() dropped the facet param: ${JSON.stringify(capturedUrls[0])}`);
    }

    // A facet named the same as our own pagination key must never win —
    // our per-page offset always overwrites it.
    const collideBase = 'https://acme.avature.net/careers/SearchJobs/?jobOffset=999&42386=%5B812132%5D';
    const collideUrls = [];
    const collideCtx = {
      sleep: async () => {},
      fetchText: async (url) => { collideUrls.push(url); return emptyListing; },
    };
    await avature.fetch({ name: 'X', api: collideBase }, collideCtx);
    const collideUrl = collideUrls[0] ? new URL(collideUrls[0]) : null;
    if (collideUrl && collideUrl.searchParams.get('jobOffset') === '0' && collideUrl.searchParams.get('42386') === '[812132]') {
      pass('avature.fetch() strips a facet colliding with the pagination key, keeping unrelated facets');
    } else {
      fail(`avature.fetch() facet/pagination-key collision handled wrong: ${JSON.stringify(collideUrls[0])}`);
    }
  }

  // Empty board vs a broken selector — a first page carrying posting-shaped
  // JobDetail links but zero parsed articles is a markup change, not a quiet
  // board; assertParsedSomething is the guard, mirrored by itviec.mjs's
  // assertParsedSomething.
  {
    let threw = false;
    try {
      assertParsedSomething('<a href="/careers/JobDetail/Some-Role/123">Some Role</a>', 'https://acme.avature.net/careers/SearchJobs');
    } catch {
      threw = true;
    }
    if (threw) pass('assertParsedSomething() throws when JobDetail links are present but unparsed');
    else fail('a page still carrying JobDetail links must not be reported as empty');

    let threwQuery = false;
    try {
      assertParsedSomething('<a href="/careers/JobDetail?jobId=123">Some Role</a>', 'https://acme.avature.net/careers/SearchJobs');
    } catch {
      threwQuery = true;
    }
    if (threwQuery) pass('assertParsedSomething() throws on unparsed query-style JobDetail links too');
    else fail('a page carrying query-style JobDetail links must not be reported as empty');

    let threwOnEmpty = false;
    try {
      assertParsedSomething('<html><body>No open roles right now.</body></html>', 'https://acme.avature.net/careers/SearchJobs');
    } catch {
      threwOnEmpty = true;
    }
    if (!threwOnEmpty) pass('assertParsedSomething() does not throw on a genuinely empty page (no JobDetail links)');
    else fail('a genuinely empty listing page must be allowed, or a quiet board reads as broken');
  }

  // fetch()-level: the same split, wired into the pagination loop. A first
  // page whose markup broke (JobDetail links present, no <article> the
  // parser recognizes) must fail the whole fetch() loud, not return []
  // silently.
  {
    const brokenMarkupCtx = {
      sleep: async () => {},
      fetchText: async () => '<a href="/careers/JobDetail/Some-Role/123">Some Role</a>',
    };
    let threw = false;
    try {
      await avature.fetch({ name: 'X', api: base }, brokenMarkupCtx);
    } catch {
      threw = true;
    }
    if (threw) pass('avature.fetch() throws when the first page has JobDetail links but the parser matched nothing');
    else fail('avature.fetch() should surface a broken selector as an error, not an empty board');

    const genuinelyEmptyCtx = {
      sleep: async () => {},
      fetchText: async () => `<html><body>${emptyListing}No open roles right now.</body></html>`,
    };
    let jobs;
    let threwOnEmpty = false;
    try {
      jobs = await avature.fetch({ name: 'X', api: base }, genuinelyEmptyCtx);
    } catch {
      threwOnEmpty = true;
    }
    if (!threwOnEmpty && Array.isArray(jobs) && jobs.length === 0) {
      pass('avature.fetch() returns [] for a genuinely empty first page (no JobDetail links)');
    } else {
      fail(`avature.fetch() mishandled a genuinely empty board: threw=${threwOnEmpty}, jobs=${JSON.stringify(jobs)}`);
    }
  }

  // A challenge, login or error page served with HTTP 200 is a named failure on every page.
  {
    const page = (n) => mkHtml([1, 2, 3, 4, 5, 6].map((i) => i + n * 6));
    const run = async (ctx, entry = { name: 'X', api: base }) => {
      try { return { jobs: await avature.fetch(entry, ctx) }; } catch (e) { return { err: e }; }
    };
    const named = (r) => r.err && /does not look like an Avature listing page/.test(r.err.message);
    const first = await run({ sleep: async () => {}, fetchText: async () => challengePage });
    if (named(first)) pass('avature.fetch() throws a named error when the first page is a 200 challenge page, not []');
    else fail(`challenge on page 0: ${JSON.stringify(first.jobs ?? first.err?.message)}`);

    const later = await run({ sleep: async () => {}, fetchText: async (url) => (Number(new URL(url).searchParams.get('jobOffset')) === 0 ? page(0) : challengePage) });
    if (named(later)) pass('avature.fetch() throws when a later page is a 200 challenge page, instead of returning the earlier pages as a complete board');
    else fail(`challenge on page 1: ${JSON.stringify(later.jobs?.length ?? later.err?.message)}`);

    const third = await run({ sleep: async () => {}, fetchText: async (url) => { const n = Number(new URL(url).searchParams.get('jobOffset')) / 6; return n < 2 ? page(n) : challengePage; } });
    if (named(third)) pass('avature.fetch() throws on a challenge page after several good pages');
    else fail(`challenge on page 2: ${JSON.stringify(third.jobs?.length ?? third.err?.message)}`);

    // Self-heal retry: page 1 repeats page 0 under jobOffset, and the offset retry is the challenge.
    const heal = await run({ sleep: async () => {}, fetchText: async (url) => (new URL(url).searchParams.get('offset') !== null && Number(new URL(url).searchParams.get('offset')) > 0 ? challengePage : page(0)) });
    if (named(heal)) pass('avature.fetch() throws when the self-heal retry page is a challenge page');
    else fail(`challenge on the heal retry: ${JSON.stringify(heal.jobs?.length ?? heal.err?.message)}`);

    const probe = await run({ maxPages: 5, sleep: async () => {}, fetchText: async (url) => (Number(new URL(url).searchParams.get('jobOffset')) === 0 ? page(0) : challengePage) });
    if (named(probe) && !probe.err.truncated) pass('avature.fetch() propagates the challenge failure under a verify-portals probe');
    else fail(`challenge under probe: ${JSON.stringify(probe.jobs?.length ?? probe.err?.message)}`);

    // A real no-results page: [] on page 0, a clean end on a later page.
    const none0 = await run({ sleep: async () => {}, fetchText: async () => noJobsPage });
    if (none0.jobs && none0.jobs.length === 0) pass('avature.fetch() returns [] for a real no-results page ("No jobs found" card)');
    else fail(`no-results page 0: ${JSON.stringify(none0.err?.message ?? none0.jobs)}`);

    for (const end of [noJobsPage, emptyListing]) {
      const ended = await run({ sleep: async () => {}, fetchText: async (url) => (Number(new URL(url).searchParams.get('jobOffset')) === 0 ? page(0) : end) });
      if (ended.jobs && ended.jobs.length === 6 && !ended.jobs.truncated) pass('avature.fetch() ends the walk cleanly on a real no-results page after good pages');
      else fail(`no-results page 1: ${JSON.stringify(ended.err?.message ?? ended.jobs?.length)}`);
    }
  }

  // fetch(): redirect:'error' pinned on every request the provider issues —
  // list, pagination, self-heal, and facet-filtered alike.
  {
    /** @type {any[]} */
    const opts = [];
    const pinnedCtx = {
      sleep: async () => {},
      fetchText: async (url, o) => { opts.push(o); return mkHtml([1, 2, 3, 4, 5, 6]); },
    };
    await avature.fetch({ name: 'X', api: `${base}?42386=%5B812132%5D` }, pinnedCtx);
    const pinned = opts.length > 0 && opts.every((o) => o && o.redirect === 'error');
    if (pinned) pass('avature.fetch() sends redirect:error on every request (list, pagination, facet-filtered)');
    else fail(`avature.fetch() redirect pin drift: ${JSON.stringify(opts)}`);
  }

  // Regression (#1639 lineage) — a numeric entity above U+10FFFF must not throw
  // RangeError out of the whole parse. The local decodeEntities copy guarded
  // only with Number.isFinite (no `<= 0x10FFFF` / surrogate check), so ONE
  // adversarial/malformed entity (&#99999999;, &#xFFFFFFFF;) crashed the entire
  // provider parse and scan.mjs's per-company catch dropped EVERY posting for
  // that run. parseArticles now routes through the shared guarded decoder, which
  // degrades an out-of-range or lone-surrogate entity to literal text while
  // still decoding valid ones (&amp;).
  {
    const badFrag = `
    <article class="article article--result" id="article--bad">
      <h3 class="title"><a class="link" href="https://acme.avature.net/careers/JobDetail/Bad-Entity-Role/778899">Overflow &#99999999; &amp; Hex &#xFFFFFFFF; Surrogate &#xD800;</a></h3>
    </article>`;
    let badArts, badThrew = null;
    try { badArts = parseArticles(badFrag, origin); } catch (e) { badThrew = e; }
    if (badThrew) fail(`avature.parseArticles() threw ${badThrew.name} on an out-of-range numeric entity (unguarded String.fromCodePoint): ${badThrew.message}`);
    else if (badArts.length === 1 && badArts[0].title === 'Overflow &#99999999; & Hex &#xFFFFFFFF; Surrogate &#xD800;') pass('avature.parseArticles() tolerates out-of-range / surrogate entities, degrading them to literal text while still decoding &amp; (no RangeError crash)');
    else fail(`avature.parseArticles() out-of-range entity wrong: ${JSON.stringify(badArts)}`);
  }

  // A per-country opening page (the only listing some branded tenants have,
  // modelled on a real board whose /careers/SearchJobs is a 404): the user's
  // list path is honoured on every request, rows are <div class="article
  // article--result"> with no closing </article>, and the location comes from
  // the row's own subtitle (no per-posting detail fetch).
  const mkDivRow = (id, title) => `
    <div class="article article--result">
      <div class="article__header"><div class="article__header__text">
        <div class="article__header__text__ref">Job ID ${id}</div>
        <h3 class="article__header__text__title"><a href="https://jobs.acme.example.com/en_US/careers/JobDetail/${id}?team=Ops">${title}</a></h3>
        <div class="article__header__text__subtitle"><span class="article__header__text__subtitle--location">Spain</span>
          <span class="article__header__text__subtitle--separator">|</span>
          <span class="article__header__text__subtitle--team">Ops</span></div>
      </div></div>
      <a href="https://jobs.acme.example.com/en_US/careers/JobDetail/${id}?team=Ops">View more</a>
    </div>`;
  const divPage = (ids) => ids.map((i) => mkDivRow(i, `Role ${i}`)).join('') + '<div class="footer"><a href="https://jobs.acme.example.com/en_US/careers/JobDetail/999">Footer</a></div>';
  const divArts = parseArticles(divPage([11, 12]), 'https://jobs.acme.example.com');
  if (divArts.length === 2 && divArts[0].id === '11' && divArts[0].location === 'Spain' && divArts[1].title === 'Role 12') pass('avature.parseArticles() reads <div class="article article--result"> rows and their subtitle location');
  else fail(`avature.parseArticles() div rows wrong: ${JSON.stringify(divArts)}`);
  {
    // The last row has no link of its own: the footer's JobDetail link must not become its posting.
    const linkless = mkDivRow(21, 'Role 21') + '<div class="article article--result"><div class="article__header"><h3>No link</h3></div></div>'
      + '<div class="footer"><a href="https://jobs.acme.example.com/en_US/careers/JobDetail/999">Footer</a></div>';
    const arts = parseArticles(linkless, 'https://jobs.acme.example.com');
    if (arts.length === 1 && arts[0].id === '21' && !arts.some((a) => a.title === 'Footer') && countArticles(linkless) === 2) pass('avature div card ends at its own </div>: a linkless last card does not pick up the footer link, and the raw card count is unchanged');
    else fail(`avature linkless div card wrong: ${JSON.stringify(arts)} cards=${countArticles(linkless)}`);
    const open = '<div class="article article--result"><div class="article__header"><h3 class="article__header__text__title"><a href="https://jobs.acme.example.com/en_US/careers/JobDetail/31">Role 31</a></h3>';
    const unclosed = parseArticles(open, 'https://jobs.acme.example.com');
    if (unclosed.length === 1 && unclosed[0].id === '31') pass('avature div card with no matching close keeps the old boundary');
    else fail(`avature unclosed div card wrong: ${JSON.stringify(unclosed)}`);
  }
  const countryUrl = 'https://jobs.acme.example.com/en_US/careers/JobOpeningsSpain';
  const countryCtx = {
    calls: [],
    sleep: async () => {},
    fetchText: async function (url, opts) {
      this.calls.push({ url, redirect: opts && opts.redirect });
      const n = Number(new URL(url).searchParams.get('jobOffset')) / 6;
      return n === 0 ? divPage([1, 2, 3, 4, 5, 6]) : divPage([7, 8]);
    },
  };
  const countryJobs = await avature.fetch({ name: 'X', careers_url: countryUrl, provider: 'avature' }, countryCtx);
  if (countryJobs.length === 8 && countryJobs.every((j) => j.location === 'Spain')) pass('avature.fetch() walks a JobOpenings<Country> list page (8 jobs, row location kept)');
  else fail(`avature.fetch() JobOpenings page wrong: ${JSON.stringify(countryJobs.map((j) => j.title))}`);
  if (JSON.stringify(countryCtx.calls) === JSON.stringify([0, 6].map((n) => ({ url: `${countryUrl}?jobOffset=${n}`, redirect: 'error' })))) pass('avature.fetch() requests exactly the given JobOpenings path at offsets 0 and 6 with redirect:error (no rewrite to /careers/SearchJobs)');
  else fail(`avature.fetch() JobOpenings requests wrong: ${JSON.stringify(countryCtx.calls)}`);

  // Transient failures on a listing page (review follow-up). A 503 that clears
  // on retry loses nothing; one that outlasts the retries keeps the pages already
  // read, warns without the max_pages advice and tags the board partial.
  const flaky = (failOn) => {
    const ctx = {
      calls: [],
      sleep: async () => {},
      fetchText: async function (url) {
        this.calls.push(url);
        const n = Number(new URL(url).searchParams.get('jobOffset')) / 6;
        const err = failOn(n, this.calls.filter((u) => u === url).length);
        if (err) throw err;
        return n === 0 ? divPage([1, 2, 3, 4, 5, 6]) : divPage([7, 8]);
      },
    };
    return ctx;
  };
  const http = (status) => Object.assign(new Error(`HTTP ${status}`), { status });
  const countryEntry = { name: 'X', careers_url: countryUrl, provider: 'avature' };
  const recoverCtx = flaky((n, attempt) => (n === 1 && attempt === 1 ? http(503) : null));
  const recovered = await avature.fetch(countryEntry, recoverCtx);
  if (recovered.length === 8 && !recovered.truncated && recoverCtx.calls.length === 3) pass('avature.fetch() retries a transient 503 on a listing page and loses nothing');
  else fail(`avature.fetch() 503 retry: ${recovered.length} jobs, ${recoverCtx.calls.length} calls`);

  const origErr = console.error;
  const warnings = [];
  console.error = (m) => warnings.push(String(m));
  let kept;
  try {
    kept = await avature.fetch(countryEntry, flaky((n) => (n === 1 ? http(503) : null)));
  } finally {
    console.error = origErr;
  }
  if (kept.length === 6 && kept.truncated?.reason === 'fetch-error') pass('avature.fetch() keeps the pages read and tags the board partial when a later page keeps failing');
  else fail(`avature.fetch() exhausted retry: ${kept.length} jobs, ${JSON.stringify(kept.truncated)}`);
  if (warnings.length === 1 && /fetch error/.test(warnings[0]) && !/max_pages/.test(warnings[0])) pass('avature.fetch() warns about the fetch error without the raise-max_pages advice');
  else fail(`avature.fetch() exhausted retry warning: ${JSON.stringify(warnings)}`);

  const throwsOn = async (ctx, entry = countryEntry) => {
    try { await avature.fetch(entry, ctx); return null; } catch (e) { return e; }
  };
  const firstErr = await throwsOn(flaky((n) => (n === 0 ? http(503) : null)));
  if (firstErr && firstErr.status === 503) pass('avature.fetch() still throws when the first page fails (nothing to keep)');
  else fail('avature.fetch() swallowed a first-page failure');
  const blockedErr = await throwsOn(flaky((n) => (n === 1 ? http(403) : null)));
  if (blockedErr && blockedErr.status === 403) pass('avature.fetch() throws on a non-transient 403 instead of returning a partial board');
  else fail('avature.fetch() swallowed a 403 on a later page');
  const probeCtx = flaky((n) => (n === 1 ? http(503) : null));
  probeCtx.maxPages = 1;
  const probeErr = await throwsOn(probeCtx);
  if (probeErr && probeErr.status === 503) pass('avature.fetch() lets a failure propagate unwrapped while verify-portals probes (ctx.maxPages)');
  else fail('avature.fetch() swallowed a failure during a probe');

  // Posting ids come from the path and from ?jobId= only, never from another parameter.
  const idRows = parseArticles(
    mkDivRow(31, 'Path id').replace(/href="[^"]*"/, 'href="https://jobs.acme.example.com/en_US/careers/JobDetail/slug/31?team=Ops"') +
    mkDivRow(32, 'Query id').replace(/href="[^"]*"/, 'href="https://jobs.acme.example.com/en_US/careers/JobDetail?jobId=456&returnUrl=/JobDetail/31"'),
    'https://jobs.acme.example.com');
  if (idRows.map((r) => r.id).join() === '31,456') pass('parseArticles reads the posting id from the path or from jobId, not from another query parameter');
  else fail(`parseArticles ids = ${JSON.stringify(idRows.map((r) => r.id))}`);

  // list-item-location keeps its priority over subtitle--location, wherever they sit in the card.
  const locRows = parseArticles(
    '<article class="article article--result"><span class="subtitle--location">Spain</span><h3 class="title"><a class="link" href="/careers/JobDetail/Role/41">Role</a></h3><span class="list-item-location">Madrid, Spain</span></article>',
    'https://acme.avature.net');
  if (locRows[0]?.location === 'Madrid, Spain') pass('parseArticles prefers list-item-location over an earlier subtitle--location');
  else fail(`parseArticles location = ${JSON.stringify(locRows[0]?.location)}`);
} catch (e) {
  fail(`avature provider tests crashed: ${e.message}`);
}
