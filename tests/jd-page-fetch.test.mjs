// lib/jd-page-fetch.mjs — recovering a JD from the posting page's own JSON-LD
// when no ATS API covers the host (Phenom and bespoke career sites).
//
// Context: a live Robert Half posting came back from the web app as "Needs
// review". Its page is a Phenom shell: ~270 characters of visible text, with the
// whole 7 KB JD in an `application/ld+json` JobPosting whose description is
// entity-ESCAPED HTML. A text conversion that drops <script> content sees only
// the shell. Every case below is offline: fetch and DNS are stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as awaitedModule from '../lib/jd-page-fetch.mjs';
import { pageClosureEvidence, jdFromPageHtml, fetchJdFromPage, capJdText, markCappedAtsText, isLinkedInHost, MIN_PAGE_JD_WORDS, TRUNCATION_NOTICE } from '../lib/jd-page-fetch.mjs';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inProviderFetch } from '../providers/_ip-guard.mjs';
import { setHostResolver } from '../liveness-browser.mjs';

const sentence = 'You will design, build and operate production services that process customer data safely. ';
const BODY = sentence.repeat(12); // ~170 words, well over the 80-word floor

function page(ldDescription, { extraLd = [], posting: extra = {}, body = '' } = {}) {
  const posting = { '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Staff Engineer', description: ldDescription, hiringOrganization: { name: 'Acme' }, ...extra };
  const blocks = [posting, ...extraLd].map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n');
  return `<html><head>${blocks}</head><body><main>Staff Engineer Remote Apply now</main>${body}</body></html>`;
}

test('jdFromPageHtml reads the description out of a JSON-LD JobPosting', () => {
  const found = jdFromPageHtml(page(`<p>${BODY}</p>`));
  assert.ok(found, 'a JobPosting over the floor is a JD');
  assert.equal(found.method, 'ld+json');
  assert.match(found.text, /Staff Engineer/);
  assert.match(found.text, /production services/);
});

test('jdFromPageHtml unescapes entity-escaped markup instead of leaking raw tags (Phenom)', () => {
  const escaped = `&lt;div&gt;&lt;p&gt;&lt;b&gt;Who We Are&lt;/b&gt;&lt;/p&gt;&lt;p&gt;${BODY}&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;/ul&gt;&lt;/div&gt;`;
  const found = jdFromPageHtml(page(escaped));
  assert.ok(found);
  assert.doesNotMatch(found.text, /[<>]/, 'no markup may survive into the JD text');
  assert.match(found.text, /Who We Are/);
  assert.match(found.text, /Python/);
});

test('jdFromPageHtml leaves prose that merely mentions &lt; alone', () => {
  const found = jdFromPageHtml(page(`<p>${BODY} Latency must stay &lt; 50 ms.</p>`));
  assert.ok(found);
  assert.match(found.text, /Latency must stay < 50 ms\./);
});

test('jdFromPageHtml refuses a stub JobPosting', () => {
  assert.ok(MIN_PAGE_JD_WORDS >= 50);
  assert.equal(jdFromPageHtml(page('<p>Great role. Apply today.</p>')), null);
});

test('jdFromPageHtml refuses a page with two different JobPostings (a listing, not one job)', () => {
  const other = { '@type': 'JobPosting', title: 'Other Job', description: `<p>${BODY} Different.</p>` };
  assert.equal(jdFromPageHtml(page(`<p>${BODY}</p>`, { extraLd: [other] })), null);
});

test('jdFromPageHtml returns null for a page with no structured data', () => {
  assert.equal(jdFromPageHtml(`<html><body><main>${BODY}</main></body></html>`), null);
});

function stubNetwork(handler) {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push(String(url)); return handler(String(url), init); };
  const restoreDns = setHostResolver(async () => ['93.184.216.34']);
  return { calls, restore() { globalThis.fetch = realFetch; restoreDns(); } };
}
const html = (body, headers = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

test('fetchJdFromPage returns the JD for a Phenom-shaped page', async () => {
  const net = stubNetwork(() => html(page(`&lt;p&gt;${BODY}&lt;/p&gt;`)));
  try {
    const jd = await fetchJdFromPage('https://careers.example.com/job/1');
    assert.ok(jd);
    assert.equal(jd.url, 'https://careers.example.com/job/1');
    assert.match(jd.text, /production services/);
  } finally { net.restore(); }
});

test('fetchJdFromPage honors the text cap and says when it cut the JD', async () => {
  const net = stubNetwork(() => html(page(`<p>${BODY}</p>`)));
  try {
    const jd = await fetchJdFromPage('https://careers.example.com/job/1', 200);
    assert.ok(jd.text.endsWith(TRUNCATION_NOTICE(200)), 'a cut JD must carry the notice so nobody archives it as complete');
    assert.ok(jd.text.length <= 200 + TRUNCATION_NOTICE(200).length + 2);
  } finally { net.restore(); }
});

test('fetchJdFromPage never requests a private or loopback host', async () => {
  const net = stubNetwork(() => html(page(`<p>${BODY}</p>`)));
  try {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:3000/x',
      'http://localhost/x',
      'file:///etc/passwd',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
    ]) {
      assert.equal(await fetchJdFromPage(url), null, url);
    }
    assert.deepEqual(net.calls, []);
  } finally { net.restore(); }
});

test('fetchJdFromPage blocks a public host that resolves into private space', async () => {
  const net = stubNetwork(() => html(page(`<p>${BODY}</p>`)));
  const restoreDns = setHostResolver(async () => ['10.0.0.5']);
  try {
    assert.equal(await fetchJdFromPage('https://rebind.example.com/job'), null);
    assert.deepEqual(net.calls, []);
  } finally { restoreDns(); net.restore(); }
});

test('fetchJdFromPage guards every redirect hop, not just the first URL', async () => {
  const net = stubNetwork((url) => new URL(url).hostname === 'careers.example.com'
    ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })
    : html(page(`<p>${BODY}</p>`)));
  try {
    assert.equal(await fetchJdFromPage('https://careers.example.com/job/1'), null);
    assert.deepEqual(net.calls, ['https://careers.example.com/job/1'], 'the metadata address must never be requested');
  } finally { net.restore(); }
});

test('fetchJdFromPage follows a safe redirect', async () => {
  const net = stubNetwork((url) => url.startsWith('https://careers.')
    ? new Response(null, { status: 301, headers: { location: 'https://www.careers.example.com/job/1/' } })
    : html(page(`<p>${BODY}</p>`)));
  try {
    assert.ok(await fetchJdFromPage('https://careers.example.com/job/1'));
  } finally { net.restore(); }
});

test('fetchJdFromPage gives up on a redirect loop', async () => {
  const net = stubNetwork(() => new Response(null, { status: 302, headers: { location: '/again' } }));
  try {
    assert.equal(await fetchJdFromPage('https://careers.example.com/loop'), null);
    assert.ok(net.calls.length <= 7);
  } finally { net.restore(); }
});

test('fetchJdFromPage misses quietly on a non-HTML answer, an error status, and a thrown fetch', async () => {
  for (const handler of [
    () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    () => new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } }),
    () => { throw new Error('network down'); },
  ]) {
    const net = stubNetwork(handler);
    try { assert.equal(await fetchJdFromPage('https://careers.example.com/job/1'), null); }
    finally { net.restore(); }
  }
});

test('fetchJdFromPage refuses an oversized body', async () => {
  const net = stubNetwork(() => html('x'.repeat(4 * 1024 * 1024)));
  try { assert.equal(await fetchJdFromPage('https://careers.example.com/job/1'), null); }
  finally { net.restore(); }
});

test('capJdText leaves a JD under the cap untouched', () => {
  assert.equal(capJdText('short JD', 100), 'short JD');
});

test('capJdText never splits a surrogate pair at the cut', () => {
  const text = `${'a'.repeat(9)}\u{1F600}${'b'.repeat(50)}`; // the emoji occupies UTF-16 units 9 and 10
  const capped = capJdText(text, 10);
  assert.doesNotMatch(capped, /[\ud800-\udbff](?![\udc00-\udfff])/, 'no lone high surrogate');
  assert.ok(capped.endsWith(TRUNCATION_NOTICE(10)));
});

test('capJdText prefers a paragraph boundary near the cap', () => {
  const text = `${'x'.repeat(70)}\n\n${'y'.repeat(60)}`;
  const capped = capJdText(text, 100);
  assert.ok(capped.startsWith('x'.repeat(70)) && !capped.includes('y'), 'cut at the paragraph break, not mid-sentence');
});

test('LinkedIn hosts are recognised, and lookalikes are not', () => {
  for (const host of ['linkedin.com', 'www.linkedin.com', 'uk.linkedin.com', 'LinkedIn.com.', 'WWW.LINKEDIN.COM']) assert.ok(isLinkedInHost(host), host);
  for (const host of ['notlinkedin.com', 'linkedin.com.evil.example', 'example.com', '']) assert.equal(isLinkedInHost(host), false, host);
});

test('fetchJdFromPage never requests LinkedIn, directly or by redirect', async () => {
  const net = stubNetwork((url) => new URL(url).hostname === 'careers.example.com'
    ? new Response(null, { status: 302, headers: { location: 'https://www.linkedin.com/jobs/view/4486063768/' } })
    : html(page(`<p>${BODY}</p>`)));
  try {
    assert.equal(await fetchJdFromPage('https://www.linkedin.com/jobs/view/4486063768/'), null);
    assert.equal(await fetchJdFromPage('https://uk.linkedin.com/jobs/view/1/'), null);
    assert.deepEqual(net.calls, [], 'no request may reach LinkedIn');
    assert.equal(await fetchJdFromPage('https://careers.example.com/job/1'), null);
    assert.deepEqual(net.calls, ['https://careers.example.com/job/1'], 'the redirect target must not be requested');
  } finally { net.restore(); }
});

test('every hop runs inside the connect-time address guard (DNS-rebinding defence)', async () => {
  const seen = [];
  const net = stubNetwork((url) => {
    seen.push([url, inProviderFetch()]);
    return url === 'https://careers.example.com/job/1' ? new Response(null, { status: 301, headers: { location: '/job/1/' } }) : html(page(`<p>${BODY}</p>`));
  });
  try {
    assert.ok(await fetchJdFromPage('https://careers.example.com/job/1'));
    assert.deepEqual(seen, [['https://careers.example.com/job/1', true], ['https://careers.example.com/job/1/', true]]);
    assert.equal(inProviderFetch(), false, 'the guard context must not leak out of the fetch');
  } finally { net.restore(); }
});

const NOW = Date.parse('2026-11-06T12:00:00Z');

test('jdFromPageHtml reports a posting whose validThrough is past as closed, with no JD text', () => {
  const out = jdFromPageHtml(page(`<p>${BODY}</p>`, { posting: { validThrough: '2026-10-01T00:00:00Z' } }), NOW);
  assert.equal(out.closed, true);
  assert.match(out.evidence, /validThrough 2026-10-01/);
  assert.equal(out.text, '', 'a closed posting must never hand its text to a scorer');
});

test('fetchJdFromPage passes the closure on even when the visible page still shows the JD', async () => {
  const visible = `<p>${BODY}</p>`;
  const net = stubNetwork(() => html(page(visible, { posting: { validThrough: '2020-01-01T00:00:00Z' }, body: `<article>${BODY}</article>` })));
  try {
    const out = await fetchJdFromPage('https://careers.example.com/job/1');
    assert.equal(out.closed, true);
    assert.equal(out.text, '');
    assert.match(out.evidence, /validThrough 2020-01-01/);
  } finally { net.restore(); }
});

test('jdFromPageHtml accepts a future, absent or unparseable validThrough', () => {
  for (const validThrough of ['2026-12-31T00:00:00Z', undefined, 'sometime soon', '']) {
    assert.ok(jdFromPageHtml(page(`<p>${BODY}</p>`, { posting: { validThrough } }), NOW), String(validThrough));
  }
});

const embedded = (text) => `<script>window.__appData={"descriptionHtml":${JSON.stringify(`<p>${text}</p>`)}}</script>`;
const long = (word, n = 120) => Array.from({ length: n }, (_, i) => `${word}${i}`).join(' ');

test('jdFromPageHtml does not borrow another job\'s embedded description when the page lists several postings', () => {
  const other = { '@type': 'JobPosting', title: 'Other Job', description: `<p>${long('other')}</p>` };
  const out = jdFromPageHtml(page(`<p>${BODY}</p>`, { extraLd: [other], body: embedded(long('unrelated', 400)) }), NOW);
  assert.equal(out, null, 'an ambiguous page must be a miss, not the longest description on it');
});

test('jdFromPageHtml refuses a page with several embedded descriptions and no structured posting', () => {
  const body = embedded(long('first', 150)) + embedded(long('second', 300));
  assert.equal(jdFromPageHtml(`<html><body>${body}</body></html>`, NOW), null);
});

test('jdFromPageHtml still uses a single embedded description when the structured posting is a thin stub', () => {
  const out = jdFromPageHtml(page('<p>Short teaser.</p>', { body: embedded(long('full', 200)) }), NOW);
  assert.ok(out);
  assert.equal(out.method, 'embedded-description');
});

test('jdFromPageHtml counts a posting with no description when deciding the page is ambiguous', () => {
  const stub = { '@type': 'JobPosting', title: 'Other Job' }; // no description at all
  const out = jdFromPageHtml(page('<p>Short teaser.</p>', { extraLd: [stub], body: embedded(long('unrelated', 300)) }), NOW);
  assert.equal(out, null, 'a described and a description-less posting are two postings: no borrowing');
});

test('a date-only validThrough is valid through that whole day', () => {
  const sameDay = jdFromPageHtml(page(`<p>${BODY}</p>`, { posting: { validThrough: '2026-11-06' } }), NOW);
  assert.ok(sameDay && !sameDay.closed, 'on the stated date the posting is still open');
  const dayAfter = jdFromPageHtml(page(`<p>${BODY}</p>`, { posting: { validThrough: '2026-11-05' } }), Date.parse('2026-11-06T00:30:00Z'));
  assert.equal(dayAfter.closed, true, 'the day after, it is closed');
});

test('description-less postings with no title still count as separate postings', () => {
  const a = { '@type': 'JobPosting', url: 'https://careers.example.com/job/a' };
  const b = { '@type': 'JobPosting', url: 'https://careers.example.com/job/b' };
  const out = jdFromPageHtml(page('<p>Short teaser.</p>', { posting: { title: undefined, description: undefined, url: 'https://careers.example.com/job/c' }, extraLd: [a, b], body: embedded(long('unrelated', 300)) }), NOW);
  assert.equal(out, null);
});

test('one posting written twice (same fields) is still a single posting', () => {
  const dup = { '@type': 'JobPosting', title: 'Staff Engineer', description: '<p>Short teaser.</p>', hiringOrganization: { name: 'Acme' } };
  const out = jdFromPageHtml(page('<p>Short teaser.</p>', { extraLd: [dup], body: embedded(long('full', 200)) }), NOW);
  assert.ok(out, 'a duplicate representation must not make the page ambiguous');
});

test('fetchJdFromPage fails closed when the connect-time lookup guard is opted out', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const script = `
    globalThis.fetch = async () => { console.log('FETCHED'); return new Response('<html></html>', { headers: { 'content-type': 'text/html' } }); };
    const { fetchJdFromPage } = await import('./lib/jd-page-fetch.mjs');
    console.log(String(await fetchJdFromPage('https://careers.example.com/job/1')));`;
  const run = (env) => spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 20000 });
  const off = run({ CAREER_OPS_NO_DNS_CACHE: '1' });
  assert.equal(off.stdout.trim(), 'null', off.stderr);
  assert.doesNotMatch(off.stdout, /FETCHED/, 'no request may be made without the guard');
});

test('a full posting next to a description-less one is ambiguous, so the JSON-LD description is not used', () => {
  const stub = { '@type': 'JobPosting', title: 'Other Job', url: 'https://careers.example.com/job/other' };
  assert.equal(jdFromPageHtml(page(`<p>${BODY}</p>`, { extraLd: [stub] }), NOW), null);
});

test('an unrelated expired posting on the page is not reported as the requested posting closing', () => {
  const expired = { '@type': 'JobPosting', title: 'Old Job', description: '<p>Gone.</p>', validThrough: '2020-01-01T00:00:00Z' };
  assert.equal(jdFromPageHtml(page(`<p>${BODY}</p>`, { extraLd: [expired] }), NOW), null, 'ambiguous expiry must be a miss, not a closure');
});

// Otherwise-identical, description-less postings that differ in exactly one field.
const sameButFor = (field, value) => {
  const base = { '@type': 'JobPosting', title: 'Engineer', hiringOrganization: { name: 'A' }, jobLocation: { address: { addressLocality: 'Paris' } } };
  return jdFromPageHtml(page('<p>Short teaser.</p>', {
    posting: { title: 'Engineer', description: undefined, hiringOrganization: base.hiringOrganization, jobLocation: base.jobLocation },
    extraLd: [{ ...base, [field]: value }],
    body: embedded(long('unrelated', 300)),
  }), NOW);
};

test('same-title description-less postings that differ only by employer are separate postings', () => {
  assert.equal(sameButFor('hiringOrganization', { name: 'B' }), null);
});

test('same-title description-less postings that differ only by location are separate postings', () => {
  assert.equal(sameButFor('jobLocation', { address: { addressLocality: 'Berlin' } }), null);
});

test('markCappedAtsText turns the bare ellipsis of a capped ATS result into the explicit notice', () => {
  const cap = 50;
  const capped = `${'x'.repeat(cap)}\u2026`;
  const out = markCappedAtsText(capped, cap);
  assert.ok(out.endsWith(TRUNCATION_NOTICE(cap)) && !out.includes('\u2026'));
  assert.equal(markCappedAtsText('x'.repeat(cap), cap), 'x'.repeat(cap), 'text that was not cut is untouched');
  assert.equal(markCappedAtsText('short \u2026', cap), 'short \u2026', 'an ellipsis in uncut text is not a cut marker');
});

test('rebinding over a real socket: public pre-check, loopback at connect time, and the server sees nothing', () => {
  // dns.lookup is stubbed BEFORE jd-page-fetch loads, so the connect-time guard
  // wraps the stub and judges the address the socket would really dial. The
  // pre-check resolver says public; only the socket-level lookup says loopback.
  const root = fileURLToPath(new URL('../', import.meta.url));
  const script = `
    import dns from 'node:dns';
    import http from 'node:http';
    const realLookup = dns.lookup;
    dns.lookup = function (host, opts, cb) {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      if (host !== 'rebind.example.com') return realLookup.call(dns, host, opts, cb);
      if (opts && opts.all) return process.nextTick(cb, null, [{ address: '127.0.0.1', family: 4 }]);
      return process.nextTick(cb, null, '127.0.0.1', 4);
    };
    let hits = 0;
    const server = http.createServer((_req, res) => { hits++; res.end('SECRET'); }).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const { setHostResolver } = await import('./liveness-browser.mjs');
    setHostResolver(async () => ['93.184.216.34']);
    const { fetchJdFromPage } = await import('./lib/jd-page-fetch.mjs');
    const out = await fetchJdFromPage('http://rebind.example.com:' + server.address().port + '/job', 20000, 4000);
    // The guard itself, not just the end result: a lookup for the target made
    // inside the fetch context must be refused as a blocked address.
    const { providerFetchContext } = await import('./providers/_ip-guard.mjs');
    const code = await new Promise((resolve) => providerFetchContext.run({ url: 'http://rebind.example.com/job', targetHost: 'rebind.example.com' }, () => {
      dns.lookup('rebind.example.com', (err) => resolve(err ? err.code : null));
    }));
    console.log(JSON.stringify({ out, hits, code }));
    server.close();`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, CAREER_OPS_NO_DNS_CACHE: '', NO_PROXY: '*', no_proxy: '*' },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout.trim().split('\n').pop()), { out: null, hits: 0, code: 'ECAREEROPS_BLOCKED_ADDRESS' }, 'the loopback server must receive no request');
});

test('a visible closure banner makes the page closed even with no JSON-LD expiry', async () => {
  const net = stubNetwork(() => html(page(`<p>${BODY}</p>`, { body: '<p>This job is no longer available.</p>' })));
  try {
    const out = await fetchJdFromPage('https://careers.example.com/job/1');
    assert.equal(out.closed, true);
    assert.equal(out.text, '', 'a closed page must not hand its JD to a scorer');
    assert.match(out.evidence, /^page text:/);
  } finally { net.restore(); }
});

test('closure wording inside a script or style is not visible page text', async () => {
  const net = stubNetwork(() => html(page(`<p>${BODY}</p>`, { body: '<script>var m="This job is no longer available.";</script><style>.x::after{content:"job is no longer available"}</style>' })));
  try {
    const out = await fetchJdFromPage('https://careers.example.com/job/1');
    assert.ok(out && !out.closed, 'only text a reader sees counts');
  } finally { net.restore(); }
});

test('NODE_USE_ENV_PROXY without CAREER_OPS_TRUST_PROXY_EGRESS fails closed', async () => {
  const { spawnSync } = await import('node:child_process');
  const code = `import { fetchJdFromPage } from './lib/jd-page-fetch.mjs'; let hit=0; globalThis.fetch=async()=>{hit++;throw new Error('x')}; const out=await fetchJdFromPage('https://careers.example.com/job/1'); console.log(JSON.stringify({out,hit}));`;
  const run = (env) => JSON.parse(spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, CAREER_OPS_NO_DNS_CACHE: '', ...env }, encoding: 'utf8' }).stdout.trim());
  assert.deepEqual(run({ NODE_USE_ENV_PROXY: '1', CAREER_OPS_TRUST_PROXY_EGRESS: '' }), { out: null, hit: 0 });
});

test('hostile markup cannot make the visible-text closure check slow', async () => {
  const hostile = ['<'.repeat(1_500_000), '<!--'.repeat(750_000), '<script '.repeat(375_000)];
  for (const body of hostile) {
    const net = stubNetwork(() => html(page(`<p>${BODY}</p>`, { body })));
    const t0 = Date.now();
    try { await fetchJdFromPage('https://careers.example.com/job/1'); } finally { net.restore(); }
    assert.ok(Date.now() - t0 < 15_000, `took ${Date.now() - t0}ms`);
  }
});

test('a closure banner written with numeric entities is still recognised', async () => {
  const net = stubNetwork(() => html(page(`<p>${BODY}</p>`, { body: '<p>This job is no longer available &#8212; it&#39;s closed.</p>' })));
  try {
    const out = await fetchJdFromPage('https://careers.example.com/job/1');
    assert.equal(out.closed, true);
  } finally { net.restore(); }
});

test('a job URL that redirects to a different page is a miss, not that page\'s posting', async () => {
  const net = stubNetwork((u) => new URL(u).pathname === '/job/1'
    ? new Response(null, { status: 302, headers: { location: 'https://careers.example.com/job/2' } })
    : html(page(`<p>${BODY}</p>`)));
  try {
    assert.equal(await fetchJdFromPage('https://careers.example.com/job/1'), null);
  } finally { net.restore(); }
});

test('conditional text before a closure banner does not hide the banner', async () => {
  const net = stubNetwork(() => html(page(`<p>${BODY}</p>`, { body: '<div>Sign in to apply</div><div>This job is no longer available.</div>' })));
  try { assert.equal((await fetchJdFromPage('https://careers.example.com/job/1')).closed, true); } finally { net.restore(); }
});

test('a ">" inside a quoted script attribute does not hide the ld+json block', () => {
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Eng', description: `<p>${BODY}</p>`, hiringOrganization: { name: 'Acme' } });
  const out = jdFromPageHtml(`<html><head><script data-x="a>b" type="application/ld+json">${ld}</script></head><body></body></html>`);
  assert.ok(out && out.method === 'ld+json');
});

test('hostile markup in a JSON-LD description stays linear', () => {
  for (const junk of ['<script '.repeat(300_000), '<style '.repeat(300_000), '<'.repeat(1_500_000)]) {
    const t0 = Date.now();
    jdFromPageHtml(page(`<p>${BODY}</p>${junk}`));
    assert.ok(Date.now() - t0 < 15_000, `took ${Date.now() - t0}ms`);
  }
});

test('a closure banner that only matches once &#39; is decoded is recognised', async () => {
  const net = stubNetwork(() => html(page(`<p>${BODY}</p>`, { body: '<p>You can&#39;t view this job because it&#39;s not available</p>' })));
  try {
    const out = await fetchJdFromPage('https://careers.example.com/job/1');
    assert.equal(out.closed, true);
  } finally { net.restore(); }
});

test('an inherited property name such as &constructor; is not decoded as an entity', async () => {
  const net = stubNetwork(() => html(page(`<p>${BODY} &constructor; &eacute;</p>`)));
  try {
    const out = await fetchJdFromPage('https://careers.example.com/job/1');
    assert.ok(out && !/function Object|\[native code\]/.test(out.text), out?.text?.slice(0, 80));
  } finally { net.restore(); }
});

test('a character whose lowercase form is longer does not misalign the ld+json scan', () => {
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Eng', description: `<p>${BODY}</p>`, hiringOrganization: { name: 'Acme' } });
  const out = jdFromPageHtml(`<html><body><p>${'İ'.repeat(50)}</p><script type="application/ld+json">${ld}</script></body></html>`);
  assert.ok(out && out.method === 'ld+json');
});

test('a very large @graph array is walked without spread or shift limits', () => {
  const nodes = Array.from({ length: 200_000 }, (_, i) => ({ '@type': 'Thing', name: `n${i}` }));
  const posting = { '@type': 'JobPosting', title: 'Eng', description: `<p>${BODY}</p>`, hiringOrganization: { name: 'Acme' } };
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': [...nodes, posting] });
  const t0 = Date.now();
  const out = jdFromPageHtml(`<html><body><script type="application/ld+json">${ld}</script></body></html>`);
  assert.ok(out && out.method === 'ld+json');
  assert.ok(Date.now() - t0 < 15_000, `took ${Date.now() - t0}ms`);
});

test('batch-runner handles fetch-jd exit 3 as a closed posting, not a fetch miss', () => {
  const runner = readFileSync(fileURLToPath(new URL('../batch/batch-runner.sh', import.meta.url)), 'utf8');
  assert.match(runner, /jd_api_rc=\$\?/);
  assert.match(runner, /"\$jd_api_rc" -eq 3/);
  assert.match(runner, /jd_closed_note/);
});

test('a page with no extractable JD but a closure banner is closed, not a plain miss', async () => {
  const net = stubNetwork(() => html('<html><body><h1>Careers</h1><p>This job is no longer available.</p></body></html>'));
  try {
    const out = await fetchJdFromPage('https://careers.example.com/job/1');
    assert.equal(out?.closed, true);
    assert.match(out.evidence, /page text/);
  } finally { net.restore(); }
});

test('named Latin-1 entities decode in visible text, case-sensitively', async () => {
  const net = stubNetwork(() => html(page(`<p>${BODY}</p>`, { body: '<p>Ce poste est ferm&eacute; &mdash; M&uuml;nchen &Eacute;cole.</p>' })));
  try {
    const out = await fetchJdFromPage('https://careers.example.com/job/1');
    assert.ok(out);
  } finally { net.restore(); }
  const { LATIN1_ENTITIES } = await import('../lib/jd-parse.mjs');
  assert.equal(LATIN1_ENTITIES.eacute, 'é');
  assert.equal(LATIN1_ENTITIES.Eacute, 'É');
  assert.equal(LATIN1_ENTITIES.uuml, 'ü');
  assert.equal(Object.hasOwn(LATIN1_ENTITIES, 'nbsp'), false);
});

test('a closure banner on a page that names several postings is not attributed to the URL', async () => {
  const two = page(`<p>${BODY}</p>`, { extraLd: [{ '@type': 'JobPosting', title: 'Other role', description: `<p>${BODY} other</p>` }], body: '<p>This job is no longer available.</p>' });
  const net = stubNetwork(() => html(two));
  try { assert.equal(await fetchJdFromPage('https://careers.example.com/job/1'), null); } finally { net.restore(); }
  assert.equal(pageClosureEvidence(two, 'https://careers.example.com/job/1'), null);
});

test('pageClosureEvidence applies the same-document gate to the final URL', () => {
  const closed = page(`<p>${BODY}</p>`, { body: '<p>This job is no longer available.</p>' });
  assert.ok(pageClosureEvidence(closed, 'https://careers.example.com/job/1'));
  assert.equal(pageClosureEvidence(closed, 'https://careers.example.com/job/1', 'https://careers.example.com/jobs'), null);
});

test('repeated unterminated description fields stay linear', () => {
  const hostile = '"descriptionHtml":"'.repeat(150_000);
  const t0 = Date.now();
  pageClosureEvidence(hostile, 'https://careers.example.com/job/1');
  jdFromPageHtml(hostile);
  assert.ok(Date.now() - t0 < 15_000, `took ${Date.now() - t0}ms`);
});

test('the same posting twice with different description whitespace is not ambiguous', () => {
  const node = (d) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Engineer', description: d })}</script>`;
  const out = jdFromPageHtml(`<html>${node(`<p>${BODY}</p>`)}${node(`<p>${BODY.replace(/ /g, '  ')}\n</p>`)}</html>`);
  assert.ok(out);
});

test('a malformed JSON-LD description does not stop the closure check', () => {
  const bad = `<script type="application/ld+json">{"@type":"JobPosting","title":{"toString":null,"valueOf":null},"description":{"toString":null}}</script><p>This job is no longer available.</p>`;
  assert.ok(pageClosureEvidence(bad, 'https://careers.example.com/job/1'));
});

test('a malformed description-sized field still counts toward ambiguity', () => {
  const words = Array.from({ length: 200 }, (_, n) => `w${n}`).join(' ');
  const ctrl = '"descriptionHtml":"' + words + '\u0001 tail"';
  const good = '"descriptionHtml":"' + words + ' other"';
  const out = jdFromPageHtml(`<html><script>{${ctrl.replace('\\u0001', String.fromCharCode(1))},${good}}</script></html>`);
  assert.equal(out, null);
});

test('a Phenom page that ships a hidden expiry view is not closed by that banner text', async () => {
  const tpl = '<section view="x-job-expire-view"><div class="expire-job-view"><h2>We\'re sorry\u2026 the job you are trying to apply for has been filled.</h2></div></section>';
  const net = stubNetwork(() => html(page(`<p>${BODY}</p>`, { body: tpl })));
  try {
    const out = await fetchJdFromPage('https://careers.example.com/job/1');
    assert.ok(out && !out.closed);
    assert.ok(out.text.length > 100);
  } finally { net.restore(); }
  assert.equal(pageClosureEvidence(page(`<p>${BODY}</p>`, { body: tpl }), 'https://careers.example.com/job/1'), null);
});

test('a real closure banner next to a hidden expiry view still closes the page', () => {
  const tpl = '<section view="x-job-expire-view"><div class="expire-job-view"><h2>the job you are trying to apply for has been filled.</h2></div></section>';
  const out = pageClosureEvidence(page(`<p>${BODY}</p>`, { body: `${tpl}<h2>This job is no longer available.</h2>` }), 'https://careers.example.com/job/1');
  assert.ok(out);
});

test('a marked void element does not swallow a closure banner after it', () => {
  const out = pageClosureEvidence(page(`<p>${BODY}</p>`, { body: '<img class="expire-job-view" src="x"><br class="job-expire-view"><param class="expire-job-view" name="x"><h2>This job is no longer available.</h2>' }), 'https://careers.example.com/job/1');
  assert.ok(out);
});

test('hostile markup around the expiry-view scan stays fast', () => {
  const t0 = Date.now();
  pageClosureEvidence(`<html>${'<a'.repeat(500_000)}>${'<div class="expire-job-view">'.repeat(20_000)}</html>`, 'https://careers.example.com/job/1');
  pageClosureEvidence(`<html><div class="job-expire-view">${'<div>'.repeat(300_000)}</html>`, 'https://careers.example.com/job/1');
  assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0}ms`);
});

test('an expiry-view class named only inside a script does not hide a real closure banner', () => {
  const banner = '<h2>This job is no longer available.</h2>';
  const script = '<script>var c="job-expire-view expire-job-view";</script>';
  const out = pageClosureEvidence(page(`<p>${BODY}</p>`, { body: `${script}${banner}` }), 'https://careers.example.com/job/1');
  assert.ok(out, 'banner with only a script mention still closes');
});

test('the same posting with nested fields in a different key order is one posting', () => {
  const node = (org) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Engineer', description: `<p>${BODY}</p>`, hiringOrganization: org })}</script>`;
  const out = jdFromPageHtml(`<html>${node({ '@type': 'Organization', name: 'Acme' })}${node({ name: 'Acme', '@type': 'Organization' })}</html>`);
  assert.ok(out);
  const two = jdFromPageHtml(`<html>${node({ name: 'Acme' })}${node({ name: 'Other Co' })}</html>`);
  assert.equal(two, null);
});

test('a JobPosting whose own URL names a different job is rejected, aliases are not', () => {
  const ld = (url) => `<html><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Engineer', description: `<p>${BODY}</p>`, ...(url ? { url } : {}) })}</script></html>`;
  const { inspectPage } = awaitedModule;
  assert.equal(inspectPage(ld('https://careers.example.com/job/2'), Date.now(), 'https://careers.example.com/job/1').found, null);
  assert.ok(inspectPage(ld('https://careers.example.com/job/1/Some-Title'), Date.now(), 'https://careers.example.com/job/1').found);
  assert.ok(inspectPage(ld('https://cdn.other.net/x/9'), Date.now(), 'https://careers.example.com/job/1').found);
  assert.ok(inspectPage(ld(''), Date.now(), 'https://careers.example.com/job/1').found);
});

test('shared year or version path segments do not make different job ids match', () => {
  const ld = (url) => `<html><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Engineer', description: `<p>${BODY}</p>`, url })}</script></html>`;
  const { inspectPage } = awaitedModule;
  assert.equal(inspectPage(ld('https://careers.example.com/2024/job/2'), Date.now(), 'https://careers.example.com/2024/job/1').found, null);
  assert.ok(inspectPage(ld('https://careers.example.com/2024/job/1/Some-Title'), Date.now(), 'https://careers.example.com/2024/job/1').found);
});

test('numeric job ids that look like years still tell two jobs apart', () => {
  const ld = (url) => `<html><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Engineer', description: `<p>${BODY}</p>`, url })}</script></html>`;
  const { inspectPage } = awaitedModule;
  assert.equal(inspectPage(ld('https://careers.example.com/job/2044'), Date.now(), 'https://careers.example.com/job/2031').found, null);
  assert.ok(inspectPage(ld('https://careers.example.com/job/2031'), Date.now(), 'https://careers.example.com/job/2031').found);
});

test('a job id carried in the URL fragment tells two jobs apart', () => {
  const ld = (url) => `<html><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Engineer', description: `<p>${BODY}</p>`, url })}</script></html>`;
  const { inspectPage } = awaitedModule;
  assert.equal(inspectPage(ld('https://careers.example.com/careers#/job/2'), Date.now(), 'https://careers.example.com/careers#/job/1').found, null);
  assert.ok(inspectPage(ld('https://careers.example.com/careers#/job/1'), Date.now(), 'https://careers.example.com/careers#/job/1').found);
  // a query inside the fragment counts too
  assert.equal(inspectPage(ld('https://careers.example.com/careers#/job?jobId=2'), Date.now(), 'https://careers.example.com/careers#/job?jobId=1').found, null);
});

test('an oversize page proves no closure from its prefix', () => {
  const pad = ' '.repeat(3_100_000);
  const expired = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'E', description: 'x', validThrough: '2020-01-01' })}</script>`;
  assert.equal(pageClosureEvidence(`<html>${expired}${pad}</html>`, 'https://careers.example.com/job/1'), null);
});

test('a malformed copy that differs only in whitespace does not make the page ambiguous', () => {
  const words = Array.from({ length: 200 }, (_, n) => `w${n}`).join(' ');
  const valid = `"descriptionHtml":"${words}\\nend"`;
  const malformed = `"descriptionHtml":"${words}${String.fromCharCode(10)}end"`;
  const out = jdFromPageHtml(`<html><script>{${valid},${malformed}}</script></html>`);
  assert.ok(out);
});
