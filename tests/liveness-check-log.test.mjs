// check-liveness records every conclusive verdict (open or closed) with the day
// it ran in data/liveness-checks.tsv, so the Today page can say "open, checked
// 2 days ago". Unattended sweeps (--tracker, --pipeline) pace browser visits.
//
// Run:  node --test tests/liveness-check-log.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const sandbox = mkdtempSync(join(tmpdir(), 'liveness-log-'));
process.env.CAREER_OPS_LIVENESS_LOG = join(sandbox, 'data', 'liveness-checks.tsv');
process.on('exit', () => rmSync(sandbox, { recursive: true, force: true, maxRetries: 10 }));

const { recordLivenessChecks, sweepThrottleBaseMs } = await import('../check-liveness.mjs');
const { parseLivenessLog } = await import('../lib/posting-facts.mjs');
const { localToday } = await import('../lib/local-today.mjs');

test('recordLivenessChecks writes active and closed verdicts with today, creating the data dir', async () => {
  const log = process.env.CAREER_OPS_LIVENESS_LOG;
  assert.equal(existsSync(log), false);
  const n = await recordLivenessChecks([
    { url: 'https://a.example.com/j/1', result: 'active', code: 'ok' },
    { url: 'https://a.example.com/j/2', result: 'expired', code: 'expired_banner' },
    { url: 'https://a.example.com/j/3', result: 'uncertain', code: 'blocked' },
  ]);
  assert.equal(n, 2);
  const parsed = parseLivenessLog(readFileSync(log, 'utf-8'));
  assert.deepEqual(parsed.get('https://a.example.com/j/1'), { result: 'active', day: localToday() });
  assert.equal(parsed.get('https://a.example.com/j/2').result, 'expired');
  assert.equal(parsed.has('https://a.example.com/j/3'), false);
});

test('main() calls recordLivenessChecks inside the record gate', () => {
  const src = readFileSync(join(ROOT, 'check-liveness.mjs'), 'utf-8');
  const body = src.slice(src.indexOf('async function main('));
  assert.match(body, /await recordLivenessChecks\(verdicts\)/);
});

test('tracker and pipeline sweeps pace browser visits by default; a spot check does not', () => {
  assert.equal(sweepThrottleBaseMs(['--tracker', '--pipeline', '--discard-expired', '--apply']), 5000);
  assert.equal(sweepThrottleBaseMs(['--pipeline']), 5000);
  assert.equal(sweepThrottleBaseMs(['--tracker', '--throttle=1000']), 1000);
  assert.equal(sweepThrottleBaseMs(['https://a.example.com/j/1']), 0);
});
