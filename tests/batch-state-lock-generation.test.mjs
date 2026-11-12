import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT, getBash, rmSync } from './helpers.mjs';

function run(body) {
  const root = mkdtempSync(join(tmpdir(), 'batch-lock-generation-'));
  try {
    const source = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf8');
    const functions = source.slice(source.indexOf('acquire_state_lock() {'), source.indexOf('run_with_state_lock() {'));
    writeFileSync(join(root, 'functions.sh'), functions);
    writeFileSync(join(root, 'probe.sh'), `set -euo pipefail
fixture="$1"
source "$fixture/functions.sh"
STATE_LOCK_DIR="$fixture/lock"
STATE_LOCK_PID_FILE="$STATE_LOCK_DIR/pid"
STATE_LOCK_TIMEOUT_SECONDS=5
STATE_LOCK_STALE_AGE_SECONDS=15
PARALLEL=2
waiter=""; successor=""
trap '[[ -z "$waiter" ]] || kill "$waiter" 2>/dev/null || true; [[ -z "$successor" ]] || kill "$successor" 2>/dev/null || true' EXIT
wait_for() { for ((i=0;i<500;i++)); do [[ -f "$1" ]] && return 0; sleep 0.01; done; echo "barrier timed out: $1" >&2; return 1; }
! kill -0 99999999 2>/dev/null
${body}
`);
    const result = spawnSync(getBash(), [join(root, 'probe.sh'), root], { encoding: 'utf8', timeout: 15000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, JSON.stringify({ stdout: result.stdout, stderr: result.stderr }));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('a stale batch-lock reader cannot remove a live successor owner', () => run(`
mkdir "$STATE_LOCK_DIR"
printf '99999999\\t0\\n' > "$STATE_LOCK_PID_FILE"
(
  cut() {
    if [[ "$1" == '-f1' && ! -f "$fixture/observed-old" ]]; then
      local old
      old=$(command cut "$@")
      touch "$fixture/observed-old"
      wait_for "$fixture/resume-reader"
      printf '%s\\n' "$old"
    else command cut "$@"; fi
  }
  rmdir() {
    local status=0
    command rmdir "$@" || status=$?
    touch "$fixture/reclaim-finished"
    return "$status"
  }
  acquire_state_lock
  touch "$fixture/waiter-entered"
  release_state_lock
) & waiter=$!
wait_for "$fixture/observed-old"
# A second cleaner removes the dead predecessor before another worker acquires.
rm "$STATE_LOCK_PID_FILE"
rmdir "$STATE_LOCK_DIR"
(
  acquire_state_lock
  touch "$fixture/successor-active"
  wait_for "$fixture/release-successor"
  release_state_lock
) & successor=$!
wait_for "$fixture/successor-active"
owner=$(find "$STATE_LOCK_DIR" -type f -print)
[[ -n "$owner" ]]
touch "$fixture/resume-reader"
wait_for "$fixture/reclaim-finished"
# The judged predecessor is gone; its cleanup must leave the successor intact.
[[ -f "$owner" ]] || { echo 'live successor metadata removed' >&2; exit 1; }
[[ ! -f "$fixture/waiter-entered" ]] || { echo 'overlapping critical sections' >&2; exit 1; }
touch "$fixture/release-successor"
wait "$successor"; successor=""
wait "$waiter"; waiter=""
[[ -f "$fixture/waiter-entered" ]]
[[ ! -d "$STATE_LOCK_DIR" ]]
`));

for (const legacy of [false, true]) {
  test(`batch state lock recovers a dead ${legacy ? 'legacy' : 'generation'} owner`, () => run(legacy ? `
mkdir "$STATE_LOCK_DIR"
printf '99999999\\t0\\n' > "$STATE_LOCK_PID_FILE"
acquire_state_lock
release_state_lock
[[ ! -d "$STATE_LOCK_DIR" ]]
` : `
export STATE_LOCK_DIR STATE_LOCK_PID_FILE STATE_LOCK_TIMEOUT_SECONDS STATE_LOCK_STALE_AGE_SECONDS PARALLEL
"$BASH" -c 'source "$1"; acquire_state_lock' _ "$fixture/functions.sh"
first=$(find "$STATE_LOCK_DIR" -type f -print)
acquire_state_lock
second=$(find "$STATE_LOCK_DIR" -type f -print)
[[ "$first" != "$second" ]] || { echo 'owner generation was reused' >&2; exit 1; }
release_state_lock
[[ ! -d "$STATE_LOCK_DIR" ]]
`));
}


test('a paused batch-lock initializer cannot join a replacement generation', () => run(`
mkdir "$STATE_LOCK_DIR"
printf '99999999\\t0\\n' > "$STATE_LOCK_PID_FILE"
(
  cut() {
    if [[ "$1" == '-f1' && ! -f "$fixture/old-read" ]]; then
      local old
      old=$(command cut "$@")
      touch "$fixture/old-read"
      wait_for "$fixture/resume-reader"
      printf '%s\\n' "$old"
    else command cut "$@"; fi
  }
  acquire_state_lock
  touch "$fixture/waiter-active"
  wait_for "$fixture/release-waiter"
  release_state_lock
) & waiter=$!
wait_for "$fixture/old-read"
rm "$STATE_LOCK_PID_FILE"
rmdir "$STATE_LOCK_DIR"
(
  mkdir() {
    command mkdir "$@" || return $?
    if [[ ! -f "$fixture/initializer-created" ]]; then
      touch "$fixture/initializer-created"
      wait_for "$fixture/resume-initializer"
    fi
  }
  rm() {
    command rm "$@"
    touch "$fixture/initializer-retreated"
  }
  acquire_state_lock
  touch "$fixture/initializer-entered"
  release_state_lock
) & successor=$!
wait_for "$fixture/initializer-created"
touch "$fixture/resume-reader"
wait_for "$fixture/waiter-active"
touch "$fixture/resume-initializer"
for ((i=0;i<500;i++)); do
  [[ -f "$fixture/initializer-retreated" || -f "$fixture/initializer-entered" ]] && break
  sleep 0.01
done
[[ ! -f "$fixture/initializer-entered" ]] || { echo 'initializer overlapped replacement holder' >&2; exit 1; }
[[ -f "$fixture/initializer-retreated" ]]
touch "$fixture/release-waiter"
wait "$waiter"; waiter=""
wait "$successor"; successor=""
[[ -f "$fixture/initializer-entered" ]]
[[ ! -d "$STATE_LOCK_DIR" ]]
`));
