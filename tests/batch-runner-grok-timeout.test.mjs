// batch-runner.sh: --cli grok, a per-worker time limit, and workers that never
// read the runner's stdin.
//
// Like tests/batch-runner-cli-dispatch.test.mjs, this extracts the real
// dispatch block and run_worker() from batch/batch-runner.sh and runs them
// with a stub CLI on PATH, so the test cannot drift from the script.
import { pass, fail, rmSync, getBash } from './helpers.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n');

console.log('\nbatch-runner.sh — --cli grok, worker time limit, closed stdin');

const dispatchBlock = SRC.match(/  local full_prompt=""\n  local -a model_args=\(\)\n[\s\S]*?\n    esac\n/)?.[0];
const runWorker = SRC.match(/^run_worker\(\) \{\n[\s\S]*?\n\}\n/m)?.[0];

if (/Supported: claude, opencode, gemini, qwen, grok/.test(SRC)) pass('check_prerequisites accepts --cli grok');
else fail('check_prerequisites does not list grok as a supported --cli');

if (/--worker-timeout N/.test(SRC)) pass('usage documents --worker-timeout');
else fail('usage does not document --worker-timeout');

if (dispatchBlock && runWorker) pass('found the dispatch block and run_worker()');
else fail(`missing ${dispatchBlock ? '' : 'dispatch block '}${runWorker ? '' : 'run_worker()'} in batch/batch-runner.sh`);

function stub(bin, name, body) {
  const path = join(bin, name);
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  if (process.platform === 'win32') {
    try { execFileSync(getBash(), ['-c', `chmod +x bin/${name}`], { cwd: dirname(bin) }); } catch {}
  } else {
    chmodSync(path, 0o755);
  }
}

if (dispatchBlock && runWorker) {
  const work = mkdtempSync(join(tmpdir(), 'batch-grok-'));
  try {
    const bin = join(work, 'bin');
    mkdirSync(bin);
    const systemPrompt = join(work, 'system-prompt.md');
    writeFileSync(systemPrompt, 'SYSTEM PROMPT');
    const logFile = join(work, 'worker.log');
    const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };

    const run = (cli, timeout) => {
      const script = join(work, `${cli}.sh`);
      writeFileSync(script, [
        'set -euo pipefail',
        `CLI=${cli}`,
        'MODEL=""',
        `WORKER_TIMEOUT=${timeout}`,
        'prompt="JOB PROMPT"',
        `resolved_prompt=${JSON.stringify(systemPrompt)}`,
        `log_file=${JSON.stringify(logFile)}`,
        runWorker,
        'wrapper() {',
        '  local -a claude_args=(-p)',
        dispatchBlock,
        '    break',
        '  done',
        '  printf \'EXIT:%s\\n\' "$exit_code"',
        '}',
        'wrapper',
      ].join('\n'));
      const started = Date.now();
      const out = execFileSync(getBash(), [script], { encoding: 'utf-8', timeout: 60_000, env, input: 'RUNNER STDIN\n' });
      return { out, seconds: (Date.now() - started) / 1000, log: existsSync(logFile) ? readFileSync(logFile, 'utf-8') : '' };
    };

    stub(bin, 'grok', [
      'printf \'ARG:%s\\n\' "$@"',
      'if IFS= read -r line; then echo "STDIN:$line"; else echo "STDIN:eof"; fi',
    ].join('\n'));
    const grok = run('grok', 600);
    const args = grok.log.split('\n').filter(l => l.startsWith('ARG:')).map(l => l.slice(4));
    if (/EXIT:0/.test(grok.out) && args[0] === '--always-approve' && args.includes('-p')) pass('--cli grok launches `grok --always-approve ... -p <prompt>`');
    else fail(`unexpected grok launch: ${JSON.stringify({ out: grok.out, args })}`);
    if (args.at(-1) === 'SYSTEM PROMPT\n\nJOB PROMPT' || grok.log.includes('ARG:SYSTEM PROMPT\n\nJOB PROMPT')) pass('grok gets the system prompt and job prompt as one argument');
    else fail(`grok prompt drifted: ${JSON.stringify(grok.log.slice(0, 160))}`);
    if (/STDIN:eof/.test(grok.log)) pass('the worker reads EOF, not the runner\'s stdin');
    else fail(`the worker read the runner's stdin: ${JSON.stringify(grok.log.match(/STDIN:.*/)?.[0])}`);

    stub(bin, 'grok', 'sleep 30');
    const slow = run('grok', 2);
    if (/EXIT:124/.test(slow.out) && slow.seconds < 20) pass(`a worker past --worker-timeout is stopped with exit 124 (${slow.seconds.toFixed(1)}s)`);
    else fail(`slow worker: ${JSON.stringify({ out: slow.out, seconds: slow.seconds })}`);
    if (/worker timed out after 2s/.test(slow.log)) pass('the timeout is written to the worker log, where the failure message is read from');
    else fail(`no timeout line in the worker log: ${JSON.stringify(slow.log.slice(-160))}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Bash arithmetic wraps past 2^63-1, and a value that wraps to 0 or below
// would silently turn the watchdog off. Same bound as --limit.
{
  const work = mkdtempSync(join(tmpdir(), 'batch-worker-timeout-flag-'));
  try {
    const batch = join(work, 'batch');
    mkdirSync(batch);
    copyFileSync(join(ROOT, 'batch/batch-runner.sh'), join(batch, 'batch-runner.sh'));
    writeFileSync(join(batch, 'batch-prompt.md'), 'Test prompt');
    writeFileSync(join(batch, 'batch-input.tsv'), 'id\turl\tsource\tnotes\n1\thttps://jobs.fabrikam.example/1\ttest\t\n');
    // The prerequisite check wants a CLI on PATH; a dry run never calls it.
    const fakeBin = join(work, 'bin');
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, 'claude'), '#!/usr/bin/env bash\nexit 99\n', { mode: 0o755 });
    const env = { ...process.env, PATH: fakeBin + delimiter + process.env.PATH };
    const flag = (value) => spawnSync(getBash(), [join(batch, 'batch-runner.sh'), '--dry-run', '--model', 'test-model', '--worker-timeout', value], { encoding: 'utf8', timeout: 10000, env });
    const rejected = ['9223372036854775808', '18446744073709551616', '0009223372036854775808', '99999999999999999999']
      .filter((v) => { const r = flag(v); return !(r.status === 1 && /--worker-timeout must be at most 9223372036854775807/.test(r.stdout)); });
    if (rejected.length === 0) pass('--worker-timeout rejects values Bash arithmetic would wrap');
    else fail(`--worker-timeout accepted oversized values: ${rejected.join(', ')}`);
    const accepted = ['0', '0009', '9223372036854775807'].filter((v) => flag(v).status !== 0);
    if (accepted.length === 0) pass('--worker-timeout accepts 0, leading zeroes and the largest 64-bit value');
    else fail(`--worker-timeout rejected valid values: ${accepted.join(', ')}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
