// tests/plugins/h1b-sponsor.test.mjs — contracts for the h1b-sponsor plugin
// (manifest shape, classifyTier branches, cache round-trip/expiry, and the
// check.mjs CLI JSON envelope). BOTH the check.mjs CLI block AND the live-API
// integration are guarded behind H1B_API_TEST=1 — check.mjs is designed to
// hit api.surakshith.com on cache miss, so a plain suite run must never
// invoke it (it would touch the network and pollute the on-disk cache).
//
// token.mjs gets a third gate of its own, H1B_MINT_TEST=1: unlike a read, a
// mint spends the 2-keys-per-address-per-day budget, so it must not ride along
// with H1B_API_TEST.
//
// The plugin ships all of these files, so a missing one is a real failure, not
// a skip. Only the network-dependent blocks are opt-in (H1B_API_TEST=1).
import { pass, fail, warn, run, NODE, ROOT } from '../helpers.mjs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';

console.log('\nPlugin — h1b-sponsor');

const PLUGIN_DIR = join(ROOT, 'plugins', 'h1b-sponsor');
const MANIFEST_PATH = join(PLUGIN_DIR, 'manifest.json');
const TIER_PATH = join(PLUGIN_DIR, 'lib', 'tier.mjs');
const CACHE_PATH = join(PLUGIN_DIR, 'lib', 'cache.mjs');
const API_PATH = join(PLUGIN_DIR, 'lib', 'api.mjs');
const CHECK_PATH = join(PLUGIN_DIR, 'check.mjs');
const TOKEN_PATH = join(PLUGIN_DIR, 'token.mjs');
const ENGINE_PATH = join(ROOT, 'plugins', '_engine.mjs');

// ---------- manifest.json ----------
if (!existsSync(MANIFEST_PATH)) {
  fail('manifest.json missing — the plugin ships it');
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

      // Exact element equality (===), not URL-substring matching — phrased with
      // .some() because scanners misread Array.includes('host') as the
      // url.includes('trusted.com') sanitization anti-pattern (CodeQL #103).
      if (Array.isArray(manifest.allowedHosts) && manifest.allowedHosts.some(h => h === 'api.surakshith.com')) {
        pass('manifest.allowedHosts contains "api.surakshith.com"');
      } else {
        fail(`manifest.allowedHosts = ${JSON.stringify(manifest.allowedHosts)}`);
      }

      if (Array.isArray(manifest.optionalEnv) && manifest.optionalEnv.includes('H1B_API_TOKEN')) {
        pass('manifest.optionalEnv contains "H1B_API_TOKEN"');
      } else {
        fail(`manifest.optionalEnv = ${JSON.stringify(manifest.optionalEnv)}`);
      }

      // Engine validateManifest should accept it.
      if (!existsSync(ENGINE_PATH)) {
        warn('plugins/_engine.mjs missing — skipping validateManifest check');
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

// ---------- lib/tier.mjs — classifyTier ----------
if (!existsSync(TIER_PATH)) {
  fail('lib/tier.mjs missing — the plugin ships it');
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
      else fail(`classifyTier: ${c.label} — got "${got}", expected one of ${JSON.stringify(c.accept)}`);
    }
  } catch (e) {
    fail(`classifyTier import crashed: ${e.message}`);
  }
}

// ---------- lib/cache.mjs — cacheKey, readCache, writeCache ----------
if (!existsSync(CACHE_PATH)) {
  fail('lib/cache.mjs missing — the plugin ships it');
} else {
  const tmpCacheDir = join(tmpdir(), `h1b-cache-${randomUUID()}`);
  try {
    const { cacheKey, readCache, writeCache } = await import(pathToFileURL(CACHE_PATH).href);

    // cacheKey — filesystem-safe slug.
    const slug = cacheKey('Microsoft Corp');
    if (typeof slug === 'string' && /^[a-z0-9-]+$/.test(slug)) {
      pass(`cacheKey("Microsoft Corp") is a filesystem-safe slug ("${slug}")`);
    } else {
      fail(`cacheKey("Microsoft Corp") = ${JSON.stringify(slug)}`);
    }

    // cacheKey('') — accept any non-empty safe fallback.
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

    // Entry without a `data` key is malformed — fail closed.
    const noDataFile = join(tmpCacheDir, `${cacheKey('NoDataCo')}.json`);
    await writeFile(
      noDataFile,
      JSON.stringify({ fetchedAt: new Date().toISOString() }, null, 2),
      'utf8',
    );
    const noData = await readCache('NoDataCo', { cacheDir: tmpCacheDir });
    if (noData === null) pass('readCache returns null for an entry with no data key');
    else fail(`readCache on data-less entry = ${JSON.stringify(noData)}`);

    // A future fetchedAt is clock skew or tampering — not usable either way.
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

// ---------- lib/api.mjs — name matching (offline, stubbed fetch) ----------
// plausibleMatch is module-private, so it is exercised through resolveEmployer
// with globalThis.fetch stubbed: the stub returns one candidate and the
// assertion is whether resolveEmployer accepts or rejects it. No network.
if (!existsSync(API_PATH)) {
  fail('lib/api.mjs missing — the plugin ships it');
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
    const stubOneResult = (candidateName) => async () =>
      jsonStream({ results: [{ id: 'stub-1', name: candidateName }] });

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
    ];

    for (const c of matchCases) {
      globalThis.fetch = stubOneResult(c.candidate);
      let got;
      try {
        got = await api.resolveEmployer(c.query, { timeoutMs: 1_000 });
      } catch (e) {
        fail(`resolveEmployer("${c.query}") crashed: ${e.message}`);
        continue;
      }
      const matched = Boolean(got && got.id);
      if (matched === c.expect) {
        pass(`matcher: "${c.query}" vs "${c.candidate}" → ${c.expect ? 'match' : 'no match'}`);
      } else {
        fail(`matcher: "${c.query}" vs "${c.candidate}" → got ${matched ? 'match' : 'no match'}, expected ${c.expect ? 'match' : 'no match'}`);
      }
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

// ---------- lib/api.mjs readBoundedText — streaming byte ceiling ----------
// Ungated and offline. res.text()/res.json() buffer a whole body before any
// size check can run, so the reader streams and cancels mid-body instead. These
// drive the REAL reader (the mintToken envelope tests use a fake envelope and
// never reach it).
if (!existsSync(API_PATH)) {
  fail('lib/api.mjs missing — the plugin ships it');
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
  // cancels the body it is walking away from — returning without cancelling
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
  // text in BYTES. Measuring UTF-16 code units instead — what String.length
  // reports — waves a multibyte body straight past a byte ceiling: these 400
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
  // re-throw it for that reason — the 2xx read and the error-status read that
  // only collects an excerpt — and a catch that swallowed it would report a
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
// Runs UNGATED: the child process stubs globalThis.fetch before importing
// check.mjs, so nothing touches the network or the cache. This pins the
// control-char strip on the text output (a crafted employer name must not
// smuggle terminal escapes or a forged row) and the raw pass-through on JSON.
{
  const tmpDir = join(tmpdir(), `h1b-sanitize-${randomUUID()}`);
  try {
    await mkdir(tmpDir, { recursive: true });
    const evilName = 'Evil\\u001b[31mRED\\u001b[0m\\u0007Co\\r\\nFORGED  ROW';
    const wrapper = (jsonFlag) => [
      `globalThis.fetch = async () => new Response(JSON.stringify({`,
      `  total: 5,`,
      `  results: [{ id: '12\\u001b[7m34', name: '${evilName}' }],`,
      `}), { status: 200 });`,
      `process.argv = [process.argv[0], ${JSON.stringify(CHECK_PATH)}, 'EvilCo', '--search'${jsonFlag ? ", '--json'" : ''}];`,
      `await import(${JSON.stringify(pathToFileURL(CHECK_PATH).href)});`,
    ].join('\n');

    const runWrapper = (file) => new Promise((resolve) => {
      execFile(process.execPath, [file], { timeout: 20_000 }, (err, stdout) => resolve(String(stdout || '')));
    });

    const textWrapper = join(tmpDir, 'text.mjs');
    await writeFile(textWrapper, wrapper(false), 'utf8');
    const textOut = await runWrapper(textWrapper);
    const hasControl = [...textOut].some(ch => { const c = ch.charCodeAt(0); return (c < 32 && c !== 10 && c !== 13) || c === 127 || (c >= 128 && c <= 159); });
    const oneRow = textOut.trim().split('\n').length === 2; // header + single row
    if (!hasControl && oneRow && /FORGED ROW/.test(textOut)) {
      pass('search text output strips control chars and keeps the forged row on one line');
    } else {
      fail(`search text sanitizer: control=${hasControl} rows=${textOut.trim().split('\n').length}`);
    }

    const jsonWrapper = join(tmpDir, 'json.mjs');
    await writeFile(jsonWrapper, wrapper(true), 'utf8');
    const jsonOut = await runWrapper(jsonWrapper);
    let rawKept = false;
    try {
      const parsed = JSON.parse(jsonOut);
      const ESC = String.fromCharCode(27);
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

// ---------- check.mjs — a broken base still emits the documented envelope ----------
// The base resolves lazily and is reported back through `source`, so the error
// handler that exists to report a bad value calls apiBase() itself. Letting
// that throw replaces the documented JSON envelope with a raw stack trace on
// stderr. Ungated and offline: apiBase() throws before any URL is built, so
// nothing reaches the network, and --cache-dir keeps the repo cache untouched.
{
  const tmpDir = join(tmpdir(), `h1b-badbase-${randomUUID()}`);
  await new Promise((resolve) => {
    execFile(
      process.execPath,
      [CHECK_PATH, 'Acme', '--json', '--cache-dir', tmpDir],
      { env: { ...process.env, H1B_API_BASE: 'not a url' }, timeout: 20_000 },
      (err, stdout, stderr) => {
        const code = (err && typeof err.code === 'number') ? err.code : 0;
        let parsed = null;
        try { parsed = JSON.parse(String(stdout || '')); } catch { /* not JSON — asserted below */ }
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

// ---------- check.mjs — the cache is endpoint-aware ----------
// A cached answer belongs to the instance that produced it, and `source` is
// rebuilt from the CURRENT base, so serving an entry another endpoint wrote
// would label one instance's data as the other's. Entries written before the
// endpoint was configurable carry no `base` at all, so the first run after an
// upgrade has to re-fetch rather than serve them blind — for negative entries
// too, where a stale "unknown" is the answer that quietly ends a search.
//
// Ungated and offline: the child stubs globalThis.fetch (and counts calls)
// before importing check.mjs, and every run uses a scratch cache dir. The base
// values are fictional so the assertion never depends on which endpoint the
// machine running the suite is configured for.
if (!existsSync(CHECK_PATH) || !existsSync(CACHE_PATH)) {
  fail('check.mjs or lib/cache.mjs missing — the plugin ships them');
} else {
  const { cacheKey } = await import(pathToFileURL(CACHE_PATH).href);
  const tmpDir = join(tmpdir(), `h1b-endpoint-cache-${randomUUID()}`);
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
        { env: { ...process.env, H1B_API_BASE: CURRENT }, timeout: 30_000 },
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
      entry: { data: { displayName: 'Cached Same', employerId: 'same-1', profile: PROFILE, base: CURRENT } },
      ok: (r) => r.calls === 0 && r.result && r.result.employerId === 'same-1',
    },
    {
      label: 'an entry from ANOTHER endpoint is a miss, not another instance’s answer',
      entry: { data: { displayName: 'Cached Other', employerId: 'other-1', profile: PROFILE, base: OTHER } },
      ok: (r) => r.calls === 2 && r.result && r.result.employerId === 'refetched',
    },
    {
      label: 'a pre-upgrade entry with no base re-fetches instead of serving blind',
      entry: { data: { displayName: 'Cached Legacy', employerId: 'legacy-1', profile: PROFILE } },
      ok: (r) => r.calls === 2 && r.result && r.result.employerId === 'refetched',
    },
    {
      label: 'a NEGATIVE entry from the current endpoint still short-circuits',
      entry: { negative: true, data: { name: NAME, base: CURRENT } },
      ok: (r) => r.calls === 0 && r.result && r.result.found === false,
    },
    {
      label: 'a pre-upgrade NEGATIVE entry re-fetches rather than repeating a stale unknown',
      entry: { negative: true, data: { name: NAME } },
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
    else fail(`endpoint cache: ${c.label} — calls=${got.calls} result=${JSON.stringify(got.result)} raw=${got.raw}`);
  }
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
}

// ---------- check.mjs — CLI JSON contract ----------
// GATED: check.mjs is designed to hit api.surakshith.com on cache miss, so it
// cannot run in a unit context without either network mocking (out of scope
// for this file) or an explicit opt-in. Same env gate as the live-API block
// below — a plain suite run must never touch the network or write to the
// on-disk cache under data/cache/h1b/.
if (process.env.H1B_API_TEST !== '1') {
  warn('CLI test skipped (set H1B_API_TEST=1 to enable; the CLI hits the live API on cache miss)');
} else if (!existsSync(CHECK_PATH)) {
  fail('check.mjs missing — the plugin ships it');
} else {
  // The endpoint is configurable, so the expected source prefix comes from the
  // client rather than a literal host.
  const { apiBase: liveBase } = await import(pathToFileURL(API_PATH).href);
  const expectedBase = liveBase();
  // --cache-dir keeps the run's 30-day negative entry out of the repo's real
  // cache tree; the tmp dir is removed once the callback has resolved.
  const cliCacheDir = join(tmpdir(), `h1b-cli-cache-${randomUUID()}`);
  await new Promise((resolve) => {
    const env = { ...process.env };
    delete env.H1B_API_TOKEN;
    const VALID_TIERS = ['strong', 'moderate', 'staffing-shop', 'weak', 'none', 'unknown'];
    execFile(
      process.execPath,
      [CHECK_PATH, '--json', '--cache-dir', cliCacheDir, '__definitely_not_a_real_employer_xyz__'],
      { env, timeout: 20_000 },
      (err, stdout, _stderr) => {
        const out = String(stdout || '');
        let parsed = null;
        try {
          const jsonStart = out.indexOf('{');
          if (jsonStart >= 0) parsed = JSON.parse(out.slice(jsonStart));
        } catch { /* not JSON — fall through to summary-form assertions */ }

        if (parsed) {
          // JSON path — strict.
          if (VALID_TIERS.includes(parsed.friendlinessTier)) {
            pass(`check.mjs --json: friendlinessTier "${parsed.friendlinessTier}" is one of the six valid strings`);
          } else {
            fail(`check.mjs --json: friendlinessTier = ${JSON.stringify(parsed.friendlinessTier)} (expected one of ${VALID_TIERS.join('|')})`);
          }
          if (typeof parsed.found === 'boolean') {
            pass(`check.mjs --json: typeof found === "boolean" (${parsed.found})`);
          } else {
            fail(`check.mjs --json: typeof found = ${typeof parsed.found} (${JSON.stringify(parsed.found)})`);
          }
          if (parsed.source === undefined || parsed.source === null) {
            pass('check.mjs --json: source absent (acceptable when found === false)');
          } else if (typeof parsed.source === 'string' && parsed.source.startsWith(`${expectedBase}/`)) {
            // Compared against the CONFIGURED endpoint, not a literal host: a
            // self-hoster running this gated block would otherwise fail on a
            // correct result.
            pass(`check.mjs --json: source starts with the configured API base (${parsed.source})`);
          } else {
            fail(`check.mjs --json: source = ${JSON.stringify(parsed.source)} (expected undefined or ${expectedBase}/…)`);
          }
        } else {
          // Summary path — strict regex: `<tier>:` prefix on the first non-blank line.
          const firstLine = out.split(/\r?\n/).map(l => l.trim()).find(l => l.length > 0) || '';
          if (/^(strong|moderate|staffing-shop|weak|none|unknown):/.test(firstLine)) {
            pass(`check.mjs summary: first line begins with a valid tier prefix ("${firstLine.slice(0, 60)}")`);
          } else {
            fail(`check.mjs: neither JSON envelope nor tier-prefixed summary. First line = ${JSON.stringify(firstLine)}, err=${err && err.message}`);
          }
        }
        resolve();
      },
    );
  });
  await rm(cliCacheDir, { recursive: true, force: true }).catch(() => {});
}

// ---------- Live-API integration (guarded) ----------
if (process.env.H1B_API_TEST !== '1') {
  warn('live-api tests skipped (set H1B_API_TEST=1 to enable)');
} else if (!existsSync(API_PATH) || !existsSync(TIER_PATH)) {
  fail('lib/api.mjs or lib/tier.mjs missing — the plugin ships them');
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

// ---------- token.mjs — key-request CLI ----------
// The argument-handling checks are offline: token.mjs validates argv before it
// opens a socket, so a bad-usage spawn never reaches the network. Only the
// mint itself is gated, behind its OWN env var rather than H1B_API_TEST —
// reading the API is cheap and repeatable, minting is neither.
if (!existsSync(TOKEN_PATH)) {
  fail('token.mjs missing — the plugin ships it');
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
