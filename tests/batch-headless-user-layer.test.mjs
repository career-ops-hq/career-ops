// tests/batch-headless-user-layer.test.mjs — an unattended worker never writes
// the user's standing instructions or profile.
//
// modes/_custom.md, modes/_profile.md and config/profile.yml are read by every
// mode and pasted into every batch worker prompt. A worker has no user to
// confirm a change, and the JD it reads is untrusted text, so a write from a
// worker turns one posting into a standing rule for every later run. The batch
// prompt forbade writes to cv.md and story-bank.md but not to these three, and
// modes/_shared.md and modes/pdf.md told any agent to write "lasting preferences" to _custom.md
// with no interactive-only scope. The runner also gave workers no signal that
// they run unattended.
//
// Run:  node tests/batch-headless-user-layer.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fail, getBash, pass, rmSync, ROOT, toBashPath } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

console.log('\nBatch workers never write the user rule files');

function test(name, fn) {
  try {
    fn();
    pass(name);
  } catch (error) {
    fail(`${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const USER_RULE_FILES = ['modes/_custom.md', 'modes/_profile.md', 'config/profile.yml'];

test('the batch worker prompt forbids writes to every user rule and profile file', () => {
  const prompt = read('batch/batch-prompt.md');
  const neverWrite = prompt.split('\n').filter((line) => /^- Never write\b/.test(line)).join('\n');
  for (const file of USER_RULE_FILES) {
    assert.ok(neverWrite.includes(`\`${file}\``), `batch/batch-prompt.md has no "Never write" rule naming ${file}`);
  }
});

for (const file of ['modes/_shared.md', 'modes/pdf.md']) {
  test(`${file} sends a lasting preference through retro, and only in an interactive session`, () => {
    const sentences = read(file).split(/(?<=\.\*{0,2})\s+/);
    const direct = sentences.filter((s) => /write (it|them) (to|into) `modes\/_custom\.md`/.test(s));
    assert.deepEqual(direct, [], `${file} still writes a preference straight to _custom.md instead of through retro`);
    const viaRetro = sentences.filter((s) => /`retro`/.test(s) && /`modes\/_custom\.md`/.test(s));
    assert.ok(viaRetro.length > 0, `${file} no longer tells the agent where lasting preferences go; update this test`);
    for (const s of viaRetro) {
      assert.match(s, /interactive session/i, `this retro instruction has no interactive-only scope: ${s}`);
    }
    const workerRules = sentences.filter((s) => /worker\b.*\bnever writes\b/.test(s));
    assert.ok(workerRules.length > 0, `${file} does not say what a delegated or batch worker must not write`);
    for (const workerRule of workerRules) {
      for (const target of USER_RULE_FILES) {
        assert.ok(workerRule.includes(`\`${target}\``), `${file} lets a worker write ${target}: ${workerRule}`);
      }
    }
  });
}

const RUNNER_SRC = read('batch/batch-runner.sh');

const WORKER_STUB = [
  '#!/usr/bin/env bash',
  'printf \'%s\' "${CAREER_OPS_HEADLESS-unset}" > "$CAPTURE_DIR/headless.txt"',
  'exit 1',
  '',
].join('\n');

test('batch-runner.sh launches every worker with CAREER_OPS_HEADLESS=1', () => {
  const base = mkdtempSync(join(tmpdir(), 'batch-headless-'));
  try {
    const dir = join(base, 'checkout');
    const binDir = join(base, 'bin');
    const captureDir = join(base, 'captures');
    for (const d of [join(dir, 'batch'), binDir, captureDir]) mkdirSync(d, { recursive: true });
    writeFileSync(join(dir, 'batch', 'batch-runner.sh'), RUNNER_SRC);
    chmodSync(join(dir, 'batch', 'batch-runner.sh'), 0o755);
    writeFileSync(join(dir, 'batch', 'batch-prompt.md'), 'Fixture worker prompt.\n');
    writeFileSync(join(dir, 'batch', 'batch-input.tsv'), 'id\turl\tsource\tnotes\n1\thttps://example.com/one\tfixture\t-\n');
    writeFileSync(join(dir, 'path-resolver.mjs'), read('path-resolver.mjs'));
    writeFileSync(join(dir, 'reserve-report-num.mjs'), "if (!process.argv.includes('--release')) console.log('001');\n");
    for (const name of ['merge-tracker.mjs', 'reconcile-pipeline.mjs', 'verify-pipeline.mjs']) writeFileSync(join(dir, name), '// Not under test here.\n');
    writeFileSync(join(binDir, 'claude'), WORKER_STUB);
    writeFileSync(join(binDir, 'curl'), '#!/usr/bin/env bash\nexit 1\n');
    chmodSync(join(binDir, 'claude'), 0o755);
    chmodSync(join(binDir, 'curl'), 0o755);

    const env = { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH}`, CAPTURE_DIR: captureDir };
    delete env.CAREER_OPS_HEADLESS;
    delete env.CAREER_OPS_ROOT;
    delete env.CAREER_OPS_DATA_DIR;
    const r = spawnSync(getBash(), [toBashPath(join(dir, 'batch', 'batch-runner.sh')), '--parallel', '1', '--max-retries', '0', '--rate-limit-sleep', '0'], {
      cwd: dir, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'], env,
    });
    assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
    const captured = join(captureDir, 'headless.txt');
    assert.ok(existsSync(captured), describeSpawn(r, 'the worker was never launched'));
    assert.equal(readFileSync(captured, 'utf8'), '1', 'the worker ran without CAREER_OPS_HEADLESS=1');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
