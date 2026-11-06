#!/usr/bin/env node
/**
 * backup.mjs — copy your career-ops User Layer to a backup folder (zero-token).
 *
 * Copies the files DATA_CONTRACT.md lists as yours (CV, profile, portals,
 * tracker and everything under data/, reports/, output/, jds/ ...) from the
 * data root to a destination folder. Nothing is ever deleted at the
 * destination, so a file you removed locally stays in the backup.
 *
 * Where the backup goes, first match wins:
 *   1. --dest <dir>                 exactly this folder
 *   2. CAREER_OPS_BACKUP_DIR        exactly this folder
 *   3. the cloud-drive folder found on this machine, plus Backups/career-ops
 *      (--provider google-drive | dropbox | onedrive | icloud; default google-drive)
 *
 * Files are copied whole. rsync's delta mode maps the old copy into memory,
 * which Google Drive's file-system layer refuses ("mmap: Resource deadlock
 * avoided"), so this never uses it.
 *
 * Usage: node backup.mjs [--dest <dir>] [--provider <name>] [--account <text>]
 *                        [--folder <path>] [--dry-run] [--json] [--quiet]
 *
 * Exit status: 0 success, 1 one or more files failed to copy, 2 no usable
 * destination or invalid option.
 */

import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync,
  renameSync, rmSync, statSync, utimesSync, writeFileSync,
} from 'fs';
import { homedir, platform as osPlatform } from 'os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { flagValue, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { walkTree } from './lib/walk-tree.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_PROVIDER = 'google-drive';
export const DEFAULT_FOLDER = join('Backups', 'career-ops');
export const PROVIDERS = ['google-drive', 'dropbox', 'onedrive', 'icloud'];
export const MANIFEST_NAME = '.career-ops-backup.json';

/** User Layer paths (relative to the data root) a backup covers. */
export const BACKUP_PATHS = [
  'cv.md', 'article-digest.md', 'voice-dna.md', 'portals.yml',
  'config/profile.yml', 'config/cv-facts.json', 'config/benchmarks.yml', 'config/plugins.yml',
  'modes/_profile.md', 'modes/_custom.md', 'modes/_brief.md',
  'data', 'reports', 'output', 'jds', 'interview-prep', 'documents', 'writing-samples',
  'batch/tracker-additions',
];

/**
 * Never copied: secrets, third-party PII the contract says to delete after
 * use, rebuildable caches, and lock/temp files.
 */
export function isExcluded(relPath) {
  const p = relPath.split(sep).join('/');
  const name = p.slice(p.lastIndexOf('/') + 1);
  if (name === '.DS_Store' || name === '.env' || name.startsWith('.env.')) return true;
  if (p === 'data/Connections.csv') return true;
  if (p === 'data/cache' || p.startsWith('data/cache/')) return true;
  return /\.(lock|tmp|tick|part)$/.test(name) || name.endsWith('~');
}

// ── Destination discovery ────────────────────────────────────────────────

const subdirs = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
};

/**
 * Candidate sync roots for a provider on this machine. Each is
 * `{ label, path }`; `label` is what `--account` matches against.
 */
export function providerRoots(provider, { home = homedir(), platform = osPlatform(), exists = existsSync } = {}) {
  const out = [];
  const add = (label, path) => { if (exists(path)) out.push({ label, path }); };
  const cloud = join(home, 'Library', 'CloudStorage');
  if (provider === 'google-drive') {
    for (const d of subdirs(cloud).filter((n) => n.startsWith('GoogleDrive-'))) {
      add(d, join(cloud, d, 'My Drive'));
    }
    add('Google Drive', join(home, 'Google Drive', 'My Drive'));
    add('Google Drive', join(home, 'Google Drive'));
    if (platform === 'win32') add('G:', 'G:\\My Drive');
  } else if (provider === 'dropbox') {
    add('Dropbox', join(home, 'Dropbox'));
    for (const d of subdirs(cloud).filter((n) => n.startsWith('Dropbox'))) add(d, join(cloud, d));
  } else if (provider === 'onedrive') {
    for (const d of subdirs(cloud).filter((n) => n.startsWith('OneDrive'))) add(d, join(cloud, d));
    for (const d of subdirs(home).filter((n) => n.startsWith('OneDrive'))) add(d, join(home, d));
  } else if (provider === 'icloud') {
    add('iCloud Drive', join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'));
    add('iCloud Drive', join(home, 'iCloudDrive'));
  }
  // The same folder can be reached by two spellings; keep the first.
  return out.filter((c, i) => out.findIndex((o) => o.path === c.path) === i);
}

/**
 * Work out the backup folder. Returns `{ dest, source }` or throws an Error
 * whose message says what to pass instead (the CLI turns it into exit 2).
 */
export function resolveDestination({ dest, provider, account, folder, env = process.env, ...machine } = {}) {
  const exact = (dest ?? '').trim() || (env.CAREER_OPS_BACKUP_DIR ?? '').trim();
  if (exact) {
    return { dest: resolve(exact), source: dest?.trim() ? '--dest' : 'CAREER_OPS_BACKUP_DIR' };
  }
  const name = provider || DEFAULT_PROVIDER;
  if (!PROVIDERS.includes(name)) {
    throw new Error(`Unknown provider "${name}". Use one of: ${PROVIDERS.join(', ')}.`);
  }
  const sub = (folder ?? '').trim() || DEFAULT_FOLDER;
  if (isAbsolute(sub) || sub.split(/[\\/]/).includes('..')) {
    throw new Error('--folder must be a relative path under the drive, without "..".');
  }
  let roots = providerRoots(name, machine);
  if (roots.length === 0) {
    throw new Error(
      `No ${name} folder found on this machine. Install and sign in to its desktop app, ` +
      'or choose the folder yourself with --dest <dir> (or CAREER_OPS_BACKUP_DIR).',
    );
  }
  if (account) {
    const want = account.toLowerCase();
    roots = roots.filter((r) => r.label.toLowerCase().includes(want) || r.path.toLowerCase().includes(want));
    if (roots.length === 0) throw new Error(`No ${name} folder matches --account "${account}".`);
  }
  if (roots.length > 1) {
    throw new Error(
      `Found ${roots.length} ${name} folders and will not guess which one is yours:\n` +
      roots.map((r) => `  ${r.path}`).join('\n') +
      '\nPick one with --account <text from the folder name> or --dest <dir>.',
    );
  }
  return { dest: join(roots[0].path, sub), source: `${name} (${roots[0].label})` };
}

// ── Safety ───────────────────────────────────────────────────────────────

function canonical(path) {
  // realpath of the deepest ancestor that exists, so a not-yet-created
  // destination under a symlinked folder is still compared by its real place.
  let probe = resolve(path);
  const tail = [];
  while (!existsSync(probe) && dirname(probe) !== probe) {
    tail.unshift(probe.slice(dirname(probe).length + 1));
    probe = dirname(probe);
  }
  let real = probe;
  try { real = realpathSync(probe); } catch { /* keep lexical */ }
  return join(real, ...tail);
}

const within = (child, parent) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** The destination must not sit inside what it backs up (it would copy itself). */
export function assertSafeDestination(dest, dataRoot, codeRoot = CODE_ROOT) {
  const d = canonical(dest);
  for (const base of [dataRoot, codeRoot]) {
    if (within(d, canonical(base))) {
      throw new Error(`Backup folder ${dest} is inside ${base}. Choose a folder outside your career-ops files.`);
    }
  }
}

// ── Copy ─────────────────────────────────────────────────────────────────

/** Regular files under `dataRoot/entry` (a file or a folder), as `{ rel, size, mtimeMs }`. */
function listEntry(dataRoot, entry) {
  const abs = join(dataRoot, entry);
  let st;
  try { st = lstatSync(abs); } catch { return []; }
  if (st.isSymbolicLink() || isExcluded(entry)) return [];
  const paths = st.isDirectory()
    ? walkTree(abs, {
      // Symlinks are skipped (the default), so the backup never follows a link
      // out of the data root.
      skip: (dirent, dir) => isExcluded(relative(dataRoot, join(dir, dirent.name))),
    })
    : [abs];
  return paths.map((p) => {
    const s = statSync(p);
    return { rel: relative(dataRoot, p), size: s.size, mtimeMs: s.mtimeMs };
  });
}

const unchanged = (src, destPath) => {
  try {
    const d = statSync(destPath);
    // Drive and network volumes round mtimes, so allow two seconds of slack.
    return d.size === src.size && Math.abs(d.mtimeMs - src.mtimeMs) < 2000;
  } catch {
    return false;
  }
};

/**
 * Copy every backed-up file under `dataRoot` to `dest`.
 * @returns {{copied: number, unchanged: number, failed: {path: string, error: string}[], bytes: number}}
 */
export function runBackup({ dataRoot, dest, dryRun = false }) {
  const result = { copied: 0, unchanged: 0, failed: [], bytes: 0 };
  if (!dryRun) mkdirSync(dest, { recursive: true });
  for (const entry of BACKUP_PATHS) {
    for (const file of listEntry(dataRoot, entry)) {
      const target = join(dest, file.rel);
      if (unchanged(file, target)) { result.unchanged++; continue; }
      if (dryRun) { result.copied++; result.bytes += file.size; continue; }
      const part = `${target}.part`;
      try {
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(dataRoot, file.rel), part);
        utimesSync(part, new Date(), new Date(file.mtimeMs));
        renameSync(part, target);
        result.copied++;
        result.bytes += file.size;
      } catch (error) {
        try { rmSync(part, { force: true }); } catch { /* best effort */ }
        result.failed.push({ path: file.rel, error: error.message });
      }
    }
  }
  if (!dryRun) {
    writeFileSync(join(dest, MANIFEST_NAME), `${JSON.stringify({
      lastRun: new Date().toISOString(),
      copied: result.copied,
      unchanged: result.unchanged,
      failed: result.failed.length,
    }, null, 2)}\n`);
  }
  return result;
}

// ── CLI ──────────────────────────────────────────────────────────────────

const KNOWN_FLAGS = ['--dest', '--provider', '--account', '--folder', '--dry-run', '--json', '--quiet', '--help', '-h'];
const VALUE_FLAGS = ['--dest', '--provider', '--account', '--folder'];

const USAGE = `Usage:
  node backup.mjs                          # back up to <Google Drive>/Backups/career-ops
  node backup.mjs --dest <dir>             # back up to exactly this folder
  node backup.mjs --provider dropbox       # google-drive (default) | dropbox | onedrive | icloud
  node backup.mjs --account <text>         # pick one drive when several are signed in
  node backup.mjs --folder <relative/path> # folder under the drive (default Backups/career-ops)
  node backup.mjs --dry-run                # show what would be copied, copy nothing
  node backup.mjs --json | --quiet         # machine-readable result | errors only
  CAREER_OPS_BACKUP_DIR=<dir>              # same as --dest`;

function main(args) {
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });
  const json = args.includes('--json');
  const quiet = args.includes('--quiet');
  const dryRun = args.includes('--dry-run');
  const dataRoot = getCareerOpsRoot();

  let target;
  try {
    target = resolveDestination({
      dest: flagValue(args, '--dest'),
      provider: flagValue(args, '--provider'),
      account: flagValue(args, '--account'),
      folder: flagValue(args, '--folder'),
    });
    assertSafeDestination(target.dest, dataRoot);
    if (!existsSync(dirname(target.dest))) {
      throw new Error(`${dirname(target.dest)} does not exist (is the drive mounted?). Nothing was created.`);
    }
  } catch (error) {
    if (json) console.log(JSON.stringify({ ok: false, error: error.message }));
    else console.error(`backup: ${error.message}`);
    return 2;
  }

  const result = runBackup({ dataRoot, dest: target.dest, dryRun });
  const ok = result.failed.length === 0;
  if (json) {
    console.log(JSON.stringify({ ok, dryRun, dest: target.dest, via: target.source, ...result }));
  } else {
    for (const f of result.failed) console.error(`backup: failed ${f.path}: ${f.error}`);
    if (!quiet) {
      const mb = (result.bytes / 1048576).toFixed(1);
      console.log(`${dryRun ? 'Would copy' : 'Copied'} ${result.copied} file(s) (${mb} MB), ${result.unchanged} unchanged -> ${target.dest} [${target.source}]`);
    }
  }
  return ok ? 0 : 1;
}

if (isMainModule(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
