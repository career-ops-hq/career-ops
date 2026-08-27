// tests/providers/jobbankca.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nProvider — jobbankca');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/jobbankca.mjs')).href);
  const jobbankca = mod.default;
  const { parseJobBankFeed, parseJobBankConfig, buildFeedUrl, assertJobBankUrl } = mod;

  if (jobbankca.id === 'jobbankca') pass('jobbankca.id is "jobbankca"');
  else fail(`jobbankca.id is ${JSON.stringify(jobbankca.id)}`);

  const hit = jobbankca.detect({ name: 'Job Bank', provider: 'jobbankca' });
  if (hit && hit.url === 'https://www.jobbank.gc.ca/jobsearch/feed/jobSearchRSSfeed') {
    pass('jobbankca.detect() claims explicit provider config');
  } else {
    fail(`jobbankca.detect() returned ${JSON.stringify(hit)}`);
  }

  if (jobbankca.detect({ name: 'Other', provider: 'arbeitsagentur' }) === null) {
    pass('jobbankca.detect() ignores other provider ids');
  } else {
    fail('jobbankca.detect() should only claim provider: jobbankca');
  }

  // ── parseJobBankConfig ──
  if (JSON.stringify(parseJobBankConfig({ jobbankca: { keywords: [' engineer ', 'nurse', '', 42] } }))
    === JSON.stringify({ keywords: ['engineer', 'nurse'] })) {
    pass('parseJobBankConfig trims keywords and drops blank/non-string entries');
  } else {
    fail(`parseJobBankConfig returned ${JSON.stringify(parseJobBankConfig({ jobbankca: { keywords: [' engineer ', 'nurse', '', 42] } }))}`);
  }

  if (parseJobBankConfig({}).keywords.length === 0 && parseJobBankConfig({ jobbankca: {} }).keywords.length === 0) {
    pass('parseJobBankConfig defaults to no keywords when the block or array is absent');
  } else {
    fail('parseJobBankConfig should default to an empty keywords array');
  }

  // ── buildFeedUrl ──
  const built = new URL(buildFeedUrl('backend developer', 2));
  if (
    built.origin + built.pathname === 'https://www.jobbank.gc.ca/jobsearch/feed/jobSearchRSSfeed'
    && built.searchParams.get('searchstring') === 'backend developer'
    && built.searchParams.get('page') === '2'
    && built.searchParams.get('locationstring') === ''
  ) {
    pass('buildFeedUrl builds the pinned feed URL with searchstring/page/locationstring');
  } else {
    fail(`buildFeedUrl returned ${buildFeedUrl('backend developer', 2)}`);
  }

  // ── parseJobBankFeed — fixture captured 2026-08-20 from the real public feed,
  // trimmed to the shapes worth asserting on. ──
  const sample = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">
	<title><![CDATA[developer - Job Bank]]></title>
	<id>https://www.jobbank.gc.ca/jobsearch/jobSearchRSSfeed</id>
	<link rel="self" type="application/atom+xml" href="https://www.jobbank.gc.ca/jobsearch/jobSearchRSSfeed?searchstring=developer&amp;locationstring="/>
	<updated>2026-08-20T23:26:37Z</updated>
	<author><name>Job Bank</name></author>
	<logo>/images/sig_eng.gif</logo>
	<entry>
		<title type="html"><![CDATA[devops engineer]]></title>
		<link rel="alternate" type="text/html" href="https://www.jobbank.gc.ca/jobsearch/jobposting/50123456"/>
		<id>https://www.jobbank.gc.ca/jobsearch/jobSearchRSSfeed?id=10236614247</id>
		<updated>2026-08-20T17:00:00Z</updated>
		<summary type="html"><![CDATA[<strong>Job number:</strong> 10236614247<br /><strong>Location:</strong> Vancouver (BC)  <br /><strong>Employer:</strong> Telescope Innovations Corp<br /><strong>Salary:</strong> $100,000.00 to $140,000.00 annually]]></summary>
	</entry>
	<entry>
		<title type="html">data analyst, R&amp;D</title>
		<link rel="alternate" type="text/html" href="https://www.jobbank.gc.ca/jobsearch/jobposting/50120001"/>
		<id>https://www.jobbank.gc.ca/jobsearch/jobSearchRSSfeed?id=17460900</id>
		<updated>2026-08-20T09:00:00Z</updated>
		<summary type="html"><![CDATA[<strong>Job number:</strong> 17460900<br /><strong>Location:</strong> Montréal (QC)  <br /><strong>Employer:</strong> Data Co]]></summary>
	</entry>
	<entry>
		<title type="html"><![CDATA[dropped: no link]]></title>
		<id>https://www.jobbank.gc.ca/jobsearch/jobSearchRSSfeed?id=999</id>
		<updated>2026-08-20T08:00:00Z</updated>
		<summary type="html"><![CDATA[<strong>Location:</strong> Nowhere]]></summary>
	</entry>
	<entry>
		<link rel="alternate" type="text/html" href="https://www.jobbank.gc.ca/jobsearch/jobposting/50120002"/>
		<id>https://www.jobbank.gc.ca/jobsearch/jobSearchRSSfeed?id=998</id>
		<updated>2026-08-20T08:00:00Z</updated>
		<summary type="html"><![CDATA[dropped: no title]]></summary>
	</entry>
	<entry>
		<title type="html"><![CDATA[dropped: off-host link]]></title>
		<link rel="alternate" type="text/html" href="https://example.com/jobsearch/jobposting/1"/>
		<id>https://www.jobbank.gc.ca/jobsearch/jobSearchRSSfeed?id=997</id>
		<updated>2026-08-20T08:00:00Z</updated>
		<summary type="html"><![CDATA[<strong>Location:</strong> Elsewhere]]></summary>
	</entry>
</feed>`;

  const jobs = parseJobBankFeed(sample);

  if (jobs.length === 2) pass('parseJobBankFeed keeps 2 entries (drops missing-link/title/off-host)');
  else fail(`parseJobBankFeed returned ${jobs.length} jobs (expected 2): ${JSON.stringify(jobs)}`);

  if (jobs[0]?.title === 'devops engineer' && jobs[0]?.company === 'Telescope Innovations Corp' && jobs[0]?.location === 'Vancouver (BC)') {
    pass('parseJobBankFeed extracts title/company/location from the summary CDATA');
  } else {
    fail(`row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[0]?.url === 'https://www.jobbank.gc.ca/jobsearch/jobposting/50123456') {
    pass('parseJobBankFeed maps the Atom <link href> to url, not inner text');
  } else {
    fail(`row 0 url = ${JSON.stringify(jobs[0]?.url)}`);
  }

  if (jobs[0]?.postedAt === Date.parse('2026-08-20T17:00:00Z')) {
    pass('parseJobBankFeed parses <updated> to postedAt');
  } else {
    fail(`row 0 postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  if (jobs[1]?.title === 'data analyst, R&D') {
    pass('parseJobBankFeed decodes entities in the title (R&amp;D -> R&D)');
  } else {
    fail(`row 1 title = ${JSON.stringify(jobs[1]?.title)}`);
  }

  if (jobs[1]?.location === 'Montréal (QC)' && jobs[1]?.company === 'Data Co') {
    pass('parseJobBankFeed extracts fields correctly when Salary is absent (label order preserved)');
  } else {
    fail(`row 1 = ${JSON.stringify(jobs[1])}`);
  }

  if (parseJobBankFeed('').length === 0 && parseJobBankFeed(null).length === 0 && parseJobBankFeed(undefined).length === 0) {
    pass('parseJobBankFeed empty / non-string feed -> empty result (no crash)');
  } else {
    fail('parseJobBankFeed empty / non-string feed should yield empty result');
  }

  // ── review findings: prefer rel="alternate", tolerate <entry> attributes,
  // strip HTML tags to a fixed point ──

  const multiLinkEntry = `<entry>
    <title><![CDATA[multi-link]]></title>
    <link rel="self" type="application/atom+xml" href="https://www.jobbank.gc.ca/jobsearch/jobSearchRSSfeed?id=1"/>
    <link rel="alternate" type="text/html" href="https://www.jobbank.gc.ca/jobsearch/jobposting/50999999"/>
    <id>1</id>
    <updated>2026-08-20T08:00:00Z</updated>
    <summary><![CDATA[<strong>Location:</strong> X]]></summary>
  </entry>`;
  const multiLinkJobs = parseJobBankFeed(multiLinkEntry);
  if (multiLinkJobs[0]?.url === 'https://www.jobbank.gc.ca/jobsearch/jobposting/50999999') {
    pass('parseJobBankFeed prefers the rel="alternate" link when several <link> elements are present');
  } else {
    fail(`multi-link entry url = ${JSON.stringify(multiLinkJobs[0]?.url)}`);
  }

  // XML permits single OR double quotes and whitespace around '=' — a "self"
  // link in the feed's usual double-quoted form, followed by an "alternate"
  // link that happens to use the (equally valid) single-quoted form, must
  // still be recognized as alternate.
  const mixedQuoteEntry = `<entry>
    <title><![CDATA[mixed-quote link]]></title>
    <link rel="self" href="https://www.jobbank.gc.ca/jobsearch/jobSearchRSSfeed?id=2"/>
    <link rel='alternate' href='https://www.jobbank.gc.ca/jobsearch/jobposting/50999998'/>
    <id>2</id>
    <updated>2026-08-20T08:00:00Z</updated>
    <summary><![CDATA[<strong>Location:</strong> X]]></summary>
  </entry>`;
  const mixedQuoteJobs = parseJobBankFeed(mixedQuoteEntry);
  if (mixedQuoteJobs[0]?.url === 'https://www.jobbank.gc.ca/jobsearch/jobposting/50999998') {
    pass('parseJobBankFeed recognizes a single-quoted rel="alternate" link after a double-quoted "self" link');
  } else {
    fail(`mixed-quote entry url = ${JSON.stringify(mixedQuoteJobs[0]?.url)}`);
  }

  // Exercises the optional-whitespace-around-'=' half of the same syntax
  // tolerance — the mixed-quote fixture above has none.
  const spacedEqualsEntry = `<entry>
    <title><![CDATA[spaced equals link]]></title>
    <link rel = "self" href = "https://www.jobbank.gc.ca/jobsearch/jobSearchRSSfeed?id=2b"/>
    <link rel = 'alternate' href = 'https://www.jobbank.gc.ca/jobsearch/jobposting/50999997'/>
    <id>2b</id>
    <updated>2026-08-20T08:00:00Z</updated>
    <summary><![CDATA[<strong>Location:</strong> X]]></summary>
  </entry>`;
  const spacedEqualsJobs = parseJobBankFeed(spacedEqualsEntry);
  if (spacedEqualsJobs[0]?.url === 'https://www.jobbank.gc.ca/jobsearch/jobposting/50999997') {
    pass('parseJobBankFeed tolerates whitespace around "=" in rel/href attributes');
  } else {
    fail(`spaced-equals entry url = ${JSON.stringify(spacedEqualsJobs[0]?.url)}`);
  }

  // Review findings: an extension-namespaced <link-extension> element, and an
  // extension attribute (data-rel/data-href) smuggled onto a genuine <link>,
  // must never be mistaken for the real element/attributes — both share a
  // trusted host with the real target, so the host check alone can't catch a
  // wrong pick.
  const linkExtensionEntry = `<entry>
    <title><![CDATA[link-extension probe]]></title>
    <link-extension data-rel="alternate" data-href="https://www.jobbank.gc.ca/jobsearch/jobposting/WRONG"/>
    <link rel="alternate" href="https://www.jobbank.gc.ca/jobsearch/jobposting/50999996"/>
    <id>2c</id>
    <updated>2026-08-20T08:00:00Z</updated>
    <summary><![CDATA[<strong>Location:</strong> X]]></summary>
  </entry>`;
  const linkExtensionJobs = parseJobBankFeed(linkExtensionEntry);
  if (linkExtensionJobs[0]?.url === 'https://www.jobbank.gc.ca/jobsearch/jobposting/50999996') {
    pass('parseJobBankFeed ignores a <link-extension> element entirely, using only the real <link>');
  } else {
    fail(`link-extension entry url = ${JSON.stringify(linkExtensionJobs[0]?.url)}`);
  }

  const extensionAttrEntry = `<entry>
    <title><![CDATA[extension attribute probe]]></title>
    <link rel="self" data-rel="alternate" data-href="https://www.jobbank.gc.ca/jobsearch/jobposting/WRONG2" href="https://www.jobbank.gc.ca/jobsearch/self"/>
    <link rel="alternate" href="https://www.jobbank.gc.ca/jobsearch/jobposting/50999995"/>
    <id>2d</id>
    <updated>2026-08-20T08:00:00Z</updated>
    <summary><![CDATA[<strong>Location:</strong> X]]></summary>
  </entry>`;
  const extensionAttrJobs = parseJobBankFeed(extensionAttrEntry);
  if (extensionAttrJobs[0]?.url === 'https://www.jobbank.gc.ca/jobsearch/jobposting/50999995') {
    pass('parseJobBankFeed ignores data-rel/data-href extension attributes on a genuine <link>');
  } else {
    fail(`extension-attribute entry url = ${JSON.stringify(extensionAttrJobs[0]?.url)}`);
  }

  // Review finding: rel=/href= appearing INSIDE another attribute's quoted
  // value (not as a hyphen/colon-prefixed name — the previous two probes'
  // fix — but genuinely preceded by whitespace, just nested one level
  // deeper). A pattern that scans the whole tag text for `rel=`/`href=`
  // can't tell "top-level attribute" from "substring inside a quoted value"
  // without tracking quote state; only sequential tokenization can.
  const embeddedAttrValueEntry = `<entry>
    <title><![CDATA[embedded-attribute-value probe]]></title>
    <link data=" rel='alternate' href='https://www.jobbank.gc.ca/jobsearch/jobposting/WRONG3'" rel="self" href="https://www.jobbank.gc.ca/jobsearch/self3"/>
    <link rel="alternate" href="https://www.jobbank.gc.ca/jobsearch/jobposting/50999994"/>
    <id>2e</id>
    <updated>2026-08-20T08:00:00Z</updated>
    <summary><![CDATA[<strong>Location:</strong> X]]></summary>
  </entry>`;
  const embeddedAttrValueJobs = parseJobBankFeed(embeddedAttrValueEntry);
  if (embeddedAttrValueJobs[0]?.url === 'https://www.jobbank.gc.ca/jobsearch/jobposting/50999994') {
    pass('parseJobBankFeed ignores rel=/href= text embedded inside another attribute\'s quoted value');
  } else {
    fail(`embedded-attribute-value entry url = ${JSON.stringify(embeddedAttrValueJobs[0]?.url)}`);
  }

  const attributedEntry = `<entry xml:lang="en">
    <title><![CDATA[attributed entry]]></title>
    <link rel="alternate" type="text/html" href="https://www.jobbank.gc.ca/jobsearch/jobposting/50888888"/>
    <id>2</id>
    <updated>2026-08-20T08:00:00Z</updated>
    <summary><![CDATA[<strong>Location:</strong> X]]></summary>
  </entry>`;
  if (parseJobBankFeed(attributedEntry).length === 1) {
    pass('parseJobBankFeed still matches an <entry> that carries its own attributes');
  } else {
    fail(`attributed <entry> yielded ${parseJobBankFeed(attributedEntry).length} jobs (expected 1)`);
  }

  // Incomplete-sanitization probes (CodeQL js/incomplete-multi-character-
  // sanitization): a single non-looped tag-strip can leave a residual
  // tag-shaped fragment; a malformed/nested bracket construct can leave a
  // LONE unmatched '<' or '>' behind even at fixed point. Neither field is
  // meant to carry markup at all, so the bar is "no bracket survives",
  // paired or not — not merely "no complete tag survives".
  const scriptProbeEntry = `<entry>
    <title><![CDATA[tag-strip probe: script]]></title>
    <link rel="alternate" href="https://www.jobbank.gc.ca/jobsearch/jobposting/50777777"/>
    <id>3</id>
    <updated>2026-08-20T08:00:00Z</updated>
    <summary><![CDATA[<strong>Location:</strong> <<script>script>alert(1)</strong>]]></summary>
  </entry>`;
  const scriptProbeLocation = parseJobBankFeed(scriptProbeEntry)[0]?.location ?? '';
  if (!scriptProbeLocation.includes('<') && !scriptProbeLocation.includes('>')) {
    pass('parseJobBankFeed strips a nested <<script> probe to zero surviving angle brackets');
  } else {
    fail(`script-probe location retained markup: ${JSON.stringify(scriptProbeLocation)}`);
  }

  const nestedTagProbeEntry = `<entry>
    <title><![CDATA[tag-strip probe: nested]]></title>
    <link rel="alternate" href="https://www.jobbank.gc.ca/jobsearch/jobposting/50777778"/>
    <id>3b</id>
    <updated>2026-08-20T08:00:00Z</updated>
    <summary><![CDATA[<strong>Employer:</strong> <<a>b>Acme<br/>]]></summary>
  </entry>`;
  const nestedTagProbeCompany = parseJobBankFeed(nestedTagProbeEntry)[0]?.company ?? '';
  if (!nestedTagProbeCompany.includes('<') && !nestedTagProbeCompany.includes('>')) {
    pass('parseJobBankFeed strips a nested <<a>b> probe to zero surviving angle brackets');
  } else {
    fail(`nested-tag-probe company retained markup: ${JSON.stringify(nestedTagProbeCompany)}`);
  }
  // stripTags also needs to be idempotent on ordinary, non-adversarial input —
  // the fixed-point loop must not eat past a SINGLE well-formed tag pair.
  const ordinaryEntry = `<entry>
    <title><![CDATA[ordinary tags]]></title>
    <link rel="alternate" href="https://www.jobbank.gc.ca/jobsearch/jobposting/50666666"/>
    <id>4</id>
    <updated>2026-08-20T08:00:00Z</updated>
    <summary><![CDATA[<strong>Location:</strong> <em>Remote</em> (Canada-wide)]]></summary>
  </entry>`;
  const ordinaryLocation = parseJobBankFeed(ordinaryEntry)[0]?.location ?? '';
  if (ordinaryLocation === 'Remote (Canada-wide)') {
    pass('parseJobBankFeed strips ordinary well-formed tags cleanly, without over-eating adjacent text');
  } else {
    fail(`ordinary summary location = ${JSON.stringify(ordinaryLocation)}`);
  }

  // ── fetch(): keyword requirement + config/profile.yml fallback. Runs in an
  // isolated tmp cwd (never this checkout's own config/profile.yml, so the
  // test is hermetic regardless of whether the checkout is onboarded) —
  // same pattern as tests/providers/vdab.test.mjs. ──
  {
    const withTmpCwd = async (setup, run) => {
      const tmp = mkdtempSync(join(tmpdir(), 'career-ops-jobbankca-fallback-'));
      const cwdBefore = process.cwd();
      try {
        setup(tmp);
        process.chdir(tmp);
        return await run();
      } finally {
        process.chdir(cwdBefore);
      }
    };

    // No entry keywords, but a profile.yml with target_roles → falls back.
    let sentSearchstring = null;
    await withTmpCwd(
      (tmp) => {
        mkdirSync(join(tmp, 'config'));
        writeFileSync(join(tmp, 'config', 'profile.yml'), 'target_roles:\n  primary:\n    - Data Engineer\n');
      },
      () => jobbankca.fetch(
        { provider: 'jobbankca', name: 'No own keywords' },
        {
          sleep: async () => {},
          fetchText: async (url) => { sentSearchstring = new URL(url).searchParams.get('searchstring'); return '<?xml version="1.0"?><feed></feed>'; },
        },
      ),
    );
    if (sentSearchstring === 'Data Engineer') {
      pass('jobbankca.fetch() falls back to config/profile.yml target_roles when jobbankca.keywords[] is empty');
    } else {
      fail(`jobbankca.fetch() fallback searchstring = ${JSON.stringify(sentSearchstring)}`);
    }

    // No entry keywords AND no profile.yml at all → throws.
    let threwNoKeywords = false;
    let threwMessage = '';
    try {
      await withTmpCwd(
        () => {}, // no config/ dir created — profile.yml genuinely absent
        () => jobbankca.fetch({ provider: 'jobbankca', name: 'No Keywords' }, { fetchText: async () => '', sleep: async () => {} }),
      );
    } catch (err) {
      threwNoKeywords = true;
      threwMessage = err.message;
    }
    if (threwNoKeywords && /no jobbankca\.keywords/.test(threwMessage)) {
      pass('jobbankca.fetch() throws a clear error when no keywords and no profile.yml fallback are available');
    } else {
      fail(`jobbankca.fetch() should throw when no keywords are available from any source, got: threw=${threwNoKeywords} message=${JSON.stringify(threwMessage)}`);
    }
  }

  // ── fetch(): pagination stops on a short page, dedups across keywords ──
  {
    const fullPage = Array.from({ length: 100 }, (_, i) => `\t<entry>
		<title><![CDATA[role ${i}]]></title>
		<link rel="alternate" type="text/html" href="https://www.jobbank.gc.ca/jobsearch/jobposting/${i}"/>
		<id>id-${i}</id>
		<updated>2026-08-20T08:00:00Z</updated>
		<summary><![CDATA[<strong>Location:</strong> X]]></summary>
	</entry>`).join('\n');
    const shortPage = `\t<entry>
		<title><![CDATA[role 100]]></title>
		<link rel="alternate" type="text/html" href="https://www.jobbank.gc.ca/jobsearch/jobposting/100"/>
		<id>id-100</id>
		<updated>2026-08-20T08:00:00Z</updated>
		<summary><![CDATA[<strong>Location:</strong> X]]></summary>
	</entry>`;
    const feed = (body) => `<?xml version="1.0"?><feed>${body}</feed>`;

    const requested = [];
    let slept = 0;
    const fetched = await jobbankca.fetch(
      { provider: 'jobbankca', name: 'Full page test', jobbankca: { keywords: ['developer'] } },
      {
        maxPages: undefined,
        sleep: async (ms) => { slept += ms; },
        fetchText: async (url) => {
          requested.push(url);
          const page = new URL(url).searchParams.get('page');
          return page === '1' ? feed(fullPage) : feed(shortPage);
        },
      },
    );

    if (requested.length === 2) pass('jobbankca.fetch() paginates: a full (100-entry) page requests the next one');
    else fail(`jobbankca.fetch() made ${requested.length} requests (expected 2): ${JSON.stringify(requested)}`);

    if (fetched.length === 101) pass('jobbankca.fetch() stops after a short page and returns all collected jobs');
    else fail(`jobbankca.fetch() returned ${fetched.length} jobs (expected 101)`);

    if (slept >= 2 * 5000) pass('jobbankca.fetch() sleeps at least 5000ms (robots.txt Crawl-delay) before each request');
    else fail(`jobbankca.fetch() only slept ${slept}ms total for 2 requests`);
  }

  // A page can contain the full 100 raw Atom entries even when one is
  // filtered during parsing. Pagination is determined by the upstream page
  // size, not by how many rows survive local validation.
  {
    const entry = (id, title = `role ${id}`) => `<entry>
      ${title ? `<title><![CDATA[${title}]]></title>` : ''}
      <link rel="alternate" href="https://www.jobbank.gc.ca/jobsearch/jobposting/${id}"/>
      <id>${id}</id>
      <updated>2026-08-20T08:00:00Z</updated>
      <summary><![CDATA[<strong>Location:</strong> X]]></summary>
    </entry>`;
    const feed = (entries) => `<?xml version="1.0"?><feed>${entries.join('')}</feed>`;
    const fullRawPage = [
      ...Array.from({ length: 99 }, (_, i) => entry(i)),
      entry('titleless', ''),
    ];
    const laterPage = [entry(100)];
    const requested = [];

    const fetched = await jobbankca.fetch(
      { provider: 'jobbankca', name: 'Raw page size test', jobbankca: { keywords: ['developer'] } },
      {
        sleep: async () => {},
        fetchText: async (url) => {
          requested.push(url);
          return new URL(url).searchParams.get('page') === '1'
            ? feed(fullRawPage)
            : feed(laterPage);
        },
      },
    );

    if (requested.length === 2) {
      pass('jobbankca.fetch() paginates after a full 100-entry feed page even when one entry is filtered');
    } else {
      fail(`jobbankca.fetch() made ${requested.length} request(s) after a full raw page with one filtered entry (expected 2)`);
    }
    if (fetched.length === 100 && fetched.some((job) => job.title === 'role 100')) {
      pass('jobbankca.fetch() returns only valid jobs while retaining jobs from the later page');
    } else {
      fail(`jobbankca.fetch() returned ${fetched.length} valid job(s) and later-page job=${fetched.some((job) => job.title === 'role 100')} (expected 100/true)`);
    }
  }

  // ── fetch(): entry.max_pages configures the run, ctx.maxPages only caps it ──
  {
    const feed = (n) => `<?xml version="1.0"?><feed>${Array.from({ length: n }, (_, i) => `<entry><title><![CDATA[r${i}]]></title><link rel="alternate" href="https://www.jobbank.gc.ca/jobsearch/jobposting/${i}"/><id>${i}</id><updated>2026-08-20T08:00:00Z</updated><summary><![CDATA[x]]></summary></entry>`).join('')}</feed>`;
    const requested = [];
    const capped = await jobbankca.fetch(
      { provider: 'jobbankca', name: 'Capped', jobbankca: { keywords: ['x'] }, max_pages: 3 },
      {
        maxPages: 1, // a health-probe-style cap
        sleep: async () => {},
        fetchText: async (url) => { requested.push(url); return feed(100); },
      },
    );
    if (requested.length === 1) pass('jobbankca.fetch(): ctx.maxPages caps entry.max_pages, not the other way around');
    else fail(`jobbankca.fetch() made ${requested.length} requests under ctx.maxPages=1 (expected 1)`);
  }

  // ── fetch(): recall-first — one failed keyword does not abort the others ──
  {
    const feed = `<?xml version="1.0"?><feed><entry><title><![CDATA[ok]]></title><link rel="alternate" href="https://www.jobbank.gc.ca/jobsearch/jobposting/1"/><id>1</id><updated>2026-08-20T08:00:00Z</updated><summary><![CDATA[x]]></summary></entry></feed>`;
    const fetched = await jobbankca.fetch(
      { provider: 'jobbankca', name: 'Partial failure', jobbankca: { keywords: ['bad', 'good'] } },
      {
        sleep: async () => {},
        fetchText: async (url) => {
          if (url.includes('searchstring=bad')) throw new Error('network error');
          return feed;
        },
      },
    );
    if (fetched.length === 1 && fetched[0].title === 'ok') {
      pass('jobbankca.fetch(): a failed keyword does not abort keywords that still succeed');
    } else {
      fail(`jobbankca.fetch() with one failing keyword returned ${JSON.stringify(fetched)}`);
    }
  }

  // ── fetch(): total outage throws ──
  try {
    await jobbankca.fetch(
      { provider: 'jobbankca', name: 'Outage', jobbankca: { keywords: ['a', 'b'] } },
      { sleep: async () => {}, fetchText: async () => { throw new Error('boom'); } },
    );
    fail('jobbankca.fetch() should throw when every keyword request fails');
  } catch (err) {
    if (/all 2 keyword request\(s\) failed/.test(err.message)) pass('jobbankca.fetch() throws when every keyword fails (total outage)');
    else fail(`jobbankca.fetch() threw an unexpected error on total outage: ${err.message}`);
  }

  // ── fetch(): request hygiene ──
  {
    let capturedOpts = null;
    await jobbankca.fetch(
      { provider: 'jobbankca', name: 'Hygiene', jobbankca: { keywords: ['x'] } },
      {
        sleep: async () => {},
        fetchText: async (url, opts) => { capturedOpts = opts; return '<?xml version="1.0"?><feed></feed>'; },
      },
    );
    if (capturedOpts && capturedOpts.redirect === 'error') {
      pass('jobbankca.fetch() passes redirect:"error" to fetchText (SSRF-via-redirect guard)');
    } else {
      fail(`jobbankca.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);
    }
    if (capturedOpts && capturedOpts.headers && capturedOpts.headers['User-Agent']) {
      pass('jobbankca.fetch() sends a User-Agent header');
    } else {
      fail(`jobbankca.fetch() should send a User-Agent header, got: ${JSON.stringify(capturedOpts)}`);
    }
  }

  // ── assertJobBankUrl: host guard ──
  try {
    assertJobBankUrl('https://evil.example.com/jobsearch/feed/jobSearchRSSfeed');
    fail('assertJobBankUrl() should throw for a non-jobbank.gc.ca host');
  } catch (err) {
    if (/untrusted hostname/.test(err.message)) pass('assertJobBankUrl() throws for an untrusted hostname');
    else fail(`assertJobBankUrl() threw an unexpected error: ${err.message}`);
  }
  try {
    assertJobBankUrl('http://www.jobbank.gc.ca/jobsearch/feed/jobSearchRSSfeed');
    fail('assertJobBankUrl() should throw for a non-HTTPS URL');
  } catch (err) {
    if (/must use HTTPS/.test(err.message)) pass('assertJobBankUrl() throws for a non-HTTPS URL');
    else fail(`assertJobBankUrl() threw an unexpected error: ${err.message}`);
  }
  const trustedTestUrl = buildFeedUrl('x', 1);
  if (assertJobBankUrl(trustedTestUrl) === trustedTestUrl) {
    pass('assertJobBankUrl() returns the URL unchanged when it is trusted');
  } else {
    fail('assertJobBankUrl() should return a trusted URL unchanged');
  }

  // ── fetch(): entry.max_pages is clamped to MAX_PAGES_CAP (20) ──
  {
    const fullPage = (n) => `<?xml version="1.0"?><feed>${Array.from({ length: 100 }, (_, i) => `<entry><title><![CDATA[r${n}-${i}]]></title><link rel="alternate" href="https://www.jobbank.gc.ca/jobsearch/jobposting/${n}-${i}"/><id>${n}-${i}</id><updated>2026-08-20T08:00:00Z</updated><summary><![CDATA[x]]></summary></entry>`).join('')}</feed>`;
    let requestCount = 0;
    await jobbankca.fetch(
      // Every page returns a FULL (100-entry) page, so pagination would run
      // forever without the cap — this isolates the cap as the only thing
      // that can stop it.
      { provider: 'jobbankca', name: 'Cap test', jobbankca: { keywords: ['x'] }, max_pages: 100 },
      { sleep: async () => {}, fetchText: async () => fullPage(requestCount++) },
    );
    if (requestCount === 20) {
      pass('jobbankca.fetch() clamps entry.max_pages (100) down to MAX_PAGES_CAP (20)');
    } else {
      fail(`jobbankca.fetch() made ${requestCount} requests with max_pages:100 (expected 20, the cap)`);
    }
  }
} catch (e) {
  fail(`jobbankca provider tests crashed: ${e.message}`);
}
