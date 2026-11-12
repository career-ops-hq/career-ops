// tests/backup.test.mjs — backup.mjs: destination discovery, exclusions, copy.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync, realpathSync, utimesSync, symlinkSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import assert from 'node:assert/strict';

console.log('\nbackup.mjs — back up the User Layer to a drive or folder');
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'co-backup-')));
// An ambient override would change which template variants count as yours.
const ambientProfile = process.env.CAREER_OPS_PROFILE;
delete process.env.CAREER_OPS_PROFILE;
try {
  const b = await import(pathToFileURL(join(ROOT, 'backup.mjs')).href);
  const put = (base, rel, text = 'x') => {
    mkdirSync(join(base, rel, '..'), { recursive: true });
    writeFileSync(join(base, rel), text);
  };

  // Exclusions: secrets, third-party PII, caches, lock/temp files.
  for (const rel of ['.env', 'data/.env', 'data/cache/http/a', '.DS_Store', 'data/x.lock', 'data/y.part']) {
    assert.equal(b.isExcluded(rel), true, rel);
  }
  for (const rel of ['cv.md', 'data/applications.md', 'data/cacheable.md', 'reports/001-a.md']) {
    assert.equal(b.isExcluded(rel), false, rel);
  }
  // The LinkedIn export holds other people's contact details: opt-in only.
  assert.equal(b.isExcluded('data/Connections.csv'), true);
  assert.equal(b.isExcluded('data/connections.csv'), true);
  assert.equal(b.isExcluded('Data/CONNECTIONS.CSV'), true);
  assert.equal(b.isExcluded('data/contacts.tsv'), true);
  assert.equal(b.isExcluded('data/reply-candidates.json'), true);
  assert.equal(b.isExcluded('output/contacts.vcf'), true);
  assert.equal(b.isExcluded('output/Contacts.VCF'), true);
  assert.equal(b.isExcluded('output/contacts.vcf', { includeContacts: true }), false);
  assert.equal(b.isExcluded('output/caller-id.vcf'), true);
  // Copies of a contact file go with it (and are included with it); unrelated copies are not held back.
  for (const f of ['data/contacts.tsv.bak', 'data/Connections.csv.orig', 'output/contacts.vcf.bak', 'data/.contacts.tsv.bak', 'data/.Connections.csv', 'output/.contacts.vcf', 'output/.vcf']) {
    assert.equal(b.isExcluded(f), true, f);
    assert.equal(b.isExcluded(f, { includeContacts: true }), false, `${f} with --include-contacts`);
  }
  // Editor swap/autosave files are never copied, even with --include-contacts.
  for (const f of ['data/.contacts.tsv.swp', 'data/.reply-candidates.json.swo', 'data/#contacts.tsv#', 'data/.contacts.tsv.swn', 'data/.#contacts.tsv', 'data/contacts.tsv.swm']) {
    assert.equal(b.isExcluded(f), true, f);
    assert.equal(b.isExcluded(f, { includeContacts: true }), true, `${f} with --include-contacts`);
  }
  assert.equal(b.isExcluded('data/applications.md.bak'), false);
  // Editor temp files are never copied, for any file; secrets keep their editor copies out too.
  for (const f of ['data/.applications.md.swp', 'data/#applications.md#', 'data/.#applications.md', 'data/..env.swp', 'data/#.env#', 'data/.env.bak', 'data/.env~', 'cv.md~']) {
    assert.equal(b.isExcluded(f), true, f);
    assert.equal(b.isExcluded(f, { includeContacts: true }), true, `${f} with --include-contacts`);
  }
  assert.equal(b.isExcluded('data/applications.md'), false);
  assert.equal(b.isExcluded('~'), false);
  assert.equal(b.isExcluded('output/sub/Phone.VCF'), true);
  assert.equal(b.isExcluded('output/caller-id.vcf', { includeContacts: true }), false);
  assert.equal(b.isExcluded('output/cv.pdf'), false);
  assert.equal(b.isExcluded('data/contacts.tsv', { includeContacts: true }), false);
  assert.equal(b.isExcluded('config/.ENV'), true);
  assert.equal(b.isExcluded('plugins.local/x/.git/config'), true);
  assert.equal(b.isExcluded('plugins.local/x/node_modules/a.js'), true);
  assert.equal(b.isExcluded('plugins.local/x/index.mjs'), false);
  assert.equal(b.isExcluded('data/Connections.csv', { includeContacts: true }), false);
  pass('excludes secrets, caches, lock/temp files and the LinkedIn export unless asked');

  // The file list is the updater's USER_PATHS, not a second copy.
  const listed = b.backupPaths(tmp);
  for (const p of ['cv.md', 'data', 'reports', '.career-ops-web', 'config/profile.yml', 'config/local-paths.txt']) {
    assert.ok(listed.includes(p), `backs up ${p}`);
  }
  assert.ok(!listed.some((p) => p.endsWith('/')), 'no trailing slashes');
  pass('file list comes from USER_PATHS');

  // Destination discovery, on a fake home.
  const home = join(tmp, 'home');
  const cloud = join(home, 'Library', 'CloudStorage');
  const opts = { home, platform: 'darwin', env: {}, provider: 'google-drive' };
  assert.throws(() => b.resolveDestination({ home, platform: 'darwin', env: {} }), /No backup destination chosen/);
  assert.throws(() => b.resolveDestination({ home, platform: 'darwin', env: {}, account: 'me@' }), /No backup destination chosen/);
  assert.throws(() => b.resolveDestination(opts), /No google-drive folder found/);

  mkdirSync(join(cloud, 'GoogleDrive-me@example.com', 'My Drive'), { recursive: true });
  const one = b.resolveDestination(opts);
  assert.equal(one.dest, join(cloud, 'GoogleDrive-me@example.com', 'My Drive', 'Backups', 'career-ops'));
  assert.equal(b.resolveDestination({ ...opts, folder: 'Work/co' }).dest.endsWith(join('My Drive', 'Work', 'co')), true);
  assert.throws(() => b.resolveDestination({ ...opts, folder: '../x' }), /relative path/);

  mkdirSync(join(cloud, 'GoogleDrive-work@example.com', 'My Drive'), { recursive: true });
  assert.throws(() => b.resolveDestination(opts), /will not guess/);
  assert.match(b.resolveDestination({ ...opts, account: 'work@' }).dest, /work@example\.com/);
  assert.throws(() => b.resolveDestination({ ...opts, account: 'nobody' }), /matches --account/);
  assert.throws(() => b.resolveDestination({ ...opts, provider: 'box' }), /Unknown provider/);
  pass('no default drive, --provider google-drive, --account for several drives, no guessing');

  mkdirSync(join(home, 'Dropbox'), { recursive: true });
  assert.equal(b.resolveDestination({ ...opts, provider: 'dropbox' }).dest, join(home, 'Dropbox', 'Backups', 'career-ops'));
  const flag = b.resolveDestination({ ...opts, dest: join(tmp, 'flag'), env: { CAREER_OPS_BACKUP_DIR: join(tmp, 'env') } });
  assert.equal(flag.dest, join(tmp, 'flag'));
  assert.equal(b.resolveDestination({ ...opts, env: { CAREER_OPS_BACKUP_DIR: join(tmp, 'env') } }).dest, join(tmp, 'env'));
  pass('--dest beats CAREER_OPS_BACKUP_DIR beats drive discovery; other providers work');

  // Refuses a destination inside the data it backs up.
  const root = join(tmp, 'root');
  mkdirSync(root, { recursive: true });
  assert.throws(() => b.assertSafeDestination(join(root, 'out', 'bk'), root, join(tmp, 'code')), /inside/);
  assert.throws(() => b.assertSafeDestination(root, root, join(tmp, 'code')), /inside/);
  b.assertSafeDestination(join(tmp, 'elsewhere'), root, join(tmp, 'code'));
  assert.throws(() => b.assertSafeDestination(tmp, root, join(tmp, 'code')), /contains/);
  // A case-different spelling of the data root is the same folder on a case-insensitive volume.
  if (existsSync(root.toUpperCase()) && root.toUpperCase() !== root) {
    assert.throws(() => b.assertSafeDestination(join(root.toUpperCase(), 'out', 'bk'), root, join(tmp, 'code')), /inside/);
  }
  pass('refuses a destination inside the data root');

  // Copy: whole files, exclusions honoured, unchanged skipped, nothing deleted.
  put(root, 'cv.md', 'cv');
  put(root, 'data/applications.md', 'tracker');
  put(root, 'data/.env', 'SECRET=1');
  put(root, 'data/Connections.csv', 'connections');
  put(root, 'data/contacts.tsv', 'contacts');
  put(root, 'data/reply-candidates.json', '[]');
  put(root, '.career-ops-web/chats.json', '{}');
  put(root, 'data/cache/http/h', 'cache');
  put(root, 'reports/001-a-2026-01-01.md', 'report');
  put(root, 'node_modules/x/index.js', 'not user data');
  put(root, '.claude/settings.json', '{"env":{"TOKEN":"x"}}');
  put(root, 'opencode.json', '{}');
  put(root, 'modes/_shared.md', 'system file');
  const dest = join(tmp, 'backup', 'career-ops');
  mkdirSync(join(tmp, 'backup'));

  // The exported API refuses contact files bound for a synced folder too, not only the CLI.
  const apiHome = join(tmp, 'api-home');
  mkdirSync(join(apiHome, 'Dropbox'), { recursive: true });
  const savedHome = process.env.HOME;
  const savedProfile = process.env.USERPROFILE;
  process.env.HOME = apiHome;
  process.env.USERPROFILE = apiHome;
  try {
    const syncedDest = join(apiHome, 'Dropbox', 'Backups', 'career-ops');
    assert.throws(() => b.runBackup({ dataRoot: root, dest: syncedDest, includeContacts: true }), /inside dropbox/);
    assert.equal(existsSync(syncedDest), false);
    assert.doesNotThrow(() => b.runBackup({ dataRoot: root, dest: syncedDest, dryRun: true }));
  } finally {
    // Assigning undefined would store the string "undefined", so delete when unset.
    for (const [key, value] of [['HOME', savedHome], ['USERPROFILE', savedProfile]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const dry = b.runBackup({ dataRoot: root, dest, dryRun: true });
  assert.equal(dry.copied, 6);
  assert.equal(dry.found, 6);
  assert.equal(existsSync(dest), false);

  const first = b.runBackup({ dataRoot: root, dest });
  assert.equal(first.copied, 6);
  assert.equal(first.found, 6);
  assert.deepEqual(first.failed, []);
  assert.equal(readFileSync(join(dest, 'data/applications.md'), 'utf8'), 'tracker');
  for (const rel of ['data/.env', 'data/cache/http/h', 'node_modules/x/index.js', 'modes/_shared.md']) {
    assert.equal(existsSync(join(dest, rel)), false, rel);
  }
  assert.equal(existsSync(join(dest, 'data/Connections.csv')), false, 'LinkedIn export is opt-in');
  assert.equal(existsSync(join(dest, 'data/contacts.tsv')), false, 'contacts are opt-in');
  assert.equal(existsSync(join(dest, 'data/reply-candidates.json')), false, 'reply candidates are opt-in');
  assert.equal(readFileSync(join(dest, '.career-ops-web/chats.json'), 'utf8'), '{}');
  assert.equal(JSON.parse(readFileSync(join(dest, b.MANIFEST_NAME), 'utf8')).copied, 6);

  const second = b.runBackup({ dataRoot: root, dest });
  assert.equal(second.copied, 0);
  assert.equal(second.unchanged, 6);

  put(root, 'cv.md', 'cv, edited');
  utimesSync(join(root, 'cv.md'), new Date(), new Date(Date.now() + 60_000));
  assert.equal(b.runBackup({ dataRoot: root, dest }).copied, 1);
  assert.equal(readFileSync(join(dest, 'cv.md'), 'utf8'), 'cv, edited');

  rmSync(join(root, 'reports/001-a-2026-01-01.md'));
  b.runBackup({ dataRoot: root, dest });
  assert.equal(existsSync(join(dest, 'reports/001-a-2026-01-01.md')), true);
  pass('copies only user files, skips unchanged, re-copies edits, never deletes');

  assert.equal(existsSync(join(dest, '.claude/settings.json')), true, 'USER_PATHS files are copied');
  assert.equal(existsSync(join(dest, 'opencode.json')), true);
  const withConnections = b.runBackup({ dataRoot: root, dest, includeContacts: true });
  assert.equal(withConnections.copied, 3);
  assert.equal(readFileSync(join(dest, 'data/contacts.tsv'), 'utf8'), 'contacts');
  assert.equal(readFileSync(join(dest, 'data/Connections.csv'), 'utf8'), 'connections');
  pass('--include-contacts copies the LinkedIn export, contacts and reply candidates');

  assert.throws(() => b.runBackup({ dataRoot: root, dest: join(root, 'out') }), /inside/);
  assert.throws(() => b.runBackup({ dataRoot: root, dest: tmp }), /contains/);
  pass('runBackup itself rejects a destination that overlaps the data root');

  // Nothing found: reported, not a silent success; no manifest written.
  const empty = join(tmp, 'empty-root');
  mkdirSync(empty);
  const none = b.runBackup({ dataRoot: empty, dest: join(tmp, 'backup', 'empty') });
  assert.equal(none.found, 0);
  assert.equal(existsSync(join(tmp, 'backup', 'empty', b.MANIFEST_NAME)), false);
  // A run of only unchanged files is not "nothing found".
  assert.equal(b.runBackup({ dataRoot: root, dest, includeContacts: true }).found, 8);
  pass('a run that finds nothing says so; unchanged files still count as found');

  // A symlinked parent can lead out of the data root: skipped.
  const linked = join(tmp, 'linked-root');
  const outside = join(tmp, 'outside');
  put(outside, 'profile.yml', 'private');
  put(linked, 'cv.md', 'cv');
  let canLink = true;
  try { symlinkSync(outside, join(linked, 'config')); } catch { canLink = false; }
  if (canLink) {
  const viaLink = b.runBackup({ dataRoot: linked, dest: join(tmp, 'backup', 'linked') });
  assert.equal(viaLink.copied, 1);
  assert.equal(existsSync(join(tmp, 'backup', 'linked', 'config', 'profile.yml')), false);
  pass('skips a symlinked parent folder');
  } else {
    pass('skips a symlinked parent folder (skipped: cannot create symlinks here)');
  }

  // A symlinked folder inside the destination must not be written through.
  if (canLink) {
    const srcRoot = join(tmp, 'sym-src');
    put(srcRoot, 'cv.md', 'cv');
    put(srcRoot, 'config/profile.yml', 'mine');
    const symDest = join(tmp, 'backup', 'sym-dest');
    const live = join(tmp, 'sym-live');
    put(live, 'profile.yml', 'LIVE');
    mkdirSync(symDest, { recursive: true });
    symlinkSync(live, join(symDest, 'config'));
    const through = b.runBackup({ dataRoot: srcRoot, dest: symDest });
    assert.equal(readFileSync(join(live, 'profile.yml'), 'utf8'), 'LIVE');
    assert.equal(through.failed.length, 1);
    pass('does not write through a symlinked folder in the destination');
  }

  // One unreadable file is a failure entry; the rest of the run carries on.
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    const bad = join(tmp, 'bad-root');
    put(bad, 'cv.md', 'cv');
    put(bad, 'data/locked.md', 'locked');
    put(bad, 'data/ok.md', 'ok');
    chmodSync(join(bad, 'data/locked.md'), 0o000);
    const partial = b.runBackup({ dataRoot: bad, dest: join(tmp, 'backup', 'bad') });
    chmodSync(join(bad, 'data/locked.md'), 0o600);
    assert.equal(partial.failed.length, 1);
    assert.equal(partial.failed[0].path, join('data', 'locked.md'));
    assert.equal(partial.copied, 2);

    // One unreadable folder is a failure entry too; the other files still back up.
    const lockedDir = join(tmp, 'locked-dir-root');
    put(lockedDir, 'cv.md', 'cv');
    put(lockedDir, 'output/ok.md', 'ok');
    put(lockedDir, 'output/private/secret.md', 'x');
    chmodSync(join(lockedDir, 'output/private'), 0o000);
    let dirRun;
    try {
      dirRun = b.runBackup({ dataRoot: lockedDir, dest: join(tmp, 'backup', 'locked-dir') });
    } finally {
      chmodSync(join(lockedDir, 'output/private'), 0o700);
    }
    assert.equal(dirRun.failed.length, 1);
    assert.equal(dirRun.failed[0].path, join('output', 'private'));
    assert.equal(existsSync(join(tmp, 'backup', 'locked-dir', 'output', 'ok.md')), true);

    // An entry under an unreadable parent folder is reported, not dropped.
    const lockedParent = join(tmp, 'locked-parent-root');
    put(lockedParent, 'cv.md', 'cv');
    put(lockedParent, 'config/profile.yml', 'x: 1\n');
    chmodSync(join(lockedParent, 'config'), 0o000);
    let parentRun;
    try {
      parentRun = b.runBackup({ dataRoot: lockedParent, dest: join(tmp, 'backup', 'locked-parent') });
    } finally {
      chmodSync(join(lockedParent, 'config'), 0o700);
    }
    assert.equal(parentRun.failed.some((f) => f.path.startsWith('config')), true);

    // An unreadable templates/ folder is a failure, not a silent omission.
    const lockedTpl = join(tmp, 'locked-tpl-root');
    put(lockedTpl, 'cv.md', 'cv');
    put(lockedTpl, 'templates/cv-jane-acme.html', 'generated');
    chmodSync(join(lockedTpl, 'templates'), 0o000);
    let tplFail;
    try {
      tplFail = b.runBackup({ dataRoot: lockedTpl, dest: join(tmp, 'backup', 'locked-tpl') });
    } finally {
      chmodSync(join(lockedTpl, 'templates'), 0o700);
    }
    assert.equal(tplFail.failed.some((f) => f.path === 'templates'), true);
    assert.equal(existsSync(join(tmp, 'backup', 'bad', 'data', 'ok.md')), true);
    pass('an I/O error on one file does not abort the run');
  }

  // plugins.lock is a User Layer file despite the .lock suffix.
  const lockRoot = join(tmp, 'lock-root');
  put(lockRoot, 'plugins.lock', '{}');
  put(lockRoot, 'other.lock', 'x');
  const lockRun = b.runBackup({ dataRoot: lockRoot, dest: join(tmp, 'backup', 'lock') });
  assert.equal(existsSync(join(tmp, 'backup', 'lock', 'plugins.lock')), true);
  assert.equal(existsSync(join(tmp, 'backup', 'lock', 'other.lock')), false);
  assert.equal(lockRun.failed.length, 0);

  // Agent-tool settings headed for a synced folder carry a warning.
  const warnHome = join(tmp, 'warn-home');
  mkdirSync(join(warnHome, 'Dropbox'), { recursive: true });
  const warnRoot = join(tmp, 'warn-root');
  put(warnRoot, 'cv.md', 'cv');
  put(warnRoot, '.claude/settings.json', '{}');
  const prevHome = process.env.HOME;
  const prevProfile = process.env.USERPROFILE;
  process.env.HOME = warnHome;
  process.env.USERPROFILE = warnHome;
  try {
    const syncedRun = b.runBackup({ dataRoot: warnRoot, dest: join(warnHome, 'Dropbox', 'Backups', 'career-ops') });
    // Agent-tool settings are kept out of a synced destination, and the run says so.
    assert.equal(syncedRun.warnings.some((w) => /agent-tool settings.*not copied.*dropbox/.test(w)), true);
    assert.equal(existsSync(join(warnHome, 'Dropbox', 'Backups', 'career-ops', '.claude', 'settings.json')), false);
    assert.equal(existsSync(join(warnHome, 'Dropbox', 'Backups', 'career-ops', 'cv.md')), true);
    // No warning when nothing was skipped: shipped .claude/skills/ is not a settings file.
    const skillsRoot = join(tmp, 'skills-root');
    put(skillsRoot, 'cv.md', 'cv');
    put(skillsRoot, '.claude/skills/career-ops/SKILL.md', 'shipped');
    const skillsRun = b.runBackup({ dataRoot: skillsRoot, dest: join(warnHome, 'Dropbox', 'Backups', 'skills') });
    assert.equal(skillsRun.warnings.some((w) => /agent-tool settings/.test(w)), false);
    // A declared settings file is counted and left out too.
    const declRoot = join(tmp, 'decl-agent-root');
    put(declRoot, 'cv.md', 'cv');
    put(declRoot, 'config/local-paths.txt', '.claude/settings.local.json\n');
    put(declRoot, '.claude/settings.local.json', '{}');
    const declRun = b.runBackup({ dataRoot: declRoot, dest: join(warnHome, 'Dropbox', 'Backups', 'decl') });
    assert.equal(declRun.warnings.some((w) => /1 agent-tool settings file\(s\).*not copied/.test(w)), true);
    assert.equal(existsSync(join(warnHome, 'Dropbox', 'Backups', 'decl', '.claude', 'settings.local.json')), false);
    const localRun = b.runBackup({ dataRoot: warnRoot, dest: join(tmp, 'backup', 'warn-local') });
    assert.equal(localRun.warnings.some((w) => /agent-tool settings/.test(w)), false);
    assert.equal(existsSync(join(tmp, 'backup', 'warn-local', '.claude', 'settings.json')), true);
  } finally {
    for (const [key, value] of [['HOME', prevHome], ['USERPROFILE', prevProfile]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  // A missing first component directly under a root must keep its full name.
  assert.equal(b.canonical(join(process.platform === 'win32' ? process.cwd().slice(0, 3) : '/', 'career-ops-no-such-dir', 'x')).endsWith(join('career-ops-no-such-dir', 'x')), true);

  // templates/ holds shipped files and yours: only generated CVs/covers and the
  // configured variant are backed up.
  const tplRoot = join(tmp, 'tpl-root');
  put(tplRoot, 'cv.md', 'cv');
  put(tplRoot, 'config/profile.yml', 'cv:\n  template: mine\n');
  put(tplRoot, 'templates/cv-jane-acme.html', 'generated');
  put(tplRoot, 'templates/cover-jane-acme.html', 'generated');
  put(tplRoot, 'templates/cv-template.html', 'shipped');
  put(tplRoot, 'templates/cv-template.mine.html', 'configured variant');
  put(tplRoot, 'templates/my-pack/cv-template.mine.html', 'packed variant');
  put(tplRoot, 'templates/cv-template.other.html', 'unconfigured variant');
  put(tplRoot, 'templates/cover-letter-template.html', 'shipped');
  const tplRun = b.runBackup({ dataRoot: tplRoot, dest: join(tmp, 'backup', 'tpl') });
  const has = (f) => existsSync(join(tmp, 'backup', 'tpl', 'templates', f));
  assert.deepEqual(
    ['cv-jane-acme.html', 'cover-jane-acme.html', 'cv-template.mine.html', 'my-pack/cv-template.mine.html'].map(has),
    [true, true, true, true],
  );
  assert.deepEqual(
    ['cv-template.html', 'cv-template.other.html', 'cover-letter-template.html'].map(has),
    [false, false, false],
  );
  assert.equal(tplRun.failed.length, 0);

  // A variant selected only by the CAREER_OPS_PROFILE override is yours too.
  const ovRoot = join(tmp, 'ov-root');
  put(ovRoot, 'cv.md', 'cv');
  put(ovRoot, 'config/profile.yml', 'cv:\n  template: standard\n');
  put(ovRoot, 'templates/cv-template.mine.html', 'selected by the override');
  put(ovRoot, 'templates/cv-template.other.html', 'unselected');
  const overrideProfile = join(tmp, 'override-profile.yml');
  writeFileSync(overrideProfile, 'cv:\n  template: mine\n');
  const savedOverride = process.env.CAREER_OPS_PROFILE;
  process.env.CAREER_OPS_PROFILE = overrideProfile;
  try {
    const ovRun = b.runBackup({ dataRoot: ovRoot, dest: join(tmp, 'backup', 'ov') });
    // The active profile lives outside the data root, so the run says it was not copied.
    assert.ok(ovRun.warnings.some((w) => w.includes('CAREER_OPS_PROFILE') && w.includes('not copied')));
  } finally {
    if (savedOverride === undefined) delete process.env.CAREER_OPS_PROFILE;
    else process.env.CAREER_OPS_PROFILE = savedOverride;
  }
  // Without an override, a profile elsewhere (the process-wide data root) is not consulted,
  // even when that profile selects the variant.
  const noOvRoot = join(tmp, 'no-ov-root');
  put(noOvRoot, 'cv.md', 'cv');
  put(noOvRoot, 'templates/cv-template.mine.html', 'not selected here');
  const globalRoot = join(tmp, 'global-root');
  put(globalRoot, 'config/profile.yml', 'cv:\n  template: mine\n');
  const savedEnv = { profile: process.env.CAREER_OPS_PROFILE, root: process.env.CAREER_OPS_ROOT };
  delete process.env.CAREER_OPS_PROFILE;
  process.env.CAREER_OPS_ROOT = globalRoot;
  try {
    b.runBackup({ dataRoot: noOvRoot, dest: join(tmp, 'backup', 'no-ov') });
  } finally {
    for (const [key, value] of [['CAREER_OPS_PROFILE', savedEnv.profile], ['CAREER_OPS_ROOT', savedEnv.root]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.equal(existsSync(join(tmp, 'backup', 'no-ov', 'templates', 'cv-template.mine.html')), false);
  const ovHas = (f) => existsSync(join(tmp, 'backup', 'ov', 'templates', f));
  assert.deepEqual(['cv-template.mine.html', 'cv-template.other.html'].map(ovHas), [true, false]);

  // An inline-mapping profile selects a variant too (same reader as the resolver).
  const inlRoot = join(tmp, 'inl-root');
  put(inlRoot, 'cv.md', 'cv');
  put(inlRoot, 'config/profile.yml', 'cv: { template: mine }\n');
  put(inlRoot, 'templates/cv-template.mine.html', 'inline selected');
  const inlRun = b.runBackup({ dataRoot: inlRoot, dest: join(tmp, 'backup', 'inl') });
  assert.equal(existsSync(join(tmp, 'backup', 'inl', 'templates', 'cv-template.mine.html')), true);
  assert.equal(inlRun.failed.length, 0);

  // A profile that cannot be parsed is a reported failure, not a warning.
  const badProf = join(tmp, 'badprof-root');
  put(badProf, 'cv.md', 'cv');
  put(badProf, 'config/profile.yml', 'cv: [unclosed\n');
  const badRun = b.runBackup({ dataRoot: badProf, dest: join(tmp, 'backup', 'badprof') });
  assert.equal(badRun.failed.some((f) => f.path.endsWith('profile.yml')), true);

  // A destination that holds the checkout is refused when the data root is elsewhere.
  assert.throws(() => b.assertSafeDestination(join(tmp, 'co-parent'), join(tmp, 'dr'), join(tmp, 'co-parent', 'checkout')), /contains/);

  // A declaration file that cannot be parsed is reported as a failure; the built-in list is still backed up.
  const decl = join(tmp, 'decl-root');
  put(decl, 'cv.md', 'cv');
  put(decl, 'config/local-paths.txt', '/etc/passwd\n');
  const warned = b.runBackup({ dataRoot: decl, dest: join(tmp, 'backup', 'decl') });
  assert.equal(warned.failed.filter((f) => f.path === 'config/local-paths.txt').length, 1);
  assert.equal(warned.copied, 2);
  pass('an unparseable local-paths.txt is a failure and still backs up the built-in paths');

  // CLI: JSON result and exit codes, against the fixture root.
  const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_BACKUP_DIR: '' };
  const cli = (...args) => spawnSync(NODE, ['backup.mjs', ...args], { cwd: ROOT, env, encoding: 'utf8' });
  const ok = cli('--dest', join(tmp, 'backup', 'cli'), '--json');
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).ok, true);
  const noParent = cli('--dest', join(tmp, 'missing-drive', 'career-ops'), '--json');
  assert.equal(noParent.status, 2);
  assert.equal(existsSync(join(tmp, 'missing-drive')), false);
  assert.equal(cli('--dest', join(root, 'bk'), '--quiet').status, 2);
  assert.equal(cli('--dryrun').status, 2);
  assert.equal(cli('--dest').status, 2);
  // Nothing chosen: no default drive.
  const noDest = cli('--json');
  assert.equal(noDest.status, 2);
  assert.match(JSON.parse(noDest.stdout).error, /No backup destination chosen/);
  // A destination that cannot be created is a JSON error, not a stack trace.
  put(tmp, 'a-file', 'x');
  const blocked = cli('--dest', join(tmp, 'a-file', 'sub'), '--json');
  assert.equal(blocked.status, 2);
  assert.equal(JSON.parse(blocked.stdout).ok, false);
  // An empty data root is exit 1 with a message.
  const emptyRun = spawnSync(NODE, ['backup.mjs', '--dest', join(tmp, 'backup', 'e2')], {
    cwd: ROOT, env: { ...env, CAREER_OPS_ROOT: empty }, encoding: 'utf8',
  });
  assert.equal(emptyRun.status, 1);
  assert.match(emptyRun.stderr, /found nothing to back up/);
  const combo = cli('--provider', 'google-drive', '--include-contacts', '--json');
  assert.equal(combo.status, 2);
  assert.match(JSON.parse(combo.stdout).error, /cannot be combined/);
  // --dest inside a sync folder is refused with --include-contacts too.
  const fakeHome = join(tmp, 'home');
  mkdirSync(join(fakeHome, 'Dropbox', 'Backups'), { recursive: true });
  const homeEnv = { ...env, HOME: fakeHome, USERPROFILE: fakeHome };
  const syncedDest = join(fakeHome, 'Dropbox', 'Backups', 'career-ops');
  const synced = spawnSync(NODE, ['backup.mjs', '--dest', syncedDest, '--include-contacts', '--json'], { cwd: ROOT, env: homeEnv, encoding: 'utf8' });
  assert.equal(synced.status, 2);
  assert.match(JSON.parse(synced.stdout).error, /inside dropbox/);
  assert.equal(existsSync(syncedDest), false);
  const mixedCase = spawnSync(NODE, ['backup.mjs', '--dest', join(fakeHome, 'dropbox', 'Backups', 'career-ops'), '--include-contacts', '--json'], { cwd: ROOT, env: homeEnv, encoding: 'utf8' });
  assert.equal(mixedCase.status, 2);
  assert.match(JSON.parse(mixedCase.stdout).error, /inside dropbox/);
  // Without the flag the same destination is fine, and a non-synced one is fine with it.
  const syncedOk = spawnSync(NODE, ['backup.mjs', '--dest', syncedDest, '--json'], { cwd: ROOT, env: homeEnv, encoding: 'utf8' });
  assert.equal(syncedOk.status, 0);
  const localOk = spawnSync(NODE, ['backup.mjs', '--dest', join(tmp, 'backup', 'local-contacts'), '--include-contacts', '--json'], { cwd: ROOT, env: homeEnv, encoding: 'utf8' });
  assert.equal(localOk.status, 0);
  // A fresh drive with no Backups/ folder yet works with --provider.
  const freshHome = join(tmp, 'fresh-home');
  mkdirSync(join(freshHome, 'Dropbox'), { recursive: true });
  const fresh = spawnSync(NODE, ['backup.mjs', '--provider', 'dropbox', '--json'], { cwd: ROOT, env: { ...env, HOME: freshHome, USERPROFILE: freshHome }, encoding: 'utf8' });
  assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
  assert.equal(existsSync(join(freshHome, 'Dropbox', 'Backups', 'career-ops', 'cv.md')), true);
  pass('CLI exits 0 on success, 1 for a failed or empty run, 2 for a bad destination or option');
} catch (e) {
  fail(`backup.mjs: ${e.message}`);
} finally {
  if (ambientProfile === undefined) delete process.env.CAREER_OPS_PROFILE;
  else process.env.CAREER_OPS_PROFILE = ambientProfile;
  rmSync(tmp, { recursive: true, force: true });
}
