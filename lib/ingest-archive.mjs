/**
 * ingest-archive.mjs — durable, append-only history for parsed ingest rows.
 *
 * WHY THIS IS ENGINE-SIDE
 * -----------------------
 * The plugin contract (plugins/_types.js) is that producers RETURN data and the
 * ENGINE writes: "ingest: pull postings from a service → Job[]. The engine appends
 * them to data/pipeline.md canonically." `export` is not a way around that — it
 * receives a frozen snapshot of the TRACKER, not the ingest's Job[], and its
 * contract says "No file handle." So the archive is written here, beside
 * appendToPipeline/appendToScanHistory, and a plugin opts in by naming a path.
 *
 * WHY NOT data/linkedin-job-meta.tsv
 * ----------------------------------
 * That file is the private cache of linkedin-job-enrich.mjs and nothing else. It
 * is fully REWRITTEN by writeMetaCache on every run, so anything parked there is
 * erased the next time that tool runs — and a row carrying status:"ok" suppresses
 * the page verification linkedin-job-enrich.mjs performs (it skips fetching when
 * `c.status === 'ok' && c.title`). An alert-side record must not be able to
 * impersonate a page-verified one. This file is opened "a" and never truncated,
 * and nothing else in the repo reads or writes it: structurally immune to a cache
 * reset, which is exactly the property the file needed and did not have there.
 *
 * APPEND-ONLY + ATOMIC, PRECISELY
 * --------------------------------
 * One row = one physical line. JSON.stringify escapes newlines inside strings, so
 * a job whose title or description contains "\n" still yields a single line — the
 * guarantee JSON Lines provides for free and the reason this format was chosen
 * over a TSV.
 *
 * Durability rests on three things, and the third is the honest limit:
 *   1. Every line is COMPLETE in memory before any byte is written. Nothing is
 *      streamed, so there is no window in which a half-serialized row exists.
 *   2. The file is opened "a" (O_APPEND), so the kernel places each write at the
 *      current end of file — two concurrent appenders cannot interleave bytes.
 *   3. A large batch may be split by Node into more than one write(2). If the
 *      process dies between them the file ends in a PARTIAL LINE. It can never
 *      be a partial line in the middle (everything before the last completed
 *      write is intact), so readIngestArchive() discards an unterminated tail and
 *      reports it, and the next append completes the file. Per-line rename-and-
 *      replace would be atomic but O(n²) over the file's life, which is the wrong
 *      trade for a log that only ever grows.
 *
 * Rows are EVENTS, not state: one row per job per ingest run. Re-running a plugin
 * appends again by design — that is what an append-only audit trail means — so
 * every row carries a stable `record_id` (plugin + url) for consumers that want
 * to collapse repeats themselves.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { createHash } from 'node:crypto';
import { getCareerOpsRoot } from '../path-resolver.mjs';

/** Default ledger path, relative to the career-ops data root. */
export const DEFAULT_ARCHIVE_PATH = 'data/alert-ingest-history.jsonl';

/**
 * Stable identity for one (plugin, job) pair.
 *
 * URL-only would collide across plugins — two sources can legitimately surface
 * the same posting with different parsed metadata, and those are different
 * observations worth keeping. Short digest so the ledger stays scannable.
 */
export function recordId(pluginId, url) {
  return createHash('sha256')
    .update(`${pluginId || 'unknown'}|${url || ''}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Shape one row for the ledger.
 *
 * Exported so a dry run and the real write cannot disagree about what a record
 * looks like — a preview built by a second, near-identical formatter is exactly
 * how a preview stops matching reality.
 *
 * @param {object} job - A sanitized Job from plugins.mjs.
 * @param {object} opts
 * @param {string} opts.pluginId
 * @param {string} [opts.ingestedAt] - ISO timestamp; injected for testability.
 * @returns {object}
 */
export function archiveRecord(job, { pluginId, ingestedAt } = {}) {
  const rec = {
    ingested_at: ingestedAt ?? new Date().toISOString(),
    plugin: pluginId ?? null,
    record_id: recordId(pluginId, job?.url),
    url: job?.url ?? null,
    title: job?.title ?? null,
    company: job?.company ?? null,
    location: job?.location ?? null,
  };
  // Only present when the plugin actually parsed one. An explicit `salary: null`
  // would be indistinguishable from a parser that saw the field and rejected the
  // figure; omitting it means "this source stated no range".
  if (job && job.salary && typeof job.salary === 'object') {
    rec.salary = {
      min: Number.isFinite(job.salary.min) ? job.salary.min : null,
      max: Number.isFinite(job.salary.max) ? job.salary.max : null,
      currency: typeof job.salary.currency === 'string' ? job.salary.currency : null,
    };
  }
  return rec;
}

/**
 * Serialize rows to JSON Lines.
 *
 * Pure — exported so the dry-run preview and the written bytes are provably the
 * same string.
 */
export function toJsonl(records) {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

/**
 * Append rows to the ledger.
 *
 * @param {object[]} jobs
 * @param {object} opts
 * @param {string} [opts.path]   Absolute, or relative to the career-ops root.
 * @param {string} [opts.pluginId]
 * @param {boolean} [opts.dryRun] Report the bytes without writing.
 * @returns {{written: number, path: string, bytes: number, dryRun: boolean}}
 */
export function appendToIngestArchive(jobs, { path, pluginId, dryRun = false, ingestedAt } = {}) {
  const target = path && /^[\/\\]/.test(path)
    ? path
    : resolve(getCareerOpsRoot(), path ?? DEFAULT_ARCHIVE_PATH);
  const records = (Array.isArray(jobs) ? jobs : [])
    .filter(Boolean)
    .map((j) => archiveRecord(j, { pluginId, ingestedAt }));
  const payload = toJsonl(records);

  if (dryRun) {
    return { written: records.length, path: target, bytes: Buffer.byteLength(payload), dryRun: true };
  }
  if (!records.length) {
    return { written: 0, path: target, bytes: 0, dryRun: false };
  }

  mkdirSync(dirname(target), { recursive: true });
  // Append-only: never truncate, never rewrite. A failure here must not take the
  // pipeline run down with it — the archive is an audit trail, and losing a row
  // is strictly better than losing the ingest that produced it.
  try {
    appendFileSync(target, payload, { encoding: 'utf8', flag: 'a' });
  } catch (err) {
    console.error(`ingest-archive: could not append to ${target}: ${err.message}`);
    return { written: 0, path: target, bytes: 0, dryRun: false, error: err.message };
  }
  return { written: records.length, path: target, bytes: Buffer.byteLength(payload), dryRun: false };
}

/**
 * Read the ledger back, tolerating a torn final line.
 *
 * @param {string} path
 * @returns {{records: object[], partial: string|null, exists: boolean}}
 *   `partial` is the unterminated tail when a write was interrupted — surfaced
 *   rather than silently dropped, because it means the previous run was killed.
 */
export function readIngestArchive(path) {
  if (!existsSync(path)) return { records: [], partial: null, exists: false };
  const text = readFileSync(path, 'utf-8');
  // A file that does not end in a newline was mid-write when its writer died.
  const endsClean = text === '' || text.endsWith('\n');
  const lines = text.split('\n');
  const tail = endsClean ? '' : (lines.pop() ?? '');

  const records = [];
  let unreadable = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // A corrupt INTERIOR line is a real problem (it should be impossible with
      // append-only writes) but must not hide the rows around it.
      unreadable++;
    }
  }
  return {
    records,
    partial: tail || null,
    exists: true,
    unreadable,
    bytes: statSync(path).size,
  };
}