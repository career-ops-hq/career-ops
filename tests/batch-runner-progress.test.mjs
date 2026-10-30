import { pass, fail, getBash } from './helpers.mjs';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8');

function runFixtureBatch({ offers, parallel, workerSeconds = 0 }) {
  const dir = mkdtempSync(join(tmpdir(), 'batch-progress-'));
  const batchDir = join(dir, 'batch');
  const binDir = join(dir, 'bin');
  for (const d of [batchDir, binDir, join(dir, 'reports'), join(dir, 'data')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(batchDir, 'batch-runner.sh'), SRC);
  writeFileSync(join(batchDir, 'batch-prompt.md'), 'Fixture prompt for {{URL}} {{ID}}\n');
  writeFileSync(join(batchDir, 'batch-input.tsv'), ['id\turl\tsource\tnotes',
    ...Array.from({ length: offers }, (_, i) => `${i + 1}\thttps://jobs.example.com/acme/${i + 1}\tfixture\t-`)].join('\n') + '\n');
  writeFileSync(join(dir, 'reserve-report-num.mjs'), [
    "import { readFileSync, writeFileSync, existsSync } from 'node:fs';",
    "if (!process.argv.includes('--release')) {",
    "  const n = (existsSync('counter.txt') ? parseInt(readFileSync('counter.txt', 'utf8'), 10) : 0) + 1;",
    "  writeFileSync('counter.txt', String(n));",
    "  console.log(String(n).padStart(3, '0'));",
    '}',
  ].join('\n') + '\n');
  for (const script of ['merge-tracker', 'reconcile-pipeline', 'verify-pipeline']) writeFileSync(join(dir, `${script}.mjs`), '\n');
  writeFileSync(join(binDir, 'curl'), '#!/usr/bin/env bash\nexit 1\n');
  writeFileSync(join(binDir, 'claude'), `#!/usr/bin/env bash\nsleep ${workerSeconds}\nexit 1\n`);
  for (const f of ['batch/batch-runner.sh', 'bin/curl', 'bin/claude']) chmodSync(join(dir, f), 0o755);
  const started = Date.now();
  const res = spawnSync(getBash(), [join(batchDir, 'batch-runner.sh'), '--parallel', String(parallel), '--max-retries', '0', '--rate-limit-sleep', '0'], {
    cwd: dir,
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH}` },
    timeout: 120000,
  });
  rmSync(dir, { recursive: true, force: true });
  return { stdout: res.stdout, ms: Date.now() - started };
}

const progressLines = (stdout) => stdout.split('\n').filter((l) => l.startsWith('=== Progress:')).map((l) => l.replace(/, \d+s elapsed/, ''));

console.log('\nbatch-runner.sh — progress output');

for (const parallel of [1, 2]) {
  const { stdout } = runFixtureBatch({ offers: 3, parallel });
  const lines = progressLines(stdout);
  const expected = ['=== Progress: 1/3 offers finished ===', '=== Progress: 2/3 offers finished ===', '=== Progress: 3/3 offers finished ==='];
  if (JSON.stringify(lines) === JSON.stringify(expected)) pass(`--parallel ${parallel} prints one progress line per finished offer`);
  else fail(`--parallel ${parallel} progress lines: ${JSON.stringify(lines)}`);
  if (stdout.includes('--- Processing offer #3 (3/3): https://jobs.example.com/acme/3')) pass(`--parallel ${parallel} labels each offer with its position`);
  else fail(`--parallel ${parallel} has no position label on offer #3:\n${stdout}`);
}
