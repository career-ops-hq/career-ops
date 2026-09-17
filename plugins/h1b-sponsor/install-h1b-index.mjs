#!/usr/bin/env node
// Downloads the local H-1B index so check.mjs can answer offline.
// Usage: node plugins/h1b-sponsor/install-h1b-index.mjs [--tag <release>] [--force]
//
// This is the one command in the plugin that reaches the network on the read
// path's behalf, and it is deliberately separate from check.mjs: keeping the
// download out of the checking CLI is what makes "a local check sends nothing"
// a property of the file rather than a promise about a code path. It is also
// an outward action in the same sense token.mjs is, so an agent runs it only
// when the user has asked for it.
//
// The release publishes two assets: the quarter's index, named for the quarter
// it was built from (index-2026Q2.ndjson.gz), and index-latest.json, a pointer
// object naming that file and its sha256. The pointer is read first, then the
// file it names, and the digest is verified against the bytes on disk BEFORE
// they are moved into place, so a truncated or substituted download is never
// what a lookup reads.
//
// Both live under a permanent `index-latest` tag whose assets are replaced each
// quarter, and the URLs here are built from that tag rather than from GitHub's
// /releases/latest/download/ path. That path resolves to the newest release of
// ANY kind in the repo, so the day that repo cuts a release for its own code,
// every client following it would start downloading the wrong thing. A fixed
// tag cannot drift that way.

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import { isMainModule } from '../../lib/is-main-module.mjs';
import { fetchWithTimeout, readBoundedText } from './lib/api.mjs';
import { indexPath, metaPath } from './lib/index.mjs';

const REPO = 'msampath/h1b-sponsor-data';
// The tag whose assets the publisher replaces each quarter. Overridable with
// --tag for a self-hosted fork or a pinned per-quarter tag; the pointer and the
// file it names always come from the same tag.
const DEFAULT_TAG = 'index-latest';
const POINTER = 'index-latest.json';
const USER_AGENT = 'career-ops-plugin-h1b-sponsor/1.0';
const USAGE = 'Usage: node plugins/h1b-sponsor/install-h1b-index.mjs [--tag <release>] [--force]';

// A release download starts on github.com and is answered by whichever asset
// host GitHub redirects to, so the egress guard is given all of them rather
// than the single API host it uses on the read path. Everything outside this
// list is still refused mid-redirect, before the request is issued to it.
const RELEASE_ORIGINS = [
  'https://github.com',
  'https://objects.githubusercontent.com',
  'https://release-assets.githubusercontent.com',
];
const MAX_REDIRECTS = 5;

// The index is ~8 MiB and grows a little each quarter. The ceiling is generous
// enough not to break on that and small enough that a runaway or hostile body
// cannot fill the user's disk before the digest gets a chance to reject it.
const MAX_INDEX_BYTES = 64 * 1024 * 1024;
const MAX_POINTER_BYTES = 4 * 1024;
const POINTER_TIMEOUT_MS = 30_000;
// 8 MiB over a slow link takes longer than any API call, and the abort timer
// covers the whole streamed body rather than just the headers.
const ASSET_TIMEOUT_MS = 300_000;

const SHA256_RE = /^[0-9a-f]{64}$/;
// The pointer names the file to fetch, so that name arrives over the network
// and is then used to build a URL. Restricting it to one path component of
// ordinary filename characters is what keeps it from walking out of the release
// (a `..` or a slash) or from becoming a path of its own. Deliberately not
// pinned to a specific extension: the publisher may change how it compresses
// without this needing a release of its own.
const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assetUrl(tag, name) {
  return `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

function guardedFetch(url, opts, consume) {
  return fetchWithTimeout(url, {
    headers: { 'Accept': '*/*', 'User-Agent': USER_AGENT },
    allowedOrigins: RELEASE_ORIGINS,
    maxRedirects: MAX_REDIRECTS,
    ...opts,
  }, consume);
}

/**
 * Read the pointer the release publishes at index-latest.json:
 * `{ version, built_at, employers, bytes, sha256, filename }`. Only `filename`
 * and `sha256` decide what happens next; `version` is carried through to the
 * sidecar so the installed quarter can be reported later without downloading
 * anything again.
 *
 * Bounded with readBoundedText, like every other body this plugin reads: the
 * pointer is a few hundred bytes and nothing served under that name should ever
 * be large enough to be worth buffering. The index itself is the exception and
 * streams to disk instead.
 *
 * Both fields are validated before use. They come from the network, and one of
 * them is about to become part of a URL and the other the sole thing standing
 * between a substituted download and a lookup that trusts it.
 */
async function fetchPointer(fetchImpl, url) {
  const out = await fetchImpl(url, { timeoutMs: POINTER_TIMEOUT_MS }, async res => {
    if (res.status !== 200) return { status: res.status };
    const read = await readBoundedText(res, MAX_POINTER_BYTES);
    return read.oversized ? { oversized: true } : { text: read.text };
  });
  if (out.status) throw new Error(`could not read the release pointer (HTTP ${out.status}): ${url}`);
  if (out.oversized) throw new Error(`the release pointer is implausibly large: ${url}`);

  let doc;
  try {
    doc = JSON.parse(String(out.text || ''));
  } catch {
    throw new Error(`the release pointer is not JSON: ${url}`);
  }
  if (!doc || typeof doc !== 'object') throw new Error(`the release pointer is not an object: ${url}`);

  const filename = String(doc.filename || '');
  if (!FILENAME_RE.test(filename)) {
    throw new Error(`the release pointer names an unusable index filename (${JSON.stringify(doc.filename)}): ${url}`);
  }
  const sha256 = String(doc.sha256 || '').trim().toLowerCase();
  if (!SHA256_RE.test(sha256)) {
    throw new Error(`the release pointer does not carry a sha256 digest: ${url}`);
  }
  // Recorded, never acted on, so a missing or odd value costs a label rather
  // than the install. Bounded because it lands in a file on disk.
  const version = doc.version === undefined || doc.version === null
    ? null
    : String(doc.version).slice(0, 64);
  return { filename, sha256, version };
}

/**
 * Stream the asset to `tmpFile`, hashing as it goes, and return the digest.
 *
 * Streamed rather than buffered: the body is millions of times the size of
 * anything else this plugin reads, and readBoundedText's 1 MiB ceiling exists
 * precisely because nothing on the API path should ever be this big. Hashing
 * during the write means the file is never read a second time to verify it.
 */
async function downloadAsset(fetchImpl, url, tmpFile) {
  return fetchImpl(url, { timeoutMs: ASSET_TIMEOUT_MS }, async res => {
    if (res.status !== 200) throw new Error(`could not download the index (HTTP ${res.status}): ${url}`);
    const declared = Number(res.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > MAX_INDEX_BYTES) {
      throw new Error(`the published index exceeds ${MAX_INDEX_BYTES} bytes (${declared}): ${url}`);
    }
    if (!res.body || typeof res.body.getReader !== 'function') {
      throw new Error(`the index response carried no readable body: ${url}`);
    }

    const hash = createHash('sha256');
    const out = createWriteStream(tmpFile);
    // A write failure (disk full, an unwritable target) arrives as an 'error'
    // event on the stream, and an EventEmitter error with no listener is an
    // uncaughtException: the CLI died on a stack trace instead of returning
    // the envelope, and the cleanup that removes the partial .tmp file never
    // ran. Recording the error here makes the crash impossible; the checks
    // below turn it into the ordinary failure it is. once(out, 'drain') needs
    // no extra wiring, it already rejects when 'error' fires mid-wait.
    let writeError = null;
    out.on('error', err => { writeError = err; });
    const reader = res.body.getReader();
    let total = 0;
    try {
      for (;;) {
        if (writeError) {
          await reader.cancel().catch(() => {});
          throw writeError;
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > MAX_INDEX_BYTES) {
          await reader.cancel().catch(() => {});
          throw new Error(`the published index exceeds ${MAX_INDEX_BYTES} bytes: ${url}`);
        }
        hash.update(value);
        // Respect backpressure: an 8 MiB body written without it queues the
        // whole file in memory, which is the thing streaming was for.
        if (!out.write(value)) await once(out, 'drain');
      }
    } finally {
      await new Promise(resolve => out.end(resolve));
    }
    // end() above flushes the tail, so a failure during that flush, or one
    // that raced the final read, is only visible here. The digest must not
    // vouch for bytes that never landed on disk.
    if (writeError) throw writeError;
    return { digest: hash.digest('hex'), bytes: total };
  });
}

/**
 * Install the index. Returns a plain result so every branch is testable without
 * a live download: `{ ok: true, ... }` or `{ ok: false, exitCode, message }`.
 * `fetchImpl` is injectable and must have fetchWithTimeout's shape.
 */
export async function installIndex({ fetchImpl = guardedFetch, tag = null, force = false, targetPath } = {}) {
  let target;
  try {
    target = targetPath || indexPath();
  } catch (err) {
    return { ok: false, exitCode: 1, message: (err && err.message) ? err.message : String(err) };
  }

  if (existsSync(target) && !force) {
    return {
      ok: false,
      exitCode: 0,
      message: `an index is already installed at ${target}. Pass --force to replace it with the current release.`,
    };
  }

  const release = tag || DEFAULT_TAG;
  const tmpFile = `${target}.${randomUUID()}.tmp`;
  let pointer;
  try {
    pointer = await fetchPointer(fetchImpl, assetUrl(release, POINTER));
  } catch (err) {
    return { ok: false, exitCode: 1, message: (err && err.message) ? err.message : String(err) };
  }
  const expected = pointer.sha256;
  const url = assetUrl(release, pointer.filename);

  try {
    await mkdir(path.dirname(target), { recursive: true });
    const { digest, bytes } = await downloadAsset(fetchImpl, url, tmpFile);
    if (digest !== expected) {
      // Nothing has been moved into place yet, so refusing here means the
      // previously installed index (if any) keeps serving and no lookup ever
      // reads bytes that failed their own checksum.
      await unlink(tmpFile).catch(() => {});
      return {
        ok: false,
        exitCode: 1,
        message: `checksum mismatch: the download hashed to ${digest} but the release publishes ${expected}. Nothing was installed.`,
      };
    }
    await rename(tmpFile, target);
    // version is the quarter the release was built from. Recording it here is
    // what lets the installed build be named later without asking GitHub again.
    await writeFile(metaPath(target), `${JSON.stringify({
      sha256: digest,
      bytes,
      version: pointer.version,
      filename: pointer.filename,
      url,
      installedAt: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8');
    return { ok: true, target, bytes, digest, url, version: pointer.version, filename: pointer.filename };
  } catch (err) {
    await unlink(tmpFile).catch(() => {});
    const reason = (err && err.name === 'AbortError')
      ? `no response within ${ASSET_TIMEOUT_MS / 1000}s`
      : ((err && err.message) ? err.message : String(err));
    return { ok: false, exitCode: 1, message: `could not install the index (${reason})` };
  }
}

function parseArgs(argv) {
  const args = { tag: null, force: false, ok: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') args.force = true;
    else if (a === '--tag') {
      const next = argv[i + 1];
      if (typeof next !== 'string' || !next.trim() || next.startsWith('-')) { args.ok = false; break; }
      args.tag = next.trim();
      i++;
    } else args.ok = false;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.ok) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
    return;
  }

  const result = await installIndex({ tag: args.tag, force: args.force });
  if (!result.ok) {
    // Errors go to stderr with an exit code rather than process.exit, so the
    // stream is flushed before the process ends.
    process.stderr.write(`${result.message}\n`);
    process.exitCode = result.exitCode;
    return;
  }
  process.stdout.write([
    `installed ${(result.bytes / 1048576).toFixed(1)} MiB to ${result.target}`,
    `build ${result.version || result.filename}`,
    `sha256 ${result.digest}`,
    '',
    'Lookups now run locally and send nothing. Refresh when DOL publishes a new',
    'quarter by re-running this command with --force.',
  ].join('\n') + '\n');
}

// Run the CLI only when invoked as a script: installIndex is imported by the
// test suite, and an unguarded main() would run on import with the importer's
// argv and set the importer's exit code.
if (isMainModule(import.meta.url)) {
  main().catch(err => {
    process.stderr.write(`could not install the index (${(err && err.message) ? err.message : err})\n`);
    process.exitCode = 1;
  });
}
