#!/usr/bin/env node
// CLI entrypoint for the H-1B sponsor check.
// Usage: node plugins/h1b-sponsor/check.mjs <company-name> [--json|--summary] [--refresh] [--search] [--cache-dir <path>]
//   --search lists every matching employer entity instead of checking one.
// Env: H1B_INDEX_PATH (optional; relocates the local index).
//      H1B_API_BASE   (optional; opts into the HTTP backend, see below).
//      H1B_API_TOKEN  (optional; HTTP backend only, raises the rate limit).
//
// Backends, in order:
//   1. An HTTP endpoint, used when H1B_API_BASE names one explicitly.
//   2. The local index (data/h1b/), installed by install-h1b-index.mjs. The
//      default, and the only one where the question never leaves the machine.
// With neither, the CLI reports `unknown` and says how to install the index.
// It does NOT fall back to a default host: which employers someone checks
// discloses that they need a visa and who they are applying to, so that
// destination is a choice the user makes, never one made for them by a missing
// file.
//
// Output format (JSON):
//   { found, employerId, displayName, hasSponsorshipHistory,
//     totals: { n_lca, n_certified, n_pwd, n_perm, first_year, last_year, does_gc },
//     redFlags: { staffing_shop: {...} | null },
//     friendlinessTier, source, fetchedAt }
// n_lca counts what the employer FILED. n_certified is how much of it came
// back certified, reported beside it and never in place of it: a denial is
// USCIS's decision and a withdrawal is usually the candidate taking another
// offer, so neither is evidence the employer will not sponsor. It is null when
// the backend does not report it, which is not the same as 0.

import * as httpBackend from './lib/api.mjs';
import { num } from './lib/api.mjs';
import * as localBackend from './lib/index.mjs';
import { readCache, writeCache } from './lib/cache.mjs';
import { classifyTier } from './lib/tier.mjs';

// Set once main() has chosen a backend. Null while unchosen and after a failed
// choice, which is what lets the error handler report a source of null instead
// of naming an endpoint the user never selected.
let backend = null;

/**
 * Pick where this lookup is answered from.
 *
 * Explicit choice first, then the local default, then an error. H1B_API_BASE is
 * something a user only ever sets on purpose, and an installed index used to
 * win over it unconditionally, so that choice was read and then ignored without
 * a word. Silently disregarding what someone configured is the same surprise as
 * silently picking a host for them, which is what the rest of this ordering
 * exists to rule out; both are now impossible.
 *
 * With nothing set, the index answers, so the default path still has no server
 * in it. Selection is deliberately not a fallback chain in the other direction:
 * a missing index does not silently become a request to somebody's server. It
 * becomes an error that says how to install the index.
 */
async function selectBackend() {
  if (process.env.H1B_API_BASE !== undefined) {
    const token = process.env.H1B_API_TOKEN;
    return {
      kind: 'api',
      source: httpBackend.apiBase(),
      opts: token ? { token } : {},
      resolveEmployer: httpBackend.resolveEmployer,
      searchEmployers: httpBackend.searchEmployers,
      getEmployerProfile: httpBackend.getEmployerProfile,
    };
  }
  if (localBackend.hasIndex()) {
    return {
      kind: 'index',
      // The index digest, so a cached answer is tied to the exact data that
      // produced it and a refreshed index invalidates the old numbers.
      source: await localBackend.indexSource(),
      opts: {},
      resolveEmployer: localBackend.resolveEmployer,
      searchEmployers: localBackend.searchEmployers,
      getEmployerProfile: localBackend.getEmployerProfile,
    };
  }
  throw new Error(
    'no local H-1B index and no H1B_API_BASE. Install the index with: node plugins/h1b-sponsor/install-h1b-index.mjs '
    + '(about 8 MiB of public DOL data; lookups then stay on this machine). To use an HTTP endpoint instead, '
    + 'set H1B_API_BASE to one you trust.',
  );
}

// Where the answer came from, reported back to the caller. The HTTP path names
// the employer's own URL so the number can be checked by hand; the local path
// names the index build, which is the equivalent handle for data on disk.
function sourceRef(employerId) {
  if (!backend) return null;
  if (backend.kind === 'index') return backend.source;
  return employerId
    ? `${backend.source}/employers/${encodeURIComponent(employerId)}`
    : `${backend.source}/employers`;
}

// Text from the backend goes through this before any non-JSON output, whether
// it came from an endpoint or off the index: collapse whitespace so a line
// stays a line, then strip C0, DEL, and C1 control characters so a crafted
// name cannot smuggle terminal escapes or forged rows into the text output.
// JSON output keeps the raw fields. The collapse
// runs first because newlines and tabs are control chars too, and stripping
// them before the collapse would glue words together instead of separating
// them; what survives the collapse (ESC, BEL, DEL, C1) is not whitespace.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
function displayClean(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(CONTROL_CHARS, '').trim();
}

// What the numbers in a cache entry MEAN, versioned. An entry written before
// this bump carries a certified count in `n_lca`, because that is what the
// field held then; the tier now reads that field as filings, so serving one
// would answer with a number that means something else, and quietly. Entries
// without the marker are misses (see main()), which costs one re-read.
//
// The local backend self-heals without this: its source stamp is the index
// digest, so a rebuilt index invalidates its own entries. The HTTP path has no
// such handle, since an endpoint's URL does not change when its payload's
// meaning does, and that is the gap the marker closes.
const CACHE_SCHEMA = 2;

// The cache is an optimization: a failed write (read-only FS, full disk, a
// --cache-dir typo) must never discard a lookup that already succeeded and
// already spent rate-limit budget.
async function writeCacheSafe(name, data, opts) {
  try {
    await writeCache(name, { ...data, schema: CACHE_SCHEMA }, opts);
  } catch (err) {
    const msg = displayClean((err && err.message) ? err.message : err);
    process.stderr.write(`h1b-sponsor: cache write failed (${msg}); continuing without cache\n`);
  }
}

function parseArgs(argv) {
  const args = { name: null, format: 'summary', refresh: false, cacheDir: null, search: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.format = 'json';
    else if (a === '--summary') args.format = 'summary';
    else if (a === '--refresh') args.refresh = true;
    else if (a === '--search') args.search = true;
    else if (a === '--cache-dir') {
      // Consumes the following argument so it is never read as the company name.
      const next = argv[i + 1];
      if (typeof next === 'string' && next.trim()) args.cacheDir = next;
      i++;
    } else if (a.startsWith('-')) {
      // unknown flag - ignore silently for forward compatibility
    } else rest.push(a);
  }
  args.name = rest.join(' ').trim();
  return args;
}


function formatSummary(result) {
  const clean = displayClean;
  if (!result.found) return `unknown: ${clean(result.displayName) || 'unknown company'}`;
  const t = result.totals || {};
  const range = (t.first_year && t.last_year)
    ? `${t.first_year}-${t.last_year}`
    : (t.last_year || t.first_year || 'n/a');
  return `${result.friendlinessTier}: ${clean(result.displayName)} - ${t.n_lca ?? 0} LCAs, ${t.n_pwd ?? 0} PWDs, ${t.n_perm ?? 0} PERMs, active ${range}`;
}

function buildResult(displayName, employerId, profile, source, fetchedAt) {
  const tier = classifyTier(profile);
  const staffing = (profile && profile.red_flags && profile.red_flags.staffing_shop) || null;
  const nLca = Number(profile?.n_lca ?? 0) || 0;
  const nPwd = Number(profile?.n_pwd ?? 0) || 0;
  const nPerm = Number(profile?.n_perm ?? 0) || 0;
  return {
    found: true,
    employerId,
    displayName,
    hasSponsorshipHistory: (nLca + nPwd + nPerm) > 0,
    totals: {
      n_lca: nLca,
      // Not coerced through `|| 0` like the counts above: 0 certified is a
      // real answer about an employer that filed, and null means the backend
      // did not report the number at all.
      n_certified: num(profile?.n_certified),
      n_pwd: nPwd,
      n_perm: nPerm,
      first_year: profile?.first_year ?? null,
      last_year: profile?.last_year ?? null,
      does_gc: profile?.does_gc === true,
    },
    redFlags: { staffing_shop: staffing },
    friendlinessTier: tier,
    source,
    fetchedAt,
  };
}

function notFoundResult(name, fetchedAt = new Date().toISOString()) {
  return {
    found: false,
    employerId: null,
    displayName: name,
    hasSponsorshipHistory: false,
    totals: { n_lca: 0, n_certified: null, n_pwd: 0, n_perm: 0, first_year: null, last_year: null, does_gc: false },
    redFlags: { staffing_shop: null },
    friendlinessTier: 'unknown',
    source: sourceRef(null),
    fetchedAt,
  };
}

function emit(format, obj) {
  if (format === 'json') {
    process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  } else {
    process.stdout.write(formatSummary(obj) + '\n');
  }
}

// --search lists every matching entity instead of resolving to one, because a
// company files under many distinct FEINs (Amazon has dozens) and the caller
// may need to pick the exact one. Each listed name is checkable on its own: an
// exact name resolves straight to that entity.
function emitSearch(format, query, total, results) {
  const clean = displayClean;
  if (format === 'json') {
    process.stdout.write(JSON.stringify({ query, total, shown: results.length, results }, null, 2) + '\n');
    return;
  }
  if (results.length === 0) {
    process.stdout.write(`no matches for "${clean(query)}"\n`);
    return;
  }
  const header = total > results.length
    ? `${results.length} of ${total} matches for "${clean(query)}" (narrow the query to see the rest):`
    : `${results.length} match${results.length === 1 ? '' : 'es'} for "${clean(query)}":`;
  const rows = results.map(r => `  ${clean(r.id)}  ${clean(r.name)}`);
  process.stdout.write([header, ...rows].join('\n') + '\n');
}

async function main() {
  const { name, format, refresh, cacheDir, search } = parseArgs(process.argv.slice(2));
  if (!name) {
    process.stderr.write('Usage: node plugins/h1b-sponsor/check.mjs <company-name> [--json|--summary] [--refresh] [--search] [--cache-dir <path>]\n');
    process.exit(2);
  }

  // Chosen before anything else runs: with no backend available this throws,
  // and it throws before a single request or read is issued.
  backend = await selectBackend();
  const opts = backend.opts;
  const cacheOpts = cacheDir ? { cacheDir } : {};

  // --search lists every matching entity and stops; it never resolves to one or
  // touches the cache. Each listed name can then be checked on its own.
  if (search) {
    const { total, results } = await backend.searchEmployers(name, opts);
    emitSearch(format, name, total, results);
    return;
  }

  if (!refresh) {
    const cached = await readCache(name, cacheOpts);
    if (cached) {
      // One rule for both kinds of entry. A negative entry carries no counts,
      // so the schema bump is not strictly load-bearing for it; versioning it
      // with the rest is what keeps "is this entry from this code" a single
      // question rather than two that can drift apart.
      const sameSchema = Boolean(cached.data) && cached.data.schema === CACHE_SCHEMA;
      if (sameSchema && cached.negative && cached.data.source === backend.source) {
        const out = notFoundResult(name);
        // Keep source in its documented form; the stale fetchedAt is what
        // signals this answer came from cache.
        out.fetchedAt = cached.fetchedAt;
        emit(format, out);
        return;
      }
      const { displayName, employerId, profile, source } = cached.data || {};
      // An answer from one backend is not an answer from another, and the
      // source field is rebuilt from the CURRENT one, so serving a stale entry
      // across a switch would label one backend's data as the other's. This
      // covers both endpoints (a different H1B_API_BASE) and index builds (a
      // quarterly refresh changes the digest), and it treats entries written
      // before this field existed as misses rather than trusting them blind.
      if (sameSchema && displayName && employerId && profile && source === backend.source) {
        const out = buildResult(displayName, employerId, profile, sourceRef(employerId), cached.fetchedAt);
        emit(format, out);
        return;
      }
    }
  }

  const match = await backend.resolveEmployer(name, opts);
  if (!match) {
    const out = notFoundResult(name);
    await writeCacheSafe(name, { name, source: backend.source }, { ...cacheOpts, negative: true, fetchedAt: out.fetchedAt });
    emit(format, out);
    return;
  }

  const profile = await backend.getEmployerProfile(match.id, opts);
  const now = new Date().toISOString();
  // A null profile is unreadable on the way back out (the cache-hit guard
  // requires a truthy profile), so writing it would only burn a file slot.
  if (profile) {
    await writeCacheSafe(name, {
      displayName: match.displayName,
      employerId: match.id,
      profile,
      source: backend.source,
    }, { ...cacheOpts, fetchedAt: now });
  }
  const out = buildResult(match.displayName, match.id, profile, sourceRef(match.id), now);
  emit(format, out);
}

main().catch(err => {
  // The message can embed up to 200 chars of API-controlled response body, and
  // the summary contract is one line: collapse all whitespace before printing.
  const message = displayClean((err && err.message) ? err.message : err);
  const argv = process.argv.slice(2);
  const format = argv.includes('--json') ? 'json' : 'summary';
  // Emit the full documented envelope even on error so consumers reading
  // totals/redFlags without checking `error` first don't crash.
  const { name, search } = parseArgs(argv);
  // A --search run has its own output shape; keep it on error for the same
  // reason, so a consumer reading results/shown does not get the check envelope.
  if (search) {
    if (format === 'json') {
      process.stdout.write(JSON.stringify({ query: name || '', total: 0, shown: 0, results: [], error: message }, null, 2) + '\n');
    } else {
      process.stdout.write(`search failed: ${message}\n`);
    }
    // process.exit() does not wait for a pending stdout write to flush, so on
    // a piped stdout (the --json consumer case) it can truncate the envelope
    // right when a caller most needs it. Setting exitCode and returning lets
    // the process exit once the event loop drains, after the write completes.
    process.exitCode = 1;
    return;
  }
  const payload = { ...notFoundResult(name || 'unknown company'), error: message };
  if (format === 'json') {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write(`unknown: ${message}\n`);
  }
  process.exitCode = 1;
  return;
});
