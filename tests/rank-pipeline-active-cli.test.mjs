import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';

test('CAREER_OPS_CLI picks the ranking CLI when several are installed', {
  skip: process.platform === 'win32' && 'POSIX executable fixture',
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'rank-active-cli-'));
  try {
    mkdirSync(join(root, 'data'));
    mkdirSync(join(root, 'bin'));
    writeFileSync(join(root, 'data', 'pipeline.md'), '- [ ] https://example.test/job | Example | Engineer');
    for (const cli of ['claude', 'opencode']) {
      const binary = join(root, 'bin', cli);
      writeFileSync(binary, `#!${process.execPath}\n`
        + `if (process.argv[2] !== '--version') require('node:fs').writeFileSync(process.env.RANK_CALL, ${JSON.stringify(cli)} + ' ' + process.argv[2]);\n`
        + `console.log('[{"id":0,"score":3,"reason":"Fixture match"}]');\n`);
      chmodSync(binary, 0o755);
    }
    const env = {
      ...process.env,
      CAREER_OPS_ROOT: root,
      CAREER_OPS_CLI: 'opencode',
      CAREER_OPS_RANK_CLI: '',
      PATH: `${join(root, 'bin')}:${process.env.PATH}`,
      RANK_CALL: join(root, 'call.txt'),
    };
    execFileSync(process.execPath, [join(ROOT, 'rank-pipeline.mjs'), '--dry-run'], { env, cwd: root });
    assert.equal(readFileSync(env.RANK_CALL, 'utf8'), 'opencode run');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
