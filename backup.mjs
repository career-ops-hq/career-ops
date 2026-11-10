#!/usr/bin/env node
/**
 * backup.mjs — copy your career-ops User Layer to a backup folder (zero-token).
 *
 * Copies the User Layer (the paths in USER_PATHS, update-system.mjs: CV,
 * profile, portals, tracker and everything under data/, reports/, output/,
 * jds/ ...) from the data root to a destination folder. Nothing is ever
 * deleted at the destination, so a file you removed locally stays in the
 * backup. data/Connections.csv, data/contacts.tsv, data/reply-candidates.json and
 * output/contacts.vcf (the default vCard export)
 * hold other people's contact details and are left out unless you pass
 * --include-contacts.
 *
 * Nothing is chosen for you: say where the backup goes. First match wins:
 *   1. --dest <dir>                 exactly this folder
 *   2. CAREER_OPS_BACKUP_DIR        exactly this folder
 *   3. --provider google-drive | dropbox | onedrive | icloud
 *      the drive folder found on this machine, plus Backups/career-ops
 *
 * Files are copied whole. rsync's delta mode maps the old copy into memory,
 * which Google Drive's file-system layer refuses ("mmap: Resource deadlock
 * avoided"), so this never uses it.
 *
 * Usage: node backup.mjs (--dest <dir> | --provider <name>) [--account <text>]
 *                        [--folder <path>] [--include-contacts]
 *                        [--dry-run] [--json] [--quiet]
 *
 * Exit status: 0 success, 1 a file failed to copy or there was nothing to
 * copy, 2 no usable destination, invalid option or an unsafe data root.
 */

import {
  accessSync, constants as fsConstants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync,
  renameSync, rmSync, statSync, utimesSync, writeFileSync,
} from 'fs';
import { homedir, platform as osPlatform } from 'os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { flagValue, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { walkTree } from './lib/walk-tree.mjs';
import { kebab, loadProfileDefault } from './cv-templates.mjs';
import { getCareerOpsRoot, getProfilePath, hasProfileOverride } from './path-resolver.mjs';
import {
  LOCAL_PATHS_FILE,
  USER_PATHS,
  effectiveUserPaths,
  isGeneratedTemplateArtifact,
  isUserConfiguredTemplateVariant,
} from './update-system.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_FOLDER = join('Backups', 'career-ops');
export const PROVIDERS = ['google-drive', 'dropbox', 'onedrive', 'icloud'];
export const MANIFEST_NAME = '.career-ops-backup.json';

// Files that hold other people's contact details (DATA_CONTRACT.md: third-party
// PII). Any other .vcf file is left out too. All of it stays out unless the
// caller opts in with --include-contacts.
const CONTACT_FILES = ['data/Connections.csv', 'data/contacts.tsv', 'data/reply-candidates.json', 'output/contacts.vcf'];

/**
 * User Layer paths (relative to the data root, no trailing slash) a backup
 * covers. USER_PATHS is the updater's own list of what is yours, exported so
 * tools derive the same boundary; a fork's `config/local-paths.txt`
 * declarations come with it. The declaration file itself is added so a restore
 * brings the declarations back. A declaration file that cannot be parsed falls
 * back to the built-in list and is reported in `failed`, so the run exits non-zero.
 */
export function backupPaths(dataRoot, warnings = [], failed = []) {
  let paths = [...USER_PATHS];
  try {
    paths = effectiveUserPaths(dataRoot);
  } catch (error) {
    // Declared files are missing from this backup, so the run must not read as a clean success.
    failed.push({ path: LOCAL_PATHS_FILE, error: `${error.message}; backing up the built-in user paths only` });
  }
  return [...new Set([...paths, LOCAL_PATHS_FILE, ...templateUserFiles(dataRoot, warnings, failed)].map((p) => p.replace(/\/+$/, '')))];
}

/**
 * Files under templates/ that are yours, not the shipped templates: generated
 * per-application CVs and cover letters, and the named variants config/profile.yml
 * selects. The updater tells them apart by name (the `templates/` prefix alone
 * cannot), so this reuses its recognizers and looks one folder down for packs,
 * as the updater does.
 */
function templateUserFiles(dataRoot, warnings, failed) {
  // Both the data-root profile and the CAREER_OPS_PROFILE override can select a
  // variant; a file either one selects is yours (DATA_CONTRACT.md).
  const variants = {};
  const profiles = new Set([getProfilePath(dataRoot), ...(hasProfileOverride() ? [getProfilePath()] : [])]);
  if (hasProfileOverride()) {
    if (!within(resolve(getProfilePath()), resolve(dataRoot))) {
      warnings.push(`CAREER_OPS_PROFILE points at ${getProfilePath()}, outside the data root; it is not copied. Back that profile up separately.`);
    }
  }
  for (const profile of profiles) {
    // The same reader the template resolver uses (inline mappings included). A
    // missing profile is "none"; any other read or parse error is a failure.
    for (const kind of ['cv', 'cover']) {
      try {
        const configured = loadProfileDefault(kind, { profilePath: profile, strict: true });
        const name = configured ? kebab(configured) : '';
        if (name && name !== 'standard') variants[kind] = [...new Set([...(variants[kind] || []), name])];
      } catch (error) {
        failed.push({ path: profile, error: `could not discover configured template variants: ${error.message}` });
        break;
      }
    }
  }
  const found = [];
  const listDir = (relDir) => {
    try {
      return readdirSync(join(dataRoot, relDir), { withFileTypes: true }).map((e) => ({ rel: `${relDir}/${e.name}`, entry: e }));
    } catch (error) {
      // An absent folder is normal; an unreadable one would silently drop user templates.
      if (error.code !== 'ENOENT') failed.push({ path: relDir, error: `could not list for template files: ${error.message}` });
      return [];
    }
  };
  // templates/ itself, then one level down for template packs; no deeper.
  const top = listDir('templates');
  const levels = [top, ...top.filter(({ entry }) => entry.isDirectory()).map(({ rel }) => listDir(rel))];
  for (const { rel, entry } of levels.flat()) {
    if (entry.isFile() && (isGeneratedTemplateArtifact(rel) || isUserConfiguredTemplateVariant(rel, variants))) found.push(rel);
  }
  return found.sort();
}

// Agent-tool settings can hold API tokens. They are kept out of a backup that
// goes into a sync folder, whose client would upload them.
const isAgentSetting = (lower) => lower.startsWith('.claude/') || lower === 'opencode.json'
  || lower === 'plugins.local' || lower.startsWith('plugins.local/');

// Editor leftovers. Vim swap files (`.name.swp`, `.swo`, `.swn`, ...), emacs
// `#name#` autosaves and `.#name` locks, and `name~` are transient and never
// copied, for any file. `.bak`/`.orig`/`.old`/`.save` copies are not transient,
// but one of a secret or contact file holds the same data, so for those the
// original's name decides. `data/..env.swp` is therefore the `.env` swap file.
const BACKUP_COPY_SUFFIX = /\.(bak|orig|old|save)$/;
function editorLeftover(name) {
  let base = name;
  let temp = false;
  for (let changed = true; changed;) {
    const before = base;
    const emacs = base.match(/^#(.+)#$/) || base.match(/^\.#(.+)$/);
    const vim = base.match(/^\.(.+)\.sw[a-z]$/) || base.match(/^(.+)\.sw[a-z]$/);
    if (emacs) { base = emacs[1]; temp = true; }
    else if (vim) { base = vim[1]; temp = true; }
    else if (base.length > 1 && base.endsWith('~')) { base = base.slice(0, -1); temp = true; }
    else base = base.replace(BACKUP_COPY_SUFFIX, '');
    changed = base !== before;
  }
  return { base, temp };
}

function isContactFile(dir, base) {
  // A hidden copy (`.contacts.tsv.bak`, `.Connections.csv`) is the same data.
  const n = base.replace(/^\./, '');
  return base.endsWith('.vcf') || n.endsWith('.vcf') || CONTACT_FILES.some((f) => dir + n === f.toLowerCase());
}

/**
 * Never copied: secrets, rebuildable caches, lock/temp files, and (unless
 * `includeContacts`) the files holding other people's contact details.
 */
export function isExcluded(relPath, { includeContacts = false, skipAgentSettings = false } = {}) {
  const p = relPath.split(sep).join('/');
  // Lowercased: macOS and Windows volumes are case-insensitive, so a renamed
  // `Data/connections.csv` or `.ENV` is the same file.
  const lower = p.toLowerCase();
  const dir = lower.slice(0, lower.lastIndexOf('/') + 1);
  const name = lower.slice(dir.length);
  const { base, temp } = editorLeftover(name);
  if (temp) return true;
  if (name === '.ds_store' || base === '.env' || base.startsWith('.env.')) return true;
  // A nested checkout is copied for its files, but its git metadata (remote
  // URLs can embed tokens) and dependency folders are not.
  if (lower.split('/').some((seg) => seg === '.git' || seg === 'node_modules')) return true;
  if (lower === 'data/cache' || lower.startsWith('data/cache/')) return true;
  if (skipAgentSettings && isAgentSetting(lower)) return true;
  // Any .vcf is a vCard export from contacts.mjs, which takes a custom path.
  if (!includeContacts && isContactFile(dir, base)) return true;
  // plugins.lock is a User Layer file (USER_PATHS), not a transient lock.
  if (lower === 'plugins.lock') return false;
  return /\.(lock|tmp|tick|part)$/.test(name);
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
 * Work out the backup folder. Nothing is the default: with no `dest`, no
 * CAREER_OPS_BACKUP_DIR and no `provider` it throws. Returns `{ dest, source }`
 * or throws an Error whose message says what to pass instead (the CLI turns it
 * into exit 2).
 */
export function resolveDestination({ dest, provider, account, folder, env = process.env, ...machine } = {}) {
  const exact = (dest ?? '').trim() || (env.CAREER_OPS_BACKUP_DIR ?? '').trim();
  if (exact) {
    return { dest: resolve(exact), source: dest?.trim() ? '--dest' : 'CAREER_OPS_BACKUP_DIR' };
  }
  const name = (provider ?? '').trim();
  if (!name) {
    throw new Error(
      'No backup destination chosen. Pass --dest <dir> (or set CAREER_OPS_BACKUP_DIR), ' +
      `or name a drive with --provider ${PROVIDERS.join(' | ')}.`,
    );
  }
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
  return { dest: join(roots[0].path, sub), base: roots[0].path, source: `${name} (${roots[0].label})` };
}

// ── Safety ───────────────────────────────────────────────────────────────

export function canonical(path) {
  // realpath of the deepest ancestor that exists, so a not-yet-created
  // destination under a symlinked folder is still compared by its real place.
  let probe = resolve(path);
  const tail = [];
  while (!existsSync(probe) && dirname(probe) !== probe) {
    tail.unshift(basename(probe));
    probe = dirname(probe);
  }
  let real = probe;
  try { real = realpathSync.native(probe); } catch { /* keep lexical */ }
  return join(real, ...tail);
}

const within = (child, parent) => {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

/**
 * The provider whose sync folder holds `dest`, or null. Uses the same folders
 * `--provider` resolves, so a `--dest` pointed into one is recognised too.
 */
export function syncProviderOf(dest, machine = {}) {
  // Compared case-insensitively: macOS and Windows volumes ignore case, and a
  // false match only refuses a flag, so erring wide is safe.
  const d = canonical(dest).toLowerCase();
  for (const name of PROVIDERS) {
    for (const root of providerRoots(name, machine)) {
      if (within(d, canonical(root.path).toLowerCase())) return name;
    }
  }
  return null;
}

/** Refuse contact files going into a recognized sync folder: the client would upload them. */
export function assertContactsNotSynced(dest, includeContacts, machine = {}) {
  const synced = includeContacts ? syncProviderOf(dest, machine) : null;
  if (synced) {
    throw new Error(`--include-contacts cannot be used with a folder inside ${synced} (${dest}): the sync client would upload the contact files. Use a folder that is not synced.`);
  }
}

/** The destination must not sit inside what it backs up (it would copy itself). */
export function assertSafeDestination(dest, dataRoot, codeRoot = CODE_ROOT) {
  const d = canonical(dest);
  for (const base of [dataRoot, codeRoot]) {
    if (within(d, canonical(base))) {
      throw new Error(`Backup folder ${dest} is inside ${base}. Choose a folder outside your career-ops files.`);
    }
  }
  // A destination that holds the data root would map a backed-up file onto the
  // live one (dest/config/profile.yml is the live config/profile.yml).
  for (const base of [dataRoot, codeRoot]) {
    if (within(canonical(base), d)) {
      throw new Error(`Backup folder ${dest} contains ${base}. Choose a separate folder.`);
    }
  }
}

// ── Copy ─────────────────────────────────────────────────────────────────

/** True when a folder on the way down to `entry` is a symlink (it could lead out of the data root). */
function hasSymlinkedParent(dataRoot, entry) {
  let current = dataRoot;
  for (const part of entry.split('/').filter(Boolean).slice(0, -1)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Regular files under `dataRoot/entry` (a file or a folder), as
 * `{ rel, size, mtimeMs }`. A file that cannot be read is reported through
 * `onError` and skipped, so one bad file never hides the rest.
 */
function listEntry(dataRoot, entry, { include, onError, onSkip = () => {} }) {
  const abs = join(dataRoot, entry);
  let st;
  try {
    st = lstatSync(abs);
  } catch (error) {
    // Only an absent path stays silent; an unreadable parent would otherwise drop the entry unreported.
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') onError(entry, error);
    return [];
  }
  if (st.isSymbolicLink() || hasSymlinkedParent(dataRoot, entry)) {
    onSkip(entry);
    return [];
  }
  if (isExcluded(entry, include)) return [];
  const paths = st.isDirectory()
    ? walkTree(abs, {
      // Symlinks are skipped (the default), so the backup never follows a link
      // out of the data root.
      // Nested checkouts (a git-cloned plugin under plugins.local/) are the
      // user's own work, so they are copied rather than skipped.
      allowNestedCheckouts: true,
      skip: (dirent, dir) => {
        const p = join(dir, dirent.name);
        if (isExcluded(relative(dataRoot, p), include)) return true;
        // walkTree throws on a folder it cannot read, which would lose every
        // other file under this entry. Report that folder and carry on without it.
        if (dirent.isDirectory()) {
          try {
            accessSync(p, fsConstants.R_OK | fsConstants.X_OK);
            readdirSync(p);
          } catch (error) {
            onError(relative(dataRoot, p), error);
            return true;
          }
        }
        return false;
      },
    })
    : [abs];
  const files = [];
  for (const p of paths) {
    try {
      const s = statSync(p);
      files.push({ rel: relative(dataRoot, p), size: s.size, mtimeMs: s.mtimeMs });
    } catch (error) {
      onError(relative(dataRoot, p), error);
    }
  }
  return files;
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
 * Copy every backed-up file under `dataRoot` to `dest`. Throws only when the
 * destination folder cannot be created; every per-file problem lands in
 * `failed` and the run carries on. `found` counts the files discovered (copied
 * or not), so a run that found nothing is distinguishable from one that found
 * only unchanged files.
 * @returns {{found: number, copied: number, unchanged: number, failed: {path: string, error: string}[], bytes: number, warnings: string[]}}
 */
export function runBackup({ dataRoot, dest, dryRun = false, includeContacts = false }) {
  const syncedTo = syncProviderOf(dest);
  const include = { includeContacts, skipAgentSettings: Boolean(syncedTo) };
  const result = { found: 0, copied: 0, unchanged: 0, failed: [], bytes: 0, warnings: [] };
  const fail = (path, error) => result.failed.push({ path, error: error.message });
  // The exported API enforces this too, not only the CLI: a caller must not be
  // able to point a backup at a folder that overlaps what it reads.
  assertSafeDestination(dest, dataRoot);
  assertContactsNotSynced(dest, includeContacts);
  if (!dryRun) mkdirSync(dest, { recursive: true });
  // With an external data root, fork-local files declared in the checkout's
  // config/local-paths.txt are not looked up there: say so instead of
  // reporting a clean run that silently left them out.
  if (resolve(dataRoot) !== resolve(CODE_ROOT) && existsSync(join(CODE_ROOT, LOCAL_PATHS_FILE))) {
    result.warnings.push(`${LOCAL_PATHS_FILE} in the checkout is not read when the data root is elsewhere; back up fork-local files it declares separately.`);
  }
  let skippedAgentFiles = 0;
  for (const entry of backupPaths(dataRoot, result.warnings, result.failed)) {
    // Count what a synced destination leaves out, from the effective backup
    // paths themselves (declared ones such as .claude/settings.local.json too),
    // so the warning below appears only when a settings file was really skipped.
    if (syncedTo && isAgentSetting(entry.toLowerCase())) {
      try {
        skippedAgentFiles += listEntry(dataRoot, entry, { include: { includeContacts }, onError: () => {} }).length;
      } catch { /* unreadable: nothing to count */ }
      continue;
    }
    let files;
    try {
      files = listEntry(dataRoot, entry, {
        include,
        onError: fail,
        onSkip: (p) => result.warnings.push(`skipped ${p}: it is, or sits under, a symlink`),
      });
    } catch (error) {
      fail(entry, error);
      continue;
    }
    for (const file of files) {
      result.found++;
      const target = join(dest, file.rel);
      // A symlinked folder inside the destination could point back at live files.
      if (hasSymlinkedParent(dest, file.rel.split(sep).join('/'))) {
        fail(file.rel, new Error('a folder in the backup destination is a symlink; not copying through it'));
        continue;
      }
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
        fail(file.rel, error);
      }
    }
  }
  if (skippedAgentFiles > 0) {
    result.warnings.push(`${skippedAgentFiles} agent-tool settings file(s) (.claude/, opencode.json, plugins.local/) were not copied: the destination is in a ${syncedTo} folder and they can contain tokens. Back them up to a folder that is not synced.`);
  }
  if (!dryRun && result.found > 0) {
    try {
      writeFileSync(join(dest, MANIFEST_NAME), `${JSON.stringify({
        lastRun: new Date().toISOString(),
        found: result.found,
        copied: result.copied,
        unchanged: result.unchanged,
        failed: result.failed.length,
      }, null, 2)}\n`);
    } catch (error) {
      fail(MANIFEST_NAME, error);
    }
  }
  return result;
}

// ── CLI ──────────────────────────────────────────────────────────────────

const KNOWN_FLAGS = ['--dest', '--provider', '--account', '--folder', '--include-contacts', '--dry-run', '--json', '--quiet', '--help', '-h'];
const VALUE_FLAGS = ['--dest', '--provider', '--account', '--folder'];

const USAGE = `Usage:
  node backup.mjs --dest <dir>             # back up to exactly this folder
  node backup.mjs --provider google-drive  # <drive>/Backups/career-ops; also dropbox | onedrive | icloud
  node backup.mjs --provider <name> --account <text>   # pick one drive when several are signed in
  node backup.mjs --provider <name> --folder <relative/path>   # folder under the drive (default Backups/career-ops)
  node backup.mjs ... --include-contacts # also copy Connections.csv, contacts.tsv, reply-candidates.json, output/contacts.vcf and any other .vcf (other people's contact details); not with --provider. A --dest inside a recognized sync folder is refused too, but verify yourself that the destination is not synced
  node backup.mjs ... --dry-run            # show what would be copied, copy nothing
  node backup.mjs ... --json | --quiet     # machine-readable result | errors only
  CAREER_OPS_BACKUP_DIR=<dir>              # same as --dest
Nothing is chosen for you: pass --dest, set CAREER_OPS_BACKUP_DIR, or name a drive with --provider.`;

function main(args) {
  // Exit 1 means "a file failed", so a mistyped command is 2.
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true, usageExitCode: 2 });
  const json = args.includes('--json');
  const quiet = args.includes('--quiet');
  const dryRun = args.includes('--dry-run');
  const includeContacts = args.includes('--include-contacts');
  const refuse = (message) => {
    if (json) console.log(JSON.stringify({ ok: false, error: message }));
    else console.error(`backup: ${message}`);
    return 2;
  };

  // The export holds other people's contact details and a provider folder is
  // uploaded by a sync client, so the two flags never combine.
  if (includeContacts && flagValue(args, '--provider')) {
    return refuse('--include-contacts cannot be combined with --provider (the contact files would be uploaded by the sync client). Use --dest with a folder you control.');
  }

  let dataRoot;
  let target;
  try {
    dataRoot = getCareerOpsRoot();
    target = resolveDestination({
      dest: flagValue(args, '--dest'),
      provider: flagValue(args, '--provider'),
      account: flagValue(args, '--account'),
      folder: flagValue(args, '--folder'),
    });
    assertSafeDestination(target.dest, dataRoot);
    assertContactsNotSynced(target.dest, includeContacts);
    // A provider destination only needs its drive to be there: runBackup creates
    // Backups/career-ops under it. --dest and CAREER_OPS_BACKUP_DIR need their parent.
    const mustExist = target.base ?? dirname(target.dest);
    if (!existsSync(mustExist)) {
      throw new Error(`${mustExist} does not exist (is the drive mounted?). Nothing was created.`);
    }
  } catch (error) {
    return refuse(error.message);
  }

  let result;
  try {
    result = runBackup({ dataRoot, dest: target.dest, dryRun, includeContacts });
  } catch (error) {
    return refuse(`cannot write to ${target.dest}: ${error.message}`);
  }
  const empty = result.found === 0;
  const ok = result.failed.length === 0 && !empty;
  if (json) {
    console.log(JSON.stringify({ ok, dryRun, dest: target.dest, via: target.source, ...result }));
  } else {
    for (const w of result.warnings) console.error(`backup: ${w}`);
    for (const f of result.failed) console.error(`backup: failed ${f.path}: ${f.error}`);
    if (empty) {
      console.error(`backup: found nothing to back up under ${dataRoot}. Is CAREER_OPS_ROOT (or the data root) the right folder?`);
    } else if (!quiet) {
      const mb = (result.bytes / 1048576).toFixed(1);
      console.log(`${dryRun ? 'Would copy' : 'Copied'} ${result.copied} file(s) (${mb} MB), ${result.unchanged} unchanged -> ${target.dest} [${target.source}]`);
    }
  }
  return ok ? 0 : 1;
}

if (isMainModule(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
