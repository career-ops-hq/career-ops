// tests/backup.test.mjs — backup.mjs: destination discovery, exclusions, copy.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync, realpathSync, utimesSync } from 'fs';
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
  for (const rel of ['.env', 'data/.env', 'data/Connections.csv', 'data/cache/http/a', '.DS_Store', 'data/x.lock', 'data/y.part']) {
    assert.equal(b.isExcluded(rel), true, rel);
  }
  for (const rel of ['cv.md', 'data/applications.md', 'data/cacheable.md', 'reports/001-a.md']) {
    assert.equal(b.isExcluded(rel), false, rel);
  }
  pass('excludes secrets, Connections.csv, caches and lock/temp files only');

  // Destination discovery, on a fake home.
  const home = join(tmp, 'home');
  const cloud = join(home, 'Library', 'CloudStorage');
  const opts = { home, platform: 'darwin', env: {} };
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
  pass('Google Drive default, --account for several drives, no guessing');

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
  put(root, 'data/Connections.csv', 'pii');
  put(root, 'data/cache/http/h', 'cache');
  put(root, 'reports/001-a-2026-01-01.md', 'report');
  put(root, 'node_modules/x/index.js', 'not user data');
  put(root, 'modes/_shared.md', 'system file');
  const dest = join(tmp, 'backup', 'career-ops');
  mkdirSync(join(tmp, 'backup'));

  const dry = b.runBackup({ dataRoot: root, dest, dryRun: true });
  assert.equal(dry.copied, 3);
  assert.equal(existsSync(dest), false);

  const first = b.runBackup({ dataRoot: root, dest });
  assert.equal(first.copied, 3);
  assert.deepEqual(first.failed, []);
  assert.equal(readFileSync(join(dest, 'data/applications.md'), 'utf8'), 'tracker');
  for (const rel of ['data/.env', 'data/Connections.csv', 'data/cache/http/h', 'node_modules/x/index.js', 'modes/_shared.md']) {
    assert.equal(existsSync(join(dest, rel)), false, rel);
  }
  assert.equal(JSON.parse(readFileSync(join(dest, b.MANIFEST_NAME), 'utf8')).copied, 3);

  const second = b.runBackup({ dataRoot: root, dest });
  assert.equal(second.copied, 0);
  assert.equal(second.unchanged, 3);

  put(root, 'cv.md', 'cv, edited');
  utimesSync(join(root, 'cv.md'), new Date(), new Date(Date.now() + 60_000));
  assert.equal(b.runBackup({ dataRoot: root, dest }).copied, 1);
  assert.equal(readFileSync(join(dest, 'cv.md'), 'utf8'), 'cv, edited');

  rmSync(join(root, 'reports/001-a-2026-01-01.md'));
  b.runBackup({ dataRoot: root, dest });
  assert.equal(existsSync(join(dest, 'reports/001-a-2026-01-01.md')), true);
  pass('copies only user files, skips unchanged, re-copies edits, never deletes');

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
  assert.equal(cli('--dryrun').status, 1);
  pass('CLI exits 0 on success, 2 for an unusable destination, 1 for a mistyped flag');
} catch (e) {
  fail(`backup.mjs: ${e.message}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
