import assert from 'node:assert/strict';
import { lstatSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pass, fail, warn, rmSync } from './helpers.mjs';
import { clearNextPin, replaceNextPin, withFollowupsLock } from '../followup-seed.mjs';

const dir = mkdtempSync(join(tmpdir(), 'followups-file-symlink-'));
const target = join(dir, 'reminders.md');
const alias = join(dir, 'follow-ups.md');
const originalEnv = process.env.CAREER_OPS_FOLLOWUPS;
function check(label, fn) {
  try { fn(); pass(label); } catch (err) { fail(`${label}: ${err.message}`); }
}
try {
  writeFileSync(target, '# Follow-ups\n');
  let linked = false;
  try { symlinkSync('reminders.md', alias); linked = true; } catch (err) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(err.code)) throw err;
    warn('file symlink tests require Windows symlink privileges');
  }
  if (linked) {
    await replaceNextPin(42, { followupsPath: alias, date: '2026-11-02' });
    check('setting a pin preserves the file symlink and updates its target', () => {
      assert.equal(lstatSync(alias).isSymbolicLink(), true);
      assert.match(readFileSync(target, 'utf8'), /next #42 2026-11-02/);
    });
    // Reset each case so failures do not hide another operation's regression.
    rmSync(alias, { force: true }); symlinkSync('reminders.md', alias);
    writeFileSync(target, '# Follow-ups\n- next #42 2026-11-02\n');
    await clearNextPin(42, { followupsPath: alias });
    check('clearing a pin preserves the file symlink and updates its target', () => {
      assert.equal(lstatSync(alias).isSymbolicLink(), true);
      assert.doesNotMatch(readFileSync(target, 'utf8'), /next #42/);
    });
    rmSync(alias, { force: true }); symlinkSync('reminders.md', alias);
    writeFileSync(target, '# Follow-ups\n');
    process.env.CAREER_OPS_FOLLOWUPS = alias;
    await replaceNextPin(43, { date: '2026-11-03' });
    check('the follow-ups environment override keeps the shared file connected', () => {
      assert.equal(lstatSync(alias).isSymbolicLink(), true);
      assert.match(readFileSync(target, 'utf8'), /next #43 2026-11-03/);
    });
    rmSync(alias, { force: true }); symlinkSync('reminders.md', alias);
    writeFileSync(target, '');
    let active = 0;
    let peak = 0;
    const append = (path, text) => withFollowupsLock(path, async () => {
      peak = Math.max(peak, ++active);
      const before = readFileSync(path, 'utf8');
      await new Promise(resolve => setTimeout(resolve, 40));
      writeFileSync(path, before + text);
      active--;
    }, { timeoutMs: 2000, retryMs: 5 });
    await Promise.all([append(alias, 'first\n'), append(target, 'second\n')]);
    check('a file symlink and its target share one writer lock', () => {
      assert.equal(peak, 1);
      assert.match(readFileSync(target, 'utf8'), /first/);
      assert.match(readFileSync(target, 'utf8'), /second/);
    });
  }
} finally {
  if (originalEnv === undefined) delete process.env.CAREER_OPS_FOLLOWUPS;
  else process.env.CAREER_OPS_FOLLOWUPS = originalEnv;
  rmSync(dir, { recursive: true, force: true });
}
