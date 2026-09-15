// tests/url-key.test.mjs — normalizeUrl, the deterministic posting-URL key.
//
// url-key.mjs is a root script and gets its own suite, per ARCHITECTURE.md's
// `{module}.test.mjs` rule. These cases previously lived inside
// merge-tracker-url-dedup.test.mjs, which meant the only way to run url-key's
// unit tests was to run a suite named for a different script.
//
// The merge-tracker integration cases stay where they are: they drive the real
// CLI end-to-end, and the merge path is a different thing to prove.
import { pass, fail } from './helpers.mjs';
import assert from 'node:assert';
import { normalizeUrl } from '../url-key.mjs';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

console.log('normalizeUrl()');
ok('strips utm_* and gh_src, keeps gh_jid', () => {
  const a = normalizeUrl('https://careers.airbnb.com/positions/8028783?gh_jid=8028783&utm_source=x&gh_src=abc');
  assert.equal(a, 'https://careers.airbnb.com/positions/8028783?gh_jid=8028783');
});
ok('lowercases host, forces https, drops trailing slash + fragment', () => {
  assert.equal(normalizeUrl('HTTP://Jobs.Lever.co/Stripe/123/#apply'), 'https://jobs.lever.co/Stripe/123');
});
ok('query order does not matter (sorted)', () => {
  assert.equal(normalizeUrl('https://x.com/j?b=2&a=1'), normalizeUrl('https://x.com/j?a=1&b=2'));
});
ok('two genuinely different postings stay different', () => {
  assert.notEqual(
    normalizeUrl('https://job-boards.greenhouse.io/doordashusa/jobs/8027044'),
    normalizeUrl('https://job-boards.greenhouse.io/doordashusa/jobs/8026972'));
});
ok('idempotent', () => {
  const once = normalizeUrl('https://X.com/a/?utm_source=y');
  assert.equal(once, normalizeUrl(once));
});
ok('anything that is not an http(s) posting yields NO key', () => {
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl(null), '');
  // Non-http references and placeholders must not become comparable values.
  // The earlier lowercased-string fallback gave every one of these a key, so
  // two unrelated employers whose report said "N/A" matched each other.
  for (const v of ['local:jds/foo.md', 'N/A', 'n/a', 'TBD', '—', '-', 'none', 'see email']) {
    assert.equal(normalizeUrl(v), '', `${JSON.stringify(v)} must yield no key`);
  }
});

