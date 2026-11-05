// sync-batch-input.mjs queues new URL(raw).href, which lowercases the host and
// adds a bare origin's trailing slash, and batch-state.tsv records that spelling.
// reconcile-pipeline.mjs compared it to pipeline.md as a raw string, so an offer
// the batch had finished stayed in Pending for good, at exit 0, and was queued
// for evaluation again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OVERRIDES = ['CAREER_OPS_DATA_DIR', 'CAREER_OPS_TRACKER', 'CAREER_OPS_PIPELINE', 'CAREER_OPS_SCAN_HISTORY', 'CAREER_OPS_PORTALS', 'CAREER_OPS_PROFILE', 'CAREER_OPS_FOLLOWUPS', 'CAREER_OPS_REPORTS', 'CAREER_OPS_CV', 'CAREER_OPS_JDS', 'CAREER_OPS_ADDITIONS'];

const REPORT = '# Evaluation: Acme -- Engineer\n\n**Score:** 4.2/5\n**URL:** https://example.com/\n';

function reconcile(pipelineUrl, stateUrl) {
  const root = mkdtempSync(join(tmpdir(), 'reconcile-url-spelling-'));
  try {
    for (const dir of ['batch', 'reports', 'data']) mkdirSync(join(root, dir));
    const pipeline = join(root, 'data', 'pipeline.md');
    writeFileSync(pipeline, `# Pipeline\n\n## Pending\n\n- [ ] ${pipelineUrl} | Acme | Engineer\n\n## Processed\n`);
    const state = join(root, 'batch', 'batch-state.tsv');
    writeFileSync(state, [
      'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries',
      `1\t${stateUrl}\tcompleted\t2026-10-01\t2026-10-01\t042\t4.2\t-\t0`,
      '',
    ].join('\n'));
    writeFileSync(join(root, 'reports', '042-acme-2026-10-01.md'), REPORT);
    const env = { ...process.env, CAREER_OPS_ROOT: root };
    for (const key of OVERRIDES) env[key] = '';
    const result = spawnSync(process.execPath, [join(ROOT, 'reconcile-pipeline.mjs'), '--pipeline', pipeline, '--state', state], { cwd: root, encoding: 'utf8', timeout: 30000, env });
    assert.equal(result.status, 0, describeSpawn(result));
    return readFileSync(pipeline, 'utf8');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const isMoved = (text) => {
  const [pending, processed] = text.split('## Processed');
  return !pending.includes('- [ ]') && processed.includes('- [x]');
};

test('control: the same spelling moves to Processed', () => {
  assert.ok(isMoved(reconcile('https://jobs.example.com/acme/1', 'https://jobs.example.com/acme/1')));
});

test('a mixed-case host still matches the href the batch recorded', () => {
  const url = 'https://Jobs.Example.com/acme/1';
  assert.ok(isMoved(reconcile(url, new URL(url).href)));
});

test('a bare origin still matches the trailing slash the batch added', () => {
  const url = 'https://careers.example.com';
  assert.ok(isMoved(reconcile(url, new URL(url).href)));
});

test('a different posting stays Pending', () => {
  assert.equal(isMoved(reconcile('https://jobs.example.com/acme/2', 'https://jobs.example.com/acme/1')), false);
});
