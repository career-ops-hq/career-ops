// tests/backup-allow-synced-contacts.test.mjs — backup.mjs: --allow-synced-contacts
// is the separate acknowledgement that lets --include-contacts write into a
// synced folder. Without it the refusal stands.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { mkdirSync, mkdtempSync, existsSync, writeFileSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import assert from 'node:assert/strict';

console.log('\nbackup.mjs — --allow-synced-contacts');
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'co-backup-allow-')));
try {
  const b = await import(pathToFileURL(join(ROOT, 'backup.mjs')).href);
  const root = join(tmp, 'root');
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'cv.md'), 'cv');
  writeFileSync(join(root, 'data/contacts.tsv'), 'contacts');
  // A Dropbox folder under a fake home, so the destination is recognized as synced.
  const fakeHome = join(tmp, 'home');
  const backups = join(fakeHome, 'Dropbox', 'Backups');
  mkdirSync(backups, { recursive: true });
  const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_BACKUP_DIR: '', HOME: fakeHome, USERPROFILE: fakeHome };
  const cli = (...args) => spawnSync(NODE, ['backup.mjs', ...args, '--json'], { cwd: ROOT, env, encoding: 'utf8' });

  // Without the acknowledgement the refusal stands, for --dest and --provider alike.
  const refusedDest = join(backups, 'refused');
  const refused = cli('--dest', refusedDest, '--include-contacts');
  assert.equal(refused.status, 2);
  assert.match(JSON.parse(refused.stdout).error, /--allow-synced-contacts/);
  assert.equal(existsSync(refusedDest), false);
  const refusedProvider = cli('--provider', 'dropbox', '--include-contacts');
  assert.equal(refusedProvider.status, 2);
  assert.match(JSON.parse(refusedProvider.stdout).error, /--allow-synced-contacts/);

  // With it, the contacts are copied and the run still warns.
  const allowedDest = join(backups, 'allowed');
  const allowed = cli('--dest', allowedDest, '--include-contacts', '--allow-synced-contacts');
  assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
  assert.match(JSON.parse(allowed.stdout).warnings.join('\n'), /contact files are being copied into a dropbox folder/);
  assert.equal(existsSync(join(allowedDest, 'data/contacts.tsv')), true);
  const allowedProvider = cli('--provider', 'dropbox', '--include-contacts', '--allow-synced-contacts');
  assert.equal(allowedProvider.status, 0, allowedProvider.stdout + allowedProvider.stderr);

  // The acknowledgement alone is a usage error and never copies contacts by itself.
  const lone = cli('--dest', join(backups, 'lone'), '--allow-synced-contacts');
  assert.equal(lone.status, 2);
  assert.match(JSON.parse(lone.stdout).error, /only applies together with --include-contacts/);

  // The exported API takes the same acknowledgement.
  const synced = join(backups, 'api');
  assert.throws(() => b.assertContactsNotSynced(synced, true, { home: fakeHome }), /--allow-synced-contacts/);
  assert.doesNotThrow(() => b.assertContactsNotSynced(synced, true, { home: fakeHome }, true));
  pass('--allow-synced-contacts lets --include-contacts into a synced folder, with a warning');
} catch (e) {
  fail(`backup-allow-synced-contacts: ${e.message}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
