// extractVisibleText decoded four entities, and build-cv-html escapes more than
// that: every apostrophe is &#39; and every quote &quot;. So keyword coverage,
// which searches this text, reported "Master's degree" as missing from a CV that
// says it, and sent people to add a keyword they already had.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditAts } from '../verify-ats.mjs';

const cv = (line) => `<!doctype html><html><head><title>CV</title></head><body><h1>Jane Doe</h1><h2>Education</h2><p>${line}</p></body></html>`;

test('a keyword with an apostrophe is found behind the entity build-cv-html writes', () => {
  const { keywordCoverage } = auditAts(cv('Master&#39;s degree in Computer Science'), { keywords: "Master's degree" });
  assert.deepEqual(keywordCoverage.missing, []);
  assert.equal(keywordCoverage.percent, 100);
});

test('hex, named and quote forms decode too', () => {
  for (const [line, keyword] of [
    ['Master&#x27;s degree', "Master's degree"],
    ['Master&apos;s degree', "Master's degree"],
    ['the &quot;north star&quot; metric', '"north star"'],
    ['R&amp;D lead', 'R&D'],
  ]) {
    assert.deepEqual(auditAts(cv(line), { keywords: keyword }).keywordCoverage.missing, [], line);
  }
});

// A CV written by hand or exported from an editor spells curly quotes as named
// entities, and JD keywords often carry the curly forms.
test('the named curly quote entities decode too', () => {
  for (const [line, keyword] of [
    ['Master&rsquo;s degree', 'Master’s degree'],
    ['&lsquo;zero to one&rsquo; launches', '‘zero to one’'],
    ['the &ldquo;north star&rdquo; metric', '“north star”'],
  ]) {
    assert.deepEqual(auditAts(cv(line), { keywords: keyword }).keywordCoverage.missing, [], line);
  }
});

test('a keyword the CV does not have is still missing', () => {
  assert.deepEqual(auditAts(cv('Master&#39;s degree'), { keywords: 'Kubernetes' }).keywordCoverage.missing, ['Kubernetes']);
});

test('decoding is one pass: an escaped entity stays text', () => {
  assert.deepEqual(auditAts(cv('literal &amp;lt;b&amp;gt; in a bullet'), { keywords: '&lt;b&gt;' }).keywordCoverage.missing, []);
});
