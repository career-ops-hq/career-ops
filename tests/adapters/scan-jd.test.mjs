/** Verify scan handoff reuse, expiry and failed-page fallback without network access. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureScanJds, readScanJd, samePostingUrl, JD_MAX_AGE_MS } from '../../adapters/node/browser/scan-jd.mjs';
const root = mkdtempSync(join(tmpdir(), 'scan-jd-'));
try {
  const offer = { url: 'https://example.com/jobs/123' };
  let calls = 0;
  const extract = async url => { calls++; return { url, title: 'Engineer', text: 'Responsibilities and qualifications' }; };
  assert.deepEqual(await captureScanJds([offer, offer], root, extract), { captured: 1, reused: 0, failed: 0 });
  assert.equal(readScanJd(offer.url, root).text, 'Responsibilities and qualifications');
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../../adapters/node/browser/scan-jd.mjs', import.meta.url)), offer.url, root], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).snapshot.text, 'Responsibilities and qualifications');
  assert.equal((await captureScanJds([offer], root, extract)).reused, 1);
  assert.equal(calls, 1);
  assert.equal((await captureScanJds([offer], root, extract, true)).captured, 1);
  assert.equal(calls, 2);
  assert.equal(readScanJd(offer.url, root, Date.now() + JD_MAX_AGE_MS), null);
  const bad = { url: 'https://example.com/jobs/empty' };
  assert.equal((await captureScanJds([bad], root, async () => ({ text: '' }))).failed, 1);
  assert.equal(readScanJd(bad.url, root), null);
  assert.equal((await captureScanJds([bad], root, extract)).captured, 1);
  const redirected = { url: 'https://example.com/jobs/redirected' };
  assert.equal((await captureScanJds([redirected], root, async () => ({ url: 'https://example.com/', text: 'Other page' }))).failed, 1);
  assert.equal(readScanJd(redirected.url, root), null);
  const ibm = { url: 'https://careers.ibm.com/careers/JobDetail?jobId=131606' };
  const localized = 'https://careers.ibm.com/en_US/careers/JobDetail?jobId=131606';
  assert.equal(samePostingUrl(ibm.url, localized), true);
  assert.equal(samePostingUrl(ibm.url, localized.replace('131606', '131607')), false);
  assert.equal((await captureScanJds([ibm], root, async () => ({ url: localized, text: 'IBM job description' }))).captured, 1);
  assert.equal(readScanJd(ibm.url, root).url, localized);
  console.log('scan-jd: capture, dedup, reuse, expiry and failure retry passed');
} finally { rmSync(root, { recursive: true, force: true }); }
