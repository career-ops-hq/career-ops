// Grok's batch prompt must stay under the same per-argument cap the dashboard
// already refuses. The scoring manual and the job go in a file. -p only names it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getBash, rmSync, ROOT } from './helpers.mjs';

const bash = getBash();
// The cap lives in web/. A checkout without web/ skips this test.
const capModule = join(ROOT, 'web', 'src', 'lib', 'oversized-prompt.mjs');
const POSIX_ARG_LIMIT = existsSync(capModule)
  ? (await import(pathToFileURL(capModule).href)).POSIX_ARG_LIMIT
  : null;
const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf8').replace(/\r\n/g, '\n');
const dispatchBlock = SRC.match(/  local full_prompt=""\n  local -a model_args=\(\)\n[\s\S]*?\n    esac\n/)?.[0];
const runWorker = SRC.match(/^run_worker\(\) \{\n[\s\S]*?\n\}\n/m)?.[0];

test('grok batch -p stays under the dashboard argument cap', { skip: (!bash && 'bash is required') || (POSIX_ARG_LIMIT == null && 'web/ is not in this checkout') }, () => {
  assert.ok(dispatchBlock, 'dispatch block missing');
  assert.ok(runWorker, 'run_worker() missing');
  const dir = mkdtempSync(join(tmpdir(), 'batch-grok-prompt-'));
  let taskPath = '';
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const manual = 'M'.repeat(POSIX_ARG_LIMIT + 4096);
    const systemPrompt = join(dir, 'system-prompt.md');
    writeFileSync(systemPrompt, manual);
    const logFile = join(dir, 'worker.log');
    const stub = join(bin, 'grok');
    writeFileSync(stub, '#!/bin/sh\nprintf \'ARG:%s\\n\' "$@"\n');
    chmodSync(stub, 0o755);
    const script = join(dir, 'run.sh');
    writeFileSync(script, [
      'set -euo pipefail',
      'CLI=grok',
      'MODEL=""',
      'WORKER_TIMEOUT=0',
      'prompt="JOB PROMPT"',
      `resolved_prompt=${JSON.stringify(systemPrompt)}`,
      `log_file=${JSON.stringify(logFile)}`,
      runWorker,
      'wrapper() {',
      '  local -a claude_args=(-p)',
      dispatchBlock,
      '    break',
      '  done',
      '}',
      'wrapper',
    ].join('\n'));
    execFileSync(bash, [script], {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
    });
    const args = readFileSync(logFile, 'utf8').split('\n').filter((line) => line.startsWith('ARG:')).map((line) => line.slice(4));
    const promptArg = args[args.indexOf('-p') + 1];
    assert.equal(args[0], '--always-approve');
    assert.ok(promptArg, 'grok was not given -p');
    assert.ok(Buffer.byteLength(promptArg) <= POSIX_ARG_LIMIT, ` -p is ${Buffer.byteLength(promptArg)} bytes`);
    assert.ok(!promptArg.includes(manual.slice(0, 80)), 'the scoring manual was passed as an argument');
    const quoted = promptArg.match(/"([^"]+)"/);
    assert.ok(quoted, `no prompt file in: ${promptArg}`);
    taskPath = quoted[1];
    const task = readFileSync(taskPath, 'utf8');
    assert.ok(task.startsWith(manual));
    assert.ok(task.endsWith('JOB PROMPT\n') || task.includes('\n\nJOB PROMPT'));
  } finally {
    if (taskPath) rmSync(taskPath, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
