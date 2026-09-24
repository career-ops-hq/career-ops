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
import { normalizeUrl, isAggregatorUrl, aggregatorPostingId } from '../url-key.mjs';

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
ok('recognized hash-route job IDs stay distinct', () => {
  assert.notEqual(
    normalizeUrl('https://jobs.example.com/careers#/jobs/123'),
    normalizeUrl('https://jobs.example.com/careers#/jobs/456'));
});
ok('pre-existing internal fragment key is preserved beside promoted hash job ID', () => {
  assert.equal(
    normalizeUrl('https://jobs.example.com/careers?_career_ops_fragment_job_id=query-id#/jobs/hash-id'),
    'https://jobs.example.com/careers?_career_ops_fragment_job_id=hash-id&_career_ops_fragment_job_id=query-id');
});
ok('cosmetic fragments still collapse onto the fragment-free key', () => {
  assert.equal(
    normalizeUrl('https://jobs.example.com/careers#apply'),
    normalizeUrl('https://jobs.example.com/careers'));
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

// Ported here with #3653, which is what introduces isAggregatorUrl and
// aggregatorPostingId. They were written against merge-tracker-url-dedup's
// copy of these unit cases, and #4072 moved that copy into this file while
// #3653 was open. Landing the merge by taking either side alone would have
// dropped ten cases or duplicated the suite.
ok('a fully-qualified host with the root label is the same posting', () => {
  // `example.com.` and `example.com` are the same DNS name — the trailing dot
  // is the root label written explicitly. WHATWG URL preserves it, so without
  // normalization one posting yields two keys and dedup sees two rows where
  // there is one. This is NOT aggregator-specific: an employer board splits the
  // same way, which is why it belongs here rather than in isAggregatorUrl.
  assert.equal(
    normalizeUrl('https://linkedin.com./jobs/1'),
    normalizeUrl('https://linkedin.com/jobs/1'));
  assert.equal(
    normalizeUrl('https://job-boards.greenhouse.io./acme/jobs/7'),
    normalizeUrl('https://job-boards.greenhouse.io/acme/jobs/7'));
  // Case and the root label are independent; both must fold.
  assert.equal(
    normalizeUrl('https://WWW.LinkedIn.COM./jobs/1'),
    normalizeUrl('https://www.linkedin.com/jobs/1'));
  // Only ONE terminal dot is the root label. A doubled dot is not a valid host
  // and must not be silently repaired into a key that matches a real posting.
  assert.notEqual(
    normalizeUrl('https://linkedin.com../jobs/1'),
    normalizeUrl('https://linkedin.com/jobs/1'));
  // A bare root host keeps whatever key it had: rejecting it is a separate
  // decision from folding the root label, and this change does not make it.
  assert.equal(normalizeUrl('https://./jobs/1'), 'https://./jobs/1');
});

// ───────────────────────── isAggregatorUrl (unit) ─────────────────────────
console.log('\nisAggregatorUrl()');
ok('recognizes an aggregator at its apex and on any subdomain', () => {
  for (const u of [
    'https://linkedin.com/jobs/view/4001',
    'https://www.linkedin.com/jobs/view/4001',
    'https://uk.indeed.com/viewjob?jk=abc',
    'https://www.glassdoor.com/job-listing/x',
    'https://www.ziprecruiter.com/c/Acme/Job/Director-of-Marketing',
  ]) assert.equal(isAggregatorUrl(u), true, `${u} must be recognized`);
});
ok('employer-controlled boards are never aggregators', () => {
  for (const u of [
    'https://boards.greenhouse.io/acme/jobs/7001',
    'https://jobs.lever.co/acme/abc-123',
    'https://jobs.ashbyhq.com/acme/abc',
    'https://acme.wd1.myworkdayjobs.com/acme/job/Remote/Director_R1',
    'https://careers.acme.example/jobs/7001',
  ]) assert.equal(isAggregatorUrl(u), false, `${u} must not be treated as an aggregator`);
});
ok('matches on the registrable domain, not a bare substring', () => {
  // A lookalike host must not pass. `host.includes('linkedin.com')` would.
  assert.equal(isAggregatorUrl('https://notlinkedin.com.evil.example/jobs/1'), false);
  assert.equal(isAggregatorUrl('https://linkedin.com.evil.example/jobs/1'), false);
  assert.equal(isAggregatorUrl('https://myindeed.com/jobs/1'), false);
});
ok('anything that is not a URL is not an aggregator', () => {
  for (const v of ['', null, 'N/A', 'local:jds/foo.md']) assert.equal(isAggregatorUrl(v), false);
});
ok('the root label does not hide an aggregator', () => {
  // isAggregatorUrl parses the host itself rather than going through
  // normalizeUrl, so it needs the same folding or a trailing dot downgrades a
  // known aggregator to "employer board" — which is the direction that turns a
  // non-signal back into false evidence of a distinct requisition.
  assert.equal(isAggregatorUrl('https://linkedin.com./jobs/1'), true);
  assert.equal(isAggregatorUrl('https://www.indeed.com./viewjob?jk=1'), true);
  assert.equal(isAggregatorUrl('https://WWW.LinkedIn.COM./jobs/1'), true);
  // The lookalike guard must survive the folding.
  assert.equal(isAggregatorUrl('https://linkedin.com.evil.example./jobs/1'), false);
});

// ───────────────────────── aggregatorPostingId (unit) ─────────────────────────
console.log('\naggregatorPostingId()');
ok('LinkedIn: bare id, title slug and currentJobId are one posting id', () => {
  // The three shapes liveness-api.mjs already resolves to a single posting.
  assert.deepEqual(aggregatorPostingId('https://www.linkedin.com/jobs/view/4001'),
    { domain: 'linkedin.com', id: '4001' });
  assert.deepEqual(aggregatorPostingId('https://uk.linkedin.com/jobs/view/director-of-marketing-at-acme-4001/'),
    { domain: 'linkedin.com', id: '4001' });
  assert.deepEqual(aggregatorPostingId('https://www.linkedin.com/jobs/search/?currentJobId=4001&keywords=x'),
    { domain: 'linkedin.com', id: '4001' });
  // Different ids are different postings — that is the whole point.
  assert.notEqual(aggregatorPostingId('https://www.linkedin.com/jobs/view/4002').id, '4001');
});
ok('Indeed: jk (and vjk on a results page) is the posting id, the region host is not', () => {
  assert.deepEqual(aggregatorPostingId('https://uk.indeed.com/viewjob?jk=abc123'),
    { domain: 'indeed.com', id: 'abc123' });
  assert.deepEqual(aggregatorPostingId('https://www.indeed.com/jobs?q=marketing&vjk=abc123'),
    { domain: 'indeed.com', id: 'abc123' });
});
ok('no extractable id is UNKNOWN, never a guessed one', () => {
  // An aggregator whose id shape this module does not yet know, a URL on a
  // mapped aggregator that carries no id, an employer board, and a non-URL all
  // return null — callers must read that as "unknown", not "same posting".
  assert.equal(aggregatorPostingId('https://www.linkedin.com/jobs/view/not-a-number'), null);
  assert.equal(aggregatorPostingId('https://www.glassdoor.com/job-listing/x'), null);
  assert.equal(aggregatorPostingId('https://boards.greenhouse.io/acme/jobs/7001'), null);
  // Same /jobs/view/{id} path shape, employer-controlled host: the extractors
  // are keyed on the aggregator domain, never on the path alone.
  assert.equal(aggregatorPostingId('https://apply.workable.com/acme/jobs/view/ABC123'), null);
  for (const v of ['', null, 'N/A', 'local:jds/foo.md']) assert.equal(aggregatorPostingId(v), null);
});
ok('the lookalike-host and root-label guards hold for the id too', () => {
  assert.equal(aggregatorPostingId('https://linkedin.com.evil.example/jobs/view/4001'), null);
  assert.deepEqual(aggregatorPostingId('https://linkedin.com./jobs/view/4001'),
    { domain: 'linkedin.com', id: '4001' });
});
