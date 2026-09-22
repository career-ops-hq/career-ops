import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getBash, rmSync } from './helpers.mjs';

const source = readFileSync(new URL('../batch/batch-runner.sh', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const functions = source.slice(source.indexOf('is_rate_limit_log() {'), source.indexOf('reserve_report_num_unlocked() {'));
const validation = source.slice(source.indexOf('if ! [[ "$RATE_LIMIT_SLEEP"'), source.indexOf('if ! is_decimal_number "$MIN_SCORE"'));
const loop = source.slice(source.indexOf('  local exit_code=0\n  local terminal_failure_recorded'), source.indexOf('  # Cleanup resolved prompt'));
assert.match(functions, /rate_limit_delay\(\)/);
assert.match(loop, /retry_delay=\$\(rate_limit_delay/);

// Execute the actual shell helper/retry loop, with only external workers,
// sleeping and state I/O stubbed. No real provider calls or wall-clock waits.
function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'batch-backoff-'));
  try {
    const invoke = (script, env = {}) => {
      writeFileSync(join(dir, 'run.sh'), `set -euo pipefail\n${script}\n`);
      return execFileSync(getBash(), ['run.sh'], {
        cwd: dir, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 10000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    };
    run({ dir, invoke });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('adaptive delays grow, saturate, honor small caps and remain within jitter bounds', () => fixture(({ invoke }) => {
  const output = invoke(`${functions}
    : > worker.log
    for RATE_LIMIT_SLEEP in 1 8 30 31 300 2147483647; do
      for retry in 0 1 2 3 4 1000000; do
        for sample in 1 2 3 4 5; do
          printf '%s %s %s\n' "$RATE_LIMIT_SLEEP" "$retry" "$(rate_limit_delay worker.log "$retry")"
        done
      done
    done`);
  for (const line of output.split('\n')) {
    const [cap, retry, delay] = line.split(' ').map(Number);
    const nominal = Math.min(cap, Math.min(30, cap) * 2 ** retry);
    assert.ok(delay >= nominal && delay <= Math.min(cap, Math.floor(nominal * 1.2)), line);
  }
}));

test('Retry-After accepts only complete integer headers and never evaluates log text', () => fixture(({ dir, invoke }) => {
  for (const [log, low, high] of [
    ['Retry-After: 1', 30, 36],
    ['Retry-After: 0', 30, 36],
    [' \trEtRy-AfTeR: 00080\r\n', 80, 96],
    ['Retry-After: 80\nRetry-After: 40', 80, 96],
    ['Retry-After: 300', 300, 300],
    ['Retry-After: 301', 'pause', 'pause'],
    [`Retry-After: ${'9'.repeat(400)}`, 'pause', 'pause'],
    ['Retry-After: 301\nRetry-After: 1', 'pause', 'pause'],
    ...['-1', '+2', '1.5', '1e2', 'Wed, 21 Oct 2015 07:28:00 GMT', '8 seconds',
      '$(touch injected)', '`touch injected`', 'x[$(touch injected)]', '80; touch injected', ''].map(value => [`Retry-After: ${value}`, 120, 144]),
    ['text Retry-After: 80', 120, 144],
    ['{"Retry-After":80}', 120, 144],
    ['', 120, 144],
  ]) {
    writeFileSync(join(dir, 'worker.log'), log);
    const result = invoke(`${functions}\nRATE_LIMIT_SLEEP=300\nrate_limit_delay worker.log 2`);
    if (low === 'pause') assert.equal(result, 'pause', log);
    else assert.ok(Number(result) >= low && Number(result) <= high, `${log}: ${result}`);
    assert.equal(existsSync(join(dir, 'injected')), false);
  }
}));

test('ceiling validation normalizes decimal zeros and rejects unsafe or overflowing values', () => fixture(({ invoke }) => {
  for (const [value, expected] of [['000', '0'], ['008', '8'], ['0300', '300'], ['2147483647', '2147483647']]) {
    assert.equal(invoke(`${validation}\nprintf '%s' "$RATE_LIMIT_SLEEP"`, { RATE_LIMIT_SLEEP: value }), expected);
  }
  for (const value of ['2147483648', '999999999999999999999999', '-1', '1.5', '1+2', '$(touch injected)']) {
    assert.throws(() => invoke(validation, { RATE_LIMIT_SLEEP: value }), /Command failed/);
  }
}));

function runLoop({ invoke, dir }, { cap = 300, retries = 0, max = 2, log = '429', successAfter = 99, cli = 'claude', secondLog = log } = {}) {
  writeFileSync(join(dir, 'first.log'), log);
  writeFileSync(join(dir, 'second.log'), secondLog);
  return invoke(`${functions}
    RATE_LIMIT_SLEEP=${cap}
    MAX_RETRIES=${max}
    CLI=${cli}
    PAUSE_FILE=pause.tsv
    BATCH_PAUSED=false
    calls=0
    claude() {
      calls=$((calls + 1))
      if (( calls > ${successAfter} )); then return 0; fi
      if (( calls == 1 )); then cat first.log; else cat second.log; fi
      return 1
    }
    qwen() { claude; }
    sleep() { printf 'SLEEP:%s\n' "$1"; }
    update_state_retrying() { printf 'STATE:%s:%s:%s\n' "$3" "$8" "$9"; }
    worker() {
      local retries=${retries} id=1 url=https://example.com started_at=start report_num=001 log_file=worker.log
      local -a claude_args=(-p) model_args=()
      local full_prompt=fixture
      ${loop}
      printf 'END:%s:%s:%s:%s\n' "$calls" "$retries" "$terminal_failure_recorded" "$exit_code"
    }
    worker`);
}

test('retry loop records actual waits, enforces retry budget, and ignores stale headers', () => fixture(ctx => {
  const out = runLoop(ctx, { log: '429\nRetry-After: 80', secondLog: '429' });
  const sleeps = [...out.matchAll(/SLEEP:(\d+)/g)].map(m => Number(m[1]));
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[0] >= 80 && sleeps[0] <= 96);
  assert.ok(sleeps[1] >= 60 && sleeps[1] <= 72);
  sleeps.forEach((delay, i) => assert.ok(out.includes(`STATE:rate_limited:rate-limit; retrying after ${delay}s:${i + 1}`)));
  assert.match(out, /END:3:2:false:1/);
  assert.match(runLoop(ctx, { retries: 1, successAfter: 1 }), /END:2:2:false:0/);
  const exhausted = runLoop(ctx, { max: 0 });
  assert.doesNotMatch(exhausted, /SLEEP:/);
  assert.match(exhausted, /END:1:0:false:1/);
}));

test('zero, over-cap and session pauses preserve retries and use the existing pause marker', () => fixture(ctx => {
  for (const options of [{ cap: 0 }, { log: '429\nRetry-After: 301' }, { log: 'session limit' }]) {
    const out = runLoop(ctx, { ...options, retries: 1 });
    assert.doesNotMatch(out, /SLEEP:/);
    assert.match(out, /STATE:paused_rate_limit:.*:1/);
    assert.match(out, /END:1:1:true:1/);
    assert.match(readFileSync(join(ctx.dir, 'pause.tsv'), 'utf8'), /^1\t001\t/);
  }
}));

test('successful, non-rate-limit and non-Claude workers do not back off', () => fixture(ctx => {
  for (const options of [{ successAfter: 0 }, { log: 'unrelated failure' }, { cli: 'qwen' }]) {
    const out = runLoop(ctx, options);
    assert.doesNotMatch(out, /SLEEP:|STATE:/);
    assert.match(out, /END:1:0:false:/);
  }
}));
