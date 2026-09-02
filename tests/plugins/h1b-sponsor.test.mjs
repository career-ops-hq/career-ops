// tests/plugins/h1b-sponsor.test.mjs: contracts for the h1b-sponsor plugin
// (manifest shape, classifyTier branches, cache round-trip/expiry, the local
// index backend, and the check.mjs CLI JSON envelope).
//
// Almost everything here runs on every suite run. check.mjs answers from a
// local index by default, so the CLI contract can be driven against a fixture
// index this file builds: no network, no gate, no dependence on what the
// machine happens to have installed. Only the live-API block stays behind
// H1B_API_TEST=1, and token.mjs's mint keeps its own H1B_MINT_TEST=1 gate:
// unlike a read, a mint spends the 2-keys-per-address-per-day budget.
//
// Every spawn of check.mjs sets H1B_INDEX_PATH explicitly, at the fixture or
// at a path with nothing in it. A developer with a real index installed must
// get the same result as CI, and no test may read the repo's own index.
//
// The plugin ships all of these files, so a missing one is a real failure, not
// a skip.
import { pass, fail, warn, run, NODE, ROOT } from '../helpers.mjs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';

console.log('\nPlugin: h1b-sponsor');

const PLUGIN_DIR = join(ROOT, 'plugins', 'h1b-sponsor');
const MANIFEST_PATH = join(PLUGIN_DIR, 'manifest.json');
const TIER_PATH = join(PLUGIN_DIR, 'lib', 'tier.mjs');
const CACHE_PATH = join(PLUGIN_DIR, 'lib', 'cache.mjs');
const API_PATH = join(PLUGIN_DIR, 'lib', 'api.mjs');
const INDEX_PATH = join(PLUGIN_DIR, 'lib', 'index.mjs');
const CHECK_PATH = join(PLUGIN_DIR, 'check.mjs');
const TOKEN_PATH = join(PLUGIN_DIR, 'token.mjs');
const INSTALL_PATH = join(PLUGIN_DIR, 'install-h1b-index.mjs');
const ENGINE_PATH = join(ROOT, 'plugins', '_engine.mjs');

// ---------- fixture index ----------
// The shipped index is one gzipped NDJSON record per employer, sorted by name,
// with the publisher's short field names. These fixtures use the same shape so
// the tests exercise the real reader rather than a parallel format.
//
// `filed` is what the employer filed and `cert` is how much of it came back
// certified: two fields, because the tier counts the first and the report
// prints both. They replaced one `lca` field that carried the certified count
// under the filing count's name, which reported an employer that filed and had
// nothing certified as tier `none`.
const YEAR = new Date().getUTCFullYear();
const FIXTURE_RECORDS = [
  { k: '900000001', n: 'Fixture Strong Corp', fy: 2019, ly: YEAR, filed: 5000, cert: 4800, pwd: 200, perm: 150, gc: true, sv: false, sh: 0.05, ns: 12 },
  { k: '900000002', n: 'Fixture Staffing LLC', fy: 2019, ly: YEAR, filed: 900, cert: 880, pwd: 10, perm: 5, gc: true, sv: true, sh: 0.87, ns: 800 },
  { k: '900000003', n: 'Fixture Quiet Inc', fy: 2019, ly: 2019, filed: 0, cert: 0, pwd: 0, perm: 0, gc: false, sv: false, sh: 0, ns: 0 },
];
// Control characters are built from char codes rather than written literally:
// an editor or a patch tool that rewrites this file must not be able to turn
// the escape sequence back into a raw byte in the source.
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const EVIL_NAME = `Evil${ESC}[31mRED${ESC}[0m${BEL}Co${CRLF}FORGED  ROW`;
const EVIL_ID = `12${ESC}[7m34`;

/**
 * Write a gzipped NDJSON index. `extraLines` go in verbatim, which is how the
 * malformed-line case gets a line that is not JSON at all.
 */
async function writeFixtureIndex(file, records = FIXTURE_RECORDS, extraLines = []) {
  const body = [...records.map(r => JSON.stringify(r)), ...extraLines].join('\n') + '\n';
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, gzipSync(Buffer.from(body, 'utf8')));
}

// Somewhere with no index in it: the value every test that must NOT use one
// passes for H1B_INDEX_PATH.
const NO_INDEX = join(tmpdir(), `h1b-no-index-${randomUUID()}`, 'index.ndjson.gz');

// ---------- manifest.json ----------
if (!existsSync(MANIFEST_PATH)) {
  fail('manifest.json missing: the plugin ships it');
} else {
  try {
    const raw = await readFile(MANIFEST_PATH, 'utf8');
    let manifest;
    try {
      manifest = JSON.parse(raw);
      pass('manifest.json parses as JSON');
    } catch (e) {
      fail(`manifest.json does not parse: ${e.message}`);
      manifest = null;
    }

    if (manifest) {
      if (manifest.id === 'h1b-sponsor') pass('manifest.id === "h1b-sponsor"');
      else fail(`manifest.id = ${JSON.stringify(manifest.id)}`);

      if (manifest.apiVersion === 1) pass('manifest.apiVersion === 1');
      else fail(`manifest.apiVersion = ${JSON.stringify(manifest.apiVersion)}`);

      if (manifest.humanInTheLoop === true) pass('manifest.humanInTheLoop === true');
      else fail(`manifest.humanInTheLoop = ${JSON.stringify(manifest.humanInTheLoop)}`);

      if (Array.isArray(manifest.hooks) && manifest.hooks.length > 0) pass('manifest.hooks is a non-empty array');
      else fail(`manifest.hooks = ${JSON.stringify(manifest.hooks)}`);

      // Exact element equality (===), not URL-substring matching, phrased with
      // .some() because scanners misread Array.includes('host') as the
      // url.includes('trusted.com') sanitization anti-pattern (CodeQL #103).
      if (Array.isArray(manifest.allowedHosts) && manifest.allowedHosts.some(h => h === 'api.surakshith.com')) {
        pass('manifest.allowedHosts contains "api.surakshith.com"');
      } else {
        fail(`manifest.allowedHosts = ${JSON.stringify(manifest.allowedHosts)}`);
      }

      // The index is downloaded from a GitHub release, so the release host
      // belongs in the same advisory list as the API host.
      if (Array.isArray(manifest.allowedHosts) && manifest.allowedHosts.some(h => h === 'github.com')) {
        pass('manifest.allowedHosts contains the release host "github.com"');
      } else {
        fail(`manifest.allowedHosts = ${JSON.stringify(manifest.allowedHosts)}`);
      }

      for (const key of ['H1B_API_TOKEN', 'H1B_INDEX_PATH']) {
        if (Array.isArray(manifest.optionalEnv) && manifest.optionalEnv.includes(key)) {
          pass(`manifest.optionalEnv contains "${key}"`);
        } else {
          fail(`manifest.optionalEnv = ${JSON.stringify(manifest.optionalEnv)} (missing ${key})`);
        }
      }

      // Engine validateManifest should accept it.
      if (!existsSync(ENGINE_PATH)) {
        warn('plugins/_engine.mjs missing, skipping validateManifest check');
      } else {
        try {
          const engine = await import(pathToFileURL(ENGINE_PATH).href);
          const normalized = engine.validateManifest(manifest, PLUGIN_DIR, 'h1b-sponsor');
          if (normalized && normalized.id === 'h1b-sponsor') {
            pass('plugins/_engine.mjs validateManifest accepts the manifest');
          } else {
            fail(`validateManifest returned ${JSON.stringify(normalized)}`);
          }
        } catch (e) {
          fail(`validateManifest crashed: ${e.message}`);
        }
      }
    }
  } catch (e) {
    fail(`manifest.json read crashed: ${e.message}`);
  }
}

// ---------- lib/tier.mjs: classifyTier ----------
if (!existsSync(TIER_PATH)) {
  fail('lib/tier.mjs missing: the plugin ships it');
} else {
  try {
    const { classifyTier } = await import(pathToFileURL(TIER_PATH).href);
    const currentYear = new Date().getUTCFullYear();

    const cases = [
      { label: 'null → "unknown"', profile: null, accept: ['unknown'] },
      // Empty object has no filings at all, so it lands on the zero-total rule.
      { label: 'empty object → "none"', profile: {}, accept: ['none'] },
      {
        label: 'staffing_shop.value:true → "staffing-shop"',
        profile: { red_flags: { staffing_shop: { value: true, share: 0.87, n_secondary: 4351, n_total: 5002 } }, n_pwd: 50, n_perm: 10, last_year: currentYear },
        accept: ['staffing-shop'],
      },
      {
        label: 'nLca=0, nPwd=0, nPerm=0 → "none"',
        profile: { n_lca: 0, n_pwd: 0, n_perm: 0, last_year: currentYear },
        accept: ['none'],
      },
      {
        label: 'stale + low-volume → "weak"',
        profile: { n_lca: 0, n_pwd: 2, n_perm: 1, last_year: currentYear - 5, does_gc: false },
        accept: ['weak'],
      },
      {
        label: 'does_gc + high volume + recent + low staffing share → "strong"',
        profile: { does_gc: true, n_lca: 5000, n_pwd: 200, n_perm: 150, last_year: currentYear, red_flags: { staffing_shop: { value: false, share: 0.05 } } },
        accept: ['strong'],
      },
      {
        label: 'moderate volume + recent + share < 0.5 → "moderate"',
        profile: { does_gc: false, n_lca: 300, n_pwd: 20, n_perm: 15, last_year: currentYear, red_flags: { staffing_shop: { value: false, share: 0.3 } } },
        accept: ['moderate'],
      },
      {
        // Regression for the normalizeProfile fix: an LCA-active employer with
        // zero GC filings must classify as moderate, not fall through to
        // "none" because n_pwd + n_perm === 0.
        label: 'LCA-only (n_lca=500, no GC) + recent + low share → "moderate"',
        profile: { does_gc: false, n_lca: 500, n_pwd: 0, n_perm: 0, last_year: currentYear, red_flags: { staffing_shop: { value: false, share: 0.1 } } },
        accept: ['moderate'],
      },
      {
        // No last_year at all: recency cannot be established, so neither the
        // strong nor the moderate branch can fire and it falls through to weak.
        label: 'high volume + does_gc but no last_year → "weak"',
        profile: { n_lca: 500, n_pwd: 10, n_perm: 5, does_gc: true },
        accept: ['weak'],
      },
      {
        // currentYear - 3 sits in the gap between the stale bound (< year - 3)
        // and the recent bound (>= year - 2): not stale, but not recent either.
        label: 'high volume + does_gc + last_year = currentYear - 3 → "weak"',
        profile: { n_lca: 500, n_pwd: 10, n_perm: 5, does_gc: true, last_year: currentYear - 3 },
        accept: ['weak'],
      },
      {
        // A staffing share between 0.2 and 0.5 blocks strong but still clears
        // the moderate bar, even with GC evidence present.
        label: 'does_gc + recent + staffing share 0.35 → "moderate"',
        profile: { does_gc: true, n_lca: 500, n_pwd: 10, n_perm: 5, last_year: currentYear, red_flags: { staffing_shop: { value: false, share: 0.35 } } },
        accept: ['moderate'],
      },
      {
        // The recency window is bounded above: a last_year far in the future is
        // API drift, not a recent filing record, so it cannot mint strong.
        label: 'does_gc + last_year = currentYear + 50 → "weak"',
        profile: { does_gc: true, n_lca: 500, n_pwd: 10, n_perm: 5, last_year: currentYear + 50, red_flags: { staffing_shop: { value: false, share: 0.05 } } },
        accept: ['weak'],
      },
    ];

    for (const c of cases) {
      let got;
      try {
        got = classifyTier(c.profile);
      } catch (e) {
        fail(`classifyTier crashed on "${c.label}": ${e.message}`);
        continue;
      }
      if (c.accept.includes(got)) pass(`classifyTier: ${c.label} (got "${got}")`);
      else fail(`classifyTier: ${c.label}: got "${got}", expected one of ${JSON.stringify(c.accept)}`);
    }
  } catch (e) {
    fail(`classifyTier import crashed: ${e.message}`);
  }
}

// ---------- lib/cache.mjs: cacheKey, readCache, writeCache ----------
if (!existsSync(CACHE_PATH)) {
  fail('lib/cache.mjs missing: the plugin ships it');
} else {
  const tmpCacheDir = join(tmpdir(), `h1b-cache-${randomUUID()}`);
  try {
    const { cacheKey, readCache, writeCache } = await import(pathToFileURL(CACHE_PATH).href);

    // cacheKey: filesystem-safe slug.
    const slug = cacheKey('Microsoft Corp');
    if (typeof slug === 'string' && /^[a-z0-9-]+$/.test(slug)) {
      pass(`cacheKey("Microsoft Corp") is a filesystem-safe slug ("${slug}")`);
    } else {
      fail(`cacheKey("Microsoft Corp") = ${JSON.stringify(slug)}`);
    }

    // cacheKey(''): accept any non-empty safe fallback.
    const emptySlug = cacheKey('');
    if (typeof emptySlug === 'string' && emptySlug.length > 0 && /^[a-z0-9-]+$/.test(emptySlug)) {
      pass(`cacheKey("") returns non-empty safe fallback ("${emptySlug}")`);
    } else {
      fail(`cacheKey("") = ${JSON.stringify(emptySlug)}`);
    }

    // Round-trip write + read.
    await writeCache('TestCo', { hello: 'world' }, { cacheDir: tmpCacheDir });
    const roundTrip = await readCache('TestCo', { cacheDir: tmpCacheDir });
    if (roundTrip && roundTrip.data && roundTrip.data.hello === 'world') {
      pass('writeCache → readCache round-trip returns entry.data.hello === "world"');
    } else {
      fail(`round-trip readCache = ${JSON.stringify(roundTrip)}`);
    }

    // Expired positive entry: rewrite with an ancient fetchedAt, force TTL=1d.
    const expiredKey = cacheKey('TestCo');
    const expiredFile = join(tmpCacheDir, `${expiredKey}.json`);
    await writeFile(
      expiredFile,
      JSON.stringify({ data: { hello: 'stale' }, fetchedAt: new Date('2000-01-01T00:00:00Z').toISOString() }, null, 2),
      'utf8',
    );
    const expired = await readCache('TestCo', { cacheDir: tmpCacheDir, ttlDays: 1 });
    if (expired === null) pass('readCache returns null for a past-TTL positive entry');
    else fail(`expired readCache = ${JSON.stringify(expired)}`);

    // Negative TTL is a separate knob: write a negative entry with a stale
    // fetchedAt, then confirm ttlDays alone (huge) does NOT keep it alive when
    // negativeTtlDays is tight.
    await writeCache('NegCo', { not: 'found' }, { cacheDir: tmpCacheDir, negative: true });
    const negFile = join(tmpCacheDir, `${cacheKey('NegCo')}.json`);
    const negRaw = JSON.parse(await readFile(negFile, 'utf8'));
    negRaw.fetchedAt = new Date('2000-01-01T00:00:00Z').toISOString();
    await writeFile(negFile, JSON.stringify(negRaw, null, 2), 'utf8');

    const negExpired = await readCache('NegCo', { cacheDir: tmpCacheDir, ttlDays: 10_000, negativeTtlDays: 1 });
    if (negExpired === null) pass('readCache honors negativeTtlDays separately from ttlDays');
    else fail(`negative readCache = ${JSON.stringify(negExpired)}`);

    // Missing cache directory: a cold start must return null, not throw.
    const missingDir = join(tmpdir(), `h1b-cache-missing-${randomUUID()}`);
    let missing;
    try {
      missing = await readCache('TestCo', { cacheDir: missingDir });
      if (missing === null) pass('readCache returns null when the cache directory does not exist');
      else fail(`readCache on missing dir = ${JSON.stringify(missing)}`);
    } catch (e) {
      fail(`readCache threw on a missing cache directory: ${e.message}`);
    }

    // Entry without a `data` key is malformed, so fail closed.
    const noDataFile = join(tmpCacheDir, `${cacheKey('NoDataCo')}.json`);
    await writeFile(
      noDataFile,
      JSON.stringify({ fetchedAt: new Date().toISOString() }, null, 2),
      'utf8',
    );
    const noData = await readCache('NoDataCo', { cacheDir: tmpCacheDir });
    if (noData === null) pass('readCache returns null for an entry with no data key');
    else fail(`readCache on data-less entry = ${JSON.stringify(noData)}`);

    // A future fetchedAt is clock skew or tampering. Not usable either way.
    const futureFile = join(tmpCacheDir, `${cacheKey('FutureCo')}.json`);
    await writeFile(
      futureFile,
      JSON.stringify(
        { data: { hello: 'future' }, fetchedAt: new Date(Date.now() + 7 * 86_400_000).toISOString() },
        null,
        2,
      ),
      'utf8',
    );
    const future = await readCache('FutureCo', { cacheDir: tmpCacheDir });
    if (future === null) pass('readCache returns null for a future fetchedAt');
    else fail(`readCache on future entry = ${JSON.stringify(future)}`);
  } catch (e) {
    fail(`cache tests crashed: ${e.message}`);
  } finally {
    await rm(tmpCacheDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- cache fetchedAt pass-through ----------
{
  const { mkdtemp: mkdtempTs } = await import('node:fs/promises');
  const { tmpdir: tmpdirTs } = await import('node:os');
  const { join: joinTs } = await import('node:path');
  const cacheTs = await import(new URL('../../plugins/h1b-sponsor/lib/cache.mjs', import.meta.url).href);
  const dirTs = await mkdtempTs(joinTs(tmpdirTs(), 'h1b-ts-'));
  // A minute in the past: old enough to prove no fresh stamp replaced it,
  // young enough that the 90-day TTL cannot expire it out of the read.
  const pinned = new Date(Date.now() - 60_000).toISOString();
  await cacheTs.writeCache('ts probe', { hello: 'ts' }, { cacheDir: dirTs, fetchedAt: pinned });
  const backTs = await cacheTs.readCache('ts probe', { cacheDir: dirTs });
  if (backTs && backTs.fetchedAt === pinned) pass('writeCache persists a caller-pinned fetchedAt verbatim');
  else fail(`pinned fetchedAt: ${JSON.stringify(backTs && backTs.fetchedAt)}`);
  await cacheTs.writeCache('ts probe 2', { hello: 'ts' }, { cacheDir: dirTs });
  const backTs2 = await cacheTs.readCache('ts probe 2', { cacheDir: dirTs });
  if (backTs2 && typeof backTs2.fetchedAt === 'string' && Number.isFinite(Date.parse(backTs2.fetchedAt))) {
    pass('writeCache still stamps its own fetchedAt when the caller pins none');
  } else fail(`unpinned fetchedAt: ${JSON.stringify(backTs2 && backTs2.fetchedAt)}`);
}

// ---------- lib/api.mjs: name matching ----------
// pickBestMatch and plausibleMatch are exported (lib/index.mjs resolves names
// with the same rules), so the matcher is driven directly with a candidate
// list. That used to require stubbing globalThis.fetch and pushing candidates
// through resolveEmployer's HTTP path, which tested the transport to assert
// something about string comparison.
if (!existsSync(API_PATH)) {
  fail('lib/api.mjs missing: the plugin ships it');
} else {
  const originalFetch = globalThis.fetch;
  try {
    const api = await import(pathToFileURL(API_PATH).href);

    // Response-like with a real streaming body, matching what fetch actually
    // hands back: lib/api.mjs reads bodies through readBoundedText, so a mock
    // that only implements json() would not exercise the code under test.
    const jsonStream = (payload) => {
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      let sent = false;
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes })),
            cancel: async () => {},
            releaseLock: () => {},
          }),
        },
      };
    };

    const matchCases = [
      // Legal-suffix canonicalization, both directions: neither pair is an
      // exact normalized match, so each one lands on plausibleMatch.
      { query: 'Acme Corp', candidate: 'Acme Corporation', expect: true },
      { query: 'Acme Corporation', candidate: 'Acme Corp', expect: true },
      // Leading "the" on one side, trailing suffix on the other.
      { query: 'The Home Depot', candidate: 'Home Depot Inc', expect: true },
      // Regression: a token prefix is not a name prefix. Stripping "Inc" must
      // not turn this into a match.
      { query: 'Meta', candidate: 'Metabolic Diagnostics Inc', expect: false },
      // Nearest-neighbour garbage from the search endpoint.
      { query: 'Acme', candidate: 'Zebra Logistics Inc', expect: false },
      // Canonicalize, do not delete: folding the suffix to a token keeps a
      // one-word query from swallowing a longer, unrelated same-root name.
      { query: 'Apple Inc', candidate: 'Apple Bank For Savings', expect: false },
      { query: 'Infosys Ltd', candidate: 'Infosys BPM Limited', expect: false },
      // Distinct legal forms are distinct entities: llc is not inc, co is not corp.
      { query: 'Acme LLC', candidate: 'Acme Inc', expect: false },
      { query: 'Delta LLC', candidate: 'Delta Corporation', expect: false },
      // A name that is only "the" plus suffixes must not resolve to anything.
      { query: 'The Company Inc', candidate: 'Google LLC', expect: false },
      // Dotted or spaced initialisms fold into one token on both sides, so
      // "I.B.M." reaches IBM Corporation instead of an unrelated small filer.
      { query: 'I.B.M.', candidate: 'IBM Corporation', expect: true },
      { query: 'U S Steel', candidate: 'US Steel Corporation', expect: true },
      { query: 'A B C Corp', candidate: 'ABC Corporation', expect: true },
      // The fold never bridges a real word boundary: 4 is not platforms.
      { query: 'Meta 4 LLC', candidate: 'Meta Platforms, Inc', expect: false },
    ];

    for (const c of matchCases) {
      let got;
      try {
        got = api.pickBestMatch(c.query, [{ id: 'stub-1', name: c.candidate }]);
      } catch (e) {
        fail(`pickBestMatch("${c.query}") crashed: ${e.message}`);
        continue;
      }
      const matched = Boolean(got && got.id);
      if (matched === c.expect) {
        pass(`matcher: "${c.query}" vs "${c.candidate}" → ${c.expect ? 'match' : 'no match'}`);
      } else {
        fail(`matcher: "${c.query}" vs "${c.candidate}" → got ${matched ? 'match' : 'no match'}, expected ${c.expect ? 'match' : 'no match'}`);
      }
    }

    // Rank independence. The fallback rule used to look at results[0] alone,
    // which was only safe because the search endpoint ranked the page first.
    // The local index has no ranking of its own: candidates arrive in file
    // order, so a plausible name has to win from anywhere in the list, or the
    // same query would resolve over HTTP and come back unknown locally.
    const ranked = api.pickBestMatch('Acme Corp', [
      { id: 'noise-1', name: 'Zebra Logistics Inc' },
      { id: 'noise-2', name: 'Metabolic Diagnostics Inc' },
      { id: 'real-1', name: 'Acme Corporation' },
    ]);
    if (ranked && ranked.id === 'real-1') {
      pass('pickBestMatch: a plausible match is found regardless of its position in the list');
    } else {
      fail(`pickBestMatch rank independence: ${JSON.stringify(ranked)}`);
    }

    // Rank independence must not cost tier precedence: an exact normalized name
    // still beats a merely plausible one that came first. resolveEmployer on the
    // index leans on this: its ranked candidate list can seat a high-volume
    // plausible name ahead of the exact one, and the exact one must still win.
    const exactWins = api.pickBestMatch('Acme Corp', [
      { id: 'plausible-1', name: 'Acme Corporation Holdings' },
      { id: 'exact-1', name: 'ACME CORP.' },
    ]);
    if (exactWins && exactWins.id === 'exact-1') {
      pass('pickBestMatch: an exact normalized name still outranks an earlier plausible one');
    } else {
      fail(`pickBestMatch exact precedence: ${JSON.stringify(exactWins)}`);
    }

    // Nothing plausible anywhere in a long list is still no match: position
    // independence widens where a match may be found, not what counts as one.
    const noneMatch = api.pickBestMatch('Meta', [
      { id: 'a', name: 'Metabolic Diagnostics Inc' },
      { id: 'b', name: 'Metallurgy Partners LLC' },
    ]);
    if (noneMatch === null) {
      pass('pickBestMatch: a list of implausible candidates still resolves to nothing');
    } else {
      fail(`pickBestMatch implausible list: ${JSON.stringify(noneMatch)}`);
    }

    // searchEmployers surfaces every version, not just the best pick, and
    // reports the API's full total when it exceeds the returned page.
    globalThis.fetch = async () => jsonStream({
      total: 96,
      results: [
        { id: '820544687', name: 'Amazon.com Services LLC' },
        { id: '204938068', name: 'Amazon Web Services, Inc.' },
        { id: '', name: 'dropped: no id' },
      ],
    });
    const search = await api.searchEmployers('Amazon', { timeoutMs: 1_000 });
    if (search.total === 96 && search.results.length === 2 && search.results[0].id === '820544687') {
      pass('searchEmployers: returns every id-bearing result and the API total');
    } else {
      fail(`searchEmployers: ${JSON.stringify(search)}`);
    }
    const emptySearch = await api.searchEmployers('a', { timeoutMs: 1_000 });
    if (emptySearch.total === 0 && emptySearch.results.length === 0) {
      pass('searchEmployers: a sub-2-char query returns nothing without a call');
    } else {
      fail(`searchEmployers short query: ${JSON.stringify(emptySearch)}`);
    }
  } catch (e) {
    fail(`matcher tests crashed: ${e.message}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// ---------- lib/index.mjs: the local index backend ----------
// The default path, exercised against a fixture index written here. Offline by
// construction: this backend has no transport.
if (!existsSync(INDEX_PATH)) {
  fail('lib/index.mjs missing: the plugin ships it');
} else {
  const tmpDir = join(tmpdir(), `h1b-index-${randomUUID()}`);
  const fixture = join(tmpDir, 'index.ndjson.gz');
  try {
    const idx = await import(pathToFileURL(INDEX_PATH).href);
    const { classifyTier } = await import(pathToFileURL(TIER_PATH).href);
    // A line that is not JSON at all, to prove one bad record costs one
    // employer rather than the whole lookup.
    await writeFixtureIndex(fixture, FIXTURE_RECORDS, ['{not json at all']);
    const opts = { indexPath: fixture };

    if (idx.hasIndex(fixture) === true && idx.hasIndex(join(tmpDir, 'nope.gz')) === false) {
      pass('hasIndex: true for an installed index, false for a missing one');
    } else {
      fail('hasIndex: wrong answer for present/absent index');
    }

    const strong = await idx.resolveEmployer('Fixture Strong Corp', opts);
    if (strong && strong.id === '900000001' && strong.displayName === 'Fixture Strong Corp') {
      pass('resolveEmployer: an exact name resolves to its employer id');
    } else {
      fail(`resolveEmployer exact: ${JSON.stringify(strong)}`);
    }

    // Records after the malformed line must still be reachable, which is the
    // point of skipping a bad line rather than failing the scan.
    const staffing = await idx.resolveEmployer('Fixture Staffing LLC', opts);
    if (staffing && staffing.id === '900000002') {
      pass('resolveEmployer: a malformed line is skipped, later records still resolve');
    } else {
      fail(`resolveEmployer past malformed line: ${JSON.stringify(staffing)}`);
    }

    // The suffix rules are the shared ones, so the local path accepts the same
    // spellings the HTTP path does.
    const canon = await idx.resolveEmployer('Fixture Strong Corporation', opts);
    if (canon && canon.id === '900000001') {
      pass('resolveEmployer: a canonicalized legal suffix matches on the index too');
    } else {
      fail(`resolveEmployer suffix canon: ${JSON.stringify(canon)}`);
    }

    const profile = await idx.getEmployerProfile('900000001', opts);
    const keys = profile ? Object.keys(profile).sort().join(',') : '';
    const expectedKeys = ['does_gc', 'employer_id', 'employer_name', 'first_year', 'last_year', 'n_certified', 'n_lca', 'n_perm', 'n_pwd', 'red_flags'].join(',');
    if (keys === expectedKeys) {
      pass('getEmployerProfile: returns exactly the flat profile shape the API path produces');
    } else {
      fail(`getEmployerProfile shape: ${keys}`);
    }
    if (profile && profile.n_lca === 5000 && profile.n_certified === 4800 && profile.n_pwd === 200 && profile.n_perm === 150
        && profile.does_gc === true && profile.first_year === 2019 && profile.last_year === YEAR) {
      pass('getEmployerProfile: counts and years come through unchanged, filed and certified both');
    } else {
      fail(`getEmployerProfile values: ${JSON.stringify(profile)}`);
    }
    // n_total is the filing count: the share's denominator is `filed`, which is
    // why the index stopped shipping the same number twice.
    const shop = profile && profile.red_flags && profile.red_flags.staffing_shop;
    if (shop && shop.value === false && shop.share === 0.05 && shop.n_secondary === 12 && shop.n_total === 5000
        && shop.basis === 'secondary_entity_share') {
      pass('getEmployerProfile: the staffing_shop block carries its basis, with the filing count as its denominator');
    } else {
      fail(`getEmployerProfile staffing_shop: ${JSON.stringify(shop)}`);
    }

    // A record in the pre-release shape (one `lca` field, no `filed`) is not
    // readable as the current one: its certified count would land in the field
    // the tier reads as filings. Skipped like any other malformed line.
    const oldShape = join(tmpDir, 'old-shape.ndjson.gz');
    await writeFixtureIndex(oldShape, [], [
      JSON.stringify({ k: '900000004', n: 'Fixture Old Shape Inc', fy: 2019, ly: YEAR, lca: 4800, pwd: 200, perm: 150, gc: true, sv: false, sh: 0, ns: 0, nt: 5000 }),
    ]);
    const oldResolved = await idx.resolveEmployer('Fixture Old Shape Inc', { indexPath: oldShape });
    const oldProfile = await idx.getEmployerProfile('900000004', { indexPath: oldShape });
    if (oldResolved === null && oldProfile === null) {
      pass('readRecords: a record in the old single-lca shape is skipped, not misread as filings');
    } else {
      fail(`old-shape record: resolved=${JSON.stringify(oldResolved)} profile=${JSON.stringify(oldProfile)}`);
    }

    // classifyTier is the same pure function on both backends; these pin that
    // an index record reaches it in a form it can read.
    const tierCases = [
      ['900000001', 'strong'],
      ['900000002', 'staffing-shop'],
      ['900000003', 'none'],
    ];
    for (const [id, expected] of tierCases) {
      const got = classifyTier(await idx.getEmployerProfile(id, opts));
      if (got === expected) pass(`classifyTier over an index record (${id}) === "${expected}"`);
      else fail(`classifyTier over index record ${id}: got "${got}", expected "${expected}"`);
    }

    // does_gc mirrors the HTTP path's normalizeProfile: the gc flag, or any GC
    // filing at all. An index row whose flag lags its own counts must not
    // classify differently across backends.
    const gcFixture = join(tmpDir, 'gc-or.ndjson.gz');
    await writeFixtureIndex(gcFixture, [
      { k: '900000009', n: 'Fixture GC Lag Inc', fy: 2019, ly: YEAR, filed: 500, cert: 500, pwd: 3, perm: 0, gc: false, sv: false, sh: 0, ns: 0 },
    ]);
    const gcLag = await idx.getEmployerProfile('900000009', { indexPath: gcFixture });
    if (gcLag && gcLag.does_gc === true) {
      pass('getEmployerProfile: GC filings imply does_gc even when the gc flag is false, matching the HTTP path');
    } else {
      fail(`getEmployerProfile gc OR: ${JSON.stringify(gcLag)}`);
    }

    const missName = await idx.resolveEmployer('__definitely_not_a_real_employer_xyz__', opts);
    if (missName === null) pass('resolveEmployer: an unknown name resolves to null, not a near neighbour');
    else fail(`resolveEmployer unknown name: ${JSON.stringify(missName)}`);

    const missId = await idx.getEmployerProfile('nope-nope-nope', opts);
    if (missId === null) pass('getEmployerProfile: an unknown id returns null rather than an empty profile');
    else fail(`getEmployerProfile unknown id: ${JSON.stringify(missId)}`);

    const search = await idx.searchEmployers('Fixture', opts);
    if (search.total === 3 && search.results.length === 3 && search.results.every(r => r.id && r.name)) {
      pass('searchEmployers: lists every entity whose name contains the query, with its id');
    } else {
      fail(`searchEmployers index: ${JSON.stringify(search)}`);
    }
    const searchShort = await idx.searchEmployers('a', opts);
    if (searchShort.total === 0 && searchShort.results.length === 0) {
      pass('searchEmployers: a sub-2-char query returns nothing without reading the index');
    } else {
      fail(`searchEmployers short query on index: ${JSON.stringify(searchShort)}`);
    }

    // The source stamp is the digest, so a rebuilt index is a different source
    // even at the same path. That is what scopes cached answers to one build.
    const source = await idx.indexSource(fixture);
    if (/^local:h1b-index@sha256-[0-9a-f]{12}$/.test(source)) {
      pass(`indexSource: names the index build by digest (${source})`);
    } else {
      fail(`indexSource: ${JSON.stringify(source)}`);
    }
    const other = join(tmpDir, 'other.ndjson.gz');
    await writeFixtureIndex(other, [{ ...FIXTURE_RECORDS[0], filed: 4999 }]);
    if (await idx.indexSource(other) !== source) {
      pass('indexSource: different index contents produce a different source stamp');
    } else {
      fail('indexSource: two different indexes produced the same stamp');
    }

    // A file that is not gzip at all has to fail loudly. .pipe() does not
    // forward errors, so before the source stream was wired to destroy the
    // gunzip this hung forever instead of throwing.
    const corrupt = join(tmpDir, 'corrupt.ndjson.gz');
    await writeFile(corrupt, Buffer.from('this is not gzip', 'utf8'));
    let corruptCode = null;
    try {
      await idx.resolveEmployer('Fixture Strong Corp', { indexPath: corrupt });
    } catch (e) {
      corruptCode = e && e.code;
    }
    if (corruptCode === 'INDEX_UNREADABLE') {
      pass('resolveEmployer: an unreadable index throws INDEX_UNREADABLE rather than hanging');
    } else {
      fail(`corrupt index: code=${corruptCode}`);
    }

    // H1B_INDEX_PATH gets the same treatment H1B_API_BASE does: blank means a
    // typo'd expansion or an empty .env line, and reading the default index
    // while the user believes they replaced it is the failure worth refusing.
    const savedEnv = process.env.H1B_INDEX_PATH;
    try {
      process.env.H1B_INDEX_PATH = '   ';
      let blankMsg = '';
      try {
        idx.indexPath();
      } catch (e) {
        blankMsg = String(e && e.message);
      }
      if (/set but empty/.test(blankMsg)) {
        pass('indexPath: a blank H1B_INDEX_PATH is refused instead of silently using the default');
      } else {
        fail(`indexPath blank: ${JSON.stringify(blankMsg)}`);
      }
      process.env.H1B_INDEX_PATH = fixture;
      if (idx.indexPath() === fixture) pass('indexPath: H1B_INDEX_PATH relocates the index');
      else fail(`indexPath override: ${idx.indexPath()}`);
    } finally {
      if (savedEnv === undefined) delete process.env.H1B_INDEX_PATH;
      else process.env.H1B_INDEX_PATH = savedEnv;
    }
  } catch (e) {
    fail(`index backend tests crashed: ${e.message}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- lib/index.mjs: candidates are ranked by sponsorship evidence ----------
// The API's search buckets are published in descending EVIDENCE order, the
// sum of LCA filings plus PWD plus PERM that etl/publish.py's search_volume()
// computes, so the HTTP backend hands pickBestMatch a ranked list and it lands
// on the employer that actually files. The index is stored in NAME order, and taking
// candidates off it in that order let the alphabet answer instead: against the
// real 335,626-record build, "Meta" resolved to a zero-filing "META 4 LLC" over
// "Meta Platforms, Inc" (38,117 LCAs), and "Google" to "Google Client Services
// LLC" (2) over "Google LLC" (70,985). A tier of `none` for an employer with
// 38,117 filings is the confidently wrong answer this plugin exists to prevent.
//
// The fixture reproduces the shape rather than the size: records in name order,
// the lookalikes ahead of the real entity, real counts.
if (!existsSync(INDEX_PATH)) {
  fail('lib/index.mjs missing: the plugin ships it');
} else {
  const tmpDir = join(tmpdir(), `h1b-rank-${randomUUID()}`);
  const fixture = join(tmpDir, 'index.ndjson.gz');
  const capFixture = join(tmpDir, 'cap.ndjson.gz');
  try {
    const idx = await import(pathToFileURL(INDEX_PATH).href);
    const rec = (k, n, filed, extra = {}) => ({ k, n, fy: 2019, ly: YEAR, filed, cert: filed, pwd: 0, perm: 0, gc: false, sv: false, sh: 0, ns: 0, ...extra });
    await writeFixtureIndex(fixture, [
      // Name order, which is the order the publisher writes and this backend
      // reads. Every zero- and low-volume lookalike sits ahead of the real one.
      rec('r-meta-4', 'META 4 LLC', 0),
      rec('r-meta-care', 'Meta Care, Inc.', 2),
      rec('r-meta-platforms', 'Meta Platforms, Inc', 38117),
      rec('r-google-client', 'Google Client Services LLC', 2),
      rec('r-google-inc', 'GOOGLE INC.', 0),
      rec('r-google-llc', 'Google LLC', 70985),
      // Two records with the SAME normalized name and wildly different volumes,
      // the small one first. Resolving stopped at the first exact name it saw,
      // which on the real index took "Amazon.com Services LLC" at 1 LCA over the
      // 92,132-LCA entity spelled the same way.
      rec('r-amzn-small', 'AMAZON COM SERVICES LLC', 1),
      rec('r-amzn-big', 'Amazon.com Services LLC', 92132),
      // A green card only employer and a same-named sibling with nothing at
      // all, the empty one first. 156,616 employers in the shipped build look
      // like this: no LCA rows, real PWD and PERM filings. Rank on any filing
      // count alone and both of these score 0, which hands the answer back to
      // the alphabet; the evidence sum is what separates them.
      rec('r-willow-shell', 'WILLOW CREEK DENTAL PC', 0),
      rec('r-willow-gc', 'Willow Creek Dental, P.C.', 0, { pwd: 3, perm: 2, gc: true }),
    ]);
    const opts = { indexPath: fixture };

    const rankCases = [
      ['Meta', 'r-meta-platforms', 'Meta Platforms, Inc'],
      ['Google', 'r-google-llc', 'Google LLC'],
      ['Amazon.com Services LLC', 'r-amzn-big', 'Amazon.com Services LLC'],
    ];
    for (const [query, wantId, wantName] of rankCases) {
      const got = await idx.resolveEmployer(query, opts);
      if (got && got.id === wantId && got.displayName === wantName) {
        pass(`resolveEmployer: "${query}" resolves to "${wantName}", not the lookalike that sorts first`);
      } else {
        fail(`resolveEmployer volume rank for "${query}": ${JSON.stringify(got)}`);
      }
    }

    // The specific failure worth naming: a zero-filing shell entity winning
    // makes the CLI report tier `none`, which reads as "DOL data shows nothing"
    // for a company with tens of thousands of filings.
    const zeroLoser = await idx.resolveEmployer('Meta', opts);
    const zeroProfile = zeroLoser ? await idx.getEmployerProfile(zeroLoser.id, opts) : null;
    if (zeroProfile && zeroProfile.n_lca === 38117) {
      pass('resolveEmployer: a zero-filing lookalike never wins over a high-volume plausible match');
    } else {
      fail(`resolveEmployer zero-filing lookalike: ${JSON.stringify(zeroProfile)}`);
    }

    // Green card evidence is evidence. Both of these file zero LCAs, so a rank
    // key built on any filing count alone cannot tell them apart and the file's
    // name order decides, seating the shell first. The sum classifyTier adds up
    // is what makes the entity with 5 green card filings the answer.
    const gcOnly = await idx.resolveEmployer('Willow Creek Dental PC', opts);
    const gcProfile = gcOnly ? await idx.getEmployerProfile(gcOnly.id, opts) : null;
    if (gcOnly && gcOnly.id === 'r-willow-gc' && gcProfile && gcProfile.n_lca === 0
        && gcProfile.n_pwd === 3 && gcProfile.n_perm === 2) {
      pass('resolveEmployer: a GC-only employer outranks a same-named sibling with no evidence at all');
    } else {
      fail(`resolveEmployer GC-only rank: ${JSON.stringify(gcOnly)} ${JSON.stringify(gcProfile)}`);
    }

    // The page a broad --search shows is the top of the ranking too, not the
    // top of the alphabet, so the entities that file are the ones on it.
    const searched = await idx.searchEmployers('Amazon', opts);
    if (searched.total === 2 && searched.results.length === 2 && searched.results[0].id === 'r-amzn-big') {
      pass('searchEmployers: the page leads with the highest-volume match');
    } else {
      fail(`searchEmployers volume rank: ${JSON.stringify(searched)}`);
    }

    // The candidate cap is rank-trimmed, not first-N-in-file-order. A one-token
    // query can be plausible for well over the cap (1,401 employers lead with
    // "New" in the shipped index), and keeping the first 500 by name would drop
    // the only one that files.
    const capRecords = [];
    for (let i = 0; i < 1200; i++) capRecords.push(rec(`r-fill-${i}`, `Capco Fill ${String(i).padStart(4, '0')} Inc`, 0));
    capRecords.push(rec('r-capco-real', 'Capco Zulu Inc', 9999));
    await writeFixtureIndex(capFixture, capRecords);
    const capped = await idx.resolveEmployer('Capco', { indexPath: capFixture });
    if (capped && capped.id === 'r-capco-real') {
      pass('resolveEmployer: the candidate cap drops the lowest-volume matches, never the highest');
    } else {
      fail(`resolveEmployer candidate cap: ${JSON.stringify(capped)}`);
    }
  } catch (e) {
    fail(`volume-rank tests crashed: ${e.message}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- lib/api.mjs BASE is configurable ----------
// A bundled plugin must not hard-depend on one contributor's host: these
// queries reveal that someone needs a visa and which employers they are
// considering, so the destination has to be the user's choice. BASE resolves
// once at module load, so each case runs in its own process.
{
  // A key set to undefined is REMOVED rather than passed as an empty string:
  // the two mean different things now, and empty is itself an error case.
  const childEnv = (over) => {
    const e = { ...process.env, ...over };
    for (const [k, v] of Object.entries(over)) if (v === undefined) delete e[k];
    return e;
  };
  const readBase = (env) => new Promise((resolve) => {
    execFile(
      process.execPath,
      ['-e', "import(process.argv[1]).then(m => process.stdout.write(m.apiBase())).catch(e => { process.stderr.write(String(e && e.message)); process.exitCode = 1; })", pathToFileURL(API_PATH).href],
      { env: childEnv(env), timeout: 20_000 },
      (err, stdout, stderr) => resolve({ code: err && typeof err.code === 'number' ? err.code : 0,
                                         out: String(stdout || '').trim(),
                                         err: String(stderr || '') }),
    );
  });

  const dflt = await readBase({ H1B_API_BASE: undefined });
  if (dflt.out === 'https://api.surakshith.com/immigration/v1') {
    pass('BASE defaults to the maintained endpoint when H1B_API_BASE is unset');
  } else {
    fail(`BASE default: ${JSON.stringify(dflt)}`);
  }

  const custom = await readBase({ H1B_API_BASE: 'https://h1b.example.org/v1' });
  if (custom.out === 'https://h1b.example.org/v1') pass('H1B_API_BASE overrides the endpoint');
  else fail(`BASE override: ${JSON.stringify(custom)}`);

  const slashed = await readBase({ H1B_API_BASE: 'https://h1b.example.org/v1//' });
  if (slashed.out === 'https://h1b.example.org/v1') pass('a trailing slash is trimmed so paths do not double up');
  else fail(`BASE trailing slash: ${JSON.stringify(slashed)}`);

  const local = await readBase({ H1B_API_BASE: 'http://localhost:8787/immigration/v1' });
  if (local.out === 'http://localhost:8787/immigration/v1') pass('loopback http is allowed for local development');
  else fail(`BASE loopback: ${JSON.stringify(local)}`);

  // Failing loudly matters more than being lenient: quietly falling back would
  // send these queries to a host the user did not choose.
  const insecure = await readBase({ H1B_API_BASE: 'http://h1b.example.org/v1' });
  if (insecure.code !== 0 && /must use https/.test(insecure.err)) {
    pass('a non-loopback http base is refused rather than silently defaulted');
  } else {
    fail(`BASE http: ${JSON.stringify(insecure)}`);
  }

  // The loopback exemption is for http specifically. Exempting every scheme on
  // a loopback host waved ftp://localhost and ws://localhost past validation,
  // and those surface later as a bare "fetch failed" instead of the named
  // configuration error this validator exists to give.
  for (const [label, value] of [['ftp', 'ftp://localhost/v1'], ['ws', 'ws://localhost:8787/v1']]) {
    const scheme = await readBase({ H1B_API_BASE: value });
    if (scheme.code !== 0 && /must use https/.test(scheme.err)) {
      pass(`a loopback ${label}:// base is refused at config time, not later inside fetch`);
    } else {
      fail(`BASE loopback ${label}: ${JSON.stringify(scheme)}`);
    }
  }

  const junk = await readBase({ H1B_API_BASE: 'not a url' });
  if (junk.code !== 0 && /not a valid URL/.test(junk.err)) pass('an unparseable base is refused');
  else fail(`BASE junk: ${JSON.stringify(junk)}`);

  // A blank value is what a typo'd shell expansion or an empty .env line
  // produces. Treating it as "unset" would route someone's shortlist and their
  // token to the default host while they believed they had replaced it.
  for (const [label, value] of [['empty', ''], ['whitespace', '   ']]) {
    const blank = await readBase({ H1B_API_BASE: value });
    if (blank.code !== 0 && /set but empty/.test(blank.err)) {
      pass(`a ${label} base is refused instead of silently using the default`);
    } else {
      fail(`BASE ${label}: ${JSON.stringify(blank)}`);
    }
  }

  // Undici refuses a credentialed Request, and the value reaches stdout via
  // the source field, so accepting one would print the user's password.
  const creds = await readBase({ H1B_API_BASE: 'https://alice:hunter2@h1b.example.org/v1' });
  if (creds.code !== 0 && /credentials/.test(creds.err) && !/hunter2/.test(creds.err)) {
    pass('a base embedding credentials is refused, and the password is not echoed');
  } else {
    fail(`BASE credentials: ${JSON.stringify(creds)}`);
  }

  // Paths are appended, so a query or fragment swallows them and the request
  // would answer about a company that was never asked for.
  for (const [label, value] of [['query', 'https://h1b.example.org/v1?k=1'],
                                ['fragment', 'https://h1b.example.org/v1#f']]) {
    const bad = await readBase({ H1B_API_BASE: value });
    if (bad.code !== 0 && /query string or a fragment/.test(bad.err)) {
      pass(`a base carrying a ${label} is refused`);
    } else {
      fail(`BASE ${label}: ${JSON.stringify(bad)}`);
    }
  }

  // Resolution is lazy: importing the module with a broken value must not
  // throw, or one bad variable takes down the repo's whole test run.
  const importOnly = await new Promise((resolve) => {
    execFile(
      process.execPath,
      ['-e', "import(process.argv[1]).then(() => process.stdout.write('IMPORT_OK'))", pathToFileURL(API_PATH).href],
      { env: { ...process.env, H1B_API_BASE: 'not a url' }, timeout: 20_000 },
      (err, stdout) => resolve({ code: err && typeof err.code === 'number' ? err.code : 0, out: String(stdout || '').trim() }),
    );
  });
  if (importOnly.code === 0 && importOnly.out === 'IMPORT_OK') {
    pass('importing the client with a broken base does not throw at load');
  } else {
    fail(`lazy import: ${JSON.stringify(importOnly)}`);
  }
}

// ---------- the egress guard follows the CONFIGURED base ----------
// Pointing at a private instance must not widen where requests may go, so a
// redirect toward the DEFAULT host is off-host once a custom base is set.
{
  const script = [
    "const api = await import(process.argv[1]);",
    "globalThis.fetch = async () => ({",
    "  status: 302,",
    "  headers: { get: (h) => (h.toLowerCase() === 'location'",
    "    ? 'https://api.surakshith.com/immigration/v1/employers/search?q=acme' : null) },",
    "});",
    "try { await api.resolveEmployer('Acme', { timeoutMs: 1000 }); process.stdout.write('NO_THROW'); }",
    "catch (e) { process.stdout.write(String(e && e.code)); }",
  ].join('\n');

  const out = await new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--input-type=module', '-e', script, pathToFileURL(API_PATH).href],
      { env: { ...process.env, H1B_API_BASE: 'https://h1b.example.org/immigration/v1' }, timeout: 20_000 },
      (_err, stdout) => resolve(String(stdout || '').trim()),
    );
  });
  if (out === 'REDIRECT_OFF_HOST') {
    pass('a redirect to the default host is refused when a custom base is configured');
  } else {
    fail(`configured-base egress guard: got ${out}`);
  }
}

// ---------- lib/api.mjs readBoundedText: streaming byte ceiling ----------
// Ungated and offline. res.text()/res.json() buffer a whole body before any
// size check can run, so the reader streams and cancels mid-body instead. These
// drive the REAL reader (the mintToken envelope tests use a fake envelope and
// never reach it).
if (!existsSync(API_PATH)) {
  fail('lib/api.mjs missing: the plugin ships it');
} else {
  const { readBoundedText } = await import(pathToFileURL(API_PATH).href);

  // A Response-like whose body streams the given chunks and records cancel().
  const streamRes = (chunks, headers = {}) => {
    const state = { cancelled: false, bodyCancelled: false, delivered: 0 };
    let i = 0;
    const res = {
      headers: { get: (h) => headers[String(h).toLowerCase()] ?? null },
      body: {
        // A real ReadableStream has cancel(); the Content-Length short-circuit
        // calls it to release a body it will never read.
        cancel: async () => { state.bodyCancelled = true; },
        getReader: () => ({
          read: async () => {
            if (i >= chunks.length) return { done: true, value: undefined };
            const value = chunks[i++];
            state.delivered += value.byteLength;
            return { done: false, value };
          },
          cancel: async () => { state.cancelled = true; },
          releaseLock: () => {},
        }),
      },
    };
    return { res, state };
  };

  const enc = new TextEncoder();

  // Multibyte characters split across a chunk boundary must survive. Splitting
  // at a single hand-picked index is not enough: an index that happens to land
  // between characters leaves both halves independently valid, so the case
  // would pass even if each chunk were decoded separately. Walk every internal
  // byte boundary instead, which includes the ones inside a character.
  const full = 'Nestl\u00e9 S.A. \u65e5\u672c \ud83d\ude80 Corp';
  const allBytes = enc.encode(full);
  let splitFailures = 0;
  for (let cut = 1; cut < allBytes.length; cut++) {
    const split = streamRes([allBytes.slice(0, cut), allBytes.slice(cut)]);
    const out = await readBoundedText(split.res, 1024);
    if (out.text !== full) splitFailures++;
  }
  if (splitFailures === 0) {
    pass(`readBoundedText: rejoins multibyte characters at all ${allBytes.length - 1} chunk boundaries`);
  } else {
    fail(`readBoundedText multibyte: ${splitFailures} of ${allBytes.length - 1} boundaries corrupted`);
  }

  // A chunk that cannot report its size must fail closed, not sail past the
  // ceiling on a NaN total and hand back a truncated body as complete.
  const nanChunk = streamRes([{ byteLength: undefined }]);
  const nanOut = await readBoundedText(nanChunk.res, 1024);
  if (nanOut.oversized === true) pass('readBoundedText: a chunk with no usable byteLength is refused');
  else fail(`readBoundedText NaN chunk: ${JSON.stringify(nanOut)}`);

  // Over the ceiling: cancels the reader, reports oversized, and stops pulling.
  const big = streamRes([enc.encode('x'.repeat(600)), enc.encode('y'.repeat(600)), enc.encode('z'.repeat(600))]);
  const over = await readBoundedText(big.res, 1000);
  if (over.oversized === true && big.state.cancelled === true && big.state.delivered <= 1200) {
    pass('readBoundedText: cancels mid-body once the byte ceiling is passed');
  } else {
    fail(`readBoundedText oversized: ${JSON.stringify(over)} cancelled=${big.state.cancelled} delivered=${big.state.delivered}`);
  }

  // A Content-Length past the ceiling short-circuits before any read, and
  // cancels the body it is walking away from. Returning without cancelling
  // would leave the connection pinned until garbage collection.
  const declared = streamRes([enc.encode('small')], { 'content-length': String(5 * 1024 * 1024) });
  const declaredOut = await readBoundedText(declared.res, 1024);
  if (declaredOut.oversized === true && declared.state.delivered === 0 && declared.state.bodyCancelled === true) {
    pass('readBoundedText: an oversized Content-Length short-circuits the read and releases the body');
  } else {
    fail(`readBoundedText content-length: ${JSON.stringify(declaredOut)} delivered=${declared.state.delivered} bodyCancelled=${declared.state.bodyCancelled}`);
  }

  // A lying Content-Length does not get to bypass the streaming count.
  const lying = streamRes([enc.encode('a'.repeat(4000))], { 'content-length': '10' });
  const lyingOut = await readBoundedText(lying.res, 1000);
  if (lyingOut.oversized === true) pass('readBoundedText: streaming enforces the cap when Content-Length lies');
  else fail(`readBoundedText lying content-length: ${JSON.stringify(lyingOut)}`);

  // No body at all (204-style) reads as empty rather than throwing.
  const empty = await readBoundedText({ headers: { get: () => null }, text: async () => '' }, 1024);
  if (empty.text === '') pass('readBoundedText: a body-less response reads as empty');
  else fail(`readBoundedText empty: ${JSON.stringify(empty)}`);

  // The body-less fallback has no stream to count, so it measures the buffered
  // text in BYTES. Measuring UTF-16 code units instead (what String.length
  // reports) waves a multibyte body straight past a byte ceiling: these 400
  // CJK characters are 400 units but 1200 bytes.
  const wide = '日'.repeat(400);
  const wideOut = await readBoundedText({ headers: { get: () => null }, text: async () => wide }, 1000);
  if (wideOut.oversized === true) {
    pass('readBoundedText: the body-less fallback counts bytes, not UTF-16 units');
  } else {
    fail(`readBoundedText body-less multibyte: oversized=${wideOut.oversized} len=${(wideOut.text || '').length}`);
  }

  // A stream that dies mid-read (undici reports a reset or truncated response
  // as TypeError: terminated) must land on the same unparseable-body outcome
  // the buffered read used to give, not escape as a raw transport error.
  {
    const originalFetch = globalThis.fetch;
    try {
      const api = await import(pathToFileURL(API_PATH).href);
      globalThis.fetch = async () => ({
        status: 200,
        ok: true,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: async () => { throw new TypeError('terminated'); },
            cancel: async () => {},
            releaseLock: () => {},
          }),
        },
      });
      let code = null;
      let raw = null;
      try {
        await api.searchEmployers('Acme', { timeoutMs: 1_000 });
      } catch (err) {
        code = err && err.code;
        raw = err && err.constructor && err.constructor.name;
      }
      if (code === 'BAD_JSON') pass('read path: a mid-stream transport failure becomes BAD_JSON');
      else fail(`read path stream error: code=${code} type=${raw}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // The other half of that distinction: an AbortError is the shared fetch timer
  // firing, not an unusable body, so it has to stay a TIMEOUT. Both body reads
  // re-throw it for that reason (the 2xx read and the error-status read that
  // only collects an excerpt), and a catch that swallowed it would report a
  // timed-out request as BAD_JSON or as the bare HTTP status, hiding the cause
  // and pointing the user at the wrong fix.
  {
    const originalFetch = globalThis.fetch;
    const abortingBody = (status) => ({
      status,
      ok: status < 400,
      statusText: 'Server Error',
      headers: { get: () => null },
      body: {
        cancel: async () => {},
        getReader: () => ({
          read: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; },
          cancel: async () => {},
          releaseLock: () => {},
        }),
      },
    });
    try {
      const api = await import(pathToFileURL(API_PATH).href);
      for (const [status, label] of [[200, '2xx'], [500, 'error-status']]) {
        globalThis.fetch = async () => abortingBody(status);
        let code = null;
        try {
          await api.searchEmployers('Acme', { timeoutMs: 1_000 });
        } catch (err) {
          code = err && err.code;
        }
        if (code === 'TIMEOUT') pass(`read path: a stalled ${label} body surfaces as TIMEOUT`);
        else fail(`read path stalled ${label} body: code=${code} (expected TIMEOUT)`);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // End to end on the read path: an oversized streamed body surfaces as
  // BODY_TOO_LARGE rather than being parsed or silently truncated.
  const originalFetch = globalThis.fetch;
  try {
    const api = await import(pathToFileURL(API_PATH).href);
    globalThis.fetch = async () => {
      const { res } = streamRes([enc.encode('{"results":['), enc.encode('0'.repeat(2 * 1024 * 1024))]);
      res.status = 200;
      res.ok = true;
      return res;
    };
    let code = null;
    try {
      await api.searchEmployers('Acme', { timeoutMs: 1_000 });
    } catch (e) {
      code = e && e.code;
    }
    if (code === 'BODY_TOO_LARGE') pass('read path: an oversized response throws BODY_TOO_LARGE');
    else fail(`read path oversized: code=${code}`);
  } catch (e) {
    fail(`read path oversized crashed: ${e.message}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// ---------- check.mjs --search display sanitizer ----------
// Driven end to end against a fixture index holding one hostile employer name,
// so the assertion covers the real read path rather than a stubbed transport.
// This pins the control-char strip on the text output (a crafted name must not
// smuggle terminal escapes or a forged row) and the raw pass-through on JSON.
{
  const tmpDir = join(tmpdir(), `h1b-sanitize-${randomUUID()}`);
  const fixture = join(tmpDir, 'index.ndjson.gz');
  try {
    await writeFixtureIndex(fixture, [
      { k: EVIL_ID, n: EVIL_NAME, fy: 2020, ly: YEAR, filed: 5, cert: 5, pwd: 0, perm: 0, gc: false, sv: false, sh: 0, ns: 0 },
    ]);

    const runSearch = (extra) => new Promise((resolve) => {
      execFile(
        process.execPath,
        [CHECK_PATH, 'Evil', '--search', ...extra],
        { env: { ...process.env, H1B_INDEX_PATH: fixture }, timeout: 20_000 },
        (err, stdout) => resolve(String(stdout || '')),
      );
    });

    const textOut = await runSearch([]);
    const hasControl = [...textOut].some(ch => { const c = ch.charCodeAt(0); return (c < 32 && c !== 10 && c !== 13) || c === 127 || (c >= 128 && c <= 159); });
    const oneRow = textOut.trim().split('\n').length === 2; // header + single row
    if (!hasControl && oneRow && /FORGED ROW/.test(textOut)) {
      pass('search text output strips control chars and keeps the forged row on one line');
    } else {
      fail(`search text sanitizer: control=${hasControl} rows=${textOut.trim().split('\n').length}`);
    }

    const jsonOut = await runSearch(['--json']);
    let rawKept = false;
    try {
      const parsed = JSON.parse(jsonOut);
      rawKept = parsed.results[0].name.includes(ESC + '[31m') && parsed.results[0].id.includes(ESC + '[7m');
    } catch { rawKept = false; }
    if (rawKept) pass('search JSON output keeps the raw unsanitized fields');
    else fail(`search JSON raw fields: ${jsonOut.slice(0, 120)}`);
  } catch (e) {
    fail(`sanitizer tests crashed: ${e.message}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- check.mjs: a broken base still emits the documented envelope ----------
// The base resolves lazily and is reported back through `source`, so the error
// handler that exists to report a bad value has to survive it throwing. Letting
// it escape replaces the documented JSON envelope with a raw stack trace on
// stderr. Ungated and offline: a set H1B_API_BASE selects the HTTP backend, and
// apiBase() then throws before any URL is built. H1B_INDEX_PATH points where no
// index is so the failure cannot be read as a fallback that worked.
// --cache-dir keeps the repo cache untouched.
{
  const tmpDir = join(tmpdir(), `h1b-badbase-${randomUUID()}`);
  await new Promise((resolve) => {
    execFile(
      process.execPath,
      [CHECK_PATH, 'Acme', '--json', '--cache-dir', tmpDir],
      { env: { ...process.env, H1B_API_BASE: 'not a url', H1B_INDEX_PATH: NO_INDEX }, timeout: 20_000 },
      (err, stdout, stderr) => {
        const code = (err && typeof err.code === 'number') ? err.code : 0;
        let parsed = null;
        try { parsed = JSON.parse(String(stdout || '')); } catch { /* not JSON, asserted below */ }
        const shaped = Boolean(parsed)
          && parsed.found === false
          && parsed.source === null
          && parsed.friendlinessTier === 'unknown'
          && Boolean(parsed.totals)
          && Boolean(parsed.redFlags)
          && /H1B_API_BASE/.test(String(parsed.error || ''));
        // An unhandled throw prints the failing line and a stack; the handled
        // path writes nothing to stderr at all.
        const crashed = /at resolveBase/.test(String(stderr || ''));
        if (code === 1 && shaped && !crashed) {
          pass('check.mjs: a broken base emits the documented envelope (source null, error set), not a stack trace');
        } else {
          fail(`check.mjs broken base: exit ${code}, stdout=${String(stdout || '').slice(0, 160)}, stderr=${String(stderr || '').slice(0, 160)}`);
        }
        resolve();
      },
    );
  });
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
}

// ---------- check.mjs: no index and no endpoint sends nothing ----------
// The behaviour the local-first default exists for. With no index installed and
// no H1B_API_BASE, the CLI must report `unknown`, say how to install the index,
// and make no request at all, rather than quietly falling back to a default
// host, which would send exactly the query the local path exists to keep at
// home.
//
// The proof is a poisoned globalThis.fetch that records the attempt to a file
// before throwing. A marker file rather than an in-process counter because the
// CLI's error path ends the process itself, discarding whatever a wrapper had
// buffered but not yet written.
{
  const tmpDir = join(tmpdir(), `h1b-nobackend-${randomUUID()}`);
  const marker = join(tmpDir, 'egress.txt');
  const wrapperFile = join(tmpDir, 'run.mjs');
  try {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(wrapperFile, [
      "import { writeFileSync } from 'node:fs';",
      `globalThis.fetch = async (...args) => { writeFileSync(${JSON.stringify(marker)}, String(args[0]), 'utf8'); throw new Error('EGRESS'); };`,
      `process.argv = [process.argv[0], ${JSON.stringify(CHECK_PATH)}, 'Acme Corp', '--json', '--cache-dir', ${JSON.stringify(join(tmpDir, 'cache'))}];`,
      `await import(${JSON.stringify(pathToFileURL(CHECK_PATH).href)});`,
    ].join('\n'), 'utf8');

    await new Promise((resolve) => {
      const env = { ...process.env, H1B_INDEX_PATH: NO_INDEX };
      delete env.H1B_API_BASE;
      delete env.H1B_API_TOKEN;
      execFile(process.execPath, [wrapperFile], { env, timeout: 20_000 }, (err, stdout) => {
        const code = (err && typeof err.code === 'number') ? err.code : 0;
        let parsed = null;
        try { parsed = JSON.parse(String(stdout || '')); } catch { /* asserted below */ }
        const shaped = Boolean(parsed)
          && parsed.found === false
          && parsed.source === null
          && parsed.friendlinessTier === 'unknown'
          && Boolean(parsed.totals)
          && Boolean(parsed.redFlags)
          && /install-h1b-index\.mjs/.test(String(parsed.error || ''));
        if (code === 1 && shaped) {
          pass('check.mjs: with no index and no endpoint, the envelope says unknown and names install-h1b-index.mjs');
        } else {
          fail(`check.mjs no backend: exit ${code}, stdout=${String(stdout || '').slice(0, 200)}`);
        }
        if (!existsSync(marker)) {
          pass('check.mjs: with no index and no endpoint, fetch is never called (zero egress)');
        } else {
          fail('check.mjs no backend: fetch was called, the marker file was written');
        }
        resolve();
      });
    });
  } catch (e) {
    fail(`no-backend tests crashed: ${e.message}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- check.mjs: an explicit H1B_API_BASE wins over an installed index ----------
// Backend order is explicit choice, then the local default, then an error. An
// installed index used to win unconditionally, so someone who deliberately set
// H1B_API_BASE had it read and then ignored without a word. Silently
// disregarding a configured value is the same class of surprise as silently
// picking a host, which the local-first default exists to rule out.
//
// Both halves are asserted in one place because they are one rule: with the
// variable set the endpoint answers even though an index is right there, and
// with it unset the same index answers and nothing is sent. The child stubs
// globalThis.fetch, so the endpoint half is offline too, and its employer id is
// one the fixture index does not contain, which is what tells the two apart.
if (!existsSync(CHECK_PATH) || !existsSync(INDEX_PATH)) {
  fail('check.mjs or lib/index.mjs missing: the plugin ships them');
} else {
  const tmpDir = join(tmpdir(), `h1b-precedence-${randomUUID()}`);
  const fixture = join(tmpDir, 'index.ndjson.gz');
  const BASE = 'https://precedence-probe.example/v1';
  const NAME = 'Fixture Strong Corp';
  try {
    await writeFixtureIndex(fixture);
    const wrapperFile = join(tmpDir, 'run.mjs');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(wrapperFile, [
      'let calls = 0;',
      'globalThis.fetch = async (url) => {',
      '  calls++;',
      "  const body = String(url).includes('/employers/search')",
      `    ? { results: [{ id: 'from-endpoint', name: ${JSON.stringify(NAME)} }] }`,
      `    : { employer: { name: ${JSON.stringify(NAME)}, id: 'from-endpoint' }, filings: { certified: 42 }, green_card: { pwd: 0, perm: 0 } };`,
      '  return new Response(JSON.stringify(body), { status: 200 });',
      '};',
      `process.argv = [process.argv[0], ${JSON.stringify(CHECK_PATH)}, ${JSON.stringify(NAME)}, '--json', '--cache-dir', ${JSON.stringify(join(tmpDir, 'cache'))}, '--refresh'];`,
      'const chunks = [];',
      'const write = process.stdout.write.bind(process.stdout);',
      'process.stdout.write = (s) => { chunks.push(String(s)); return true; };',
      `await import(${JSON.stringify(pathToFileURL(CHECK_PATH).href)});`,
      'for (let i = 0; i < 200 && chunks.length === 0; i++) await new Promise(r => setTimeout(r, 25));',
      'process.stdout.write = write;',
      "write(JSON.stringify({ calls, out: chunks.join('') }));",
    ].join('\n'), 'utf8');

    const runWith = (base) => new Promise((resolve) => {
      const env = { ...process.env, H1B_INDEX_PATH: fixture };
      delete env.H1B_API_TOKEN;
      if (base === undefined) delete env.H1B_API_BASE;
      else env.H1B_API_BASE = base;
      execFile(process.execPath, [wrapperFile], { env, timeout: 30_000 }, (_err, stdout) => {
        let outer = null;
        try { outer = JSON.parse(String(stdout || '')); } catch { /* reported by the caller */ }
        let result = null;
        try { result = JSON.parse(String((outer && outer.out) || '')); } catch { /* ditto */ }
        resolve({ calls: outer && outer.calls, result, raw: String(stdout || '').slice(0, 200) });
      });
    });

    const withBase = await runWith(BASE);
    if (withBase.result && withBase.result.employerId === 'from-endpoint'
        && withBase.result.source === `${BASE}/employers/from-endpoint` && withBase.calls === 2) {
      pass('check.mjs: an explicit H1B_API_BASE is used even with an index installed');
    } else {
      fail(`check.mjs base precedence: calls=${withBase.calls} result=${JSON.stringify(withBase.result)} raw=${withBase.raw}`);
    }

    const withoutBase = await runWith(undefined);
    if (withoutBase.result && withoutBase.result.employerId === '900000001'
        && String(withoutBase.result.source).startsWith('local:h1b-index@') && withoutBase.calls === 0) {
      pass('check.mjs: with H1B_API_BASE unset the index still answers, and nothing is sent');
    } else {
      fail(`check.mjs default backend: calls=${withoutBase.calls} result=${JSON.stringify(withoutBase.result)} raw=${withoutBase.raw}`);
    }
  } catch (e) {
    fail(`backend precedence tests crashed: ${e.message}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- check.mjs: the cache is backend-aware ----------
// A cached answer belongs to whatever produced it, and the `source` field is
// rebuilt from the CURRENT backend, so serving an entry another one wrote would
// label its data as this one's. Entries written before this field existed carry
// a `base` instead, so the first run after an upgrade has to re-fetch rather
// than serve them blind, for negative entries too, where a stale "unknown" is
// the answer that quietly ends a search.
//
// Ungated and offline: the child stubs globalThis.fetch (and counts calls)
// before importing check.mjs, every run uses a scratch cache dir, and
// H1B_INDEX_PATH points where no index is so the HTTP backend is the one under
// test. The base values are fictional so the assertion never depends on which
// endpoint the machine running the suite is configured for.
if (!existsSync(CHECK_PATH) || !existsSync(CACHE_PATH)) {
  fail('check.mjs or lib/cache.mjs missing: the plugin ships them');
} else {
  const { cacheKey } = await import(pathToFileURL(CACHE_PATH).href);
  const tmpDir = join(tmpdir(), `h1b-endpoint-cache-${randomUUID()}`);
  // The marker check.mjs stamps entries with. It exists because what the
  // numbers in an entry MEAN can change without the endpoint changing: the
  // bump to 2 is when n_lca stopped being a certified count and became the
  // filing count the tier sums.
  const SCHEMA = 2;
  const CURRENT = 'https://cache-probe.example/v1';
  const OTHER = 'https://other-probe.example/v1';
  const NAME = 'CachedProbeCo';
  const PROFILE = {
    n_lca: 500, n_pwd: 10, n_perm: 5, does_gc: true,
    first_year: 2019, last_year: new Date().getUTCFullYear(),
    red_flags: { staffing_shop: null },
  };

  // Seed one cache entry, run check.mjs against it with a stubbed fetch, and
  // report { calls, result }. calls === 0 means the entry was served.
  const runAgainst = async (entry) => {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      join(tmpDir, `${cacheKey(NAME)}.json`),
      JSON.stringify({ ...entry, fetchedAt: new Date().toISOString() }, null, 2),
      'utf8',
    );
    const wrapperFile = join(tmpDir, `run-${randomUUID()}.mjs`);
    await writeFile(wrapperFile, [
      'let calls = 0;',
      'globalThis.fetch = async (url) => {',
      '  calls++;',
      "  const body = String(url).includes('/employers/search')",
      `    ? { results: [{ id: 'refetched', name: ${JSON.stringify(NAME)} }] }`,
      `    : { employer: { name: ${JSON.stringify(NAME)}, id: 'refetched' }, filings: { certified: 777 }, green_card: { pwd: 1, perm: 1 } };`,
      '  return new Response(JSON.stringify(body), { status: 200 });',
      '};',
      `process.argv = [process.argv[0], ${JSON.stringify(CHECK_PATH)}, ${JSON.stringify(NAME)}, '--json', '--cache-dir', ${JSON.stringify(tmpDir)}];`,
      'const chunks = [];',
      'const write = process.stdout.write.bind(process.stdout);',
      'process.stdout.write = (s) => { chunks.push(String(s)); return true; };',
      // check.mjs calls main() without awaiting it, so the import resolves
      // before the answer is written. Poll rather than sleep a fixed span.
      `await import(${JSON.stringify(pathToFileURL(CHECK_PATH).href)});`,
      'for (let i = 0; i < 200 && chunks.length === 0; i++) await new Promise(r => setTimeout(r, 25));',
      'process.stdout.write = write;',
      "write(JSON.stringify({ calls, out: chunks.join('') }));",
    ].join('\n'), 'utf8');

    return new Promise((resolve) => {
      execFile(
        process.execPath,
        [wrapperFile],
        { env: { ...process.env, H1B_API_BASE: CURRENT, H1B_INDEX_PATH: NO_INDEX }, timeout: 30_000 },
        (_err, stdout) => {
          let outer = null;
          try { outer = JSON.parse(String(stdout || '')); } catch { /* reported by the caller */ }
          let result = null;
          try { result = JSON.parse(String((outer && outer.out) || '')); } catch { /* ditto */ }
          resolve({ calls: outer && outer.calls, result, raw: String(stdout || '').slice(0, 200) });
        },
      );
    });
  };

  const cases = [
    {
      label: 'an entry from the CURRENT endpoint is served without a request',
      entry: { data: { displayName: 'Cached Same', employerId: 'same-1', profile: PROFILE, source: CURRENT, schema: SCHEMA } },
      ok: (r) => r.calls === 0 && r.result && r.result.employerId === 'same-1',
    },
    {
      // The endpoint's URL does not change when the meaning of its numbers
      // does, so provenance alone cannot catch this one: an entry written
      // before the bump has a certified count sitting in `n_lca`, which the
      // tier now reads as filings. The marker is what makes it a miss.
      label: 'an entry written before the schema bump is a miss even from the current endpoint',
      entry: { data: { displayName: 'Cached Pre-Bump', employerId: 'prebump-1', profile: PROFILE, source: CURRENT } },
      ok: (r) => r.calls === 2 && r.result && r.result.employerId === 'refetched'
        && r.result.totals && r.result.totals.n_certified === 777,
    },
    {
      label: 'an entry from ANOTHER endpoint is a miss, not the answer from another instance',
      entry: { data: { displayName: 'Cached Other', employerId: 'other-1', profile: PROFILE, source: OTHER } },
      ok: (r) => r.calls === 2 && r.result && r.result.employerId === 'refetched',
    },
    {
      label: 'an entry stamped with an index build is a miss on an endpoint',
      entry: { data: { displayName: 'Cached Local', employerId: 'local-1', profile: PROFILE, source: 'local:h1b-index@sha256-000000000000' } },
      ok: (r) => r.calls === 2 && r.result && r.result.employerId === 'refetched',
    },
    {
      label: 'a pre-upgrade entry keyed on `base` re-fetches instead of serving blind',
      entry: { data: { displayName: 'Cached Legacy', employerId: 'legacy-1', profile: PROFILE, base: CURRENT } },
      ok: (r) => r.calls === 2 && r.result && r.result.employerId === 'refetched',
    },
    {
      label: 'an entry with no provenance at all re-fetches instead of serving blind',
      entry: { data: { displayName: 'Cached Ancient', employerId: 'ancient-1', profile: PROFILE } },
      ok: (r) => r.calls === 2 && r.result && r.result.employerId === 'refetched',
    },
    {
      label: 'a NEGATIVE entry from the current endpoint still short-circuits',
      entry: { negative: true, data: { name: NAME, source: CURRENT, schema: SCHEMA } },
      ok: (r) => r.calls === 0 && r.result && r.result.found === false,
    },
    {
      label: 'a pre-upgrade NEGATIVE entry re-fetches rather than repeating a stale unknown',
      entry: { negative: true, data: { name: NAME, base: CURRENT } },
      ok: (r) => r.calls === 2 && r.result && r.result.found === true,
    },
    {
      label: 'a malformed entry payload is a miss, not a crash',
      entry: { negative: true, data: null },
      ok: (r) => r.calls === 2 && r.result && r.result.found === true,
    },
  ];

  for (const c of cases) {
    let got;
    try {
      got = await runAgainst(c.entry);
    } catch (e) {
      fail(`endpoint cache: "${c.label}" crashed: ${e.message}`);
      continue;
    }
    if (c.ok(got)) pass(`endpoint cache: ${c.label}`);
    else fail(`endpoint cache: ${c.label}: calls=${got.calls} result=${JSON.stringify(got.result)} raw=${got.raw}`);
  }
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
}

// ---------- check.mjs: cached answers are scoped to the index build ----------
// The local equivalent of the endpoint scoping above. DOL republishes quarterly
// and the refresh changes every number an employer has, so an answer from the
// previous build must not survive into the next one. The stamp is the index
// digest, which changes on any rebuild.
//
// There is no request to count here, so the seeded entry carries a distinctive
// employer id: getting it back means it was served, and getting the fixture's
// own id means the index was read again.
if (!existsSync(CHECK_PATH) || !existsSync(INDEX_PATH)) {
  fail('check.mjs or lib/index.mjs missing: the plugin ships them');
} else {
  const { cacheKey } = await import(pathToFileURL(CACHE_PATH).href);
  const idx = await import(pathToFileURL(INDEX_PATH).href);
  const tmpDir = join(tmpdir(), `h1b-index-cache-${randomUUID()}`);
  const fixture = join(tmpDir, 'index.ndjson.gz');
  const cacheDir = join(tmpDir, 'cache');
  const NAME = 'Fixture Strong Corp';
  try {
    await writeFixtureIndex(fixture);
    const current = await idx.indexSource(fixture);

    const runWithEntry = async (entry) => {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(
        join(cacheDir, `${cacheKey(NAME)}.json`),
        JSON.stringify({ ...entry, fetchedAt: new Date().toISOString() }, null, 2),
        'utf8',
      );
      // H1B_API_BASE is unset explicitly, not just left alone: it now outranks
      // an installed index, so a developer who has one configured would
      // otherwise run this against their endpoint instead of the fixture.
      const env = { ...process.env, H1B_INDEX_PATH: fixture };
      delete env.H1B_API_BASE;
      return new Promise((resolve) => {
        execFile(
          process.execPath,
          [CHECK_PATH, NAME, '--json', '--cache-dir', cacheDir],
          { env, timeout: 30_000 },
          (_err, stdout) => {
            let parsed = null;
            try { parsed = JSON.parse(String(stdout || '')); } catch { /* reported by the caller */ }
            resolve({ parsed, raw: String(stdout || '').slice(0, 200) });
          },
        );
      });
    };

    const hit = await runWithEntry({
      data: { displayName: 'Cached Build', employerId: 'cached-local-1', profile: { n_lca: 1, n_certified: 1, n_pwd: 0, n_perm: 0, does_gc: false, first_year: 2019, last_year: YEAR, red_flags: { staffing_shop: null } }, source: current, schema: 2 },
    });
    if (hit.parsed && hit.parsed.employerId === 'cached-local-1' && hit.parsed.source === current) {
      pass('index cache: an entry stamped with the installed build is served as-is');
    } else {
      fail(`index cache same-build: ${hit.raw}`);
    }

    // The local backend self-heals on the digest alone, since a rebuilt index
    // is a different source. The schema marker is still required, so an entry
    // from before the bump cannot be served even at an unchanged digest.
    const preBump = await runWithEntry({
      data: { displayName: 'Cached Pre-Bump', employerId: 'cached-prebump-1', profile: { n_lca: 1, n_pwd: 0, n_perm: 0, does_gc: false, first_year: 2019, last_year: YEAR, red_flags: { staffing_shop: null } }, source: current },
    });
    if (preBump.parsed && preBump.parsed.employerId === '900000001' && preBump.parsed.totals.n_lca === 5000) {
      pass('index cache: an entry without the schema marker is re-read from the installed index');
    } else {
      fail(`index cache pre-bump entry: ${preBump.raw}`);
    }

    const stale = await runWithEntry({
      data: { displayName: 'Cached Old Build', employerId: 'cached-old-1', profile: { n_lca: 1, n_pwd: 0, n_perm: 0, does_gc: false, first_year: 2019, last_year: YEAR, red_flags: { staffing_shop: null } }, source: 'local:h1b-index@sha256-000000000000' },
    });
    if (stale.parsed && stale.parsed.employerId === '900000001' && stale.parsed.totals.n_lca === 5000) {
      pass('index cache: an entry from a different build is re-read from the installed index');
    } else {
      fail(`index cache other-build: ${stale.raw}`);
    }

    const fromEndpoint = await runWithEntry({
      data: { displayName: 'Cached Endpoint', employerId: 'endpoint-1', profile: { n_lca: 1, n_pwd: 0, n_perm: 0, does_gc: false, first_year: 2019, last_year: YEAR, red_flags: { staffing_shop: null } }, source: 'https://cache-probe.example/v1' },
    });
    if (fromEndpoint.parsed && fromEndpoint.parsed.employerId === '900000001') {
      pass('index cache: an entry written by an endpoint is not served by the local backend');
    } else {
      fail(`index cache endpoint entry: ${fromEndpoint.raw}`);
    }
  } catch (e) {
    fail(`index cache tests crashed: ${e.message}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- check.mjs: CLI JSON contract ----------
// UNGATED, and that is the point of the local backend: the CLI can be driven
// against a fixture index on every run, so the output contract is checked in CI
// instead of only when someone remembered to set H1B_API_TEST=1 and was willing
// to spend live rate limit on it. No network, and --cache-dir keeps the repo's
// own cache tree untouched.
if (!existsSync(CHECK_PATH)) {
  fail('check.mjs missing: the plugin ships it');
} else {
  const VALID_TIERS = ['strong', 'moderate', 'staffing-shop', 'weak', 'none', 'unknown'];
  const tmpDir = join(tmpdir(), `h1b-cli-${randomUUID()}`);
  const fixture = join(tmpDir, 'index.ndjson.gz');
  try {
    await writeFixtureIndex(fixture, [
      ...FIXTURE_RECORDS,
      // Filed 66, certified none of them. 3,777 employers in the shipped build
      // are shaped like this, and every one of them reported as tier `none`
      // while the count came from the certified column: "the DOL data shows
      // nothing" about an employer with 66 filings on record.
      { k: '900000005', n: 'Fixture All Denied Inc', fy: 2019, ly: YEAR, filed: 66, cert: 0, pwd: 0, perm: 0, gc: false, sv: false, sh: 0, ns: 0 },
    ]);

    const runCli = (args) => new Promise((resolve) => {
      const env = { ...process.env, H1B_INDEX_PATH: fixture };
      delete env.H1B_API_TOKEN;
      // Outranks the index now, so it has to be cleared for the fixture to be
      // what answers on a machine that has an endpoint configured.
      delete env.H1B_API_BASE;
      execFile(
        process.execPath,
        [CHECK_PATH, ...args, '--cache-dir', join(tmpDir, `cache-${randomUUID()}`)],
        { env, timeout: 30_000 },
        (err, stdout) => resolve({ err, out: String(stdout || '') }),
      );
    });

    // A name that resolves: every documented field, and a source naming the
    // index build rather than a host.
    const found = await runCli(['Fixture Strong Corp', '--json']);
    let parsed = null;
    try { parsed = JSON.parse(found.out); } catch { /* asserted below */ }
    if (parsed && VALID_TIERS.includes(parsed.friendlinessTier)) {
      pass(`check.mjs --json: friendlinessTier "${parsed.friendlinessTier}" is one of the six valid strings`);
    } else {
      fail(`check.mjs --json: friendlinessTier = ${JSON.stringify(parsed && parsed.friendlinessTier)}`);
    }
    if (parsed && typeof parsed.found === 'boolean' && parsed.found === true) {
      pass('check.mjs --json: typeof found === "boolean" (true for a resolved name)');
    } else {
      fail(`check.mjs --json: found = ${JSON.stringify(parsed && parsed.found)}`);
    }
    if (parsed && typeof parsed.source === 'string' && parsed.source.startsWith('local:h1b-index@')) {
      pass(`check.mjs --json: source names the index build (${parsed.source})`);
    } else {
      fail(`check.mjs --json: source = ${JSON.stringify(parsed && parsed.source)}`);
    }
    const shaped = Boolean(parsed) && Boolean(parsed.totals) && Boolean(parsed.redFlags)
      && parsed.employerId === '900000001'
      && parsed.hasSponsorshipHistory === true
      && parsed.totals.n_lca === 5000 && parsed.totals.n_certified === 4800
      && parsed.totals.does_gc === true
      && typeof parsed.fetchedAt === 'string';
    if (shaped) {
      pass('check.mjs --json: the full envelope (totals, redFlags, employerId, fetchedAt) is populated from the index');
    } else {
      fail(`check.mjs --json envelope: ${found.out.slice(0, 240)}`);
    }

    // The tier comes off what was filed, and the certified count rides along
    // for the report to print. An employer that filed 66 times and had none of
    // them certified is not an employer the data shows nothing about, which is
    // exactly what `none` says and what this used to report.
    const denied = await runCli(['Fixture All Denied Inc', '--json']);
    let deniedParsed = null;
    try { deniedParsed = JSON.parse(denied.out); } catch { /* asserted below */ }
    const deniedOk = Boolean(deniedParsed)
      && deniedParsed.totals.n_lca === 66
      && deniedParsed.totals.n_certified === 0
      && deniedParsed.hasSponsorshipHistory === true
      && deniedParsed.friendlinessTier === 'moderate';
    if (deniedOk) {
      pass('check.mjs --json: an all-denied filer reports its filings (tier "moderate", n_lca 66, n_certified 0), not "none"');
    } else {
      fail(`check.mjs --json all-denied: ${denied.out.slice(0, 240)}`);
    }

    // A name that does not resolve: still the full envelope, still exit 0, and
    // `unknown` rather than `none`, which mean different things.
    const missing = await runCli(['__definitely_not_a_real_employer_xyz__', '--json']);
    let missParsed = null;
    try { missParsed = JSON.parse(missing.out); } catch { /* asserted below */ }
    const missShaped = Boolean(missParsed)
      && missParsed.found === false
      && missParsed.friendlinessTier === 'unknown'
      && missParsed.employerId === null
      && Boolean(missParsed.totals) && Boolean(missParsed.redFlags)
      && missParsed.error === undefined;
    if (missShaped && !missing.err) {
      pass('check.mjs --json: an unresolved name is a clean "unknown" envelope, exit 0');
    } else {
      fail(`check.mjs --json unresolved: err=${missing.err && missing.err.message} out=${missing.out.slice(0, 200)}`);
    }

    // Summary form: one line, tier prefix first.
    const summary = await runCli(['Fixture Staffing LLC', '--summary']);
    const firstLine = summary.out.split(/\r?\n/).map(l => l.trim()).find(l => l.length > 0) || '';
    if (/^staffing-shop: /.test(firstLine) && summary.out.trim().split('\n').length === 1) {
      pass(`check.mjs summary: one line, tier prefix first ("${firstLine.slice(0, 60)}")`);
    } else {
      fail(`check.mjs summary: ${JSON.stringify(firstLine)}`);
    }

    // No name at all is a usage error, and must not be read as a lookup.
    await new Promise((resolve) => {
      execFile(process.execPath, [CHECK_PATH], { env: { ...process.env, H1B_INDEX_PATH: fixture }, timeout: 20_000 }, (err, _stdout, stderr) => {
        const code = (err && typeof err.code === 'number') ? err.code : 0;
        if (code === 2 && /Usage: node plugins\/h1b-sponsor\/check\.mjs/.test(String(stderr || ''))) {
          pass('check.mjs: no company name exits 2 with usage on stderr');
        } else {
          fail(`check.mjs no args: exit ${code}, stderr=${String(stderr || '').slice(0, 120)}`);
        }
        resolve();
      });
    });
  } catch (e) {
    fail(`CLI contract tests crashed: ${e.message}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- install-h1b-index.mjs: download, verify, install ----------
// Offline: installIndex takes an injectable fetch with fetchWithTimeout's
// shape, so every branch is testable without reaching GitHub. The one that
// matters most is the mismatch: a download that does not hash to the published
// digest must leave nothing behind, because whatever is on disk is what every
// later lookup will believe.
//
// The release publishes index-latest.json, a pointer naming the quarter's file
// and its sha256, plus that file. Both are read from a permanent `index-latest`
// tag rather than GitHub's /releases/latest/download/ path, which resolves to
// the newest release of any kind and would break every client the day the data
// repo cuts a code release. Both facts are asserted below, because they are a
// contract with a repo this suite cannot see.
if (!existsSync(INSTALL_PATH)) {
  fail('install-h1b-index.mjs missing: the plugin ships it');
} else {
  if (run(NODE, ['--check', INSTALL_PATH]) !== null) pass('install-h1b-index.mjs parses (node --check)');
  else fail('install-h1b-index.mjs failed node --check');

  await new Promise((resolve) => {
    execFile(process.execPath, [INSTALL_PATH, '--nonsense'], { timeout: 20_000 }, (err, _stdout, stderr) => {
      const code = (err && typeof err.code === 'number') ? err.code : 0;
      if (code === 2 && /install-h1b-index\.mjs/.test(String(stderr || ''))) {
        pass('install-h1b-index.mjs (unknown flag): exit 2 with usage on stderr');
      } else {
        fail(`install-h1b-index.mjs unknown flag: exit ${code}, stderr=${String(stderr || '').slice(0, 120)}`);
      }
      resolve();
    });
  });

  const tmpDir = join(tmpdir(), `h1b-install-${randomUUID()}`);
  try {
    await mkdir(tmpDir, { recursive: true });
    const { installIndex } = await import(pathToFileURL(INSTALL_PATH).href);
    const idx = await import(pathToFileURL(INDEX_PATH).href);

    // The bytes a release would publish: a real gzipped index, and its digest.
    const payload = gzipSync(Buffer.from(FIXTURE_RECORDS.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8'));
    const trueDigest = createHash('sha256').update(payload).digest('hex');
    const ASSET_NAME = 'index-2026Q2.ndjson.gz';
    const POINTER_URL = 'https://github.com/msampath/h1b-sponsor-data/releases/download/index-latest/index-latest.json';

    let calls = 0;
    const urls = [];
    // `pointer` is served verbatim so a non-JSON body is expressible; pass an
    // object to publish a well-formed one.
    const fakeRelease = (pointer) => async (url, _opts, consume) => {
      calls++;
      urls.push(String(url));
      if (String(url).endsWith('.json')) {
        const text = typeof pointer === 'string' ? pointer : JSON.stringify(pointer);
        return consume({ status: 200, headers: { get: () => null }, text: async () => text });
      }
      let sent = false;
      return consume({
        status: 200,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: payload })),
            cancel: async () => {},
            releaseLock: () => {},
          }),
        },
      });
    };
    const goodPointer = (over = {}) => ({
      version: '2026Q2',
      built_at: '2026-07-01T00:00:00Z',
      employers: 335626,
      bytes: payload.length,
      sha256: trueDigest,
      filename: ASSET_NAME,
      ...over,
    });

    // Mismatch: a digest that does not describe the bytes.
    const badTarget = join(tmpDir, 'bad', 'index.ndjson.gz');
    const bad = await installIndex({ fetchImpl: fakeRelease(goodPointer({ sha256: 'f'.repeat(64) })), targetPath: badTarget });
    const leftovers = (await readdir(join(tmpDir, 'bad')).catch(() => [])).filter(f => f.endsWith('.tmp'));
    if (!bad.ok && /checksum mismatch/.test(bad.message) && !existsSync(badTarget) && leftovers.length === 0) {
      pass('installIndex: a checksum mismatch installs nothing and leaves no partial file behind');
    } else {
      fail(`installIndex mismatch: ${JSON.stringify(bad)} target=${existsSync(badTarget)} leftovers=${JSON.stringify(leftovers)}`);
    }

    // Everything the pointer can be wrong about is refused before a byte of the
    // index is downloaded: it names the file to fetch and carries the only
    // digest standing between a substituted download and a lookup that trusts
    // it, so neither field may be taken on faith.
    const pointerCases = [
      { label: 'a pointer that is not JSON', pointer: 'not json at all', expect: /not JSON/ },
      { label: 'a pointer with no sha256', pointer: goodPointer({ sha256: undefined }), expect: /sha256/ },
      { label: 'a pointer whose sha256 is not a digest', pointer: goodPointer({ sha256: 'not-a-digest' }), expect: /sha256/ },
      { label: 'a pointer with no filename', pointer: goodPointer({ filename: undefined }), expect: /unusable index filename/ },
      { label: 'a pointer whose filename walks out of the release', pointer: goodPointer({ filename: '../../../etc/passwd' }), expect: /unusable index filename/ },
    ];
    for (const c of pointerCases) {
      const target = join(tmpDir, `reject-${randomUUID()}`, 'index.ndjson.gz');
      const before = calls;
      const got = await installIndex({ fetchImpl: fakeRelease(c.pointer), targetPath: target });
      // Exactly one request: the pointer read, and nothing after it.
      if (!got.ok && c.expect.test(got.message) && !existsSync(target) && calls - before === 1) {
        pass(`installIndex: ${c.label} is refused before the index is downloaded`);
      } else {
        fail(`installIndex ${c.label}: ${JSON.stringify(got)} requests=${calls - before}`);
      }
    }

    // Happy path: verified bytes land at the target with a sidecar, and the
    // result is readable by the backend that will use it.
    const goodTarget = join(tmpDir, 'good', 'index.ndjson.gz');
    urls.length = 0;
    const good = await installIndex({ fetchImpl: fakeRelease(goodPointer()), targetPath: goodTarget });
    if (good.ok && good.digest === trueDigest && good.bytes === payload.length && existsSync(goodTarget)) {
      pass('installIndex: a verified download is installed and reports its digest and size');
    } else {
      fail(`installIndex happy path: ${JSON.stringify(good)}`);
    }
    // The two URLs are the contract with the data repo: a fixed `index-latest`
    // tag, the pointer by its documented name, then the file the pointer names.
    // /releases/latest/download/ must never appear; it resolves to the newest
    // release of any kind, so a code release in that repo would redirect every
    // client here at something that is not an index.
    const assetUrlUsed = `https://github.com/msampath/h1b-sponsor-data/releases/download/index-latest/${ASSET_NAME}`;
    if (urls.length === 2 && urls[0] === POINTER_URL && urls[1] === assetUrlUsed) {
      pass('installIndex: reads the pointer at the fixed index-latest tag, then the file it names');
    } else {
      fail(`installIndex urls: ${JSON.stringify(urls)}`);
    }
    let meta = null;
    try { meta = JSON.parse(await readFile(idx.metaPath(goodTarget), 'utf8')); } catch { /* asserted below */ }
    if (meta && meta.sha256 === trueDigest && meta.bytes === payload.length && typeof meta.installedAt === 'string') {
      pass('installIndex: the sidecar records the verified digest, size and install time');
    } else {
      fail(`installIndex sidecar: ${JSON.stringify(meta)}`);
    }
    // The quarter, kept so the installed build can be named later without
    // asking GitHub again.
    if (meta && meta.version === '2026Q2' && meta.filename === ASSET_NAME && good.version === '2026Q2') {
      pass('installIndex: the sidecar records which quarter is installed');
    } else {
      fail(`installIndex version: sidecar=${JSON.stringify(meta && meta.version)} result=${JSON.stringify(good.version)}`);
    }
    const resolved = await idx.resolveEmployer('Fixture Strong Corp', { indexPath: goodTarget });
    if (resolved && resolved.id === '900000001') {
      pass('installIndex: the installed file is a working index');
    } else {
      fail(`installIndex readback: ${JSON.stringify(resolved)}`);
    }
    if (await idx.indexSource(goodTarget) === `local:h1b-index@sha256-${trueDigest.slice(0, 12)}`) {
      pass('installIndex: the sidecar digest is what stamps cached answers');
    } else {
      fail(`installIndex source stamp: ${await idx.indexSource(goodTarget)}`);
    }

    // An installed index is not replaced by accident: a re-run without --force
    // stops before it reaches the network at all.
    const before = calls;
    const again = await installIndex({ fetchImpl: fakeRelease(goodPointer()), targetPath: goodTarget });
    if (!again.ok && again.exitCode === 0 && /--force/.test(again.message) && calls === before) {
      pass('installIndex: an existing index is kept, and no request is made, without --force');
    } else {
      fail(`installIndex no-force: ${JSON.stringify(again)} calls=${calls - before}`);
    }

    // A tmp-file write failure (disk full, an unwritable target) must come
    // back as the envelope, not escape as an uncaughtException off the write
    // stream; the crash path also skipped the cleanup that removes the
    // partial .tmp file. The trigger is platform-specific, an invalid
    // filename character on Windows and an unwritable directory elsewhere;
    // both surface as the same 'error' event a mid-write ENOSPC raises.
    if (process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() === 0) {
      warn('installIndex write-failure test skipped (root ignores directory modes)');
    } else {
      const deniedDir = join(tmpDir, 'unwritable');
      await mkdir(deniedDir, { recursive: true });
      let deniedTarget;
      if (process.platform === 'win32') {
        deniedTarget = join(deniedDir, 'index?.ndjson.gz');
      } else {
        await chmod(deniedDir, 0o555);
        deniedTarget = join(deniedDir, 'index.ndjson.gz');
      }
      const denied = await installIndex({ fetchImpl: fakeRelease(goodPointer()), targetPath: deniedTarget });
      const deniedLeftovers = (await readdir(deniedDir).catch(() => [])).filter(f => f.endsWith('.tmp'));
      if (!denied.ok && denied.exitCode === 1 && /could not install the index/.test(denied.message) && deniedLeftovers.length === 0) {
        pass('installIndex: a tmp-file write failure returns the envelope and leaves no partial file');
      } else {
        fail(`installIndex write failure: ${JSON.stringify(denied)} leftovers=${JSON.stringify(deniedLeftovers)}`);
      }
      if (process.platform !== 'win32') await chmod(deniedDir, 0o755).catch(() => {});
    }
  } catch (e) {
    fail(`install-h1b-index tests crashed: ${e.message}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- Live-API integration (guarded) ----------
if (process.env.H1B_API_TEST !== '1') {
  warn('live-api tests skipped (set H1B_API_TEST=1 to enable)');
} else if (!existsSync(API_PATH) || !existsSync(TIER_PATH)) {
  fail('lib/api.mjs or lib/tier.mjs missing: the plugin ships them');
} else {
  try {
    const api = await import(pathToFileURL(API_PATH).href);
    const { classifyTier } = await import(pathToFileURL(TIER_PATH).href);
    const opts = { timeoutMs: 15_000, token: process.env.H1B_API_TOKEN };

    const resolved = await api.resolveEmployer('Microsoft', opts);
    if (resolved && resolved.id) pass(`resolveEmployer("Microsoft") → id=${resolved.id}`);
    else { fail(`resolveEmployer("Microsoft") returned ${JSON.stringify(resolved)}`); }

    if (resolved && resolved.id) {
      const profile = await api.getEmployerProfile(resolved.id, opts);
      if (profile && (Number(profile.n_lca) > 0 || Number(profile.n_pwd) > 0 || Number(profile.n_perm) > 0)) {
        pass(`getEmployerProfile(${resolved.id}) returned a profile with filing volume`);
      } else {
        fail(`getEmployerProfile(${resolved.id}) = ${JSON.stringify(profile).slice(0, 200)}`);
      }

      const tier = classifyTier(profile);
      if (tier === 'strong' || tier === 'moderate') {
        pass(`classifyTier(Microsoft profile) === "${tier}"`);
      } else {
        fail(`classifyTier(Microsoft profile) === "${tier}" (expected strong|moderate)`);
      }
    }
  } catch (e) {
    fail(`live-api tests crashed: ${e.message}`);
  }
}

// ---------- token.mjs: key-request CLI ----------
// The argument-handling checks are offline: token.mjs validates argv before it
// opens a socket, so a bad-usage spawn never reaches the network. Only the
// mint itself is gated, behind its OWN env var rather than H1B_API_TEST,
// reading the API is cheap and repeatable, minting is neither.
if (!existsSync(TOKEN_PATH)) {
  fail('token.mjs missing: the plugin ships it');
} else {
  if (run(NODE, ['--check', TOKEN_PATH]) !== null) pass('token.mjs parses (node --check)');
  else fail('token.mjs failed node --check');

  const usageCases = [
    { label: 'no args', argv: [TOKEN_PATH] },
    { label: 'unknown subcommand', argv: [TOKEN_PATH, 'mint'] },
  ];
  for (const c of usageCases) {
    await new Promise((resolve) => {
      execFile(process.execPath, c.argv, { timeout: 20_000 }, (err, _stdout, stderr) => {
        const code = (err && typeof err.code === 'number') ? err.code : 0;
        const printedUsage = /token\.mjs request/.test(String(stderr || ''));
        if (code === 2 && printedUsage) {
          pass(`token.mjs (${c.label}): exit 2 with usage on stderr`);
        } else {
          fail(`token.mjs (${c.label}): exit ${code}, usage-on-stderr=${printedUsage}`);
        }
        resolve();
      });
    });
  }

  // Offline response-handling: mintToken takes an injectable fetch that
  // resolves to the plain envelope guardedMintFetch produces after reading the
  // body inside the abort-timer window: { status, retryAfterSeconds,
  // body | bodyError }. Every branch is testable without a live mint.
  const tokenMod = await import(pathToFileURL(TOKEN_PATH).href);
  const fakeEnvelope = (status, { body, bodyError, retryAfterSeconds = null } = {}) => ({
    status,
    retryAfterSeconds,
    ...(body !== undefined ? { body } : {}),
    ...(bodyError !== undefined ? { bodyError } : {}),
  });

  const GOOD = 'h1b_' + 'ab'.repeat(24);
  const r201 = await tokenMod.mintToken({ fetchImpl: async () => fakeEnvelope(201, { body: { token: GOOD, tier: 'keyed', limit: 200, note: 'line one\n\nline two' } }) });
  if (r201.ok && r201.token === GOOD && r201.note === 'line one line two') {
    pass('mintToken: 201 returns the token and a whitespace-collapsed note');
  } else {
    fail(`mintToken 201: ${JSON.stringify(r201)}`);
  }

  const rMalformed = await tokenMod.mintToken({ fetchImpl: async () => fakeEnvelope(201, { body: { token: 'h1b_abc\nEVIL=$(rm -rf ~)' } }) });
  if (!rMalformed.ok && /malformed/.test(rMalformed.message)) {
    pass('mintToken: a token with shell metacharacters is rejected, never printed');
  } else {
    fail(`mintToken malformed-token: ${JSON.stringify(rMalformed)}`);
  }

  const r429 = await tokenMod.mintToken({ fetchImpl: async () => fakeEnvelope(429, { retryAfterSeconds: 43200 }) });
  if (!r429.ok && r429.exitCode === 1 && /12 hours/.test(r429.message) && !/h1b_/.test(r429.message)) {
    pass('mintToken: 429 reports the wait, no token');
  } else {
    fail(`mintToken 429: ${JSON.stringify(r429)}`);
  }

  const r500 = await tokenMod.mintToken({ fetchImpl: async () => fakeEnvelope(500) });
  if (!r500.ok && /HTTP 500/.test(r500.message)) pass('mintToken: 500 is a clean one-line failure');
  else fail(`mintToken 500: ${JSON.stringify(r500)}`);

  const rBadJson = await tokenMod.mintToken({ fetchImpl: async () => fakeEnvelope(201, { bodyError: 'notjson' }) });
  if (!rBadJson.ok && /budget spent/.test(rBadJson.message)) {
    pass('mintToken: a 201 with an unreadable body warns the budget may be spent');
  } else {
    fail(`mintToken bad-json: ${JSON.stringify(rBadJson)}`);
  }

  const rOversized = await tokenMod.mintToken({ fetchImpl: async () => fakeEnvelope(201, { bodyError: 'oversized' }) });
  if (!rOversized.ok && /budget spent/.test(rOversized.message) && !/h1b_/.test(rOversized.message)) {
    pass('mintToken: a 201 with an oversized body fails closed with the budget warning');
  } else {
    fail(`mintToken oversized: ${JSON.stringify(rOversized)}`);
  }

  const rNoToken = await tokenMod.mintToken({ fetchImpl: async () => fakeEnvelope(201, { body: { tier: 'keyed' } }) });
  if (!rNoToken.ok && /no token/.test(rNoToken.message)) pass('mintToken: a 201 without a token field fails closed');
  else fail(`mintToken no-token: ${JSON.stringify(rNoToken)}`);

  // Guard wiring: the DEFAULT fetch path must reject an off-host redirect, so a
  // hijacked mint cannot hand back an attacker-issued token. Stub the global
  // fetch the guarded path calls, not fetchImpl.
  {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      status: 302,
      headers: { get: (h) => (h.toLowerCase() === 'location' ? 'https://evil.example/x' : null) },
      json: async () => ({ token: 'h1b_attackerminted' }),
    });
    try {
      const rRedirect = await tokenMod.mintToken();
      if (!rRedirect.ok && !/h1b_/.test(rRedirect.message)) {
        pass('mintToken: an off-host redirect on the mint is refused, no attacker token surfaced');
      } else {
        fail(`mintToken off-host redirect: ${JSON.stringify(rRedirect)}`);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // Same-host redirect on the mint: guardedMintFetch passes maxRedirects 0, so
  // even an on-host 302 is refused after exactly ONE request. Following it
  // would re-issue the POST (the guard re-sends the same method), and a
  // re-POSTed mint could spend the 2-per-address budget more than once.
  {
    const originalFetch = globalThis.fetch;
    let mintCalls = 0;
    globalThis.fetch = async () => {
      mintCalls++;
      return {
        status: 302,
        headers: { get: (h) => (h.toLowerCase() === 'location' ? 'https://api.surakshith.com/immigration/v1/keys/elsewhere' : null) },
        json: async () => ({ token: 'h1b_never_surfaced' }),
      };
    };
    try {
      const rSameHost = await tokenMod.mintToken();
      if (!rSameHost.ok && mintCalls === 1 && !/h1b_/.test(rSameHost.message)) {
        pass('mintToken: a same-host redirect is refused after exactly one request (no re-POST)');
      } else {
        fail(`mintToken same-host redirect: calls=${mintCalls}, ${JSON.stringify(rSameHost)}`);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // A 201 whose body then stalls means the server probably issued a key and
  // charged the budget. That has to keep the budget warning: reporting a bare
  // timeout would read as "nothing happened" and invite a retry that spends
  // another of the day's two mints. A non-201 abort has no budget cost, so it
  // stays a timeout.
  {
    const originalFetch = globalThis.fetch;
    const abortingBody = (status, headers = {}) => ({
      status,
      headers: { get: (h) => headers[String(h).toLowerCase()] ?? null },
      body: {
        getReader: () => ({
          read: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; },
          cancel: async () => {},
          releaseLock: () => {},
        }),
      },
    });
    try {
      globalThis.fetch = async () => abortingBody(201);
      const stalled201 = await tokenMod.mintToken();
      if (!stalled201.ok && /budget spent/.test(stalled201.message) && !/h1b_/.test(stalled201.message)) {
        pass('mintToken: a 201 with a stalled body keeps the budget warning');
      } else {
        fail(`mintToken stalled 201: ${JSON.stringify(stalled201)}`);
      }

      // A stalled body never throws away a status that already arrived. The
      // wait on a 429 comes from the headers, so it survives the stall.
      globalThis.fetch = async () => abortingBody(429, { 'retry-after': '43200' });
      const stalled429 = await tokenMod.mintToken();
      if (!stalled429.ok && /rate limited/.test(stalled429.message) && /12 hours/.test(stalled429.message)) {
        pass('mintToken: a stalled body on a 429 still reports the rate-limit wait');
      } else {
        fail(`mintToken stalled 429: ${JSON.stringify(stalled429)}`);
      }

      globalThis.fetch = async () => abortingBody(500);
      const stalled500 = await tokenMod.mintToken();
      if (!stalled500.ok && /HTTP 500/.test(stalled500.message)) {
        pass('mintToken: a stalled body on a 500 still reports the status');
      } else {
        fail(`mintToken stalled 500: ${JSON.stringify(stalled500)}`);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // GATED, and deliberately not H1B_API_TEST: every run of this block consumes
  // one of the 2 keys per address per day, and a burned budget locks out the
  // real user for ~12h. Opt in only when the mint path itself is what changed.
  if (process.env.H1B_MINT_TEST !== '1') {
    warn('token.mjs mint test skipped (set H1B_MINT_TEST=1 to enable; each run burns one of the 2 keys per address per day)');
  } else {
    await new Promise((resolve) => {
      execFile(process.execPath, [TOKEN_PATH, 'request'], { timeout: 30_000 }, (err, stdout, stderr) => {
        const code = (err && typeof err.code === 'number') ? err.code : 0;
        const firstLine = String(stdout || '').split(/\r?\n/)[0] || '';
        // Shape only. The token itself is never echoed into the test log.
        if (code === 0 && /^h1b_[0-9a-f]+$/.test(firstLine)) {
          pass(`token.mjs request: exit 0, printed an h1b_ token (${firstLine.length} chars)`);
        } else {
          fail(`token.mjs request: exit ${code}, first stdout line did not look like an h1b_ token. stderr=${String(stderr || '').slice(0, 200)}`);
        }
        resolve();
      });
    });
  }
}
