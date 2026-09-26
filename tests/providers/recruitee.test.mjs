// tests/providers/recruitee.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — recruitee');


try {
  const recruiteeModule = await import(pathToFileURL(join(ROOT, 'providers/recruitee.mjs')).href);
  const recruitee = recruiteeModule.default;
  const { parseRecruiteeResponse } = recruiteeModule;

  if (recruitee.id === 'recruitee') pass('recruitee.id is "recruitee"');
  else fail(`recruitee.id is ${JSON.stringify(recruitee.id)}`);

  const hit = recruitee.detect({ name: 'Channable', careers_url: 'https://channable.recruitee.com' });
  if (hit && hit.url === 'https://channable.recruitee.com/api/offers/') {
    pass('recruitee.detect() resolves <slug>.recruitee.com → api offers');
  } else {
    fail(`recruitee.detect() returned ${JSON.stringify(hit)}`);
  }

  if (recruitee.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('recruitee.detect() returns null for non-recruitee URLs');
  } else {
    fail('recruitee.detect() should return null for non-recruitee URLs');
  }

  // parseRecruiteeResponse
  const sample = {
    offers: [
      { title: 'Senior PM', careers_url: 'https://channable.recruitee.com/o/senior-pm', city: 'Utrecht', country: 'Netherlands', remote: false },
      { title: 'Backend Eng', url: 'https://channable.recruitee.com/o/backend', city: 'Amsterdam', country: 'Netherlands', remote: true },
      { title: 'AI Lead', careers_url: 'https://channable.recruitee.com/o/ai-lead', location: 'Remote, EMEA' },
    ],
  };
  const jobs = parseRecruiteeResponse(sample, 'Channable');
  if (jobs.length === 3) pass('parseRecruiteeResponse extracts 3 offers');
  else fail(`parseRecruiteeResponse returned ${jobs.length} offers`);

  if (jobs[0]?.title === 'Senior PM' && jobs[0]?.company === 'Channable' && jobs[0]?.url === 'https://channable.recruitee.com/o/senior-pm') {
    pass('parseRecruiteeResponse prefers careers_url field over url');
  } else {
    fail(`row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[1]?.location === 'Amsterdam, Netherlands, Remote') {
    pass('parseRecruiteeResponse assembles city/country/remote when no location field');
  } else {
    fail(`row 1 location = ${JSON.stringify(jobs[1]?.location)}, expected "Amsterdam, Netherlands, Remote"`);
  }

  if (jobs[2]?.location === 'Remote, EMEA') {
    pass('parseRecruiteeResponse uses explicit location field when present');
  } else {
    fail(`row 2 location = ${JSON.stringify(jobs[2]?.location)}`);
  }

  if (parseRecruiteeResponse({}, 'X').length === 0) pass('empty {} → empty result');
  else fail('empty {} should yield empty result');

  if (parseRecruiteeResponse({ offers: null }, 'X').length === 0) {
    pass('null offers → empty result (no crash)');
  } else {
    fail('null offers should yield empty result');
  }

  // careers_url with non-string value → detect() returns null without crashing
  if (recruitee.detect({ name: 'X', careers_url: null }) === null && recruitee.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('recruitee.detect() returns null for non-string careers_url (null and 7)');
  } else {
    fail('recruitee.detect() should treat non-string careers_url as missing');
  }

  // SSRF: malicious URL with recruitee.com in the PATH (not host) must not be detected.
  if (recruitee.detect({ name: 'Spoof', careers_url: 'https://evil.example/channable.recruitee.com/foo' }) === null) {
    pass('recruitee.detect() rejects path-spoofed URLs');
  } else {
    fail('recruitee.detect() must NOT misdetect path-spoofed URLs');
  }

  // Per-offer URL validation: custom-domain https URLs are KEPT (Recruitee
  // tenants serve postings on their own domain, e.g. careers.hostaway.com);
  // the per-offer URL is display-only and not host-locked to *.recruitee.com
  // — see #recruitee. A non-https, malformed, or missing URL drops the WHOLE
  // offer (url is this provider's own dedup key downstream — see the Drop
  // rule doc on parseRecruiteeResponse), not just the url field.
  const offerUrlOffers = parseRecruiteeResponse(
    {
      offers: [
        { title: 'Recruitee domain', careers_url: 'https://channable.recruitee.com/o/good' },
        { title: 'Custom domain', careers_url: 'https://careers.hostaway.com/o/senior-backend' },
        { title: 'Insecure', careers_url: 'http://channable.recruitee.com/o/insecure' },
        { title: 'No URL field' },
      ],
    },
    'Channable',
  );
  if (
    offerUrlOffers.length === 2 &&
    offerUrlOffers[0]?.url === 'https://channable.recruitee.com/o/good' &&
    offerUrlOffers[1]?.url === 'https://careers.hostaway.com/o/senior-backend'
  ) {
    pass('parseRecruiteeResponse keeps custom-domain https URLs, drops offers with non-https or missing URL entirely');
  } else {
    fail(`URL validation: got ${offerUrlOffers.length} offer(s) = ${JSON.stringify(offerUrlOffers)}`);
  }

  // fetch() — derives the API URL, forwards the SSRF guard (redirect:'error'),
  // and returns parsed offers.
  let fetchedUrl = null;
  let fetchedOpts = null;
  const fetchJobs = await recruitee.fetch(
    { name: 'Channable', careers_url: 'https://channable.recruitee.com/' },
    { fetchJson: async (url, opts) => { fetchedUrl = url; fetchedOpts = opts; return { offers: [{ title: 'Senior PM', careers_url: 'https://channable.recruitee.com/o/senior-pm' }] }; } },
  );
  if (fetchedUrl === 'https://channable.recruitee.com/api/offers/' && fetchedOpts?.redirect === 'error' && fetchJobs.length === 1) {
    pass('recruitee.fetch() hits /api/offers/ with redirect:"error" and returns parsed offers');
  } else {
    fail(`recruitee.fetch() url=${JSON.stringify(fetchedUrl)} opts=${JSON.stringify(fetchedOpts)} jobs=${fetchJobs.length}`);
  }

  // fetch() refuses entries whose careers_url can't derive a trusted
  // <slug>.recruitee.com API URL — the guard chain must run before any request.
  try {
    await recruitee.fetch(
      { name: 'Evil', careers_url: 'https://evil.example.com/careers' },
      { fetchJson: async () => { throw new Error('must not be called'); } },
    );
    fail('recruitee.fetch() should throw for an untrusted careers_url');
  } catch (e) {
    if (/cannot derive API URL for Evil/.test(e.message)) {
      pass('recruitee.fetch() throws before fetching when the host is untrusted');
    } else {
      fail(`recruitee.fetch() threw the wrong error: ${e.message}`);
    }
  }

  // ── Description (#3175 phase 2) ──
  // Recruitee's list payload embeds each offer's HTML body for free — same
  // request, no per-job fetch. It must arrive as plain text (tags stripped,
  // entities decoded), and offers without a body omit the key entirely.
  const descOffers = parseRecruiteeResponse(
    {
      offers: [
        {
          title: 'With body',
          careers_url: 'https://channable.recruitee.com/o/with-body',
          description: '&lt;p&gt;Build &lt;strong&gt;pipelines&lt;/strong&gt; at Hostaway&amp;rsquo;s HQ&lt;/p&gt;&lt;script&gt;evil()&lt;/script&gt;',
        },
        { title: 'Without body', careers_url: 'https://channable.recruitee.com/o/no-body' },
        { title: 'Empty body', careers_url: 'https://channable.recruitee.com/o/empty-body', description: '   ' },
      ],
    },
    'Channable',
  );
  if (descOffers[0]?.description === "Build pipelines at Hostaway\u2019s HQ") {
    pass('parseRecruiteeResponse double-decodes the offer body to plain text (tags + script gone)');
  } else {
    fail(`row 0 description = ${JSON.stringify(descOffers[0]?.description)}`);
  }
  if (!('description' in descOffers[1]) && !('description' in descOffers[2])) {
    pass('parseRecruiteeResponse omits the description key when the offer has no usable body');
  } else {
    fail(`rows 1-2 = ${JSON.stringify(descOffers.slice(1))}`);
  }

  // ── Demo-tenant filtering (#4190) ──────────────────────────────────────────
  // Recruitee itself stamps "(Sample)" on its own seeded posting — captured
  // live, byte-identical, from two unrelated tenants (adecco, accenture).
  const demoOffers = parseRecruiteeResponse(
    {
      offers: [
        { title: 'Senior Marketer (Sample)', careers_url: 'https://exampleco.recruitee.com/o/sample' },
        { title: 'senior marketer (sample)', careers_url: 'https://exampleco.recruitee.com/o/lowercase' },
        { title: 'Real Backend Engineer', careers_url: 'https://exampleco.recruitee.com/o/real' },
      ],
    },
    'ExampleCo',
  );
  if (demoOffers.length === 1 && demoOffers[0].title === 'Real Backend Engineer') {
    pass('parseRecruiteeResponse drops any posting whose title carries the "(Sample)" marker, case-insensitively (#4190)');
  } else {
    fail(`parseRecruiteeResponse demo-filter kept ${demoOffers.length} offers: ${JSON.stringify(demoOffers.map(o => o.title))}`);
  }

  // Negative control: a real title merely containing the word "sample"
  // without parentheses (e.g. a QA/sample-testing role) must survive — the
  // marker is specifically the parenthesized "(Sample)" tag, not the word.
  const realSampleWord = parseRecruiteeResponse(
    { offers: [{ title: 'Sample Preparation Technician', careers_url: 'https://acme.recruitee.com/o/1' }] },
    'Acme',
  );
  if (realSampleWord.length === 1) {
    pass('parseRecruiteeResponse keeps a real title containing "sample" without the "(Sample)" tag');
  } else {
    fail('parseRecruiteeResponse should only match the parenthesized "(Sample)" marker, not the bare word');
  }

  // A tenant whose ONLY posting is the seeded sample must resolve as empty —
  // this is what makes discover-ats.mjs's existing "empty board" handling
  // apply automatically, with no changes needed there.
  const onlySample = parseRecruiteeResponse(
    { offers: [{ title: 'Senior Marketer (Sample)', careers_url: 'https://deadtenant.recruitee.com/o/sample' }] },
    'Dead Tenant',
  );
  if (onlySample.length === 0) {
    pass('a tenant serving only the seeded sample posting parses to zero jobs (resolves as empty upstream)');
  } else {
    fail('a sample-only tenant should parse to zero jobs');
  }

  // ── Multi-location (`locations[]` beats the flat `location` field) ──
  // The flat `location` field carries only the PRIMARY place even when the
  // offer is open in more than one (Zürich hybrid + remote-in-Germany is a
  // shape observed live on a real Recruitee tenant, reproduced here with a
  // fictional company).
  const multiLocOffers = parseRecruiteeResponse(
    {
      offers: [
        {
          title: 'Quality Assurance Engineer',
          careers_url: 'https://acmecorp.recruitee.com/o/quality-assurance-engineer-1',
          location: 'Zürich, Zürich, Switzerland',
          locations: [
            { name: 'Zürich, Switzerland', city: 'Zürich', country: 'Switzerland' },
            { name: 'remote in Germany', city: 'remote', country: 'Germany' },
          ],
        },
        {
          // Single-entry `locations[]` must not override a more useful flat field.
          title: 'Single location array',
          careers_url: 'https://acmecorp.recruitee.com/o/single-location',
          location: 'Remote, EMEA',
          locations: [{ name: 'Remote, EMEA' }],
        },
        {
          // No usable `.name` values → falls back to the flat field.
          title: 'Unusable locations array',
          careers_url: 'https://acmecorp.recruitee.com/o/unusable-locations',
          location: 'Berlin, Germany',
          locations: [{ city: 'Berlin' }, { name: 42 }],
        },
      ],
    },
    'Acme Corp',
  );
  if (multiLocOffers[0]?.location === 'Zürich, Switzerland · remote in Germany') {
    pass('parseRecruiteeResponse joins locations[] with " · " when it lists 2+ places');
  } else {
    fail(`row 0 location = ${JSON.stringify(multiLocOffers[0]?.location)}`);
  }
  if (multiLocOffers[1]?.location === 'Remote, EMEA') {
    pass('parseRecruiteeResponse keeps the flat location field when locations[] has only 1 place');
  } else {
    fail(`row 1 location = ${JSON.stringify(multiLocOffers[1]?.location)}`);
  }
  if (multiLocOffers[2]?.location === 'Berlin, Germany') {
    pass('parseRecruiteeResponse falls back to the flat field when locations[] has no usable names');
  } else {
    fail(`row 2 location = ${JSON.stringify(multiLocOffers[2]?.location)}`);
  }

  // Dedup: a tenant repeating the same place twice in locations[] must not
  // surface it twice in the joined string.
  const dedupOffers = parseRecruiteeResponse(
    {
      offers: [
        {
          title: 'Duplicate places',
          careers_url: 'https://x.recruitee.com/o/duplicate-places',
          locations: [{ name: 'Berlin, Germany' }, { name: 'Berlin, Germany' }, { name: 'Remote' }],
        },
      ],
    },
    'X',
  );
  if (dedupOffers[0]?.location === 'Berlin, Germany · Remote') {
    pass('parseRecruiteeResponse dedupes repeated locations[] names');
  } else {
    fail(`dedup row location = ${JSON.stringify(dedupOffers[0]?.location)}`);
  }

  // ── Defensive parsing: title is a required field (ADDING_A_PROVIDER.md) ──
  // A row missing/blank `title` is dropped, never emitted half-formed with
  // `title: ''` — same convention as ibm.mjs / eightfold.mjs. Every row here
  // carries a valid `careers_url` so only the title check is under test (a
  // missing/invalid URL is covered separately by the "URL validation" case
  // above, which now drops the whole offer).
  const titleDropOffers = parseRecruiteeResponse(
    {
      offers: [
        { title: 'Real Offer', careers_url: 'https://channable.recruitee.com/o/real' },
        { careers_url: 'https://channable.recruitee.com/o/no-title' },
        { title: '', careers_url: 'https://channable.recruitee.com/o/blank-title' },
        { title: '   ', careers_url: 'https://channable.recruitee.com/o/whitespace-title' },
        { title: 42, careers_url: 'https://channable.recruitee.com/o/non-string-title' },
      ],
    },
    'Channable',
  );
  if (titleDropOffers.length === 1 && titleDropOffers[0]?.title === 'Real Offer') {
    pass('parseRecruiteeResponse drops offers with no usable title (missing, blank, whitespace-only, non-string)');
  } else {
    fail(`title-drop: got ${titleDropOffers.length} offer(s) = ${JSON.stringify(titleDropOffers)}`);
  }

  // ── Malformed offer entries (null / primitive) don't crash the whole batch ──
  // A single bad entry in offers[] must not throw out of fetch() and lose
  // every other offer in the response.
  const malformedEntryOffers = parseRecruiteeResponse(
    {
      offers: [
        null,
        { title: 'Valid Before', careers_url: 'https://x.recruitee.com/o/valid-before' },
        undefined,
        'not an object',
        42,
        { title: 'Valid After', careers_url: 'https://x.recruitee.com/o/valid-after' },
      ],
    },
    'X',
  );
  if (
    malformedEntryOffers.length === 2 &&
    malformedEntryOffers[0]?.title === 'Valid Before' &&
    malformedEntryOffers[1]?.title === 'Valid After'
  ) {
    pass('parseRecruiteeResponse skips null/undefined/primitive offer entries without crashing');
  } else {
    fail(`malformed-entry: got ${malformedEntryOffers.length} offer(s) = ${JSON.stringify(malformedEntryOffers)}`);
  }

  // ── locations[] with only duplicate names falls back to the flat field ──
  // Distinct-count, not raw-count: 2 entries naming the SAME place must not
  // "join" down to that one place when the flat `location` field is richer.
  const dupNameFallback = parseRecruiteeResponse(
    {
      offers: [
        {
          title: 'Duplicate name, richer flat field',
          careers_url: 'https://x.recruitee.com/o/dup-name-fallback',
          location: 'Berlin, Germany (HQ office)',
          locations: [{ name: 'Berlin, Germany' }, { name: 'Berlin, Germany' }],
        },
      ],
    },
    'X',
  );
  if (dupNameFallback[0]?.location === 'Berlin, Germany (HQ office)') {
    pass('parseRecruiteeResponse falls back to the flat field when locations[] names are all the same place');
  } else {
    fail(`dup-name-fallback location = ${JSON.stringify(dupNameFallback[0]?.location)}`);
  }

  // ── Country is appended to a bare location name, without duplicating it ──
  const countryOffers = parseRecruiteeResponse(
    {
      offers: [
        {
          // Bare city names with no country baked in — country appended.
          title: 'Bare city names',
          careers_url: 'https://x.recruitee.com/o/bare-city-names',
          locations: [
            { name: 'Berlin', country: 'Germany' },
            { name: 'Paris', country: 'France' },
          ],
        },
        {
          // Name already contains the country (case-insensitive) — not duplicated.
          title: 'Country already in name',
          careers_url: 'https://x.recruitee.com/o/country-already-in-name',
          locations: [
            { name: 'Zürich, Switzerland', country: 'Switzerland' },
            { name: 'remote in Germany', country: 'Germany' },
          ],
        },
      ],
    },
    'X',
  );
  if (countryOffers[0]?.location === 'Berlin, Germany · Paris, France') {
    pass('parseRecruiteeResponse appends country to a bare location name');
  } else {
    fail(`bare-city location = ${JSON.stringify(countryOffers[0]?.location)}`);
  }
  if (countryOffers[1]?.location === 'Zürich, Switzerland · remote in Germany') {
    pass('parseRecruiteeResponse does not duplicate a country already present in the location name');
  } else {
    fail(`no-duplicate-country location = ${JSON.stringify(countryOffers[1]?.location)}`);
  }

  // ── Top-level `remote` flag is honored in the joined multi-place path ──
  // `remote` is a separate signal from the named places: a fully-remote role
  // across 2+ named countries, none of which literally say "remote", must
  // still surface as remote. Never duplicated when a place name already says so.
  const remoteFlagOffers = parseRecruiteeResponse(
    {
      offers: [
        {
          // remote: true, no place name says "remote" → appended once.
          title: 'Fully remote across countries',
          careers_url: 'https://x.recruitee.com/o/fully-remote',
          remote: true,
          locations: [{ name: 'Berlin, Germany' }, { name: 'Paris, France' }],
        },
        {
          // remote: true, but a place name already says "remote" → not duplicated.
          title: 'Remote already named',
          careers_url: 'https://x.recruitee.com/o/remote-already-named',
          remote: true,
          locations: [{ name: 'Zürich, Switzerland' }, { name: 'remote in Germany' }],
        },
        {
          // remote: false → never appended, even with 2+ distinct places.
          title: 'Not remote',
          careers_url: 'https://x.recruitee.com/o/not-remote',
          remote: false,
          locations: [{ name: 'Berlin, Germany' }, { name: 'Paris, France' }],
        },
      ],
    },
    'X',
  );
  if (remoteFlagOffers[0]?.location === 'Berlin, Germany · Paris, France · Remote') {
    pass('parseRecruiteeResponse appends "Remote" to the joined location when remote:true and no place name says so');
  } else {
    fail(`remote-flag-append location = ${JSON.stringify(remoteFlagOffers[0]?.location)}`);
  }
  if (remoteFlagOffers[1]?.location === 'Zürich, Switzerland · remote in Germany') {
    pass('parseRecruiteeResponse does not duplicate "Remote" when a joined place name already says so');
  } else {
    fail(`remote-flag-no-dup location = ${JSON.stringify(remoteFlagOffers[1]?.location)}`);
  }
  if (remoteFlagOffers[2]?.location === 'Berlin, Germany · Paris, France') {
    pass('parseRecruiteeResponse never appends "Remote" when remote:false');
  } else {
    fail(`remote-flag-false location = ${JSON.stringify(remoteFlagOffers[2]?.location)}`);
  }

  // ── City is appended to a non-geographic location name, without duplicating it ──
  // Uses internal/non-place labels (not city or country names themselves) so
  // the city-append logic is exercised independently of the name text.
  const cityOffers = parseRecruiteeResponse(
    {
      offers: [
        {
          // Name is an internal label with no city/country baked in — both appended.
          title: 'Internal building label',
          careers_url: 'https://x.recruitee.com/o/internal-building-label',
          locations: [
            { name: 'Building A', city: 'Berlin', country: 'Germany' },
            { name: 'Building B', city: 'Paris', country: 'France' },
          ],
        },
        {
          // City already present in the name (case-insensitive) — not duplicated;
          // country still gets appended independently.
          title: 'City already in name',
          careers_url: 'https://x.recruitee.com/o/city-already-in-name',
          locations: [
            { name: 'Berlin Office', city: 'Berlin', country: 'Germany' },
            { name: 'Paris HQ', city: 'Paris', country: 'France' },
          ],
        },
      ],
    },
    'X',
  );
  if (cityOffers[0]?.location === 'Building A, Berlin, Germany · Building B, Paris, France') {
    pass('parseRecruiteeResponse appends city (and country) to a non-geographic location name');
  } else {
    fail(`city-append location = ${JSON.stringify(cityOffers[0]?.location)}`);
  }
  if (cityOffers[1]?.location === 'Berlin Office, Germany · Paris HQ, France') {
    pass('parseRecruiteeResponse does not duplicate a city already present in the location name, but still appends country');
  } else {
    fail(`city-no-dup location = ${JSON.stringify(cityOffers[1]?.location)}`);
  }

  // ── Whole-word matching, not substring: "Parisian" must not shadow "Paris" ──
  // A substring check would wrongly see "paris" inside "parisian" and skip
  // appending the real city. The second offer covers the Unicode-accented edge
  // this fix exists for: "Örebro" sits at the very start of the name, exactly
  // where JS's ASCII-only \b misfires (no boundary between start-of-string and
  // a non-ASCII letter) — so the city must be recognized as already present and
  // NOT duplicated, proving the Unicode-aware lookaround actually works there.
  const nearMissOffers = parseRecruiteeResponse(
    {
      offers: [
        {
          title: 'Near-miss substring, not a real mention',
          careers_url: 'https://x.recruitee.com/o/near-miss',
          locations: [
            { name: 'Parisian HQ', city: 'Paris', country: 'France' },
            { name: 'Örebro Office', city: 'Örebro', country: 'Sweden' },
          ],
        },
      ],
    },
    'X',
  );
  if (nearMissOffers[0]?.location === 'Parisian HQ, Paris, France · Örebro Office, Sweden') {
    pass('parseRecruiteeResponse appends a near-miss city ("Paris" in "Parisian HQ") and does not duplicate an accented city already at the start of the name ("Örebro" in "Örebro Office")');
  } else {
    fail(`near-miss location = ${JSON.stringify(nearMissOffers[0]?.location)}`);
  }

  // ── URL fallback: careers_url and url are validated independently ──
  // One bad field must not shadow an otherwise-usable other one — only when
  // NEITHER candidate resolves is the offer dropped.
  const urlFallbackOffers = parseRecruiteeResponse(
    {
      offers: [
        {
          // careers_url is non-https (invalid) but url is a valid https URL — kept via fallback.
          title: 'Invalid careers_url, valid url',
          careers_url: 'http://x.recruitee.com/o/insecure',
          url: 'https://x.recruitee.com/o/valid-fallback',
        },
        {
          // careers_url is malformed but url is valid — kept via fallback.
          title: 'Malformed careers_url, valid url',
          careers_url: 'not a url',
          url: 'https://x.recruitee.com/o/valid-fallback-2',
        },
        {
          // Both invalid — dropped.
          title: 'Both invalid',
          careers_url: 'http://x.recruitee.com/o/insecure-2',
          url: 'not a url either',
        },
      ],
    },
    'X',
  );
  if (urlFallbackOffers.length === 2 && urlFallbackOffers[0]?.url === 'https://x.recruitee.com/o/valid-fallback' && urlFallbackOffers[1]?.url === 'https://x.recruitee.com/o/valid-fallback-2') {
    pass('parseRecruiteeResponse falls back to url when careers_url is invalid, and drops the offer only when both are invalid');
  } else {
    fail(`url-fallback: got ${urlFallbackOffers.length} offer(s) = ${JSON.stringify(urlFallbackOffers)}`);
  }

} catch (e) {
  fail(`recruitee provider tests crashed: ${e.message}`);
}

