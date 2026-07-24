import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nUtility - company-funded');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'company-funded.mjs')).href);

  const cases = [
    ['Prime Intellect raises $130M Series A', 'Prime Intellect'],
    ['Norm raises $120M', 'Norm'],
    ['Resolve AI raises $125M Series A', 'Resolve AI'],
    ['Cascade raises $3.5M', 'Cascade'],
    ['SambaNova raises $1B', 'SambaNova'],
    ['Anysphere raises $900M in funding', 'Anysphere'],
    ['AI coding startup Cursor maker Anysphere raises Series C funding', 'Anysphere'],
    ['AI logistics startup Augment, from Deliverr founder, raises $85M Series A', 'Augment'],
    ['Mira Murati’s AI startup Thinking Machines valued at $12B in early-stage funding', 'Thinking Machines'],
    ['OpenAI in talks to raise funding that would value AI startup at up to $340B', 'OpenAI'],
    ['AI-powered travel agency Fora hits unicorn status, raises $60M', 'Fora'],
    ['Airbnb-backed WeRoad raises $58M to take its group travel platform to the US', 'WeRoad'],
    ['Insurance startup Corgi reportedly raised more money at $4B — its third round in 8 weeks', 'Corgi'],
    ['AI chip startup Etched defies skeptics, hits $10.3B valuation from big-name investors', 'Etched'],
    ['Ex-DeepMind David Silver Raises $1.1B for AI Startup Ineffable', 'Ineffable'],
    ['Travis Kalanick&#8217;s robotics company raises $1.7B, led by a16z', ''],
    ['AI startup valuations raise bubble fears as funding surges', ''],
    ["Yann LeCun's AI startup raises $1B seed round", ''],
    ['Edtech platform raises $4.5M to help teach students how to vibe code', ''],
    ['Acme closes $25M Series A round - TechCrunch', 'Acme'],
    ['Ask HN: Who is hiring?', ''],
  ];
  for (const [title, expected] of cases) {
    const got = mod.extractCompanyFromFundingTitle(title);
    if (got === expected) pass(`extractCompanyFromFundingTitle: ${title}`);
    else fail(`extractCompanyFromFundingTitle(${JSON.stringify(title)}) = ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
  }

  const details = mod.extractFundingDetails('Acme closes $25M Series A round - TechCrunch');
  if (details.amount === '$25M' && details.round === 'Series A') {
    pass('extractFundingDetails reads amount and round');
  } else {
    fail(`extractFundingDetails returned ${JSON.stringify(details)}`);
  }

  if (
    mod.matchesDomain('techcrunch.com', 'techcrunch.com') &&
    mod.matchesDomain('www.techcrunch.com', 'techcrunch.com') &&
    !mod.matchesDomain('techcrunch.com.attacker.net', 'techcrunch.com') &&
    !mod.matchesDomain('eviltechcrunch.com', 'techcrunch.com')
  ) {
    pass('matchesDomain accepts exact/subdomain hosts and rejects suffix spoofs');
  } else {
    fail('matchesDomain hostname policy regressed');
  }

  if (
    mod.sourceFromUrl('https://techcrunch.com/2026/acme') === 'techcrunch' &&
    mod.sourceFromUrl('https://techcrunch.com.attacker.net/2026/acme') === 'web' &&
    mod.sourceFromUrl('https://evil.example/path/techcrunch.com/story') === 'web'
  ) {
    pass('sourceFromUrl uses parsed hostnames, not URL substrings');
  } else {
    fail('sourceFromUrl accepted a spoofed hostname/path');
  }

  const techCrunchXml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title><![CDATA[Prime Intellect raises $130M Series A]]></title>
      <link>https://techcrunch.com/2026/07/15/prime-intellect</link>
      <pubDate>Wed, 15 Jul 2026 12:00:00 +0000</pubDate>
      <category>Startups</category>
      <description><![CDATA[Prime Intellect raises new funding for distributed AI research.]]></description>
    </item>
  </channel></rss>`;
  const prNewswireXml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title>New $120M Funding Round Announced for AI Compliance Platform</title>
      <link>https://www.prnewswire.com/news-releases/norm-funding</link>
      <pubDate>Tue, 14 Jul 2026 09:00:00 +0000</pubDate>
      <dc:contributor>Norm</dc:contributor>
      <description>Norm announced Series B financing.</description>
    </item>
  </channel></rss>`;
  const guardianXml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title>Resolve AI raises $125M Series A as agentic tools boom</title>
      <link>https://www.theguardian.com/technology/2026/jul/13/resolve-ai</link>
      <pubDate>Mon, 13 Jul 2026 08:00:00 +0000</pubDate>
      <description>Resolve AI has secured funding for its enterprise product.</description>
    </item>
  </channel></rss>`;

  const rssItems = [
    ...mod.parseRssItems(techCrunchXml, { source: 'techcrunch' }),
    ...mod.parseRssItems(prNewswireXml, { source: 'prnewswire' }),
    ...mod.parseRssItems(guardianXml, { source: 'guardian' }),
  ];
  if (rssItems.length === 3 && rssItems.every((item) => item.observedDate?.value?.startsWith('2026-07'))) {
    pass('parseRssItems reads TechCrunch, PRNewswire, and Guardian-style XML');
  } else {
    fail(`parseRssItems returned ${JSON.stringify(rssItems)}`);
  }

  const spoofedXml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title>SpoofCo raises $50M Series A</title>
      <link>https://techcrunch.com.attacker.net/spoof</link>
      <pubDate>Wed, 15 Jul 2026 12:00:00 +0000</pubDate>
      <description>SpoofCo raises funding.</description>
    </item>
  </channel></rss>`;
  const spoofedItem = mod.parseRssItems(spoofedXml, { source: 'techcrunch' })[0];
  if (spoofedItem?.source === 'techcrunch' && spoofedItem.url === '') {
    pass('parseRssItems strips spoofed evidence URLs while preserving source context');
  } else {
    fail(`spoofed RSS URL was not stripped: ${JSON.stringify(spoofedItem)}`);
  }

  const rssCandidates = mod.buildCandidates(rssItems, { now: new Date('2026-07-20T00:00:00Z'), months: 3, limit: 10 });
  const rssNames = rssCandidates.map((c) => c.company);
  if (rssNames.includes('Prime Intellect') && rssNames.includes('Norm') && rssNames.includes('Resolve AI')) {
    pass('buildCandidates turns RSS funding items into candidates, including PRNewswire contributor company');
  } else {
    fail(`buildCandidates missed RSS candidates: ${JSON.stringify(rssNames)}`);
  }

  const authorFallbackItems = [
    {
      source: 'techcrunch',
      title: 'ServiceNow bets $40 million on Indian banking software specialist to expand its financial services push',
      url: 'https://techcrunch.com/servicenow-businessnext',
      observedDate: { value: '2026-07-22', precision: 'day', date: new Date('2026-07-22T00:00:00Z') },
      text: 'Businessnext funding story.',
      categories: [],
      source_company: 'Jagmeet Singh',
    },
  ];
  const authorFallbackCandidates = mod.buildCandidates(authorFallbackItems, { now: new Date('2026-07-23T00:00:00Z'), months: 3, limit: 10 });
  if (authorFallbackCandidates.length === 0) {
    pass('buildCandidates does not treat publisher authors as company fallback outside PRNewswire');
  } else {
    fail(`author fallback accepted as company: ${JSON.stringify(authorFallbackCandidates)}`);
  }

  const negativeItems = [
    ['techcrunch', 'Alpha Ventures raises $500M fund for AI startups'],
    ['guardian', 'Acme acquires Beta after earlier funding talks'],
    ['prnewswire', 'MegaCorp announces quarterly earnings and financial results'],
    ['prnewswire', 'Foundation awards $5M scholarships and grants'],
    ['techcrunch', 'How to raise seed funding in a difficult market'],
  ].map(([source, title], idx) => ({
    source,
    title,
    url: `https://example.test/${idx}`,
    observedDate: { value: '2026-07-10', precision: 'day', date: new Date('2026-07-10T00:00:00Z') },
    text: title,
    categories: [],
  }));
  const negativeCandidates = mod.buildCandidates(negativeItems, { now: new Date('2026-07-20T00:00:00Z'), months: 3, limit: 10 });
  if (negativeCandidates.length === 0) {
    pass('buildCandidates rejects funds, acquisitions, earnings, scholarships, grants, and generic fundraising advice');
  } else {
    fail(`buildCandidates accepted negative items: ${JSON.stringify(negativeCandidates)}`);
  }

  const mixedDates = [
    ['techcrunch', 'OldCo raises $20M Series A', '2025-12-15'],
    ['techcrunch', 'Cascade raises $3.5M', '2026-05-01'],
    ['guardian', 'SambaNova raises $1B', '2026-07-18'],
    ['prnewswire', 'Prime Intellect raises $130M Series A', '2026-07-20'],
  ].map(([source, title, date]) => ({
    source,
    title,
    url: `https://example.test/${title.split(' ')[0].toLowerCase()}`,
    observedDate: { value: date, precision: 'day', date: new Date(`${date}T00:00:00Z`) },
    text: title,
    categories: [],
  }));
  const recentSorted = mod.buildCandidates(mixedDates, { now: new Date('2026-07-20T00:00:00Z'), months: 3, limit: 10 });
  const recentNames = recentSorted.map((c) => c.company);
  if (recentNames.join(',') === 'Prime Intellect,SambaNova,Cascade') {
    pass('buildCandidates defaults to newest funding date first and excludes stale items');
  } else {
    fail(`date sort/window returned ${JSON.stringify(recentNames)}`);
  }
  const extendedWindow = mod.buildCandidates(mixedDates, { now: new Date('2026-07-20T00:00:00Z'), months: 8, limit: 10 });
  if (extendedWindow.map((c) => c.company).includes('OldCo')) {
    pass('buildCandidates includes older funding only when --months allows it');
  } else {
    fail(`extended window excluded OldCo: ${JSON.stringify(extendedWindow.map((c) => c.company))}`);
  }

  const currentYearInferred = mod.buildCandidates([{
    source: 'hacker_news',
    title: 'Acme raises $25M Series A in 2026',
    url: 'https://news.ycombinator.com/item?id=77',
    observedDate: null,
    text: 'Acme raises funding.',
    categories: [],
  }], { now: new Date('2026-07-20T00:00:00Z'), months: 3, limit: 10 });
  if (currentYearInferred[0]?.company === 'Acme' && currentYearInferred[0]?.funding.sources[0]?.observed_date === '2026') {
    pass('buildCandidates keeps current-year inferred dates inside the recent window');
  } else {
    fail(`current-year inferred date was treated as stale: ${JSON.stringify(currentYearInferred)}`);
  }

  const duplicateEvidence = mod.buildCandidates([
    {
      source: 'techcrunch',
      title: 'Acme raises $25M Series A',
      url: 'https://techcrunch.com/acme',
      observedDate: { value: '2026-07-19', precision: 'day', date: new Date('2026-07-19T00:00:00Z') },
      text: 'Acme raises funding.',
      categories: [],
    },
    {
      source: 'techcrunch',
      title: 'Acme raises $25M Series A',
      url: 'https://techcrunch.com/acme',
      observedDate: { value: '2026-07-19', precision: 'day', date: new Date('2026-07-19T00:00:00Z') },
      text: 'Acme raises funding.',
      categories: [],
    },
  ], { now: new Date('2026-07-20T00:00:00Z'), months: 3, limit: 10 });
  if (duplicateEvidence[0]?.funding.sources.length === 1 && duplicateEvidence[0]?.discovery_score === 103) {
    pass('buildCandidates deduplicates repeated feed evidence without inflating score');
  } else {
    fail(`duplicate evidence handling regressed: ${JSON.stringify(duplicateEvidence)}`);
  }

  const encodedXml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title>Acme raises $25M Series A &amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;</title>
      <link>https://techcrunch.com/acme</link>
      <pubDate>Wed, 15 Jul 2026 12:00:00 +0000</pubDate>
      <description>Acme raises funding with &lt;/script &gt; text in the feed.</description>
    </item>
  </channel></rss>`;
  const encodedCandidate = mod.buildCandidates(mod.parseRssItems(encodedXml, { source: 'techcrunch' }), {
    now: new Date('2026-07-20T00:00:00Z'),
    months: 3,
    limit: 10,
  })[0];
  const encodedReport = mod.renderReport({
    generated_at: '2026-07-20',
    window_months: 3,
    sort: 'date',
    sources: ['techcrunch'],
    diagnostics: [{ source: 'techcrunch', status: 'ok', fetched_items: 1, funding_like_items: 1, candidate_count: 1, errors: [] }],
    companies: [encodedCandidate],
  });
  if (encodedReport.includes('&amp;lt;script&amp;gt;') && !encodedReport.includes('<script>') && !encodedReport.includes('</script >')) {
    pass('renderReport does not double-decode or emit executable-looking feed markup');
  } else {
    fail(`unsafe report escaping: ${encodedReport}`);
  }

  const markdownReport = mod.renderReport({
    generated_at: '2026-07-20',
    window_months: 3,
    sort: 'date',
    sources: ['techcrunch'],
    diagnostics: [{ source: 'techcrunch', status: 'ok', fetched_items: 1, funding_like_items: 1, candidate_count: 1, errors: ['bad | value \\ test [x]'] }],
    companies: [{
      company: 'Pipe | Co \\ [x]',
      amount: '$25M',
      round: 'Series A',
      funding: {
        status: 'recent_funding',
        confidence: 'high',
        sources: [{ source: 'techcrunch', title: 'Pipe | Co \\ [x] raises $25M', url: 'https://techcrunch.com/path', observed_date: '2026-07-20' }],
      },
      discovery_score: 1,
      suggested_action: 'review_company_manually',
    }],
  });
  if (markdownReport.includes('Pipe \\| Co \\\\ \\[x\\]') && markdownReport.includes('bad \\| value \\\\ test \\[x\\]')) {
    pass('renderReport escapes Markdown table/control characters');
  } else {
    fail(`Markdown escaping regressed: ${markdownReport}`);
  }

  const originalFetch = globalThis.fetch;
  const seenFetchOptions = [];
  globalThis.fetch = async (url, options) => {
    seenFetchOptions.push({ url, options });
    if (seenFetchOptions.length === 1) {
      const redirect = new Response('', {
        status: 302,
        headers: { location: 'https://techcrunch.com/final-feed/' },
      });
      Object.defineProperty(redirect, 'url', { value: String(url) });
      return redirect;
    }
    const res = new Response(`<?xml version="1.0"?><rss><channel>
        <item>
          <title>Acme raises $25M Series A</title>
          <link>https://techcrunch.com/acme</link>
          <pubDate>Wed, 15 Jul 2026 12:00:00 +0000</pubDate>
          <description>Acme raises funding.</description>
        </item>
      </channel></rss>`, {
      status: 200,
      headers: { 'content-type': 'application/rss+xml' },
    });
    Object.defineProperty(res, 'url', { value: String(url).replace('/feed/', '/final-feed/') });
    return res;
  };
  try {
    const result = await mod.discoverFundedCompanies({
      dryRun: true,
      sources: ['techcrunch'],
      months: 3,
      limit: 5,
    });
    if (
      result.companies[0]?.company === 'Acme' &&
      seenFetchOptions.every((call) => call.options?.redirect === 'manual') &&
      String(seenFetchOptions[0]?.url) === 'https://techcrunch.com/feed/' &&
      seenFetchOptions.some((call) => String(call.url) === 'https://techcrunch.com/final-feed/')
    ) {
      pass('discoverFundedCompanies follows structured-source redirects after validating each hop');
    } else {
      fail(`structured fetch behavior wrong: ${JSON.stringify({ result, seenFetchOptions })}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async (url, options) => {
    const res = new Response('', {
      status: 302,
      headers: { location: 'https://techcrunch.com.attacker.net/feed/' },
    });
    Object.defineProperty(res, 'url', { value: String(url) });
    return res;
  };
  try {
    const result = await mod.discoverFundedCompanies({
      dryRun: true,
      sources: ['techcrunch'],
      months: 3,
      limit: 5,
    });
    const diag = result.diagnostics.find((d) => d.source === 'techcrunch');
    if (diag?.status === 'error' && diag.errors.some((err) => err.includes('untrusted final source URL')) && result.companies.length === 0) {
      pass('discoverFundedCompanies rejects redirects to untrusted final source hosts');
    } else {
      fail(`untrusted final redirect was accepted: ${JSON.stringify(result)}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  const internalRedirectUrls = [];
  globalThis.fetch = async (url, options) => {
    internalRedirectUrls.push(String(url));
    const res = new Response('', {
      status: 302,
      headers: { location: 'https://127.0.0.1/feed/' },
    });
    Object.defineProperty(res, 'url', { value: String(url) });
    return res;
  };
  try {
    const result = await mod.discoverFundedCompanies({
      dryRun: true,
      sources: ['techcrunch'],
      months: 3,
      limit: 5,
    });
    const diag = result.diagnostics.find((d) => d.source === 'techcrunch');
    if (
      diag?.status === 'error' &&
      diag.errors.some((err) => err.includes('internal redirect target rejected')) &&
      result.companies.length === 0 &&
      !internalRedirectUrls.includes('https://127.0.0.1/feed/')
    ) {
      pass('discoverFundedCompanies rejects redirects to internal targets before following');
    } else {
      fail(`internal redirect was accepted: ${JSON.stringify({ result, internalRedirectUrls })}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  const recentAcme = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const recentBeta = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  globalThis.fetch = async (url, options) => {
    const res = new Response(JSON.stringify({
      hits: [
        {
          title: 'Acme raises $25M Series A',
          url: '',
          objectID: '123',
          created_at: recentAcme,
          story_text: 'Acme raises funding.',
        },
        {
          title: 'Beta raises $30M Series B',
          url: 'https://techcrunch.com/beta',
          objectID: '124',
          created_at: recentBeta,
          story_text: 'Beta raises funding.',
        },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    Object.defineProperty(res, 'url', { value: String(url) });
    return res;
  };
  try {
    const result = await mod.discoverFundedCompanies({
      dryRun: true,
      sources: ['hn'],
      months: 3,
      limit: 5,
    });
    const acme = result.companies.find((c) => c.company === 'Acme');
    const beta = result.companies.find((c) => c.company === 'Beta');
    const acmeEvidence = acme?.funding.sources[0];
    const betaEvidence = beta?.funding.sources[0];
    const diag = result.diagnostics.find((d) => d.source === 'hn');
    if (
      acmeEvidence?.source === 'hacker_news' &&
      acmeEvidence?.url === 'https://news.ycombinator.com/item?id=123' &&
      betaEvidence?.source === 'hacker_news' &&
      betaEvidence?.url === 'https://techcrunch.com/beta' &&
      diag?.candidate_count === 2
    ) {
      pass('discoverFundedCompanies handles Hacker News JSON with fallback and direct article URLs');
    } else {
      fail(`Hacker News discovery path regressed: ${JSON.stringify(result)}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () => new Response('<html><title>Access denied</title><body>Verify you are human</body></html>', {
    status: 403,
    headers: { 'content-type': 'text/html' },
  });
  try {
    const result = await mod.discoverFundedCompanies({
      dryRun: true,
      sources: ['techcrunch'],
      months: 3,
      limit: 5,
    });
    const diag = result.diagnostics.find((d) => d.source === 'techcrunch');
    if (diag?.status === 'blocked' && diag.blocked && diag.errors.length > 0 && result.companies.length === 0) {
      pass('discoverFundedCompanies reports blocked/challenge pages in diagnostics');
    } else {
      fail(`blocked diagnostics missing: ${JSON.stringify(result)}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
} catch (err) {
  fail(`company-funded test crashed: ${err.stack || err.message}`);
}
