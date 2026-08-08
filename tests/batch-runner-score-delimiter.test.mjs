// tests/batch-runner-score-delimiter.test.mjs — the worker payload is split on a
// delimiter that preserves empty fields.
//
// THE BUG THIS PINS
//
// batch-runner.sh serialises the worker's final JSON into three fields and reads
// them back with `read -r parsed_status parsed_error parsed_score`. When those
// fields were joined and split on TAB, the common path broke:
//
//   a successful worker has status="completed", error EMPTY, score=3.4
//   emitted:  completed \t \t 3.4
//
// Tab is IFS *whitespace*, so bash collapses runs of it and strips leading and
// trailing occurrences. The two tabs around the empty `error` collapse into one:
//
//   parsed_status="completed"  parsed_error="3.4"  parsed_score=""
//
// The `elif [[ -n "$parsed_score" ]]` branch then never fires, and EVERY
// successful offer records score "-".
//
// It is silent and self-consistent: exit code 0, status `completed`, a real
// report on disk, and a score column that is uniformly useless. Nothing in the
// run summary shows it.
//
// This test extracts the REAL emitter out of batch/batch-runner.sh and runs it,
// rather than restating it, so the two cannot drift apart.
import { pass, fail, getBash } from './helpers.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n');

console.log('\nbatch-runner.sh — worker payload delimiter');

// --- the two halves must agree -------------------------------------------
// Emitter: the node -e program's `process.stdout.write(status + <D> + error ...)`
const emit = SRC.match(/process\.stdout\.write\(status \+ "([^"]+)" \+ error \+ "([^"]+)" \+ score\)/);
// Reader: `IFS=$'<D>' read -r parsed_status parsed_error parsed_score`
const read = SRC.match(/IFS=\$'([^']+)' read -r parsed_status parsed_error parsed_score/);

if (!emit) {
  fail('could not find the worker-payload emitter in batch/batch-runner.sh — this test needs updating');
} else if (!read) {
  fail('could not find the worker-payload reader in batch/batch-runner.sh — this test needs updating');
} else {
  if (emit[1] === emit[2] && emit[1] === read[1]) {
    pass(`emitter and reader use the same delimiter (${JSON.stringify(read[1])})`);
  } else {
    fail(`delimiter mismatch: emitter ${JSON.stringify(emit[1])}/${JSON.stringify(emit[2])}, reader ${JSON.stringify(read[1])}`);
  }

  // IFS whitespace (space, tab, newline) collapses runs and drops empty fields.
  // Any of the three reintroduces the bug regardless of how the code reads.
  if (!/^\\?[tn]$/.test(read[1]) && read[1] !== ' ') {
    pass('the delimiter is not IFS whitespace, so empty fields survive the split');
  } else {
    fail(`delimiter ${JSON.stringify(read[1])} is IFS whitespace — empty fields collapse and score is lost`);
  }
}

// --- end to end, using the real emitter ----------------------------------
// A successful worker: error is empty and score is present. That is the exact
// shape that broke, and the only one worth asserting.
if (emit && read) {
  const nodeProg = SRC.match(/parsed=\$\(printf '%s' "\$worker_result_json" \| node -e '([\s\S]*?)'\s*2>\/dev\/null/);
  if (!nodeProg) {
    fail('could not extract the node -e payload parser from batch-runner.sh');
  } else {
    const work = mkdtempSync(join(tmpdir(), 'cops-delim-'));
    try {
      const script = join(work, 'check.sh');
      writeFileSync(script, [
        '#!/usr/bin/env bash',
        `worker_result_json='{"status":"completed","error":null,"score":3.4}'`,
        `parsed=$(printf '%s' "$worker_result_json" | node -e '${nodeProg[1]}' 2>/dev/null || true)`,
        `IFS=$'${read[1]}' read -r parsed_status parsed_error parsed_score <<< "$parsed"`,
        'score="-"',
        'if [[ "$parsed_status" == "failed" ]]; then :',
        'elif [[ -n "$parsed_score" ]]; then score="$parsed_score"; fi',
        'printf "%s|%s|%s\\n" "$parsed_status" "$parsed_error" "$score"',
      ].join('\n'));

      const out = execFileSync(getBash(), [script], { encoding: 'utf-8', timeout: 30000 }).trim();
      const [status, error, score] = out.split('|');

      if (score === '3.4') {
        pass('a successful worker records its real score (not "-")');
      } else {
        fail(`score was recorded as "${score}" instead of 3.4 — the empty error field collapsed the split`);
      }

      if (error === '') {
        pass('the empty error field stays empty rather than absorbing the score');
      } else {
        fail(`error absorbed the next field: "${error}"`);
      }

      if (status === 'completed') {
        pass('status is still parsed correctly');
      } else {
        fail(`status parsed as "${status}"`);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
}
