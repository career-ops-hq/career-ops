// tests/providers/jobvite.test.mjs — unit tests for the Jobvite provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — Jobvite');

try {
  const {
    default: jobvite,
    resolveCompanyId,
    parseJobviteHtml,
  } = await import(pathToFileURL(join(ROOT, 'providers/jobvite.mjs')).href);

  // id
  if (jobvite.id === 'jobvite') {
    pass('jobvite.id is "jobvite"');
  } else {
    fail(`jobvite.id is "${jobvite.id}"`);
  }

  // ── resolveCompanyId ───────────────────────────────────────────

  // careers_url bare slug
  if (resolveCompanyId({ careers_url: 'https://jobs.jobvite.com/stripe' }) === 'stripe') {
    pass('resolveCompanyId extracts slug from bare careers_url');
  } else {
    fail(`resolveCompanyId bare: ${resolveCompanyId({ careers_url: 'https://jobs.jobvite.com/stripe' })}`);
  }

  // careers_url with /jobs path
  if (resolveCompanyId({ careers_url: 'https://jobs.jobvite.com/stripe/jobs' }) === 'stripe') {
    pass('resolveCompanyId extracts slug from careers_url with /jobs suffix');
  } else {
    fail(`resolveCompanyId /jobs suffix: ${resolveCompanyId({ careers_url: 'https://jobs.jobvite.com/stripe/jobs' })}`);
  }

  // legacy explicit api: URL takes precedence over careers_url
  const apiEntry = {
    api: 'https://jobs.jobvite.com/api/company/acme-corp/jobs',
    careers_url: 'https://jobs.jobvite.com/other',
  };
  if (resolveCompanyId(apiEntry) === 'acme-corp') {
    pass('resolveCompanyId prefers api: over careers_url');
  } else {
    fail(`resolveCompanyId api preference: ${resolveCompanyId(apiEntry)}`);
  }

  // null / wrong host / http / non-string
  if (resolveCompanyId({}) === null) {
    pass('resolveCompanyId returns null for empty entry');
  } else {
    fail('resolveCompanyId should return null for empty entry');
  }
  if (resolveCompanyId({ careers_url: 'https://evil.example.com/stripe' }) === null) {
    pass('resolveCompanyId returns null for wrong host');
  } else {
    fail('resolveCompanyId should return null for wrong host (SSRF guard)');
  }
  if (resolveCompanyId({ careers_url: 'http://jobs.jobvite.com/stripe' }) === null) {
    pass('resolveCompanyId returns null for non-https URL');
  } else {
    fail('resolveCompanyId should return null for non-https URL');
  }
  if (resolveCompanyId({ careers_url: null }) === null && resolveCompanyId({ careers_url: 42 }) === null) {
    pass('resolveCompanyId returns null for non-string careers_url');
  } else {
    fail('resolveCompanyId should return null for non-string careers_url');
  }

  // ── detect() ───────────────────────────────────────────────────

  const detectedUrl = jobvite.detect({ careers_url: 'https://jobs.jobvite.com/stripe' })?.url;
  if (detectedUrl === 'https://jobs.jobvite.com/stripe/jobs') {
    pass('jobvite.detect() builds correct careers URL from careers_url');
  } else {
    fail(`jobvite.detect() url: ${JSON.stringify(detectedUrl)}`);
  }

  if (jobvite.detect({ careers_url: 'https://lever.co/stripe' }) === null) {
    pass('jobvite.detect() returns null for non-Jobvite careers_url');
  } else {
    fail('jobvite.detect() should return null for non-Jobvite URL');
  }

  if (jobvite.detect({}) === null) {
    pass('jobvite.detect() returns null for empty entry');
  } else {
    fail('jobvite.detect() should return null for empty entry');
  }

  // ── parseJobviteHtml ─────────────────────────────────────────────

  // Fixture mirrors the real server-rendered markup: two postings, one with
  // a multi-part location (city + region joined by a hidden comma span),
  // one with HTML-entity-escaped title text, plus edge cases.
  const SAMPLE_HTML = `
    <table class="jv-job-list">
      <tbody>
        <tr>
          <td id="row1" class="jv-job-list-name">
            <a href="/acme/job/abc123">Senior Software Engineer</a>
          </td>
          <td data-x="1" class="jv-job-list-location">
Hybrid Remote<span>,</span>

            Tampa,
            Florida
          </td>
        </tr>
        <tr>
          <td class="jv-job-list-name">
            <a href="/acme/job/def456">Sales &amp; Marketing Lead</a>
          </td>
          <td class="jv-job-list-location">
            Berlin, Germany
          </td>
        </tr>
        <tr>
          <td class="jv-job-list-name">
            <a href="https://careers.acme.com/job/ghi789">Branded Domain Role</a>
          </td>
          <td class="jv-job-list-location">Remote</td>
        </tr>
        <tr>
          <td class="jv-job-list-name">
            <a href="/acme/job/empty-title"></a>
          </td>
          <td class="jv-job-list-location">Remote</td>
        </tr>
      </tbody>
    </table>
  `;

  const jobs = parseJobviteHtml(SAMPLE_HTML, 'Acme');

  // count — dropped: empty title → 3 valid
  if (jobs.length === 3) {
    pass('parseJobviteHtml returns 3 jobs (drops empty-title row)');
  } else {
    fail(`parseJobviteHtml count: ${jobs.length} (expected 3)`);
  }

  // LIST_PATTERNS carries the /g flag at module scope, so a stale lastIndex
  // from a prior call could silently skip leading matches on the next one —
  // regression guard for the explicit `pattern.lastIndex = 0` reset.
  const jobsAgain = parseJobviteHtml(SAMPLE_HTML, 'Acme');
  if (jobsAgain.length === jobs.length && jobsAgain[0]?.url === jobs[0]?.url) {
    pass('parseJobviteHtml resets regex lastIndex between calls (repeated call matches identically)');
  } else {
    fail(`parseJobviteHtml repeated call: ${JSON.stringify(jobsAgain)} vs first call ${JSON.stringify(jobs)}`);
  }

  // job 0 — full field mapping incl. multi-part location cleanup
  if (jobs[0]?.title === 'Senior Software Engineer') {
    pass('parseJobviteHtml maps title correctly');
  } else {
    fail(`parseJobviteHtml title: ${JSON.stringify(jobs[0]?.title)}`);
  }
  if (jobs[0]?.url === 'https://jobs.jobvite.com/acme/job/abc123') {
    pass('parseJobviteHtml resolves relative href against jobs.jobvite.com');
  } else {
    fail(`parseJobviteHtml url: ${JSON.stringify(jobs[0]?.url)}`);
  }
  if (jobs[0]?.company === 'Acme') {
    pass('parseJobviteHtml sets company from companyName arg');
  } else {
    fail(`parseJobviteHtml company: ${JSON.stringify(jobs[0]?.company)}`);
  }
  if (jobs[0]?.location === 'Hybrid Remote, Tampa, Florida') {
    pass('parseJobviteHtml collapses whitespace/newlines in multi-part location');
  } else {
    fail(`parseJobviteHtml location: ${JSON.stringify(jobs[0]?.location)}`);
  }

  // job 1 — HTML entity decoding in title
  if (jobs[1]?.title === 'Sales & Marketing Lead') {
    pass('parseJobviteHtml decodes HTML entities in title');
  } else {
    fail(`parseJobviteHtml entity decode: ${JSON.stringify(jobs[1]?.title)}`);
  }

  // job 2 — absolute branded-domain href passed through unchanged
  if (jobs[2]?.url === 'https://careers.acme.com/job/ghi789') {
    pass('parseJobviteHtml accepts absolute branded-domain href');
  } else {
    fail(`parseJobviteHtml branded URL: ${JSON.stringify(jobs[2]?.url)}`);
  }

  // An intervening <td> (e.g. a department/type column) between the name and
  // location cells must not break the match.
  const interveningTdHtml = '<table><tr><td class="jv-job-list-name"><a href="/acme/job/intervene">Baker</a></td><td class="jv-job-list-type">Full-Time</td><td class="jv-job-list-location">Remote</td></tr></table>';
  const interveningTdJobs = parseJobviteHtml(interveningTdHtml, 'Acme');
  if (interveningTdJobs.length === 1 && interveningTdJobs[0]?.location === 'Remote') {
    pass('parseJobviteHtml matches through an intervening table cell');
  } else {
    fail(`parseJobviteHtml intervening td: ${JSON.stringify(interveningTdJobs)}`);
  }

  // Regression: a row missing its location cell must be dropped, not merged
  // with the next row's title/location via regex backtracking across the
  // <tr>/</tr> boundary.
  const missingLocationHtml = '<table>' +
    '<tr><td class="jv-job-list-name"><a href="/acme/job/no-loc">No Location Here</a></td></tr>' +
    '<tr><td class="jv-job-list-name"><a href="/acme/job/second-row">Second Row</a></td><td class="jv-job-list-location">Berlin</td></tr>' +
    '</table>';
  const missingLocationJobs = parseJobviteHtml(missingLocationHtml, 'Acme');
  if (missingLocationJobs.length === 1 && missingLocationJobs[0]?.title === 'Second Row' && missingLocationJobs[0]?.location === 'Berlin') {
    pass('parseJobviteHtml drops a row missing its location cell instead of merging into the next row');
  } else {
    fail(`parseJobviteHtml missing-location row: ${JSON.stringify(missingLocationJobs)}`);
  }

  // Non-http(s) schemes (javascript:, data:, mailto:, …) must be dropped,
  // not carried through into job.url.
  const activeSchemeHtml = '<td class="jv-job-list-name"><a href="javascript:alert(1)">Bad Scheme</a></td><td class="jv-job-list-location">Remote</td>';
  if (parseJobviteHtml(activeSchemeHtml, 'Acme').length === 0) {
    pass('parseJobviteHtml drops a javascript: href instead of carrying it into job.url');
  } else {
    fail(`parseJobviteHtml active-scheme href was not dropped: ${JSON.stringify(parseJobviteHtml(activeSchemeHtml, 'Acme'))}`);
  }

  // A malformed numeric entity (decimal body with trailing hex letters, e.g.
  // "&#1a2;") must degrade to the original text, never silently swallow
  // characters — regression guard for the combined-hex/decimal regex bug
  // that _html-entities.mjs's shared decodeEntities() was written to fix
  // (#1555/#1639). jobvite.mjs must import that shared decoder rather than
  // define its own copy, or this reintroduces the same drift.
  const malformedHtml = '<td class="jv-job-list-name"><a href="/acme/job/malformed">Weird&#1a2;Title</a></td><td class="jv-job-list-location">Remote</td>';
  const malformedJobs = parseJobviteHtml(malformedHtml, 'Acme');
  if (malformedJobs[0]?.title === 'Weird&#1a2;Title') {
    pass('parseJobviteHtml leaves a malformed numeric entity ("&#1a2;") untouched instead of corrupting the title');
  } else {
    fail(`parseJobviteHtml malformed-entity handling: ${JSON.stringify(malformedJobs[0]?.title)}`);
  }

  // null / non-string input — defensive no-op, not a real fetch outcome
  // (ctx.fetchText always resolves to a string), so this stays a quiet [].
  if (parseJobviteHtml(null, 'X').length === 0) {
    pass('parseJobviteHtml returns [] for null input');
  } else {
    fail('parseJobviteHtml should return [] for null input');
  }

  // Unsupported layout: zero jobs matched AND no known-layout marker present
  // must throw, not return [] — a silent [] here is indistinguishable from a
  // genuinely empty board (the failure mode #2379 fixed for dead boards).
  const unsupportedCases = [
    ['empty string input', ''],
    ['a page with no Jobvite job markup at all', '<html>no job tables here</html>'],
    ['the client-rendered "faceted search" theme (job list loads via JS, nothing in initial HTML)', '<html><body><div id="app"></div></body></html>'],
  ];
  for (const [label, html] of unsupportedCases) {
    let threw = false;
    try {
      parseJobviteHtml(html, 'Acme');
    } catch (e) {
      threw = /Acme/.test(e.message);
    }
    if (threw) {
      pass(`parseJobviteHtml throws (naming the tenant) for ${label}`);
    } else {
      fail(`parseJobviteHtml should throw naming the tenant for ${label}`);
    }
  }

  // A recognized layout with genuinely zero rows (the wrapper class is
  // present, just no job rows inside it) is a real answer and must still
  // return [] quietly rather than throw.
  const genuinelyEmptyHtml = '<table class="jv-job-list"><tbody></tbody></table>';
  let genuinelyEmptyThrew = false;
  let genuinelyEmptyJobs = [];
  try {
    genuinelyEmptyJobs = parseJobviteHtml(genuinelyEmptyHtml, 'Acme');
  } catch {
    genuinelyEmptyThrew = true;
  }
  if (!genuinelyEmptyThrew && genuinelyEmptyJobs.length === 0) {
    pass('parseJobviteHtml returns [] (not a throw) for a recognized layout with genuinely zero rows');
  } else {
    fail(`parseJobviteHtml on a recognized-but-empty layout: threw=${genuinelyEmptyThrew}, jobs=${JSON.stringify(genuinelyEmptyJobs)}`);
  }

  // ── parseJobviteHtml — confirmed-empty wording on an otherwise-unrecognized page ──

  // Jobvite hardcodes one of two exact sentences for a genuinely empty board
  // depending on which page renders it — "There are currently no open jobs."
  // on the /jobs landing page, "No results found." on the /search results
  // page — confirmed against several live tenants. Neither page carries a
  // KNOWN_LAYOUT_MARKER (the real list, when non-empty, only renders via JS
  // on this theme), so without this wording the same page would throw; the
  // literal sentence is what tells "confirmed zero" apart from "can't tell".
  const emptyBoardCases = [
    ['the /jobs landing page wording', '<html><body><article><p class="jv-text-center">There are currently no open jobs.</p></article></body></html>'],
    ['the /search results page wording', '<html><body><article><p ng-non-bindable>No results found.</p></article></body></html>'],
  ];
  for (const [label, html] of emptyBoardCases) {
    let threw = false;
    let jobs = null;
    try {
      jobs = parseJobviteHtml(html, 'Acme');
    } catch {
      threw = true;
    }
    if (!threw && jobs && jobs.length === 0) {
      pass(`parseJobviteHtml returns [] (not a throw) for ${label}`);
    } else {
      fail(`parseJobviteHtml should return [] for ${label}: threw=${threw}, jobs=${JSON.stringify(jobs)}`);
    }
  }

  // Regression: the empty-board sentence appearing outside its own <p>
  // wrapper (unrelated prose elsewhere on the page, not the actual empty
  // state) must NOT suppress the throw — only the exact `<p>…</p>` form
  // Jobvite renders for a genuinely empty board counts.
  const looseWordingHtml = '<html><body><article><div>Some unrelated copy mentioning that ' +
    'there are currently no open jobs. in a totally different sentence context.</div></article></body></html>';
  let looseWordingThrew = false;
  try {
    parseJobviteHtml(looseWordingHtml, 'Acme');
  } catch {
    looseWordingThrew = true;
  }
  if (looseWordingThrew) {
    pass('parseJobviteHtml still throws when the empty-board sentence appears outside its own <p> wrapper');
  } else {
    fail('parseJobviteHtml should not treat loose unrelated text matching the empty-board sentence as a confirmed-empty board');
  }

  // ── parseJobviteHtml — anchor/div layout (a second real theme variant) ──

  // NOTE: this variant is confirmed against a live tenant (see
  // providers/jobvite.mjs's top-of-file comment for the verification list —
  // real tenant names are kept there, not duplicated into test fixtures).
  // These specific attribute-order/wrapper-div/badge edge cases below still
  // rest on fixtures, not a single confirmed live page exercising all of them.

  // Some tenants render the "classic" theme as <a><div>…</div></a> instead
  // of <td>…</td>, sometimes also inserting a jv-job-type div between name
  // and location, prefixing the location div's class (e.g.
  // `class="ml2 jv-job-list-location"`), or inlining a "New" ribbon badge
  // into the title text.
  const ANCHOR_HTML = `
    <div class="jv-job-list">
      <ul class="list-unstyled">
        <li class="row">
          <a href="/globex/job/xyz111" class="jv-job-item flex-row-md">
            <div id="name1" class="jv-job-list-name"><p>Backend Engineer</p></div>
            <div id="loc1" class="jv-job-list-location"><p>Remote, Global</p></div>
          </a>
        </li>
        <li class="row">
          <a href="/globex/job/xyz222" class="flex-row">
            <div class="jv-job-list-name">
              Support Specialist <span class="ml2 jv-tag-new">New
</span>
            </div>
            <div class="ml-auto jv-job-type">Full-Time</div>
            <div class="ml2 jv-job-list-location">Austin, Texas</div>
          </a>
        </li>
      </ul>
    </div>
  `;

  const anchorJobs = parseJobviteHtml(ANCHOR_HTML, 'Globex');

  if (anchorJobs.length === 2) {
    pass('parseJobviteHtml matches the anchor/div theme variant');
  } else {
    fail(`parseJobviteHtml anchor variant count: ${anchorJobs.length} (expected 2)`);
  }
  if (anchorJobs[0]?.title === 'Backend Engineer' && anchorJobs[0]?.location === 'Remote, Global') {
    pass('parseJobviteHtml anchor variant maps title/location');
  } else {
    fail(`parseJobviteHtml anchor variant job0: ${JSON.stringify(anchorJobs[0])}`);
  }
  if (anchorJobs[1]?.title === 'Support Specialist') {
    pass('parseJobviteHtml strips the "New" ribbon badge from the title');
  } else {
    fail(`parseJobviteHtml badge strip: ${JSON.stringify(anchorJobs[1]?.title)}`);
  }
  if (anchorJobs[1]?.location === 'Austin, Texas') {
    pass('parseJobviteHtml skips an intervening jv-job-type div and matches a prefixed location class');
  } else {
    fail(`parseJobviteHtml prefixed-class location: ${JSON.stringify(anchorJobs[1]?.location)}`);
  }

  // Regression: the badge span's class attribute isn't guaranteed to be its
  // first attribute (e.g. a data-* attr ahead of it).
  const BADGE_ATTR_ORDER_HTML = `
    <a href="/globex/job/xyz333">
      <div class="jv-job-list-name">Ops Analyst <span data-foo="1" class="jv-tag-new">New</span></div>
      <div class="jv-job-list-location">Remote</div>
    </a>
  `;
  const badgeAttrOrderJobs = parseJobviteHtml(BADGE_ATTR_ORDER_HTML, 'Globex');
  if (badgeAttrOrderJobs[0]?.title === 'Ops Analyst') {
    pass('parseJobviteHtml strips the badge span even when class is not its first attribute');
  } else {
    fail(`parseJobviteHtml badge attr-order: ${JSON.stringify(badgeAttrOrderJobs[0]?.title)}`);
  }

  // Regression: a hyphenated near-miss class (e.g. a mobile-only duplicate
  // div) must not satisfy the jv-job-list-name/-location token match — the
  // token check requires whitespace/quote-delimited boundaries, not just a
  // non-word character like the hyphen in "jv-job-list-name-mobile".
  const HYPHEN_FALSE_POSITIVE_HTML = `
    <a href="/globex/job/xyz444">
      <div class="jv-job-list-name-mobile">hidden mobile duplicate</div>
      <div class="jv-job-list-name">Real Title</div>
      <div class="jv-job-list-location">Remote</div>
    </a>
  `;
  const hyphenJobs = parseJobviteHtml(HYPHEN_FALSE_POSITIVE_HTML, 'Globex');
  if (hyphenJobs[0]?.title === 'Real Title') {
    pass('parseJobviteHtml is not fooled by a hyphenated near-miss class token');
  } else {
    fail(`parseJobviteHtml hyphen false-positive: ${JSON.stringify(hyphenJobs[0]?.title)}`);
  }

  // ── parseJobviteHtml — wrapper div + swapped attribute order (a third real theme variant) ──

  // Some tenants wrap name+location in an extra plain div
  // (`<div class="flex-col">`) and put `class` before `href` on the anchor
  // (`<a class="…" href="…">`).
  const WRAPPED_HTML = `
    <ul>
      <li>
        <a class="flex-row flex-c-center" href="/initech/job/w001">
          <div class="flex-col">
            <div class="col jv-job-list-name">Equipment Operator</div>
            <div class="col jv-job-list-location">Springfield, Missouri</div>
          </div>
        </a>
      </li>
    </ul>
  `;

  const wrappedJobs = parseJobviteHtml(WRAPPED_HTML, 'Initech');

  if (wrappedJobs.length === 1 && wrappedJobs[0]?.title === 'Equipment Operator') {
    pass('parseJobviteHtml matches through an extra wrapper div');
  } else {
    fail(`parseJobviteHtml wrapper-div variant: ${JSON.stringify(wrappedJobs)}`);
  }
  if (wrappedJobs[0]?.url === 'https://jobs.jobvite.com/initech/job/w001') {
    pass('parseJobviteHtml resolves href when class precedes href on the anchor');
  } else {
    fail(`parseJobviteHtml swapped-attribute-order url: ${JSON.stringify(wrappedJobs[0]?.url)}`);
  }
  if (wrappedJobs[0]?.location === 'Springfield, Missouri') {
    pass('parseJobviteHtml matches through an extra wrapper div for location too');
  } else {
    fail(`parseJobviteHtml wrapper-div location: ${JSON.stringify(wrappedJobs[0]?.location)}`);
  }

  // Regression: the location capture must stop at its own </div>, not swallow
  // a trailing sibling (e.g. a "posted N days ago" note) sitting between the
  // location div and the anchor's real closing tag.
  const TRAILING_SIBLING_HTML = `
    <a href="/initech/job/w003">
      <div class="wrap">
        <div class="jv-job-list-name">Warehouse Lead</div>
        <div class="jv-job-list-location">Reno, Nevada</div>
        <div class="posted">3 days ago</div>
      </div>
    </a>
  `;
  const trailingSiblingJobs = parseJobviteHtml(TRAILING_SIBLING_HTML, 'Initech');
  if (trailingSiblingJobs[0]?.location === 'Reno, Nevada') {
    pass('parseJobviteHtml does not swallow a trailing sibling div into the location');
  } else {
    fail(`parseJobviteHtml trailing-sibling location: ${JSON.stringify(trailingSiblingJobs[0]?.location)}`);
  }

  // ── parseJobviteHtml — must not cross into an unrelated neighboring anchor ──

  // Regression: an earlier version of the wrapper-div skip used a plain
  // `[\s\S]*?` between `<a href>` and the name div, with no guard against
  // crossing into a DIFFERENT anchor — a preceding `<a>` with no job divs of
  // its own (e.g. a nav/share link) could latch its href onto a job title
  // several entries later, silently dropping the real posting. This fixture
  // reproduces that shape: a bare `<a href="#unrelated">` with no
  // name/location divs sits right before the real job anchor.
  const UNRELATED_ANCHOR_HTML = `
    <li>
      <a href="#unrelated" class="jv-share-link">Share</a>
      <a href="/initech/job/w002" class="jv-job-item">
        <div class="jv-job-list-name">Real Posting</div>
        <div class="jv-job-list-location">Remote</div>
      </a>
    </li>
  `;

  const unrelatedJobs = parseJobviteHtml(UNRELATED_ANCHOR_HTML, 'Initech');

  if (unrelatedJobs.length === 1 && unrelatedJobs[0]?.url === 'https://jobs.jobvite.com/initech/job/w002') {
    pass('parseJobviteHtml does not attribute a job to an unrelated neighboring anchor');
  } else {
    fail(`parseJobviteHtml unrelated-anchor regression: ${JSON.stringify(unrelatedJobs)}`);
  }

  // ── parseJobviteHtml — category layout (a third real theme variant, confirmed against a live tenant) ──

  // Fixture reproduces the real structure seen on a live tenant (company name
  // and job IDs below are fictional; see providers/jobvite.mjs's top-of-file
  // comment for the actual verified tenant): rows grouped under per-category
  // `<table class="jv-job-list">` headers,
  // title and location sharing a single `<a class="jv-job-name">` instead of
  // separate cells/divs. This is the theme variant that motivated the
  // KNOWN_LAYOUT_MARKER check in the first place — its outer wrapper reuses
  // the same "jv-job-list" class as the table layout, so a naive "does the
  // page mention jv-job-list anywhere" check would wrongly call this
  // "recognized" and swallow the whole board as a silent [] without the
  // dedicated jv-job/jv-job-name markers and LIST_PATTERN entry below.
  const CATEGORY_HTML = `
    <h3 class="h2">Customer Service</h3>
    <table class="jv-job-list">
      <thead><tr><th>Job listing</th><th>Job location</th></tr></thead>
      <tbody>
        <div class="jv-job">
          <a class="jv-job-name" href="/cyberdyne/job/cd001">Customer Service Rep <span>
            Sacramento,
            California
          </span></a>
        </div>
        <div class="jv-job">
          <a class="jv-job-name" href="/cyberdyne/job/cd002">Sales &amp; Support Lead <span>
            Columbia,
            Maryland
          </span></a>
        </div>
      </tbody>
    </table>
    <h3 class="h2">Operations</h3>
    <table class="jv-job-list">
      <thead><tr><th>Job listing</th><th>Job location</th></tr></thead>
      <tbody>
        <div class="jv-job">
          <a class="jv-job-name" href="/cyberdyne/job/cd003">Operations Coordinator <span>
            Cincinnati,
            Ohio
          </span></a>
        </div>
      </tbody>
    </table>
  `;

  const categoryJobs = parseJobviteHtml(CATEGORY_HTML, 'Cyberdyne');

  if (categoryJobs.length === 3) {
    pass('parseJobviteHtml matches the category layout across multiple category tables');
  } else {
    fail(`parseJobviteHtml category variant count: ${categoryJobs.length} (expected 3)`);
  }
  if (categoryJobs[0]?.title === 'Customer Service Rep' && categoryJobs[0]?.location === 'Sacramento, California') {
    pass('parseJobviteHtml category variant maps title/location from a shared anchor');
  } else {
    fail(`parseJobviteHtml category variant job0: ${JSON.stringify(categoryJobs[0])}`);
  }
  if (categoryJobs[0]?.url === 'https://jobs.jobvite.com/cyberdyne/job/cd001') {
    pass('parseJobviteHtml category variant resolves relative href');
  } else {
    fail(`parseJobviteHtml category variant url: ${JSON.stringify(categoryJobs[0]?.url)}`);
  }
  if (categoryJobs[1]?.title === 'Sales & Support Lead') {
    pass('parseJobviteHtml category variant decodes HTML entities in title');
  } else {
    fail(`parseJobviteHtml category variant entity decode: ${JSON.stringify(categoryJobs[1]?.title)}`);
  }
  if (categoryJobs[2]?.title === 'Operations Coordinator' && categoryJobs[2]?.location === 'Cincinnati, Ohio') {
    pass('parseJobviteHtml category variant matches across a second category table');
  } else {
    fail(`parseJobviteHtml category variant job2: ${JSON.stringify(categoryJobs[2])}`);
  }

  // A row missing its location <span> entirely is dropped rather than kept
  // with a blank location — mirrors the table layout's "row missing its
  // location cell must be dropped" regression above — but the page as a
  // whole must not be misread as an unsupported layout just because one row
  // has no span: the jv-job/jv-job-name markers from the surrounding markup
  // (present elsewhere in this fixture) keep it out of the throw path.
  const NO_LOCATION_SPAN_HTML = '<table class="jv-job-list"><tbody>' +
    '<div class="jv-job"><a class="jv-job-name" href="/cyberdyne/job/nospan">No Location Listed</a></div>' +
    '<div class="jv-job"><a class="jv-job-name" href="/cyberdyne/job/hasspan">Has Location <span>Remote</span></a></div>' +
    '</tbody></table>';
  const noLocationSpanJobs = parseJobviteHtml(NO_LOCATION_SPAN_HTML, 'Cyberdyne');
  if (noLocationSpanJobs.length === 1 && noLocationSpanJobs[0]?.title === 'Has Location' && noLocationSpanJobs[0]?.location === 'Remote') {
    pass('parseJobviteHtml category variant drops a row missing its location span instead of merging into the next row');
  } else {
    fail(`parseJobviteHtml category variant no-span row: ${JSON.stringify(noLocationSpanJobs)}`);
  }

  // ── parseJobviteHtml — div-table layout (a fourth real theme variant, confirmed against a live tenant) ──

  // Fixture reproduces the real structure seen on a live tenant (company name
  // and job IDs below are fictional; see providers/jobvite.mjs's top-of-file
  // comment for the actual verified tenant): the table layout reimplemented
  // with <div>s — `<div class="tr"><div class="jv-job-list-name"><a
  // href>{Title}</a></div><div class="jv-job-list-location">{Location}</div>
  // </div>`. The name div wraps the anchor (opposite nesting from the
  // anchor/div variant), which is what keeps the two patterns from
  // cross-matching.
  const DIV_TABLE_HTML = `
    <div class="jv-job-list">
      <div class="thead"><div class="tr"><div class="th">Job Title</div><div class="th">Location</div></div></div>
      <div class="tbody">
        <div class="tr">
          <div class="jv-job-list-name">
            <a href="/wayneent/job/we001">Director, New Business Developer</a>
          </div>
          <div class="jv-job-list-location">

            United Kingdom

          </div>
          <div class="jv-job-contract-duration">Full-time</div>
        </div>
        <div class="tr">
          <div class="jv-job-list-name">
            <a href="/wayneent/job/we002">Sales &amp; Support Lead</a>
          </div>
          <div class="jv-job-list-location">
            United States
          </div>
        </div>
      </div>
    </div>
  `;

  const divTableJobs = parseJobviteHtml(DIV_TABLE_HTML, 'Wayne Enterprises');

  if (divTableJobs.length === 2) {
    pass('parseJobviteHtml matches the div-table layout');
  } else {
    fail(`parseJobviteHtml div-table variant count: ${divTableJobs.length} (expected 2)`);
  }
  if (divTableJobs[0]?.title === 'Director, New Business Developer' && divTableJobs[0]?.location === 'United Kingdom') {
    pass('parseJobviteHtml div-table variant maps title/location, skipping an intervening duration div');
  } else {
    fail(`parseJobviteHtml div-table variant job0: ${JSON.stringify(divTableJobs[0])}`);
  }
  if (divTableJobs[0]?.url === 'https://jobs.jobvite.com/wayneent/job/we001') {
    pass('parseJobviteHtml div-table variant resolves relative href');
  } else {
    fail(`parseJobviteHtml div-table variant url: ${JSON.stringify(divTableJobs[0]?.url)}`);
  }
  if (divTableJobs[1]?.title === 'Sales & Support Lead') {
    pass('parseJobviteHtml div-table variant decodes HTML entities in title');
  } else {
    fail(`parseJobviteHtml div-table variant entity decode: ${JSON.stringify(divTableJobs[1]?.title)}`);
  }

  // Regression: must not cross-match against the anchor/div variant's
  // pattern (name div wraps the anchor here, vs. anchor wraps the name div
  // there) — a row missing its location div must be dropped, not merged
  // with the next row's location, same discipline as the table layout.
  const DIV_TABLE_MISSING_LOCATION_HTML =
    '<div class="tr"><div class="jv-job-list-name"><a href="/x/job/1">No Location Here</a></div></div>' +
    '<div class="tr"><div class="jv-job-list-name"><a href="/x/job/2">Second Row</a></div><div class="jv-job-list-location">Berlin</div></div>';
  const divTableMissingLocJobs = parseJobviteHtml(DIV_TABLE_MISSING_LOCATION_HTML, 'X');
  if (divTableMissingLocJobs.length === 1 && divTableMissingLocJobs[0]?.title === 'Second Row' && divTableMissingLocJobs[0]?.location === 'Berlin') {
    pass('parseJobviteHtml div-table variant drops a row missing its location div instead of merging into the next row');
  } else {
    fail(`parseJobviteHtml div-table variant missing-location row: ${JSON.stringify(divTableMissingLocJobs)}`);
  }

  // ── parseJobviteHtml — single-cell layout (a fifth real theme variant, confirmed against a live tenant) ──

  // Fixture reproduces the real structure seen on a live tenant (company name
  // and job IDs below are fictional; see providers/jobvite.mjs's top-of-file
  // comment for the actual verified tenant): title and location share one
  // `<td class="jv-job-list-name">`, both nested inside the row's single
  // `<a>` — title in a generic, non-jv-prefixed `<div class="title">`
  // instead of one of this file's tracked class tokens, followed by a
  // trailing decorative div (an "arrow"/chevron icon on the live tenant)
  // that must not bleed into the location.
  const SINGLE_CELL_HTML = `
    <table class="jv-job-list"><tbody>
      <tr>
        <td class="jv-job-list-name">
          <a href="/initrode/job/sc001">
            <div class="title">Aero Controls Engineer</div>
            <div class="jv-job-list-location">
              Remote,
              United States
            </div>
            <div class="arrow"><img src="//example.com/icon.svg" /></div>
          </a>
        </td>
      </tr>
      <tr>
        <td class="jv-job-list-name">
          <a href="/initrode/job/sc002">
            <div class="title">Controls &amp; Instrumentation Technician</div>
            <div class="jv-job-list-location">Berlin, Germany</div>
          </a>
        </td>
      </tr>
    </tbody></table>
  `;

  const singleCellJobs = parseJobviteHtml(SINGLE_CELL_HTML, 'Initrode');

  if (singleCellJobs.length === 2) {
    pass('parseJobviteHtml matches the single-cell layout');
  } else {
    fail(`parseJobviteHtml single-cell variant count: ${singleCellJobs.length} (expected 2)`);
  }
  if (singleCellJobs[0]?.title === 'Aero Controls Engineer' && singleCellJobs[0]?.location === 'Remote, United States') {
    pass('parseJobviteHtml single-cell variant maps title/location, skipping a trailing decorative div');
  } else {
    fail(`parseJobviteHtml single-cell variant job0: ${JSON.stringify(singleCellJobs[0])}`);
  }
  if (singleCellJobs[0]?.url === 'https://jobs.jobvite.com/initrode/job/sc001') {
    pass('parseJobviteHtml single-cell variant resolves relative href');
  } else {
    fail(`parseJobviteHtml single-cell variant url: ${JSON.stringify(singleCellJobs[0]?.url)}`);
  }
  if (singleCellJobs[1]?.title === 'Controls & Instrumentation Technician' && singleCellJobs[1]?.location === 'Berlin, Germany') {
    pass('parseJobviteHtml single-cell variant decodes entities and handles a row with no trailing decorative div');
  } else {
    fail(`parseJobviteHtml single-cell variant job1: ${JSON.stringify(singleCellJobs[1])}`);
  }

  // Regression: must not cross-match the classic table pattern (which
  // expects the location in a *separate* <td>) — a row missing its location
  // div entirely must be dropped, not have the table pattern swallow the
  // whole cell's content as a garbled "title".
  const SINGLE_CELL_NO_LOCATION_HTML = `
    <table class="jv-job-list"><tbody>
      <tr><td class="jv-job-list-name"><a href="/initrode/job/nolo"><div class="title">No Location Here</div></a></td></tr>
      <tr><td class="jv-job-list-name"><a href="/initrode/job/hasloc"><div class="title">Has Location</div><div class="jv-job-list-location">Remote</div></a></td></tr>
    </tbody></table>
  `;
  const singleCellNoLocJobs = parseJobviteHtml(SINGLE_CELL_NO_LOCATION_HTML, 'Initrode');
  if (singleCellNoLocJobs.length === 1 && singleCellNoLocJobs[0]?.title === 'Has Location' && singleCellNoLocJobs[0]?.location === 'Remote') {
    pass('parseJobviteHtml single-cell variant drops a row missing its location div instead of merging into the next row');
  } else {
    fail(`parseJobviteHtml single-cell variant no-location row: ${JSON.stringify(singleCellNoLocJobs)}`);
  }

  // ── fetch() integration ────────────────────────────────────────

  let capturedUrl = null;
  let capturedOpts = null;
  const mockCtx = {
    async fetchText(url, opts) {
      capturedUrl = url;
      capturedOpts = opts;
      return SAMPLE_HTML;
    },
  };

  const fetched = await jobvite.fetch(
    { name: 'Acme', careers_url: 'https://jobs.jobvite.com/acme' },
    mockCtx,
  );

  if (capturedUrl === 'https://jobs.jobvite.com/acme/jobs?fr=true&nl=1') {
    pass('jobvite.fetch() requests the correct careers page URL, framed to bypass a branded-domain redirect');
  } else {
    fail(`jobvite.fetch() fetched: ${JSON.stringify(capturedUrl)}`);
  }

  if (capturedOpts?.redirect === 'error') {
    pass('jobvite.fetch() passes redirect:"error" to fetchText');
  } else {
    fail(`jobvite.fetch() redirect option: ${JSON.stringify(capturedOpts?.redirect)}`);
  }

  if (capturedOpts?.headers?.accept === 'text/html') {
    pass('jobvite.fetch() requests accept: "text/html"');
  } else {
    fail(`jobvite.fetch() accept header: ${JSON.stringify(capturedOpts?.headers)}`);
  }

  if (fetched.length === 3) {
    pass('jobvite.fetch() returns normalized jobs array');
  } else {
    fail(`jobvite.fetch() returned ${fetched.length} jobs (expected 3)`);
  }

  // fetch() throws when company ID cannot be resolved
  let threw = false;
  try {
    await jobvite.fetch({ name: 'NoSlug' }, { async fetchText() { return ''; } });
  } catch {
    threw = true;
  }
  if (threw) {
    pass('jobvite.fetch() throws when company ID cannot be resolved');
  } else {
    fail('jobvite.fetch() should throw when company ID is missing');
  }

  // ── fetch() — /search retry on an ambiguous /jobs landing page ──

  // /jobs is sometimes just a search-splash landing page for the
  // client-rendered theme (no known markers, no confirmed-empty wording) —
  // the real results live at /{slug}/search instead. fetch() should retry
  // there once before giving up.
  const AMBIGUOUS_HTML = '<html><body><div id="app"></div></body></html>';
  let retryUrls = [];
  const retrySuccessCtx = {
    async fetchText(url) {
      retryUrls.push(url);
      return new URL(url).pathname.endsWith('/search') ? SAMPLE_HTML : AMBIGUOUS_HTML;
    },
  };
  const retriedJobs = await jobvite.fetch({ name: 'Acme', careers_url: 'https://jobs.jobvite.com/acme' }, retrySuccessCtx);
  if (retryUrls.length === 2
    && retryUrls[0] === 'https://jobs.jobvite.com/acme/jobs?fr=true&nl=1'
    && retryUrls[1] === 'https://jobs.jobvite.com/acme/search?fr=true&nl=1') {
    pass('jobvite.fetch() retries against /{slug}/search when /jobs is ambiguous');
  } else {
    fail(`jobvite.fetch() retry URLs: ${JSON.stringify(retryUrls)}`);
  }
  if (retriedJobs.length === 3) {
    pass('jobvite.fetch() returns the jobs found on the /search retry');
  } else {
    fail(`jobvite.fetch() retry result: ${retriedJobs.length} jobs (expected 3)`);
  }

  // No retry at all when /jobs already resolves (known markers or confirmed
  // empty) — the common case shouldn't pay for a second request.
  let noRetryCalls = 0;
  const noRetryCtx = { async fetchText() { noRetryCalls++; return SAMPLE_HTML; } };
  await jobvite.fetch({ name: 'Acme', careers_url: 'https://jobs.jobvite.com/acme' }, noRetryCtx);
  if (noRetryCalls === 1) {
    pass('jobvite.fetch() does not retry when /jobs already resolves');
  } else {
    fail(`jobvite.fetch() made ${noRetryCalls} fetchText calls when /jobs already resolved (expected 1)`);
  }

  // Both /jobs and /search ambiguous: the /search error (naming the tenant)
  // propagates instead of the /jobs one.
  let bothAmbiguousThrew = false;
  let bothAmbiguousMessage = '';
  let bothAmbiguousCalls = 0;
  const bothAmbiguousCtx = { async fetchText() { bothAmbiguousCalls++; return AMBIGUOUS_HTML; } };
  try {
    await jobvite.fetch({ name: 'Acme', careers_url: 'https://jobs.jobvite.com/acme' }, bothAmbiguousCtx);
  } catch (e) {
    bothAmbiguousThrew = true;
    bothAmbiguousMessage = e.message;
  }
  if (bothAmbiguousThrew && /Acme/.test(bothAmbiguousMessage) && bothAmbiguousCalls === 2) {
    pass('jobvite.fetch() throws (naming the tenant) when both /jobs and /search are ambiguous, after actually attempting the /search retry');
  } else {
    fail(`jobvite.fetch() both-ambiguous: threw=${bothAmbiguousThrew}, message=${bothAmbiguousMessage}, calls=${bothAmbiguousCalls}`);
  }

  // ── fetch() — /search pagination on the retry path ──

  // /search reports its own pagination as a "{start}-{end} of {total}" text
  // node (e.g. "1-50 of 241" on a live tenant) — confirmed against several
  // live boards. A single search-results page for a small fixture board.
  const searchPageHtml = (jobs, start, end, total) => {
    const rows = jobs.map(([id, title]) =>
      `<tr><td class="jv-job-list-name"><a href="/pagetest/job/${id}">${title}</a></td><td class="jv-job-list-location">Remote</td></tr>`,
    ).join('');
    return `<table class="jv-job-list"><tbody>${rows}</tbody></table><div class="jv-pagination-text">${start}-${end} of ${total}</div>`;
  };

  // 5 total jobs, page size 2 → ceil(5/2) = 3 pages (p=0,1,2) needed.
  const paginatedPages = {
    search: searchPageHtml([['p1', 'Job 1'], ['p2', 'Job 2']], 1, 2, 5),
    'search?p=1': searchPageHtml([['p3', 'Job 3'], ['p4', 'Job 4']], 3, 4, 5),
    'search?p=2': searchPageHtml([['p5', 'Job 5']], 5, 5, 5),
  };
  // Every request now carries ?fr=true&nl=1 (see withFrameParams in
  // providers/jobvite.mjs) — strip those to recover the plain page key
  // (`search`, `search?p=1`, …) these mock fixtures are keyed by.
  const pageKey = (url) => {
    const p = new URL(url).searchParams.get('p');
    return p ? `search?p=${p}` : 'search';
  };
  let paginatedUrls = [];
  const paginatedCtx = {
    async fetchText(url) {
      paginatedUrls.push(url);
      if (new URL(url).pathname.endsWith('/jobs')) return AMBIGUOUS_HTML;
      return paginatedPages[pageKey(url)];
    },
  };
  const paginatedJobs = await jobvite.fetch({ name: 'Acme', careers_url: 'https://jobs.jobvite.com/pagetest' }, paginatedCtx);
  const expectedPaginatedUrls = [
    'https://jobs.jobvite.com/pagetest/jobs?fr=true&nl=1',
    'https://jobs.jobvite.com/pagetest/search?fr=true&nl=1',
    'https://jobs.jobvite.com/pagetest/search?p=1&fr=true&nl=1',
    'https://jobs.jobvite.com/pagetest/search?p=2&fr=true&nl=1',
  ];
  if (JSON.stringify(paginatedUrls) === JSON.stringify(expectedPaginatedUrls)) {
    pass('jobvite.fetch() follows /search pagination across all reported pages');
  } else {
    fail(`jobvite.fetch() pagination URLs: ${JSON.stringify(paginatedUrls)}`);
  }
  if (paginatedJobs.length === 5 && paginatedJobs[4]?.title === 'Job 5') {
    pass('jobvite.fetch() merges jobs from every /search page');
  } else {
    fail(`jobvite.fetch() paginated result: ${JSON.stringify(paginatedJobs)}`);
  }

  // Regression: the same posting reappearing on a later page (the listing
  // can shift between our page requests) must be deduped by URL, not
  // double-counted.
  const dupePages = {
    search: searchPageHtml([['d1', 'Job 1'], ['d2', 'Job 2']], 1, 2, 5),
    'search?p=1': searchPageHtml([['d2', 'Job 2'], ['d3', 'Job 3']], 3, 4, 5), // d2 repeats
    'search?p=2': searchPageHtml([['d4', 'Job 4']], 5, 5, 5),
  };
  const dupeCtx = {
    async fetchText(url) {
      if (new URL(url).pathname.endsWith('/jobs')) return AMBIGUOUS_HTML;
      return dupePages[pageKey(url)];
    },
  };
  const dupeJobs = await jobvite.fetch({ name: 'Acme', careers_url: 'https://jobs.jobvite.com/pagetest' }, dupeCtx);
  const dupeUrls = dupeJobs.map((j) => j.url);
  if (dupeJobs.length === 4 && new Set(dupeUrls).size === 4) {
    pass('jobvite.fetch() dedupes a posting that reappears on a later /search page');
  } else {
    fail(`jobvite.fetch() cross-page dedup: ${JSON.stringify(dupeUrls)}`);
  }

  // Regression: a later page failing (page >= 1) must not discard postings
  // already collected from earlier pages — only the *first* page failing
  // (nothing collected yet) should propagate.
  const laterPageFailCalls = [];
  const laterPageFailCtx = {
    async fetchText(url) {
      laterPageFailCalls.push(url);
      if (new URL(url).pathname.endsWith('/jobs')) return AMBIGUOUS_HTML;
      const key = pageKey(url);
      if (key === 'search?p=1') return AMBIGUOUS_HTML; // this page comes up empty-handed
      return paginatedPages[key];
    },
  };
  const laterPageFailJobs = await jobvite.fetch({ name: 'Acme', careers_url: 'https://jobs.jobvite.com/pagetest' }, laterPageFailCtx);
  if (laterPageFailJobs.length === 2 && laterPageFailJobs[0]?.title === 'Job 1') {
    pass('jobvite.fetch() keeps earlier-page results when a later /search page comes up ambiguous');
  } else {
    fail(`jobvite.fetch() later-page-failure result: ${JSON.stringify(laterPageFailJobs)}`);
  }
  if (laterPageFailCalls.length === 3) {
    pass('jobvite.fetch() stops paginating after a later page fails, instead of retrying it forever');
  } else {
    fail(`jobvite.fetch() later-page-failure call count: ${laterPageFailCalls.length} (expected 3)`);
  }

  // A /search page with no pagination text at all is the whole board — no
  // extra requests.
  let noPagerUrls = [];
  const noPagerCtx = {
    async fetchText(url) {
      noPagerUrls.push(url);
      if (new URL(url).pathname.endsWith('/jobs')) return AMBIGUOUS_HTML;
      return '<table class="jv-job-list"><tbody><tr><td class="jv-job-list-name"><a href="/pagetest/job/x1">Solo Job</a></td><td class="jv-job-list-location">Remote</td></tr></tbody></table>';
    },
  };
  const noPagerJobs = await jobvite.fetch({ name: 'Acme', careers_url: 'https://jobs.jobvite.com/pagetest' }, noPagerCtx);
  if (noPagerUrls.length === 2 && noPagerJobs.length === 1) {
    pass('jobvite.fetch() makes no extra requests when /search has no pagination text');
  } else {
    fail(`jobvite.fetch() no-pager: urls=${JSON.stringify(noPagerUrls)}, jobs=${noPagerJobs.length}`);
  }

  // ctx.maxPages (the liveness probe's cap) stops pagination after the
  // first page, same convention as join.mjs/workday.mjs.
  let ctxCapUrls = [];
  const ctxCapCtx = {
    maxPages: 1,
    async fetchText(url) {
      ctxCapUrls.push(url);
      if (new URL(url).pathname.endsWith('/jobs')) return AMBIGUOUS_HTML;
      return paginatedPages[pageKey(url)];
    },
  };
  const ctxCapJobs = await jobvite.fetch({ name: 'Acme', careers_url: 'https://jobs.jobvite.com/pagetest' }, ctxCapCtx);
  if (ctxCapUrls.length === 2 && ctxCapJobs.length === 2) {
    pass('jobvite.fetch() honors ctx.maxPages and stops after the first /search page');
  } else {
    fail(`jobvite.fetch() ctx.maxPages cap: urls=${JSON.stringify(ctxCapUrls)}, jobs=${ctxCapJobs.length}`);
  }

  // entry.max_pages caps how many /search pages get fetched, same as
  // ctx.maxPages but user-configurable via the portal entry.
  let entryCapUrls = [];
  const entryCapCtx = {
    async fetchText(url) {
      entryCapUrls.push(url);
      if (new URL(url).pathname.endsWith('/jobs')) return AMBIGUOUS_HTML;
      return paginatedPages[pageKey(url)];
    },
  };
  const entryCapJobs = await jobvite.fetch(
    { name: 'Acme', careers_url: 'https://jobs.jobvite.com/pagetest', max_pages: 2 },
    entryCapCtx,
  );
  if (entryCapUrls.length === 3 && entryCapJobs.length === 4) {
    pass('jobvite.fetch() honors entry.max_pages');
  } else {
    fail(`jobvite.fetch() entry.max_pages cap: urls=${JSON.stringify(entryCapUrls)}, jobs=${entryCapJobs.length}`);
  }

} catch (e) {
  fail(`jobvite provider tests crashed: ${e.message}`);
}
