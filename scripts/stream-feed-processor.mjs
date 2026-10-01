#!/usr/bin/env node
/**
 * stream-feed-processor.mjs — row-by-row NDJSON streaming for large open-data feeds.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every other collector in this repo accumulates into an array first:
 *
 *     const jobs = [];
 *     for (const x of batch) jobs.push(normalize(x));
 *     return jobs;
 *
 * That is the right shape for a company board (tens of postings) and the wrong
 * one for a large feed (a full ATS export, a multi-year archive, a multi-megabyte
 * JSON array). The array is the ceiling: peak RSS is the size of the whole
 * dataset, and the caller sees NOTHING until the last record lands. Under a batch
 * worker's wall-clock cap that produces the worst of both failures — the run
 * either finishes inside budget or returns nothing at all, with no partial
 * progress to show and no way to tell "still working" from "hung".
 *
 * This script inverts that. Records are validated and written to stdout the
 * moment they parse, so a consumer sees a growing result and can act on what has
 * already arrived even if the stream is later cut off. Peak memory is one record
 * plus one chunk of input, independent of feed size.
 *
 * SCOPE — permitted sources only
 * ------------------------------
 * This is a FORMAT tool, not a collector: it fetches exactly the URL or path it
 * is handed and parses what comes back. It has no notion of any source, so it
 * cannot decide on its own whether a feed is one a user is permitted to read —
 * see LEGAL_DISCLAIMER.md ("Do not use this tool to scrape platforms that
 * prohibit automated access") and CONTRIBUTING.md, which rejects PRs that scrape
 * platforms prohibiting automated access. Point it at local exports and public,
 * rate-compliant feeds.
 *
 * Network posture matches the rest of the repo rather than being looser for
 * being "just a stream": the URL goes through liveness-browser.mjs's SSRF host
 * guard, redirects are followed MANUALLY so each hop is re-validated rather than
 * trusted, and the response is rejected outright if it is not 200.
 *
 * FORMATS
 * -------
 *   ndjson       one JSON value per line. The DEFAULT, and the format this
 *                script emits. `--format ndjson` also forces it.
 *   json-array   a `[...]` document read incrementally, one element at a time.
 *                Auto-detected from a leading `[`, since `[` cannot begin an
 *                NDJSON record. Never materializes the array.
 *   json         ONE JSON value (object or scalar) that may span many lines —
 *                a pretty-printed document. Read with the same incremental
 *                scanner. NOT auto-detected, because a leading `{` is ambiguous
 *                against NDJSON and guessing would silently pick the wrong one.
 *   csv          header row + delimited records, emitted as objects keyed by
 *                the header. RFC4180 quoting, no embedded newlines (see the
 *                limitation note on parseCsvRecord).
 *
 * OUTPUT
 * ------
 * stdout carries ONE JSON object per line and nothing else — no banner, no
 * progress, no summary. A consumer can pipe it straight into a reader without
 * filtering. Everything diagnostic (counts, per-row rejects, the fatal error) goes
 * to STDERR, which is what makes the stream safe to pipe.
 *
 * EXIT CODES — a partial run is distinguishable from a clean one, because "it
 * streamed 9,000 of 9,500 rows" and "it streamed all 9,500" are different facts
 * and a batch worker needs to tell them apart:
 *   0  every record validated
 *   2  the stream COMPLETED but at least one row was rejected (see --strict)
 *   1  fatal — source unreadable, non-200, bad format, or interrupted mid-stream
 *
 * `--strict` promotes a single rejected row to a fatal error: the run stops and
 * exits 1 at the first bad record, so a corrupt feed fails loudly instead of
 * quietly producing a short result nobody notices.
 *
 * Usage:
 *   node scripts/stream-feed-processor.mjs <path-or-url> [options]
 *   node scripts/stream-feed-processor.mjs exports/ats.ndjson
 *   node scripts/stream-feed-processor.mjs https://example.org/feed.ndjson --require url,title
 *   node scripts/stream-feed-processor.mjs big.json --format json-array --limit 5000
 *   node scripts/stream-feed-processor.mjs data/jobs.csv --format csv --require url,title \
 *       --ledger data/feed-meta.tsv --ledger-cols url,title,company
 *
 * Options:
 *   --format <fmt>        ndjson (default) | json-array | json | csv
 *   --require <a,b.c>     dotted paths EVERY record must have, non-empty
 *   --limit <n>           stop after n emitted records (default 0 = no limit)
 *   --ledger <path>       append one TSV row per emitted record
 *   --ledger-cols <a,b>   dotted paths promoted to TSV columns (implies --ledger)
 *   --csv-delimiter <ch>  csv field delimiter (default ",")
 *   --timeout <ms>        ms to fetch response HEADERS (default 30000)
 *   --stall <ms>          ms of silence before declaring the stream dead
 *                         (default 60000; 0 disables). A feed that stops
 *                         sending without closing would otherwise hang a worker
 *                         until its wall-clock cap kills it mid-write.
 *   --strict              first rejected row is fatal (exit 1)
 *   --quiet               suppress the stderr summary
 *   --help, -h            show this help
 */

import { createReadStream, existsSync, statSync, appendFileSync, writeFileSync, readFileSync, mkdirSync, openSync, readSync, closeSync } from 'fs';
import { createInterface } from 'readline';
import { Readable } from 'stream';
import { resolve, join, dirname } from 'path';
import { createHash } from 'node:crypto';
import { writeFileAtomic } from '../tracker-utils.mjs';
import { normalizeUrl } from '../url-key.mjs';
import { rejectPrivateOrInvalid } from '../liveness-browser.mjs';
import { DEFAULT_USER_AGENT } from '../user-agent.mjs';
import { flagValue, hasFlag, validateFlags, safeIntFlag } from '../lib/cli-flags.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';
import { getCareerOpsRoot } from '../path-resolver.mjs';

// ── defaults ────────────────────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STALL_MS = 60_000;
/**
 * Rows between checkpoint writes.
 *
 * A rename is a syscall; at 100 rows the cost is invisible next to the parse and
 * validation it records progress for, and a hard kill rewinds at most this many
 * rows. See the resume contract in the header for why that rewind is a duplicate
 * risk rather than a data risk.
 */
const DEFAULT_CHECKPOINT_EVERY = 100;
/** Bumped when the cursor's shape changes; an older version is refused, not guessed at. */
const CHECKPOINT_VERSION = 1;
/** Max redirects followed by hand. Enough for a feed that bounces http->https. */
const MAX_REDIRECTS = 3;
/** Refuse a single input line larger than this before it becomes a buffer. */
const MAX_LINE_BYTES = 8 * 1024 * 1024;

/**
 * Peek at a LOCAL file's first non-whitespace byte to auto-detect the format.
 *
 * The same one unambiguous case the remote probe handles. Reading it needs only
 * a few bytes of a buffered read, so the file is not opened twice in any way
 * that matters and no part of it is held.
 *
 * Without this, a local `.json` array was parsed line-by-line as NDJSON and every
 * pretty-printed line of it — including the opening `[` — was rejected as a parse
 * error. The run reported twenty-odd rejects and zero records rather than
 * detecting the format it was handed.
 *
 * @param {string} path
 * @returns {Promise<string|null>} 'json-array' | null
 */
async function probeLocalFormat(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(PROBE_BYTES);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.toString('utf8', 0, n).trimStart().startsWith('[') ? 'json-array' : null;
  } catch {
    return null; // probe is an optimization; never fatal
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Fetch response headers only, to detect the format. Kept separate from the
 * streaming fetch so a mis-declared format is caught BEFORE the first record is
 * emitted — a caller that piped this into a writer has already committed to the
 * stream by then, and a `--format json-array` that turns out to be NDJSON would
 * otherwise emit every record as one broken fragment.
 */
const PROBE_TIMEOUT_MS = 15_000;
/** Bytes read to decide whether a source is a JSON array. */
const PROBE_BYTES = 4096;

const VALUE_FLAGS = ['--format', '--require', '--limit', '--ledger', '--ledger-cols', '--csv-delimiter', '--timeout', '--stall', '--resume-token', '--checkpoint-every', '--time-budget'];
const KNOWN_FLAGS = [...VALUE_FLAGS, '--strict', '--quiet', '--fresh', '--help', '-h'];

const USAGE = `Usage:
  node scripts/stream-feed-processor.mjs <path-or-url> [options]

  --format <fmt>        ndjson (default) | json-array | json | csv
  --require <a,b.c>     dotted paths EVERY record must have, non-empty
  --limit <n>           stop after n emitted records (0 = no limit)
  --ledger <path>       append one TSV row per emitted record
  --ledger-cols <a,b>   dotted paths promoted to TSV columns (implies --ledger)
  --csv-delimiter <ch>  csv field delimiter (default ",")
  --timeout <ms>        ms to fetch response headers (default ${DEFAULT_TIMEOUT_MS})
  --stall <ms>          ms of silence before declaring the stream dead (default ${DEFAULT_STALL_MS}; 0 disables)
  --time-budget <sec>   stop this run after N seconds and exit 143, with the
                         cursor written. Same effect as an external SIGTERM but
                         self-imposed, which is what lets a caller carve one feed
                         into as many budget-sized rounds as it needs. 0 = no
                         limit.
  --resume-token <path> JSON cursor file: skip rows a previous run already
                         consumed, and update it as this run proceeds
  --checkpoint-every <n> rows between cursor writes (default ${DEFAULT_CHECKPOINT_EVERY}; 0 = only on exit)
  --fresh               ignore an existing --resume-token cursor and overwrite it
  --strict              first rejected row is fatal (exit 1)
  --quiet               suppress the stderr summary
  --help, -h            show this help

stdout carries one JSON object per line and nothing else; diagnostics go to stderr.
Exit: 0 clean · 2 completed with rejected rows · 1 fatal.`;

// ── value access ────────────────────────────────────────────────────────────

/**
 * Resolve a dotted path against a record.
 *
 * Dotted rather than flat because feeds nest (`posting.title`, `company.name`)
 * and a validator that only understands top-level keys forces every caller to
 * flatten first — which means the output records are flattened too, whether the
 * consumer wanted that or not. Array indices work as numeric segments
 * (`offices.0.name`).
 *
 * @param {any} obj
 * @param {string} path
 * @returns {any} The value, or undefined if any segment is missing.
 */
export function getPath(obj, path) {
  const parts = String(path).split('.').filter(Boolean);
  let cur = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (!Number.isInteger(idx)) return undefined;
      cur = cur[idx];
      continue;
    }
    if (typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * Split a comma-separated flag value into dotted paths.
 *
 * Accepts both the comma form (`--require a,b`) and a REPEATED flag
 * (`--require a --require b`), because both readings come up in practice and
 * flagValue() only reads one. An empty result is meaningful — "no constraint" —
 * so it is returned rather than turned into a default.
 *
 * @param {string[]} args
 * @param {string} flag
 * @returns {string[]}
 */
export function collectPaths(args, flag) {
  const out = [];
  args.forEach((a, i) => {
    if (a === flag) {
      const next = args[i + 1];
      if (typeof next === 'string' && !next.startsWith('--')) {
        out.push(...next.split(',').map((s) => s.trim()).filter(Boolean));
      }
      return;
    }
    if (a.startsWith(`${flag}=`)) {
      out.push(...a.slice(flag.length + 1).split(',').map((s) => s.trim()).filter(Boolean));
    }
  });
  return out;
}

/**
 * Decide whether a parsed record satisfies `--require`.
 *
 * "Non-empty" excludes exactly the values that would make a required field
 * useless while still LOOKING present — `""`, `null`, `undefined`, `NaN`. The
 * NaN case matters more than it looks: `JSON.parse` never produces one, but a
 * hand-rolled parser or a CSV column read as a number can, and `NaN` is truthy,
 * so a truthiness test would pass a record whose only numeric field is garbage.
 *
 * A number is required to be finite, which rejects `Infinity` — reachable the
 * same way, and worse: `JSON.stringify` writes it as `null`, so it would pass
 * this check and then vanish from the emitted record entirely.
 *
 * Returns a LIST of the paths that failed, not a boolean, so the stderr reject
 * reason can name the actual missing field instead of a generic "invalid".
 *
 * @param {any} rec
 * @param {string[]} paths
 * @returns {string[]} Failing paths; empty means the record is valid.
 */
export function validateRecord(rec, paths) {
  const bad = [];
  for (const p of paths) {
    const v = getPath(rec, p);
    if (v === undefined || v === null) { bad.push(p); continue; }
    if (typeof v === 'string' && v.trim() === '') { bad.push(p); continue; }
    if (typeof v === 'number' && !Number.isFinite(v)) { bad.push(p); continue; }
  }
  return bad;
}

/**
 * Reject records that are structurally unusable, independent of `--require`.
 *
 * A bare scalar (a number, a string, null) is not a record: it has no fields, so
 * `--require` can never be satisfied and every consumer downstream has to branch
 * on type. Arrays are rejected too — an NDJSON feed of arrays means the producer
 * wrote one JSON array across many lines, which is a format error worth naming
 * rather than a record worth emitting.
 *
 * @param {any} rec
 * @returns {string|null} A reason, or null when the record is usable.
 */
export function structuralReject(rec) {
  if (rec === null || rec === undefined) return 'null record';
  if (Array.isArray(rec)) return 'array record (producer likely emitted one JSON array across lines — use --format json-array)';
  if (typeof rec !== 'object') return `non-object record (${typeof rec})`;
  return null;
}

// ── incremental JSON value scanner ──────────────────────────────────────────

/**
 * Find where the first complete JSON value in `s` ends, or -1 if `s` holds only a
 * prefix of one.
 *
 * This is the whole of `--format json-array` and `--format json`: instead of
 * parsing a multi-megabyte document and holding the result, the input is scanned
 * for value boundaries and each value is handed off as soon as it closes. Peak
 * memory is the buffer plus one value, not the document.
 *
 * Three states matter: string-literal (so a `{` inside a quoted string does not
 * open a nesting level), escape (so a `\"` does not close a string), and depth
 * (so scalars and the outer array's own `]` are distinguished from a nested
 * `]`).
 *
 * The depth-0 delimiter set includes `]` and `}`: at depth 0 a closing bracket
 * can only belong to an enclosing container, so a scalar immediately followed by
 * `]` (`123]`) is COMPLETE, not incomplete. Returning -1 there would stall the
 * splitter on the last element of every array until the stream closed — and with
 * a stall guard installed, that is indistinguishable from a dead feed.
 *
 * Pure — exported so the boundary rules can be unit-tested without a stream.
 *
 * @param {string} s
 * @returns {number} Exclusive end index of the first complete value, or -1.
 */
export function scanJsonValueEnd(s) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  let startedVal = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') {
        inStr = false;
        // A string scalar closes at its own quote once depth is 0; a nested one
        // belongs to a container that has not finished yet.
        if (depth === 0) return i + 1;
      }
      continue;
    }

    if (!startedVal) {
      // Leading whitespace/commas separate values; report the boundary so the
      // caller can skip them without the scanner guessing which it is looking at.
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',') return i;
      startedVal = true;
    }

    if (c === '"') { inStr = true; continue; }
    if (c === '{' || c === '[') { depth++; continue; }
    if (c === '}' || c === ']') {
      if (depth === 0) return -1; // the enclosing container's closer — caller's
      depth--;                    // job, never a value boundary
      if (depth === 0) return i + 1;
      continue;
    }
    if (depth === 0 && (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',' || c === ']' || c === '}')) {
      return i;
    }
  }
  return -1;
}

/**
 * Pull complete top-level values out of a growing buffer without ever holding the
 * whole document.
 *
 * `push` returns the values that became complete during THIS chunk and keeps the
 * remainder for the next one. That is the entire streaming mechanism for the two
 * JSON formats; the caller feeds it decoded text and emits whatever comes back.
 *
 * The two modes differ in what "top level" MEANS, which is why they get separate
 * branches rather than one shared path:
 *
 *   json-array  the document is one container. Its `[` is consumed ONCE and the
 *               buffer then holds array elements, so `scanJsonValueEnd`'s depth-0
 *               closes are real element boundaries and `]` terminates the feed.
 *
 *   json        the document IS one value. Nothing is consumed — the outer `{`
 *               stays in the buffer precisely so its matching `}` is scanned at
 *               depth 1 and the whole object closes at depth 0. Consuming it
 *               instead (the earlier shape of this function) demoted every
 *               nested value to depth 0, so a single pretty-printed object came
 *               out as its first FIELD (`{"meta":{"a":[1,2,3]}}` emitted
 *               `{"a":[1,2,3]}`) and the rest was rejected as trailing garbage.
 *               That is silent data loss on the format's whole reason for
 *               existing, so the two cases stay visibly separate.
 *
 * @param {'json-array'|'json'} mode
 * @returns {{push(chunk: string): string[], end(): string[], done: boolean}}
 */
export function createValueSplitter(mode) {
  let buf = '';
  let opened = false;
  let closed = false;
  let emitted = false;

  /** Skip whitespace and separators between elements. */
  const skipGap = () => {
    let i = 0;
    while (i < buf.length && /[\s,]/.test(buf[i])) i++;
    if (i) buf = buf.slice(i);
  };

  return {
    get done() {
      return closed;
    },

    push(chunk) {
      const out = [];
      if (closed) return out;

      if (mode === 'json') {
        // One value for the whole document. Emit as soon as it closes, then
        // ignore the rest — trailing whitespace or a trailing newline is normal.
        if (emitted) return out;
        buf += chunk;
        if (buf.trim() === '') return out;
        const end = scanJsonValueEnd(buf);
        if (end < 0) return out;
        out.push(buf.slice(0, end).trim());
        buf = buf.slice(end);
        emitted = true;
        return out;
      }

      buf += chunk;

      if (!opened) {
        skipGap();
        if (buf === '') return out;
        if (buf[0] !== '[') {
          throw new SyntaxError(`--format json-array expects a leading "[", got ${JSON.stringify(buf[0])}`);
        }
        buf = buf.slice(1);
        opened = true;
      }

      for (;;) {
        skipGap();
        if (buf === '') return out;
        if (buf[0] === ']') { closed = true; buf = ''; return out; }
        const end = scanJsonValueEnd(buf);
        if (end <= 0) return out; // 0 = nothing but a gap; -1 = incomplete
        out.push(buf.slice(0, end));
        buf = buf.slice(end);
      }
    },

    /**
     * Flush whatever is left once the source is exhausted.
     *
     * A trailing element with no delimiter after it (`[1,2` truncated, or a file
     * whose last line has no newline) is complete-but-unterminated. Without this
     * the LAST record of every such feed is silently dropped — and the last
     * record is exactly the one a caller is most likely to be looking for.
     */
    end() {
      const out = [];
      const tail = buf.trim();
      buf = '';
      if (tail && tail !== ']' && tail !== '}') out.push(tail);
      closed = true;
      return out;
    },
  };
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/**
 * Split one CSV line into fields, honouring RFC4180 double-quote escaping.
 *
 * LIMITATION, stated rather than hidden: a quoted field containing a NEWLINE
 * spans physical lines, and this reads one line at a time, so such a field is
 * split across two records. Multi-line CSV is rare in ATS exports and cannot be
 * supported without the buffering this script exists to avoid; a feed that needs
 * it should ship NDJSON.
 *
 * Pure — exported for tests.
 *
 * @param {string} line
 * @param {string} delimiter
 * @returns {string[]}
 */
export function parseCsvRecord(line, delimiter = ',') {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  const d = delimiter || ',';

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else cur += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === d) { fields.push(cur); cur = ''; continue; }
    cur += c;
  }
  fields.push(cur);
  return fields;
}

/**
 * Strip the TSV metacharacters a cell could otherwise inject into the ledger.
 *
 * A TSV with a tab or newline in a cell is not one row: it is several, shifted,
 * and the ledger becomes unreadable in a way that looks like corrupt data rather
 * than a quoting bug. Carriage returns are folded with newlines for the same
 * reason — `parseCsvRecord` never produces one, but a JSON-sourced string can.
 *
 * Plain objects and arrays are serialized as JSON rather than left to implicit
 * coercion. `String({name:'Acme'})` is `"[object Object]"`, which is not a
 * shorter form of the value, it is a different and much less useful one: a
 * ledger column that silently loses every field is worse than one that stores
 * the structure and stays greppable.
 *
 * @param {unknown} v
 * @returns {string}
 */
export function tsvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v).replace(/[\t\r\n]+/g, ' ');
  return String(v).replace(/[\t\r\n]+/g, ' ').trim();
}

// ── output ──────────────────────────────────────────────────────────────────

/**
 * Write to stdout and WAIT when the pipe is full.
 *
 * The backpressure handling is the point of the whole script. `write()` returns
 * false once the internal buffer is full; a caller that ignores that keeps
 * appending to memory until the process OOMs — reintroducing exactly the
 * whole-dataset-in-memory failure this replaces, just with JSON.stringify
 * attached. Awaiting 'drain' is what makes "emit as it arrives" true under a slow
 * consumer rather than only when stdout happens to be a fast file.
 *
 * @param {string} line
 * @returns {Promise<void>}
 */
export function writeOut(line) {
  if (process.stdout.write(line)) return Promise.resolve();
  return new Promise((res) => process.stdout.once('drain', res));
}

// ── resume cursor ───────────────────────────────────────────────────────────

/**
 * Describe the source well enough that a cursor written for it cannot be
 * silently applied to a DIFFERENT source.
 *
 * This is the whole safety story for resume. A cursor that says "I got through
 * 40,000 rows" is only meaningful for the exact bytes it counted. Point it at a
 * re-exported file, a regenerated feed, or a URL whose content changed, and the
 * row at ordinal 40,001 is a different record — so a resume that trusted the
 * number would skip 40,000 real rows and report the tail as if it were the
 * result. Nothing would crash; the answer would just be wrong.
 *
 * So the identity is layered, strongest first:
 *   file  resolved absolute path + byte size + mtime
 *   url   normalizeUrl() (host lowercased, tracking params and fragment dropped,
 *         trailing slash normalized) + the FINAL url after redirects, plus the
 *         server's ETag/Last-Modified when it sent one
 *
 * `id` is a short digest of the locator so the cursor stays a fixed size and does
 * not carry a full path or a signed URL into a file the user may share.
 *
 * @param {string} source - The operand as given.
 * @param {object} meta
 * @param {boolean} meta.remote
 * @param {number}  [meta.size]      Local file byte size.
 * @param {number}  [meta.mtimeMs]   Local file mtime.
 * @param {string}  [meta.finalUrl]  Post-redirect URL.
 * @param {string}  [meta.etag]
 * @param {string}  [meta.lastModified]
 * @returns {{kind: string, id: string, label: string, size: number|null, mtimeMs: number|null, etag: string, lastModified: string}}
 */
export function feedIdentity(source, meta = {}) {
  const kind = meta.remote ? 'url' : 'file';
  const locator = kind === 'url' ? (normalizeUrl(source) || source) : resolve(source);
  const id = createHash('sha256').update(`${kind}:${kind === 'url' ? (meta.finalUrl || locator) : locator}`).digest('hex').slice(0, 16);
  return {
    kind,
    id,
    // The human-readable half is a convenience for reading the cursor, never an
    // input to the comparison — an absolute path or a full query string in a
    // state file is both noisy and more than it needs to carry.
    label: kind === 'url' ? (meta.finalUrl || locator) : locator,
    size: meta.size ?? null,
    mtimeMs: meta.mtimeMs ?? null,
    etag: meta.etag ?? '',
    lastModified: meta.lastModified ?? '',
  };
}

/**
 * Does this cursor belong to this source?
 *
 * Every field is checked, and a MISSING field never passes. A cursor written
 * against a local file carries no ETag, so comparing `cursor.etag !== identity.etag`
 * unconditionally would reject every URL-to-file comparison; the guard is
 * therefore "if the cursor recorded one, it must still match".
 *
 * @param {object|null} cursor - Parsed cursor, or null when there is none.
 * @param {object} identity - Current source identity.
 * @returns {{ok: boolean, reason: string}}
 */
export function cursorMatches(cursor, identity) {
  if (!cursor) return { ok: true, reason: 'no cursor' };
  if (cursor.version !== CHECKPOINT_VERSION) {
    return { ok: false, reason: `cursor version ${cursor.version} != ${CHECKPOINT_VERSION} (delete it to start over)` };
  }
  const prev = cursor.source || {};
  if (prev.id !== identity.id) return { ok: false, reason: 'the source changed (different path or URL)' };
  if (prev.kind !== identity.kind) return { ok: false, reason: 'the source changed kind' };
  if (prev.size !== identity.size) return { ok: false, reason: `the source changed size (${prev.size} -> ${identity.size})` };
  if (prev.mtimeMs !== identity.mtimeMs) return { ok: false, reason: 'the source was modified' };
  if (prev.etag && prev.etag !== identity.etag) return { ok: false, reason: 'the source ETag changed' };
  if (prev.lastModified && prev.lastModified !== identity.lastModified) return { ok: false, reason: 'the source Last-Modified changed' };
  return { ok: true, reason: 'match' };
}

/**
 * Read a cursor, treating anything unparseable as absent.
 *
 * A corrupt cursor must not be a fatal error by itself — the caller can always
 * re-derive one by running again — but it must NOT be silently ignored as
 * "start from zero" either, because that turns a resume the user asked for into
 * a full re-run and, with an appending consumer, duplicates every row. The
 * reason is returned so `main` can say so out loud.
 *
 * @param {string} path
 * @returns {{cursor: object|null, warning: string}}
 */
export function loadCheckpoint(path) {
  if (!existsSync(path)) return { cursor: null, warning: '' };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('not a JSON object');
    return { cursor: parsed, warning: '' };
  } catch (err) {
    return { cursor: null, warning: `cursor at ${path} is unreadable (${err.message}) — starting from the beginning` };
  }
}

/**
 * Write a cursor atomically.
 *
 * `writeFileAtomic` is tracker-utils.mjs's own same-directory-temp-plus-rename
 * helper, reused rather than reimplemented: the rename retry is what makes the
 * write survive Windows contention, and this cursor has the same requirement as
 * every other canonical file in the repo. A plain `writeFileSync` here would
 * leave a truncated JSON file behind if the process died mid-write — and a
 * truncated cursor is the one artifact whose failure mode (silently restarting
 * from zero) is exactly what the cursor exists to prevent.
 *
 * @param {string} path
 * @param {object} identity
 * @param {{consumed: number, emitted: number, rejected: number}} position
 * @returns {boolean} Whether the write succeeded (a failure is reported, not thrown).
 */
export function saveCheckpoint(path, identity, position) {
  const payload = {
    version: CHECKPOINT_VERSION,
    updatedAt: new Date().toISOString(),
    source: identity,
    position: { ...position },
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileAtomic(path, `${JSON.stringify(payload, null, 2)}\n`);
    return true;
  } catch (err) {
    console.error(`stream-feed-processor: could not write cursor ${path}: ${err.message}`);
    return false;
  }
}

// ── argument parsing ────────────────────────────────────────────────────────

const FORMATS = ['ndjson', 'json-array', 'json', 'csv'];

/**
 * Parse argv into a run config.
 *
 * Kept pure and separate from `main` so the flag surface is testable without a
 * stream. Both flag spellings (`--flag value` and `--flag=value`) reach every
 * value read: lib/cli-flags.mjs exists because hand-rolled loops here silently
 * ignored the `=` form (#2401/#2402), and that failure mode is a run that
 * proceeds with the wrong setting and reports success.
 *
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{source: string, format: string|null, require: string[], limit: number,
 *            ledger: string|null, ledgerCols: string[], csvDelimiter: string,
 *            timeoutMs: number, stallMs: number, strict: boolean, quiet: boolean}}
 */
export function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];

  // A token consumed as a value must not also be read as the operand, the same
  // adjacency rule validateFlags applies.
  const consumed = new Set();
  args.forEach((a, i) => {
    if (VALUE_FLAGS.includes(a) && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) consumed.add(i + 1);
  });

  let source;
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (typeof tok !== 'string' || consumed.has(i)) continue;
    if (!tok.startsWith('-') && source === undefined) source = tok;
  }

  const formatRaw = flagValue(args, '--format');
  const format = formatRaw == null ? null : String(formatRaw).toLowerCase();

  const ledgerRaw = flagValue(args, '--ledger');
  const ledgerCols = collectPaths(args, '--ledger-cols');

  const delimRaw = flagValue(args, '--csv-delimiter');
  // TAB rather than ",": a literal tab in an argv token is awkward to type and
  // easy to mangle, and TSV is the shape this repo's own ledgers already use.
  const csvDelimiter = delimRaw == null ? ',' : String(delimRaw).replace(/\\t/g, '\t').replace(/^\\n$/, '\n');

  return {
    source,
    format,
    require: collectPaths(args, '--require'),
    // safeIntFlag, not parseInt: a negative or non-numeric --limit would
    // otherwise compare as "limit reached immediately" or NaN-never-equal.
    limit: safeIntFlag(flagValue(args, '--limit'), 0),
    ledger: ledgerRaw ? String(ledgerRaw) : null,
    ledgerCols,
    csvDelimiter,
    timeoutMs: safeIntFlag(flagValue(args, '--timeout'), DEFAULT_TIMEOUT_MS),
    stallMs: safeIntFlag(flagValue(args, '--stall'), DEFAULT_STALL_MS),
    timeBudgetSec: safeIntFlag(flagValue(args, '--time-budget'), 0),
    resumeToken: flagValue(args, '--resume-token') ? String(flagValue(args, '--resume-token')) : null,
    checkpointEvery: safeIntFlag(flagValue(args, '--checkpoint-every'), DEFAULT_CHECKPOINT_EVERY),
    // --fresh exists because a cursor is sticky: without it, a run that needs to
    // start over from the top would have to remember to delete the file by hand,
    // and the default (resume) would quietly skip rows the caller wanted again.
    fresh: hasFlag(args, '--fresh'),
    strict: hasFlag(args, '--strict'),
    quiet: hasFlag(args, '--quiet'),
  };
}

// ── source opening ──────────────────────────────────────────────────────────

/** Does this look like a URL rather than a path? */
function isRemote(source) {
  return /^https?:\/\//i.test(source);
}

/**
 * Does this source carry SOME scheme, i.e. is it a URL that is not http(s)?
 *
 * Without this, `file:///etc/passwd` simply failed the `isRemote` test, fell
 * through to the local resolver, and reported `no such file:
 * /checkout/file:/etc/passwd` — a safe outcome reached by accident, with a
 * message that describes a missing file rather than a rejected scheme. Naming it
 * is the difference between a caller fixing its argument and a caller filing a
 * bug about a file that was never missing.
 *
 * @param {string} source
 * @returns {boolean}
 */
function hasNonHttpScheme(source) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(source) && !isRemote(source);
}

/**
 * Peek at a remote source's first bytes to auto-detect the format.
 *
 * Deliberately ranged rather than a full GET: a 400 MB feed answers a probe
 * that reads 4 KB and closes the connection. Returns null on any doubt, and the
 * caller falls back to the declared format.
 *
 * @param {string} url
 * @returns {Promise<string|null>} 'json-array' | null
 */
async function probeRemoteFormat(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'user-agent': DEFAULT_USER_AGENT, range: `bytes=0-${PROBE_BYTES - 1}`, accept: '*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const { value } = await reader.read();
    await reader.cancel().catch(() => {});
    const head = Buffer.from(value ?? '').toString('utf8').trimStart();
    return head.startsWith('[') ? 'json-array' : null;
  } catch {
    return null; // probe is an optimization; never fatal
  }
}

/**
 * Open a remote source as a Node Readable, validating every redirect hop.
 *
 * The manual redirect walk is the security-relevant part. `redirect: 'follow'`
 * would let a 302 point the fetch at an internal address and follow it in one
 * step, so the host guard below would only ever have seen the ORIGINAL url —
 * exactly the gap browser-extract.mjs documents closing with a per-request
 * `context.route` guard. Re-validating each `Location` keeps the guard
 * meaningful for the whole chain.
 *
 * The final URL and cache validators are returned as well as the stream: the
 * resume cursor binds to them (see `feedIdentity`), and there is nowhere else in
 * the flow to obtain them.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{stream: Readable, finalUrl: string, etag: string, lastModified: string}>}
 */
async function openRemote(url, timeoutMs) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const guard = rejectPrivateOrInvalid(current);
    if (guard) throw new Error(`${guard.reason} (${guard.code}): ${current}`);

    const res = await fetch(current, {
      headers: { 'user-agent': DEFAULT_USER_AGENT, accept: '*/*' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`${res.status} with no Location header: ${current}`);
      // Resolve relative to the CURRENT url so a chain of relative redirects
      // lands on the right host, then re-validate on the next iteration.
      current = new URL(loc, current).href;
      continue;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim() + `: ${current}`);
    if (!res.body) throw new Error(`empty response body: ${current}`);

    return {
      stream: Readable.fromWeb(res.body),
      finalUrl: current,
      etag: res.headers.get('etag') || '',
      lastModified: res.headers.get('last-modified') || '',
    };
  }
  throw new Error(`too many redirects (>${MAX_REDIRECTS}) starting at ${url}`);
}

/**
 * Open a local file as a Node Readable.
 *
 * Existence is checked here rather than letting `createReadStream` emit its own
 * ENOENT asynchronously: an async stream error surfaces as an unhandled
 * 'error' event long after the caller stopped looking, and the message names a
 * bare errno with no path context.
 *
 * @param {string} path
 * @returns {Promise<Readable>}
 */
async function openLocal(path) {
  const abs = path;
  if (!existsSync(abs)) throw new Error(`no such file: ${abs}`);
  const st = statSync(abs);
  if (st.isDirectory()) throw new Error(`is a directory, not a file: ${abs}`);
  return createReadStream(abs, { encoding: 'utf8' });
}

// ── the run ─────────────────────────────────────────────────────────────────

/**
 * Per-run counters, reported to stderr at the end.
 *
 * `emitted` and `rejected` are tracked separately rather than derived from a
 * total, so an interrupted run is distinguishable from a complete one: the caller
 * gets `interrupted: true` alongside partial counts instead of a number that
 * looks complete.
 */
function newStats() {
  // `consumed` is the SOURCE-position counter the cursor resumes from, and it is
  // deliberately NOT `emitted + rejected`. Those are outcomes; this is a
  // position. Conflating them resumes at the wrong row the first time a run has
  // a single reject, and silently drops a record from the middle of the feed.
  return { consumed: 0, emitted: 0, rejected: 0, bytes: 0, resumedFrom: 0, interrupted: false, timedOut: false, reason: null, firstReject: null };
}

// Abort hook for the active run, so a SIGNAL can unwind through the normal
// path. Set inside processFeed while the race is armed, cleared when it settles.
let activeAbort = null;
// Set when a signal ended the run, so the signal's 128+n code survives `main()`
// returning an ordinary interruption code for the same event.
let signalExitCode = null;

export class FeedAbort extends Error {
  constructor(message) {
    super(message);
    this.name = 'FeedAbort';
  }
}

/**
 * Run the whole thing.
 *
 * @param {ReturnType<typeof parseArgs>} cfg
 * @returns {Promise<{stats: ReturnType<typeof newStats>, exitCode: number}>}
 */
export async function processFeed(cfg) {
  const stats = newStats();
  const requirePaths = cfg.require;
  let ledger = null;

  const fail = (msg) => {
    throw new FeedAbort(msg);
  };

  try {
    if (!cfg.source) fail('no source given (need a file path or an http(s) URL)');
    // http(s) and local paths only. Anything else carrying a scheme is refused
    // by name rather than misread as a relative path.
    if (hasNonHttpScheme(cfg.source)) {
      fail(`unsupported scheme in "${cfg.source}" — only http(s) URLs and local file paths are supported`);
    }

    const remote = isRemote(cfg.source);

    // Format: explicit wins; otherwise auto-detect the one unambiguous case.
    let format = cfg.format;
    if (format && !FORMATS.includes(format)) {
      fail(`unknown --format "${format}" (expected one of: ${FORMATS.join(', ')})`);
    }
    if (!format) {
      const detected = remote
        ? await probeRemoteFormat(cfg.source)
        : await probeLocalFormat(resolve(getCareerOpsRoot(), cfg.source));
      format = detected || 'ndjson';
    }

    // ── ledger ────────────────────────────────────────────────────────────
    if (cfg.ledgerCols.length && !cfg.ledger) {
      // A columns list with no destination is a silently-dropped request, so
      // pick the obvious one rather than accepting the flag and doing nothing.
      cfg = { ...cfg, ledger: join(getCareerOpsRoot(), 'data', 'feed-meta.tsv') };
    }
    if (cfg.ledger) {
      const path = resolve(getCareerOpsRoot(), cfg.ledger);
      // Header is written only for a NEW file. An existing ledger is data the
      // user already has; prepending a header to it would corrupt row 1 on the
      // next parse.
      const isNew = !existsSync(path) || statSync(path).size === 0;
      ledger = { path, cols: cfg.ledgerCols };
      if (isNew) {
        const header = cfg.ledgerCols.length
          ? `${['emitted_at', 'index', ...cfg.ledgerCols].join('\t')}\n`
          : 'emitted_at\tindex\tpayload\n';
        writeFileSync(path, header, 'utf8');
      }
    }

    // ── source ────────────────────────────────────────────────────────────
    // Declared before the source block because the cursor block below ASSIGNS
    // them, and `let` is in its temporal dead zone until this line — declaring
    // them alongside the loop state further down would throw a ReferenceError
    // on the first run that passes --resume-token.
    let resumeFrom = 0;
    let identity = null;
    let cursorPath = null;
    let sinceCheckpoint = 0;

    // The SSRF guard runs here, on the way to opening, BEFORE any cursor is
    // consulted. A cursor must never be able to stand in for a network check:
    // the fast-forward skip below changes how many rows are read, not which
    // hosts are permitted.
    const localPath = remote ? null : resolve(getCareerOpsRoot(), cfg.source);
    const opened = remote
      ? await openRemote(cfg.source, cfg.timeoutMs)
      : { stream: await openLocal(localPath) };
    const stream = opened.stream;

    // ── resume cursor ──────────────────────────────────────────────────────
    // Resolved after opening, because the identity of a URL includes the
    // post-redirect URL and the ETag, and neither exists before the request.
    if (cfg.resumeToken) {
      cursorPath = resolve(getCareerOpsRoot(), cfg.resumeToken);
      // Assigns the OUTER `identity` (declared above the source block) rather
      // than shadowing it with a `const` — the shadowed copy would be used for
      // the comparison here and discarded, leaving every persisted cursor with
      // `"source": null`, which then matches nothing on the next resume and so
      // refused every subsequent run.
      identity = remote
        ? feedIdentity(cfg.source, {
            remote: true,
            finalUrl: opened.finalUrl,
            etag: opened.etag,
            lastModified: opened.lastModified,
          })
        : feedIdentity(localPath, {
            remote: false,
            size: statSync(localPath).size,
            mtimeMs: statSync(localPath).mtimeMs,
          });

      if (cfg.fresh) {
        if (!cfg.quiet) console.error(`stream-feed-processor: --fresh — ignoring any existing cursor at ${cursorPath}`);
      } else {
        const { cursor, warning } = loadCheckpoint(cursorPath);
        if (warning && !cfg.quiet) console.error(`stream-feed-processor: ${warning}`);
        const verdict = cursorMatches(cursor, identity);
        if (!verdict.ok) {
          // Refuse rather than reset. Starting over would re-emit every row to
          // an appending consumer (duplicates); resuming anyway would skip past
          // a region whose ordinals no longer mean what they meant. Both are
          // wrong, and only one of them is visible, so this exits 1 and says how
          // to proceed.
          stream.destroy?.();
          throw new FeedAbort(
            `cursor does not match this source: ${verdict.reason}. ` +
            'Delete the cursor to start over, or pass --fresh.',
          );
        }
        const baseline = Number(cursor?.position?.consumed ?? 0);
        if (Number.isFinite(baseline) && baseline > 0) {
          resumeFrom = Math.floor(baseline);
          stats.resumedFrom = resumeFrom;
          if (!cfg.quiet) console.error(`stream-feed-processor: resuming ${cursorPath} — skipping the first ${resumeFrom} source row(s)`);
        }
      }
    }

    const position = () => ({ consumed: stats.consumed, emitted: stats.emitted, rejected: stats.rejected });

    // The readline interface wrapping the source. Published so the stall/abort
    // path can release it — see the stall guard for why relying on the
    // underlying stream's destroy() is not enough.
    let lineReader = null;

    // ── fast-forward ───────────────────────────────────────────────────────
    /**
     * Account for one source row and report whether it is still inside the
     * already-processed prefix.
     *
     * This is the whole of the fast-forward. The row is counted and DISCARDED
     * before any JSON.parse, before validateRecord, before serialization and
     * before the ledger — so a resumed run pays only the line split for the
     * prefix, not the parse and validation it is skipping precisely because
     * those results are already recorded. Memory is unaffected: nothing is
     * accumulated for a skipped row, which is why resume does not weaken the
     * bounded-memory property.
     */
    const shouldSkip = () => {
      stats.consumed++;
      if (stats.consumed > resumeFrom) {
        sinceCheckpoint++;
        return false;
      }
      return true;
    };

    /** Persist the cursor every N rows, so a hard kill rewinds at most N. */
    const maybeCheckpoint = () => {
      if (!cursorPath || !cfg.checkpointEvery) return;
      if (sinceCheckpoint >= cfg.checkpointEvery) {
        saveCheckpoint(cursorPath, identity, position());
        sinceCheckpoint = 0;
      }
    };

    // ── the emit funnel ───────────────────────────────────────────────────
    // One place where a parsed record becomes output. Every per-record failure
    // path ends here, which is what keeps "a corrupt row cannot kill the run" a
    // property of the structure rather than of every caller's diligence.
    let ledgerRows = '';
    const emit = async (rec) => {
      const bad = validateRecord(rec, requirePaths);
      if (bad.length) {
        stats.rejected++;
        if (!stats.firstReject) stats.firstReject = { index: stats.emitted + stats.rejected, missing: bad };
        if (cfg.strict) fail(`--strict: record ${stats.emitted + stats.rejected} missing required field(s): ${bad.join(', ')}`);
        return;
      }
      // Serialize once and reuse: the string goes to stdout AND the ledger, and
      // stringifying twice on every record of a large feed is pure waste.
      const line = JSON.stringify(rec);
      await writeOut(`${line}\n`);
      stats.emitted++;

      if (ledger) {
        const cells = ledger.cols.length
          ? ledger.cols.map((p) => tsvCell(getPath(rec, p)))
          : [line.replace(/[\t\r\n]+/g, ' ')];
        ledgerRows += `${new Date().toISOString()}\t${stats.emitted}\t${cells.join('\t')}\n`;
        // Flushed per record rather than at the end so a killed worker still
        // leaves a readable ledger — the same partial-progress property stdout
        // has. Bounded because it resets every flush.
        if (ledgerRows.length > 64 * 1024) {
          appendFileSync(ledger.path, ledgerRows, 'utf8');
          ledgerRows = '';
        }
      }

      if (cfg.limit && stats.emitted >= cfg.limit) fail(`--limit ${cfg.limit} reached`);
    };

    // ── per-record dispatch ───────────────────────────────────────────────
    /**
     * Validate and emit a record that is ALREADY an object.
     *
     * Split out from `handleRecord` so the CSV path — which builds its object
     * from a header row instead of parsing JSON — reaches the same structural
     * check, the same `--require` validation and the same funnel. Routing a CSV
     * record back through `JSON.parse` (by stringifying it first) failed with
     * `"[object Object]" is not valid JSON` on every single row, so CSV emitted
     * nothing and reported two rejects; one funnel, three front doors.
     */
    const handleObject = async (rec, where) => {
      const structural = structuralReject(rec);
      if (structural) {
        stats.rejected++;
        if (!stats.firstReject) stats.firstReject = { index: stats.emitted + stats.rejected, error: `invalid record at ${where}: ${structural}` };
        if (cfg.strict) fail(`--strict: invalid record at ${where}: ${structural}`);
        return;
      }
      await emit(rec);
    };

    /** Parse one text chunk into a record and route it through the funnel. */
    const handleRecord = async (text, where) => {
      const trimmed = String(text).trim();
      if (!trimmed) return; // blank separator line, not an error
      let rec;
      try {
        rec = JSON.parse(trimmed);
      } catch (err) {
        // The error boundary the task is really about: one unparseable line is
        // a DATA defect, not a PROCESS defect. It is counted and reported and
        // the stream continues — the alternative loses every subsequent record
        // to one bad byte.
        stats.rejected++;
        if (!stats.firstReject) stats.firstReject = { index: stats.emitted + stats.rejected, error: `parse error at ${where}: ${err.message}` };
        if (cfg.strict) fail(`--strict: parse error at ${where}: ${err.message}`);
        return;
      }
      await handleObject(rec, where);
    };

    /** Wire a Readable up to either the line reader or the value splitter. */
    const runStream = async () => {
      if (format === 'ndjson' || format === 'csv') {
        let header = null;
        let lineNo = 0;
        const rl = createInterface({ input: stream, crlfDelay: Infinity });
        lineReader = rl; // published so an abort can release its handle
        for await (const line of rl) {
          kick(); // the consumer is alive; reset the stall clock
          lineNo++;
          stats.bytes += line.length;
          // The fast-forward. Counted BEFORE the size guard and before any
          // parse, so the skipped prefix costs a line split and nothing else —
          // and a row too long to buffer is a property of the prefix we already
          // processed, not a reason to abort the rows we have not.
          if (shouldSkip()) continue;
          if (line.length > MAX_LINE_BYTES) {
            stats.rejected++;
            if (cfg.strict) fail(`--strict: line ${lineNo} exceeds ${MAX_LINE_BYTES} bytes`);
            continue;
          }
          if (format === 'ndjson') {
            await handleRecord(line, `line ${lineNo}`);
          } else {
            // The first CSV line is the header; every later line becomes an
            // object keyed by it, so a --require on `title` works the same way
            // it does for a JSON feed.
            if (header === null) {
              header = parseCsvRecord(line, cfg.csvDelimiter).map((h) => h.trim());
              continue;
            }
            const vals = parseCsvRecord(line, cfg.csvDelimiter);
            const rec = {};
            header.forEach((h, i) => { rec[h] = vals[i] ?? ''; });
            await handleObject(rec, `line ${lineNo}`);
          }
          maybeCheckpoint();
          if (stats.interrupted) break;
        }
        return;
      }

      const splitter = createValueSplitter(format);
      stream.setEncoding('utf8');
      for await (const chunk of stream) {
        kick();
        stats.bytes += chunk.length;
        for (const text of splitter.push(chunk)) {
          // Same accounting as the line branch, keyed on VALUES rather than
          // lines: a cursor written from a json-array run counts elements, so a
          // cursor carried over to a json-array resume must count them too or it
          // fast-forwards to the wrong element.
          if (shouldSkip()) continue;
          await handleRecord(text, 'stream');
          maybeCheckpoint();
        }
        if (stats.interrupted) break;
      }
      // Flush a trailing value that never got its closing delimiter.
      if (!splitter.done) {
        for (const text of splitter.end()) await handleRecord(text, 'trailing');
      }
    };

    // ── stall guard ───────────────────────────────────────────────────────
    // A timer that fires only when the source goes quiet. Without it, a feed
    // that holds the connection open without sending — or a half-open TCP
    // connection, or a FIFO whose writer never writes — hangs until the
    // worker's wall clock kills it, losing the partial results AND the exit
    // code. Measured on a FIFO held open by an idle writer: the guard has to
    // interrupt the read, and this is how.
    //
    // Reset from INSIDE the consumption loop, via kick(), rather than from a
    // `stream.on('data')` listener. Registering a 'data' handler puts a Readable
    // into flowing mode, and flowing mode is a second, independent consumer:
    // chunks arriving before the `for await` iterator attaches go to that
    // listener and never reach the iterator. That silently dropped the opening
    // bytes of every remote feed — for `--format json-array` the leading `[` was
    // among them, so auto-detection could not fire and the run reported zero
    // records. Liveness is observable at the point of consumption, so that is
    // where the clock is reset.
    //
    // The abort is a PROMISE RACE, not a `stream.destroy()`. Destroying the
    // source does not reliably interrupt `readline`'s async iterator: the
    // iterator stays parked on its internal line buffer and the process hangs
    // until something else kills it — which is precisely the failure the guard
    // exists to prevent, so a guard built on destroy() is worse than none. Racing
    // the read against a rejecting promise needs no cooperation from the reader.
    // The destroy + rl.close() alongside it are still worth doing, but only to
    // RELEASE the file descriptor — not to cause the exit.
    let stallTimer = null;
    let stall = null;
    let rejectStall = null;
    const stallSignal = new Promise((_, rej) => { rejectStall = rej; });
    // Marked handled immediately: if the run finishes first, this rejection has
    // no awaiter and would otherwise be an unhandled rejection that kills the
    // process on the way out.
    stallSignal.catch(() => {});

    const disarm = () => { if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; } };
    const releaseSource = () => {
      lineReader?.close();
      lineReader = null;
      stream.destroy?.();
    };
    const arm = () => {
      if (!cfg.stallMs) return;
      disarm();
      stallTimer = setTimeout(() => {
        stall = new Error(`no data for ${cfg.stallMs}ms — treating the source as dead`);
        rejectStall(stall);
        releaseSource();
      }, cfg.stallMs);
      stallTimer.unref?.();
    };
    const kick = () => { if (!stall) arm(); };
    arm();

    // Publish an abort that resolves the race with a FeedAbort, so a SIGTERM
    // unwinds through the ordinary `finally` — flushing the ledger AND writing
    // the cursor at the exact position reached. A signal handler that called
    // `process.exit()` directly would skip that entirely: exit does not unwind
    // the stack, so the `finally` never runs and the whole point of the handler
    // is lost.
    activeAbort = (reason, { timedOut = false } = {}) => {
      stall = new Error(reason);
      if (timedOut) stats.timedOut = true;
      releaseSource();
      rejectStall(new FeedAbort(reason));
    };

    // Self-imposed deadline, unwinding through the SAME abort path as SIGTERM.
    //
    // Deliberately in-process rather than left to an external watchdog that sends
    // SIGTERM. A shell wrapper has to express "kill the child after N seconds"
    // as a background `sleep` plus a `kill`, and the `sleep` is a grandchild it
    // cannot signal: `kill` on the subshell reaps the subshell and orphans the
    // sleep, which then holds the caller's stdout open for the rest of the budget.
    // A consumer that pipes this runner sees it hang after the feed is finished.
    // Arming the clock here means the timer is a handle we own and always
    // disarm, and the budget arrives as the exit code a caller already knows.
    let budgetTimer = null;
    if (cfg.timeBudgetSec > 0) {
      budgetTimer = setTimeout(() => {
        activeAbort(`time budget of ${cfg.timeBudgetSec}s reached — run stopped early, cursor written`, { timedOut: true });
      }, cfg.timeBudgetSec * 1000);
      budgetTimer.unref?.();
    }

    try {
      await Promise.race([runStream(), stallSignal]);
    } catch (err) {
      if (err instanceof FeedAbort) {
        stats.interrupted = true;
        stats.reason = err.message;
      } else if (stall) {
        // The rejection above, surfaced here. An interruption of an
        // otherwise-working run, not corruption of what was already emitted.
        stats.interrupted = true;
        stats.reason = stall.message;
      } else {
        throw err;
      }
    } finally {
      activeAbort = null;
      if (budgetTimer) { clearTimeout(budgetTimer); budgetTimer = null; }
      disarm();
      releaseSource();
      // Drained in `finally`, not on the success path: the ledger must reflect
      // a killed run too, and appendFileSync on a closed handle would throw
      // and mask the original error.
      if (ledger && ledgerRows) appendFileSync(ledger.path, ledgerRows, 'utf8');
      // Same reasoning for the cursor, and it is the one write that matters most
      // on a truncated run: a worker stopped by its wall clock should leave
      // behind the exact position it reached, so the next run resumes there
      // instead of redoing the whole feed. Unconditional here rather than gated
      // on `sinceCheckpoint`, so an interrupted run lands on its true position
      // even when it died between checkpoint intervals.
      if (cursorPath) saveCheckpoint(cursorPath, identity, position());
    }

    if (ledger && ledgerRows) ledgerRows = '';

    // ── exit code ─────────────────────────────────────────────────────────
    // A run that stopped early is a DIFFERENT outcome from one that read its
    // source to the end, even if the same number of rows came out. Reporting
    // them with the same code is what makes a truncated feed look like a
    // successful short feed.
    // A self-imposed budget is reported as 143 — the same code an external
    // SIGTERM produces, and the one a resume loop keys on. 1 would read as fatal
    // and stop the loop, which is the opposite of the intent: the run is NOT over,
    // it is chunked. Kept distinct from --limit, which is a deliberate caller stop.
    if (stats.timedOut) return { stats, exitCode: 143 };
    if (stats.interrupted && !/^--limit /.test(stats.reason ?? '')) return { stats, exitCode: 1 };
    return { stats, exitCode: stats.rejected > 0 ? 2 : 0 };

  } catch (err) {
    if (err instanceof FeedAbort) {
      stats.interrupted = true;
      stats.reason = err.message;
      if (!cfg.quiet) console.error(`stream-feed-processor: ${err.message}`);
      return { stats, exitCode: 1 };
    }
    throw err;
  }
}

/** One --help line of the summary. Kept on stderr: stdout must stay parseable. */
function summarize(cfg, stats, elapsedMs) {
  const parts = [
    `emitted=${stats.emitted}`,
    `rejected=${stats.rejected}`,
    `bytes=${stats.bytes}`,
    `${elapsedMs}ms`,
  ];
  // `consumed` is reported whenever a cursor is in play, because it is the
  // number the NEXT resume will key on. An operator looking at a truncated run
  // needs to know where it stopped, and `emitted` is not that number when any
  // row was rejected.
  if (cfg.resumeToken) {
    parts.push(`consumed=${stats.consumed}`);
    if (stats.resumedFrom) parts.push(`resumed-from=${stats.resumedFrom}`);
  }
  if (stats.interrupted) parts.push(`INTERRUPTED (${stats.reason})`);
  if (stats.firstReject) {
    const r = stats.firstReject;
    console.error(`stream-feed-processor: first reject #${r.index}: ${r.error || `missing required field(s): ${(r.missing || []).join(', ')}`}`);
  }
  console.error(`stream-feed-processor: ${cfg.source} — ${parts.join(' ')}`);
}

/** CLI tail. Runs only when this file is the process entry. */
export async function main(argv = process.argv.slice(2)) {
  // requireOperand: `--limit --strict` is a malformed invocation, and letting it
  // fall through would silently run unbounded — the exact "proceeded with the
  // wrong setting and reported success" shape lib/cli-flags.mjs was written for.
  validateFlags(argv, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });

  const cfg = parseArgs(argv);
  if (!cfg.source) {
    // Not the first line of USAGE: that is the bare word "Usage:", which as a
    // message reads as a bug rather than as "you forgot the operand".
    console.error(JSON.stringify({
      error: `no source given — pass a file path or an http(s) URL. Usage: node scripts/stream-feed-processor.mjs <path-or-url> [options]`,
      code: 'no_source',
    }));
    return 1;
  }

  const started = Date.now();
  try {
    const { stats, exitCode } = await processFeed(cfg);
    if (!cfg.quiet) summarize(cfg, stats, Date.now() - started);
    return exitCode;
  } catch (err) {
    // A fatal the funnel did not classify: unreadable file, HTTP error, bad
    // format. JSON on stderr so a machine-reading caller can parse it, and exit
    // 1 — a run that produced nothing must never look like a clean run.
    console.error(JSON.stringify({ error: String(err?.message ?? err), code: 'fatal', source: cfg.source }));
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  // A consumer that stops reading — `| head -5`, or `| jq` exiting on a bad
  // line — closes the pipe, and the next write fails with EPIPE. Node surfaces
  // that as an unhandled 'error' EVENT, which is fatal and prints a stack trace
  // naming writeOut and emit, so the most ordinary way to use a streaming tool
  // produced a wall of noise on stderr and exit 1 that read like a crash.
  //
  // Early consumer exit is not a failure of this run: the records it wanted were
  // delivered. EPIPE is therefore swallowed and the process exits 0. Every other
  // stdout error still propagates, because a real write failure (ENOSPC, a closed
  // terminal) is a genuine fault and must not be hidden.
  process.stdout.on('error', (err) => {
    if (err && err.code === 'EPIPE') process.exit(0);
    throw err;
  });

  // SIGTERM/SIGINT abort the run so it unwinds through its own cleanup.
  //
  // This is what makes resume exact under a wall-clock budget rather than
  // approximate. A worker stopped by a scheduler sends SIGTERM, so that is the
  // NORMAL way a truncated run ends. Handling it by calling `process.exit()` here
  // would be worse than not handling it at all: exit does not unwind the stack,
  // so the `finally` that flushes the ledger and writes the cursor would never
  // run, and the cursor would be stuck at whatever `--checkpoint-every` last
  // reached — rewinding up to 100 rows into an appending consumer. Routing
  // through `activeAbort` instead runs that `finally`, and the cursor lands on
  // the true position.
  //
  // The exit code follows the 128+signal convention so a supervisor reading a
  // code rather than a signal can still tell this was a termination.
  const onSignal = (sig) => {
    const code = 128 + (sig === 'SIGINT' ? 2 : 15);
    process.stderr.write(`stream-feed-processor: ${sig} — flushing cursor before exit\n`);
    if (activeAbort) {
      activeAbort(`${sig} received — run stopped early, cursor written`);
      // main() classifies this as an ordinary interruption and returns 1; the
      // signal is the more precise description and must not be overwritten by it.
      signalExitCode = code;
      return;
    }
    process.exit(code);
  };
  process.once('SIGTERM', () => onSignal('SIGTERM'));
  process.once('SIGINT', () => onSignal('SIGINT'));

  main().then((code) => {
    // One source of truth for the final code. A signal sets signalExitCode
    // while main() is still unwinding, and main() then classifies the same
    // event as an ordinary interruption (1) — so the signal code has to win
    // here, AND the flush barrier below must exit with the RESOLVED value rather
    // than with the stale `code` parameter, which is what made a SIGTERM'd run
    // report 1 instead of 143.
    const finalCode = signalExitCode ?? code;
    process.exitCode = finalCode;

    // Exit explicitly once stdout has actually flushed, rather than waiting for
    // the event loop to drain on its own.
    //
    // A blocked read cannot always be cancelled: `stream.destroy()` does not
    // interrupt an in-flight `read()` on a FIFO or a pipe, so the kernel request
    // stays outstanding forever. Measured on a FIFO held open by an idle writer
    // — `main()` had returned, the summary had printed, the exit code was set,
    // and the process still sat there until something external killed it. That
    // is the exact shape this script exists to avoid: a batch worker that has
    // finished its work but never returns.
    //
    // The trailing zero-length write's callback is the flush barrier — it queues
    // behind any buffered records, so this cannot truncate the last line. Not a
    // general-purpose force-exit: it only runs on the resolved path, after the
    // funnel has finished and stderr has been written.
    process.stdout.write('', () => process.exit(finalCode));
  });
}
