// Filesystem cache for H-1B sponsor lookups.
// One JSON file per company under {cacheDir}/{cacheKey(name)}.json.
// Positive entries default TTL 90d, negative (unresolved names) default 30d.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_DIR = 'data/cache/h1b';
const DEFAULT_TTL_DAYS = 90;
const DEFAULT_NEG_TTL_DAYS = 30;
const DAY_MS = 86_400_000;

export function cacheKey(name) {
  const raw = typeof name === 'string' ? name : '';
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'noname';
}

function entryPath(cacheDir, name) {
  return path.join(cacheDir, `${cacheKey(name)}.json`);
}

export async function readCache(name, opts = {}) {
  const cacheDir = opts.cacheDir ?? DEFAULT_DIR;
  const ttlDays = Number.isFinite(opts.ttlDays) ? opts.ttlDays : DEFAULT_TTL_DAYS;
  const negTtlDays = Number.isFinite(opts.negativeTtlDays) ? opts.negativeTtlDays : DEFAULT_NEG_TTL_DAYS;

  let raw;
  try {
    raw = await readFile(entryPath(cacheDir, name), 'utf8');
  } catch {
    return null;
  }

  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!entry || typeof entry !== 'object' || typeof entry.fetchedAt !== 'string') return null;
  // A well-formed entry always carries a data payload (writeCache guarantees
  // it) — an entry without one is malformed, so fail closed.
  if (!('data' in entry)) return null;

  const fetchedAt = Date.parse(entry.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return null;

  const age = Date.now() - fetchedAt;
  // A future fetchedAt is clock skew or tampering; either way not usable.
  if (age < 0) return null;

  const ttl = entry.negative === true ? negTtlDays : ttlDays;
  if (age > ttl * DAY_MS) return null;

  return entry;
}

export async function writeCache(name, data, opts = {}) {
  const cacheDir = opts.cacheDir ?? DEFAULT_DIR;
  const negative = opts.negative === true;

  await mkdir(cacheDir, { recursive: true });

  const entry = { data, fetchedAt: new Date().toISOString() };
  if (negative) entry.negative = true;

  const finalPath = entryPath(cacheDir, name);
  const tmpPath = `${finalPath}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(entry, null, 2), 'utf8');
  await rename(tmpPath, finalPath);
  return entry;
}
