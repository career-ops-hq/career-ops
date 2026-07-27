// tests/providers/gem.test.mjs — direct provider-contract tests.
// Covers the id/detect/fetch contract scan.mjs calls: careers_url detection,
// the JobBoardList → ExternalJobPostingQuery two-call shape (list, then a
// SINGLE batched detail POST for postedAt), extId-based URL construction,
// location folding (name + Remote), postedAt conversion from
// firstPublishedTsSec (unix seconds, not ms), and graceful degradation when
// the detail batch fails or returns malformed data.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — gem');

try {
  const gemModule = await import(pathToFileURL(join(ROOT, 'providers/gem.mjs')).href);
  const gem = gemModule.default;

  if (gem.id === 'gem') pass('gem.id is "gem"');
  else fail(`gem.id is ${JSON.stringify(gem.id)}`);

  // detect() — positive / negative cases.
  const hit = gem.detect({ name: 'Retool', careers_url: 'https://jobs.gem.com/retool' });
  if (hit && hit.url === 'https://jobs.gem.com/api/public/graphql/batch?board=retool') {
    pass('gem.detect() resolves jobs.gem.com/<boardId> to a hit (exact URL, not substring)');
  } else {
    fail(`gem.detect() returned ${JSON.stringify(hit)}`);
  }

  if (gem.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('gem.detect() returns null for a non-gem careers_url');
  } else {
    fail('gem.detect() should return null for non-gem URLs');
  }

  if (gem.detect({ name: 'X' }) === null
      && gem.detect({ name: 'X', careers_url: null }) === null
      && gem.detect({ name: 'X', careers_url: 42 }) === null) {
    pass('gem.detect() returns null for missing / null / non-string careers_url');
  } else {
    fail('gem.detect() should return null when careers_url is absent or non-string');
  }

  // js/incomplete-url-substring-sanitization — a raw regex/substring match
  // against the whole URL string would wrongly claim these. resolveBoardId
  // must parse the URL and compare parsed.hostname exactly.
  if (gem.detect({ name: 'Path spoof', careers_url: 'https://evil.example/jobs.gem.com/retool' }) === null
      && gem.detect({ name: 'Query spoof', careers_url: 'https://evil.example/careers?x=jobs.gem.com/retool' }) === null
      && gem.detect({ name: 'Suffix spoof', careers_url: 'https://jobs.gem.com.evil.example/retool' }) === null) {
    pass('gem.detect() rejects path-, query-, and suffix-spoofed hosts');
  } else {
    fail('gem.detect() must reject path/query/suffix-spoofed hosts');
  }

  // fetch() — request shape and normalization from the real API shape:
  // call 1 = JobBoardList (listing), call 2 = a single batched POST with one
  // ExternalJobPostingQuery operation per extId (postedAt enrichment).
  const listResponse = [{
    data: {
      oatsExternalJobPostings: {
        jobPostings: [
          {
            id: 'T2F0c0pvYlBvc3Q6MQ==',
            extId: '1001',
            title: 'AI Engineer',
            locations: [
              { name: 'San Francisco', isRemote: false },
              { isRemote: true },
            ],
            job: { department: { name: 'Engineering' }, locationType: 'HYBRID', employmentType: 'FULL_TIME' },
          },
          {
            // sparse posting: no locations, no title → filtered out by extId+title guard? title empty still kept if extId present
            id: 'T2F0c0pvYlBvc3Q6Mg==',
            extId: '',
            title: 'Should be dropped (no extId)',
          },
        ],
      },
    },
  }];
  const detailResponse = [
    {
      data: {
        oatsExternalJobPosting: {
          extId: '1001',
          firstPublishedTsSec: 1700000000,
          descriptionHtml: '<p>Build &amp; ship <strong>AI</strong> tools.</p><ul><li>Own the roadmap</li></ul>',
        },
      },
    },
  ];

  const calls = [];
  const fetched = await gem.fetch(
    { name: 'Retool', careers_url: 'https://jobs.gem.com/retool' },
    {
      fetchJson: async (url, opts) => {
        calls.push({ url, opts });
        return calls.length === 1 ? listResponse : detailResponse;
      },
    },
  );

  if (calls.length === 2 && calls[0].url === calls[1].url && calls[0].url === 'https://jobs.gem.com/api/public/graphql/batch') {
    pass('gem.fetch() makes exactly 2 calls, both to the batch endpoint (list, then one batched detail POST)');
  } else {
    fail(`gem.fetch() calls = ${JSON.stringify(calls.map(c => c.url))}`);
  }

  if (calls[0].opts?.redirect === 'error' && calls[1].opts?.redirect === 'error') {
    pass('gem.fetch() passes redirect:"error" (SSRF guard) on both calls');
  } else {
    fail(`gem.fetch() opts = ${JSON.stringify(calls.map(c => c.opts?.redirect))}`);
  }

  const listBody = JSON.parse(calls[0].opts.body);
  if (Array.isArray(listBody) && listBody.length === 1 && listBody[0].operationName === 'JobBoardList' && listBody[0].variables.boardId === 'retool') {
    pass('gem.fetch() call 1 sends a single JobBoardList operation with boardId from careers_url');
  } else {
    fail(`gem.fetch() call 1 body = ${calls[0].opts.body}`);
  }

  const detailBody = JSON.parse(calls[1].opts.body);
  if (Array.isArray(detailBody) && detailBody.length === 1 && detailBody[0].operationName === 'ExternalJobPostingQuery'
      && detailBody[0].variables.boardId === 'retool' && detailBody[0].variables.extId === '1001') {
    pass('gem.fetch() call 2 batches one ExternalJobPostingQuery op per valid posting (one op for the one valid extId)');
  } else {
    fail(`gem.fetch() call 2 body = ${calls[1].opts.body}`);
  }

  if (fetched.length === 1) pass('gem.fetch() drops postings with no extId, keeps the valid one');
  else fail(`gem.fetch() returned ${fetched.length} rows (expected 1)`);

  if (fetched[0]?.title === 'AI Engineer'
      && fetched[0]?.url === 'https://jobs.gem.com/retool/1001'
      && fetched[0]?.company === 'Retool')
    pass('gem.fetch() maps title/extId-based url/entry.name');
  else fail(`gem.fetch() row 0 = ${JSON.stringify(fetched[0])}`);

  if (fetched[0]?.location === 'San Francisco · Remote')
    pass('gem.fetch() folds location name + isRemote flag, " · "-joined');
  else fail(`gem.fetch() row 0 location = ${JSON.stringify(fetched[0]?.location)}`);

  if (fetched[0]?.postedAt === 1700000000 * 1000)
    pass('gem.fetch() converts firstPublishedTsSec (unix seconds) to postedAt (epoch ms)');
  else fail(`gem.fetch() row 0 postedAt = ${JSON.stringify(fetched[0]?.postedAt)} (expected ${1700000000 * 1000})`);

  if (calls[1].opts.body.includes('descriptionHtml'))
    pass('gem.fetch() requests descriptionHtml in the batched detail query');
  else fail(`gem.fetch() detail query body missing descriptionHtml: ${calls[1].opts.body}`);

  if (fetched[0]?.description === 'Build & ship AI tools. Own the roadmap')
    pass('gem.fetch() strips tags and decodes entities from descriptionHtml into job.description');
  else fail(`gem.fetch() row 0 description = ${JSON.stringify(fetched[0]?.description)}`);

  // Malformed list response bodies → [], no crash, no detail call attempted.
  const emptyCases = [null, {}, [], [{}], [{ data: null }], [{ data: { oatsExternalJobPostings: null } }]];
  let emptyOk = true;
  for (const body of emptyCases) {
    let requestCount = 0;
    const out = await gem.fetch(
      { name: 'Retool', careers_url: 'https://jobs.gem.com/retool' },
      { fetchJson: async () => { requestCount++; return body; } },
    );
    if (!Array.isArray(out) || out.length !== 0 || requestCount !== 1) {
      emptyOk = false;
      fail(`gem.fetch() body=${JSON.stringify(body)} → ${JSON.stringify(out)}, requests=${requestCount}`);
      break;
    }
  }
  if (emptyOk) pass('gem.fetch() returns [] for null / {} / [] / malformed list response bodies');

  // Detail batch failure is non-fatal — listing still returns, just without postedAt.
  let detailAttempted = false;
  const degraded = await gem.fetch(
    { name: 'Retool', careers_url: 'https://jobs.gem.com/retool' },
    {
      fetchJson: async (url, opts) => {
        if (!detailAttempted) { detailAttempted = true; return listResponse; }
        throw new Error('HTTP 500');
      },
    },
  );
  if (degraded.length === 1 && degraded[0].postedAt === undefined && degraded[0].description === '') {
    pass('gem.fetch() degrades gracefully when the detail batch throws: postings still returned, postedAt/description omitted');
  } else {
    fail(`gem.fetch() degraded = ${JSON.stringify(degraded)}`);
  }

  // Detail response with a non-array body / missing extId match → postedAt stays undefined, no crash.
  const noMatch = await gem.fetch(
    { name: 'Retool', careers_url: 'https://jobs.gem.com/retool' },
    {
      fetchJson: async (url, opts) => {
        const body = JSON.parse(opts.body);
        return body[0].operationName === 'JobBoardList' ? listResponse : 'not an array';
      },
    },
  );
  if (noMatch.length === 1 && noMatch[0].postedAt === undefined) {
    pass('gem.fetch() tolerates a non-array detail response: postedAt stays undefined, no crash');
  } else {
    fail(`gem.fetch() noMatch = ${JSON.stringify(noMatch)}`);
  }

  // Multiple valid postings → detail batch carries one op per extId, matched back by extId (not position).
  const multiListResponse = [{
    data: {
      oatsExternalJobPostings: {
        jobPostings: [
          { extId: 'a', title: 'Role A', locations: [] },
          { extId: 'b', title: 'Role B', locations: [] },
        ],
      },
    },
  }];
  const multiDetailResponse = [
    // deliberately out of order vs. the request — fetch() must match by extId, not position
    { data: { oatsExternalJobPosting: { extId: 'b', firstPublishedTsSec: 2000000000 } } },
    { data: { oatsExternalJobPosting: { extId: 'a', firstPublishedTsSec: 1000000000 } } },
  ];
  let multiCallCount = 0;
  const multi = await gem.fetch(
    { name: 'Retool', careers_url: 'https://jobs.gem.com/retool' },
    { fetchJson: async () => { multiCallCount++; return multiCallCount === 1 ? multiListResponse : multiDetailResponse; } },
  );
  const rowA = multi.find(r => r.url.endsWith('/a'));
  const rowB = multi.find(r => r.url.endsWith('/b'));
  if (rowA?.postedAt === 1000000000 * 1000 && rowB?.postedAt === 2000000000 * 1000) {
    pass('gem.fetch() matches detail results back to postings by extId, not response position');
  } else {
    fail(`gem.fetch() multi = ${JSON.stringify(multi)}`);
  }

  // Underivable entry → typed error before any request.
  let underiveFetchCalled = false;
  try {
    await gem.fetch(
      { name: 'NoBoard', careers_url: 'https://example.com/careers' },
      { fetchJson: async () => { underiveFetchCalled = true; return []; } },
    );
    fail('gem.fetch() should throw when no board id can be derived');
  } catch (e) {
    if (!underiveFetchCalled && /cannot derive board id for NoBoard/.test(e.message)) {
      pass('gem.fetch() throws "cannot derive board id" before fetching for an undetectable entry');
    } else {
      fail(`gem.fetch() underivable entry: fetchCalled=${underiveFetchCalled}, error=${e.message}`);
    }
  }

} catch (e) {
  fail(`gem provider tests crashed: ${e.message}`);
}
