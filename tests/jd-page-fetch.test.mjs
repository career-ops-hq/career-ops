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
import { jdFromPageHtml, fetchJdFromPage, MIN_PAGE_JD_WORDS } from '../lib/jd-page-fetch.mjs';
import { setHostResolver } from '../liveness-browser.mjs';

const sentence = 'You will design, build and operate production services that process customer data safely. ';
const BODY = sentence.repeat(12); // ~170 words, well over the 80-word floor

function page(ldDescription, { extraLd = [] } = {}) {
  const posting = { '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Staff Engineer', description: ldDescription, hiringOrganization: { name: 'Acme' } };
  const blocks = [posting, ...extraLd].map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n');
  return `<html><head>${blocks}</head><body><main>Staff Engineer Remote Apply now</main></body></html>`;
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

test('fetchJdFromPage honors the text cap', async () => {
  const net = stubNetwork(() => html(page(`<p>${BODY}</p>`)));
  try {
    const jd = await fetchJdFromPage('https://careers.example.com/job/1', 200);
    assert.ok(jd.text.length <= 201);
  } finally { net.restore(); }
});

test('fetchJdFromPage never requests a private or loopback host', async () => {
  const net = stubNetwork(() => html(page(`<p>${BODY}</p>`)));
  try {
    for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1:3000/x', 'http://localhost/x', 'file:///etc/passwd']) {
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
  const net = stubNetwork((url) => url.startsWith('https://careers.example.com')
    ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })
    : html(page(`<p>${BODY}</p>`)));
  try {
    assert.equal(await fetchJdFromPage('https://careers.example.com/job/1'), null);
    assert.deepEqual(net.calls, ['https://careers.example.com/job/1'], 'the metadata address must never be requested');
  } finally { net.restore(); }
});

test('fetchJdFromPage follows a safe redirect', async () => {
  const net = stubNetwork((url) => url.endsWith('/old')
    ? new Response(null, { status: 301, headers: { location: '/new' } })
    : html(page(`<p>${BODY}</p>`)));
  try {
    assert.ok(await fetchJdFromPage('https://careers.example.com/old'));
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
