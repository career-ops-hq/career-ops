/**
 * updater-migration-fixture-safety.test.mjs — fixture guardrails for issue 3732.
 */

import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from 'fs';
import { spawnSync, execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, NODE, ROOT, rmSync } from './helpers.mjs';

console.log('\n🧪 Testing updater migration fixture safety (issue 3732)...');

const source = readFileSync(join(ROOT, 'updater-migration-tests.mjs'), 'utf8');
if (/if\s*\(\s*toplevel\s*!==\s*cwd\s*\)/.test(source)) {
  fail('migration fixture still compares raw git toplevel output to process.cwd(), which misfires on Windows slash differences');
} else {
  pass('migration fixture no longer compares raw git toplevel output to process.cwd()');
}

{
  const dir = mkdtempSync(join(tmpdir(), 'co-updater-migration-'));
  try {
    const outer = join(dir, 'outer');
    const nested = join(outer, 'nested');
    mkdirSync(nested, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: outer });
    for (const file of ['update-system.mjs', 'updater-migration-tests.mjs', 'AGENTS.md']) {
      copyFileSync(join(ROOT, file), join(nested, file));
    }
    const excludes = join(dir, 'global-excludes');
    const globalConfig = join(dir, 'global.gitconfig');
    writeFileSync(excludes, 'AGENTS.md\n');
    writeFileSync(globalConfig, `[core]\n\texcludesFile = ${excludes}\n`);

    const res = spawnSync(NODE, ['updater-migration-tests.mjs'], {
      cwd: nested,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: globalConfig,
      },
    });
    const output = `${res.stdout}\n${res.stderr}`;
    const localConfig = readFileSync(join(nested, '.git', 'config'), 'utf8');

    if (/FAIL migration fixture git setup: Command failed: git add update-system\.mjs updater-migration-tests\.mjs AGENTS\.md/.test(output)
        || /ignored by one of your \.gitignore files:[\s\S]*AGENTS\.md/.test(output)) {
      fail('ambient core.excludesFile that ignores AGENTS.md still breaks migration fixture setup');
    } else {
      pass('ambient core.excludesFile cannot break migration fixture setup');
    }

    if (/tests@example\.invalid/.test(localConfig) || /career-ops tests/.test(localConfig)) {
      fail('migration fixture still writes a fake local git identity before it proves the fixture is safe');
    } else {
      pass('migration fixture does not write a fake local git identity before it proves the fixture is safe');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
