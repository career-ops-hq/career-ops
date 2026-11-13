// The batch runner keys progress by ID: concurrent syncs must allocate unique IDs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, pass, fail } from './helpers.mjs';

function check(label, fn) {
  try { fn(); pass(label); } catch (err) { fail(`${label}: ${err.message}`); process.exitCode = 1; }
}
const root = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-batch-sync-')));
const input = join(root, 'batch', 'batch-input.tsv');
const state = join(root, 'batch-state.tsv');
mkdirSync(join(root, 'batch'));
writeFileSync(input, 'id\turl\tsource\tnotes\n1\thttps://example.com/old\tmanual\tkeep this\n');
writeFileSync(state, 'id\turl\tstatus\n9\thttps://example.com/done\tcompleted\n');
const hook = join(root, 'delay-input-read.mjs');
writeFileSync(hook, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const read = fs.readFileSync;
fs.readFileSync = (file, ...args) => {
  const bytes = read(file, ...args);
  if (String(file) === process.env.BATCH_INPUT) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  return bytes;
};
syncBuiltinESMExports();\n`);
const pipelines = Array.from({ length: 4 }, (_, i) => {
  const file = join(root, `pipeline-${i}.md`);
  writeFileSync(file, `## Pending\n- [ ] https://example.com/job-${i} | Fictional | Engineer\n- [ ] https://example.com/shared | Fictional | Shared\n- [ ] https://example.com/done | Fictional | Completed\n`);
  return file;
});
const sync = (pipeline, args = []) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--import', pathToFileURL(hook).href, join(ROOT, 'sync-batch-input.mjs'), '--pipeline', pipeline, '--input', input, '--state', state, ...args], { env: { ...process.env, CAREER_OPS_ROOT: root, BATCH_INPUT: input }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', bytes => stdout += bytes);
  child.stderr.on('data', bytes => stderr += bytes);
  child.on('error', reject);
  child.on('close', status => resolve({ status, stdout, stderr }));
});
try {
  const results = await Promise.all(pipelines.map(file => sync(file)));
  const rows = readFileSync(input, 'utf8').trim().split('\n').slice(1).map(line => line.split('\t'));
  check('concurrent syncs allocate one unique batch ID to every distinct posting', () => {
    for (const result of results) assert.equal(result.status, 0, result.stderr);
    assert.equal(new Set(rows.map(row => row[0])).size, rows.length, 'batch IDs collide');
    for (let i = 0; i < 4; i++) assert.equal(rows.filter(row => row[1] === `https://example.com/job-${i}`).length, 1);
    assert.ok(rows.filter(row => row[0] !== '1').every(row => Number(row[0]) > 9));
    assert.deepEqual(rows[0], ['1', 'https://example.com/old', 'manual', 'keep this']);
  });
  check('concurrent syncs deduplicate shared and completed posting URLs', () => {
    assert.equal(rows.filter(row => row[1] === 'https://example.com/shared').length, 1);
    assert.equal(rows.filter(row => row[1] === 'https://example.com/done').length, 0);
  });
  const before = readFileSync(input, 'utf8');
  const repeated = await Promise.all(pipelines.map(file => sync(file)));
  check('repeated concurrent syncs leave the queue unchanged', () => {
    for (const result of repeated) assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(input, 'utf8'), before);
    assert.equal(existsSync(`${input}.lock`), false);
  });
  const previewPipeline = join(root, 'preview.md');
  writeFileSync(previewPipeline, '## Pending\n- [ ] https://example.com/preview | Fictional | Preview\n');
  const preview = await sync(previewPipeline, ['--dry-run']);
  check('dry-run remains read-only', () => {
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /dry-run/);
    assert.equal(readFileSync(input, 'utf8'), before);
    assert.equal(existsSync(`${input}.lock`), false);
  });
} finally {
  rmSync(root, { recursive: true, force: true, maxRetries: 10 });
}
