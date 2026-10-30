// tests/sponsor-check.test.mjs — coverage for sponsor-check.mjs, the UK
// Skilled Worker sponsor-licence cross-check.
//
// The defect this script exists to prevent is a FALSE NEGATIVE: a verdict that
// reads as "this employer cannot sponsor you" when all that happened is that
// the register spells the licence holder's legal name differently, or the
// subsidiary hires under a parent's licence, or the licence postdates the
// snapshot. So the assertions here are not only about which rows match — they
// pin the WORDING too: a `not-found` must say UNCONFIRMED and must never say
// the employer does not or cannot sponsor, because that sentence is what would
// make the candidate skip a viable employer.
//
// The rest covers the parts most likely to rot silently:
//   - register parsing: one row per (organisation, route), quoted cells,
//     name+town identity, route/rating extraction
//   - the match tiers, including the two that must NEVER return `licensed`
//     (containment and initialism) and the ones that must (exact, strong,
//     jurisdiction-folded)
//   - cache staleness arithmetic and the corrupt/partial-download guard
//   - GOV.UK Content API attachment selection (the CSV URL is not hardcodable)
//   - tracker/pipeline employer extraction and the resolution roll-up
//   - the CLI: --help, unknown flag, mutually exclusive modes, --offline with
//     no cache, --register for a hermetic run, JSON and --summary shapes
//
// HERMETIC: every CLI case passes --register <fixture> or runs against a
// tmpdir data root, so nothing here touches the network or the real tracker.
// Fictional employers throughout, except where a real registered name is the
// point of the case.
//
// Run:  node --test tests/sponsor-check.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  REGISTER_CONTENT_API,
  REGISTER_FIXTURE,
  annotateCompanies,
  buildRegisterIndex,
  cacheAgeDays,
  extractCompanies,
  extractPipelineCompanies,
  extractTrackerCompanies,
  fetchRegisterCsv,
  initialismCandidates,
  initialismKey,
  isCacheFresh,
  lookupSponsor,
  parseRegister,
  parseTypeRating,
  pickRegisterCsvUrl,
  readCacheMeta,
  refreshCache,
  resolveRegisterColumns,
} from '../sponsor-check.mjs';

const CODE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(CODE_ROOT, 'sponsor-check.mjs');

const index = buildRegisterIndex(parseRegister(REGISTER_FIXTURE).organisations);

// --- 1. Register parsing ----------------------------------------------------

test('parseRegister: folds one row per (organisation, route) into one entry', () => {
  const { organisations } = parseRegister(REGISTER_FIXTURE);
  const wayve = organisations.filter((o) => o.name === 'Wayve Technologies Ltd');
  assert.equal(wayve.length, 1, 'two route rows are one organisation');
  assert.deepEqual(
    wayve[0].routes,
    ['Skilled Worker', 'Global Business Mobility: Senior or Specialist Worker'],
  );
  assert.equal(wayve[0].skilledWorker, true);
  assert.equal(wayve[0].rating, 'A');
});

test('parseRegister: a quoted cell containing a comma does not shift the columns', () => {
  const { organisations } = parseRegister(REGISTER_FIXTURE);
  const northwind = organisations.find((o) => o.name === 'Northwind Robotics Limited');
  assert.equal(northwind.town, 'Colchester', 'a trailing separator inside the quoted cell is not published as data');
  assert.equal(northwind.county, 'Essex');
  assert.deepEqual(northwind.routes, ['Skilled Worker']);
});

test('parseRegister: same name in two towns stays two licence holders', () => {
  const { organisations } = parseRegister(REGISTER_FIXTURE);
  const acme = organisations.filter((o) => o.name === 'Acme Ltd');
  assert.equal(acme.length, 2);
  assert.deepEqual(acme.map((o) => o.town).sort(), ['Bristol', 'Leeds']);
});

test('parseRegister: a leading space in the name column is trimmed, as the live file has', () => {
  const { organisations } = parseRegister(REGISTER_FIXTURE);
  assert.ok(organisations.some((o) => o.name === 'Wayve Technologies Ltd'));
  assert.ok(!organisations.some((o) => o.name.startsWith(' ')));
});

test('parseRegister: refuses a CSV with no organisation-name column instead of reading by position', () => {
  assert.throws(
    () => parseRegister('Foo,Bar\nbaz,qux\n'),
    /no recognizable organisation-name column/,
  );
});

test('parseRegister: an empty file yields no organisations rather than throwing', () => {
  const parsed = parseRegister('');
  assert.deepEqual(parsed.organisations, []);
  assert.equal(parsed.rowCount, 0);
});

test('resolveRegisterColumns: columns are resolved by NAME, so a reorder cannot shift fields', () => {
  const colmap = resolveRegisterColumns(['Route', 'Organisation Name', 'County', 'Town/City', 'Type & Rating']);
  assert.equal(colmap.name, 1);
  assert.equal(colmap.route, 0);
  assert.equal(colmap.town, 3);
  assert.equal(colmap.rating, 4);
});

test('parseTypeRating: the rating letter is extracted, the published cell kept verbatim', () => {
  assert.deepEqual(parseTypeRating('Worker (A rating)'), { raw: 'Worker (A rating)', type: 'Worker', rating: 'A' });
  assert.deepEqual(parseTypeRating('Temporary Worker (B rating)'), {
    raw: 'Temporary Worker (B rating)', type: 'Temporary Worker', rating: 'B',
  });
  // A provisional licence is neither A nor B; the inner text is carried through
  // rather than being flattened to a letter it does not have.
  const provisional = parseTypeRating('Worker (UK Expansion Worker: Provisional )');
  assert.equal(provisional.rating, 'UK Expansion Worker: Provisional');
  assert.deepEqual(parseTypeRating(''), { raw: '', type: null, rating: null });
});

// --- 2. Match tiers ---------------------------------------------------------

test('lookupSponsor exact tier: the full registered name resolves, case-insensitively', () => {
  const r = lookupSponsor(index, 'wayve technologies ltd');
  assert.equal(r.verdict, 'licensed');
  assert.equal(r.matchTier, 'exact');
  assert.equal(r.organisations[0].name, 'Wayve Technologies Ltd');
});

test('lookupSponsor token tier: a spacing variant of one name still matches', () => {
  const r = lookupSponsor(index, 'GoDaddy Operating Company UK Ltd');
  assert.equal(r.verdict, 'licensed');
  assert.equal(r.organisations[0].name, 'Go Daddy Operating Company UK Ltd');
});

test('lookupSponsor: a brand name resolves to the registered legal name', () => {
  const r = lookupSponsor(index, 'Wayve');
  assert.equal(r.verdict, 'licensed');
  // token-trimmed, not strong: dropping the register's trailing filler makes
  // the two names the same KEY, which is stricter than equal distinctive sets
  // and so is reached first. Both tiers mean licensed.
  assert.equal(r.matchTier, 'token-trimmed');
  assert.equal(r.skilledWorker, true);
  assert.equal(r.organisations[0].name, 'Wayve Technologies Ltd');
});

test('lookupSponsor token-trimmed tier: the legal suffix a posting never spells', () => {
  const r = lookupSponsor(index, 'LumenLabs');
  assert.equal(r.verdict, 'licensed');
  assert.equal(r.matchTier, 'token-trimmed');
  assert.equal(r.organisations[0].name, 'Lumen Labs Ltd');
});

test('lookupSponsor token-trimmed tier: nothing is trimmed from the middle of a name', () => {
  // "Smith" must not reach "Lumen Labs Ltd"-style equality through a
  // distinctive word: only TRAILING filler is dropped, so a query that stops
  // short of a distinctive token falls through to the weaker tiers.
  const r = lookupSponsor(index, 'Lumen');
  assert.equal(r.matchTier, 'token-trimmed', 'Labs/Ltd are both filler, so "Lumen" is a trimmed key too');
  const colne = lookupSponsor(index, 'Colne');
  assert.notEqual(colne.verdict, 'licensed', '"Colne" stops at the distinctive word "Valley"');
});

test('lookupSponsor token-trimmed tier: every trimmed key keeps a distinctive token', () => {
  // "Digital Solutions Ltd" is filler only, and "S&P Global Limited" would
  // trim past 'spglobal' to the two-letter 'sp'. Neither key may exist, so a
  // posting spelled "Digital" or "SP" is not handed either organisation.
  const own = buildRegisterIndex(parseRegister([
    'Organisation Name,Town/City,County,Type & Rating,Route',
    'Digital Solutions Ltd,Leeds,,Worker (A rating),Skilled Worker',
    'S&P Global Limited,London,,Worker (A rating),Skilled Worker',
  ].join('\n')).organisations);
  for (const query of ['Digital', 'SP']) {
    const r = lookupSponsor(own, query);
    assert.notEqual(r.matchTier, 'token-trimmed', `"${query}" must not match on a trimmed key`);
    assert.notEqual(r.verdict, 'licensed', `"${query}" must not resolve to an organisation`);
  }
  const sp = lookupSponsor(own, 'S&P Global');
  assert.equal(sp.verdict, 'licensed', 'the full brand still resolves');
  assert.equal(sp.organisations[0].name, 'S&P Global Limited');
});

test('lookupSponsor strong tier: still reached when the keys differ but the distinctive sets match', () => {
  // Singular/plural filler ("Technology" vs "Technologies") changes the KEY,
  // so no trimmed key equals it — but both names reduce to {wayve}, which is
  // what the strong tier is for. Proves that tier is not shadowed into dead
  // code by the token-trimmed one above it.
  const r = lookupSponsor(index, 'Wayve Technology');
  assert.equal(r.verdict, 'licensed');
  assert.equal(r.matchTier, 'strong');
  assert.equal(r.organisations[0].name, 'Wayve Technologies Ltd');
});

test('lookupSponsor jurisdiction tier: "UK" cannot discriminate inside a UK register', () => {
  const r = lookupSponsor(index, 'Zephyr Analytics');
  assert.equal(r.verdict, 'licensed');
  assert.equal(r.matchTier, 'jurisdiction');
  assert.equal(r.organisations[0].name, 'Zephyr Analytics UK Limited');
});

test('lookupSponsor: a name made only of jurisdiction filler matches nobody', () => {
  for (const bare of ['UK', 'UK Ltd', 'GB Limited']) {
    const r = lookupSponsor(index, bare);
    assert.notEqual(r.verdict, 'licensed', `"${bare}" must not resolve to an organisation`);
    assert.deepEqual(r.organisations, []);
  }
});

test('lookupSponsor: two entities with the same distinctive tokens are reported, never picked', () => {
  // "Holdings" is corporate filler, so "Northwind Robotics" and "Northwind
  // Robotics Holdings Ltd" are indistinguishable to this rule — a tie that
  // must surface rather than resolve to whichever sorts first.
  const r = lookupSponsor(index, 'Northwind Robotics');
  assert.equal(r.verdict, 'ambiguous');
  assert.equal(r.matchTier, 'token-trimmed');
  assert.equal(r.candidateCount, 2);
  assert.deepEqual(
    r.candidates.map((o) => o.name).sort(),
    ['Northwind Robotics Holdings Ltd', 'Northwind Robotics Limited'],
  );
});

test('lookupSponsor: an exact name and another holder\'s suffix-trimmed name are both reported', () => {
  // "Foo Bar" is one holder's whole name and "Foo Bar Ltd"'s trimmed key. The
  // two hold different routes, so reporting either alone could give the wrong
  // Skilled Worker answer.
  const own = buildRegisterIndex(parseRegister([
    'Organisation Name,Town/City,County,Type & Rating,Route',
    'Foo Bar,Leeds,,Worker (A rating),Creative Worker',
    'Foo Bar Ltd,York,,Worker (A rating),Skilled Worker',
  ].join('\n')).organisations);
  for (const [query, tier] of [['Foo Bar', 'exact'], ['Foo Bar (agency)', 'token']]) {
    const r = lookupSponsor(own, query);
    assert.equal(r.verdict, 'ambiguous', query);
    assert.equal(r.matchTier, tier, query);
    assert.deepEqual(r.candidates.map((o) => o.name).sort(), ['Foo Bar', 'Foo Bar Ltd'], query);
  }
});

test('lookupSponsor: two same-named licence holders in different towns are both reported', () => {
  const r = lookupSponsor(index, 'Acme Ltd');
  assert.equal(r.verdict, 'ambiguous');
  assert.equal(r.candidateCount, 2);
  assert.match(r.note, /town\/county/);
});

test('lookupSponsor partial tier: containment is a candidate list, never a licensed verdict', () => {
  const r = lookupSponsor(index, 'Essex');
  assert.equal(r.verdict, 'ambiguous');
  assert.equal(r.matchTier, 'partial');
  assert.deepEqual(r.organisations, [], 'a partial match never fills organisations[]');
  assert.ok(r.candidates.length >= 1);
});

test('lookupSponsor partial tier: one longer register name is named, still unconfirmed', () => {
  const r = lookupSponsor(index, 'Zephyr');
  assert.equal(r.verdict, 'ambiguous');
  assert.equal(r.candidates[0].relation, 'register-name-is-longer');
  assert.match(r.note, /NOT confirmed/);
});

test('lookupSponsor: a route-only sponsor is licensed but flagged as NOT Skilled Worker', () => {
  const r = lookupSponsor(index, 'Globex Creative');
  assert.equal(r.verdict, 'licensed');
  assert.equal(r.skilledWorker, false);
  assert.match(r.note, /NOT for the Skilled Worker route/);
  assert.deepEqual(r.organisations[0].routes, ['Creative Worker']);
});

test('lookupSponsor: an absent employer is UNCONFIRMED, never "does not sponsor"', () => {
  const r = lookupSponsor(index, 'Zetatech Research');
  assert.equal(r.verdict, 'not-found');
  assert.match(r.note, /UNCONFIRMED/);
  assert.doesNotMatch(r.note, /does not sponsor|cannot sponsor|will not sponsor/i);
  // The note has to say WHY absence is weak evidence, or a reader draws the
  // wrong conclusion from a one-word verdict.
  assert.match(r.note, /subsidiary|parent|trading name|legal name/i);
});

test('lookupSponsor: placeholder employer names never match anything', () => {
  for (const placeholder of ['?', 'Stealth Startup', 'Confidential', 'Undisclosed', '', '   ']) {
    const r = lookupSponsor(index, placeholder);
    assert.equal(r.verdict, 'not-found', `"${placeholder}" must not match`);
    assert.deepEqual(r.organisations, []);
    assert.deepEqual(r.candidates, []);
  }
});

test('lookupSponsor: a sub-three-character name is checked for an exact name only', () => {
  const r = lookupSponsor(index, 'GX');
  assert.equal(r.verdict, 'not-found');
  assert.match(r.note, /shorter than three characters/);
});

test('lookupSponsor: two or more shared words rank the real row first, still unconfirmed', () => {
  // "NHS FT" vs "NHS Foundation Trust": neither distinctive set contains the
  // other, so every stronger tier misses an employer a reader recognizes at a
  // glance. The last-resort tier offers it as the top candidate, never as a
  // licensed verdict.
  const r = lookupSponsor(index, 'Eastside Community Mental Health NHS FT');
  assert.equal(r.verdict, 'ambiguous');
  assert.equal(r.matchTier, 'partial');
  assert.equal(r.candidates[0].name, 'Eastside Community Mental Health NHS Foundation Trust');
  assert.equal(r.candidates[0].relation, 'shares-two-or-more-words');
  assert.ok(r.candidates[0].sharedWords >= 2);
  assert.deepEqual(r.organisations, []);
});

test('lookupSponsor: ONE shared word is not enough to become a candidate', () => {
  // "Mental" alone would pair the trust with anything else carrying the word;
  // a single overlap is coincidence as often as signal, so the floor is two.
  const r = lookupSponsor(index, 'Northbridge Mental Clinic');
  assert.equal(r.verdict, 'not-found');
  assert.deepEqual(r.candidates, []);
});

// --- 3. Initialism tier -----------------------------------------------------

test('initialismKey: only an all-caps 2-6 letter query reads as an initialism', () => {
  assert.equal(initialismKey('LSEG'), 'lseg');
  assert.equal(initialismKey('L.S.E.G.'), 'lseg');
  assert.equal(initialismKey('Lseg'), null);
  assert.equal(initialismKey('Rex'), null);
  assert.equal(initialismKey('CONFIDENTIAL'), null);
  assert.equal(initialismKey('X'), null);
  assert.equal(initialismKey(''), null);
});

test('initialismCandidates: any leading token prefix counts, so a legal suffix is tolerated', () => {
  const ids = initialismCandidates(index, 'cvds');
  assert.equal(ids.length, 1);
  assert.equal(index.organisations[ids[0]].name, 'Colne Valley Data Systems Ltd');
});

test('lookupSponsor: an initialism yields a candidate to check, never a licensed verdict', () => {
  const r = lookupSponsor(index, 'CVDS');
  assert.equal(r.verdict, 'ambiguous');
  assert.equal(r.candidates[0].relation, 'register-name-expands-the-initials');
  assert.match(r.note, /NOT confirmed/);
});

test('lookupSponsor: a mixed-case short name is not expanded into an initialism', () => {
  assert.equal(lookupSponsor(index, 'Cvds').verdict, 'not-found');
});

// --- 4. Cache staleness -----------------------------------------------------

const NOW = Date.parse('2026-10-23T12:00:00Z');
const metaAt = (iso) => ({ fetchedAt: iso, bytes: 1 });

test('isCacheFresh: within the window is fresh, past it is stale', () => {
  assert.equal(isCacheFresh(metaAt('2026-10-22T12:00:00Z'), 7, NOW), true);
  assert.equal(isCacheFresh(metaAt('2026-10-16T12:00:00Z'), 7, NOW), true, 'exactly 7 days still counts');
  assert.equal(isCacheFresh(metaAt('2026-10-15T11:00:00Z'), 7, NOW), false);
  assert.equal(isCacheFresh(metaAt('2026-10-23T12:00:00Z'), 0, NOW), true, '--max-age-days 0 accepts this instant');
});

test('isCacheFresh: a future-dated or unparseable marker is stale, not trusted forever', () => {
  assert.equal(isCacheFresh(metaAt('2026-11-01T12:00:00Z'), 7, NOW), false);
  assert.equal(isCacheFresh(metaAt('not-a-date'), 7, NOW), false);
  assert.equal(isCacheFresh({ bytes: 1 }, 7, NOW), false);
  assert.equal(isCacheFresh(null, 7, NOW), false);
});

test('isCacheFresh: a cache whose CSV does not match its marker is never fresh', () => {
  assert.equal(isCacheFresh({ ...metaAt('2026-10-23T11:00:00Z'), corrupt: true }, 7, NOW), false);
});

test('cacheAgeDays: whole days, and null without a marker', () => {
  assert.equal(cacheAgeDays(metaAt('2026-10-16T12:00:00Z'), NOW), 7);
  assert.equal(cacheAgeDays(metaAt('2026-10-23T11:00:00Z'), NOW), 0);
  assert.equal(cacheAgeDays(null, NOW), null);
});

test('readCacheMeta: a CSV without its marker reads as no cache (interrupted download)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-sponsor-cache-'));
  try {
    const csv = join(dir, 'register.csv');
    const meta = join(dir, 'register.meta.json');
    writeFileSync(csv, REGISTER_FIXTURE);
    assert.equal(readCacheMeta(meta, csv), null, 'no marker -> no cache');

    writeFileSync(meta, JSON.stringify({ fetchedAt: '2026-10-23T11:00:00Z', bytes: 999999 }));
    const mismatched = readCacheMeta(meta, csv);
    assert.equal(mismatched.corrupt, true, 'a marker describing a different file is flagged corrupt');

    writeFileSync(meta, JSON.stringify({
      fetchedAt: '2026-10-23T11:00:00Z',
      bytes: Buffer.byteLength(REGISTER_FIXTURE, 'utf-8'),
    }));
    const good = readCacheMeta(meta, csv);
    assert.equal(good.corrupt, undefined);
    assert.equal(good.fetchedAt, '2026-10-23T11:00:00Z');

    writeFileSync(meta, 'not json');
    assert.equal(readCacheMeta(meta, csv), null, 'an unparseable marker reads as no cache');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- 5. GOV.UK Content API --------------------------------------------------

test('pickRegisterCsvUrl: the CSV attachment is selected over other formats', () => {
  const picked = pickRegisterCsvUrl({
    public_updated_at: '2026-10-23T08:32:45Z',
    details: {
      attachments: [
        { url: 'https://assets.publishing.service.gov.uk/media/x/notes.pdf', content_type: 'application/pdf' },
        { url: 'https://assets.publishing.service.gov.uk/media/x/reg.csv', content_type: 'text/csv', filename: 'reg.csv' },
      ],
    },
  });
  assert.equal(picked.url, 'https://assets.publishing.service.gov.uk/media/x/reg.csv');
  assert.equal(picked.filename, 'reg.csv');
  assert.equal(picked.publishedAt, '2026-10-23T08:32:45Z');
});

test('pickRegisterCsvUrl: a .csv url is accepted even when the content type is generic', () => {
  const picked = pickRegisterCsvUrl({
    details: { attachments: [{ url: 'https://assets.publishing.service.gov.uk/media/x/reg.csv', content_type: 'application/octet-stream' }] },
  });
  assert.equal(picked.url, 'https://assets.publishing.service.gov.uk/media/x/reg.csv');
});

test('pickRegisterCsvUrl: no CSV throws with the publication page to check, never a guess', () => {
  assert.throws(
    () => pickRegisterCsvUrl({ details: { attachments: [{ url: 'a.pdf', content_type: 'application/pdf' }] } }),
    /no CSV/,
  );
  assert.throws(() => pickRegisterCsvUrl({ details: { attachments: [] } }), /no attachments/);
  assert.throws(() => pickRegisterCsvUrl({}), /no attachments/);
});

test('pickRegisterCsvUrl: refuses a CSV that is not https on a GOV.UK host', () => {
  for (const url of [
    'http://assets.publishing.service.gov.uk/media/x/reg.csv',
    'https://example.com/reg.csv',
    'https://assets.publishing.service.gov.uk.example.com/reg.csv',
    'https://169.254.169.254/reg.csv',
  ]) {
    assert.throws(
      () => pickRegisterCsvUrl({ details: { attachments: [{ url, content_type: 'text/csv' }] } }),
      /unexpected host/,
      url,
    );
  }
  const relative = pickRegisterCsvUrl({ details: { attachments: [{ url: '/media/x/reg.csv', content_type: 'text/csv' }] } });
  assert.equal(relative.url, 'https://www.gov.uk/media/x/reg.csv', 'a relative URL resolves against GOV.UK');
});

/** A fetch stand-in that answers each URL from `routes` and records what was requested. */
function fakeFetch(routes) {
  const requested = [];
  const fetchImpl = async (url, init) => {
    requested.push(url);
    assert.equal(init.redirect, 'manual', 'redirects must never be followed automatically');
    const route = routes[url];
    if (!route) throw new Error(`unexpected request: ${url}`);
    return route.location
      ? new Response(null, { status: route.status || 301, headers: { location: route.location } })
      : new Response(route.body ?? 'csv', { status: 200 });
  };
  return { fetchImpl, requested };
}

const ASSET = 'https://assets.publishing.service.gov.uk/media';

test('fetchRegisterCsv: follows a GOV.UK redirect to the current snapshot', async () => {
  // The shape GOV.UK really serves: a protocol-relative Location to a newer file.
  const { fetchImpl, requested } = fakeFetch({
    [`${ASSET}/old/reg.csv`]: { location: '//assets.publishing.service.gov.uk/media/new/reg.csv' },
    [`${ASSET}/new/reg.csv`]: { body: 'register' },
  });
  const { res, url } = await fetchRegisterCsv(`${ASSET}/old/reg.csv`, { fetchImpl });
  assert.equal(await res.text(), 'register');
  assert.equal(url, `${ASSET}/new/reg.csv`);
  assert.deepEqual(requested, [`${ASSET}/old/reg.csv`, `${ASSET}/new/reg.csv`]);
});

test('fetchRegisterCsv: a redirect off GOV.UK is refused before it is requested', async () => {
  for (const location of ['https://example.com/reg.csv', 'http://assets.publishing.service.gov.uk/media/x/reg.csv', 'http://169.254.169.254/']) {
    const { fetchImpl, requested } = fakeFetch({ [`${ASSET}/x/reg.csv`]: { location, status: 302 } });
    await assert.rejects(fetchRegisterCsv(`${ASSET}/x/reg.csv`, { fetchImpl }), /unexpected host/, location);
    assert.deepEqual(requested, [`${ASSET}/x/reg.csv`], `${location} must never be fetched`);
  }
});

test('refreshCache: after a redirect the cache names the file actually served', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-sponsor-redirect-'));
  const rows = Array.from({ length: 1200 }, (_, i) => `Org ${i} Ltd,London,,Worker (A rating),Skilled Worker`);
  const csv = ['Organisation Name,Town/City,County,Type & Rating,Route', ...rows].join('\n');
  const routes = {
    [REGISTER_CONTENT_API]: () => Response.json({
      public_updated_at: '2026-10-27T09:00:00Z',
      details: { attachments: [{ url: `${ASSET}/old/Register_-_2026-10-23.csv`, content_type: 'text/csv', filename: 'Register_-_2026-10-23.csv' }] },
    }),
    [`${ASSET}/old/Register_-_2026-10-23.csv`]: () => new Response(null, { status: 301, headers: { location: `${ASSET}/new/Register_-_2026-10-27.csv` } }),
    [`${ASSET}/new/Register_-_2026-10-27.csv`]: () => new Response(csv),
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => routes[url]();
  t.after(() => { globalThis.fetch = realFetch; rmSync(dir, { recursive: true, force: true }); });

  const { meta } = await refreshCache({ cacheDir: dir, csvPath: join(dir, 'r.csv'), metaPath: join(dir, 'r.json') });
  assert.equal(meta.sourceUrl, `${ASSET}/new/Register_-_2026-10-27.csv`);
  assert.equal(meta.sourceFilename, 'Register_-_2026-10-27.csv');
  assert.equal(meta.publishedAt, '2026-10-27T09:00:00Z', 'the publication date still comes from the Content API');
});

test('fetchRegisterCsv: a redirect loop gives up instead of following forever', async () => {
  const { fetchImpl } = fakeFetch({
    [`${ASSET}/a/reg.csv`]: { location: `${ASSET}/b/reg.csv` },
    [`${ASSET}/b/reg.csv`]: { location: `${ASSET}/a/reg.csv` },
  });
  await assert.rejects(fetchRegisterCsv(`${ASSET}/a/reg.csv`, { fetchImpl }), /redirected more than/);
});

// --- 6. Employer extraction and roll-up -------------------------------------

const TRACKER_FIXTURE = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 1 | 2026-10-05 | Wayve | AI Engineer | 4.1/5 | Evaluated | ✅ | [1](r1.md) | n |',
  '| 2 | 2026-10-06 | WAYVE | Junior SWE | 4.0/5 | Applied | ✅ | [2](r2.md) | n |',
  '| 3 | 2026-10-06 | Globex Creative | Designer | 3.2/5 | Evaluated | ❌ | [3](r3.md) | n |',
  '| 4 | 2026-10-07 | Zetatech Research | Research Analyst | 3.8/5 | SKIP | ❌ | [4](r4.md) | n |',
].join('\n');

const PIPELINE_FIXTURE = [
  '# Pipeline — Pending URLs',
  '',
  '## Pending',
  '',
  '- [ ] https://jobs.ashbyhq.com/wayve/abc | Wayve | AI Engineer | London | rank: 4.0/5',
  '- [x] https://job-boards.greenhouse.io/globex/1 | Globex Creative | Designer | Manchester',
  '- [ ] https://example.invalid/bare-url-with-no-company',
  '- [ ] not-a-url | Nope | Role',
].join('\n');

test('extractTrackerCompanies: one entry per distinct employer, rows kept as context', () => {
  const companies = extractTrackerCompanies(TRACKER_FIXTURE);
  assert.equal(companies.length, 3, 'Wayve and WAYVE are one employer');
  const wayve = companies.find((c) => /wayve/i.test(c.company));
  assert.equal(wayve.rows.length, 2);
  assert.deepEqual(wayve.rows.map((r) => r.num), [1, 2]);
});

test('extractTrackerCompanies: a file with no table yields nothing rather than guessing', () => {
  assert.deepEqual(extractTrackerCompanies('# Notes\n\njust prose\n'), []);
});

test('extractPipelineCompanies: reads the company field, never the ATS hostname', () => {
  const companies = extractPipelineCompanies(PIPELINE_FIXTURE);
  assert.deepEqual(companies.map((c) => c.company).sort(), ['Globex Creative', 'Wayve']);
  assert.ok(!companies.some((c) => c.company === 'Nope'), 'a row whose first field is not a URL is skipped');
});

test('extractPipelineCompanies: processed rows lead with #NNN, so the company follows the URL field', () => {
  const companies = extractPipelineCompanies([
    '- [ ] https://jobs.ashbyhq.com/wayve/abc | Wayve | AI Engineer | London',
    '- [x] #143 | https://jobs.example.com/posting/789 | Acme Corp | AI PM | 4.2/5 | PDF ✅',
    '- [x] #-- | https://jobs.example.com/posting/790 | skipped (pre-screen mismatch: seniority)',
  ].join('\n'));
  assert.deepEqual(companies.map((c) => c.company).sort(), ['Acme Corp', 'Wayve']);
  const acme = companies.find((c) => c.company === 'Acme Corp');
  assert.deepEqual(acme.rows, [{ url: 'https://jobs.example.com/posting/789', role: 'AI PM' }]);
  const wayve = companies.find((c) => c.company === 'Wayve');
  assert.deepEqual(wayve.rows, [{ url: 'https://jobs.ashbyhq.com/wayve/abc', role: 'AI Engineer' }]);
  assert.ok(!companies.some((c) => /skipped/.test(c.company)), 'a pre-screen discard reason is not an employer');
});

test('extractCompanies: picks the extractor by content shape so --file takes either format', () => {
  assert.equal(extractCompanies(TRACKER_FIXTURE).source, 'tracker');
  assert.equal(extractCompanies(PIPELINE_FIXTURE).source, 'pipeline');
});

test('annotateCompanies: verdict counts and the resolution rate', () => {
  const { employers, totals } = annotateCompanies(index, extractTrackerCompanies(TRACKER_FIXTURE));
  assert.equal(employers.length, 3);
  assert.equal(totals.licensed, 2, 'Wayve and Globex Creative resolve');
  assert.equal(totals.licensedSkilledWorker, 1, 'only Wayve covers Skilled Worker');
  assert.equal(totals.licensedOtherRouteOnly, 1, 'Globex Creative is licensed for another route only');
  assert.equal(totals.notFound, 1);
  assert.equal(totals.resolvedRate, Number((2 / 3).toFixed(4)));
  assert.equal(totals.byTier['token-trimmed'], 2, 'Wayve and Globex Creative both match on the token-trimmed tier');
});

test('annotateCompanies: no employers yields zeros rather than dividing by zero', () => {
  const { employers, totals } = annotateCompanies(index, []);
  assert.deepEqual(employers, []);
  assert.equal(totals.resolvedRate, 0);
});

// --- 7. CLI -----------------------------------------------------------------

function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-sponsor-cli-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'register.csv'), REGISTER_FIXTURE);
  writeFileSync(join(dir, 'data', 'applications.md'), TRACKER_FIXTURE);
  writeFileSync(join(dir, 'data', 'pipeline.md'), PIPELINE_FIXTURE);
  return dir;
}

function run(dir, args) {
  const env = { ...process.env, CAREER_OPS_ROOT: dir };
  delete env.CAREER_OPS_DATA_DIR;
  delete env.CAREER_OPS_TRACKER;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: CODE_ROOT, env, encoding: 'utf-8', timeout: 60_000,
  });
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('CLI --help exits 0 and documents the UNCONFIRMED rule', () => {
  const dir = fixtureDir();
  try {
    const r = run(dir, ['--help']);
    assert.equal(r.status, 0, r.all);
    assert.match(r.stdout, /Usage:/);
    assert.match(r.stdout, /--company/);
    assert.match(r.stdout, /--tracker/);
    assert.match(r.stdout, /UNCONFIRMED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI rejects a mistyped flag instead of answering from its defaults', () => {
  const dir = fixtureDir();
  try {
    const r = run(dir, ['--compnay', 'Wayve']);
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /unrecognized flag/i);
    assert.ok(r.all.includes('--compnay'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --help --bogus still errors rather than exiting 0', () => {
  const dir = fixtureDir();
  try {
    const r = run(dir, ['--help', '--bogus']);
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /unrecognized flag/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: a value flag with no operand is a usage error, never a silent default', () => {
  const dir = fixtureDir();
  try {
    const r = run(dir, ['--company', '--summary']);
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /requires a value/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: no mode at all explains itself and exits 1 without fetching', () => {
  const dir = fixtureDir();
  try {
    const r = run(dir, ['--offline']);
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /nothing to check/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: two modes at once is refused rather than guessing which output to print', () => {
  const dir = fixtureDir();
  try {
    const r = run(dir, ['--company', 'Wayve', '--tracker', '--register', join(dir, 'register.csv')]);
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /exactly ONE of/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --offline with no cache fails loudly and says how to fix it', () => {
  const dir = fixtureDir();
  try {
    const r = run(dir, ['--company', 'Wayve', '--offline']);
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /--offline and no usable cached register/);
    assert.match(r.all, /--register/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --max-age-days rejects a non-integer instead of silently using the default', () => {
  const dir = fixtureDir();
  try {
    const r = run(dir, ['--company', 'Wayve', '--max-age-days', 'soon', '--register', join(dir, 'register.csv')]);
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /--max-age-days must be a non-negative integer/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --company with --register: JSON carries the verdict, evidence and the UNCONFIRMED note', () => {
  const dir = fixtureDir();
  try {
    const r = run(dir, ['--company', 'Wayve', '--register', join(dir, 'register.csv')]);
    assert.equal(r.status, 0, r.all);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, 'licensed');
    assert.equal(out.matchTier, 'token-trimmed');
    assert.equal(out.skilledWorker, true);
    assert.equal(out.organisations[0].name, 'Wayve Technologies Ltd');
    assert.match(out.unconfirmedMeans, /never "does not sponsor"/);
    assert.equal(out.register.source, 'local');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --company --summary: an absent employer reads as UNCONFIRMED, not as a refusal', () => {
  const dir = fixtureDir();
  try {
    const r = run(dir, ['--company', 'Zetatech Research', '--register', join(dir, 'register.csv'), '--summary']);
    assert.equal(r.status, 0, `an honest "not found" is a successful check, not a failure: ${r.all}`);
    assert.match(r.stdout, /NOT-FOUND/);
    assert.match(r.stdout, /UNCONFIRMED, not a refusal/);
    // The only place this output may utter the phrase is the footer telling the
    // reader NOT to read it that way.
    assert.match(r.stdout, /NEVER AS "DOES NOT SPONSOR"/);
    const beforeFooter = r.stdout.split('READ "not-found"')[0];
    assert.doesNotMatch(beforeFooter, /does not sponsor|cannot sponsor|will not sponsor/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --company: a missing --register file is an error, not an empty register', () => {
  const dir = fixtureDir();
  try {
    const r = run(dir, ['--company', 'Wayve', '--register', join(dir, 'nope.csv')]);
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /register file not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --tracker: annotates every employer and reports the resolution rate', () => {
  const dir = fixtureDir();
  try {
    const r = run(dir, ['--tracker', '--register', join(dir, 'register.csv')]);
    assert.equal(r.status, 0, r.all);
    const out = JSON.parse(r.stdout);
    assert.equal(out.source, 'tracker');
    assert.equal(out.employers.length, 3);
    assert.equal(out.totals.licensed, 2);
    assert.equal(out.totals.notFound, 1);
    assert.equal(out.totals.resolvedRate, Number((2 / 3).toFixed(4)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --tracker --summary: the table flags a licensed sponsor on the wrong route', () => {
  const dir = fixtureDir();
  try {
    const r = run(dir, ['--tracker', '--register', join(dir, 'register.csv'), '--summary']);
    assert.equal(r.status, 0, r.all);
    assert.match(r.stdout, /SPONSOR LICENCE CROSS-CHECK/);
    assert.match(r.stdout, /NOT Skilled Worker/);
    assert.match(r.stdout, /3 employer\(s\)/);
    assert.match(r.stdout, /UNCONFIRMED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --tracker is read-only: the tracker file is byte-identical afterwards', () => {
  const dir = fixtureDir();
  try {
    const r = run(dir, ['--tracker', '--register', join(dir, 'register.csv')]);
    assert.equal(r.status, 0, r.all);
    assert.equal(readFileSync(join(dir, 'data', 'applications.md'), 'utf-8'), TRACKER_FIXTURE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --pipeline: reads pipeline.md employers from the data root', () => {
  const dir = fixtureDir();
  try {
    const r = run(dir, ['--pipeline', '--register', join(dir, 'register.csv')]);
    assert.equal(r.status, 0, r.all);
    const out = JSON.parse(r.stdout);
    assert.equal(out.source, 'pipeline');
    assert.deepEqual(out.employers.map((e) => e.query).sort(), ['Globex Creative', 'Wayve']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --file: accepts a pipeline-shaped file by content, not by filename', () => {
  const dir = fixtureDir();
  try {
    const r = run(dir, ['--file', join(dir, 'data', 'pipeline.md'), '--register', join(dir, 'register.csv')]);
    assert.equal(r.status, 0, r.all);
    assert.equal(JSON.parse(r.stdout).source, 'pipeline');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --cache-status makes no network request and reports an empty cache', () => {
  const dir = fixtureDir();
  try {
    const r = run(dir, ['--cache-status']);
    assert.equal(r.status, 0, r.all);
    const out = JSON.parse(r.stdout);
    assert.equal(out.cached, false);
    assert.equal(out.ageDays, null);
    assert.equal(out.fresh, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --self-test passes on its own fixture', () => {
  const dir = fixtureDir();
  try {
    const r = run(dir, ['--self-test']);
    assert.equal(r.status, 0, r.all);
    assert.match(r.stdout, /self-test OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
