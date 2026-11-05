import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import { envWithPathFirst, writeFakeCli } from './helpers/fake-cli.mjs';

for (const [cli, command] of [['codex', 'exec'], ['opencode', 'run'], ['claude', '-p']]) {
  test(`${cli} receives the requested model without changing its headless command`, () => {
    const root = mkdtempSync(join(tmpdir(), 'rank-model-'));
    try {
      mkdirSync(join(root, 'data'));
      mkdirSync(join(root, 'bin'));
      const raw = '- [ ] https://example.test/job | Example | Engineer';
      writeFileSync(join(root, 'data', 'pipeline.md'), raw);
      writeFakeCli(join(root, 'bin'), cli,
        `require('node:fs').writeFileSync(process.env.RANK_ARGS, JSON.stringify(process.argv.slice(2)));\n`
        + `console.log('[{"id":0,"score":4,"reason":"Fixture match"}]');\n`);
      const env = envWithPathFirst(join(root, 'bin'), {
        CAREER_OPS_ROOT: root,
        RANK_ARGS: join(root, 'args.json'),
      });
      const rank = (args) => execFileSync(process.execPath, [join(ROOT, 'rank-pipeline.mjs'), '--cli', cli, ...args], { env });
      rank(['--model', 'fixture/provider-model']);
      const args = JSON.parse(readFileSync(env.RANK_ARGS, 'utf8'));
      assert.equal(args[0], command);
      assert.ok(args.some(arg => arg.includes('POSTINGS:')));
      assert.deepEqual(args.slice(-2), ['--model', 'fixture/provider-model']);
      assert.equal(readFileSync(join(root, 'data', 'pipeline.md'), 'utf8'), `${raw} | rank: 4.0/5 — Fixture match`);

      writeFileSync(join(root, 'data', 'pipeline.md'), raw);
      rank([]);
      assert.equal(JSON.parse(readFileSync(env.RANK_ARGS, 'utf8')).includes('--model'), false);
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
}
