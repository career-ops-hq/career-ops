// tests/updater-self-bootstrap-backup.test.mjs — #3207 recovery guarantee.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupSystemFiles } from '../update-system.mjs';
import { pass, fail } from './helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'co-bootstrap-backup-'));
const root = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  const updater = join(dir, 'update-system.mjs');
  writeFileSync(updater, 'local fork fix\n');

  const [saved] = backupSystemFiles(['update-system.mjs'], { root: dir });
  writeFileSync(updater, 'fetched upstream updater\n');

  if (saved.backup === 'update-system.mjs.bak'
      && readFileSync(`${updater}.bak`, 'utf8') === 'local fork fix\n'
      && readFileSync(updater, 'utf8') === 'fetched upstream updater\n') {
    pass('self-bootstrap preserves the local updater before loading upstream');
  } else {
    fail('self-bootstrap backup did not preserve the pre-checkout bytes');
  }

  const failure = backupSystemFiles(['missing-import.mjs'], { root: dir })[0];
  if (failure.error && failure.backup === 'missing-import.mjs.bak') {
    pass('a backup failure is reportable without hiding the affected path');
  } else {
    fail('backup failures must retain both the path and error');
  }

  const source = readFileSync(join(root, 'update-system.mjs'), 'utf8');
  const detectAt = source.indexOf("locallyModifiedSystemFiles(reexecFiles, 'FETCH_HEAD')");
  const backUpAt = source.indexOf('backupSystemFiles(bootstrapAtRisk)', detectAt);
  const checkoutAt = source.indexOf("git('checkout', 'FETCH_HEAD', '--', ...reexecFiles)", detectAt);
  if (detectAt !== -1 && backUpAt > detectAt && checkoutAt > backUpAt) {
    pass('apply detects and backs up bootstrap edits before checkout');
  } else {
    fail('apply must preserve bootstrap edits before the destructive checkout');
  }

  const recordAt = source.indexOf('generatedBackupPaths.add(result.backup)');
  const validationAt = source.indexOf('!generatedBackupPaths.has(file)');
  if (recordAt > backUpAt && validationAt > recordAt) {
    pass('apply excludes only its successfully generated backups from user-layer validation');
  } else {
    fail('updater-created backups must not be mistaken for user-layer changes');
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
