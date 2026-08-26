// tests/providers/careerviet.test.mjs — provider-contract tests for the
// CareerViet board-wide HTML listing (providers/careerviet.mjs).
//
// The fixtures reproduce shapes measured on the live board on 2026-08-26, and
// each one exists because it decides the parser's design:
//
//   - cards carry a per-card DOM id (`id="job-item-{ID}"`) that both delimits
//     the card and names the posting id — the anchor a redesign is least
//     likely to drop;
//   - the SAME `a.job_link` anchor appears TWICE per card — once in the <h2>
//     title, again wrapping the salary/location/time block — so the parser
//     must take the first occurrence, not the last;
//   - "Cập nhật" (updated) and "Hạn nộp" (deadline) dates share the same
//     `.time` block shape; only the preceding label text tells them apart;
//   - titles and company names carry HTML entities that must decode once.
//
// The last group is the important one: a listing page that parses to nothing
// must THROW. Returning [] would render a broken parser as a board with no
// openings — indistinguishable from a healthy quiet board.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — careerviet');

// One full card, trimmed from the live page: job-item id, doubled job_link
// anchor, company-name anchor, location list, salary block, and a .time block
// carrying BOTH the deadline ("Hạn nộp") and the updated date ("Cập nhật").
// Structure preserved, asset URLs shortened.
const CARD_FULL = `
<div class="job-item  " id="job-item-35C82AFA"><div class="figure"><div class="asset-wrapper"><div class="image"><a target="_blank" title="CÔNG TY CỔ PHẦN CC1 - HOLDINGS" href="/vi/nha-tuyen-dung/cong-ty-co-phan-cc1-holdings.35AA2C04.html"><img alt="logo"/></a></div></div><div class="figcaption"><div class="title "><h2><a class="job_link" data-id="35C82AFA" target="_blank" title="Backend Developer &amp; API" rel="noopener noreferrer" href="/vi/tim-viec-lam/backend-developer.35C82AFA.html">Backend Developer &amp; API</a></h2></div><div class="caption"><a class="company-name" target="_blank" title="CÔNG TY CỔ PHẦN CC1 - HOLDINGS" href="/vi/nha-tuyen-dung/cong-ty-co-phan-cc1-holdings.35AA2C04.html">CÔNG TY CỔ PHẦN CC1 - HOLDINGS</a><a class="job_link" data-id="35C82AFA" target="_blank" title="Backend Developer &amp; API" rel="noopener noreferrer" href="/vi/tim-viec-lam/backend-developer.35C82AFA.html"><div class="salary"><p><em class="fa fa-usd"></em>Lương<!-- -->: <!-- -->Cạnh tranh</p></div><div class="location"><em class="mdi mdi-map-marker"></em><ul><li>Hồ Chí Minh</li></ul></div><div class="time"><ul><li><em class="fa fa-clock-o"></em> <span>Hạn nộp<!-- -->: </span><time>10-09-2026</time></li><li><em class="mdi mdi-calendar"></em> <span>Cập nhật<!-- -->:</span> <time>16-08-2026</time></li></ul></div></a></div></div></div>`;

// A minimal card: no company link, no location block, no time block. Every
// optional field must come out empty rather than leak in from a NEIGHBOURING
// card — the reason the parser slices per-card windows instead of scanning
// the whole page once.
const CARD_MINIMAL = `
<div class="job-item  " id="job-item-35C90001"><div class="figcaption"><div class="title "><h2><a class="job_link" data-id="35C90001" title="Middle Java Developer" href="/vi/tim-viec-lam/middle-java-developer.35C90001.html">Middle Java Developer</a></h2></div></div></div>`;

const PAGE = `<html><body><div class="jobs-side-list">${CARD_FULL}${CARD_MINIMAL}</div></body></html>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/careerviet.mjs')).href);
  const careerviet = mod.default;
  const { parseListingPage, buildListUrl, citySegment, visibleText, parsePostedAt, assertParsedSomething } = mod;

  if (careerviet.id === 'careerviet') pass('careerviet.id is "careerviet"');
  else fail(`careerviet.id is ${JSON.stringify(careerviet.id)}`);

  // ── detect(): explicit selection only, like every board-wide provider ──
  const hit = careerviet.detect({ name: 'CareerViet', provider: 'careerviet' });
  if (hit && hit.url === 'https://careerviet.vn/viec-lam/tat-ca-viec-lam-vi.html') {
    pass('detect() resolves provider:careerviet → the bare listing URL');
  } else {
    fail(`detect() returned ${JSON.stringify(hit)}`);
  }
  if (careerviet.detect({ name: 'CareerViet' }) === null) pass('detect() returns null without provider:careerviet');
  else fail('detect() must require provider:careerviet');

  // ── buildListUrl(): the URL shapes the board's own search form generates ──
  if (buildListUrl({}, 1) === 'https://careerviet.vn/viec-lam/tat-ca-viec-lam-vi.html'
      && buildListUrl({}, 2) === 'https://careerviet.vn/viec-lam/tat-ca-viec-lam-trang-2-vi.html') {
    pass('buildListUrl(): bare board, later pages carry -trang-N-');
  } else {
    fail(`buildListUrl drift: ${buildListUrl({}, 1)} / ${buildListUrl({}, 2)}`);
  }
  // A keyword narrows to "{keyword}-k"; spaces become hyphens, like the site.
  if (buildListUrl({ searchKeywords: 'back end' }, 1) === 'https://careerviet.vn/viec-lam/back-end-k-vi.html') {
    pass('buildListUrl(): searchKeywords become a hyphenated "-k" slug');
  } else {
    fail(`keyword drift: ${buildListUrl({ searchKeywords: 'back end' }, 1)}`);
  }
  // A recognized city narrows a keyword search further; an unknown city is
  // IGNORED (falls back to the "-k" keyword-only slug) rather than guessed.
  if (buildListUrl({ searchKeywords: 'backend', searchLocation: 'Ho Chi Minh' }, 1)
      === 'https://careerviet.vn/viec-lam/backend-tai-ho-chi-minh-kl8-vi.html') {
    pass('buildListUrl(): a recognized city narrows a keyword search');
  } else {
    fail(`city drift: ${buildListUrl({ searchKeywords: 'backend', searchLocation: 'Ho Chi Minh' }, 1)}`);
  }
  if (buildListUrl({ searchKeywords: 'backend', searchLocation: 'Berlin' }, 1)
      === 'https://careerviet.vn/viec-lam/backend-k-vi.html') {
    pass('buildListUrl(): an unrecognized location is dropped, not encoded into the path');
  } else {
    fail(`unknown-city drift: ${buildListUrl({ searchKeywords: 'backend', searchLocation: 'Berlin' }, 1)}`);
  }
  // A city with no keyword has no working URL on this board — dropped, same
  // as an unrecognized city, rather than guessed into a slug that redirects.
  if (buildListUrl({ searchLocation: 'Ho Chi Minh' }, 1) === 'https://careerviet.vn/viec-lam/tat-ca-viec-lam-vi.html') {
    pass('buildListUrl(): a city with no keyword falls back to the bare board');
  } else {
    fail(`city-only drift: ${buildListUrl({ searchLocation: 'Ho Chi Minh' }, 1)}`);
  }
  // Prototype-member names must resolve to null, not to an inherited
  // Object.prototype member interpolated into the URL (same guard as itviec.mjs, #3229).
  if (citySegment('constructor') === null && citySegment('toString') === null && citySegment('valueOf') === null) {
    pass('citySegment(): Object.prototype member names are treated as unknown locations');
  } else {
    fail(`prototype drift: ${JSON.stringify(['constructor', 'toString', 'valueOf'].map(citySegment))}`);
  }
  // A slash inside the keyword must never create a second path segment.
  if (buildListUrl({ searchKeywords: 'node/js' }, 1) === 'https://careerviet.vn/viec-lam/nodejs-k-vi.html') {
    pass('buildListUrl(): a slash in the keyword cannot forge extra path segments');
  } else {
    fail(`slash drift: ${buildListUrl({ searchKeywords: 'node/js' }, 1)}`);
  }

  // ── visibleText(): comments stripped BEFORE tags ──
  if (visibleText('Senior Dev <!-- ad --> <img src="x.gif">') === 'Senior Dev') {
    pass('visibleText() drops HTML comments, not just tags');
  } else {
    fail(`visibleText() => ${JSON.stringify(visibleText('Senior Dev <!-- ad --> <img src="x.gif">'))}`);
  }

  // ── parseListingPage(): the shapes the board actually serves ──
  const jobs = parseListingPage(PAGE);
  if (jobs.length === 2) pass('parseListingPage() returns one job per card id');
  else fail(`parseListingPage() returned ${jobs.length} jobs: ${JSON.stringify(jobs)}`);

  const full = jobs.find((j) => j.url.includes('35C82AFA'));
  if (full && full.title === 'Backend Developer & API') {
    pass('title comes from the FIRST job_link anchor, entities decoded once');
  } else {
    fail(`title drift: ${JSON.stringify(full && full.title)}`);
  }
  if (full && full.url === 'https://careerviet.vn/vi/tim-viec-lam/backend-developer.35C82AFA.html') {
    pass('url resolves the relative href against careerviet.vn');
  } else {
    fail(`url drift: ${JSON.stringify(full && full.url)}`);
  }

  // A malformed href must drop just that ONE card, never throw out of
  // parseListingPage and fail the whole page (CodeRabbit, #3378).
  {
    const CARD_BAD_HREF = `<div id="job-item-35C90003"><a class="job_link" title="Bad Href Job" href="http://[invalid">Bad Href Job</a></div>`;
    let threwOnBadHref = false;
    let parsedBadHref;
    try {
      parsedBadHref = parseListingPage(CARD_BAD_HREF);
    } catch {
      threwOnBadHref = true;
    }
    if (!threwOnBadHref && Array.isArray(parsedBadHref) && parsedBadHref.length === 0) {
      pass('an unparseable href drops its card instead of throwing out of parseListingPage');
    } else {
      fail(`bad href handling drift: threw=${threwOnBadHref}, parsed=${JSON.stringify(parsedBadHref)}`);
    }
  }

  // An absolute href to another host must never be emitted as a posting URL —
  // it isn't a careerviet.vn job no matter what class the anchor carries.
  {
    const CARD_OFF_HOST = `<div id="job-item-35C90004"><a class="job_link" title="Off Host Job" href="https://evil.example.com/phish">Off Host Job</a></div>`;
    const [offHostJob] = parseListingPage(CARD_OFF_HOST);
    if (!offHostJob) {
      pass('an off-host href is dropped, never emitted as a posting URL');
    } else {
      fail(`off-host href leaked through: ${JSON.stringify(offHostJob)}`);
    }
  }
  if (full && full.company === 'CÔNG TY CỔ PHẦN CC1 - HOLDINGS') {
    pass('company comes from the company-name anchor’s title attribute');
  } else {
    fail(`company drift: ${JSON.stringify(full && full.company)}`);
  }
  if (full && full.location === 'Hồ Chí Minh') {
    pass('location is read from the .location block’s first <li>');
  } else {
    fail(`location drift: ${JSON.stringify(full && full.location)}`);
  }
  // The card carries BOTH a deadline and an updated date in the same .time
  // block — postedAt must come from "Cập nhật", never "Hạn nộp".
  if (full && typeof full.postedAt === 'number') {
    const want = Date.parse('2026-08-16T00:00:00+07:00');
    if (Math.abs(full.postedAt - want) < 1000) pass('postedAt comes from "Cập nhật", not "Hạn nộp"');
    else fail(`postedAt picked the wrong date: ${new Date(full.postedAt).toISOString()} vs want ${new Date(want).toISOString()}`);
  } else {
    fail(`postedAt missing: ${JSON.stringify(full)}`);
  }

  const minimal = jobs.find((j) => j.url.includes('35C90001'));
  if (minimal && minimal.title === 'Middle Java Developer') {
    pass('a minimal card parses too');
  } else {
    fail(`minimal card drift: ${JSON.stringify(minimal)}`);
  }
  if (minimal && minimal.company === '' && minimal.location === '' && minimal.postedAt === undefined) {
    pass('missing company/location/postedAt stay empty instead of leaking across cards');
  } else {
    fail(`cross-card leak: ${JSON.stringify(minimal)}`);
  }

  // An EMPTY .location block must not let the lazy gap read past its own
  // </div> into a sibling .time block's deadline <li> (CodeRabbit, #3378).
  {
    const CARD_EMPTY_LOCATION = `
<div class="job-item  " id="job-item-35C90002"><div class="figcaption"><div class="title "><h2><a class="job_link" data-id="35C90002" title="Empty Location Job" href="/vi/tim-viec-lam/empty-location-job.35C90002.html">Empty Location Job</a></h2></div><div class="caption"><div class="location"><em class="mdi mdi-map-marker"></em></div><div class="time"><ul><li><em class="fa fa-clock-o"></em> <span>Hạn nộp<!-- -->: </span><time>10-09-2026</time></li></ul></div></div></div></div>`;
    const [job] = parseListingPage(CARD_EMPTY_LOCATION);
    if (job && job.location === '') {
      pass('an empty .location block yields an empty location, never a deadline date');
    } else {
      fail(`location leaked past its own block: ${JSON.stringify(job)}`);
    }
  }

  // ── parsePostedAt(): the board's own DD-MM-YYYY format ──
  const jan1 = parsePostedAt('01-02-2026');
  if (jan1 === Date.parse('2026-02-01T00:00:00+07:00')) {
    pass('parsePostedAt() reads DD-MM-YYYY at Vietnam’s UTC+7 offset');
  } else {
    fail(`parsePostedAt drift: ${jan1}`);
  }
  if (parsePostedAt('not a date') === undefined) {
    pass('an unparseable date yields undefined — no invented dates');
  } else {
    fail('unparseable date must omit postedAt, not fabricate one');
  }

  // ── The silent-zero guard ──
  let threw = false;
  try {
    assertParsedSomething(PAGE.replace(/job_link/g, 'renamed'), 'https://careerviet.vn/viec-lam/tat-ca-viec-lam-vi.html');
  } catch {
    threw = true;
  }
  if (threw) {
    pass('assertParsedSomething() throws when job cards are present but unparsed');
  } else {
    fail('a page still full of job cards must not be reported as empty');
  }

  let threwOnEmpty = false;
  try {
    assertParsedSomething('<html><body>Không tìm thấy việc làm phù hợp.</body></html>', 'https://careerviet.vn/viec-lam/tat-ca-viec-lam-vi.html');
  } catch {
    threwOnEmpty = true;
  }
  if (!threwOnEmpty) {
    pass('a genuinely empty page does not throw — only an unparsed one does');
  } else {
    fail('an empty listing page must be allowed, or a quiet board reads as broken');
  }

  // ── fetch(): pagination, dedup, and the stop condition ──
  const pages = new Map([
    ['https://careerviet.vn/viec-lam/tat-ca-viec-lam-vi.html', PAGE],
    ['https://careerviet.vn/viec-lam/tat-ca-viec-lam-trang-2-vi.html', CARD_MINIMAL], // only a repeat
  ]);
  /** @type {string[]} */
  const requested = [];
  let slept = 0;
  const ctx = {
    maxPages: 5,
    sleep: async (ms) => { slept += ms; },
    fetchText: async (url) => {
      requested.push(url);
      return pages.get(url) ?? '<html><body>Không tìm thấy việc làm phù hợp.</body></html>';
    },
  };

  const fetched = await careerviet.fetch({}, ctx);
  if (fetched.length === 2) {
    pass('fetch() dedups a posting repeated on the next page');
  } else {
    fail(`fetch() returned ${fetched.length}: ${JSON.stringify(fetched.map((j) => j.url))}`);
  }
  if (requested.length === 2) {
    pass('fetch() stops once a page contributes no new posting');
  } else {
    fail(`fetch() requested ${requested.length} pages: ${JSON.stringify(requested)}`);
  }
  if (slept >= 750) pass('fetch() paces between pages of the same board');
  else fail(`fetch() slept ${slept}ms between pages`);

  // ── fetch(): entry.max_pages configures the run, ctx.maxPages only caps it ──
  {
    /** @type {string[]} */
    const asked = [];
    const mkCard = (id) => CARD_MINIMAL.replace(/35C90001/g, id);
    const wide = new Map([
      ['https://careerviet.vn/viec-lam/tat-ca-viec-lam-vi.html', PAGE],
      ['https://careerviet.vn/viec-lam/tat-ca-viec-lam-trang-2-vi.html', mkCard('35C90002')],
      ['https://careerviet.vn/viec-lam/tat-ca-viec-lam-trang-3-vi.html', mkCard('35C90003')],
    ]);
    const cappedCtx = {
      sleep: async () => {},
      fetchText: async (url) => { asked.push(url); return wide.get(url) ?? '<html>Không tìm thấy việc làm phù hợp.</html>'; },
    };
    await careerviet.fetch({ max_pages: 2 }, cappedCtx);
    if (asked.length === 2) {
      pass('fetch() honours entry.max_pages when ctx carries no hint');
    } else {
      fail(`entry.max_pages ignored: requested ${JSON.stringify(asked)}`);
    }

    asked.length = 0;
    await careerviet.fetch({ max_pages: 3 }, { ...cappedCtx, maxPages: 1 });
    if (asked.length === 1) {
      pass('ctx.maxPages caps entry.max_pages — a health probe still reads one page');
    } else {
      fail(`probe not capped: requested ${JSON.stringify(asked)}`);
    }
  }

  // The MAX_PAGES_CAP boundary: a configured max_pages above the ceiling is
  // clamped, so one misconfigured entry cannot sweep the board forever. Every
  // page below yields a NEW posting, so nothing but the cap can stop the run.
  {
    /** @type {string[]} */
    const asked = [];
    const endlessCtx = {
      sleep: async () => {},
      fetchText: async (url) => {
        asked.push(url);
        const m = /trang-(\d+)/.exec(url);
        const page = m ? Number(m[1]) : 1;
        return CARD_MINIMAL.replace(/35C90001/g, String(40000000 + page));
      },
    };
    await careerviet.fetch({ max_pages: 999 }, endlessCtx);
    if (asked.length === 50) {
      pass('fetch() clamps an over-large max_pages to the 50-page cap');
    } else {
      fail(`MAX_PAGES_CAP not enforced: requested ${asked.length} pages`);
    }
  }

  // ── fetch(): searchKeywords/searchLocation shape the request ──
  {
    /** @type {string[]} */
    const asked = [];
    const searchCtx = {
      sleep: async () => {},
      fetchText: async (url) => { asked.push(url); return url.includes('backend-tai-ho-chi-minh-kl8') ? PAGE : '<html>Không tìm thấy.</html>'; },
    };
    await careerviet.fetch({ searchKeywords: 'Backend', searchLocation: 'Ho Chi Minh' }, searchCtx);
    if (asked[0] === 'https://careerviet.vn/viec-lam/backend-tai-ho-chi-minh-kl8-vi.html') {
      pass('fetch() narrows by entry.searchKeywords/searchLocation');
    } else {
      fail(`search drift: ${JSON.stringify(asked)}`);
    }
  }

  // ── fetch(): the request is pinned against SSRF ──
  // redirect:'error' plus the host check is what keeps the sweep on
  // careerviet.vn; a refactor dropping either would leave the pin looking
  // present but inert.
  {
    /** @type {any[]} */
    const opts = [];
    const optCtx = {
      sleep: async () => {},
      fetchText: async (url, o) => { opts.push(o); return url.includes('trang-') ? '<html>Không tìm thấy.</html>' : PAGE; },
    };
    await careerviet.fetch({}, optCtx);
    const pinned = opts.length > 0 && opts.every((o) => o
      && o.redirect === 'error'
      && typeof o.headers?.['User-Agent'] === 'string'
      && o.headers['User-Agent'].length > 0);
    if (pinned) {
      pass('fetch() sends redirect:error and a browser-like User-Agent on every request');
    } else {
      fail(`request options drift: ${JSON.stringify(opts)}`);
    }
  }

  // ── fetch(): a broken page 1 is an error, never an empty board ──
  const brokenCtx = {
    sleep: async () => {},
    // The realistic markup change: postings still on the page (the job-item id
    // shape is intact) but the anchor class the parser keys on was renamed.
    fetchText: async () => '<div id="job-item-35C99999"><a class="renamed" title="Senior Dev" href="/vi/tim-viec-lam/senior-dev.35C99999.html">Senior Dev</a></div>',
  };
  let fetchThrew = false;
  try {
    await careerviet.fetch({}, brokenCtx);
  } catch (err) {
    fetchThrew = /markup changed/.test(String(err && err.message));
  }
  if (fetchThrew) {
    pass('fetch() throws when page 1 has job cards it cannot parse');
  } else {
    fail('a markup change must surface as an error, not as a board with no jobs');
  }
} catch (error) {
  fail(`careerviet provider tests could not run: ${error.message}`);
}
