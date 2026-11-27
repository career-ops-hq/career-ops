// tests/providers/breezy.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — breezy');


try {
  const breezyModule = await import(pathToFileURL(join(ROOT, 'providers/breezy.mjs')).href);
  const breezy = breezyModule.default;
  const { parseBreezyResponse } = breezyModule;

  if (breezy.id === 'breezy') pass('breezy.id is "breezy"');
  else fail(`breezy.id is ${JSON.stringify(breezy.id)}`);

  // detect: careers_url with a path still resolves the tenant /json feed
  const hit = breezy.detect({ name: 'New Incentives', careers_url: 'https://new-incentives.breezy.hr/' });
  if (hit && hit.url === 'https://new-incentives.breezy.hr/json') {
    pass('breezy.detect() resolves <tenant>.breezy.hr → /json feed');
  } else {
    fail(`breezy.detect() returned ${JSON.stringify(hit)}`);
  }

  // detect: explicit api: URL is honoured over careers_url
  const apiHit = breezy.detect({ name: 'X', api: 'https://acme.breezy.hr', careers_url: 'https://example.com' });
  if (apiHit && apiHit.url === 'https://acme.breezy.hr/json') {
    pass('breezy.detect() honours an explicit api: URL');
  } else {
    fail(`breezy.detect() api: → ${JSON.stringify(apiHit)}`);
  }

  if (breezy.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('breezy.detect() returns null for non-breezy URLs');
  } else {
    fail('breezy.detect() should return null for non-breezy URLs');
  }

  if (breezy.detect({ name: 'X', careers_url: null }) === null && breezy.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('breezy.detect() returns null for non-string careers_url (null and 7)');
  } else {
    fail('breezy.detect() should treat non-string careers_url as missing');
  }

  // SSRF: breezy.hr in the PATH (not host) must not be detected.
  if (breezy.detect({ name: 'Spoof', careers_url: 'https://evil.example/acme.breezy.hr/json' }) === null) {
    pass('breezy.detect() rejects path-spoofed URLs');
  } else {
    fail('breezy.detect() must NOT misdetect path-spoofed URLs');
  }

  // parseBreezyResponse — top-level array
  const sample = [
    {
      name: 'Assistant Field Manager',
      url: 'https://new-incentives.breezy.hr/p/b8e6-assistant-field-manager',
      published_date: '2026-05-25T14:45:23.799Z',
      location: { name: 'Niger, Sokoto, NG', city: 'Niger', country: { name: 'NG' }, is_remote: false },
    },
    {
      name: 'Remote Backend Engineer',
      url: 'https://new-incentives.breezy.hr/p/aa01-backend',
      location: { city: 'Lagos', state: 'Lagos', country: { name: 'NG' }, is_remote: true },
    },
    { name: 'No URL row', location: { name: 'Remote' } },
    { name: 'Insecure URL', url: 'http://new-incentives.breezy.hr/p/x', location: {} },
  ];
  const jobs = parseBreezyResponse(sample, 'New Incentives');

  if (jobs.length === 2) pass('parseBreezyResponse keeps 2 rows (drops missing/non-https url)');
  else fail(`parseBreezyResponse returned ${jobs.length} rows (expected 2)`);

  if (jobs[0]?.title === 'Assistant Field Manager' && jobs[0]?.company === 'New Incentives' && jobs[0]?.location === 'Niger, Sokoto, NG') {
    pass('parseBreezyResponse prefers ready-made location.name');
  } else {
    fail(`row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[0]?.postedAt === Date.parse('2026-05-25T14:45:23.799Z')) {
    pass('parseBreezyResponse parses published_date → postedAt');
  } else {
    fail(`row 0 postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  if (jobs[1]?.location === 'Lagos, Lagos, NG, Remote') {
    pass('parseBreezyResponse assembles city/state/country and appends Remote');
  } else {
    fail(`row 1 location = ${JSON.stringify(jobs[1]?.location)}, expected "Lagos, Lagos, NG, Remote"`);
  }

  // A ready-made name without the country ("Seattle, WA") gets country.name
  // folded in, so a location_filter.block on "United States" can see it.
  const countryJobs = parseBreezyResponse([
    {
      name: 'Staff Engineer',
      url: 'https://acme.breezy.hr/p/c0de-staff',
      location: { name: 'Seattle, WA', city: 'Seattle', state: 'WA', country: { name: 'United States' }, is_remote: true },
    },
  ], 'Acme');
  if (countryJobs[0]?.location === 'Seattle, WA, United States, Remote') {
    pass('parseBreezyResponse appends country.name to a location.name that lacks it');
  } else {
    fail(`country-fold location = ${JSON.stringify(countryJobs[0]?.location)}, expected "Seattle, WA, United States, Remote"`);
  }

  if (jobs[1]?.postedAt === undefined) {
    pass('parseBreezyResponse omits postedAt when published_date is absent');
  } else {
    fail(`row 1 postedAt should be undefined, got ${JSON.stringify(jobs[1]?.postedAt)}`);
  }

  // Empty vs broken (#6906, ADDING_A_PROVIDER.md "Defensive parsing"): only the
  // documented container, present and empty, is an empty board. Any other body
  // throws, naming the keys (or the type) it got.
  {
    const emptyBoard = parseBreezyResponse([], 'X');
    if (Array.isArray(emptyBoard) && emptyBoard.length === 0) pass('parseBreezyResponse returns [] for []');
    else fail(`parseBreezyResponse [] → ${JSON.stringify(emptyBoard)}`);
    let brokenOk = true;
    for (const [body, got] of [[{}, '[]'], [{ error: 'rate limited' }, '[error]'], ['oops', '[string]'], [null, '[null]']]) {
      let out;
      let err = null;
      try { out = parseBreezyResponse(body, 'X'); } catch (e) { err = e; }
      const msg = String(err?.message || '');
      if (!err || !msg.startsWith('breezy: unexpected response for X') || !msg.includes(`got: ${got}`)) {
        brokenOk = false;
        fail(`parseBreezyResponse body=${JSON.stringify(body)} should throw naming ${got}; got ${err ? JSON.stringify(msg) : `a return of ${JSON.stringify(out)}`}`);
        break;
      }
    }
    if (brokenOk) pass('parseBreezyResponse throws, naming what it got, for a body that is not a board');
  }

  // a row already containing "Remote" must not get a duplicate "Remote" suffix
  const noDup = parseBreezyResponse([{ name: 'R', url: 'https://acme.breezy.hr/p/r', location: { name: 'Remote, EMEA', is_remote: true } }], 'X');
  if (noDup[0]?.location === 'Remote, EMEA') pass('parseBreezyResponse does not double-append Remote');
  else fail(`expected "Remote, EMEA", got ${JSON.stringify(noDup[0]?.location)}`);

  // Work models as live boards list them (2026-11-26): `is_remote` is true for
  // a hybrid position as well as a remote one, and `location.remote_details`
  // says which: `value` is "hybrid", "remote" or "remote-location", and `label`
  // is free text in the position's language. Reading `is_remote` alone called
  // a hybrid position Remote.
  {
    const hybridDetails = { value: 'hybrid', label: 'Hybrid (Some remote, some in person)' };
    const bordeaux = { name: 'Bordeaux, FR', city: 'Bordeaux', state: null, country: { name: 'France', id: 'FR' }, is_remote: true };
    const [hybrid, remoteInPlace, remoteAnywhere, flagOnly, valueOnly, saysHybrid, placeless] = parseBreezyResponse([
      { name: 'Data Engineer', url: 'https://acme.breezy.hr/p/a1-data-engineer', location: { ...bordeaux, remote_details: hybridDetails } },
      { name: 'Games Producer', url: 'https://acme.breezy.hr/p/a2-games-producer',
        location: { ...bordeaux, remote_details: { value: 'remote-location', label: 'Fully remote, within chosen location(s)' } } },
      { name: 'Cloud Engineer', url: 'https://acme.breezy.hr/p/a3-cloud-engineer',
        location: { name: 'San Jose, CA', city: 'San Jose', state: { id: 'CA', name: 'California' }, country: { name: 'United States', id: 'US' },
          is_remote: true, remote_details: { value: 'remote', label: 'Fully remote, no location restrictions' } } },
      { name: 'Support Agent', url: 'https://acme.breezy.hr/p/a4-support-agent',
        location: { name: 'Lisbon, PT', city: 'Lisbon', country: { name: 'Portugal', id: 'PT' }, is_remote: true } },
      { name: 'Account Manager', url: 'https://acme.breezy.hr/p/a5-account-manager',
        location: { name: 'Calgary, AB', city: 'Calgary', country: { name: 'Canada', id: 'CA' }, is_remote: true, remote_details: { value: 'hybrid' } } },
      { name: 'Field Engineer', url: 'https://acme.breezy.hr/p/a6-field-engineer',
        location: { name: 'Austin, TX (Hybrid)', city: 'Austin', country: { name: 'United States', id: 'US' }, is_remote: true, remote_details: hybridDetails } },
      { name: 'Analyst', url: 'https://acme.breezy.hr/p/a7-analyst', location: { is_remote: true, remote_details: hybridDetails } },
    ], 'Acme');

    if (hybrid?.location === 'Bordeaux, FR, France, Hybrid') pass('parseBreezyResponse says Hybrid, not Remote, for a hybrid position');
    else fail(`hybrid position location was ${JSON.stringify(hybrid?.location)}, expected "Bordeaux, FR, France, Hybrid"`);

    if (remoteInPlace?.location === 'Bordeaux, FR, France, Remote' && remoteAnywhere?.location === 'San Jose, CA, United States, Remote') {
      pass('parseBreezyResponse keeps Remote for a remote position, within a place or not');
    } else {
      fail(`remote positions were ${JSON.stringify([remoteInPlace?.location, remoteAnywhere?.location])}, expected "Bordeaux, FR, France, Remote" and "San Jose, CA, United States, Remote"`);
    }

    if (flagOnly?.location === 'Lisbon, PT, Portugal, Remote') pass('parseBreezyResponse keeps Remote for is_remote without remote_details');
    else fail(`is_remote without remote_details was ${JSON.stringify(flagOnly?.location)}, expected "Lisbon, PT, Portugal, Remote"`);

    if (valueOnly?.location === 'Calgary, AB, Canada, Hybrid') pass('parseBreezyResponse reads the work model from remote_details.value, not its label');
    else fail(`hybrid position without a label was ${JSON.stringify(valueOnly?.location)}, expected "Calgary, AB, Canada, Hybrid"`);

    if (saysHybrid?.location === 'Austin, TX (Hybrid), United States') pass('parseBreezyResponse does not append Hybrid to a place that already says it');
    else fail(`place that says Hybrid was ${JSON.stringify(saysHybrid?.location)}, expected "Austin, TX (Hybrid), United States"`);

    if (placeless?.location === 'Hybrid') pass('parseBreezyResponse gives a hybrid position with no place the location "Hybrid"');
    else fail(`placeless hybrid position was ${JSON.stringify(placeless?.location)}, expected "Hybrid"`);

    const { buildLocationFilter } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
    const keeps = (config, job) => buildLocationFilter(config)(job?.location, job?.url, job?.title, job);
    if (!keeps({ allow: ['Remote'] }, hybrid) && keeps({ allow: ['Remote'] }, remoteInPlace)) {
      pass('location_filter allow: [Remote] drops a hybrid position and keeps a remote one');
    } else {
      fail(`location_filter allow: [Remote] gave hybrid ${keeps({ allow: ['Remote'] }, hybrid)}, remote ${keeps({ allow: ['Remote'] }, remoteInPlace)}`);
    }
    if (!keeps({ block: ['Hybrid'] }, hybrid) && keeps({ block: ['Hybrid'] }, remoteInPlace)) {
      pass('location_filter block: [Hybrid] drops a hybrid position and keeps a remote one');
    } else {
      fail(`location_filter block: [Hybrid] gave hybrid ${keeps({ block: ['Hybrid'] }, hybrid)}, remote ${keeps({ block: ['Hybrid'] }, remoteInPlace)}`);
    }
    const policy = { workplace_policy: { onsite_locations: ['Paris'], remote_countries: ['France'] } };
    if (!keeps(policy, hybrid) && keeps(policy, remoteInPlace)) {
      pass('location_filter workplace_policy treats a hybrid position in Bordeaux as on-site, a remote one in France as remote');
    } else {
      fail(`workplace_policy (onsite Paris, remote France) gave hybrid ${keeps(policy, hybrid)}, remote ${keeps(policy, remoteInPlace)}`);
    }
  }

} catch (e) {
  fail(`breezy provider tests crashed: ${e.message}`);
}

