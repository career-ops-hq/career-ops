import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const storage = new AsyncLocalStorage();

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_TIMER_MS = 2_147_483_647;
// A board dropped from portals.yml would otherwise leave its body on disk
// forever. Seven days covers a weekly scan that still wants the validator.
const RETAIN_MS = 7 * 24 * 60 * 60 * 1000;

// 0 is usable and means never fresh, so a GET rechecks every time.
export function resolveHttpCacheTtlMs(raw, fallback = DEFAULT_TTL_MS) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_TIMER_MS) return fallback;
  return parsed;
}

export function formatHttpCacheWindow(ttlMs) {
  if (ttlMs >= 60_000 && ttlMs % 60_000 === 0) {
    const minutes = ttlMs / 60_000;
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }
  if (ttlMs >= 1_000 && ttlMs % 1_000 === 0) {
    const seconds = ttlMs / 1_000;
    return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
  }
  return `${ttlMs} ms`;
}

async function prune(dir, now) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const cutoff = now - RETAIN_MS;
  await Promise.all(names.map(async (name) => {
    const kept = /^[a-f0-9]{64}$/.test(name) || name.endsWith('.tmp');
    if (!kept) return;
    const full = join(dir, name);
    try {
      const info = await stat(full);
      if (info.mtimeMs < cutoff) await rm(full, { force: true });
    } catch {}
  }));
}

export function withHttpCache(options, fn) {
  const store = {
    dir: options.dir,
    ttlMs: options.ttlMs,
    now: options.now ?? (() => Date.now()),
    write: options.write !== false,
    memory: new Map(),
    inflight: new Map(),
    stats: { hits: 0, misses: 0, revalidated: 0 },
  };
  const run = () => storage.run(store, fn);
  if (!store.write) return run();
  return prune(store.dir, store.now()).then(run);
}

export function httpCacheStats() {
  const store = storage.getStore();
  if (!store) return null;
  return { ...store.stats };
}

function headerValue(headers, name) {
  if (!headers) return '';
  return new Headers(headers).get(name) || '';
}

function bodyText(body) {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  if (body instanceof URLSearchParams) return body.toString();
  return null;
}

function cacheKey(method, url, opts, body) {
  const auth = headerValue(opts.headers, 'authorization');
  const cookie = headerValue(opts.headers, 'cookie');
  return createHash('sha256').update(`${method}\n${url}\n${auth}\n${cookie}\n${body}`).digest('hex');
}

function isFresh(entry, store) {
  if (!entry || !(store.ttlMs > 0)) return false;
  return store.now() - entry.storedAt < store.ttlMs;
}

function parseEntry(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed.body !== 'string' || !Number.isFinite(parsed.storedAt)) return null;
  const etag = typeof parsed.etag === 'string' && parsed.etag ? parsed.etag : null;
  return { storedAt: parsed.storedAt, body: parsed.body, etag };
}

async function readEntry(store, key) {
  const memorized = store.memory.get(key);
  if (memorized) return memorized;
  try {
    const entry = parseEntry(await readFile(join(store.dir, key), 'utf8'));
    if (entry) store.memory.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

async function writeEntry(store, key, entry) {
  if (!store.write) return;
  const tmp = join(store.dir, `.${key}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    await mkdir(store.dir, { recursive: true });
    // The file does not hold the URL. Query strings on board requests can carry tokens.
    await writeFile(tmp, JSON.stringify({
      storedAt: entry.storedAt,
      body: entry.body,
      etag: entry.etag,
    }));
    await rename(tmp, join(store.dir, key));
  } catch {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

function savedResponse() {
  return { status: 200, headers: { get() { return null; } } };
}

async function plain(url, opts, load) {
  const loaded = await load(url, opts, { ifNoneMatch: null });
  if (loaded?.notModified) {
    const err = new Error('HTTP 304');
    err.status = 304;
    throw err;
  }
  return loaded.body;
}

async function fulfill(store, key, url, opts, load, method) {
  const entry = await readEntry(store, key);
  if (isFresh(entry, store)) {
    store.stats.hits++;
    opts.onResponse?.(savedResponse());
    return entry.body;
  }
  const conditional = method === 'GET' && entry?.etag
    ? { ifNoneMatch: entry.etag }
    : { ifNoneMatch: null };
  const loaded = await load(url, opts, conditional);
  if (loaded?.notModified) {
    if (!entry) {
      const err = new Error('HTTP 304');
      err.status = 304;
      throw err;
    }
    entry.storedAt = store.now();
    store.memory.set(key, entry);
    store.stats.revalidated++;
    await writeEntry(store, key, entry);
    return entry.body;
  }
  const saved = {
    storedAt: store.now(),
    body: loaded.body,
    etag: typeof loaded.etag === 'string' && loaded.etag ? loaded.etag : null,
  };
  store.stats.misses++;
  if (loaded.noStore) return saved.body;
  store.memory.set(key, saved);
  await writeEntry(store, key, saved);
  return saved.body;
}

// `load` returns `{ body, etag, noStore }` or `{ notModified: true }`.
// The shared promise is registered before the first await so two overlapping
// calls collapse onto one request.
export function cachedText(url, opts, load) {
  const store = storage.getStore();
  if (!store) return plain(url, opts, load);
  const method = String(opts.method || 'GET').toUpperCase();
  const body = bodyText(opts.body);
  if (body === null || (method !== 'GET' && method !== 'POST')) return plain(url, opts, load);
  const key = cacheKey(method, url, opts, body);
  const pending = store.inflight.get(key);
  if (pending) {
    return pending.then((text) => {
      opts.onResponse?.(savedResponse());
      return text;
    });
  }
  const work = fulfill(store, key, url, opts, load, method);
  store.inflight.set(key, work);
  return work.finally(() => {
    if (store.inflight.get(key) === work) store.inflight.delete(key);
  });
}
