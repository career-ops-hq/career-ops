// tests/batch-prefilter-url.test.mjs — batch/prefilter-url.mjs turns the status
// and body curl already fetched into a spawn / no-spawn decision, reusing
// liveness-core.mjs so the batch path and check-liveness.mjs agree.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import { decide } from '../batch/prefilter-url.mjs';

console.log('\nbatch/prefilter-url.mjs — zero-token spawn / no-spawn decision');

const long = Array.from({ length: 120 }, (_, i) => `requirement${i}`).join(' ');
const posting = 'https://boards.greenhouse.io/acme/jobs/1234567';
const eq = (label, got, want) => (got === want ? pass(label) : fail(`${label}: expected ${want}, got ${got}`));
const d = (input) => decide({ requestedUrl: posting, finalUrl: posting, ...input }).decision;

eq('HTTP 404 is a dead posting', d({ status: 404 }), 'skip-dead');
eq('HTTP 410 is a dead posting', d({ status: 410 }), 'skip-dead');
eq('a 200 page that says the job is gone is dead', d({ status: 200, bodyText: `Sorry, this job is no longer available. ${long}` }), 'skip-dead');
eq('a weak JOB EXPIRED banner on a long page proceeds', d({ status: 200, bodyText: `JOB EXPIRED. ${long}` }), 'proceed');
eq('a listing-page phrase on a long page proceeds', d({ status: 200, bodyText: `12 jobs found. ${long}` }), 'proceed');
eq('a live JD proceeds', d({ status: 200, bodyText: long }), 'proceed');
eq('an empty app shell proceeds: a JS-rendered board is not a dead one', d({ status: 200, bodyText: '' }), 'proceed');
eq('a few nav words proceed for the same reason', d({ status: 200, bodyText: 'Home Careers Sign in' }), 'proceed');
eq('HTTP 403 is unreadable in batch', d({ status: 403 }), 'skip-blocked');
eq('HTTP 429 is retried later', d({ status: 429 }), 'retry-later');
eq('HTTP 503 is retried later', d({ status: 503 }), 'retry-later');
eq('HTTP 500 is retried later', d({ status: 500 }), 'retry-later');
eq('no HTTP response at all (status 0) proceeds', d({ status: 0 }), 'proceed');
eq('a redirect from a posting to a board listing is unreadable, not dead', d({ status: 200, finalUrl: 'https://careers.acme.example/positions/', bodyText: long }), 'skip-blocked');

const r = decide({ status: 404, requestedUrl: posting });
eq('the code and reason are passed through', `${r.code}|${r.reason}`, 'http_gone|HTTP 404');

// ── CLI ────────────────────────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'prefilter-'));
try {
  const body = join(dir, 'body.txt');
  writeFileSync(body, `This job is no longer available. ${long}`);
  const cli = (...args) => spawnSync(NODE, ['batch/prefilter-url.mjs', ...args], { cwd: ROOT, encoding: 'utf-8' });
  const gone = cli('200', posting, posting, body);
  eq('CLI prints decision<TAB>code<TAB>reason', gone.stdout.split('\t')[0], 'skip-dead');
  eq('CLI output is one line', gone.stdout.trim().split('\n').length, 1);
  eq('CLI: a missing body file fails open', cli('200', posting, posting, join(dir, 'nope.txt')).stdout.split('\t')[0], 'proceed');
  eq('CLI: --help prints usage and does not run the filter', /^Usage:/.test(cli('--help').stdout), true);
  eq('CLI: no arguments at all fail open', cli().stdout.split('\t')[0], 'proceed');
  eq('CLI: a non-numeric status is treated as no response', cli('abc', posting, posting, body).stdout.split('\t')[0], 'skip-dead');
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}
