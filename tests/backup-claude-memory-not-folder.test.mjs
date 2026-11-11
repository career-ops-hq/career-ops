// tests/backup-claude-memory-not-folder.test.mjs — backup.mjs: a Claude memory path that is a file, not a folder.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import assert from 'node:assert/strict';

console.log('\nbackup.mjs — Claude memory path that is not a folder');
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'co-backup-memfile-')));
const ambientProfile = process.env.CAREER_OPS_PROFILE;
delete process.env.CAREER_OPS_PROFILE;
try {
  const b = await import(pathToFileURL(join(ROOT, 'backup.mjs')).href);
  const dataRoot = join(tmp, 'root');
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(join(dataRoot, 'cv.md'), 'cv');
  const fileAsMemory = join(tmp, 'memory-is-a-file');
  writeFileSync(fileAsMemory, 'not a folder');
  const result = b.runBackup({ dataRoot, dest: join(tmp, 'backup'), memoryDir: fileAsMemory, includeClaudeMemory: true });
  assert.equal(result.claudeMemory, 0);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /not a folder/);
  pass('a memory path that is a file is a failure and copies nothing');
} catch (error) {
  fail(`memory path that is not a folder: ${error.message}`);
} finally {
  if (ambientProfile !== undefined) process.env.CAREER_OPS_PROFILE = ambientProfile;
  rmSync(tmp, { recursive: true, force: true });
}
