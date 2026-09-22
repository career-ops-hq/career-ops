// tests/providers/itviec.test.mjs — provider-contract tests for the ITviec
// board-wide HTML listing (providers/itviec.mjs).
//
// The fixtures reproduce shapes measured on the live board on 2026-08-23, and
// each one exists because it decides the parser's design:
//
//   - cards carry a per-card Stimulus attribute
//     (`data-search--job-selection-job-slug-value`) that both delimits the card
//     and names the posting slug — the anchor a redesign is least likely to drop;
//   - the title lives inside an h3 tagged `jobTitle`; company, location and the
//     relative "Posted … ago" label sit in SIBLING fragments, so a parser that
//     windows tightly around the title loses them;
//   - the location is only machine-readable as a title ATTRIBUTE next to the
//     map-pin icon, not as link text;
//   - titles carry HTML entities (`&amp;`) that must decode once.
//
// The last group is the important one: a listing page that parses to nothing
// must THROW. Returning [] would render a broken parser as a board with no
// openings — indistinguishable from a healthy quiet board.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — itviec');

// One full card, trimmed from the live page: slug attribute, title h3, company
// link, map-pin location div, relative posted label. Structure preserved,
// asset URLs shortened.
const CARD_FULL = `
<div class='job-card ipt-2 d-flex flex-column bg-white'
     data-action='click-&gt;search--job-selection#select'
     data-search--job-selection-job-slug-value='senior-backend-engineer-java-sring-fundiin-5621'
     data-search--job-selection-job-index-value='0'>
  <div class='ipx-4 ipx-xl-3'>
    <div class='ipy-2'>
      <div class='d-flex align-items-center justify-content-between position-relative'>
        <span class='small-text text-dark-grey'>
        Posted
        1 day ago
        </span>
      </div>
      <h3 class='imt-3 text-break' data-controller='utm-tracking' data-search--job-selection-target='jobTitle'>
        <a target="_blank" class="text-it-black text-hover-red"
           href="https://itviec.com/it-jobs/senior-backend-engineer-java-sring-fundiin-5621?lab_feature=preview_jd_page">Back &amp; Middle End Engineer (Java/Sring)</a>
      </h3>
      <div class='imy-3 d-flex align-items-center'>
        <a target="_blank" title="FUNDIIN - Financial Services Platform" class="bg-white logo-employer-card"
           href="/companies/fundiin?lab_feature=preview_jd_page"><picture></picture></a>
        <span class='ims-2 small-text text-hover-underline'>
          <a target="_blank" data-controller="utm-tracking" class="text-rich-grey"
             href="/companies/fundiin?lab_feature=preview_jd_page">Fundiin</a>
        </span>
      </div>
    </div>
    <div class='imt-1 d-flex align-items-center text-dark-grey igap-2 small-text'>
      <div class='text-rich-grey flex-shrink-0'>
      At office
      </div>
      <div class='dot-icon flex-shrink-0'></div>
      <svg class="feather-icon icon-sm"><use href="https://itviec.com/assets/feather-icons-sprite.svg#map-pin"></use></svg>
      <div class='text-rich-grey text-truncate text-nowrap stretched-link position-relative' title='Ho Chi Minh'>
      Ho Chi Minh
      </div>
    </div>
  </div>
</div>`;

// A minimal card: no company block, no map-pin row, no parseable date. Every
// optional field must come out empty rather than leak in from a NEIGHBOURING
// card — the reason the parser slices per-card windows instead of scanning the
// whole page once.
const CARD_MINIMAL = `
<div class='job-card ipt-2 d-flex flex-column bg-white'
     data-search--job-selection-job-slug-value='middle-java-developer-mb-bank-0508'>
  <div class='ipy-2'>
    <span class='small-text text-dark-grey'>
    Posted
    3 weeks ago
    </span>
    <h3 data-search--job-selection-target='jobTitle'>
      <a href="https://itviec.com/it-jobs/middle-java-developer-mb-bank-0508">Middle Java Developer</a>
    </h3>
  </div>
</div>`;

const PAGE = `<html><body><div class='card-jobs-list'>${CARD_FULL}${CARD_MINIMAL}</div></body></html>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/itviec.mjs')).href);
  const itviec = mod.default;
  const { parseListingPage, buildListUrl, visibleText, parsePostedAt, assertParsedSomething } = mod;

  if (itviec.id === 'itviec') pass('itviec.id is "itviec"');
  else fail(`itviec.id is ${JSON.stringify(itviec.id)}`);

  // ── detect(): explicit selection only, like every board-wide provider ──
  const hit = itviec.detect({ name: 'ITviec', provider: 'itviec' });
  if (hit && hit.url === 'https://itviec.com/it-jobs') {
    pass('detect() resolves provider:itviec → the listing URL');
  } else {
    fail(`detect() returned ${JSON.stringify(hit)}`);
  }
  if (itviec.detect({ name: 'ITviec' }) === null) pass('detect() returns null without provider:itviec');
  else fail('detect() must require provider:itviec');

  // ── buildListUrl(): the URL shapes the board's own search form generates ──
  // Page 1 of the bare board is the plain path; later pages carry ?page=N.
  if (buildListUrl({}, 1) === 'https://itviec.com/it-jobs'
      && buildListUrl({}, 2) === 'https://itviec.com/it-jobs?page=2') {
    pass('buildListUrl(): bare board, later pages carry ?page=N');
  } else {
    fail(`buildListUrl drift: ${buildListUrl({}, 1)} / ${buildListUrl({}, 2)}`);
  }
  // A keyword narrows by path segment; spaces become hyphens, like the site.
  if (buildListUrl({ searchKeywords: 'back end' }, 1) === 'https://itviec.com/it-jobs/back-end') {
    pass('buildListUrl(): searchKeywords become a hyphenated path segment');
  } else {
    fail(`keyword drift: ${buildListUrl({ searchKeywords: 'back end' }, 1)}`);
  }
  // A recognized city appends its own segment; an unknown one is IGNORED rather
  // than guessed into the URL.
  if (buildListUrl({ searchKeywords: 'java', searchLocation: 'Hà Nội' }, 1) === 'https://itviec.com/it-jobs/java/ha-noi') {
    pass('buildListUrl(): diacritic city names resolve to the board\u2019s slugs');
  } else {
    fail(`city drift: ${buildListUrl({ searchKeywords: 'java', searchLocation: 'Hà Nội' }, 1)}`);
  }
  if (buildListUrl({ searchLocation: 'Berlin' }, 1) === 'https://itviec.com/it-jobs') {
    pass('buildListUrl(): an unrecognized location is dropped, not encoded into the path');
  } else {
    fail(`unknown-city drift: ${buildListUrl({ searchLocation: 'Berlin' }, 1)}`);
  }
  // Prototype-member names must resolve to null, not to an inherited
  // Object.prototype member interpolated into the URL (CodeRabbit, #3229).
  if (buildListUrl({ searchLocation: 'constructor' }, 1) === 'https://itviec.com/it-jobs'
      && buildListUrl({ searchLocation: 'toString' }, 1) === 'https://itviec.com/it-jobs'
      && buildListUrl({ searchLocation: 'valueOf' }, 1) === 'https://itviec.com/it-jobs') {
    pass('buildListUrl(): Object.prototype member names are treated as unknown locations');
  } else {
    fail(`prototype drift: ${JSON.stringify(['constructor', 'toString', 'valueOf'].map((k) => buildListUrl({ searchLocation: k }, 1)))}`);
  }
  // A slash inside the keyword must never create a second path segment — the
  // provider strips it, so "node/js" stays one segment.
  if (buildListUrl({ searchKeywords: 'node/js' }, 1) === 'https://itviec.com/it-jobs/nodejs') {
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
  if (jobs.length === 2) pass('parseListingPage() returns one job per card slug');
  else fail(`parseListingPage() returned ${jobs.length} jobs: ${JSON.stringify(jobs)}`);

  const senior = jobs.find((j) => j.url.endsWith('-5621'));
  if (senior && senior.title === 'Back & Middle End Engineer (Java/Sring)') {
    pass('title comes from the jobTitle anchor, entities decoded once');
  } else {
    fail(`title drift: ${JSON.stringify(senior && senior.title)}`);
  }
  if (senior && senior.company === 'Fundiin') {
    pass('company comes from the /companies/ link inside the card');
  } else {
    fail(`company drift: ${JSON.stringify(senior && senior.company)}`);
  }
  if (senior && senior.location === 'Ho Chi Minh') {
    pass('location is read from the map-pin div\u2019s title attribute');
  } else {
    fail(`location drift: ${JSON.stringify(senior && senior.location)}`);
  }

  const middle = jobs.find((j) => j.url.endsWith('-0508'));
  if (middle && middle.title === 'Middle Java Developer') {
    pass('a minimal card parses too');
  } else {
    fail(`minimal card drift: ${JSON.stringify(middle)}`);
  }
  // The fields the minimal card lacks must be EMPTY — never inherited from the
  // richer neighbour above it.
  if (middle && middle.company === '' && middle.location === '') {
    pass('missing company/location stay empty instead of leaking across cards');
  } else {
    fail(`cross-card leak: ${JSON.stringify(middle)}`);
  }

  // ── parsePostedAt(): the relative labels the board emits ──
  const now = Date.now();
  const cases = [
    ['today', 0],
    ['1 hour ago', 3_600_000],
    ['1 day ago', 86_400_000],
    ['3 weeks ago', 21 * 86_400_000],
    ['2 months ago', 60 * 86_400_000],
  ];
  let datedOk = true;
  for (const [label, delta] of cases) {
    const got = parsePostedAt(`Posted ${label}`, now);
    const want = now - delta;
    if (typeof got !== 'number' || Math.abs(got - want) > 1000) { datedOk = false; fail(`postedAt "${label}" => ${got}, want ~${want}`); }
  }
  if (datedOk) pass('parsePostedAt() maps every relative label the board emits');

  if (parsePostedAt('Posted sometime', now) === undefined) {
    pass('an unparseable label yields undefined — no invented dates');
  } else {
    fail('unparseable label must omit postedAt, not fabricate one');
  }

  // The Vietnamese-locale variant: "Đăng … trước" instead of "Posted … ago"
  // (Copilot review, #3229). parsePostedAt already knows the units; the label
  // regex must surface them.
  const vi = parsePostedAt('Đăng 3 ngày trước', now);
  if (typeof vi === 'number' && Math.abs(vi - (now - 3 * 86_400_000)) < 1000) {
    pass('parsePostedAt() reads Vietnamese relative labels (ngày/tuần/tháng/giờ … trước)');
  } else {
    fail(`Vietnamese label drift: ${String(vi)}`);
  }
  {
    const VI_CARD = CARD_MINIMAL
      .replace(/Posted\s*3 weeks ago/, 'Đăng 2 tuần trước')
      .replace(/mb-bank-0508/g, 'vi-card-0001');
    const [viJob] = parseListingPage(VI_CARD);
    if (viJob && typeof viJob.postedAt === 'number' && Math.abs(viJob.postedAt - (now - 14 * 86_400_000)) < 5000) {
      pass('a Vietnamese-locale card yields postedAt too');
    } else {
      fail(`Vietnamese card drift: ${JSON.stringify(viJob && viJob.postedAt)}`);
    }
  }

  // The full card carries a real epoch ms from its "1 day ago" label.
  if (senior && typeof senior.postedAt === 'number' && Math.abs(senior.postedAt - (now - 86_400_000)) < 5000) {
    pass('postedAt is derived from the card\u2019s own relative label');
  } else {
    fail(`card postedAt drift: ${String(senior && senior.postedAt)}`);
  }
  // The minimal card's "3 weeks ago" resolves too — sibling fragments fill in.
  if (middle && typeof middle.postedAt === 'number' && Math.abs(middle.postedAt - (now - 21 * 86_400_000)) < 5000) {
    pass('the posted label is picked up even when it precedes the title h3');
  } else {
    fail(`minimal postedAt drift: ${String(middle && middle.postedAt)}`);
  }

  // ── The silent-zero guard ──
  let threw = false;
  try {
    assertParsedSomething(PAGE.replace(/jobTitle/g, 'renamed'), 'https://itviec.com/it-jobs');
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
    assertParsedSomething('<html><body>No jobs match your search.</body></html>', 'https://itviec.com/it-jobs');
  } catch {
    threwOnEmpty = true;
  }
  if (!threwOnEmpty) {
    pass('a genuinely empty page does not throw — only an unparsed one does');
  } else {
    fail('an empty listing page must be allowed, or a quiet board reads as broken');
  }

  // The guard's posting-link shape must not depend on an exact digit count in
  // the slug suffix (Copilot review, #3229): a page whose slugs end in a
  // different-width code is still a listing page.
  let threwOtherWidth = false;
  try {
    assertParsedSomething('<a href="/it-jobs/junior-dev-123456">Junior Dev</a>', 'https://itviec.com/it-jobs');
  } catch {
    threwOtherWidth = true;
  }
  if (threwOtherWidth) {
    pass('assertParsedSomething() throws for posting slugs with non-4-digit suffixes too');
  } else {
    fail('the guard must not hinge on the suffix being exactly four digits');
  }
  // Category links carry no numeric suffix and are not evidence of postings —
  // a search page full of them is genuinely empty.
  let categoryOnly = false;
  try {
    assertParsedSomething('<a href="/it-jobs/java">Java</a> <a href="/it-jobs/php">PHP</a>', 'https://itviec.com/it-jobs');
  } catch {
    categoryOnly = true;
  }
  if (!categoryOnly) {
    pass('category links without a numeric suffix do not read as postings');
  } else {
    fail('skill-tag/category links were mistaken for job cards');
  }

  // ── fetch(): pagination, dedup, and the stop condition ──
  const pages = new Map([
    ['https://itviec.com/it-jobs', PAGE],
    ['https://itviec.com/it-jobs?page=2', CARD_MINIMAL], // only a repeat
  ]);
  /** @type {string[]} */
  const requested = [];
  let slept = 0;
  const ctx = {
    maxPages: 5,
    sleep: async (ms) => { slept += ms; },
    fetchText: async (url) => {
      requested.push(url);
      return pages.get(url) ?? '<html><body>No jobs match your search.</body></html>';
    },
  };

  const fetched = await itviec.fetch({}, ctx);
  if (fetched.length === 2) {
    pass('fetch() stops once a page contributes no new posting');
  } else {
    fail(`fetch() returned ${fetched.length}: ${JSON.stringify(fetched.map((j) => j.url))}`);
  }
  if (requested.length === 2) {
    pass('fetch() dedups a posting repeated on the next page');
  } else {
    fail(`fetch() requested ${requested.length} pages: ${JSON.stringify(requested)}`);
  }
  if (slept >= 750) pass('fetch() paces between pages of the same board (429-measured 750ms)');
  else fail(`fetch() slept ${slept}ms between pages`);

  // ── fetch(): entry.max_pages configures the run, ctx.maxPages only caps it ──
  {
    /** @type {string[]} */
    const asked = [];
    const mkCard = (slug) => CARD_MINIMAL.replace(/middle-java-developer-mb-bank-0508/g, slug);
    const wide = new Map([
      ['https://itviec.com/it-jobs', PAGE],
      ['https://itviec.com/it-jobs?page=2', mkCard('page-two-job-a-0001')],
      ['https://itviec.com/it-jobs?page=3', mkCard('page-three-job-b-0002')],
    ]);
    const cappedCtx = {
      sleep: async () => {},
      fetchText: async (url) => { asked.push(url); return wide.get(url) ?? '<html>No jobs.</html>'; },
    };
    await itviec.fetch({ max_pages: 2 }, cappedCtx);
    if (asked.length === 2) {
      pass('fetch() honours entry.max_pages when ctx carries no hint');
    } else {
      fail(`entry.max_pages ignored: requested ${JSON.stringify(asked)}`);
    }

    asked.length = 0;
    await itviec.fetch({ max_pages: 3 }, { ...cappedCtx, maxPages: 1 });
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
        const page = Number(new URL(url).searchParams.get('page') || '1');
        return CARD_MINIMAL.replace(/mb-bank-0508/g, String(700000 + page));
      },
    };
    await itviec.fetch({ max_pages: 999 }, endlessCtx);
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
      fetchText: async (url) => { asked.push(url); return url.includes('backend/ha-noi') ? PAGE : '<html>No jobs.</html>'; },
    };
    await itviec.fetch({ searchKeywords: 'Backend', searchLocation: 'Ha Noi' }, searchCtx);
    if (asked[0] === 'https://itviec.com/it-jobs/backend/ha-noi') {
      pass('fetch() narrows by entry.searchKeywords/searchLocation path segments');
    } else {
      fail(`search drift: ${JSON.stringify(asked)}`);
    }
  }

  // ── fetch(): the request is pinned against SSRF ──
  // redirect:'error' plus the host check is what keeps the sweep on itviec.com;
  // a refactor dropping either would leave the pin looking present but inert.
  {
    /** @type {any[]} */
    const opts = [];
    const optCtx = {
      sleep: async () => {},
      fetchText: async (url, o) => { opts.push(o); return url.includes('page=') ? '<html>No jobs.</html>' : PAGE; },
    };
    await itviec.fetch({}, optCtx);
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
    // The realistic markup change: postings still on the page (the URL shape is
    // intact) but the slug attribute the parser keys on was renamed. The parser
    // finds nothing; the page is clearly still a listing.
    fetchText: async () => '<a href="/it-jobs/senior-dev-1234">Senior Dev</a>',
  };
  let fetchThrew = false;
  try {
    await itviec.fetch({}, brokenCtx);
  } catch (err) {
    fetchThrew = /markup changed/.test(String(err && err.message));
  }
  if (fetchThrew) {
    pass('fetch() throws when page 1 has job cards it cannot parse');
  } else {
    fail('a markup change must surface as an error, not as a board with no jobs');
  }
} catch (error) {
  fail(`itviec provider tests could not run: ${error.message}`);
}
