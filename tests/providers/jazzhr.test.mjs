import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — jazzhr');
try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/jazzhr.mjs')).href);
  const provider = mod.default;
  const board = 'https://exampleco.applytojob.com/apply';

  if (provider.id === 'jazzhr') pass('jazzhr.id is "jazzhr"');
  else fail('wrong provider id');

  // ── detect(): only the host is trusted — any path resolves to the board root ──
  // Mirrors providers/bamboohr.mjs / providers/breezy.mjs / providers/icims.mjs:
  // the input path is never validated, just discarded and rebuilt as /apply.
  for (const [label, url] of [
    ['bare host with trailing slash', 'https://exampleco.applytojob.com/'],
    ['bare host without trailing slash', 'https://exampleco.applytojob.com'],
    ['already /apply', 'https://exampleco.applytojob.com/apply'],
    ['/apply with a trailing slash', 'https://exampleco.applytojob.com/apply/'],
    ['an unrelated path', 'https://exampleco.applytojob.com/login'],
    ['a posting permalink, not the board root', 'https://exampleco.applytojob.com/apply/D4/Some-Posting'],
    ['a non-default port', 'https://exampleco.applytojob.com:8443/apply'], // dropped, same as the path — origin is rebuilt from the hostname alone, not carried through
  ]) {
    if (provider.detect({ name: 'Example', careers_url: url })?.url === 'https://exampleco.applytojob.com/apply') pass(`resolves ${label} to the board root`);
    else fail(`${label} did not resolve to the board root: ${JSON.stringify(provider.detect({ name: 'Example', careers_url: url }))}`);
  }

  for (const bad of [
    'http://exampleco.applytojob.com/apply', // non-https
    'https://evil.example/apply', // untrusted host
    'https://x.applytojob.com.evil.com/apply', // suffix-host bypass
    'https://x.applytojob.com@evil/apply', // userinfo-host bypass
    null,
    7,
  ]) {
    if (provider.detect({ name: 'X', careers_url: bad }) === null) pass(`rejects ${String(bad)}`);
    else fail(`accepted ${String(bad)}`);
  }

  // Regression: detect(null) (and other missing/malformed entry shapes) must
  // return null, not throw — resolveBoardUrl used to dereference entry.api
  // unguarded, so a null/undefined entry crashed instead of being rejected.
  try {
    if (provider.detect(null) === null) pass('detect(null) returns null, does not throw');
    else fail('detect(null) did not return null');
  } catch (e) { fail(`detect(null) threw: ${e.message}`); }
  try {
    if (provider.detect(undefined) === null) pass('detect(undefined) returns null, does not throw');
    else fail('detect(undefined) did not return null');
  } catch (e) { fail(`detect(undefined) threw: ${e.message}`); }

  // ── parseJazzHRList(): list-group-item cards, entities, URL pinning ──
  const list = `<ul><li class="list-group-item"><h3 class="list-group-item-heading"><a href="https://exampleco.applytojob.com/apply/A1/Learning-Designer">Learning &amp; Development Designer</a></h3><ul><li><i class="fa fa-map-marker"></i>Toronto, ON</li></ul></li><li class="list-group-item"><h3><a href="/apply/B2/Analyst">Analyst</a></h3><ul><li><i class="fa fa-map-marker"></i>Remote</li></ul></li></ul>`;
  const jobs = mod.parseJazzHRList(list, board, 'Example Co');
  if (jobs.length === 2 && jobs[0].title === 'Learning & Development Designer' && jobs[0].location === 'Toronto, ON') pass('parses list titles, entities, locations, and relative/absolute links');
  else fail(`list parse failed ${JSON.stringify(jobs)}`);
  if (jobs[1].url === 'https://exampleco.applytojob.com/apply/B2/Analyst') pass('pins posting URLs to the board host');
  else fail('URL pinning failed');

  // ── parseJazzHRDetail(): JSON-LD enrichment, list-vs-detail location precedence ──
  const detail = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Learning & Development Designer', description: '<p>Build &amp; deliver courses.</p>', datePosted: '2026-08-30', jobLocation: { address: { addressLocality: 'Toronto', addressRegion: 'ON', addressCountry: 'CA' } } })}</script>`;
  // jobs[0].location ('Toronto, ON') is already non-empty, so per the
  // list-wins guard the detail page's location must NOT overwrite it here —
  // only description/date come from the detail page in this case.
  const enriched = mod.parseJazzHRDetail(detail, { ...jobs[0] });
  if (enriched.description === 'Build & deliver courses.' && enriched.postedAt && enriched.location === 'Toronto, ON') pass('parses JSON-LD description and date, keeps existing list location');
  else fail(`detail parse failed ${JSON.stringify(enriched)}`);

  // Regression: a fuller list-page location must not be downgraded by a
  // sparser detail-page one (e.g. list "Berlin, Berlin, Germany" vs. a
  // detail JSON-LD missing country) — only an empty/"n/a" list location
  // may be filled in from the detail page.
  const sparseDetail = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Berlin Role', jobLocation: { address: { addressLocality: 'Berlin' } } })}</script>`;
  const fullerListJob = { title: 'Berlin Role', url: `${board}/D4/Berlin-Role`, company: 'Example Co', location: 'Berlin, Berlin, Germany' };
  const notOverwritten = mod.parseJazzHRDetail(sparseDetail, { ...fullerListJob });
  if (notOverwritten.location === 'Berlin, Berlin, Germany') pass('list location wins over a sparser detail location');
  else fail(`list location was overwritten: ${JSON.stringify(notOverwritten)}`);

  const emptyListJob = { title: 'Berlin Role', url: `${board}/D4/Berlin-Role`, company: 'Example Co', location: '' };
  const filledIn = mod.parseJazzHRDetail(sparseDetail, { ...emptyListJob });
  if (filledIn.location === 'Berlin') pass('empty list location is filled in from detail page');
  else fail(`empty list location was not filled in: ${JSON.stringify(filledIn)}`);

  // ── empty/broken board handling ──
  if (mod.parseJazzHRList('', board, 'X').length === 0 && mod.parseJazzHRList('<html>no openings</html>', board, 'X').length === 0) pass('empty/contentless board returns []');
  else fail('empty board failed');

  const noTitleCard = `<ul><li class="list-group-item"><h3><a href="https://exampleco.applytojob.com/apply/C3/"></a></h3><ul><li><i class="fa fa-map-marker"></i>Remote</li></ul></li><li class="list-group-item"><h3><a href="/apply/B2/Analyst">Analyst</a></h3><ul><li><i class="fa fa-map-marker"></i>Remote</li></ul></li></ul>`;
  const skipped = mod.parseJazzHRList(noTitleCard, board, 'X');
  if (skipped.length === 1 && skipped[0].title === 'Analyst') pass('skips a card with no title, keeps the rest');
  else fail(`no-title card was not skipped ${JSON.stringify(skipped)}`);

  // ── fetch(): detail-loop pacing, probe cooperation, SSRF guard ──
  const calls = [];
  const delays = [];
  const ctx = {
    fetchText: async (url, opts) => {
      calls.push({ url, opts });
      return calls.length === 1 ? list : detail;
    },
    sleep: async (ms) => { delays.push(ms); },
  };
  const fetched = await provider.fetch({ name: 'Example Co', careers_url: board, jazzhr: { fetchDetails: true, detailLimit: 2 } }, ctx);
  if (fetched.length === 2 && calls.length === 3 && calls.every((c) => c.opts.redirect === 'error') && delays.length === 1 && delays[0] === 200) pass('fetches details with redirect:error and 200ms pacing');
  else fail(`fetch contract failed ${JSON.stringify({ calls, delays })}`);

  const probeCalls = [];
  await provider.fetch({ name: 'Example Co', careers_url: board, jazzhr: { fetchDetails: true } }, {
    maxPages: 1,
    fetchText: async (url, opts) => {
      probeCalls.push({ url, opts });
      return list;
    },
  });
  if (probeCalls.length === 1) pass('probe skips optional detail requests');
  else fail('probe detail request was not skipped');

  let guarded = false;
  let guardCalls = 0;
  try {
    await provider.fetch({ name: 'X', careers_url: 'https://evil.example/apply' }, {
      fetchText: async () => {
        guardCalls++;
        throw new Error('should not fetch');
      },
    });
  } catch { guarded = true; }
  if (guarded && guardCalls === 0) pass('SSRF guard rejects untrusted host before network');
  else fail(`SSRF guard failed: calls=${guardCalls}`);

  // ── wrapper-less markup: fallback recovery vs. genuinely unparseable ──
  // Regression: a redesign that renames or drops the list-group-item
  // wrapper must not read as a healthy empty board — a bare permalink
  // anchor recovers the title (location is not recoverable outside the
  // wrapper, so it comes back blank).
  const noWrapper = '<div>ignore this list-group-item text, no real card here</div><a href="/apply/D4/Support-Engineer">Support Engineer</a>';
  const recovered = mod.parseJazzHRList(noWrapper, board, 'X');
  if (recovered.length === 1 && recovered[0].title === 'Support Engineer' && recovered[0].location === '') pass('falls back to a bare /apply/ anchor when the card wrapper is absent');
  else fail(`wrapper-less fallback failed ${JSON.stringify(recovered)}`);

  // Regression: an href of "/apply/?ref=1" satisfies the raw-string capture
  // (something non-quote follows "/apply/") but collapses to pathname
  // "/apply/" once parsed as a URL — the board root, not a posting. Must be
  // rejected rather than added as a job pointing at the board root; with no
  // other posting recovered, this correctly reads as the "links present,
  // nothing parsed" broken-markup case and throws.
  try {
    mod.parseJazzHRList('<a href="/apply/?ref=1">Board root, not a posting</a>', board, 'X');
    fail('an href resolving to the board root should not be accepted as a posting');
  } catch { pass('rejects an href that resolves to the board root, not a posting'); }

  // Regression: "/apply//" satisfies a naive ".+ after /apply/" check (the
  // extra "/" itself counts as "something"), but it is not a real posting
  // segment either.
  try {
    mod.parseJazzHRList('<a href="/apply//">Double slash, not a posting</a>', board, 'X');
    fail('an "/apply//" href should not be accepted as a posting');
  } catch { pass('rejects an "/apply//" href with no real posting segment'); }

  // Regression: a PARTIAL redesign (one posting still in a list-group-item
  // card, another already migrated off it) must recover both — the fallback
  // has to run even when the primary pass already found something, or the
  // unwrapped posting is dropped with no signal at all.
  const mixedMarkup = `${list}<a href="/apply/E5/Support-Engineer">Support Engineer</a>`;
  const mixed = mod.parseJazzHRList(mixedMarkup, board, 'X');
  if (mixed.length === 3 && mixed.some((j) => j.title === 'Support Engineer' && j.location === '')) pass('recovers an unwrapped posting alongside cards the primary pass already found');
  else fail(`mixed-markup recovery failed ${JSON.stringify(mixed)}`);

  try {
    mod.parseJazzHRList('<a href="/apply/1/role"></a>', board, 'X');
    fail('a titleless ApplyToJob link should throw');
  } catch { pass('throws when ApplyToJob links exist but no posting title parses'); }
} catch (e) { fail(`jazzhr provider tests crashed: ${e.message}`); }
