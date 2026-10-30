import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { pass, fail } from './helpers.mjs';
import { withFollowupsLock } from '../followup-seed.mjs';

const dir = mkdtempSync(join(tmpdir(), 'followups-alias-'));
try {
  for (const initiallyExists of [true, false]) {
    for (const aliasKind of ['dot', 'relative']) {
      const file = join(dir, `${initiallyExists}-${aliasKind}.md`);
      if (initiallyExists) writeFileSync(file, '');
      const alias = aliasKind === 'dot'
        ? `${dir}/./${initiallyExists}-${aliasKind}.md`
        : relative(process.cwd(), file);
      let active = 0;
      let peak = 0;
      const append = (target, line, delay) => withFollowupsLock(target, async () => {
        active += 1;
        peak = Math.max(peak, active);
        let before = '';
        try { before = readFileSync(target, 'utf8'); } catch (err) {
          if (err.code !== 'ENOENT') throw err;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        writeFileSync(target, `${before}${line}\n`);
        active -= 1;
      }, { timeoutMs: 2000, retryMs: 5 });
      await Promise.all([append(file, 'first', 60), append(alias, 'second', 10)]);
      const lines = readFileSync(file, 'utf8').trim().split('\n');
      if (peak === 1 && lines.includes('first') && lines.includes('second')) {
        pass(`${aliasKind} alias preserves both writes (${initiallyExists ? 'existing' : 'new'} file)`);
      } else {
        fail(`${aliasKind} alias lost exclusion: peak=${peak}, lines=${lines.join(',')}`);
      }
    }
  }

  const lockDir = join(dir, 'explicit.lock');
  let active = 0;
  let peak = 0;
  await Promise.all(['one.md', 'two.md'].map(name => withFollowupsLock(join(dir, name), async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active -= 1;
  }, { lockDir, timeoutMs: 2000, retryMs: 5 })));
  if (peak === 1) pass('explicit lock override still controls lock identity');
  else fail('explicit lock override did not serialize callers');
} finally {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
