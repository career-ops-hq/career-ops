// tests/providers/jobindex.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — jobindex');

// One page of the feed, in the shape measured on 2026-11-23 (names fictional).
// The card HTML is entity-escaped inside <description>, as in the real feed.
function card({ paid = true, href, title, area, alt }) {
  const html = paid
    ? `<div class="jobsearch-result"><div class="PaidJob"><div class="PaidJob-inner">`
      + (alt ? `<A HREF="${href}"><img src="https://www.jobindex.dk/img/logo/x.jpg" ALIGN="right" ALT="${alt}"></a>` : '')
      + `<h4><A HREF="${href}" rel="noopener" target="_blank">${title}</a></h4>`
      + `<div class="jobad-element-area"><span class="jix_robotjob--area">${area}</span></div>`
      + `<p>Short teaser.</p></div></div></div>`
    : `<div class="jobsearch-result"><div class="jix_robotjob" data-jobad-tid="r1"><div class="jix_robotjob-inner">`
      + `<h4><A HREF="${href}" rel="noopener" target="_blank">\n    ${title}\n</a></h4>`
      + `<div class="jobad-element-area"><span class="jix_robotjob--area">${area}</span></div>`
      + `<p>Short teaser.</p></div></div></div>`;
  return html.replace(/&/g, '&#x26;').replace(/</g, '&#x3C;').replace(/>/g, '&#x3E;').replace(/"/g, '&#x22;');
}

function item({ title, link, pubDate = 'Mon, 23 Nov 2026 00:00:00 +0100', description = '' }) {
  return `<item>\n<title>${title}</title>\n<link>${link}</link>\n<description>\n${description}\n</description>\n`
    + `<guid>${link}</guid>\n<pubDate>${pubDate}</pubDate>\n</item>\n`;
}

function feed(items) {
  return `<?xml version="1.0" encoding="ISO-8859-1"?>\n<rss version="2.0">\n<channel>\n`
    + `<title>Jobindex - Ledige job</title>\n<link>https://www.jobindex.dk/jobsoegning?q=x</link>\n<language>da</language>\n`
    + `${items.join('')}</channel>\n</rss>\n`;
}

/** n distinct own-ad items, for pagination tests. */
function page(n, offset = 0) {
  const items = [];
  for (let i = 0; i < n; i++) {
    const id = offset + i;
    const link = `https://www.jobindex.dk/vis-job/r${id}`;
    items.push(item({ title: `Engineer ${id}, Acme`, link, description: card({ href: link, title: `Engineer ${id}`, area: 'Aarhus', alt: 'Acme' }) }));
  }
  return feed(items);
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/jobindex.mjs')).href);
  const jobindex = mod.default;
  const { parseJobindexFeed, buildFeedUrl } = mod;

  if (jobindex.id === 'jobindex') pass('jobindex.id is "jobindex"');
  else fail(`jobindex.id is ${JSON.stringify(jobindex.id)}`);

  // ── detect ──
  const hit = jobindex.detect({ careers_url: 'https://www.jobindex.dk/jobsoegning?q=python' });
  if (hit && hit.url === 'https://www.jobindex.dk/jobsoegning?q=python') pass('detect() claims a Jobindex search URL');
  else fail(`detect() returned ${JSON.stringify(hit)}`);
  if (jobindex.detect({ careers_url: 'https://jobindex.dk/' })) pass('detect() claims the bare jobindex.dk host');
  else fail('detect() should claim https://jobindex.dk/');
  try {
    const whole = buildFeedUrl('https://jobindex.dk/', 1);
    if (whole === 'https://www.jobindex.dk/jobsoegning.rss') pass('buildFeedUrl reads the bare host as the whole board, so a detected root URL scans');
    else fail(`buildFeedUrl bare host returned ${whole}`);
  } catch (err) {
    fail(`buildFeedUrl bare host threw: ${err.message}`);
  }
  const junk = [
    { careers_url: 'http://www.jobindex.dk/jobsoegning' },
    { careers_url: 'https://www.jobindex.dk.example.com/jobsoegning' },
    { careers_url: 'https://evil-jobindex.dk/jobsoegning' },
    { careers_url: 'not a url' },
    { careers_url: 42 },
    { careers_url: null },
    {},
    null,
  ];
  let detectOk = true;
  for (const e of junk) {
    try {
      if (jobindex.detect(e) !== null) detectOk = false;
    } catch {
      detectOk = false;
    }
  }
  if (detectOk) pass('detect() returns null without throwing on http, untrusted hosts, junk and missing URLs');
  else fail('detect() claimed or threw on a junk entry');

  // ── buildFeedUrl ──
  const u1 = new URL(buildFeedUrl('https://www.jobindex.dk/jobsoegning?q=python&geoareaid=15182&page=7', 1));
  if (u1.origin + u1.pathname === 'https://www.jobindex.dk/jobsoegning.rss'
    && u1.searchParams.get('q') === 'python' && u1.searchParams.get('geoareaid') === '15182' && !u1.searchParams.has('page')) {
    pass('buildFeedUrl keeps the search query, drops page, and targets the RSS twin');
  } else {
    fail(`buildFeedUrl page 1 returned ${u1.href}`);
  }
  if (new URL(buildFeedUrl('https://jobindex.dk/jobsoegning.rss?q=a', 3)).searchParams.get('page') === '3') pass('buildFeedUrl sets page for pages after the first');
  else fail('buildFeedUrl should set page=3');
  try {
    buildFeedUrl('https://www.jobindex.dk/jobsoegning/it/storkoebenhavn?q=python', 1);
    fail('buildFeedUrl should refuse a path-style search URL');
  } catch (err) {
    if (/has no RSS feed/.test(err.message)) pass('buildFeedUrl refuses a path-style search URL with a usable message');
    else fail(`buildFeedUrl path-style error: ${err.message}`);
  }

  // ── parseJobindexFeed ──
  const sample = feed([
    item({
      title: 'Senior R&#x26;D Engineer &#x2013; Data &#x26; Risk, ExampleCo, Example Group A/S',
      link: 'https://www.jobindex.dk/vis-job/h100',
      description: card({ href: 'https://www.jobindex.dk/vis-job/h100', title: 'Senior R&amp;D Engineer &ndash; Data &amp; Risk', area: 'K&oslash;benhavn K', alt: 'Example Brand' }),
    }),
    item({
      title: 'AI-udvikler /&#x200B; AI Engineer, Acme',
      link: 'https://www.jobindex.dk/vis-job/h101',
      description: card({ href: 'https://www.jobindex.dk/vis-job/h101', title: 'AI-udvikler /&#x200B; AI Engineer', area: 'Aarhus N', alt: 'Acme' }),
    }),
    item({
      title: 'Postdoc in Example Studies',
      link: 'https://www.jobindex.dk/vis-job/h102',
      pubDate: 'not a date',
      description: card({ href: 'https://www.jobindex.dk/vis-job/h102', title: 'Postdoc in Example Studies', area: 'Odense', alt: 'Example University' }),
    }),
    item({
      title: 'No Employer Named',
      link: 'https://www.jobindex.dk/vis-job/h105',
      description: card({ href: 'https://www.jobindex.dk/vis-job/h105', title: 'No Employer Named', area: 'Odense' }),
    }),
    item({
      title: 'Collected Role, ExampleCo',
      link: 'https://www.jobindex.dk/vis-job/r104',
      description: card({ paid: false, href: 'https://www.jobindex.dk/vis-job/r104', title: 'Collected Role', area: 'Odense' }),
    }),
    item({
      title: 'Data Analyst',
      link: 'https://www.jobindex.dk/vis-job/h103',
      description: card({ href: 'https://www.jobindex.dk/vis-job/h103', title: 'Data Analyst', area: 'Aalborg', alt: 'BigCo' }),
    }),
    item({ title: 'No link, Acme', link: '', description: card({ href: '', title: 'No link', area: 'x' }) }),
    item({ title: 'Off-host, Acme', link: 'https://evil.example.com/vis-job/h9', description: card({ href: '', title: 'Off-host', area: 'x' }) }),
  ]);
  const { jobs, rawCount, collected, noEmployer, unrecognised } = parseJobindexFeed(sample);
  if (rawCount === 8 && jobs.length === 4 && unrecognised === 2 && noEmployer === 1 && !jobs.some((j) => j.url.endsWith('/h105'))) {
    pass('parseJobindexFeed drops rows with no link or an off-host link as unrecognised, and a placed ad with no employer as noEmployer');
  } else {
    fail(`parseJobindexFeed returned ${jobs.length} of ${rawCount}, unrecognised=${unrecognised}, noEmployer=${noEmployer}`);
  }
  if (collected === 1 && !jobs.some((j) => j.url.endsWith('/r104'))) pass('parseJobindexFeed leaves out postings Jobindex collected from elsewhere, and counts them');
  else fail(`parseJobindexFeed collected=${collected}, urls=${jobs.map((j) => j.url).join(' ')}`);
  const [a, b, c, d] = jobs;
  if (a.title === 'Senior R&D Engineer – Data & Risk' && a.company === 'ExampleCo, Example Group A/S' && a.location === 'København K') {
    pass('parseJobindexFeed decodes the card title before use and takes the employer from the feed title, commas included');
  } else {
    fail(`parseJobindexFeed first row: ${JSON.stringify(a)}`);
  }
  if (b.title === 'AI-udvikler / AI Engineer' && b.company === 'Acme') pass('parseJobindexFeed drops zero-width spaces');
  else fail(`parseJobindexFeed second row: ${JSON.stringify(b)}`);
  if (c.company === 'Example University' && c.location === 'Odense' && c.title === 'Postdoc in Example Studies' && !('postedAt' in c)) {
    pass('parseJobindexFeed takes the employer from the logo ALT when the title has none, and skips an unparseable date');
  } else {
    fail(`parseJobindexFeed third row: ${JSON.stringify(c)}`);
  }
  if (d.company === 'BigCo') pass('parseJobindexFeed falls back to the logo ALT for the employer');
  else fail(`parseJobindexFeed fourth row: ${JSON.stringify(d)}`);
  if (a.postedAt === Date.parse('Mon, 23 Nov 2026 00:00:00 +0100') && !('description' in a)) {
    pass('parseJobindexFeed sets postedAt and does not pass the teaser off as a description');
  } else {
    fail(`parseJobindexFeed postedAt/description: ${JSON.stringify(a)}`);
  }

  // Empty vs broken.
  const empty = parseJobindexFeed(feed([]));
  if (empty.jobs.length === 0 && empty.rawCount === 0) pass('parseJobindexFeed returns no jobs for an empty channel');
  else fail('parseJobindexFeed should accept an empty channel');
  for (const [label, body] of [['an HTML page', '<html><body>Fejl</body></html>'], ['an empty body', ''], ['JSON', '{"jobs":[]}']]) {
    try {
      parseJobindexFeed(body);
      fail(`parseJobindexFeed should throw on ${label}`);
    } catch (err) {
      if (/expected an RSS <channel>/.test(err.message)) pass(`parseJobindexFeed throws on ${label}`);
      else fail(`parseJobindexFeed ${label}: ${err.message}`);
    }
  }
  try {
    parseJobindexFeed(feed([item({ title: 'x', link: 'https://evil.example.com/a' })]));
    fail('parseJobindexFeed should throw when items exist but none parses');
  } catch (err) {
    if (/none recognised/.test(err.message)) pass('parseJobindexFeed throws when items exist but none parses');
    else fail(`parseJobindexFeed none-parsed: ${err.message}`);
  }

  const onlyCollected = parseJobindexFeed(feed([item({
    title: 'Collected Role, ExampleCo',
    link: 'https://www.jobindex.dk/vis-job/r105',
    description: card({ paid: false, href: 'https://www.jobindex.dk/vis-job/r105', title: 'Collected Role', area: 'Vejle' }),
  })]));
  if (onlyCollected.jobs.length === 0 && onlyCollected.collected === 1) pass('parseJobindexFeed returns no jobs, without throwing, for a page of collected postings only');
  else fail(`parseJobindexFeed only-collected: ${JSON.stringify(onlyCollected)}`);

  {
    let onlyNoEmployer;
    try {
      onlyNoEmployer = parseJobindexFeed(feed([item({
        title: 'No Employer Named',
        link: 'https://www.jobindex.dk/vis-job/h106',
        description: card({ href: 'https://www.jobindex.dk/vis-job/h106', title: 'No Employer Named', area: 'Vejle' }),
      })]));
    } catch (err) {
      onlyNoEmployer = { error: err.message };
    }
    if (onlyNoEmployer.jobs?.length === 0 && onlyNoEmployer.noEmployer === 1 && onlyNoEmployer.unrecognised === 0) {
      pass('parseJobindexFeed returns no jobs, without throwing, for a page whose only item is a placed ad with no employer');
    } else {
      fail(`parseJobindexFeed only-no-employer: ${JSON.stringify(onlyNoEmployer)}`);
    }
  }

  {
    const mixed = feed([
      item({ title: 'Own, Acme', link: 'https://www.jobindex.dk/vis-job/h1', description: card({ href: 'https://www.jobindex.dk/vis-job/h1', title: 'Own', area: 'Aarhus', alt: 'Acme' }) }),
      item({ title: 'Collected, BigCo', link: 'https://www.jobindex.dk/vis-job/r2', description: card({ paid: false, href: 'https://www.jobindex.dk/vis-job/r2', title: 'Collected', area: 'Aarhus' }) }),
    ]);
    const out = await jobindex.fetch({ name: 'mixed', careers_url: 'https://www.jobindex.dk/jobsoegning?q=x' }, { sleep: async () => {}, fetchText: async () => mixed });
    if (out.length === 1 && out.providerStats?.dropped?.collected === 1 && !Object.keys(out).includes('providerStats')) {
      pass('fetch() reports collected postings in a non-enumerable providerStats');
    } else {
      fail(`fetch() providerStats: ${out.length} jobs, ${JSON.stringify(out.providerStats)}`);
    }
  }

  // A page cut short must not read as a shorter, complete page: the walk
  // stops on a short page, so a cut page would end it early without a sign.
  {
    const whole = page(3);
    for (const [label, body] of [
      ['a page with no </channel>', whole.slice(0, whole.indexOf('</channel>'))],
      ['a page cut inside an item', whole.slice(0, whole.lastIndexOf('</item>')) + '</channel>\n</rss>\n'],
    ]) {
      try {
        const out = parseJobindexFeed(body);
        fail(`parseJobindexFeed should throw on ${label}, got ${out.jobs.length} job(s)`);
      } catch (err) {
        if (/expected an RSS <channel>|malformed or cut short/.test(err.message)) pass(`parseJobindexFeed throws on ${label}`);
        else fail(`parseJobindexFeed ${label}: ${err.message}`);
      }
    }
  }

  // <item> inside a comment or CDATA is text, not an item.
  try {
    const link = 'https://www.jobindex.dk/vis-job/h7';
    const body = feed([
      '<!-- <item> -->\n',
      item({ title: 'XML Developer, Acme', link, description: card({ href: link, title: 'XML Developer', area: 'Odense', alt: 'Acme' }) })
        .replace('<title>XML Developer, Acme</title>', '<title><![CDATA[XML Developer, Acme]]></title><category><![CDATA[<item>]]></category>'),
    ]);
    const out = parseJobindexFeed(body);
    if (out.rawCount === 1 && out.jobs.length === 1 && out.jobs[0].title === 'XML Developer') pass('parseJobindexFeed does not count <item> inside a comment or CDATA');
    else fail(`parseJobindexFeed masked items: ${JSON.stringify(out)}`);
  } catch (err) {
    fail(`parseJobindexFeed masked items threw: ${err.message}`);
  }

  // Items it cannot read are counted, never dropped without a trace.
  {
    const other = '<div class="SomethingNew">x</div>'.replace(/</g, '&#x3C;').replace(/>/g, '&#x3E;').replace(/"/g, '&#x22;');
    const body = feed([
      item({ title: 'Own, Acme', link: 'https://www.jobindex.dk/vis-job/h1', description: card({ href: 'https://www.jobindex.dk/vis-job/h1', title: 'Own', area: 'Aarhus', alt: 'Acme' }) }),
      item({ title: 'New kind', link: 'https://www.jobindex.dk/vis-job/h2', description: other }),
      item({ title: 'Off site, Acme', link: 'https://evil.example.com/h3', description: card({ href: 'https://evil.example.com/h3', title: 'Off site', area: 'Aarhus', alt: 'Acme' }) }),
    ]);
    const parsed = parseJobindexFeed(body);
    const out = await jobindex.fetch({ name: 'unknown', careers_url: 'https://www.jobindex.dk/jobsoegning?q=x' }, { sleep: async () => {}, fetchText: async () => body });
    if (parsed.jobs.length === 1 && parsed.unrecognised === 2 && out.length === 1 && out.providerStats?.dropped?.unrecognised === 2) {
      pass('parseJobindexFeed and fetch() count another card kind and a placed ad without a Jobindex link as unrecognised');
    } else {
      fail(`unrecognised: parsed ${JSON.stringify(parsed)}, stats ${JSON.stringify(out.providerStats)}`);
    }
  }

  // ── fetch ──
  const entry = { name: 'Jobindex test', careers_url: 'https://www.jobindex.dk/jobsoegning?q=python' };
  const noSleep = async () => {};

  {
    const calls = [];
    const pages = [page(20, 0), page(20, 20), page(5, 40)];
    const out = await jobindex.fetch(entry, {
      sleep: noSleep,
      fetchText: async (url, opts) => { calls.push({ url, opts }); return pages[calls.length - 1]; },
    });
    if (out.length === 45 && calls.length === 3 && out.truncated === undefined) pass('fetch() walks pages until a short page and marks nothing');
    else fail(`fetch() walk: ${out.length} jobs, ${calls.length} calls, truncated=${JSON.stringify(out.truncated)}`);
    if (calls.every((c) => c.opts && c.opts.redirect === 'error')) pass('fetch() passes redirect: "error" on every request');
    else fail('fetch() must pass redirect: "error" on every request');
    if (new URL(calls[2].url).searchParams.get('page') === '3' && new URL(calls[0].url).searchParams.get('q') === 'python') {
      pass('fetch() requests the RSS twin with the search query and page numbers');
    } else {
      fail(`fetch() URLs: ${calls.map((c) => c.url).join(' ')}`);
    }
  }

  {
    let n = 0;
    const out = await jobindex.fetch(entry, { sleep: noSleep, fetchText: async () => page(20, 20 * n++) });
    if (n === 25 && out.length === 500 && out.truncated?.reason === 'page-cap') pass('fetch() stops at its own DEFAULT_MAX_PAGES and marks the board page-cap');
    else fail(`fetch() cap: ${n} calls, ${out.length} jobs, truncated=${JSON.stringify(out.truncated)}`);
  }

  {
    let n = 0;
    const out = await jobindex.fetch({ ...entry, max_pages: 2 }, { sleep: noSleep, fetchText: async () => page(20, 20 * n++) });
    if (n === 2 && out.truncated?.reason === 'page-cap') pass('fetch() honours entry.max_pages');
    else fail(`fetch() max_pages: ${n} calls`);
  }

  {
    let n = 0;
    const out = await jobindex.fetch(entry, { maxPages: 1, sleep: noSleep, fetchText: async () => { n++; return page(20); } });
    if (n === 1 && out.length === 20 && out.truncated === undefined) pass('fetch() makes exactly one list request under ctx.maxPages: 1 and marks nothing');
    else fail(`fetch() probe: ${n} calls, truncated=${JSON.stringify(out.truncated)}`);
  }

  {
    // A broken later page is handled like a failed one: the pages already
    // read are kept and the board is marked partial.
    let n = 0;
    const broken = page(20, 20).replace(/<\/channel>[\s\S]*$/, '');
    const out = await jobindex.fetch(entry, { sleep: noSleep, fetchText: async () => (++n === 1 ? page(20) : broken) });
    if (n === 2 && out.length === 20 && out.truncated?.reason === 'fetch-error') pass('fetch() keeps the pages read before a broken page and marks the board fetch-error');
    else fail(`fetch() broken later page: n=${n}, ${out.length} jobs, truncated=${JSON.stringify(out.truncated)}`);
  }
  try {
    await jobindex.fetch(entry, { sleep: noSleep, fetchText: async () => '<html>Fejl</html>' });
    fail('fetch() should throw when the first page is broken');
  } catch (err) {
    if (/expected an RSS <channel>/.test(err.message)) pass('fetch() throws when the first page is broken');
    else fail(`fetch() broken first page: ${err.message}`);
  }
  {
    class FakeSentinel extends Error {}
    const sentinel = Object.assign(new FakeSentinel('budget'), { status: 404 }); // not retryable
    let n = 0;
    try {
      await jobindex.fetch(entry, {
        maxPages: 2,
        sleep: noSleep,
        fetchText: async () => { n++; if (n === 2) throw sentinel; return page(20); },
      });
      fail('fetch() should propagate a page error while probing');
    } catch (err) {
      if (err === sentinel) pass('fetch() propagates a ctx.fetchText rejection unwrapped while probing');
      else fail(`fetch() probe error was rewrapped: ${err && err.message}`);
    }
  }

  {
    let n = 0;
    const notFound = Object.assign(new Error('HTTP 404'), { status: 404 });
    const out = await jobindex.fetch(entry, {
      sleep: noSleep,
      fetchText: async () => { n++; if (n === 2) throw notFound; return page(20); },
    });
    if (out.length === 20 && out.truncated?.reason === 'fetch-error') pass('fetch() keeps page 1 and marks fetch-error when a later page fails, without the max_pages advice');
    else fail(`fetch() later-page failure: ${out.length} jobs, truncated=${JSON.stringify(out.truncated)}`);
  }

  {
    const notFound = Object.assign(new Error('HTTP 404'), { status: 404 });
    try {
      await jobindex.fetch(entry, { sleep: noSleep, fetchText: async () => { throw notFound; } });
      fail('fetch() should throw when the first page fails');
    } catch (err) {
      if (err === notFound) pass('fetch() throws when the first page fails');
      else fail(`fetch() first-page failure: ${err && err.message}`);
    }
  }

  for (const careers_url of ['https://evil.example.com/jobsoegning?q=x', 'https://www.jobindex.dk/jobsoegning/it?q=x', undefined]) {
    let n = 0;
    try {
      await jobindex.fetch({ name: 'bad', careers_url }, { sleep: noSleep, fetchText: async () => { n++; return page(1); } });
      fail(`fetch() should refuse careers_url ${careers_url}`);
    } catch {
      if (n === 0) pass(`fetch() refuses careers_url ${careers_url} before any request`);
      else fail(`fetch() made ${n} request(s) before refusing ${careers_url}`);
    }
  }
} catch (err) {
  fail(`jobindex tests crashed: ${err && err.stack}`);
}
