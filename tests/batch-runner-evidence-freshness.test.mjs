// tests/batch-runner-evidence-freshness.test.mjs: batch-runner.sh runs the
// GitHub evidence freshness check (#5674) once per batch run, not once per
// worker, and hands its JSON to every worker through the resolved system
// prompt. The check makes a `gh search prs` call, so per-worker runs would cost
// one GitHub call per offer for the same answer.
//
// The REAL batch-runner.sh runs against three offers with a stub
// evidence-freshness.mjs that counts its invocations and a claude stub that
// captures each worker's --append-system-prompt-file before the runner deletes
// it. No gh, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { getBash, rmSync } from './helpers.mjs';

const SRC = readFileSync(new URL('../batch/batch-runner.sh', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SECTION = '## Runtime: GitHub evidence freshness';

/**
 * Run the runner over three offers. `status` is what the stub check prints;
 * null leaves evidence-freshness.mjs out of the checkout.
 * Returns the captured prompts and how many times the check ran.
 */
function runBatch(status) {
  const dir = mkdtempSync(join(tmpdir(), 'batch-evidence-freshness-'));
  try {
    const batchDir = join(dir, 'batch');
    const binDir = join(dir, 'bin');
    const captureDir = join(dir, 'captures');
    for (const d of [batchDir, binDir, captureDir, join(dir, 'reports'), join(dir, 'data')]) mkdirSync(d, { recursive: true });

    writeFileSync(join(batchDir, 'batch-runner.sh'), SRC);
    chmodSync(join(batchDir, 'batch-runner.sh'), 0o755);
    writeFileSync(join(batchDir, 'batch-prompt.md'), '# Fixture batch worker prompt\n\nURL: {{URL}}\nBatch ID: {{ID}}\n');
    writeFileSync(join(batchDir, 'batch-input.tsv'), [
      'id\turl\tsource\tnotes',
      '1\thttps://example.com/one\tfixture\t-',
      '2\thttps://example.com/two\tfixture\t-',
      '3\thttps://example.com/three\tfixture\t-',
    ].join('\n') + '\n');

    writeFileSync(join(dir, 'reserve-report-num.mjs'), [
      "import { readFileSync, writeFileSync, existsSync } from 'node:fs';",
      "if (!process.argv.includes('--release')) {",
      "  const f = 'counter.txt';",
      "  const n = (existsSync(f) ? parseInt(readFileSync(f, 'utf8'), 10) : 0) + 1;",
      "  writeFileSync(f, String(n));",
      "  console.log(String(n).padStart(3, '0'));",
      "}",
    ].join('\n') + '\n');
    for (const script of ['merge-tracker', 'reconcile-pipeline', 'verify-pipeline']) {
      writeFileSync(join(dir, `${script}.mjs`), '// No external integrations in this fixture.\n');
    }

    // The stub prints JSON shaped like the real script's (two-space indent,
    // status then stale first) and logs each run.
    if (status) {
      const json = {
        status, stale: status === 'ok', reason: 'fixture', notice: status === 'ok' ? 'Fixture notice. Scores may understate fit.' : null,
      };
      writeFileSync(join(dir, 'evidence-freshness.mjs'), [
        "import { appendFileSync } from 'node:fs';",
        `appendFileSync(${JSON.stringify(join(dir, 'freshness-calls.txt'))}, 'run\\n');`,
        `process.stdout.write(${JSON.stringify(`${JSON.stringify(json, null, 2)}\n`)});`,
      ].join('\n') + '\n');
    }

    writeFileSync(join(binDir, 'curl'), '#!/usr/bin/env bash\nexit 1\n');
    writeFileSync(join(binDir, 'claude'), [
      '#!/usr/bin/env bash',
      'promptfile=""; prev=""; last=""',
      'for arg in "$@"; do',
      '  [[ "$prev" == "--append-system-prompt-file" ]] && promptfile="$arg"',
      '  prev="$arg"; last="$arg"',
      'done',
      'id=$(printf \'%s\' "$last" | grep -oE \'Batch ID: [0-9]+\' | grep -oE \'[0-9]+\')',
      '[[ -n "$promptfile" && -n "$id" ]] && cp "$promptfile" "$CAPTURE_DIR/prompt-${id}.md"',
      'exit 1',
    ].join('\n') + '\n');
    chmodSync(join(binDir, 'claude'), 0o755);
    chmodSync(join(binDir, 'curl'), 0o755);

    execFileSync(getBash(), [join(batchDir, 'batch-runner.sh'), '--parallel', '1', '--max-retries', '0', '--rate-limit-sleep', '0'], {
      cwd: dir,
      env: { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH}`, CAPTURE_DIR: captureDir },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    });

    const prompts = readdirSync(captureDir).sort().map((f) => readFileSync(join(captureDir, f), 'utf8'));
    const callsFile = join(dir, 'freshness-calls.txt');
    const calls = existsSync(callsFile) ? readFileSync(callsFile, 'utf8').split('\n').filter(Boolean).length : 0;
    return { prompts, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('an enabled check runs once for the whole batch and reaches every worker', () => {
  const { prompts, calls } = runBatch('ok');
  assert.equal(prompts.length, 3, 'expected one captured prompt per offer');
  assert.equal(calls, 1, `evidence-freshness.mjs should run once per batch run, ran ${calls} times for 3 offers`);
  for (const p of prompts) {
    assert.ok(p.includes(SECTION), 'every worker prompt carries the run-wide freshness result');
    assert.ok(p.includes('    "notice": "Fixture notice. Scores may understate fit."'), 'the JSON is included verbatim, indented');
  }
  assert.ok(prompts.every((p) => p === prompts[0]), 'the result keeps the resolved prompt byte-identical across offers');
});

test('a disabled check (the default) adds nothing to the worker prompt', () => {
  const { prompts, calls } = runBatch('disabled');
  assert.equal(calls, 1, 'the runner still asks once; the script itself makes no gh call when disabled');
  assert.equal(prompts.length, 3);
  assert.ok(prompts.every((p) => !p.includes(SECTION)), 'no freshness section when the check is off');
});

test('an install without evidence-freshness.mjs runs the batch unchanged', () => {
  const { prompts, calls } = runBatch(null);
  assert.equal(calls, 0);
  assert.equal(prompts.length, 3);
  assert.ok(prompts.every((p) => !p.includes(SECTION)));
});
