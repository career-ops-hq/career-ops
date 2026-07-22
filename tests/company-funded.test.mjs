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
    ['Ex-DeepMind David Silver Raises $1.1B for AI Startup Ineffable', 'Ineffable'],
    ['Travis Kalanick&#8217;s robotics company raises $1.7B, led by a16z', ''],
    ['AI startup valuations raise bubble fears as funding surges', ''],
    ["Yann LeCun's AI startup raises $1B seed round", ''],
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

  const rssCandidates = mod.buildCandidates(rssItems, { now: new Date('2026-07-20T00:00:00Z'), months: 3, limit: 10 });
  const rssNames = rssCandidates.map((c) => c.company);
  if (rssNames.includes('Prime Intellect') && rssNames.includes('Norm') && rssNames.includes('Resolve AI')) {
    pass('buildCandidates turns RSS funding items into candidates, including PRNewswire contributor company');
  } else {
    fail(`buildCandidates missed RSS candidates: ${JSON.stringify(rssNames)}`);
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

  const enrichmentItems = [
    {
      source: 'techcrunch',
      title: 'Acme raises $25M Series A',
      url: 'https://techcrunch.com/acme',
      observedDate: { value: '2026-07-19', precision: 'day', date: new Date('2026-07-19T00:00:00Z') },
      text: 'Acme raises $25M Series A funding.',
      categories: [],
    },
  ];
  const enrichedDefault = await mod.discoverFundedCompanies({
    discoveryItems: enrichmentItems,
    sources: ['techcrunch'],
    months: 3,
    limit: 5,
    portalsPath: '.tmp-missing-portals.yml',
    enrichCandidateFn: async (candidate) => ({
      ...candidate,
      website: 'https://acme.ai',
      careers_url: 'https://jobs.acme.ai',
      scanner_path: 'provider:greenhouse',
      provider: 'greenhouse',
      enrichment_status: 'found',
      enrichment_error: '',
      portals_entry: {
        name: 'Acme',
        careers_url: 'https://jobs.acme.ai',
        enabled: true,
        provider: 'greenhouse',
      },
      portals_entry_yaml: '- name: Acme\n  careers_url: https://jobs.acme.ai\n  enabled: true\n  provider: greenhouse',
      suggested_action: 'review_portals_entry',
    }),
  });
  if (enrichedDefault.companies[0]?.enrichment_status === 'found' && enrichedDefault.companies[0]?.careers_url === 'https://jobs.acme.ai') {
    pass('discoverFundedCompanies enriches careers/scanner by default');
  } else {
    fail(`default enrichment missing: ${JSON.stringify(enrichedDefault.companies[0])}`);
  }

  const skippedEnrichment = await mod.discoverFundedCompanies({
    discoveryItems: enrichmentItems,
    sources: ['techcrunch'],
    months: 3,
    limit: 5,
    enrich: false,
    portalsPath: '.tmp-missing-portals.yml',
  });
  if (skippedEnrichment.companies[0]?.enrichment_status === 'skipped' && skippedEnrichment.companies[0]?.scanner_path === '') {
    pass('discoverFundedCompanies marks --no-enrich output as skipped, not not_found');
  } else {
    fail(`--no-enrich status wrong: ${JSON.stringify(skippedEnrichment.companies[0])}`);
  }

  const failingEnrichment = await mod.enrichCandidates(
    [{ company: 'FailCo', funding: { sources: [] }, discovery_score: 1 }],
    { enrichCandidateFn: async () => { throw new Error('resolver exploded'); }, timeoutMs: 100 },
  );
  if (failingEnrichment[0]?.enrichment_status === 'error' && failingEnrichment[0]?.scanner_path === 'resolution_failed') {
    pass('enrichCandidates converts resolver errors into candidate diagnostics');
  } else {
    fail(`enrichCandidates error handling failed: ${JSON.stringify(failingEnrichment)}`);
  }

  const timeoutEnrichment = await mod.enrichCandidates(
    [{ company: 'SlowCo', funding: { sources: [] }, discovery_score: 1 }],
    { enrichCandidateFn: async () => new Promise(() => {}), timeoutMs: 10 },
  );
  if (timeoutEnrichment[0]?.enrichment_status === 'timeout' && timeoutEnrichment[0]?.scanner_path === 'resolution_timeout') {
    pass('enrichCandidates converts resolver timeouts into candidate diagnostics');
  } else {
    fail(`enrichCandidates timeout handling failed: ${JSON.stringify(timeoutEnrichment)}`);
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html><title>Access denied</title><body>Verify you are human</body></html>', {
    status: 403,
    headers: { 'content-type': 'text/html' },
  });
  try {
    const result = await mod.discoverFundedCompanies({
      dryRun: true,
      enrich: false,
      sources: ['duckduckgo'],
      months: 3,
      limit: 5,
      queries: ['agentic AI Series A funding'],
      portalsPath: '.tmp-missing-portals.yml',
    });
    const diag = result.diagnostics.find((d) => d.source === 'duckduckgo');
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
