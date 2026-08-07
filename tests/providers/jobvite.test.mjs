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

  // ── parseJobviteHtml — anchor/div layout (a second real theme variant) ──

  // NOTE: only the table layout above is exercised against a live tenant.
  // Everything below (anchor/div and its variants) rests on fixtures
  // reconstructed from Jobvite's published theme CSS, not a confirmed live
  // page — flag it if a live tenant on this variant turns up not matching.

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

  if (capturedUrl === 'https://jobs.jobvite.com/acme/jobs') {
    pass('jobvite.fetch() requests the correct careers page URL');
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

} catch (e) {
  fail(`jobvite provider tests crashed: ${e.message}`);
}
