#!/usr/bin/env node
/**
 * followup-seed.mjs — Seed data/follow-ups.md when a row is marked Applied (#1430)
 *
 * WHY: the follow-up system was "born dead". Marking a tracker row Applied only
 * updated applications.md — data/follow-ups.md stayed empty until the user ran
 * the `followup` mode by hand and it happened to notice the row. In practice
 * that meant most applications never got a scheduled next-follow-up date at
 * all, silently defeating the entire cadence feature. This script closes that
 * gap: given an appNum (or --backfill for the whole tracker), it computes the
 * cadence-default next-follow-up date and writes it as a PIN DIRECTIVE line —
 * never a table row, because a table row in follow-ups.md means "a follow-up
 * was SENT", which seeding must not claim.
 *
 * Pin format (parsed by `parseNextOverrides` in followup-cadence.mjs):
 *   - next #<appNum> <YYYY-MM-DD> (set <YYYY-MM-DD>)
 * First date = seeded next-follow-up date. `(set …)` = the day the pin was
 * written. The LAST pin per application wins, so re-seeding with --force is
 * always safe — it just appends a fresh pin.
 *
 * Apply-date resolution order (see resolveAppliedDate): explicit --date, then
 * "Applied YYYY-MM-DD" in the row's notes, then today. The tracker's `date`
 * column is NEVER used as a fallback — it is usually the evaluation date, not
 * the date the application actually went out.
 *
 * Idempotency: by default, seeding a given appNum is a NO-OP FOREVER once
 * either a pin or a follow-up table row exists for it (exit 0, seeded:false).
 * Pass --force to append a fresh pin anyway.
 *
 * Usage:
 *   node followup-seed.mjs <appNum> [--date YYYY-MM-DD] [--force] [--dry-run] [--json]
 *   node followup-seed.mjs --backfill [--dry-run] [--json]
 *
 * Exit codes:
 *   0 success or idempotent no-op
 *   1 usage or validation error (incl. impossible --date, non-Applied row
 *     without --force, unknown flag)
 *   2 row not found (or tracker missing)
 *   4 lock timeout
 *
 * Env overrides (mirroring merge-tracker.mjs / followup-cadence.mjs):
 *   CAREER_OPS_TRACKER                     tracker path
 *   CAREER_OPS_FOLLOWUPS                   follow-ups path
 *   CAREER_OPS_PROFILE                     profile.yml path (cadence overrides)
 *   CAREER_OPS_FOLLOWUPS_LOCK              lock directory override
 *   CAREER_OPS_FOLLOWUPS_LOCK_TIMEOUT_MS   lock acquire timeout
 *   CAREER_OPS_FOLLOWUPS_LOCK_RETRY_MS     lock retry interval
 *   CAREER_OPS_FOLLOWUPS_LOCK_STALE_MS     stale-lock recovery threshold
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync, realpathSync } from 'fs';
import { join, dirname, basename, resolve, isAbsolute, relative, sep } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createHash, randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import {
  resolveCadenceConfig,
  normalizeStatus,
  parseAppliedDate,
  parseNextOverrides,
  parseDate,
  addDays,
} from './followup-cadence.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));

/** Canonical header written when data/follow-ups.md doesn't exist yet. */
export const FOLLOWUPS_HEADER = [
  '# Follow-ups',
  '',
  '| num | appNum | date | company | role | channel | contact | notes |',
  '|---|---|---|---|---|---|---|---|',
].join('\n');

const FOLLOWUPS_LOCK_PREFIX = 'career-ops-followups-';

/** Structured error carrying an exit-code-mapping `code`. */
export class SeedError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SeedError';
    this.code = code;
  }
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Validate a `YYYY-MM-DD` string is both well-formed AND a real calendar date.
 *
 * `parseDate` (followup-cadence.mjs) happily accepts `2026-02-31` because the
 * underlying `Date` constructor silently rolls invalid days over into the next
 * month. Round-tripping the parsed date back through `toISOString` catches
 * that: a real date always survives the round trip unchanged.
 *
 * @param {string} str
 * @returns {boolean}
 */
export function isValidCalendarDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = parseDate(str);
  if (!d || isNaN(d)) return false;
  return d.toISOString().slice(0, 10) === str;
}

/**
 * Resolve the date an application was actually submitted, in strict priority
 * order: explicit `--date` > "Applied YYYY-MM-DD" in the tracker row's notes >
 * today. The tracker's `date` column is never consulted — it is usually the
 * evaluation date, not the submission date (see followup-cadence.mjs).
 *
 * A notes date that isn't a real calendar date (e.g. "Applied 2026-02-31")
 * throws rather than falling through: `parseDate` would return null for it and
 * the pin would be written with a literal "null" next-date.
 *
 * @param {{num?: number, notes?: string}} row - Parsed tracker row (or any object with `notes`).
 * @param {string|null|undefined} explicitDate - `--date` value, already validated.
 * @returns {string} YYYY-MM-DD
 * @throws {SeedError} INVALID_DATE when the notes carry an impossible date.
 */
export function resolveAppliedDate(row, explicitDate) {
  if (explicitDate) return explicitDate;
  const notesDate = parseAppliedDate(row?.notes);
  if (notesDate) {
    if (!isValidCalendarDate(notesDate)) {
      throw new SeedError('INVALID_DATE', `Application #${row?.num ?? '?'} notes carry an impossible "Applied ${notesDate}" date; fix the notes or pass --date`);
    }
    return notesDate;
  }
  return todayStr();
}

/**
 * Format one pin directive line. The parser side lives in
 * followup-cadence.mjs's `OVERRIDE_RE` / `parseNextOverrides`.
 *
 * @param {number} appNum
 * @param {string} nextDate - YYYY-MM-DD
 * @param {string} setDate - YYYY-MM-DD
 * @returns {string}
 */
export function formatPinLine(appNum, nextDate, setDate) {
  return `- next #${appNum} ${nextDate} (set ${setDate})`;
}

// --- Path resolution (env override → option override → default) -----------

function resolveTrackerPath(override) {
  if (override) return override;
  if (process.env.CAREER_OPS_TRACKER) return process.env.CAREER_OPS_TRACKER;
  return existsSync(join(CAREER_OPS, 'data/applications.md'))
    ? join(CAREER_OPS, 'data/applications.md')
    : join(CAREER_OPS, 'applications.md');
}

function resolveFollowupsPath(override) {
  if (override) return override;
  if (process.env.CAREER_OPS_FOLLOWUPS) return process.env.CAREER_OPS_FOLLOWUPS;
  return join(CAREER_OPS, 'data/follow-ups.md');
}

function envInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// --- Tracker reading ---------------------------------------------------

function readTrackerRows(trackerPath) {
  const content = readFileSync(trackerPath, 'utf-8');
  const lines = content.split('\n');
  const colmap = resolveColumns(lines);
  const rows = [];
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (row) rows.push(row);
  }
  return rows;
}

// --- Idempotency: pin OR follow-up table row already exists for appNum ----

// Mirrors followup-cadence.mjs's parseFollowups: a `|`-delimited row whose 3rd
// cell (index 2 after split('|').map(trim) — index 0 is the empty cell before
// the leading pipe, index 1 is the follow-up's own `num`) is the appNum.
function hasFollowupTableRow(content, appNum) {
  for (const line of content.split('\n')) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 8) continue;
    const rowAppNum = parseInt(parts[2], 10);
    if (!isNaN(rowAppNum) && rowAppNum === appNum) return true;
  }
  return false;
}

function isAlreadySeeded(content, appNum) {
  if (!content) return false;
  if (parseNextOverrides(content).has(appNum)) return true;
  return hasFollowupTableRow(content, appNum);
}

// --- Locking (mirrors merge-tracker.mjs's tracker lock, scoped to follow-ups) --

function pathIsInside(childPath, parentDir) {
  const relativePath = relative(parentDir, childPath);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

function resolveFollowupsLockDir(envValue, lockKey) {
  const tmpRoot = realpathSync(tmpdir());
  const fallback = join(tmpRoot, `${FOLLOWUPS_LOCK_PREFIX}${lockKey}.lock`);
  if (!envValue || !isAbsolute(envValue)) return fallback;

  const candidate = resolve(envValue);
  const parentDir = dirname(candidate);
  const canonicalParent = existsSync(parentDir) ? realpathSync(parentDir) : resolve(parentDir);
  if (!pathIsInside(canonicalParent, tmpRoot)) return fallback;
  if (!basename(candidate).startsWith(FOLLOWUPS_LOCK_PREFIX)) return fallback;
  return candidate;
}

function resolveLockDir(explicitLockDir, followupsPath) {
  if (explicitLockDir) return explicitLockDir;
  const lockKey = createHash('sha256').update(followupsPath).digest('hex').slice(0, 16);
  return resolveFollowupsLockDir(process.env.CAREER_OPS_FOLLOWUPS_LOCK, lockKey);
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function readLockOwner(lockDir) {
  try {
    return JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf-8'));
  } catch {
    return null;
  }
}

function lockCanRecover(lockDir, staleMs) {
  const owner = readLockOwner(lockDir);
  if (owner?.pid) return !processIsAlive(owner.pid);
  try {
    return Date.now() - statSync(lockDir).mtimeMs > staleMs;
  } catch {
    return true;
  }
}

/**
 * Acquire an exclusive filesystem lock covering the read-check-append
 * critical section for data/follow-ups.md. Mirrors merge-tracker.mjs's
 * tracker lock: atomic `mkdirSync`, an `owner.json` with pid/timestamp,
 * pid-alive detection, stale-lock recovery, and retry/backoff.
 *
 * @param {string} lockDir
 * @param {string} followupsPath - Recorded in owner.json for diagnostics.
 * @param {{timeoutMs?: number, retryMs?: number, staleMs?: number}} [options]
 * @returns {Promise<{release: Function}>}
 */
async function acquireFollowupsLock(lockDir, followupsPath, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const retryMs = options.retryMs ?? 75;
  const staleMs = options.staleMs ?? 10 * 60_000;
  const recoverGuardDir = `${lockDir}.recover`;
  const token = randomUUID();
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({
        pid: process.pid,
        token,
        startedAt: new Date().toISOString(),
        followups: followupsPath,
      }, null, 2));

      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          const owner = readLockOwner(lockDir);
          if (owner?.token === token) {
            rmSync(lockDir, { recursive: true, force: true });
          }
        },
      };
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;

      let hasRecoverGuard = false;
      try {
        mkdirSync(recoverGuardDir);
        hasRecoverGuard = true;
      } catch (guardErr) {
        if (guardErr?.code !== 'EEXIST') throw guardErr;
      }

      if (hasRecoverGuard) {
        try {
          if (lockCanRecover(lockDir, staleMs)) {
            rmSync(lockDir, { recursive: true, force: true });
            continue;
          }
        } finally {
          rmSync(recoverGuardDir, { recursive: true, force: true });
        }
      }

      await sleep(retryMs);
    }
  }

  throw new SeedError('LOCK_TIMEOUT', `Timed out waiting for follow-ups lock at ${lockDir}`);
}

// --- Atomic write (mirrors writeFileAtomic in tracker.mjs / merge-tracker.mjs) --

function writeFileAtomic(filePath, content) {
  const tmpPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, filePath);
  } catch (err) {
    rmSync(tmpPath, { force: true });
    throw err;
  }
}

function appendPins(existingContent, pinLines) {
  const joined = pinLines.join('\n');
  if (existingContent == null) {
    return `${FOLLOWUPS_HEADER}\n${joined}\n`;
  }
  return existingContent + (existingContent.endsWith('\n') ? '' : '\n') + joined + '\n';
}

// --- Core: seed one application --------------------------------------------

/**
 * Seed data/follow-ups.md with a pin directive for one Applied application.
 *
 * Silent-no-op-forever by default: once a pin or a follow-up table row exists
 * for `appNum`, subsequent calls return `{seeded:false, reason:'already-seeded'}`
 * without touching the file, unless `options.force` is set.
 *
 * @param {number} appNum
 * @param {object} [options]
 * @param {string} [options.date] - Explicit apply date (YYYY-MM-DD), already validated.
 * @param {boolean} [options.force] - Bypass idempotency guard and the Applied-status guard.
 * @param {boolean} [options.dryRun] - Compute and report, but write nothing (no lock taken).
 * @param {string} [options.trackerPath]
 * @param {string} [options.followupsPath]
 * @param {string} [options.profilePath]
 * @param {string} [options.lockDir]
 * @param {number} [options.lockTimeoutMs]
 * @param {number} [options.lockRetryMs]
 * @param {number} [options.lockStaleMs]
 * @returns {Promise<object>}
 */
export async function seedFollowup(appNum, options = {}) {
  if (!Number.isInteger(appNum) || appNum <= 0) {
    throw new SeedError('USAGE', `Invalid appNum: ${appNum}`);
  }
  if (options.date != null && !isValidCalendarDate(options.date)) {
    throw new SeedError('INVALID_DATE', `--date must be a real calendar date in YYYY-MM-DD form: ${options.date}`);
  }

  const trackerPath = resolveTrackerPath(options.trackerPath);
  const followupsPath = resolveFollowupsPath(options.followupsPath);

  if (!existsSync(trackerPath)) {
    throw new SeedError('ROW_NOT_FOUND', `Tracker not found at ${trackerPath}`);
  }
  const rows = readTrackerRows(trackerPath);
  const row = rows.find(r => r.num === appNum);
  if (!row) {
    throw new SeedError('ROW_NOT_FOUND', `Application #${appNum} not found in ${trackerPath}`);
  }

  const normalized = normalizeStatus(row.status);
  if (normalized !== 'applied' && !options.force) {
    throw new SeedError('NOT_APPLIED', `Application #${appNum} is not Applied (status: "${row.status.trim()}"); use --force to seed anyway`);
  }

  const appliedDate = resolveAppliedDate(row, options.date);
  const cadence = resolveCadenceConfig({ profilePath: options.profilePath });
  const nextDate = addDays(parseDate(appliedDate), cadence.applied_first);
  const setDate = todayStr();
  const pin = formatPinLine(appNum, nextDate, setDate);

  if (options.dryRun) {
    const existingContent = existsSync(followupsPath) ? readFileSync(followupsPath, 'utf-8') : '';
    if (isAlreadySeeded(existingContent, appNum) && !options.force) {
      return { seeded: false, appNum, pin: null, nextDate, appliedDate, setDate, reason: 'already-seeded', dryRun: true };
    }
    return { seeded: true, appNum, pin, nextDate, appliedDate, setDate, dryRun: true };
  }

  const lockDir = resolveLockDir(options.lockDir, followupsPath);
  const lock = await acquireFollowupsLock(lockDir, followupsPath, {
    timeoutMs: options.lockTimeoutMs ?? envInt('CAREER_OPS_FOLLOWUPS_LOCK_TIMEOUT_MS', 60_000),
    retryMs: options.lockRetryMs ?? envInt('CAREER_OPS_FOLLOWUPS_LOCK_RETRY_MS', 75),
    staleMs: options.lockStaleMs ?? envInt('CAREER_OPS_FOLLOWUPS_LOCK_STALE_MS', 10 * 60_000),
  });

  try {
    const existingContent = existsSync(followupsPath) ? readFileSync(followupsPath, 'utf-8') : null;
    if (existingContent != null && isAlreadySeeded(existingContent, appNum) && !options.force) {
      return { seeded: false, appNum, pin: null, nextDate, appliedDate, setDate, reason: 'already-seeded' };
    }

    mkdirSync(dirname(followupsPath), { recursive: true });
    writeFileAtomic(followupsPath, appendPins(existingContent, [pin]));
    return { seeded: true, appNum, pin, nextDate, appliedDate, setDate };
  } finally {
    lock.release();
  }
}

// --- Core: backfill all Applied rows ---------------------------------------

/**
 * Seed every tracker row whose status normalizes to `applied` that doesn't
 * already have a pin or follow-up table row. Non-Applied rows are skipped
 * silently. Idempotent — re-running seeds nothing new.
 *
 * @param {object} [options] - Same shape as seedFollowup's options (minus `date`/appNum).
 * @returns {Promise<{seeded: object[], skipped: object[]}>}
 */
export async function seedBackfill(options = {}) {
  const trackerPath = resolveTrackerPath(options.trackerPath);
  const followupsPath = resolveFollowupsPath(options.followupsPath);

  if (!existsSync(trackerPath)) {
    throw new SeedError('ROW_NOT_FOUND', `Tracker not found at ${trackerPath}`);
  }
  const rows = readTrackerRows(trackerPath);
  const appliedRows = rows.filter(r => normalizeStatus(r.status) === 'applied');
  const cadence = resolveCadenceConfig({ profilePath: options.profilePath });
  const setDate = todayStr();

  function planFor(row) {
    const appliedDate = resolveAppliedDate(row, null);
    const nextDate = addDays(parseDate(appliedDate), cadence.applied_first);
    return { appNum: row.num, pin: formatPinLine(row.num, nextDate, setDate), nextDate, appliedDate, setDate };
  }

  if (options.dryRun) {
    const existingContent = existsSync(followupsPath) ? readFileSync(followupsPath, 'utf-8') : '';
    const seeded = [];
    const skipped = [];
    for (const row of appliedRows) {
      if (isAlreadySeeded(existingContent, row.num) && !options.force) {
        skipped.push({ appNum: row.num, reason: 'already-seeded' });
        continue;
      }
      try {
        seeded.push({ ...planFor(row), dryRun: true });
      } catch (err) {
        if (err instanceof SeedError && err.code === 'INVALID_DATE') {
          skipped.push({ appNum: row.num, reason: 'invalid-notes-date', detail: err.message });
        } else {
          throw err;
        }
      }
    }
    return { seeded, skipped, dryRun: true };
  }

  const lockDir = resolveLockDir(options.lockDir, followupsPath);
  const lock = await acquireFollowupsLock(lockDir, followupsPath, {
    timeoutMs: options.lockTimeoutMs ?? envInt('CAREER_OPS_FOLLOWUPS_LOCK_TIMEOUT_MS', 60_000),
    retryMs: options.lockRetryMs ?? envInt('CAREER_OPS_FOLLOWUPS_LOCK_RETRY_MS', 75),
    staleMs: options.lockStaleMs ?? envInt('CAREER_OPS_FOLLOWUPS_LOCK_STALE_MS', 10 * 60_000),
  });

  try {
    const existingContent = existsSync(followupsPath) ? readFileSync(followupsPath, 'utf-8') : null;
    const checkContent = existingContent ?? '';
    const seeded = [];
    const skipped = [];
    const newPins = [];
    for (const row of appliedRows) {
      if (isAlreadySeeded(checkContent, row.num) && !options.force) {
        skipped.push({ appNum: row.num, reason: 'already-seeded' });
        continue;
      }
      let plan;
      try {
        plan = planFor(row);
      } catch (err) {
        if (err instanceof SeedError && err.code === 'INVALID_DATE') {
          skipped.push({ appNum: row.num, reason: 'invalid-notes-date', detail: err.message });
          continue;
        }
        throw err;
      }
      seeded.push(plan);
      newPins.push(plan.pin);
    }

    if (newPins.length > 0) {
      mkdirSync(dirname(followupsPath), { recursive: true });
      writeFileAtomic(followupsPath, appendPins(existingContent, newPins));
    }

    return { seeded, skipped };
  } finally {
    lock.release();
  }
}

// --- CLI ---------------------------------------------------------------

function parseCliArgs(argv) {
  const opts = { force: false, dryRun: false, json: false, backfill: false, date: null, appNum: null };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') {
      i++;
      if (argv[i] === undefined) throw new SeedError('USAGE', '--date requires a value');
      opts.date = argv[i];
    } else if (a === '--force') {
      opts.force = true;
    } else if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a === '--json') {
      opts.json = true;
    } else if (a === '--backfill') {
      opts.backfill = true;
    } else if (a.startsWith('--')) {
      throw new SeedError('USAGE', `Unknown flag: ${a}`);
    } else {
      positionals.push(a);
    }
  }

  if (opts.backfill) {
    if (positionals.length !== 0) {
      throw new SeedError('USAGE', '--backfill does not take a positional appNum');
    }
    if (opts.date != null) {
      throw new SeedError('USAGE', '--date cannot be combined with --backfill (each row resolves its own apply date from its notes)');
    }
  } else {
    if (positionals.length !== 1) {
      throw new SeedError('USAGE', 'Usage: node followup-seed.mjs <appNum> [--date YYYY-MM-DD] [--force] [--dry-run] [--json]');
    }
    const raw = positionals[0];
    const n = parseInt(raw, 10);
    if (isNaN(n) || n <= 0 || String(n) !== raw.trim()) {
      throw new SeedError('USAGE', `Invalid appNum: ${raw}`);
    }
    opts.appNum = n;
  }

  return opts;
}

const EXIT_CODES = {
  USAGE: 1,
  INVALID_DATE: 1,
  NOT_APPLIED: 1,
  ROW_NOT_FOUND: 2,
  LOCK_TIMEOUT: 4,
};

function failWith(exitCode, code, message, json) {
  if (json) console.log(JSON.stringify({ error: message, code }));
  console.error(`❌ ${message}`);
  process.exit(exitCode);
}

function reportSingle(result, json) {
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  const dryTag = result.dryRun ? ' [dry-run]' : '';
  if (result.seeded) {
    console.log(`✅ Seeded #${result.appNum}: next follow-up ${result.nextDate} (applied ${result.appliedDate}, set ${result.setDate})${dryTag}`);
  } else {
    console.log(`⏭️  #${result.appNum} already seeded — no-op (${result.reason})${dryTag}`);
  }
}

function reportBackfill(result, json) {
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  const dryTag = result.dryRun ? ' [dry-run]' : '';
  console.log(`✅ Backfill${dryTag}: seeded ${result.seeded.length}, skipped ${result.skipped.length}`);
  for (const s of result.seeded) console.log(`  + #${s.appNum}: next ${s.nextDate}`);
  for (const s of result.skipped) console.log(`  - #${s.appNum}: ${s.reason}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const jsonRequested = argv.includes('--json');
  let opts;
  try {
    opts = parseCliArgs(argv);
  } catch (err) {
    failWith(EXIT_CODES[err.code] ?? 1, err.code || 'USAGE', err.message, jsonRequested);
    return;
  }

  try {
    if (opts.backfill) {
      const result = await seedBackfill({ dryRun: opts.dryRun, force: opts.force });
      reportBackfill(result, opts.json);
    } else {
      const result = await seedFollowup(opts.appNum, { date: opts.date, force: opts.force, dryRun: opts.dryRun });
      reportSingle(result, opts.json);
    }
    process.exit(0);
  } catch (err) {
    const code = err.code || 'ERROR';
    const exitCode = EXIT_CODES[code] ?? 1;
    failWith(exitCode, code, err.message, opts.json);
  }
}

// Run (CLI only; guarded so the module is safely importable for tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
