import { execFileSync } from 'child_process';
import { chownSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fail, pass, warn } from './helpers.mjs';
import { gitIn } from '../update-system.mjs';

console.log('\n🧪 Testing updater Git access to a foreign-owned checkout...');

if (process.platform !== 'linux' || process.getuid?.() !== 0) {
  warn('foreign-owner Git check requires root on Linux; skipped');
} else {
  const dir = mkdtempSync(join(tmpdir(), 'co-foreign-owner-'));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(dir, 'empty-gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const previous = {
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
  };
  try {
    writeFileSync(env.GIT_CONFIG_GLOBAL, '');
    execFileSync('git', ['init', '-q'], { cwd: dir, env });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, env });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, env });
    writeFileSync(join(dir, 'tracked.txt'), 'fixture\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: dir, env });
    execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: dir, env });
    chownSync(dir, 65534, 65534);

    process.env.GIT_CONFIG_GLOBAL = env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_NOSYSTEM = env.GIT_CONFIG_NOSYSTEM;
    const head = gitIn(dir, 'rev-parse', 'HEAD');
    if (/^[0-9a-f]{40}$/i.test(head)) {
      pass('updater Git runner reads a foreign-owned checkout');
    } else {
      fail(`updater Git runner returned an invalid HEAD: ${head}`);
    }
  } catch (error) {
    fail(`updater Git runner cannot read a foreign-owned checkout: ${String(error.stderr || error.message).trim()}`);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}
