// sync-batch-input.mjs parsed argv by hand. A mistyped --dryrun was ignored, so
// the run wrote for real, and --input=path was never seen, so rows went to the
// default batch/batch-input.tsv instead of the file the caller named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OVERRIDES = ['CAREER_OPS_DATA_DIR', 'CAREER_OPS_TRACKER', 'CAREER_OPS_PIPELINE', 'CAREER_OPS_SCAN_HISTORY', 'CAREER_OPS_PORTALS', 'CAREER_OPS_PROFILE', 'CAREER_OPS_FOLLOWUPS', 'CAREER_OPS_REPORTS', 'CAREER_OPS_CV', 'CAREER_OPS_JDS', 'CAREER_OPS_ADDITIONS'];

function withPipeline(fn) {
  const root = mkdtempSync(join(tmpdir(), 'sync-batch-flags-'));
  try {
    const pipeline = join(root, 'pipeline.md');
    writeFileSync(pipeline, '# Pipeline\n\n## Pending\n\n- [ ] https://jobs.example.com/acme/1 | Acme | Engineer\n');
    const env = { ...process.env, CAREER_OPS_ROOT: root };
    for (const key of OVERRIDES) env[key] = '';
    const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'sync-batch-input.mjs'), ...args], { cwd: root, encoding: 'utf8', timeout: 30000, env });
    fn({ root, pipeline, run });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a mistyped --dry-run is refused and writes nothing', () => {
  withPipeline(({ root, pipeline, run }) => {
    const input = join(root, 'input.tsv');
    const result = run('--dryrun', `--pipeline=${pipeline}`, `--input=${input}`, `--state=${join(root, 'state.tsv')}`);
    assert.ok(exitedNonZero(result), describeSpawn(result, 'expected a non-zero exit'));
    assert.match(result.stderr, /--dryrun/);
    assert.equal(existsSync(input), false, 'a mistyped --dry-run wrote the input file');
  });
});

// Dry runs, and the URL is already queued in the named file: a flag that stopped
// being read shows up as a new entry, without writing to the checkout's default.
test('--input=path and --state=path read those files, the same as the spaced form', () => {
  withPipeline(({ root, pipeline, run }) => {
    const queued = join(root, 'queued.tsv');
    const empty = join(root, 'empty.tsv');
    writeFileSync(queued, 'id\turl\n1\thttps://jobs.example.com/acme/1\n');
    writeFileSync(empty, '');
    for (const args of [
      ['--input', queued, '--state', empty],
      [`--input=${queued}`, `--state=${empty}`],
      ['--input', empty, '--state', queued],
      [`--input=${empty}`, `--state=${queued}`],
    ]) {
      const result = run('--dry-run', `--pipeline=${pipeline}`, ...args);
      assert.equal(result.status, 0, describeSpawn(result));
      assert.match(result.stdout, /already in batch-input\.tsv or batch-state\.tsv/, args.join(' '));
    }
  });
});

test('an equals value may start with dashes, and a spaced flag still needs its value', () => {
  withPipeline(({ root, pipeline, run }) => {
    const empty = join(root, 'empty.tsv');
    writeFileSync(empty, '');
    writeFileSync(join(root, '--queued.tsv'), 'id\turl\n1\thttps://jobs.example.com/acme/1\n');
    const result = run('--dry-run', `--pipeline=${pipeline}`, '--input=--queued.tsv', `--state=${empty}`);
    assert.equal(result.status, 0, describeSpawn(result));
    assert.match(result.stdout, /already in batch-input\.tsv or batch-state\.tsv/);

    const missing = run('--dry-run', `--pipeline=${pipeline}`, '--input', '--dry-run');
    assert.ok(exitedNonZero(missing), describeSpawn(missing, 'expected a non-zero exit'));
  });
});

test('--help prints usage and exits 0', () => {
  withPipeline(({ run }) => {
    const result = run('--help');
    assert.equal(result.status, 0, describeSpawn(result));
    assert.match(result.stdout, /Usage: node sync-batch-input\.mjs/);
  });
});
