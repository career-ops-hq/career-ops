#!/usr/bin/env node
/** Local report-backed public facts cache (#1025); identity belongs to #1030. */
import { readFileSync, readdirSync, lstatSync, realpathSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { load, JSON_SCHEMA } from 'js-yaml';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { acquireTrackerLock, trackerLockDirFor, renameSyncWithRetry } from './tracker-utils.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { validateFlags } from './lib/cli-flags.mjs';

export const JOB_FACTS_TTL_MS = 24 * 60 * 60 * 1000;
const LIVENESS_TTL_MS = 5 * 60 * 1000;
const PUBLIC_FIELDS = ['company', 'role', 'advertised_comp', 'reports_to'];
const CACHE_FIELDS = ['schema_version', 'listing_fingerprint', 'captured_at', 'invalidated_at'];
const EXPLICIT_CLOSURE_CODES = new Set(['http_gone', 'expired_url', 'expired_body', 'listing_page']);
const miss = (reason) => ({ status: 'miss', reason });
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// No permissive Date.parse fallback: date-only/local time and normalized invalid
// calendar dates must not accidentally authorize reuse.
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return NaN;
  const n = Date.parse(value);
  return Number.isFinite(n) && new Date(n).toISOString() === (value.length === 20 ? value.replace(/Z$/, '.000Z') : value) ? n : NaN;
}

/** Find one actual Markdown section; ignore headings inside fenced JD examples. */
function machineSummary(markdown) {
  if (typeof markdown !== 'string' || markdown.length > 2_000_000) return null;
  const lines = markdown.split(/(?<=\n)/);
  let fence = null, offset = 0;
  const headings = [];
  for (const line of lines) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})(.*)/);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = null;
    } else if (mark) fence = mark[1];
    else if (/^##[ \t]+Machine Summary[ \t]*\r?\n?$/.test(line)) headings.push(offset + line.length);
    offset += line.length;
  }
  if (headings.length !== 1) return null;
  const start = headings[0];
  const match = markdown.slice(start).match(/^(?:[ \t]*\r?\n)*(`{3,})(?:yaml|yml|json)[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*(?=\r?\n|$)/);
  if (!match) return null;
  const raw = match[2];
  const rawStart = start + match[0].indexOf(raw);
  try {
    const summary = load(raw, { schema: JSON_SCHEMA });
    return isObject(summary) ? { summary, raw, rawStart } : null;
  } catch { return null; }
}

/** Explicit projection only. Never serialize the report, header or private maps. */
function publicFacts(summary) {
  const facts = {};
  for (const field of PUBLIC_FIELDS) {
    const value = summary[field] ?? null;
    if (value !== null && (typeof value !== 'string' || !value.trim() || value.length > 2000)) return null;
    facts[field] = value;
  }
  return facts.company && facts.role ? facts : null;
}

export function extractJobFacts(markdown) {
  const parsed = machineSummary(markdown);
  return parsed ? publicFacts(parsed.summary) : null;
}

async function identityModule() {
  try { return await import('./listing-fingerprint.mjs'); }
  catch (error) {
    // This dependent draft can be installed before #1030. No substitute key,
    // URL heuristic or local copy: reuse stays disabled until it is installed.
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./listing-fingerprint.mjs', import.meta.url).href) return null;
    throw error;
  }
}

function livenessValid(identity, fingerprint, liveness, now) {
  if (!isObject(liveness) || !['active', 'expired', 'uncertain'].includes(liveness.result)) return false;
  const checked = timestamp(liveness.checked_at);
  if (!Number.isFinite(checked) || checked > now || now - checked >= LIVENESS_TTL_MS) return false;
  try {
    // Canonical host/path omit query, so they cannot prove identity (e.g.
    // Greenhouse embed/job_app?token=...). Bind to the independently resolved
    // ATS record of the posting actually checked, using the same #1030 API.
    if (identity.listingKey(liveness.listing_fingerprint) !== identity.listingKey(fingerprint)) return false;
    const context = identity.computeListingFingerprint({ url: liveness.url });
    return !!fingerprint.canonical_host && !!fingerprint.canonical_path &&
      context.canonical_host === liveness.listing_fingerprint.canonical_host &&
      context.canonical_path === liveness.listing_fingerprint.canonical_path &&
      context.canonical_host === fingerprint.canonical_host && context.canonical_path === fingerprint.canonical_path;
  } catch { return false; }
}

async function contextFor({ fingerprint, liveness, now }) {
  if (!Number.isFinite(now)) throw new TypeError('now must be a finite timestamp');
  const identity = await identityModule();
  if (!identity) return { failure: miss('listing-identity-unavailable') };
  let key;
  try { key = identity.listingKey(fingerprint); }
  catch { return { failure: miss('invalid-identity') }; }
  if (!key) return { failure: miss('partial-identity') };
  if (!livenessValid(identity, fingerprint, liveness, now)) return { failure: miss('liveness-unverified') };
  return { identity, key };
}

function reportFiles(reportsDir) {
  try {
    // A report symlink could read or rewrite unrelated user data. Only direct
    // regular Markdown files in the selected reports directory are eligible.
    if (lstatSync(reportsDir).isSymbolicLink()) throw new Error('reports directory must not be a symlink');
    return readdirSync(reportsDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => join(reportsDir, entry.name)).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function reportRecord(path, identity, key) {
  try {
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) return null;
    const markdown = readFileSync(path, 'utf8');
    const parsed = machineSummary(markdown);
    const meta = parsed?.summary.job_facts_cache;
    if (!isObject(meta) || meta.schema_version !== 1 || Object.keys(meta).some(k => !CACHE_FIELDS.includes(k))) return null;
    if (identity.listingKey(meta.listing_fingerprint) !== key) return null;
    const captured = timestamp(meta.captured_at);
    // An invalid invalidation marker must fail closed, never become 'not invalidated'.
    const invalidated = meta.invalidated_at == null ? null : timestamp(meta.invalidated_at);
    return { path, markdown, parsed, meta, captured, invalidated, facts: publicFacts(parsed.summary) };
  } catch (error) {
    if (error.code && error.code !== 'ENOENT') throw error;
    return null;
  }
}

/** Read-only lookup. Call invalidateJobFacts on a confirmed liveness miss. */
export async function lookupJobFacts({ reportsDir = join(getCareerOpsRoot(), 'reports'), fingerprint, liveness, now = Date.now() } = {}) {
  const { identity, key, failure } = await contextFor({ fingerprint, liveness, now });
  if (failure) return failure;
  if (liveness.result !== 'active') return miss(`liveness-${liveness.result}`);
  const records = reportFiles(reportsDir).map(path => reportRecord(path, identity, key)).filter(Boolean);
  if (records.some(r => r.invalidated !== null && (!Number.isFinite(r.invalidated) || r.invalidated > now))) return miss('invalid-invalidation');
  const invalidatedAt = Math.max(-Infinity, ...records.map(r => r.invalidated ?? -Infinity));
  if (timestamp(liveness.checked_at) <= invalidatedAt) return miss('liveness-before-invalidation');
  const fresh = records.filter(r => r.facts && Number.isFinite(r.captured) && r.captured <= now &&
    now - r.captured < JOB_FACTS_TTL_MS && r.captured > invalidatedAt)
    .sort((a, b) => b.captured - a.captured);
  if (!fresh.length) return miss('no-fresh-facts');
  const newest = fresh[0];
  return { status: 'hit', payload: {
    schema_version: 1, listing_key: key, captured_at: newest.meta.captured_at, job_facts: newest.facts,
  } };
}

/** Persist tombstones in all matching reports; no separate cache store. */
export async function invalidateJobFacts({ reportsDir = join(getCareerOpsRoot(), 'reports'), fingerprint, liveness, now = Date.now() } = {}) {
  const { identity, key, failure } = await contextFor({ fingerprint, liveness, now });
  if (failure) return failure;
  if (liveness.result !== 'expired' || !EXPLICIT_CLOSURE_CODES.has(liveness.code)) {
    throw new TypeError('invalidation requires explicit closure evidence');
  }
  const files = reportFiles(reportsDir);
  if (!files.length) return miss('no-cached-facts');
  const lock = await acquireTrackerLock(trackerLockDirFor(join(realpathSync(reportsDir), '.job-facts-cache')), { timeoutMs: 5000 });
  try {
    const records = reportFiles(reportsDir).map(path => reportRecord(path, identity, key)).filter(Boolean);
    if (!records.length) return miss('no-cached-facts');
    const invalidatedAt = new Date(Math.max(now, ...records
      .map(record => Number.isFinite(record.invalidated) ? record.invalidated : -Infinity))).toISOString();
    // Stamp every duplicate so deleting/archiving one report cannot remove
    // the only closure marker and revive another still-fresh copy.
    for (const record of records) {
      const meta = { schema_version: 1, listing_fingerprint: record.meta.listing_fingerprint,
        captured_at: record.meta.captured_at, invalidated_at: invalidatedAt };
      // Replace only this top-level cache block. The rest of the YAML and the
      // report stay byte-identical, including private comments and formatting.
      const block = /^job_facts_cache:[^\r\n]*(?:\r?\n(?:[ \t]+[^\r\n]*|[ \t]*))*/m;
      const raw = record.parsed.raw;
      const matching = raw.match(block);
      if (!matching) throw new Error('cache metadata must use an unquoted top-level job_facts_cache key');
      const replacement = `job_facts_cache: ${JSON.stringify(meta)}\n`;
      const updated = raw.replace(block, () => replacement);
      // Reject YAML aliases or unusual layout instead of risking a broader rewrite.
      const reparsed = load(updated, { schema: JSON_SCHEMA });
      const expected = { ...record.parsed.summary, job_facts_cache: meta };
      if (JSON.stringify(reparsed) !== JSON.stringify(expected)) throw new Error('cache metadata cannot be updated safely');
      const start = record.parsed.rawStart;
      const temp = `${record.path}.${randomUUID()}.tmp`;
      try {
        const mode = lstatSync(record.path).mode & 0o777;
        writeFileSync(temp, record.markdown.slice(0, start) + updated + record.markdown.slice(start + raw.length), { flag: 'wx', mode: 0o600 });
        // Reports contain private fit: an atomic rewrite must not widen access.
        chmodSync(temp, mode);
        renameSyncWithRetry(temp, record.path);
      } finally { rmSync(temp, { force: true }); }
    }
    return { status: 'invalidated', invalidated_at: invalidatedAt };
  } finally { lock.release(); }
}

const USAGE = `Usage: node evaluation-cache.mjs --identity FILE --liveness FILE [--reports DIR] [--invalidate]

Read local reports and print strictly allowlisted public job facts as JSON.
--identity FILE  #1030 listing-fingerprint record (JSON)
--liveness FILE  Current {url, listing_fingerprint, result, checked_at} (JSON)
--reports DIR    Defaults to reports/ under the resolved career-ops data root
--invalidate     Record confirmed expired liveness in existing report metadata
--help, -h       Show help

Only a strong identity, active check less than 5 minutes old, and facts less than
24 hours old authorize reuse. No network requests or candidate scoring. Lookup
is read-only; --invalidate updates only the report's job_facts_cache metadata.`;

async function main() {
  const args = process.argv.slice(2);
  validateFlags(args, ['--identity', '--liveness', '--reports', '--invalidate', '--help', '-h'], USAGE,
    { valueFlags: ['--identity', '--liveness', '--reports'], requireOperand: true });
  const { values } = parseArgs({ args, options: {
    identity: { type: 'string' }, liveness: { type: 'string' }, reports: { type: 'string' }, invalidate: { type: 'boolean' },
  } });
  if (!values.identity || !values.liveness) throw new TypeError('--identity and --liveness are required');
  const options = { fingerprint: JSON.parse(readFileSync(values.identity, 'utf8')),
    liveness: JSON.parse(readFileSync(values.liveness, 'utf8')), reportsDir: values.reports };
  console.log(JSON.stringify(await (values.invalidate ? invalidateJobFacts(options) : lookupJobFacts(options)), null, 2));
}

if (isMainModule(import.meta.url)) main().catch(() => {
  // Input/report parse errors can contain candidate text: do not echo them.
  console.error('evaluation-cache: invalid input or unavailable report files; see --help');
  process.exitCode = 1;
});
