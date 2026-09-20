// tests/batch-runner-cli-dispatch.test.mjs — pins the non-Claude worker
// dispatch added by the --cli flag (PR #738).
//
// THE BUG THIS PINS
//
// process_offer() builds `model_args=()` and only fills it when --model was
// passed. Under `set -u`, bash 3.2 (the /bin/bash that ships with macOS)
// treats "${model_args[@]}" on an empty array as an unbound variable, so
// `--cli opencode` without --model aborted every worker launch with
// "model_args[@]: unbound variable" and each offer was recorded as failed.
// bash >= 4.4 tolerates the expansion, which is why the bug only shows up on
// the default macOS shell. The fix uses the ${arr[@]+"${arr[@]}"} idiom.
//
// The tests extract the real dispatch block out of batch/batch-runner.sh and
// run it through the same bash the runner would use, with a stub `opencode`
// on PATH, so the test and the implementation cannot drift apart. The static
// check guards the idiom on platforms whose bash would not reproduce the bug.
import { pass, fail, rmSync, getBash } from './helpers.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { join, dirname, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n');

console.log('\nbatch-runner.sh — --cli worker dispatch (PR #738)');

// ── static checks ───────────────────────────────────────────────────────────

const dispatchBlock = (() => {
  const m = SRC.match(/  local full_prompt=""\n  local -a model_args=\(\)\n[\s\S]*?\n    esac\n/);
  return m ? m[0] : null;
})();

if (dispatchBlock) {
  pass('found the non-claude dispatch block (full_prompt/model_args → case "$CLI")');
} else {
  fail('could not find the non-claude dispatch block in batch/batch-runner.sh — this test needs updating');
}

// A bare expansion is one not wrapped by the `${arr[@]+...}` guard, i.e. not
// immediately preceded by `+`.
if (/(^|[^+])"\$\{model_args\[@\]\}"/m.test(SRC)) {
  fail('a bare "${model_args[@]}" expansion is present — bash 3.2 aborts with "unbound variable" when --model is not passed');
} else if (/\$\{model_args\[@\]\+"\$\{model_args\[@\]\}"\}/.test(SRC)) {
  pass('model_args is expanded with the ${arr[@]+"${arr[@]}"} idiom (safe on bash 3.2 under set -u)');
} else {
  fail('model_args is not expanded at all — --model would be silently ignored for opencode');
}

if (/Unknown --cli/.test(SRC)) {
  pass('check_prerequisites rejects an unknown --cli value');
} else {
  fail('check_prerequisites does not reject an unknown --cli value');
}

// ── execution checks ────────────────────────────────────────────────────────

if (dispatchBlock) {
  const work = mkdtempSync(join(tmpdir(), 'batch-cli-dispatch-'));
  try {
    const bin = join(work, 'bin');
    mkdirSync(bin);
    // Stub opencode: print its argv one per line so the test can assert the
    // exact command the runner would launch.
    const stub = join(bin, 'opencode');
    writeFileSync(stub, '#!/usr/bin/env bash\nprintf \'ARG:%s\\n\' "$@"\n');
    if (process.platform === 'win32') {
      // fs.chmodSync is a no-op on Windows; set the bit through Git Bash.
      try { execFileSync(getBash(), ['-c', 'chmod +x bin/opencode'], { cwd: work }); } catch {}
    } else {
      chmodSync(stub, 0o755);
    }

    const systemPrompt = join(work, 'system-prompt.md');
    writeFileSync(systemPrompt, 'SYSTEM PROMPT');
    const logFile = join(work, 'worker.log');

    // The stub goes on PATH through the child environment, not the script
    // text: Git Bash converts an inherited Windows PATH to POSIX form, but a
    // `C:\...` entry spliced into the script splits on the drive-letter colon,
    // so `command -v opencode` missed the stub and the runner fell back to
    // `ollama` (exit 127 on windows-latest at 2c6a1d5). Same as test-all §13.
    const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };

    const buildScript = (model) => [
      'set -euo pipefail',
      'CLI=opencode',
      `MODEL=${JSON.stringify(model)}`,
      'prompt="JOB PROMPT"',
      `resolved_prompt=${JSON.stringify(systemPrompt)}`,
      `log_file=${JSON.stringify(logFile)}`,
      // The runner declares these before the loop; mirror them so the
      // extracted block runs in the same shape it has inside process_offer().
      // The block opens the retry loop (`while true; do`) and ends at the
      // dispatch `esac`; close the loop here after a single attempt.
      'local_wrapper() {',
      '  local -a claude_args=(-p)',
      dispatchBlock,
      '    break',
      '  done',
      '  printf \'EXIT:%s\\n\' "$exit_code"',
      '}',
      'local_wrapper',
    ].join('\n');

    const bash = getBash();

    // Case 1: --cli opencode without --model (the crashing case on bash 3.2)
    const script1 = join(work, 'no-model.sh');
    writeFileSync(script1, buildScript(''));
    let out1 = '';
    let err1 = null;
    try {
      out1 = execFileSync(bash, [script1], { encoding: 'utf-8', timeout: 30000, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      err1 = e;
    }
    const log1 = existsSync(logFile) ? readFileSync(logFile, 'utf-8') : '';
    if (err1 === null && /EXIT:0/.test(out1) && !/unbound variable/.test(String(err1?.stderr || ''))) {
      pass('--cli opencode without --model launches the worker (no "unbound variable" abort)');
    } else {
      fail(`--cli opencode without --model aborted: ${String(err1?.stderr || err1?.message || out1).trim().slice(0, 200)}`);
    }
    const args1 = log1.split('\n').filter((l) => l.startsWith('ARG:')).map((l) => l.slice(4));
    if (args1[0] === 'run' && args1.length === 2 && !args1.includes('--model')) {
      pass('without --model the runner calls `opencode run <prompt>` with no --model flag');
    } else {
      fail(`unexpected opencode argv without --model: ${JSON.stringify(args1)}`);
    }
    if (/^SYSTEM PROMPT\n\nJOB PROMPT$/.test(log1.replace(/^ARG:run\nARG:/, '').trim())) {
      pass('the system prompt and the job prompt are concatenated into one argument');
    } else {
      fail(`prompt concatenation drifted: ${JSON.stringify(log1.slice(0, 120))}`);
    }

    // Case 2: --cli opencode --model qwen2.5:32b forwards the model
    const script2 = join(work, 'with-model.sh');
    writeFileSync(script2, buildScript('qwen2.5:32b'));
    const out2 = execFileSync(bash, [script2], { encoding: 'utf-8', timeout: 30000, env });
    const args2 = (existsSync(logFile) ? readFileSync(logFile, 'utf-8') : '').split('\n').filter((l) => l.startsWith('ARG:')).map((l) => l.slice(4));
    if (/EXIT:0/.test(out2) && args2[0] === 'run' && args2[1] === '--model' && args2[2] === 'qwen2.5:32b') {
      pass('--model is forwarded to native `opencode run --model <name>`');
    } else {
      fail(`unexpected opencode argv with --model: ${JSON.stringify(args2)}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
