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
  for (const rel of ['cv.md', 'data/Connections.csv', 'data/applications.md', 'data/cacheable.md', 'reports/001-a.md']) {
    assert.equal(b.isExcluded(rel), false, rel);
  }
  // Agent-tool settings can hold tokens: opt-in too.
  for (const rel of ['.claude/settings.json', '.claude/hooks/pre.sh', 'opencode.json', 'plugins.local/x/index.mjs']) {
    assert.equal(b.isExcluded(rel), true, rel);
    assert.equal(b.isExcluded(rel, { includeToolConfig: true }), false, rel);
  }
  assert.equal(b.isExcluded('data/opencode.json'), false);
  pass('excludes secrets, caches, lock/temp files, and tool settings unless asked');

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

  mkdirSync(join(cloud, 'GoogleDrive-work@corp.com', 'My Drive'), { recursive: true });
  assert.throws(() => b.resolveDestination(opts), /will not guess/);
  assert.match(b.resolveDestination({ ...opts, account: 'work@' }).dest, /work@corp\.com/);
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
  pass('refuses a destination inside the data root');

  // Copy: whole files, exclusions honoured, unchanged skipped, nothing deleted.
  put(root, 'cv.md', 'cv');
  put(root, 'data/applications.md', 'tracker');
  put(root, 'data/.env', 'SECRET=1');
  put(root, 'data/Connections.csv', 'connections');
  put(root, '.career-ops-web/chats.json', '{}');
  put(root, 'data/cache/http/h', 'cache');
  put(root, 'reports/001-a-2026-01-01.md', 'report');
  put(root, 'node_modules/x/index.js', 'not user data');
  put(root, '.claude/settings.json', '{"env":{"TOKEN":"x"}}');
  put(root, 'opencode.json', '{}');
  put(root, 'modes/_shared.md', 'system file');
  const dest = join(tmp, 'backup', 'career-ops');
  mkdirSync(join(tmp, 'backup'));

  const dry = b.runBackup({ dataRoot: root, dest, dryRun: true });
  assert.equal(dry.copied, 5);
  assert.equal(dry.found, 5);
  assert.equal(existsSync(dest), false);

  const first = b.runBackup({ dataRoot: root, dest });
  assert.equal(first.copied, 5);
  assert.equal(first.found, 5);
  assert.deepEqual(first.failed, []);
  assert.equal(readFileSync(join(dest, 'data/applications.md'), 'utf8'), 'tracker');
  for (const rel of ['data/.env', 'data/cache/http/h', 'node_modules/x/index.js', 'modes/_shared.md']) {
    assert.equal(existsSync(join(dest, rel)), false, rel);
  }
  assert.equal(readFileSync(join(dest, 'data/Connections.csv'), 'utf8'), 'connections');
  assert.equal(readFileSync(join(dest, '.career-ops-web/chats.json'), 'utf8'), '{}');
  assert.equal(JSON.parse(readFileSync(join(dest, b.MANIFEST_NAME), 'utf8')).copied, 5);

  const second = b.runBackup({ dataRoot: root, dest });
  assert.equal(second.copied, 0);
  assert.equal(second.unchanged, 5);

  put(root, 'cv.md', 'cv, edited');
  utimesSync(join(root, 'cv.md'), new Date(), new Date(Date.now() + 60_000));
  assert.equal(b.runBackup({ dataRoot: root, dest }).copied, 1);
  assert.equal(readFileSync(join(dest, 'cv.md'), 'utf8'), 'cv, edited');

  rmSync(join(root, 'reports/001-a-2026-01-01.md'));
  b.runBackup({ dataRoot: root, dest });
  assert.equal(existsSync(join(dest, 'reports/001-a-2026-01-01.md')), true);
  pass('copies only user files, skips unchanged, re-copies edits, never deletes');

  assert.equal(existsSync(join(dest, '.claude')), false, 'tool settings are opt-in');
  const withTool = b.runBackup({ dataRoot: root, dest, includeToolConfig: true });
  assert.equal(withTool.copied, 2);
  assert.equal(existsSync(join(dest, '.claude/settings.json')), true);
  pass('--include-tool-config copies the agent-tool settings');

  // Nothing found: reported, not a silent success; no manifest written.
  const empty = join(tmp, 'empty-root');
  mkdirSync(empty);
  const none = b.runBackup({ dataRoot: empty, dest: join(tmp, 'backup', 'empty') });
  assert.equal(none.found, 0);
  assert.equal(existsSync(join(tmp, 'backup', 'empty', b.MANIFEST_NAME)), false);
  // A run of only unchanged files is not "nothing found".
  assert.equal(b.runBackup({ dataRoot: root, dest, includeToolConfig: true }).found, 6);
  pass('a run that finds nothing says so; unchanged files still count as found');

  // A symlinked parent can lead out of the data root: skipped.
  const linked = join(tmp, 'linked-root');
  const outside = join(tmp, 'outside');
  put(outside, 'profile.yml', 'private');
  put(linked, 'cv.md', 'cv');
  symlinkSync(outside, join(linked, 'config'));
  const viaLink = b.runBackup({ dataRoot: linked, dest: join(tmp, 'backup', 'linked') });
  assert.equal(viaLink.copied, 1);
  assert.equal(existsSync(join(tmp, 'backup', 'linked', 'config', 'profile.yml')), false);
  pass('skips a symlinked parent folder');

  // One unreadable file is a failure entry; the rest of the run carries on.
  if (process.getuid?.() !== 0) {
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
    assert.equal(existsSync(join(tmp, 'backup', 'bad', 'data', 'ok.md')), true);
    pass('an I/O error on one file does not abort the run');
  }

  // A declaration file that cannot be parsed falls back to the built-in list.
  const decl = join(tmp, 'decl-root');
  put(decl, 'cv.md', 'cv');
  put(decl, 'config/local-paths.txt', '/etc/passwd\n');
  const warned = b.runBackup({ dataRoot: decl, dest: join(tmp, 'backup', 'decl') });
  assert.equal(warned.warnings.length, 1);
  assert.equal(warned.copied, 2);
  pass('an unparseable local-paths.txt warns and backs up the built-in paths');

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
  const tool = JSON.parse(cli('--dest', join(tmp, 'backup', 'cli3'), '--include-tool-config', '--json').stdout);
  assert.equal(tool.found, 6);
  pass('CLI exits 0 on success, 1 for a failed or empty run, 2 for a bad destination or option');
} catch (e) {
  fail(`backup.mjs: ${e.message}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
