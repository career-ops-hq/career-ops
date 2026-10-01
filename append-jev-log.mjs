#!/usr/bin/env node
/**
 * append-jev-log.mjs — append-only Jev triage ledger (data/jev-runs.tsv).
 *
 * WHY THIS EXISTS
 *   The Jev pre-pass score was observable only inside the request: it reached
 *   the run prompt (buildPrompt's `jevPrior`) and a `status` NDJSON event on
 *   the stream, then vanished with the response. Nothing persisted it, so there
 *   was no way to answer "is the calibrated band behaving?" after the fact —
 *   the only place a score had ever been read back was a live process argv.
 *   This makes every System 1 triage decision durable.
 *
 * Root level, NOT scripts/: the web layer reaches core scripts through
 * runCoreScript() -> rootScript() (web/src/lib/career-ops.ts:27-29), which
 * resolves `<careerOpsRoot>/<name>.mjs` and nothing else. A file under scripts/
 * would be unreachable from the pdf/evaluate lanes.
 *
 * CONTRACT
 *   timestamp \t id \t score \t band \t wallMs \n
 *   `score` is the numeric ATS prior; when the gate could not answer, score is
 *   emitted EMPTY and band is "unavailable" — the refusal is itself the signal
 *   worth recording, so it gets a row rather than a gap.
 *
 * LOCK DISCIPLINE — a deliberate mirror of append-gate3-log.mjs: same
 * acquireTrackerLock/trackerLockDirFor pairing, same env-var timeout/retry/
 * stale defaults, same release-in-finally, same advisory exit-code contract.
 * One definition each, no drift.
 *
 * FAIL-OPEN BY CONSTRUCTION
 *   This runs while the request is still being served, before the CLI child is
 *   even spawned. A failed append must never delay or fail a run, so every
 *   failure path warns and still exits 0. Exit codes are reserved for a genuine
 *   lock timeout (4, matching set-status.mjs) and a usage error (2).
 *
 * Usage:
 *   node append-jev-log.mjs <id> <score> <band> [wallMs]
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { acquireTrackerLock, trackerLockDirFor, resolveTrackerPath } from './tracker-utils.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_LOCK_TIMEOUT = 4;

/**
 * Flatten a field to a single TSV cell. Identical contract to append-gate3-log's
 * `tsv()` — a tab or newline would forge an extra column/row and corrupt the
 * very join key this ledger is read by.
 */
function tsv(value, max = 300) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

/** ISO-8601 with a local offset, so rows sort and read unambiguously. */
function stamp(date = new Date()) {
  const pad = (n, w = 2) => String(Math.abs(n)).padStart(w, '0');
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(off / 60 | 0)}:${pad(off % 60)}`;
}

/** Ledger path: a SIBLING of the tracker, so CAREER_OPS_TRACKER relocates it too. */
export function jevLogPath() {
  try {
    return join(dirname(resolveTrackerPath()), 'jev-runs.tsv');
  } catch {
    return join(getCareerOpsRoot(), 'data', 'jev-runs.tsv');
  }
}

/** The header row, written once when the file is created. */
export const HEADER = 'timestamp\tid\tscore\tband\twallMs\n';

/**
 * Normalize the caller's score. A non-numeric / absent score is NOT an error —
 * it is the gate's own fail-open answer, recorded with an empty cell and an
 * explicit "unavailable" band.
 */
function normalizeScore(score, band) {
  const n = typeof score === "number" ? score : parseFloat(String(score ?? ""));
  if (Number.isFinite(n)) return { score: n.toFixed(2), band: tsv(band || "unknown", 20) };
  return { score: "", band: "unavailable" };
}

/** Append one Jev triage observation. Returns the path written; never throws. */
export async function appendJevLog({ id, score, band, wallMs }) {
  const logPath = jevLogPath();
  mkdirSync(dirname(logPath), { recursive: true });

  const lock = await acquireTrackerLock(trackerLockDirFor(logPath), {
    timeoutMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS) || 60_000,
    retryMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_RETRY_MS) || 75,
    staleMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_STALE_MS) || 10 * 60_000,
    tracker: logPath,
  });
  try {
    if (!existsSync(logPath)) appendFileSync(logPath, HEADER, 'utf-8');
    const s = normalizeScore(score, band);
    const ms = typeof wallMs === "number" && Number.isFinite(wallMs) ? String(Math.round(wallMs)) : "";
    appendFileSync(
      logPath,
      `${stamp()}\t${tsv(id, 60)}\t${s.score}\t${s.band}\t${ms}\n`,
      'utf-8',
    );
    return logPath;
  } finally {
    lock.release();
  }
}

async function main(argv = process.argv.slice(2)) {
  const [id, score, band, wallMs] = argv;

  if (!id || score === undefined) {
    console.error(
      'Usage: node append-jev-log.mjs <id> <score|-> <band> [wallMs]\n'
      + 'Pass "-" as the score to record an unavailable gate.\n'
      + 'Exits 0 on success AND on a failed append (advisory ledger); 4 on lock timeout; 2 on usage.',
    );
    return EXIT_USAGE;
  }

  try {
    const written = await appendJevLog({
      id,
      score: score === "-" || score === "" ? null : score,
      band: band === "unavailable" ? "" : band,
      wallMs: wallMs === undefined ? null : parseFloat(wallMs),
    });
    console.log(`jev: ${written}`);
    return EXIT_OK;
  } catch (err) {
    if (err?.code === 'LOCK_TIMEOUT') {
      console.error(`jev: lock timeout — ${err.message}`);
      return EXIT_LOCK_TIMEOUT;
    }
    // Advisory: the request is still waiting on its real work.
    console.error(`Warning: jev-runs append failed (the run itself is unaffected): ${err.message}`);
    return EXIT_OK;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main();
}