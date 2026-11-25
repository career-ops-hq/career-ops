// extractJd (fetch-jd.mjs): the one place a fetched page becomes a JD.
// Closure is a separate question (fetchedPageClosure), asked first.
// Offline: every case is a string in, an answer out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJd, fetchedPageClosure } from '../fetch-jd.mjs';

const URL_ = 'https://careers.example.com/jobs/staff-engineer-4471';
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const sentence = 'You will design, build and operate production services that process customer data safely. ';
const BODY = sentence.repeat(12);
const posting = (extra = {}) => ({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Staff Engineer', description: BODY, hiringOrganization: { name: 'Acme' }, ...extra });
const ld = (...nodes) => nodes.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('');
const read = (html, opts = {}) => extractJd({ html, finalUrl: URL_ }, URL_, { visibleText: true, ...opts });

test('structured data is read before the visible text', () => {
  const r = read(`<html><head>${ld(posting())}</head><body><p>Apply now</p></body></html>`);
  assert.equal(r.method, 'ld+json');
  assert.match(r.text, /production services/);
});

test('a script-rendered shell with its JD in JSON-LD is read from the script', () => {
  const r = read(`<html><head>${ld(posting())}</head><body><div id="root"></div>You need to enable JavaScript to run this app.</body></html>`);
  assert.equal(r.method, 'ld+json');
});

test('visible text is the fallback when there is no structured data', () => {
  const r = read(`<html><body><p>${words(120)}</p></body></html>`);
  assert.equal(r.method, 'visible-text');
  assert.match(r.text, /word0 word1/);
  assert.doesNotMatch(r.text, /[<>]/);
});

test('visible text is not used unless the caller asks for it', () => {
  assert.equal(extractJd({ html: `<p>${words(200)}</p>`, finalUrl: URL_ }, URL_), null);
});

test('the floor is 80 visible words: 79 is a miss, 80 is a JD', () => {
  assert.equal(read(`<p>${words(79)}</p>`), null);
  assert.equal(read(`<p>${words(80)}</p>`).method, 'visible-text');
});

test('words separated by entity spaces still count', () => {
  assert.equal(read(`<p>${Array.from({ length: 80 }, () => 'word').join('&nbsp;&#160;&#xA0;')}</p>`).method, 'visible-text');
});

test('script and style content is never counted as visible text', () => {
  const bundle = Array.from({ length: 20 }, (_, i) => `const route${i} = { path: '/job/${i}', component: 'Job${i}', exact: true };`).join(' ');
  assert.equal(read(`<html><body><div id="root"></div><script>${bundle}</script><style>${bundle}</style></body></html>`), null);
});

test('a page that landed on another document yields nothing', () => {
  assert.equal(extractJd({ html: `<p>${words(200)}</p>`, finalUrl: 'https://careers.example.com/jobs' }, URL_, { visibleText: true }), null);
});

test('a page naming several postings yields nothing', () => {
  const a = posting({ title: 'Staff Engineer' });
  const b = posting({ title: 'Data Analyst', description: `${BODY} different` });
  assert.equal(read(`<html><head>${ld(a, b)}</head></html>`), null);
});

test('an oversize page yields nothing', () => {
  assert.equal(read(`<p>${words(10)}</p>${'x'.repeat(3_000_001)}`), null);
});

test('an empty page yields nothing', () => {
  assert.equal(read(''), null);
});

test('a posting past validThrough is not handed back as a JD, and is closure evidence', () => {
  const html = `<html><head>${ld(posting({ validThrough: '2020-01-01T00:00:00Z' }))}</head></html>`;
  assert.equal(read(html), null);
  assert.match(fetchedPageClosure({ html, finalUrl: URL_ }, URL_), /validThrough/);
});

test('a closure banner in the page text is closure evidence even when the page is long', () => {
  const html = `<html><body><p>Sorry, this job is no longer available.</p><p>${words(200)}</p></body></html>`;
  assert.ok(fetchedPageClosure({ html, finalUrl: URL_ }, URL_));
});

test('a redirect to an expired-job address is closure evidence', () => {
  assert.ok(fetchedPageClosure({ html: '<p>Something went wrong</p>', finalUrl: 'https://careers.example.com/jobs?error=true' }, URL_));
});

test('a status that says gone is closure evidence; through a redirect it is the other page\'s', () => {
  assert.equal(fetchedPageClosure({ gone: 404, finalUrl: URL_ }, URL_), 'HTTP 404');
  assert.equal(fetchedPageClosure({ gone: 404, finalUrl: 'https://careers.example.com/jobs' }, URL_), null);
});

