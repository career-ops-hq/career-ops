#!/usr/bin/env node

/**
 * session-activity.mjs - advisory "another session may already be on this"
 * signal for concurrent career-ops sessions (#4532).
 *
 * reserve-report-num.mjs already makes report-number allocation collision-SAFE
 * (two sessions can never claim the same number) via O_CREAT|O_EXCL sentinel
 * files. But nothing makes a session collision-AWARE: two sessions can each
 * independently pick up the same tracker row / report / URL and do fully
 * redundant (or conflicting) work, with the collision only surfacing after
 * the fact when merge-tracker.mjs or a status write has to reconcile it.
 * #4506/#4507 was exactly this: two sessions evaluated the same report and
 * each wrote a batch/tracker-additions/*.tsv for it under a differently
 * spelled company name, so the report-number match (which requires the
 * company to also agree, #912) missed it and a duplicate row got appended.
 *
 * This module is deliberately advisory, not a hard lock: it never blocks or
 * refuses an operation, and it never replaces the correctness-critical locks
 * (acquireTrackerLock, reserve-report-num.mjs's atomic slot claims). Its only
 * job is to let a caller ask "is anyone already active on this key?" before
 * starting work, and to answer honestly, so a session can choose to warn the
 * user instead of silently duplicating work another session already started.
 *
 * Sentinels live at {activityDir}/{sha1(key)}.json rather than being named
 * from the key directly, so an arbitrary key (a full URL, a company+role
 * string) never has to be filesystem-safe. The stored payload keeps the
 * original key for a human-readable message.
 *
 * Usage:
 *   node session-activity.mjs claim <key> [--label text] [--ttl-ms N]
 *   node session-activity.mjs check <key>
 *   node session-activity.mjs release <key> --token <token>
 *   node session-activity.mjs gc
 */

import {
  existsSync, mkdirSync, readFileSync, readdirSync,
  statSync, unlinkSync, writeFileSync,
} from 'fs';
import { createHash, randomUUID } from 'crypto';
import { join, resolve } from 'path';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const ROOT = getCareerOpsRoot();
const DEFAULT_TTL_MS = 30 * 60 * 1000;

function activityDirFor(options = {}) {
  const dir = resolve(options.activityDir
    || process.env.CAREER_OPS_ACTIVITY_DIR
    || join(options.rootDir || ROOT, '.career-ops-locks', 'active'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function keyFingerprint(key) {
  return createHash('sha1').update(String(key)).digest('hex');
}

function sentinelPath(activityDir, key) {
  return join(activityDir, `${keyFingerprint(key)}.json`);
}

function readSentinel(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err?.code === 'ESRCH') return false;
    return err?.code === 'EPERM' ? true : null;
  }
}

function isStale(entry, path, ttlMs) {
  if (!entry) return true;
  if (entry.pid) {
    const alive = processIsAlive(entry.pid);
    if (alive === true) return false;
    if (entry.process_bound === true && alive === false) return true;
  }
  try {
    return Date.now() - statSync(path).mtimeMs > ttlMs;
  } catch {
    return true;
  }
}

/**
 * Report whether `key` currently has a live claim, without taking one.
 *
 * @returns {{active: boolean, owner: object|null}}
 */
export function checkActivity(key, options = {}) {
  const activityDir = activityDirFor(options);
  const path = sentinelPath(activityDir, key);
  if (!existsSync(path)) return { active: false, owner: null };

  const entry = readSentinel(path);
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  if (isStale(entry, path, ttlMs)) return { active: false, owner: null };
  return { active: true, owner: entry };
}

/**
 * Claim `key` as active. Never blocks: if another live claim already exists,
 * returns it instead of throwing, so the caller can decide how to proceed
 * (this is advisory, not a hard lock — see module header).
 *
 * @returns {{claimed: boolean, owner: object|null, token: string|null}}
 */
export function claimActivity(key, options = {}) {
  const activityDir = activityDirFor(options);
  const path = sentinelPath(activityDir, key);
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

  const existing = readSentinel(path);
  if (existing && !isStale(existing, path, ttlMs)) {
    return { claimed: false, owner: existing, token: null };
  }
  if (existing) {
    // Stale (dead pid or past TTL) — safe to reclaim.
    try { unlinkSync(path); } catch (err) { if (err?.code !== 'ENOENT') throw err; }
  }

  const token = randomUUID();
  const entry = {
    key: String(key),
    token,
    pid: process.pid,
    process_bound: options.processBound === true,
    label: options.label || null,
    claimed_at: new Date().toISOString(),
  };
  try {
    writeFileSync(path, JSON.stringify(entry), { flag: 'wx' });
    return { claimed: true, owner: entry, token };
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
    // Lost the race to another session claiming the same key at the same
    // instant — report their claim rather than erroring.
    return { claimed: false, owner: readSentinel(path), token: null };
  }
}

/** Release a claim this caller owns (matched by token, unless force: true). */
export function releaseActivity(key, options = {}) {
  const activityDir = activityDirFor(options);
  const path = sentinelPath(activityDir, key);
  const force = options.force === true;
  if (!force && !options.token) throw new Error('Claim ownership token is required for release');
  try {
    const entry = readSentinel(path);
    if (!force && entry?.token !== options.token) return false;
    unlinkSync(path);
    return true;
  } catch (err) {
    if (err?.code === 'ENOENT') return false;
    throw err;
  }
}

/** Remove sentinels past their TTL whose owning process is no longer alive. */
export function gcStaleActivity(options = {}) {
  const activityDir = activityDirFor(options);
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  let removed = 0;
  for (const name of readdirSync(activityDir)) {
    if (!name.endsWith('.json')) continue;
    const path = join(activityDir, name);
    const entry = readSentinel(path);
    if (isStale(entry, path, ttlMs)) {
      try { unlinkSync(path); removed++; } catch (err) { if (err?.code !== 'ENOENT') throw err; }
    }
  }
  return removed;
}

/** Human-readable advisory line for a `check`/failed-`claim` owner, or null if none. */
export function describeActiveOwner(owner) {
  if (!owner) return null;
  const started = owner.claimed_at ? new Date(owner.claimed_at) : null;
  const ageMin = started ? Math.max(0, Math.round((Date.now() - started.getTime()) / 60_000)) : null;
  const when = ageMin == null ? 'a little while ago' : ageMin < 1 ? 'just now' : `${ageMin} min ago`;
  const label = owner.label ? ` (${owner.label})` : '';
  return `another session appears to already be active on "${owner.key}"${label}, started ${when} — continuing anyway`;
}

function runCli() {
  const [,, cmd, arg] = process.argv;
  const labelIdx = process.argv.indexOf('--label');
  const label = labelIdx > -1 ? process.argv[labelIdx + 1] : undefined;
  const tokenIdx = process.argv.indexOf('--token');
  const token = tokenIdx > -1 ? process.argv[tokenIdx + 1] : undefined;
  const ttlIdx = process.argv.indexOf('--ttl-ms');
  const ttlMs = ttlIdx > -1 ? Number(process.argv[ttlIdx + 1]) : undefined;

  if (cmd === '--help' || cmd === '-h' || !cmd) {
    process.stdout.write([
      'Usage: node session-activity.mjs <claim|check|release|gc> [key] [options]',
      '',
      '  claim <key> [--label text] [--ttl-ms N]   Claim key as active (never blocks)',
      '  check <key>                                Report whether key is currently claimed',
      '  release <key> --token <token>              Release a claim this caller owns',
      '  gc                                          Remove stale sentinels',
      '',
    ].join('\n'));
    return 0;
  }

  if (cmd === 'claim') {
    if (!arg) { process.stderr.write('Usage: node session-activity.mjs claim <key>\n'); return 1; }
    const result = claimActivity(arg, { label, ttlMs });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (cmd === 'check') {
    if (!arg) { process.stderr.write('Usage: node session-activity.mjs check <key>\n'); return 1; }
    const result = checkActivity(arg, { ttlMs });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (cmd === 'release') {
    if (!arg) { process.stderr.write('Usage: node session-activity.mjs release <key> --token <token>\n'); return 1; }
    const released = releaseActivity(arg, { token });
    process.stdout.write(`${JSON.stringify({ released })}\n`);
    return 0;
  }

  if (cmd === 'gc') {
    const removed = gcStaleActivity({ ttlMs });
    process.stdout.write(`${JSON.stringify({ removed })}\n`);
    return 0;
  }

  process.stderr.write(`session-activity: unknown command "${cmd}"\n`);
  return 1;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runCli();
}
