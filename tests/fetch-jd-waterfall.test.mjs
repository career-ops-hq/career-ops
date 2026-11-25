// fetchJd (fetch-jd.mjs): API, then the page, then the browser only when asked.
// Offline: a literal-private host is refused by every tier before any network call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fetchJd, fetchJdViaBrowser } from '../fetch-jd.mjs';

const PRIVATE = 'http://127.0.0.1/jobs/1';

test('without browser: true a miss stays a miss (null), no browser is launched', async () => {
  assert.equal(await fetchJd(PRIVATE), null);
});

test('with browser: true the browser tier answers with a failure reason, never a fabricated JD', async () => {
  const r = await fetchJd(PRIVATE, { browser: true });
  assert.ok(r.failure, 'a failure object, not a JD');
  assert.ok(r.failure.code);
  assert.equal(r.text, undefined);
});

test('fetchJdViaBrowser refuses a private host before launching anything', async () => {
  const r = await fetchJdViaBrowser(PRIVATE);
  assert.ok(r.failure.code);
});

test('--browser is documented in --help', () => {
  const out = spawnSync(process.execPath, [new URL('../fetch-jd.mjs', import.meta.url).pathname, '--help'], { encoding: 'utf8' });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /--browser/);
});
