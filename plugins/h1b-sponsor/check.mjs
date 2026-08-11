#!/usr/bin/env node
// CLI entrypoint for the H-1B sponsor check.
// Usage: node plugins/h1b-sponsor/check.mjs <company-name> [--json|--summary] [--refresh] [--search] [--cache-dir <path>]
//   --search lists every matching employer entity instead of checking one.
// Env: H1B_API_TOKEN (optional; anon requests are throttled 30/hr per IP+ASN).
//
// Output format (JSON):
//   { found, employerId, displayName, hasSponsorshipHistory,
//     totals: { n_lca, n_pwd, n_perm, first_year, last_year, does_gc },
//     redFlags: { staffing_shop: {...} | null },
//     friendlinessTier, source, fetchedAt }

import { resolveEmployer, searchEmployers, getEmployerProfile, BASE } from './lib/api.mjs';
import { readCache, writeCache } from './lib/cache.mjs';
import { classifyTier } from './lib/tier.mjs';

function sourceUrl(employerId) {
  return employerId ? `${BASE}/employers/${encodeURIComponent(employerId)}` : BASE + '/employers';
}

// API-controlled text goes through this before any non-JSON output: collapse
// whitespace so a line stays a line, then strip C0, DEL, and C1 control
// characters so a crafted name cannot smuggle terminal escapes or forged
// rows into the text output. JSON output keeps the raw fields. The collapse
// runs first because newlines and tabs are control chars too, and stripping
// them before the collapse would glue words together instead of separating
// them; what survives the collapse (ESC, BEL, DEL, C1) is not whitespace.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
function displayClean(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(CONTROL_CHARS, '').trim();
}

// The cache is an optimization: a failed write (read-only FS, full disk, a
// --cache-dir typo) must never discard a lookup that already succeeded and
// already spent rate-limit budget.
async function writeCacheSafe(name, data, opts) {
  try {
    await writeCache(name, data, opts);
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

function notFoundResult(name) {
  return {
    found: false,
    employerId: null,
    displayName: name,
    hasSponsorshipHistory: false,
    totals: { n_lca: 0, n_pwd: 0, n_perm: 0, first_year: null, last_year: null, does_gc: false },
    redFlags: { staffing_shop: null },
    friendlinessTier: 'unknown',
    source: sourceUrl(null),
    fetchedAt: new Date().toISOString(),
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

  const token = process.env.H1B_API_TOKEN;
  const apiOpts = token ? { token } : {};
  const cacheOpts = cacheDir ? { cacheDir } : {};

  // --search lists every matching entity and stops; it never resolves to one or
  // touches the cache. Each listed name can then be checked on its own.
  if (search) {
    const { total, results } = await searchEmployers(name, apiOpts);
    emitSearch(format, name, total, results);
    return;
  }

  if (!refresh) {
    const cached = await readCache(name, cacheOpts);
    if (cached) {
      if (cached.negative) {
        const out = notFoundResult(name);
        // Keep source a URL (the documented contract); the stale fetchedAt is
        // what signals this answer came from cache.
        out.fetchedAt = cached.fetchedAt;
        emit(format, out);
        return;
      }
      const { displayName, employerId, profile } = cached.data || {};
      if (displayName && employerId && profile) {
        const out = buildResult(displayName, employerId, profile, sourceUrl(employerId), cached.fetchedAt);
        emit(format, out);
        return;
      }
    }
  }

  const match = await resolveEmployer(name, apiOpts);
  if (!match) {
    await writeCacheSafe(name, { name }, { ...cacheOpts, negative: true });
    const out = notFoundResult(name);
    emit(format, out);
    return;
  }

  const profile = await getEmployerProfile(match.id, apiOpts);
  const now = new Date().toISOString();
  // A null profile is unreadable on the way back out (the cache-hit guard
  // requires a truthy profile), so writing it would only burn a file slot.
  if (profile) {
    await writeCacheSafe(name, {
      displayName: match.displayName,
      employerId: match.id,
      profile,
    }, cacheOpts);
  }
  const out = buildResult(match.displayName, match.id, profile, sourceUrl(match.id), now);
  emit(format, out);
}

main().catch(err => {
  // The message can embed up to 200 chars of API-controlled response body, and
  // the summary contract is one line — collapse all whitespace before printing.
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
    process.exit(1);
  }
  const payload = { ...notFoundResult(name || 'unknown company'), error: message };
  if (format === 'json') {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write(`unknown: ${message}\n`);
  }
  process.exit(1);
});
