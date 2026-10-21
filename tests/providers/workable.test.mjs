// tests/providers/workable.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — workable');

try {
  const workableModule = await import(pathToFileURL(join(ROOT, 'providers/workable.mjs')).href);
  const workable = workableModule.default;
  const { parseWorkableMarkdown, parseWorkableWidget } = workableModule;

  // detect() — auto-detection from careers_url
  if (workable.id === 'workable') pass('workable.id is "workable"');
  else fail(`workable.id is ${JSON.stringify(workable.id)}`);

  const hit = workable.detect({ name: 'TestCo', careers_url: 'https://apply.workable.com/acme-widgets' });
  if (hit && hit.url === 'https://apply.workable.com/api/v1/widget/accounts/acme-widgets?details=true') {
    pass('workable.detect() resolves apply.workable.com/<slug> → widget API');
  } else {
    fail(`workable.detect() returned ${JSON.stringify(hit)}`);
  }

  const miss = workable.detect({ name: 'TestCo', careers_url: 'https://example.com/careers' });
  if (miss === null) pass('workable.detect() returns null for non-workable URLs');
  else fail(`workable.detect() should return null, got ${JSON.stringify(miss)}`);

  // parse() — markdown table
  const sampleMd = [
    '# AcmeWidgets — All Open Positions',
    '',
    '| Title | Department | Location | Type | Salary | Posted | Details |',
    '|---|---|---|---|---|---|---|',
    '| Senior AI PM | Product | Ghent, Belgium | Full-time | — | 2026-04-01 | [View](https://apply.workable.com/acme-widgets/jobs/view/ABC123.md) |',
    '| Tech Lead | Engineering | Remote | Full-time | — | 2026-03-25 | [View](https://apply.workable.com/acme-widgets/jobs/view/DEF456.md) |',
  ].join('\n');

  const jobs = parseWorkableMarkdown(sampleMd, 'AcmeWidgets');
  if (jobs.length === 2) pass('parseWorkableMarkdown extracts 2 jobs from 2-row table');
  else fail(`parseWorkableMarkdown returned ${jobs.length} jobs, expected 2`);

  if (jobs[0]?.title === 'Senior AI PM' && jobs[0]?.location === 'Ghent, Belgium' && jobs[0]?.company === 'AcmeWidgets') {
    pass('parseWorkableMarkdown extracts title, location, company correctly');
  } else {
    fail(`parseWorkableMarkdown row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[0]?.url === 'https://apply.workable.com/acme-widgets/jobs/view/ABC123') {
    pass('parseWorkableMarkdown strips .md suffix from job URL');
  } else {
    fail(`parseWorkableMarkdown should strip .md; got url=${JSON.stringify(jobs[0]?.url)}`);
  }

  // Robustness
  if (parseWorkableMarkdown('', 'X').length === 0) pass('empty input → empty result');
  else fail('empty input should yield empty result');

  if (parseWorkableMarkdown(null, 'X').length === 0) pass('null input → empty result (no crash)');
  else fail('null input should yield empty result without crashing');

  // -- widget API (primary path) ------------------------------------------
  const widgetPayload = {
    name: 'AcmeWidgets',
    jobs: [
      {
        title: 'Senior AI PM',
        shortlink: 'https://apply.workable.com/j/ABC123',
        url: 'https://apply.workable.com/j/ABC123',
        city: 'Ghent', country: 'Belgium',
        published_on: '2026-04-01',
        description: '<p>Own the <b>roadmap</b>.</p><script>alert(1)</script>',
      },
      {
        title: 'Tech Lead',
        shortlink: 'https://apply.workable.com/j/DEF456',
        telecommuting: true,
        published_on: '2026-03-25',
      },
      // dropped: off-domain permalink
      { title: 'Evil Role', shortlink: 'https://evil.example/j/X', url: 'https://evil.example/j/X' },
      // dropped: no title
      { title: '   ', shortlink: 'https://apply.workable.com/j/NOPE' },
    ],
  };
  const widgetJobs = parseWorkableWidget(widgetPayload, 'AcmeWidgets');
  if (widgetJobs.length === 2) pass('parseWorkableWidget keeps only valid, on-domain, titled jobs');
  else fail(`parseWorkableWidget returned ${widgetJobs.length} jobs, expected 2: ${JSON.stringify(widgetJobs.map(j => j.title))}`);

  if (widgetJobs[0]?.location === 'Ghent, Belgium' && widgetJobs[1]?.location === 'Remote') {
    pass('parseWorkableWidget formats location (city, country / Remote)');
  } else {
    fail(`locations were ${JSON.stringify(widgetJobs.map(j => j.location))}`);
  }

  if (widgetJobs[0]?.postedAt === Date.parse('2026-04-01')) pass('parseWorkableWidget maps published_on → postedAt');
  else fail(`postedAt was ${widgetJobs[0]?.postedAt}`);

  const desc = widgetJobs[0]?.description || '';
  if (desc.includes('Own the roadmap') && !desc.includes('<') && !desc.includes('alert(1)')) {
    pass('parseWorkableWidget strips HTML tags and script bodies from description');
  } else {
    fail(`description was ${JSON.stringify(desc)}`);
  }

  if (parseWorkableWidget(null, 'X').length === 0 && parseWorkableWidget({}, 'X').length === 0) {
    pass('parseWorkableWidget tolerates null / jobs-less payloads');
  } else {
    fail('parseWorkableWidget should return [] for null and {} payloads');
  }

  // -- multi-country fan-out ----------------------------------------------
  // Real shape, captured live 2026-08-21 from
  //   apply.workable.com/api/v1/widget/accounts/digitalgenius?details=true
  // A multi-country posting comes back as ONE ENTRY PER LOCATION, all sharing
  // the same shortlink and differing only in city/state/country. Keeping just
  // the first recorded "Implementation Engineer" as London/United Kingdom and
  // dropped its three EU alternatives, so a UK block rule threw the posting
  // away. Note the payload interleaves two fanned-out postings — the parser
  // must key on the URL, not on adjacency.
  const fanOutPayload = {
    name: 'DigitalGenius',
    jobs: [
      {
        title: 'Implementation Engineer',
        shortcode: '801183DB79',
        shortlink: 'https://apply.workable.com/j/801183DB79',
        url: 'https://apply.workable.com/j/801183DB79',
        city: 'London', state: 'England', country: 'United Kingdom',
        telecommuting: true, published_on: '2026-06-30',
        description: '<p>Deploy the platform.</p>',
        locations: [{ country: 'United Kingdom', countryCode: 'GB', city: 'London', region: 'England' }],
      },
      {
        title: 'Solutions Engineer',
        shortcode: 'E8064EA4C7',
        shortlink: 'https://apply.workable.com/j/E8064EA4C7',
        url: 'https://apply.workable.com/j/E8064EA4C7',
        city: '', state: '', country: 'Romania',
        telecommuting: true, published_on: '2026-06-12',
        locations: [{ country: 'Romania', countryCode: 'RO', city: '', region: null }],
      },
      {
        title: 'Implementation Engineer',
        shortcode: '801183DB79',
        shortlink: 'https://apply.workable.com/j/801183DB79',
        url: 'https://apply.workable.com/j/801183DB79',
        city: '', state: '', country: 'Romania',
        telecommuting: true, published_on: '2026-06-30',
        description: '<p>Deploy the platform.</p>',
        locations: [{ country: 'Romania', countryCode: 'RO', city: '', region: null }],
      },
      {
        title: 'Implementation Engineer',
        shortcode: '801183DB79',
        shortlink: 'https://apply.workable.com/j/801183DB79',
        url: 'https://apply.workable.com/j/801183DB79',
        city: '', state: '', country: 'Poland',
        telecommuting: true, published_on: '2026-06-30',
        description: '<p>Deploy the platform.</p>',
        locations: [{ country: 'Poland', countryCode: 'PL', city: '', region: null }],
      },
      {
        title: 'Solutions Engineer',
        shortcode: 'E8064EA4C7',
        shortlink: 'https://apply.workable.com/j/E8064EA4C7',
        url: 'https://apply.workable.com/j/E8064EA4C7',
        city: '', state: '', country: 'Portugal',
        telecommuting: true, published_on: '2026-06-12',
        locations: [{ country: 'Portugal', countryCode: 'PT', city: '', region: null }],
      },
      {
        title: 'Implementation Engineer',
        shortcode: '801183DB79',
        shortlink: 'https://apply.workable.com/j/801183DB79',
        url: 'https://apply.workable.com/j/801183DB79',
        city: '', state: '', country: 'Croatia',
        telecommuting: true, published_on: '2026-06-30',
        description: '<p>Deploy the platform.</p>',
        locations: [{ country: 'Croatia', countryCode: 'HR', city: '', region: null }],
      },
    ],
  };
  const fanOutJobs = parseWorkableWidget(fanOutPayload, 'DigitalGenius');

  if (fanOutJobs.length === 2) {
    pass('parseWorkableWidget collapses each multi-country fan-out into one job');
  } else {
    fail(`fan-out produced ${fanOutJobs.length} jobs, expected 2: ${JSON.stringify(fanOutJobs.map(j => `${j.title}@${j.location}`))}`);
  }

  const implRole = fanOutJobs.find(j => j.title === 'Implementation Engineer');
  if (implRole?.location === 'London, United Kingdom · Romania · Poland · Croatia') {
    pass('parseWorkableWidget joins every fanned-out location in payload order');
  } else {
    fail(`fanned-out location was ${JSON.stringify(implRole?.location)}, expected all four countries joined`);
  }

  // The interleaved second posting must not absorb the first one's locations.
  const solutionsRole = fanOutJobs.find(j => j.title === 'Solutions Engineer');
  if (solutionsRole?.location === 'Romania · Portugal') {
    pass('parseWorkableWidget keeps interleaved fan-outs separate (keyed on URL, not adjacency)');
  } else {
    fail(`interleaved fan-out location was ${JSON.stringify(solutionsRole?.location)}, expected "Romania · Portugal"`);
  }

  // Everything except location still comes from the first entry.
  if (implRole?.postedAt === Date.parse('2026-06-30')
      && implRole?.url === 'https://apply.workable.com/j/801183DB79'
      && (implRole?.description || '').includes('Deploy the platform')) {
    pass('parseWorkableWidget takes non-location fields from the first fanned-out entry');
  } else {
    fail(`merged job carried unexpected fields: ${JSON.stringify(implRole)}`);
  }

  // Siblings with no location of their own add nothing, and a repeat collapses.
  const noisyFanOut = parseWorkableWidget({
    jobs: [
      { title: 'Ops Lead', shortlink: 'https://apply.workable.com/j/N1', country: 'Spain' },
      { title: 'Ops Lead', shortlink: 'https://apply.workable.com/j/N1', country: 'Spain' },
      { title: 'Ops Lead', shortlink: 'https://apply.workable.com/j/N1', city: '', country: '' },
      { title: 'Ops Lead', shortlink: 'https://apply.workable.com/j/N1', country: 'Italy' },
    ],
  }, 'NoisyCo');
  if (noisyFanOut.length === 1 && noisyFanOut[0].location === 'Spain · Italy') {
    pass('parseWorkableWidget dedups repeated locations and ignores empty siblings');
  } else {
    fail(`noisy fan-out produced ${JSON.stringify(noisyFanOut.map(j => j.location))}, expected ["Spain · Italy"]`);
  }

  // The point of the fix: ask the real consumer, not a reimplementation of it.
  // This is the config shape that parked the posting — UK blocked, EU allowed.
  const { buildLocationFilter } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
  const euFilter = buildLocationFilter({
    always_allow: ['Romania', 'Poland', 'Croatia'],
    allow: ['Remote', 'Europe'],
    block: ['United Kingdom', 'London'],
  });
  const beforeFix = 'London, United Kingdom';
  if (!euFilter(beforeFix) && euFilter(implRole?.location)) {
    pass('merged location survives a UK-blocking location_filter that rejects the pre-fix string');
  } else {
    fail(`location_filter verdicts unexpected: pre-fix ${euFilter(beforeFix)}, merged ${euFilter(implRole?.location)}`);
  }

  // fetch() prefers the widget API and never touches the markdown feed when it works.
  let apiCallHeaders = null;
  const apiJobs = await workable.fetch(
    { name: 'Smoke', careers_url: 'https://apply.workable.com/acme-widgets' },
    {
      transport: 'http',
      sleep: async () => {},
      fetchJson: async (url, opts) => {
        if (url !== 'https://apply.workable.com/api/v1/widget/accounts/acme-widgets?details=true') {
          throw new Error(`fetchJson called with unexpected URL: ${url}`);
        }
        apiCallHeaders = opts?.headers;
        if (opts?.redirect !== 'error') throw new Error(`expected redirect:'error', got ${JSON.stringify(opts?.redirect)}`);
        return widgetPayload;
      },
      fetchText: async () => { throw new Error('markdown feed should not be used when the API succeeds'); },
    },
  );
  if (apiJobs.length === 2) pass('workable.fetch() uses the widget API as the primary path');
  else fail(`workable.fetch() via API returned ${apiJobs.length} jobs, expected 2`);

  if (apiCallHeaders?.['user-agent'] && apiCallHeaders.referer === 'https://apply.workable.com/acme-widgets/') {
    pass('workable.fetch() sends browser-like UA and matching referer on the widget API request');
  } else {
    fail(`unexpected headers on widget API call: ${JSON.stringify(apiCallHeaders)}`);
  }

  // fetch() falls back to the markdown feed when the API fails with a non-retryable error.
  let feedCallHeaders = null;
  const fallbackJobs = await workable.fetch(
    { name: 'Smoke', careers_url: 'https://apply.workable.com/acme-widgets' },
    {
      transport: 'http',
      sleep: async () => {},
      fetchJson: async () => { const err = new Error('HTTP 404'); err.status = 404; throw err; },
      fetchText: async (url, opts) => {
        if (url !== 'https://apply.workable.com/acme-widgets/jobs.md') {
          throw new Error(`fetchText called with unexpected URL: ${url}`);
        }
        feedCallHeaders = opts?.headers;
        if (opts?.redirect !== 'error') throw new Error(`expected redirect:'error', got ${JSON.stringify(opts?.redirect)}`);
        return [
          '| Title | Department | Location | Type | Salary | Posted | Details |',
          '|---|---|---|---|---|---|---|',
          '| Fallback Role | Product | Remote | Full-time | — | 2026-04-01 | [View](https://apply.workable.com/acme-widgets/jobs/view/ZZZ.md) |',
        ].join('\n');
      },
    },
  );
  if (fallbackJobs.length === 1 && fallbackJobs[0].title === 'Fallback Role') {
    pass('workable.fetch() falls back to the markdown feed on a non-retryable API error');
  } else {
    fail(`fallback returned ${JSON.stringify(fallbackJobs)}`);
  }
  if (feedCallHeaders?.referer === 'https://apply.workable.com/acme-widgets/') {
    pass('workable.fetch() sends matching referer on the markdown fallback request too');
  } else {
    fail(`markdown fallback headers: ${JSON.stringify(feedCallHeaders)}`);
  }

  // fetch() retries a transient 429 on the widget API and recovers without falling back.
  let apiAttempts = 0;
  const recoveredJobs = await workable.fetch(
    { name: 'Smoke', careers_url: 'https://apply.workable.com/acme-widgets' },
    {
      transport: 'http',
      sleep: async () => {},
      fetchJson: async () => {
        apiAttempts++;
        if (apiAttempts === 1) {
          const err = new Error('HTTP 429');
          err.status = 429;
          err.retryAfter = '1'; // 1s — short enough to retry, not give up
          throw err;
        }
        return widgetPayload;
      },
      fetchText: async () => { throw new Error('markdown feed should not be used once the API recovers'); },
    },
  );
  if (apiAttempts === 2 && recoveredJobs.length === 2) {
    pass('workable.fetch() retries a transient 429 on the widget API and recovers');
  } else {
    fail(`retry-and-recover: attempts=${apiAttempts}, jobs=${recoveredJobs.length}`);
  }

  // fetch() gives up immediately (no wasted retries) on an hours-long Retry-After.
  let giveUpAttempts = 0;
  const giveUpJobs = await workable.fetch(
    { name: 'Smoke', careers_url: 'https://apply.workable.com/acme-widgets' },
    {
      transport: 'http',
      sleep: async () => {},
      fetchJson: async () => {
        giveUpAttempts++;
        const err = new Error('HTTP 429');
        err.status = 429;
        err.retryAfter = String(21 * 3600); // ~21h — well past the give-up threshold
        throw err;
      },
      fetchText: async () => [
        '| Title | Department | Location | Type | Salary | Posted | Details |',
        '|---|---|---|---|---|---|---|',
        '| Feed Role | Product | Remote | Full-time | — | 2026-04-01 | [View](https://apply.workable.com/acme-widgets/jobs/view/YYY.md) |',
      ].join('\n'),
    },
  );
  if (giveUpAttempts === 1 && giveUpJobs.length === 1 && giveUpJobs[0].title === 'Feed Role') {
    pass('workable.fetch() gives up immediately on an hours-long Retry-After and falls back to the markdown feed');
  } else {
    fail(`give-up-early: attempts=${giveUpAttempts}, jobs=${JSON.stringify(giveUpJobs)}`);
  }

  // Serialization: two concurrent fetch() calls never overlap in-flight.
  let inFlight = 0;
  let overlapped = false;
  const makeSlowCtx = () => ({
    transport: 'http',
    sleep: async () => {},
    fetchJson: async () => {
      inFlight++;
      if (inFlight > 1) overlapped = true;
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight--;
      return widgetPayload;
    },
    fetchText: async () => { throw new Error('should not reach markdown feed'); },
  });
  await Promise.all([
    workable.fetch({ name: 'A', careers_url: 'https://apply.workable.com/acme-widgets' }, makeSlowCtx()),
    workable.fetch({ name: 'B', careers_url: 'https://apply.workable.com/acme-widgets' }, makeSlowCtx()),
  ]);
  if (!overlapped) pass('workable.fetch() serializes concurrent requests process-wide');
  else fail('two concurrent workable.fetch() calls overlapped in-flight');

  // fetch() rejects an unresolvable careers_url (no apply.workable.com match in URL).
  let rejected = false;
  try {
    await workable.fetch(
      { name: 'BadUrl', careers_url: 'https://evil.com/totally-not-workable' },
      {
        transport: 'http',
        fetchText: async () => { throw new Error('SSRF! should not reach here'); },
        fetchJson: async () => { throw new Error('SSRF! should not reach here'); },
      },
    );
  } catch (e) {
    if (e.message.includes('cannot derive feed URL')) {
      rejected = true;
    } else {
      fail(`workable.fetch() rejected with wrong error: ${e.message}`);
    }
  }
  if (rejected) pass('workable.fetch() rejects unresolvable careers_url before fetch');
  else fail('workable.fetch() should throw cannot-derive-feed-URL for non-Workable URLs');

  // SSRF: malicious URL with apply.workable.com in the PATH (not hostname) must not be detected as Workable.
  // With strict URL parsing, the hostname `evil.example` fails the check and detect() returns null.
  if (workable.detect({ name: 'Spoof', careers_url: 'https://evil.example/apply.workable.com/slug' }) === null) {
    pass('workable.detect() rejects path-spoofed URLs (apply.workable.com in path, not hostname)');
  } else {
    fail('workable.detect() must NOT misdetect URLs that contain apply.workable.com in the path');
  }

  // careers_url with non-string value (e.g. YAML mistake passing a number) → detect() returns null without crashing
  if (workable.detect({ name: 'X', careers_url: 42 }) === null) {
    pass('workable.detect() returns null for non-string careers_url (42)');
  } else {
    fail('workable.detect() should treat non-string careers_url as missing');
  }

  // Workable parser tolerates a title with a stray pipe — URL is extracted from the line, not cols[7]
  const strayPipeMd = [
    '| Title | Department | Location | Type | Salary | Posted | Details |',
    '|---|---|---|---|---|---|---|',
    '| Senior PM (full | part-time) | Product | Remote | Full-time | — | 2026-04-01 | [View](https://apply.workable.com/x/jobs/view/PIPE.md) |',
  ].join('\n');
  const strayJobs = parseWorkableMarkdown(strayPipeMd, 'X');
  if (strayJobs.length === 1 && strayJobs[0].url === 'https://apply.workable.com/x/jobs/view/PIPE') {
    pass('parseWorkableMarkdown extracts URL from line-level regex (survives stray pipes in title)');
  } else {
    fail(`stray-pipe row not handled correctly: ${JSON.stringify(strayJobs)}`);
  }

  // Off-domain [View] link is dropped (URL validation)
  const offDomainMd = [
    '| Title | Department | Location | Type | Salary | Posted | Details |',
    '|---|---|---|---|---|---|---|',
    '| Good Role | Product | Remote | Full-time | — | 2026-04-01 | [View](https://apply.workable.com/x/jobs/view/ABC.md) |',
    '| Evil Role | Product | Remote | Full-time | — | 2026-04-01 | [View](https://evil.example/jobs/view/X) |',
    '| Insecure Role | Product | Remote | Full-time | — | 2026-04-01 | [View](http://apply.workable.com/x/jobs/view/Y.md) |',
  ].join('\n');
  const filteredJobs = parseWorkableMarkdown(offDomainMd, 'X');
  if (filteredJobs.length === 1 && filteredJobs[0].title === 'Good Role') {
    pass('parseWorkableMarkdown drops off-domain and non-https [View] links');
  } else {
    fail(`expected only "Good Role" through, got ${JSON.stringify(filteredJobs.map(j => j.title))}`);
  }

} catch (e) {
  fail(`workable provider tests crashed: ${e.message}`);
}

