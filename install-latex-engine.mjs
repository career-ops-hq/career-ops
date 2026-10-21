#!/usr/bin/env node

/**
 * install-latex-engine.mjs — One-command local LaTeX engine for the latex CV path (#5132)
 *
 * Usage:
 *   node install-latex-engine.mjs            # install tectonic into the repo root (no-op if tectonic is present)
 *   node install-latex-engine.mjs --check    # report the engine generate-latex.mjs would use; never downloads
 *   node install-latex-engine.mjs --force    # re-download even if tectonic is already available
 *   node install-latex-engine.mjs --json     # machine-readable result
 *
 * `latex` / `latex-tex` modes compile through generate-latex.mjs, which needs
 * tectonic or pdflatex. pdflatex means a full TeX distribution (1-5 GB, admin
 * installers, different per OS); tectonic is one binary that fetches only the
 * packages a document uses, is already the engine resolveLatexEngine() prefers,
 * and is the only one that builds the CJK template (#3553). So this installs
 * tectonic, next to the scripts, where resolveLatexEngine() looks first.
 *
 * Opt-in by design: nothing calls this on `npm install`. generate-latex.mjs
 * reports `installHint` when no engine is found, and the latex modes ask the
 * user before running it.
 *
 * Supply chain: the version is pinned and so is the SHA-256 of every asset
 * (the digests GitHub publishes on the release). A download that does not
 * match is discarded before anything is extracted. Bumping the version means
 * updating TECTONIC_VERSION and every digest together. The download itself is
 * bounded: it is aborted after DOWNLOAD_TIMEOUT_MS, and reading stops as soon
 * as it passes MAX_DOWNLOAD_BYTES, so a stalled or oversized response never
 * hangs the agent or fills the disk before the digest check can reject it.
 */

import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, copyFileSync, chmodSync, rmSync, readdirSync, renameSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { isMainModule } from './lib/is-main-module.mjs';
import { validateFlags } from './lib/cli-flags.mjs';
import { resolveLatexEngine, localTectonicPath } from './generate-latex.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

export const TECTONIC_VERSION = '0.17.0';

const RELEASE_BASE =
  `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}`;

// `${process.platform}-${process.arch}` → release asset + pinned SHA-256.
// musl builds on Linux: statically linked, so they run on glibc and Alpine alike.
export const TECTONIC_ASSETS = {
  'win32-x64': {
    file: `tectonic-${TECTONIC_VERSION}-x86_64-pc-windows-msvc.zip`,
    sha256: 'f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f',
  },
  'darwin-x64': {
    file: `tectonic-${TECTONIC_VERSION}-x86_64-apple-darwin.tar.gz`,
    sha256: '7c90ef5b6ddb1eb1937e4337add5237b79338e4b9676459fa91187d24d6cdf80',
  },
  'darwin-arm64': {
    file: `tectonic-${TECTONIC_VERSION}-aarch64-apple-darwin.tar.gz`,
    sha256: 'a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667',
  },
  'linux-x64': {
    file: `tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz`,
    sha256: '8533d07f9ccbd7a65824b9e0459041bca34af1eb33daba48f59215593753a3b7',
  },
  'linux-arm64': {
    file: `tectonic-${TECTONIC_VERSION}-aarch64-unknown-linux-musl.tar.gz`,
    sha256: 'b10954a95404f3ab2328d2fa59a5ebab8e657f893fab096f98be8db7c0c979b8',
  },
};

// The largest pinned asset is ~22 MB; a response far past that is not the release.
export const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
export const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

const MANUAL_INSTALL_URL = 'https://tectonic-typesetting.github.io/book/latest/installation/';

/**
 * @param {string} platform - process.platform
 * @param {string} arch - process.arch
 * @returns {{file: string, sha256: string, url: string}|null} null when no prebuilt binary is pinned
 */
export function tectonicAsset(platform, arch) {
  const asset = TECTONIC_ASSETS[`${platform}-${arch}`];
  return asset ? { ...asset, url: `${RELEASE_BASE}/${asset.file}` } : null;
}

/**
 * @param {Buffer|Uint8Array} buf
 * @param {string} expected - hex SHA-256
 * @returns {boolean}
 */
export function verifySha256(buf, expected) {
  if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/i.test(expected)) return false;
  return createHash('sha256').update(buf).digest('hex') === expected.toLowerCase();
}

// Windows' own bsdtar reads .zip; a GNU tar earlier on PATH (Git for Windows,
// MSYS) does not, so name the system one explicitly when it exists.
function tarBinary(platform) {
  if (platform === 'win32' && process.env.SystemRoot) {
    const systemTar = join(process.env.SystemRoot, 'System32', 'tar.exe');
    if (existsSync(systemTar)) return systemTar;
  }
  return 'tar';
}

/**
 * Fetch `url` into a Buffer, giving up after `timeoutMs` (covering the body as
 * well as the headers) and as soon as more than `maxBytes` have arrived.
 * Throws an Error whose message says which limit was hit.
 */
async function boundedDownload(fetchImpl, url, { timeoutMs, maxBytes }) {
  const controller = new AbortController();
  let timer;
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`);
      controller.abort(err);
      reject(err);
    }, timeoutMs);
  });
  timedOut.catch(() => {});
  // Raced as well as passed as `signal`, so an implementation that ignores the
  // signal still cannot outlive the timeout.
  const bounded = (p) => Promise.race([p, timedOut]);
  const tooLarge = () => new Error(`response exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit`);

  let reader;
  try {
    const res = await bounded(fetchImpl(url, { signal: controller.signal }));
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const declared = Number(res.headers?.get?.('content-length'));
    if (declared > maxBytes) throw tooLarge();
    if (!res.body?.getReader) throw new Error('response has no readable body');

    reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await bounded(reader.read());
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw tooLarge();
      chunks.push(value);
    }
    reader = null;
    return Buffer.concat(chunks, total);
  } catch (err) {
    controller.abort(err);
    throw err;
  } finally {
    clearTimeout(timer);
    if (reader) reader.cancel().catch(() => {});
  }
}

function binaryWorks(bin) {
  try {
    return execFileSync(bin, ['--version'], { stdio: 'pipe', encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

/**
 * Download, verify and place the pinned tectonic binary.
 *
 * @param {object} [opts]
 * @param {string} [opts.root] - directory the binary is installed into (the repo root)
 * @param {string} [opts.platform]
 * @param {string} [opts.arch]
 * @param {boolean} [opts.force] - reinstall even if tectonic is already available
 * @param {number} [opts.timeoutMs] - abort the download after this long
 * @param {number} [opts.maxBytes] - stop reading the download past this size
 * @param {typeof fetch} [opts.fetchImpl] - injectable for tests
 * @param {() => string|null} [opts.detectEngine] - injectable for tests
 * @param {(asset: object) => void} [opts.onDownload] - called once, right before the download starts
 * @param {typeof tectonicAsset} [opts.resolveAsset] - injectable for tests
 * @param {(bin: string) => string|null} [opts.probe] - runs the staged binary, returns its version or null; injectable for tests
 * @returns {Promise<{status: string, engine?: string, path?: string, version?: string, error?: string}>}
 *   status: 'installed' | 'already-available' | 'unsupported-platform' | 'checksum-mismatch' | 'failed'
 */
export async function installTectonic({
  root = ROOT,
  platform = process.platform,
  arch = process.arch,
  force = false,
  timeoutMs = DOWNLOAD_TIMEOUT_MS,
  maxBytes = MAX_DOWNLOAD_BYTES,
  fetchImpl = globalThis.fetch,
  detectEngine = resolveLatexEngine,
  onDownload = () => {},
  resolveAsset = tectonicAsset,
  probe = binaryWorks,
} = {}) {
  // Only tectonic counts: a pdflatex-only host still needs it for the CJK
  // template, which is where generate-latex.mjs sends those users.
  if (!force) {
    const engine = detectEngine();
    if (engine === 'tectonic') return { status: 'already-available', engine };
  }

  const asset = resolveAsset(platform, arch);
  if (!asset) {
    return {
      status: 'unsupported-platform',
      error: `No pinned tectonic build for ${platform}-${arch}. Install tectonic or pdflatex manually: ${MANUAL_INSTALL_URL}`,
    };
  }

  let buf;
  try {
    onDownload(asset);
    buf = await boundedDownload(fetchImpl, asset.url, { timeoutMs, maxBytes });
  } catch (err) {
    return { status: 'failed', error: `Download failed: ${err.message}` };
  }

  if (!verifySha256(buf, asset.sha256)) {
    return {
      status: 'checksum-mismatch',
      error: `SHA-256 of ${asset.file} does not match the pinned digest; nothing was installed.`,
    };
  }

  const target = localTectonicPath(root, platform);
  const work = mkdtempSync(join(tmpdir(), 'career-ops-tectonic-'));
  let staged = null;
  let version;
  try {
    const archive = join(work, asset.file);
    writeFileSync(archive, buf);
    const extractDir = join(work, 'x');
    mkdirSync(extractDir);
    const tarArgs = asset.file.endsWith('.zip') ? ['-xf', archive, '-C', extractDir] : ['-xzf', archive, '-C', extractDir];
    execFileSync(tarBinary(platform), tarArgs, { stdio: 'pipe' });

    const binName = platform === 'win32' ? 'tectonic.exe' : 'tectonic';
    if (!readdirSync(extractDir).includes(binName)) {
      return { status: 'failed', error: `${asset.file} did not contain ${binName}` };
    }
    // Stage beside the target and probe it there, so a --force reinstall that
    // is interrupted or produces a binary that won't run never replaces a
    // working one. Keep .exe last on Windows so the staged file still runs.
    staged = target.replace(/(\.exe)?$/, '.part$1');
    copyFileSync(join(extractDir, binName), staged);
    if (platform !== 'win32') chmodSync(staged, 0o755);
    version = probe(staged);
    if (!version) {
      return { status: 'failed', error: `Downloaded binary did not run; ${target} was left untouched.` };
    }
    renameSync(staged, target);
    staged = null;
  } catch (err) {
    return { status: 'failed', error: `Install failed: ${err.message}` };
  } finally {
    if (staged) rmSync(staged, { force: true });
    rmSync(work, { recursive: true, force: true });
  }

  return { status: 'installed', engine: 'tectonic', path: target, version };
}

// ── CLI flags + help ──────────────────────────────────────

const KNOWN_FLAGS = ['--check', '--force', '--json', '--help', '-h'];

const USAGE = `Usage:
  node install-latex-engine.mjs            # install tectonic ${TECTONIC_VERSION} into the repo root (no-op if tectonic is present)
  node install-latex-engine.mjs --check    # report the engine generate-latex.mjs would use; never downloads
  node install-latex-engine.mjs --force    # re-download even if tectonic is already available
  node install-latex-engine.mjs --json     # machine-readable result
  node install-latex-engine.mjs --help|-h  # print this usage block and exit

Downloads one pinned, SHA-256-verified binary from the official tectonic GitHub
release (~10-22 MB). Nothing about you is sent anywhere.`;

async function main() {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE);
  const json = args.includes('--json');

  let result;
  if (args.includes('--check')) {
    const engine = resolveLatexEngine();
    const local = localTectonicPath();
    result = { status: engine ? 'available' : 'missing', engine, localBinary: existsSync(local) ? local : null };
    if (!engine) result.installHint = 'node install-latex-engine.mjs';
  } else {
    result = await installTectonic({
      force: args.includes('--force'),
      onDownload: (asset) => { if (!json) console.error(`Downloading ${asset.file}…`); },
    });
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.error) {
    console.error(result.error);
  } else if (result.status === 'installed') {
    console.log(`Installed ${result.version} → ${result.path}`);
  } else if (result.status === 'already-available') {
    console.log('tectonic is already available; nothing to do. Use --force to reinstall.');
  } else if (result.status === 'available') {
    console.log(`LaTeX engine: ${result.engine}${result.localBinary ? ` (${result.localBinary})` : ''}`);
  } else {
    console.log('No LaTeX engine found. Run: node install-latex-engine.mjs');
  }

  const ok = ['installed', 'already-available', 'available'].includes(result.status);
  process.exit(ok ? 0 : 1);
}

if (isMainModule(import.meta.url)) {
  main();
}
