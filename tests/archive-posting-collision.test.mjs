// Exercise actual capture writes without a browser or a network request.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pass, fail } from './helpers.mjs';
const root = mkdtempSync(join(tmpdir(), 'career-ops-capture-collision-'));
const previousRoot = process.env.CAREER_OPS_ROOT;
process.env.CAREER_OPS_ROOT = root;
const { archiveUrl } = await import('../archive-posting.mjs');
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
} finally {
  process.env.CAREER_OPS_ROOT = previousRoot;
  rmSync(root, { recursive: true, force: true, maxRetries: 10 });
}
