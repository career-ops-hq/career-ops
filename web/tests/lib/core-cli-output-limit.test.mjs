import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../helpers/web-ts-alias-loader.mjs';

test('core CLI bounds stdout and stderr by default and honors an explicit larger limit', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-cli-output-'));
  const codeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');
  const probeName = `output-probe-${process.pid}`;
  const probePath = path.join(codeRoot, `${probeName}.mjs`);
  const env = { CAREER_OPS_ROOT: root, CAREER_OPS_CODE_ROOT: codeRoot };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(probePath, { force: true });
  });
  fs.writeFileSync(probePath, "process[process.argv[2]].write('x'.repeat(1200000));\n");
  const { runCoreCli } = await import('@/lib/core-cli.ts');
  for (const stream of ['stdout', 'stderr']) {
    const bounded = await runCoreCli(probeName, [stream]);
    assert.equal(bounded.timedOut, false);
    assert.equal(bounded[stream].length, 1024 * 1024, `${stream} must enforce the default limit`);
    assert.ok(bounded[stream].length <= 1024 * 1024);
    const expanded = await runCoreCli(probeName, [stream], { maxBuffer: 2 * 1024 * 1024 });
    assert.equal(expanded.code, 0);
    assert.equal(expanded[stream].length, 1200000);
  }
});
