// Exercise actual capture writes without a browser or a network request.
import assert from 'node:assert/strict';
import fs, { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pass, fail } from './helpers.mjs';
const root = mkdtempSync(join(tmpdir(), 'career-ops-capture-collision-'));
const previousRoot = process.env.CAREER_OPS_ROOT;
process.env.CAREER_OPS_ROOT = root;
const { archiveUrl } = await import('../archive-posting.mjs?archive-posting-collision');
function browser() {
  return { async newContext() {
    let url;
    return { async route() {}, async close() {}, async newPage() {
      return { async goto(value) { url = value; return { status: () => 200 }; }, url() { return url; },
        async waitForTimeout() {}, async title() { return 'Engineer | Fictional'; }, async $eval() { return 'Engineer'; },
        async evaluate() { return 'Fictional engineering role with responsibilities and requirements. '.repeat(40); },
        async pdf() { return Buffer.from('%PDF-fixture ' + url); } };
    } };
  } };
}
function check(label, fn) { try { fn(); pass(label); } catch (e) { fail(`${label}: ${e.message}`); process.exitCode = 1; } }
const capture = url => archiveUrl(browser(), url, { company: 'Fictional', role: 'Engineer' });
const read = result => readFileSync(join(root, 'jds', result.filename), 'utf8');
try {
  const urls = [101, 202].map(n => `https://boards.greenhouse.io/fictional/jobs/${n}`);
  const first = await capture(urls[0]);
  const firstBytes = read(first);
  const second = await capture(urls[1]);
  check('distinct same-title postings retain independent captures', () => {
    assert.notEqual(first.filename, second.filename);
    assert.equal(read(first), firstBytes);
    assert.equal(read(second), '%PDF-fixture ' + urls[1]);
    assert.match(first.filename, /^\d{4}-\d{2}-\d{2}_fictional_engineer.*\.pdf$/);
  });
  const repeated = await capture(urls[0]);
  check('repeated URL preserves the earlier snapshot', () => {
    assert.notEqual(repeated.filename, first.filename);
    assert.equal(read(first), firstBytes);
    assert.equal(read(repeated), firstBytes);
  });
  const concurrent = await Promise.all(Array.from({ length: 4 }, () => capture(urls[0])));
  check('concurrent writers reserve separate destinations without overwrite', () => {
    assert.equal(new Set(concurrent.map(r => r.filename)).size, 4);
    assert.equal(read(first), firstBytes);
    assert.equal(readdirSync(join(root, 'jds')).length, 7);
    for (const result of concurrent) assert.equal(read(result), firstBytes);
  });
  const realOpen = fs.promises.open;
  const realUnlink = fs.promises.unlink;
  for (const [label, writeFails, closeFails, unlinkFails] of [
    ['write failure removes the partial capture', true, false, false],
    ['close failure cannot mask a write failure or skip cleanup', true, true, false],
    ['close failure after writing removes the unconfirmed capture', false, true, false],
    ['cleanup failure preserves the original write error', true, false, true],
  ]) {
    const writeError = new Error('injected write failure');
    const closeError = new Error('injected close failure');
    const before = readdirSync(join(root, 'jds'));
    let cleanupAttempts = 0;
    fs.promises.open = async (...args) => {
      const file = await realOpen(...args);
      return {
        async writeFile(buffer) {
          await file.writeFile(writeFails ? buffer.subarray(0, 4) : buffer);
          if (writeFails) throw writeError;
        },
        async close() {
          await file.close();
          if (closeFails) throw closeError;
        },
      };
    };
    fs.promises.unlink = async path => {
      cleanupAttempts++;
      if (unlinkFails) throw new Error('injected cleanup failure');
      return realUnlink(path);
    };
    syncBuiltinESMExports();
    try {
      const error = await capture(urls[0]).then(() => null, err => err);
      check(label, () => {
        assert.equal(error, writeFails ? writeError : closeError);
        assert.equal(cleanupAttempts, 1);
        if (!unlinkFails) assert.deepEqual(readdirSync(join(root, 'jds')), before);
      });
    } finally {
      fs.promises.open = realOpen;
      fs.promises.unlink = realUnlink;
      syncBuiltinESMExports();
    }
  }
} finally {
  if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
  else process.env.CAREER_OPS_ROOT = previousRoot;
  rmSync(root, { recursive: true, force: true, maxRetries: 10 });
}
