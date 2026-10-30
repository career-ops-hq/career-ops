// The batch-runner.sh fixture that tests/batch-runner-default-parallel.test.mjs
// and tests/batch-runner-throttle-before-launch.test.mjs share: the runner
// copied into a temp tree, with a fake claude CLI that rate-limits offer 1 once
// and records how many workers were live as each offer started. The two live
// in separate files because each batch run costs seconds, and test-all.mjs
// gives every suite its own time budget.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { getBash, rmSync } from '../helpers.mjs';

export const SRC = readFileSync(new URL('../../batch/batch-runner.sh', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/**
 * Run a copy of the runner over `offers` fixture offers.
 *
 * @param {object} opts
 * @param {number} opts.offers - How many offers batch-input.tsv lists.
 * @param {string[]} [opts.args] - Extra runner arguments.
 * @param {string} [opts.src] - The runner source to run, SRC by default.
 * @param {boolean} [opts.rateLimitFirst] - Whether the fake CLI answers offer 1 with a 429 once.
 * @returns {{stdout: string, starts: Record<string, number>, launches: string[]}} The
 *   runner's stdout, the live-worker count each offer saw, and launches.log if the source wrote one.
 */
export function runBatch({ offers, args = [], src = SRC, rateLimitFirst = true }) {
  const dir = mkdtempSync(join(tmpdir(), 'batch-default-parallel-'));
  try {
    const batchDir = join(dir, 'batch');
    const binDir = join(dir, 'bin');
    for (const d of [batchDir, binDir, join(dir, 'live'), join(dir, 'reports'), join(dir, 'data')]) mkdirSync(d, { recursive: true });
    writeFileSync(join(batchDir, 'batch-runner.sh'), src);
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
      `if [[ "$id" == ${rateLimitFirst ? 1 : 'none'} && ! -f "$FIXTURE_DIR/limited" ]]; then`,
      '  sleep 0.5',
      '  : > "$FIXTURE_DIR/limited"',
      '  echo "Error: 429 Too Many Requests"',
      '  exit 1',
      'fi',
      ': > "$FIXTURE_DIR/live/$id"',
      'peak=$(ls "$FIXTURE_DIR/live" | wc -l | tr -d " ")',
      // Offers 2 and 3 wait (up to 10 s) to see each other instead of trusting a 1 s overlap: on Windows a worker can take
      // more than a second to reach this point, so the first one was gone before the second started. They look for each
      // other's file, not at the total, because the retry of offer 1 can be live too. If the runner is not parallel, the
      // wait runs out and the assertion still fails. A batch without offer 3 has no partner to wait for, so the wait is
      // left out there: it would run out every time, 10 s on Linux and about 14 s on Windows, where each sleep is a process.
      ...(offers >= 3 ? [
        'if [[ "$id" == 2 || "$id" == 3 ]]; then',
        '  other=$(( id == 2 ? 3 : 2 ))',
        '  for ((i = 0; i < 100; i++)); do [[ -f "$FIXTURE_DIR/live/$other" ]] && break; sleep 0.1; done',
        '  peak=1; [[ -f "$FIXTURE_DIR/live/$other" ]] && peak=2',
        'fi',
      ] : []),
      'echo "start $id live $peak" >> "$FIXTURE_DIR/starts.log"',
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
    const launchLog = join(dir, 'launches.log');
    const launches = existsSync(launchLog) ? readFileSync(launchLog, 'utf8').trim().split('\n') : [];
    return { stdout, starts, launches };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
