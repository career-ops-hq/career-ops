import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, pass, fail, rmSync } from './helpers.mjs';

const sandbox = mkdtempSync(join(tmpdir(), 'co-relative-tracker-'));
const cwd = process.cwd();
const original = process.env.CAREER_OPS_TRACKER;
try {
  const code = join(sandbox, 'code');
  const data = join(sandbox, 'data');
  const a = join(sandbox, 'a');
  const b = join(sandbox, 'b');
  for (const dir of [code, data, a, b, join(code, 'custom'), join(data, 'data')]) mkdirSync(dir, { recursive: true });
  copyFileSync(join(ROOT, 'path-resolver.mjs'), join(code, 'path-resolver.mjs'));
  const { resolveTrackerPath, resolveTrackerPathForWrite } = await import(pathToFileURL(join(code, 'path-resolver.mjs')));
  writeFileSync(join(code, 'custom', 'existing.md'), 'synthetic tracker');
  symlinkSync(join(code, 'custom'), join(code, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const [name, env, expected] of [
    ['existing relative override', 'custom/existing.md', realpathSync(join(code, 'custom/existing.md'))],
    ['missing relative override', 'new/tracker.md', join(code, 'new/tracker.md')],
    ['symlinked directory override', 'alias/existing.md', realpathSync(join(code, 'custom/existing.md'))],
    ['absolute override', join(code, 'custom/existing.md'), realpathSync(join(code, 'custom/existing.md'))],
  ]) {
    try {
      process.env.CAREER_OPS_TRACKER = env;
      for (const current of [a, b]) {
        process.chdir(current);
        assert.equal(resolveTrackerPath(data), expected, 'read target must not depend on cwd or external data root');
        assert.equal(resolveTrackerPathForWrite(data), expected, 'write target agrees with read target');
      }
      pass(name);
    } catch (error) { fail(name + ': ' + error.message); }
  }
  try {
    delete process.env.CAREER_OPS_TRACKER;
    writeFileSync(join(data, 'applications.md'), 'legacy');
    assert.equal(resolveTrackerPath(data), realpathSync(join(data, 'applications.md')));
    assert.equal(resolveTrackerPathForWrite(data), join(data, 'data/applications.md'));
    writeFileSync(join(data, 'data/applications.md'), 'canonical');
    assert.equal(resolveTrackerPath(data), realpathSync(join(data, 'data/applications.md')));
    pass('no override keeps data-root canonical/legacy precedence');
  } catch (error) { fail(error.message); }
} finally {
  process.chdir(cwd);
  if (original === undefined) delete process.env.CAREER_OPS_TRACKER;
  else process.env.CAREER_OPS_TRACKER = original;
  rmSync(sandbox, { recursive: true, force: true });
}
