import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { getBash, rmSync } from './helpers.mjs';

const SRC = readFileSync(new URL('../batch/batch-runner.sh', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function runBatch({ offers, args = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'batch-default-parallel-'));
  try {
    const batchDir = join(dir, 'batch');
    const binDir = join(dir, 'bin');
    for (const d of [batchDir, binDir, join(dir, 'live'), join(dir, 'reports'), join(dir, 'data')]) mkdirSync(d, { recursive: true });
    writeFileSync(join(batchDir, 'batch-runner.sh'), SRC);
    chmodSync(join(batchDir, 'batch-runner.sh'), 0o755);
    writeFileSync(join(batchDir, 'batch-prompt.md'), 'Fixture prompt for {{URL}}\n');
    writeFileSync(join(batchDir, 'batch-input.tsv'), ['id\turl\tsource\tnotes', ...Array.from({ length: offers }, (_, i) => `${i + 1}\thttps://example.com/${i + 1}\tfixture\t-`)].join('\n') + '\n');
    writeFileSync(join(dir, 'reserve-report-num.mjs'), [
      "import { readFileSync, writeFileSync, existsSync } from 'node:fs';",
      "if (!process.argv.includes('--release')) {",
      "  const n = (existsSync('counter.txt') ? parseInt(readFileSync('counter.txt', 'utf8'), 10) : 0) + 1;",
      "  writeFileSync('counter.txt', String(n));",
      "  console.log(String(n).padStart(3, '0'));",
      "}",
    ].join('\n') + '\n');
    for (const script of ['merge-tracker', 'reconcile-pipeline', 'verify-pipeline']) writeFileSync(join(dir, `${script}.mjs`), '');
    writeFileSync(join(binDir, 'curl'), '#!/usr/bin/env bash\nexit 1\n');
    writeFileSync(join(binDir, 'claude'), [
      '#!/usr/bin/env bash',
      'last="${@: -1}"',
      'id=$(printf \'%s\' "$last" | grep -oE \'Batch ID: [0-9]+\' | grep -oE \'[0-9]+\')',
      'if [[ "$id" == 1 && ! -f "$FIXTURE_DIR/limited" ]]; then',
      '  sleep 0.5',
      '  : > "$FIXTURE_DIR/limited"',
      '  echo "Error: 429 Too Many Requests"',
      '  exit 1',
      'fi',
      ': > "$FIXTURE_DIR/live/$id"',
      'echo "start $id live $(ls "$FIXTURE_DIR/live" | wc -l | tr -d " ")" >> "$FIXTURE_DIR/starts.log"',
      'sleep 1',
      'rm -f "$FIXTURE_DIR/live/$id"',
      'exit 1',
    ].join('\n') + '\n');
    chmodSync(join(binDir, 'claude'), 0o755);
    chmodSync(join(binDir, 'curl'), 0o755);
    const stdout = execFileSync(getBash(), [join(batchDir, 'batch-runner.sh'), '--max-retries', '1', '--rate-limit-sleep', '1', ...args], {
      cwd: dir,
      env: { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH}`, FIXTURE_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 60000,
    });
    const starts = Object.fromEntries(readFileSync(join(dir, 'starts.log'), 'utf8').trim().split('\n').map((l) => l.split(' ')).map(([, id, , live]) => [id, Number(live)]));
    return { stdout, starts };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('claude batches default to 3 workers and drop to 1 after a rate limit', () => {
  const { stdout, starts } = runBatch({ offers: 6 });
  assert.match(stdout, /Parallel: 3 \|/);
  assert.match(stdout, /Rate limited: running the remaining offers on 1 worker/);
  assert.equal(Math.max(starts['2'], starts['3']), 2, 'offers 2 and 3 ran next to each other');
  assert.deepEqual([starts['4'], starts['5'], starts['6']], [1, 1, 1]);
});

test('an explicit --parallel 1 keeps one worker', () => {
  const { stdout } = runBatch({ offers: 2, args: ['--parallel', '1'] });
  assert.match(stdout, /Parallel: 1 \|/);
});
