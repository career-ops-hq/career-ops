// tests/capture-jd-dedup-posting.test.mjs — a capture of a posting already in
// the pipeline is a duplicate however the browser spells its URL.
//
// capture-jd.mjs deduplicated by exact URL, trimming only a trailing slash.
// A URL copied from the browser usually carries a tracking parameter
// (`?gh_src=…`, `?utm_source=…`) or a different host case than the row the
// scanner wrote, so the same posting became a second Pending row and a second
// jds/ capture. The scanner's own dedup (url-key.mjs) reads those as one
// posting; the capture now does too.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { urlAlreadyPresent } from '../capture-jd.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 10 }); });

const POSTING = 'https://job-boards.greenhouse.io/acme/jobs/123';
const row = (url) => `- [ ] ${url} | Acme | Data Engineer\n`;

test('a tracking parameter or the host\'s case does not make a second posting', () => {
  for (const spelling of [
    `${POSTING}?gh_src=abc123`,
    `${POSTING}?utm_source=linkedin&utm_medium=social`,
    'https://Job-Boards.Greenhouse.io/acme/jobs/123',
  ]) {
    assert.equal(urlAlreadyPresent(row(POSTING), spelling), true, spelling);
    assert.equal(urlAlreadyPresent(row(spelling), POSTING), true, spelling);
  }
  // A completed row carries the report number before the URL.
  assert.equal(urlAlreadyPresent(`- [x] #12 | ${POSTING} | Acme | Data Engineer\n`, `${POSTING}?gh_src=x`), true);
});

test('control: another posting, another language or another fragment stays new', () => {
  assert.equal(urlAlreadyPresent(row(POSTING), 'https://job-boards.greenhouse.io/acme/jobs/124'), false);
  assert.equal(urlAlreadyPresent(row('https://acme.com/careers/job/1?lang=de'), 'https://acme.com/careers/job/1?lang=en'), false);
  assert.equal(urlAlreadyPresent(row('https://acme.com/careers#/job/12'), 'https://acme.com/careers#/job/13'), false);
});

test('the CLI writes no second row and no second capture', () => {
  const root = mkdtempSync(join(tmpdir(), 'capture-jd-dedup-'));
  roots.push(root);
  mkdirSync(join(root, 'data'), { recursive: true });
  const pipeline = join(root, 'data', 'pipeline.md');
  writeFileSync(pipeline, `# Pipeline\n\n## Pending\n\n${row(POSTING)}\n## Processed\n\n`);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('CAREER_OPS_')) delete env[key];
  env.CAREER_OPS_ROOT = root;
  const r = spawnSync(process.execPath, [join(ROOT, 'capture-jd.mjs'), '--url', `${POSTING}?gh_src=abc123`,
    '--company', 'Acme', '--role', 'Data Engineer', '--text-file', '-', '--json'],
  { cwd: root, encoding: 'utf-8', env, input: 'Build pipelines.\n', timeout: 60_000 });
  assert.equal(r.error, undefined, describeSpawn(r));
  assert.equal(r.status, 0, describeSpawn(r));
  assert.equal(JSON.parse(r.stdout).duplicate, true, r.stdout);
  assert.equal(readFileSync(pipeline, 'utf-8').match(/^- \[ \]/gm).length, 1);
  let captures = [];
  try { captures = readdirSync(join(root, 'jds')); } catch { /* no jds/ at all: nothing captured */ }
  assert.deepEqual(captures, []);
});
