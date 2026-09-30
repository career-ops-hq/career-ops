/**
 * Concurrency regression suite for the advisory Jev pre-screen
 * (tests/batch-runner-jev-concurrency.test.mjs).
 *
 * The pre-screen writes its verdict to prescreen.log and to the operator's
 * screen; nothing downstream reads it. That is exactly what makes it safe to
 * background, and exactly what makes a bug in it invisible — a prescreen.log
 * line that lands after the run reports "done" is not an error, nothing
 * crashes, and the audit trail quietly loses entries.
 *
 * So these tests assert the three properties that are hard to notice:
 *   1. the gate runs OFF the critical path (a slow gate does not delay a worker)
 *   2. concurrency stays BOUNDED (no more than JEV_MAX_BG at once)
 *   3. every line is on disk BEFORE the run reports completion (the drain)
 *
 * Hermetic: a stub gatekeeper and a stub `python3` on PATH, so no API key, no
 * network, and no real cv.md. Each test runs a harness that sources the real
 * batch-runner.sh and calls the real functions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = join(ROOT, 'batch', 'batch-runner.sh');

/**
 * Extract a bash function (and everything it calls) from the runner.
 *
 * Sourcing batch-runner.sh whole would run main "$@", so the harness pulls out
 * just the units under test. Returns bash source text.
 */
/** Matches the start of any top-level function definition in the runner. */
const TOP_LEVEL_FN = /^[A-Za-z_][A-Za-z0-9_]*\(\) \{/;

/**
 * Extract named functions verbatim from the runner.
 *
 * Sourcing batch-runner.sh whole would run main "$@", so the harness lifts out
 * only the units under test. The span ends at the next top-level definition
 * rather than at brace-balance zero: prescreen_jev embeds a `node -e '...'` one
 * whose JS braces open and close in a way brace counting misreads, which
 * previously ran the extractor past the end of the function and pulled in
 * process_offer — hence an "unbound variable" from code never under test.
 */
function extractFunctions(text, names) {
  const lines = text.split('\n');
  const out = [];
  for (const name of names) {
    const start = lines.findIndex((l) => l.startsWith(`${name}() {`));
    if (start === -1) throw new Error(`function not found in runner: ${name}`);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (TOP_LEVEL_FN.test(lines[i])) {
        end = i;
        break;
      }
    }
    out.push(lines.slice(start, end).join('\n'));
  }
  return out.join('\n');
}

/**
 * Build a sandbox with a stub gatekeeper and a stub python3.
 *
 * The stub gatekeeper appends its PID to $TRACK_FILE with a +200ms sleep, so a
 * test can reconstruct how many were ever in flight at once.
 */
function makeSandbox({ gateSleepMs = 200 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jev-conc-'));
  const track = join(dir, 'inflight.log');
  writeFileSync(track, '');

  mkdirSync(join(dir, 'scripts'), { recursive: true });
  // Each call brackets its own lifetime with START/END epoch-nanoseconds, so a
  // test can compute the true number of simultaneously-live calls. Recording PIDs
  // alone would not: a PID says a call happened, never how many overlapped, and
  // guessing overlap from wall-clock timing would pass for a runner that had
  // quietly serialized.
  writeFileSync(
    join(dir, 'scripts', 'jev_gatekeeper.py'),
    `#!/usr/bin/env bash
date +%s%N >> "${track}.start"
sleep $(awk "BEGIN{print ${gateSleepMs / 1000}}")
date +%s%N >> "${track}.end"
printf '{"ats_pass_probability": 3.10, "has_core_skills": true}\\n'
`,
    { mode: 0o755 },
  );

  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'bin', 'python3'), `#!/usr/bin/env bash\nexec "${join(dir, 'scripts', 'jev_gatekeeper.py')}" "$@"\n`, { mode: 0o755 });
  writeFileSync(join(dir, 'bin', 'node'), `#!/usr/bin/env bash\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 });

  writeFileSync(join(dir, 'cv.md'), '# stub resume\n');
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'config', 'profile.yml'), 'x: 1\n');
  mkdirSync(join(dir, 'batch', 'logs'), { recursive: true });

  return { dir, track };
}

const runnerSource = readFileSync(RUNNER, 'utf8');

/** The units under test, lifted verbatim out of the real runner. */
const units = extractFunctions(runnerSource, ['log_prescreen', 'read_gate_bands', 'prescreen_jev', 'jev_await_slot', 'jev_reap', 'jev_track', 'jev_drain']);

function runHarness(sandbox, body, { jevMaxBg } = {}) {
  sandbox.jevMaxBg = jevMaxBg;
  const script = `
set -u
PROJECT_DIR="${sandbox.dir}"
BATCH_DIR="${sandbox.dir}/batch"
LOGS_DIR="$BATCH_DIR/logs"
PRESCREEN_LOG="$LOGS_DIR/prescreen.log"
DISCARD_LOG="$LOGS_DIR/discard.log"
JEV_PYTHON=python3
JEV_MAX_BG="${sandbox.jevMaxBg ?? 4}"
PARALLEL=1
${units}

# The band globals are assigned at the top of the prescreen section and exported
# at the bottom, so they land either side of the extracted functions. Re-seed
# them here (or the harness's own set -u aborts inside the subshell).
JEV_BAND_LOW="2.26"
JEV_BAND_GUARDED="2.6"
JEV_BAND_MID="3.2"
export JEV_BAND_LOW JEV_BAND_GUARDED JEV_BAND_MID

${body}
`;
  return execFileSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${sandbox.dir}/bin:${process.env.PATH}`,
      TRACK_FILE: sandbox.track,
    },
  });
}

test('a slow gate does not block the worker (advisory runs off the critical path)', () => {
  const sandbox = makeSandbox({ gateSleepMs: 1500 });
  const out = runHarness(
    sandbox,
    `
jev_await_slot
START=$SECONDS
prescreen_jev 1 "${sandbox.dir}/cv.md" "http://x/1" &
jev_track $!
MID=$SECONDS
jev_drain
END=$SECONDS
echo "returned_after=$((MID - START))s"
echo "drained_after=$((END - START))s"
`,
  );
  const returned = Number(/returned_after=(\d+)s/.exec(out)[1]);
  const drained = Number(/drained_after=(\d+)s/.exec(out)[1]);
  assert.ok(returned <= drained, 'worker must not wait for the gate to finish');
  assert.ok(returned <= 1, `returned after ${returned}s — expected it not to block on a 1.5s gate`);
  assert.ok(drained >= 1, `drain took ${drained}s — it must actually wait for the gate`);
  assert.match(readFileSync(sandbox.dir + '/batch/logs/prescreen.log', 'utf8'), /score 3\.10/, 'the log line must still be written');
});

test('concurrency is bounded by JEV_MAX_BG', () => {
  const sandbox = makeSandbox({ gateSleepMs: 300 });
  const N = 12;
  runHarness(
    sandbox,
    `
for i in $(seq 1 ${N}); do
  jev_await_slot
  prescreen_jev "$i" "${sandbox.dir}/cv.md" "http://x/$i" &
  jev_track $!
done
jev_drain
`,
    { jevMaxBg: '3' },
  );

  const overlap = observedOverlap(sandbox);
  assert.equal(overlap.starts, N, `expected ${N} gate calls, got ${overlap.starts} — every offer must still be scored`);
  assert.equal(overlap.ends, N, `${overlap.starts} calls started but ${overlap.ends} finished`);
  assert.ok(overlap.max <= 3, `observed ${overlap.max} concurrent gate calls, cap was 3`);
  assert.ok(overlap.max > 1, `observed only ${overlap.max} concurrent call(s) — the runner serialized instead of bounding`);
});

test('every pre-screen line is on disk before the run reports completion', () => {
  const sandbox = makeSandbox({ gateSleepMs: 250 });
  const N = 8;
  runHarness(
    sandbox,
    `
for i in $(seq 1 ${N}); do
  jev_await_slot
  prescreen_jev "$i" "${sandbox.dir}/cv.md" "http://x/$i" &
  jev_track $!
done
# What main() does immediately after the worker loop.
jev_drain
echo "COMPLETE lines=$(wc -l < "$PRESCREEN_LOG" | tr -d ' ')"
`,
    { jevMaxBg: '4' },
  );
  const log = readFileSync(sandbox.dir + '/batch/logs/prescreen.log', 'utf8').trim().split('\n').filter(Boolean);
  assert.equal(log.length, N, `expected ${N} log lines at completion, found ${log.length}`);
  for (const line of log) {
    assert.match(line, /http:\/\/x\//, 'each line must carry the posting URL');
  }
});

test('a failing gate logs a skip and never breaks the run', () => {
  const sandbox = makeSandbox();
  writeFileSync(join(sandbox.dir, 'scripts', 'jev_gatekeeper.py'), '#!/usr/bin/env bash\necho \'{"error": "HTTP 401"}\'\nexit 1\n', { mode: 0o755 });
  const out = runHarness(
    sandbox,
    `
jev_await_slot
prescreen_jev 1 "${sandbox.dir}/cv.md" "http://x/1" &
jev_track $!
jev_drain
echo "rc=$?"
`,
  );
  assert.match(out, /rc=0/, 'a provider failure must not fail the run');
  const log = readFileSync(sandbox.dir + '/batch/logs/prescreen.log', 'utf8');
  assert.match(log, /skip:unavailable/, 'a failure is logged as unavailable, not as a score');
  assert.doesNotMatch(log, /score \d/, 'a failed gate must not emit a score');
});

test('bands come from config/profile.yml, not from literals in the parser', () => {
  const sandbox = makeSandbox();
  writeFileSync(
    join(sandbox.dir, 'config', 'profile.yml'),
    '# a comment mentioning band_low: 9.9 that must not be read\njev_gate:\n  enabled: true\n  band_low: 1.5\n  band_guarded: 2.0\n  band_mid: 2.5\n',
  );
  const out = runHarness(sandbox, 'read_gate_bands\necho "$JEV_BAND_LOW $JEV_BAND_GUARDED $JEV_BAND_MID"');
  assert.match(out.trim(), /1\.5 2\.0 2\.5/, `parsed bands wrong: ${out.trim()}`);
});

test('read_gate_bands succeeds when the profile has no jev_gate block', () => {
  // Regression guard on a real bug: the function ended with `[[ -n "$v" ]] && X=`,
  // which is a non-zero status when the key is absent. The runner runs under
  // `set -e`, so a profile without a jev_gate block aborted the whole run before
  // any worker launched — while a profile WITH the block worked, which is why it
  // only ever failed in fixtures.
  const sandbox = makeSandbox();
  writeFileSync(join(sandbox.dir, 'config', 'profile.yml'), 'spend_tier: economy\n');

  const out = runHarness(
    sandbox,
    `
read_gate_bands
echo "rc=$?"
echo "fallbacks=$JEV_BAND_LOW/$JEV_BAND_GUARDED/$JEV_BAND_MID"
`,
  );
  assert.match(out, /rc=0/, 'a profile with no bands must not fail the run');
  assert.match(out, /fallbacks=2\.26\/2\.6\/3\.2/, 'absent bands fall back to the measured defaults');
});

test('the calibrated defaults ship in the runner and match the profile', () => {
  assert.match(runnerSource, /JEV_BAND_LOW="2\.26"/, 'runner fallback must be the measured p15');
  const profile = readFileSync(join(ROOT, 'config', 'profile.yml'), 'utf8');
  assert.match(profile, /band_low:\s*2\.26/, 'config band_low must be 2.26');
  assert.match(profile, /band_mid:\s*3\.2/, 'config band_mid must be 3.2');
});

test('the runner keeps bash 3.2 safe constructs only', () => {
  // Strip comments first: the file DOCUMENTS `wait -n` as the construct it
  // avoids, so a naive scan over raw source fails on its own explanation.
  const code = runnerSource.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  for (const forbidden of [/wait\s+-n/, /declare\s+-A/, /\$\{!\w+@\}/, /mapfile\b/, /readarray\b/]) {
    assert.doesNotMatch(code, forbidden, `found a bash 4.x-only construct: ${forbidden}`);
  }
});

test('the EXIT trap drains before releasing the lock', () => {
  const trapLine = runnerSource.split('\n').find((l) => l.startsWith('trap ') && l.includes('jev_drain'));
  assert.ok(trapLine, 'the EXIT trap must drain the pre-screen queue');
  assert.ok(trapLine.indexOf('jev_drain') < trapLine.indexOf('release_lock'), 'drain must come first so log writes precede lock release');
  assert.ok(/declare -f jev_drain/.test(trapLine), 'the trap must guard against jev_drain being undefined on an early exit');
});

/**
 * Maximum number of gate calls that were simultaneously in flight.
 *
 * Built from the stub's own start/end stamps: a sweep line over every interval.
 * When a start coincides with an end, the end is processed first — the call it
 * belongs to is either still running at that instant or genuinely finished, and
 * counting it as live is the conservative (never under-reporting) choice.
 */
function observedOverlap(sandbox) {
  const read = (suffix) =>
    existsSync(`${sandbox.track}.${suffix}`)
      ? readFileSync(`${sandbox.track}.${suffix}`, 'utf8').trim().split('\n').filter(Boolean).map(Number)
      : [];

  const starts = read('start');
  const ends = read('end');
  const events = [
    ...starts.map((t) => ({ t, d: 1 })),
    ...ends.map((t) => ({ t, d: -1 })),
  ].sort((a, b) => a.t - b.t || a.d - b.d);

  let live = 0;
  let max = 0;
  for (const e of events) {
    live += e.d;
    if (live > max) max = live;
  }
  return { starts: starts.length, ends: ends.length, max };
}
