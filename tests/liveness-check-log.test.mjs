// check-liveness records every conclusive verdict (open or closed) with the day
// it ran in data/liveness-checks.tsv, so the Today page can say "open, checked
// 2 days ago". A --tracker sweep paces browser visits.
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
  assert.deepEqual(parsed.get('https://a.example.com/j/1'), { result: 'active', day: localToday(), at: localToday() });
  assert.equal(parsed.get('https://a.example.com/j/2').result, 'expired');
  assert.equal(parsed.has('https://a.example.com/j/3'), false);
});

test('main() calls recordLivenessChecks inside the record gate', () => {
  const src = readFileSync(join(ROOT, 'check-liveness.mjs'), 'utf-8');
  const body = src.slice(src.indexOf('async function main('));
  assert.match(body, /await recordLivenessChecks\(verdicts\)/);
});

test('each verdict carries its local observation time, so a late commit cannot replace a newer one', async () => {
  const { localStamp } = await import('../check-liveness.mjs');
  const when = new Date(2026, 10, 23, 9, 5, 7);
  const stamp = localStamp(when);
  assert.match(stamp, /^2026-11-23T09:05:07[+-]\d{2}:\d{2}$/, 'local wall time plus its UTC offset');
  assert.equal(Date.parse(stamp), when.getTime());
  const src = readFileSync(join(ROOT, 'check-liveness.mjs'), 'utf-8');
  const body = src.slice(src.indexOf('async function main('));
  assert.match(body, /verdicts\.push\(\{ url, result, code, checkedAt: localStamp\(\) \}\)/);
});

test('a tracker sweep paces browser visits by default; --file and a spot check keep the old default', () => {
  assert.equal(sweepThrottleBaseMs(['--tracker', '--discard-expired', '--apply']), 5000);
  assert.equal(sweepThrottleBaseMs(['--pipeline']), 0, '--pipeline is not a check-liveness flag');
  assert.equal(sweepThrottleBaseMs(['--file', 'urls.txt']), 0);
  assert.equal(sweepThrottleBaseMs(['--file', 'urls.txt', '--throttle']), 5000);
  assert.equal(sweepThrottleBaseMs(['--tracker', '--throttle=1000']), 1000);
  assert.equal(sweepThrottleBaseMs(['https://a.example.com/j/1']), 0);
});
