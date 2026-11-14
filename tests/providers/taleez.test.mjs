// tests/providers/taleez.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — taleez');

try {
  const taleezModule = await import(pathToFileURL(join(ROOT, 'providers/taleez.mjs')).href);
  const taleez = taleezModule.default;
  const { parseTaleezResponse, taleezListingIdentity } = taleezModule;

  if (taleez.id === 'taleez') pass('taleez.id is "taleez"');
  else fail(`taleez.id is ${JSON.stringify(taleez.id)}`);

  // ── detect() ──
  {
    const hit = taleez.detect({ name: 'Acme', careers_url: 'https://acme.taleez.com/' });
    if (hit && hit.url === 'https://acme.taleez.com/api/careez') pass('detect() resolves <tenant>.taleez.com → /api/careez');
    else fail(`detect() returned ${JSON.stringify(hit)}`);

    const withPath = taleez.detect({ name: 'Acme', careers_url: 'https://acme.taleez.com/some/page?x=1#top' });
    if (withPath && withPath.url === 'https://acme.taleez.com/api/careez') pass('detect() discards the input path, query and fragment');
    else fail(`detect() with a path returned ${JSON.stringify(withPath)}`);

    const apiHit = taleez.detect({ name: 'Acme', api: 'https://exampleco.taleez.com/api/careez', careers_url: 'https://example.com' });
    if (apiHit && apiHit.url === 'https://exampleco.taleez.com/api/careez') pass('detect() honours an explicit api: URL');
    else fail(`detect() api: → ${JSON.stringify(apiHit)}`);

    const misses = [
      ['non-taleez host', { careers_url: 'https://example.com/careers' }],
      ['path-spoofed host', { careers_url: 'https://evil.example/acme.taleez.com' }],
      ['suffix-spoofed host', { careers_url: 'https://acme.taleez.com.evil.example/' }],
      ['look-alike domain', { careers_url: 'https://acme.eviltaleez.com/' }],
      ['hyphen instead of dot', { careers_url: 'https://acme-taleez.com/' }],
      ['no dot before the vendor domain', { careers_url: 'https://acmetaleez.com/' }],
      ['nested subdomain', { careers_url: 'https://a.b.taleez.com/' }],
      ['any character for the last dot', { careers_url: 'https://acme.taleezxcom/' }],
      ['non-https', { careers_url: 'http://acme.taleez.com/' }],
      ['malformed URL', { careers_url: 'not a url' }],
      ['bare vendor domain', { careers_url: 'https://taleez.com/apply/some-job' }],
      ...['www', 'app', 'api', 'blog', 'files', 'static', 'help', 'aide', 'status']
        .map((sub) => [`vendor subdomain ${sub}`, { careers_url: `https://${sub}.taleez.com/` }]),
      ['null careers_url', { careers_url: null }],
      ['numeric careers_url', { careers_url: 7 }],
      ['missing careers_url', {}],
    ];
    let allNull = true;
    for (const [label, extra] of misses) {
      let out;
      try {
        out = taleez.detect({ name: 'X', ...extra });
      } catch (e) {
        allNull = false;
        fail(`detect() threw on ${label}: ${e.message}`);
        continue;
      }
      if (out !== null) {
        allNull = false;
        fail(`detect() should return null for ${label}, got ${JSON.stringify(out)}`);
      }
    }
    if (allNull) pass('detect() returns null, without throwing, for every untrusted or unusable input');
    if (taleez.detect(null) === null && taleez.detect(undefined) === null) pass('detect() returns null for a null/undefined entry');
    else fail('detect() should return null for a null/undefined entry');
  }

  // ── fetch(): request shape and SSRF guard ──
  const sitePayload = {
    id: 1951,
    name: 'EXAMPLECO',
    url: 'https://exampleco.taleez.com',
    jobs: [
      {
        id: 586128,
        creationDate: 1787747773000,
        publishDate: 1794585015000,
        label: 'Directeur de magasin H/F',
        slug: 'directeur-de-magasin-h-f-issy-les-moulineaux-exampleco-cdi-1',
        contract: 'CDI',
        location: {
          locationType: 'CITY',
          postalCode: '92130',
          city: 'Issy-les-Moulineaux',
          department: 'Hauts-de-Seine',
          region: 'Île-de-France',
          country: 'FR',
        },
        lang: 'FR',
        remote: false,
      },
      {
        id: 591837,
        publishDate: 1789376901000,
        label: 'Backend Engineer (H/F)',
        slug: 'backend-engineer-h-f-toulouse-exampleco-cdi',
        location: { city: 'Toulouse', region: 'Occitanie', country: 'FR' },
        lang: 'EN',
        remote: true,
      },
      { id: 3, label: '', slug: 'empty-title' },
      { id: 4, label: 'No slug' },
      { id: 5, label: 'Numeric slug', slug: 42 },
      null,
      'not a row',
    ],
  };

  {
    const calls = [];
    const ctx = { fetchJson: async (url, opts) => { calls.push({ url, opts }); return sitePayload; } };
    const jobs = await taleez.fetch({ name: 'ExampleCo', careers_url: 'https://exampleco.taleez.com/' }, ctx);
    if (calls.length === 1 && calls[0].url === 'https://exampleco.taleez.com/api/careez') pass('fetch() makes exactly one request, to <tenant>.taleez.com/api/careez');
    else fail(`fetch() calls = ${JSON.stringify(calls)}`);
    if (calls.every((c) => c.opts?.redirect === 'error')) pass("fetch() passes redirect: 'error'");
    else fail(`fetch() redirect opts = ${JSON.stringify(calls.map((c) => c.opts))}`);
    if (jobs.length === 2) pass('fetch() returns the 2 well-formed postings');
    else fail(`fetch() returned ${jobs.length} jobs`);
  }

  {
    let calls = 0;
    const ctx = { fetchJson: async () => { calls++; throw new Error('should never be called'); } };
    let threw = false;
    try {
      await taleez.fetch({ name: 'Spoof', careers_url: 'https://acme.taleez.com.evil.example/' }, ctx);
    } catch (e) {
      threw = /taleez: cannot derive/.test(e.message);
    }
    if (threw && calls === 0) pass('fetch() rejects an untrusted host before any fetchJson call');
    else fail(`fetch() untrusted host: threw=${threw}, fetchJson calls=${calls}`);
  }

  // ── parseTaleezResponse(): normalization ──
  {
    const jobs = parseTaleezResponse(sitePayload, 'ExampleCo', 'exampleco');
    const [a, b] = jobs;
    if (a?.title === 'Directeur de magasin H/F'
        && a?.url === 'https://taleez.com/apply/directeur-de-magasin-h-f-issy-les-moulineaux-exampleco-cdi-1'
        && a?.company === 'ExampleCo') {
      pass('parse: title, apply URL and company');
    } else {
      fail(`parse row 0 = ${JSON.stringify(a)}`);
    }
    if (a?.location === 'Issy-les-Moulineaux, Île-de-France, France') pass('parse: location is city, region, country name (FR → France)');
    else fail(`parse row 0 location = ${JSON.stringify(a?.location)}`);
    if (b?.location === 'Toulouse, Occitanie, France, Remote') pass('parse: remote: true appends "Remote"');
    else fail(`parse row 1 location = ${JSON.stringify(b?.location)}`);
    if (!('workplaceType' in (b || {}))) pass('parse: workplaceType is not inferred from the remote flag');
    else fail(`parse row 1 workplaceType = ${JSON.stringify(b?.workplaceType)}`);
    if (a?.postedAt === 1787747773000) pass('parse: postedAt is creationDate, not the later re-publication publishDate');
    else fail(`parse row 0 postedAt = ${JSON.stringify(a?.postedAt)}`);
    if (b?.postedAt === 1789376901000) pass('parse: postedAt falls back to publishDate when creationDate is absent');
    else fail(`parse row 1 postedAt = ${JSON.stringify(b?.postedAt)}`);
    if (a?.language === 'FR' && b?.language === 'EN') pass('parse: lang → language, as the source names it');
    else fail(`parse languages = ${JSON.stringify([a?.language, b?.language])}`);

    const noDate = parseTaleezResponse({ jobs: [{ id: 9, label: 'T', slug: 's', creationDate: 'last week', publishDate: 'yesterday' }] }, 'X', 'x');
    if (noDate.length === 1 && !('postedAt' in noDate[0])) pass('parse: non-numeric dates leave postedAt off');
    else fail(`parse non-numeric publishDate = ${JSON.stringify(noDate)}`);

    const noLoc = parseTaleezResponse({ jobs: [{ id: 9, label: 'T', slug: 's', remote: true }] }, 'X', 'x');
    if (noLoc[0]?.location === 'Remote') pass('parse: no location object + remote → "Remote"');
    else fail(`parse remote without location = ${JSON.stringify(noLoc[0]?.location)}`);

    const blankSlugs = parseTaleezResponse({ jobs: [{ id: 9, label: 'T', slug: '   ' }, { id: 10, label: 'U', slug: '  ok-10 ' }] }, 'X', 'x');
    if (blankSlugs.length === 1 && blankSlugs[0].url === 'https://taleez.com/apply/ok-10') pass('parse: a whitespace-only slug is dropped, a padded one is trimmed');
    else fail(`parse whitespace slugs = ${JSON.stringify(blankSlugs)}`);

    const remoteVille = parseTaleezResponse({ jobs: [{ id: 9, label: 'T', slug: 's', remote: true, location: { city: 'Remoteville' } }] }, 'X', 'x');
    if (remoteVille[0]?.location === 'Remoteville, Remote') pass('parse: a city merely containing "remote" still gets Remote appended');
    else fail(`parse Remoteville = ${JSON.stringify(remoteVille[0]?.location)}`);

    const dupRemote = parseTaleezResponse({ jobs: [{ id: 9, label: 'T', slug: 's', remote: true, location: { city: 'Remote' } }] }, 'X', 'x');
    if (dupRemote[0]?.location === 'Remote') pass('parse: does not double-append Remote');
    else fail(`parse double Remote = ${JSON.stringify(dupRemote[0]?.location)}`);
  }

  // ── Empty vs broken ──
  {
    const empty = parseTaleezResponse({ name: 'X', jobs: [] }, 'X', 'x');
    if (Array.isArray(empty) && empty.length === 0) pass('parse: a site with jobs: [] is an empty board → []');
    else fail(`parse jobs: [] → ${JSON.stringify(empty)}`);

    let brokenOk = true;
    for (const [body, got] of [
      [{}, '[]'],
      [{ name: 'X', pages: [] }, '[name, pages]'],
      [{ jobs: null }, '[jobs]'],
      [{ jobs: {} }, '[jobs]'],
      ['oops', '[string]'],
      [null, '[null]'],
      [[], '[]'],
    ]) {
      let out;
      let err = null;
      try { out = parseTaleezResponse(body, 'X', 'x'); } catch (e) { err = e; }
      const msg = String(err?.message || '');
      if (!err || !msg.startsWith('taleez: unexpected response for X') || !msg.includes(`got: ${got}`)) {
        brokenOk = false;
        fail(`parse body=${JSON.stringify(body)} should throw naming ${got}; got ${err ? JSON.stringify(msg) : `a return of ${JSON.stringify(out)}`}`);
        break;
      }
    }
    if (brokenOk) pass('parse: throws, naming what it got, for a body that is not a site with jobs[]');
  }

  // ── listingIdentity ──
  {
    const { isOfferSeen, markOfferSeen, listingIdentityToken } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
    const [row] = parseTaleezResponse({ jobs: [{ id: 586128, label: 'Data Engineer', slug: 'data-engineer-paris-acme-cdi' }] }, 'Acme', 'acme');
    const id = row?.listingIdentity;
    if (id?.ats_provider === 'taleez' && id?.board_slug === 'acme' && id?.posting_id === '586128' && Object.keys(id).length === 3) {
      pass('parse: listingIdentity is taleez/<tenant>/<posting id>');
    } else {
      fail(`parse listingIdentity = ${JSON.stringify(id)}`);
    }
    if (row?.externalId === '586128') pass('parse: externalId is the posting id');
    else fail(`parse externalId = ${JSON.stringify(row?.externalId)}`);

    // Taleez re-releases a posting under a new slug (the `-1` suffix in the
    // fixture above): same id, a URL that URL dedup alone treats as new.
    const reslugged = { ...row, url: 'https://taleez.com/apply/data-engineer-paris-acme-cdi-1' };
    const seen = new Set();
    markOfferSeen(row, seen);
    if (isOfferSeen(reslugged, seen)) pass('the same Taleez posting under a re-released slug is already seen');
    else fail('a re-released Taleez slug with the same id was not recognised as the same posting');

    const [other] = parseTaleezResponse({ jobs: [{ id: 586129, label: 'Data Engineer', slug: 'data-engineer-paris-acme-cdi-2' }] }, 'Acme', 'acme');
    if (listingIdentityToken(other) && listingIdentityToken(other) !== listingIdentityToken(row) && !isOfferSeen(other, seen)) {
      pass('a different Taleez posting id on the same board is a different listing');
    } else {
      fail(`other token = ${listingIdentityToken(other)}`);
    }

    const noId = parseTaleezResponse({
      jobs: [
        { label: 'No id', slug: 'a' },
        { id: 0, label: 'Zero id', slug: 'b' },
        { id: '77', label: 'String id', slug: 'c' },
        { id: 1.5, label: 'Fractional id', slug: 'd' },
      ],
    }, 'Acme', 'acme');
    if (noId.length === 4 && noId.every((j) => !('listingIdentity' in j) && !('externalId' in j))) {
      pass('parse: a row without a positive integer id keeps its URL but carries no listingIdentity');
    } else {
      fail(`parse unusable ids = ${JSON.stringify(noId)}`);
    }
    if (taleezListingIdentity('', 5) === undefined) pass('taleezListingIdentity: an empty tenant gives no identity');
    else fail('taleezListingIdentity should return undefined for an empty tenant');
  }
} catch (e) {
  fail(`taleez provider tests crashed: ${e.message}`);
}
