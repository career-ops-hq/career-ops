// tests/plugins/h1b-sponsor.test.mjs — contracts for the h1b-sponsor plugin
// (manifest shape, classifyTier branches, cache round-trip/expiry, and the
// check.mjs CLI JSON envelope). BOTH the check.mjs CLI block AND the live-API
// integration are guarded behind H1B_API_TEST=1 — check.mjs is designed to
// hit api.surakshith.com on cache miss, so a plain suite run must never
// invoke it (it would touch the network and pollute the on-disk cache).
//
// The plugin ships all of these files, so a missing one is a real failure, not
// a skip. Only the network-dependent blocks are opt-in (H1B_API_TEST=1).
import { pass, fail, warn, ROOT } from '../helpers.mjs';
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

      if (Array.isArray(manifest.allowedHosts) && manifest.allowedHosts.includes('api.surakshith.com')) {
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
          } else if (typeof parsed.source === 'string' && parsed.source.startsWith('https://api.surakshith.com/immigration/v1/')) {
            pass(`check.mjs --json: source starts with the expected API prefix (${parsed.source})`);
          } else {
            fail(`check.mjs --json: source = ${JSON.stringify(parsed.source)} (expected undefined or https://api.surakshith.com/immigration/v1/…)`);
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
