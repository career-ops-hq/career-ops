// tests/providers/garena.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — garena');

try {
  const garenaModule = await import(pathToFileURL(join(ROOT, 'providers/garena.mjs')).href);
  const garena = garenaModule.default;
  const { parseGarenaResponse } = garenaModule;

  if (garena.id === 'garena') pass('garena.id is "garena"');
  else fail(`garena.id is ${JSON.stringify(garena.id)}`);

  // parseGarenaResponse — happy path: id/title/location/description map, url
  // is built from the office + id, default office is "global".
  const sample = {
    jobs: [
      {
        id: 'J02058270',
        title: 'Game Mode Developer Freelance (Onsite)',
        tags: { location: ['Jakarta'], job_category: ['Engineering and Technology'] },
        description: '<p>Ships <strong>maps</strong>.</p>',
      },
      {
        id: 'J02106618',
        title: 'Garena - Product Coordinator',
        tags: { location: ['Mexico City'] },
        description: '',
      },
    ],
  };
  const jobs = parseGarenaResponse(sample, { name: 'Garena' });
  if (jobs.length === 2) pass('parseGarenaResponse extracts 2 jobs');
  else fail(`parseGarenaResponse returned ${jobs.length} jobs`);

  if (jobs[0].url === 'https://careers.garena.com/global/careers/J02058270') pass('parseGarenaResponse builds the job URL from the default office + id');
  else fail(`job[0].url = ${JSON.stringify(jobs[0]?.url)}`);

  if (jobs[0].company === 'Garena') pass('parseGarenaResponse sets company from entry.name');
  else fail(`job[0].company = ${JSON.stringify(jobs[0]?.company)}`);

  if (jobs[0].location === 'Jakarta') pass('parseGarenaResponse maps tags.location to location');
  else fail(`job[0].location = ${JSON.stringify(jobs[0]?.location)}`);

  if (jobs[0].description === 'Ships maps .') pass('parseGarenaResponse strips HTML from description');
  else fail(`job[0].description = ${JSON.stringify(jobs[0]?.description)}`);

  if (!('description' in jobs[1])) pass('parseGarenaResponse omits description when the payload has an empty string');
  else fail(`job[1] should omit description, got ${JSON.stringify(jobs[1]?.description)}`);

  // office comes from the nested `garena:` config block and reaches the URL.
  const withOffice = parseGarenaResponse(sample, { name: 'Garena', garena: { office: 'sg' } });
  if (withOffice[0].url === 'https://careers.garena.com/sg/careers/J02058270') pass('parseGarenaResponse honors entry.garena.office in the job URL');
  else fail(`withOffice[0].url = ${JSON.stringify(withOffice[0]?.url)}`);

  // office (user config) and id (remote data) are escaped before they reach
  // the path, so neither can add a segment of its own.
  const traversal = parseGarenaResponse(
    { jobs: [{ id: 'J7/../../admin', title: 'Traversal', tags: {} }] },
    { garena: { office: 'sg/../../evil' } },
  );
  if (traversal[0].url === 'https://careers.garena.com/sg%2F..%2F..%2Fevil/careers/J7%2F..%2F..%2Fadmin') pass('parseGarenaResponse escapes separators in office and id');
  else fail(`traversal[0].url = ${JSON.stringify(traversal[0]?.url)}`);

  // Dot segments survive percent-encoding, so they are rejected instead.
  for (const bad of ['.', '..']) {
    let rejected = false;
    try { parseGarenaResponse({ jobs: [{ id: 'J8', title: 'Dot office', tags: {} }] }, { garena: { office: bad } }); } catch { rejected = true; }
    if (rejected) pass(`parseGarenaResponse rejects office ${JSON.stringify(bad)}`);
    else fail(`parseGarenaResponse should reject office ${JSON.stringify(bad)}`);

    let idRejected = false;
    try { parseGarenaResponse({ jobs: [{ id: bad, title: 'Dot id', tags: {} }] }, {}); } catch { idRejected = true; }
    if (idRejected) pass(`parseGarenaResponse rejects id ${JSON.stringify(bad)}`);
    else fail(`parseGarenaResponse should reject id ${JSON.stringify(bad)}`);
  }

  // Multiple locations join with ", ".
  const multiLoc = parseGarenaResponse({ jobs: [{ id: 'J1', title: 'Multi', tags: { location: ['Singapore', 'Jakarta'] } }] }, {});
  if (multiLoc[0].location === 'Singapore, Jakarta') pass('parseGarenaResponse joins multiple locations with ", "');
  else fail(`multiLoc[0].location = ${JSON.stringify(multiLoc[0]?.location)}`);

  // Drops title-less and id-less entries.
  const dirty = parseGarenaResponse({
    jobs: [
      { id: 'J2', title: '' },
      { id: '', title: 'No id' },
      { id: 'J3', title: '  ' },
      { id: 'J4', title: 'Good' },
    ],
  }, {});
  if (dirty.length === 1 && dirty[0].title === 'Good') pass('parseGarenaResponse drops title-less, id-less, and whitespace-only entries');
  else fail(`dirty = ${JSON.stringify(dirty.map((j) => j.title))}`);

  // Throws on unexpected shape (endpoint drift surfaces loudly).
  let drifted = false;
  try { parseGarenaResponse({ filters: {} }, {}); } catch { drifted = true; }
  if (drifted) pass('parseGarenaResponse throws when jobs[] is missing');
  else fail('parseGarenaResponse should throw on unexpected API response shape');

  // detect() — fixed host match only; spoofs and non-strings return null.
  if (garena.detect({ careers_url: 'https://careers.garena.com/global' })) pass('garena.detect() matches careers.garena.com');
  else fail('garena.detect() should match careers.garena.com');

  if (garena.detect({ api: 'https://careers.garena.com/api/job/list' })) pass('garena.detect() matches via entry.api too');
  else fail('garena.detect() should match via entry.api');

  if (garena.detect({ careers_url: 'https://evil.com/careers.garena.com' }) === null) pass('garena.detect() rejects path-spoofed host');
  else fail('garena.detect() should reject path-spoofed host');

  if (garena.detect({ careers_url: 'https://careers.garena.com.evil.com/x' }) === null) pass('garena.detect() rejects suffix-spoofed host');
  else fail('garena.detect() should reject suffix-spoofed host');

  if (garena.detect({ careers_url: 42 }) === null && garena.detect({}) === null) pass('garena.detect() returns null for non-string / missing url');
  else fail('garena.detect() should return null for non-string / missing url');

  // fetch() — POSTs an empty JSON body with redirect:'error' via mock ctx.
  let calledUrl = null, calledOpts = null;
  const mockCtx = {
    fetchJson: async (url, opts) => {
      calledUrl = url;
      calledOpts = opts;
      return { jobs: [{ id: 'J5', title: 'Mocked Role', tags: { location: ['Remote'] } }] };
    },
  };
  const fetched = await garena.fetch({ name: 'Garena' }, mockCtx);
  if (calledUrl === 'https://careers.garena.com/api/job/list?office=global') pass('garena.fetch() posts to the API URL with the default office');
  else fail(`garena.fetch() called url = ${JSON.stringify(calledUrl)}`);

  if (calledOpts?.method === 'POST' && calledOpts?.body === '{}' && calledOpts?.redirect === 'error') {
    pass('garena.fetch() sends an empty JSON body with redirect:"error"');
  } else {
    fail(`garena.fetch() opts = ${JSON.stringify(calledOpts)}`);
  }

  if (fetched.length === 1 && fetched[0].title === 'Mocked Role') pass('garena.fetch() returns parsed jobs from the mock response');
  else fail(`garena.fetch() returned ${JSON.stringify(fetched)}`);

  // fetch() — a custom office reaches both the API query string and the job URL.
  let officeUrl = null;
  const officeCtx = {
    fetchJson: async (url) => {
      officeUrl = url;
      return { jobs: [{ id: 'J6', title: 'SG Role', tags: { location: ['Singapore'] } }] };
    },
  };
  const officeFetched = await garena.fetch({ name: 'Garena', garena: { office: 'sg' } }, officeCtx);
  if (officeUrl === 'https://careers.garena.com/api/job/list?office=sg') pass('garena.fetch() forwards a custom office to the API query string');
  else fail(`garena.fetch() custom-office url = ${JSON.stringify(officeUrl)}`);

  if (officeFetched[0]?.url === 'https://careers.garena.com/sg/careers/J6') pass('garena.fetch() forwards a custom office to the job URL');
  else fail(`officeFetched[0].url = ${JSON.stringify(officeFetched[0]?.url)}`);

  // fetch() escapes the office in the query string and refuses a dot segment
  // before any request goes out.
  let escapedUrl = null;
  const escapeCtx = { fetchJson: async (url) => { escapedUrl = url; return { jobs: [] }; } };
  await garena.fetch({ garena: { office: 'sg team&x=1' } }, escapeCtx);
  if (escapedUrl === 'https://careers.garena.com/api/job/list?office=sg%20team%26x%3D1') pass('garena.fetch() escapes the office in the API query string');
  else fail(`garena.fetch() escaped url = ${JSON.stringify(escapedUrl)}`);

  let requested = false, dotRejected = false;
  try {
    await garena.fetch({ garena: { office: '..' } }, { fetchJson: async () => { requested = true; return { jobs: [] }; } });
  } catch { dotRejected = true; }
  if (dotRejected && !requested) pass('garena.fetch() rejects a dot-segment office before requesting');
  else fail(`garena.fetch() dot office: rejected=${dotRejected} requested=${requested}`);

} catch (e) {
  fail(`garena provider tests crashed: ${e.message}`);
}
