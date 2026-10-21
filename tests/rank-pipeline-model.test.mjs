import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';

for (const [cli, command] of [['codex', 'exec'], ['opencode', 'run'], ['claude', '-p']]) {
  test(`${cli} receives the requested model without changing its headless command`, {
    skip: process.platform === 'win32' && 'POSIX executable fixture',
  }, () => {
    const root = mkdtempSync(join(tmpdir(), 'rank-model-'));
    try {
      mkdirSync(join(root, 'data'));
      mkdirSync(join(root, 'bin'));
      const raw = '- [ ] https://example.test/job | Example | Engineer';
      writeFileSync(join(root, 'data', 'pipeline.md'), raw);
      const binary = join(root, 'bin', cli);
      writeFileSync(binary, `#!${process.execPath}\n`
        + `require('node:fs').writeFileSync(process.env.RANK_ARGS, JSON.stringify(process.argv.slice(2)));\n`
        + `console.log('[{"id":0,"score":4,"reason":"Fixture match"}]');\n`);
      chmodSync(binary, 0o755);
      const env = {
        ...process.env,
        CAREER_OPS_ROOT: root,
        PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        RANK_ARGS: join(root, 'args.json'),
      };
      const rank = (args) => execFileSync(process.execPath, [join(ROOT, 'rank-pipeline.mjs'), '--cli', cli, ...args], { env });
      rank(['--model', 'fixture/provider-model']);
      const args = JSON.parse(readFileSync(env.RANK_ARGS, 'utf8'));
      assert.equal(args[0], command);
      assert.match(args[1], /POSTINGS:/);
      assert.deepEqual(args.slice(2), ['--model', 'fixture/provider-model']);
      assert.equal(readFileSync(join(root, 'data', 'pipeline.md'), 'utf8'), `${raw} | rank: 4.0/5 — Fixture match`);

      writeFileSync(join(root, 'data', 'pipeline.md'), raw);
      rank([]);
      assert.equal(JSON.parse(readFileSync(env.RANK_ARGS, 'utf8')).length, 2);
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
}
