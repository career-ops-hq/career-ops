// tests/robots-check.test.mjs — robots-check.mjs reads robots.txt the cautious
// RFC 9309 way and fails closed (#5776).
//
// Offline: every transport and resolver is injected, so no case reaches the
// network. The parser cases are ported from tests/test_robots_check.py in
// MadsLorentzen/ai-job-search (MIT, Copyright (c) 2026 Mads Lorentzen), the
// source robots-check.mjs was ported from. Cases there marked FAIL-OPEN
// REGRESSION are ones Python's urllib.robotparser gets wrong; getting them
// wrong here means the headed retry runs against a site that said no.
//
// Not ported, because the transport they test does not exist here: the curl
// argv, `--proto` pinning, CLI entry point, subprocess decoding cases, and the
// retry of a refused robots.txt with a browser User-Agent (this module reads
// it once, as career-ops; a 403 skips the headed retry).
//
// Run:  node --test tests/robots-check.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  robotsAllows,
  isPathAllowed,
  isRobotsBody,
  hasUndecodableRule,
  matchLength,
  percentDecode,
  clearRobotsCache,
  crawlDelaySeconds,
  ROBOTS_PRODUCT_TOKEN,
  ROBOTS_MAX_BYTES,
} from '../robots-check.mjs';
import { DEFAULT_USER_AGENT } from '../user-agent.mjs';

// Blank lines sit between the User-agent line and its rules. Python's
// robotparser treats those as record separators and drops every rule.
const BLANK_LINES = 'User-agent: *\n\n\nAllow: /\n\nDisallow: /cs/\n\nSitemap: https://example.com/sitemap.xml\n';
const API_BLOCK = 'User-agent: *\nDisallow: /api/\n';
const PUBLIC = ['93.184.215.14'];

/** A fetch-like transport answering from a table keyed by URL. */
function transport(table) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const entry = typeof table === 'function' ? await table(url, init) : table[url];
    if (entry instanceof Error) throw entry;
    if (!entry) return new Response('', { status: 404 });
    return new Response(entry.body ?? '', { status: entry.status ?? 200, headers: entry.headers ?? {} });
  };
  return { fetchImpl, calls };
}

/** robotsAllows with a fresh cache, a public resolver and a canned robots.txt. */
async function gate(url, body, { status = 200, resolver = async () => PUBLIC } = {}) {
  const origin = new URL(url).origin;
  const { fetchImpl, calls } = transport({ [`${origin}/robots.txt`]: { status, body } });
  const verdict = await robotsAllows(url, { fetchImpl, resolver, cache: new Map() });
  return { ...verdict, calls };
}

// ── Path rules ───────────────────────────────────────────────────────────

test('FAIL-OPEN REGRESSION: blank lines inside a record do not end it', () => {
  assert.equal(isPathAllowed(BLANK_LINES, '*', '/cs/'), false);
  assert.equal(isPathAllowed(BLANK_LINES, '*', '/careers/'), true);
});

test('FAIL-OPEN REGRESSION: longest match wins over rule order', () => {
  assert.equal(isPathAllowed('User-agent: *\nAllow: /\nDisallow: /cs/\n', '*', '/cs/deep/page'), false);
});

test('a longer Allow can unblock a shorter Disallow', () => {
  const body = 'User-agent: *\nDisallow: /\nAllow: /jobs/\n';
  assert.equal(isPathAllowed(body, '*', '/jobs/x'), true);
  assert.equal(isPathAllowed(body, '*', '/other'), false);
});

test('an equal-length Allow/Disallow tie goes to Disallow, in either order', () => {
  assert.equal(isPathAllowed('User-agent: *\nDisallow: /a\nAllow: /a\n', '*', '/a'), false);
  // Allow first is the order that exercises the tie-break clause: without it,
  // the first rule at a given length would win and Allow would leak through.
  assert.equal(isPathAllowed('User-agent: *\nAllow: /a\nDisallow: /a\n', '*', '/a'), false);
});

test('a path block leaves sibling paths allowed', () => {
  assert.equal(isPathAllowed(API_BLOCK, '*', '/api/v1/public/search'), false);
  assert.equal(isPathAllowed(API_BLOCK, '*', '/en/jobs/'), true);
});

test('`*` wildcard and trailing `$` anchor', () => {
  const body = 'User-agent: *\nDisallow: /*.pdf$\n';
  assert.equal(isPathAllowed(body, '*', '/files/cv.pdf'), false);
  assert.equal(isPathAllowed(body, '*', '/files/cv.pdf.html'), true);
});

test('a `$` mid-pattern is literal, not an end anchor', () => {
  const body = 'User-agent: *\nDisallow: /tag/$var\n';
  assert.equal(isPathAllowed(body, '*', '/tag/$var'), false);
  assert.equal(isPathAllowed(body, '*', '/tag/$var/sub'), false);
});

test('repeated wildcards do not backtrack catastrophically', () => {
  // GHSA-xhqf-8q8x-4jwm upstream: a regex matcher took exponential time here.
  const pattern = `/${'*a'.repeat(13)}*b$`;
  const body = `User-agent: *\nDisallow: ${pattern}\n`;
  const path = `/${'a'.repeat(28)}X`;
  const started = performance.now();
  const allowed = isPathAllowed(body, '*', path);
  const elapsed = performance.now() - started;
  assert.equal(allowed, true);
  assert.ok(elapsed < 500, `matcher took ${elapsed.toFixed(0)}ms (catastrophic backtracking)`);
});

test('consecutive wildcards match the same as one', () => {
  const body = 'User-agent: *\nDisallow: /docs/*******.pdf$\n';
  assert.equal(isPathAllowed(body, '*', '/docs/cv.pdf'), false);
  assert.equal(isPathAllowed(body, '*', '/docs/sub/folder/cv.pdf'), false);
  assert.equal(isPathAllowed(body, '*', '/docs/sub/folder/cv.html'), true);
});

test('wildcard semantics: prefix without `$`, full match with it', () => {
  const body = 'User-agent: *\nDisallow: /a*b\nDisallow: /x/*/y$\nDisallow: /end*$\n';
  assert.equal(isPathAllowed(body, '*', '/ab'), false);
  assert.equal(isPathAllowed(body, '*', '/a/long/path/b/and-more'), false);
  assert.equal(isPathAllowed(body, '*', '/a'), true);
  assert.equal(isPathAllowed(body, '*', '/x/anything/at/all/y'), false);
  assert.equal(isPathAllowed(body, '*', '/x/anything/y/more'), true);
  assert.equal(isPathAllowed(body, '*', '/end'), false);
  assert.equal(isPathAllowed(body, '*', '/ending/here'), false);
  assert.equal(isPathAllowed(body, '*', '/en'), true);
});

test('an empty Disallow allows everything, and so does a rule-less file', () => {
  assert.equal(isPathAllowed('User-agent: *\nDisallow:\n', '*', '/anything'), true);
  assert.equal(isPathAllowed('', '*', '/x'), true);
  assert.equal(isPathAllowed('# just a comment\n', '*', '/x'), true);
  assert.equal(matchLength('', '/x'), -1);
});

test('comments are stripped from rule lines', () => {
  assert.equal(isPathAllowed('User-agent: *\nDisallow: /x  # nope\n', '*', '/x'), false);
});

test('CRLF line endings parse like LF', () => {
  assert.equal(isPathAllowed('User-agent: *\r\nDisallow: /jobs\r\n', '*', '/jobs/1'), false);
});

// ── Agent selection ──────────────────────────────────────────────────────

test('the product token is career-ops, read from DEFAULT_USER_AGENT', () => {
  assert.equal(ROBOTS_PRODUCT_TOKEN, 'career-ops');
  assert.match(DEFAULT_USER_AGENT, /compatible; career-ops\//, 'a UA edit must keep the token in sync');
});

test('a career-ops group is obeyed over `*`', () => {
  const body = 'User-agent: career-ops\nDisallow: /\n\nUser-agent: *\nAllow: /\n';
  assert.equal(isPathAllowed(body, ROBOTS_PRODUCT_TOKEN, '/a'), false);
  assert.equal(isPathAllowed(body, '*', '/a'), true);
  // ...and a career-ops Allow wins over a `*` Disallow: groups do not combine.
  const permissive = 'User-agent: *\nDisallow: /\n\nUser-agent: career-ops\nAllow: /\n';
  assert.equal(isPathAllowed(permissive, ROBOTS_PRODUCT_TOKEN, '/a'), true);
});

test('agent matching is case-insensitive and ignores a version suffix', () => {
  assert.equal(isPathAllowed('User-agent: CAREER-OPS\nDisallow: /x\n', 'career-ops', '/x'), false);
  assert.equal(isPathAllowed('User-agent: career-ops/1.0\nDisallow: /x\n', 'career-ops', '/x'), false);
});

test('a group for another agent does not bind career-ops; `*` does', () => {
  assert.equal(isPathAllowed('User-agent: OtherBot\nDisallow: /\n', ROBOTS_PRODUCT_TOKEN, '/a'), true);
  assert.equal(isPathAllowed(API_BLOCK, ROBOTS_PRODUCT_TOKEN, '/api/v1'), false);
});

test('several agents in one record share its rules', () => {
  const body = 'User-agent: A\nUser-agent: career-ops\nDisallow: /z\n';
  assert.equal(isPathAllowed(body, 'career-ops', '/z'), false);
  assert.equal(isPathAllowed(body, 'A', '/z'), false);
});

test('a named group with no rule lines falls back to `*`, never to allow-all', () => {
  const body = 'User-agent: *\nDisallow: /\n\nUser-agent: career-ops\n';
  assert.equal(isPathAllowed(body, ROBOTS_PRODUCT_TOKEN, '/a'), false);
});

// ── Soft 200 ─────────────────────────────────────────────────────────────

test('FAIL-OPEN REGRESSION: an HTML or JSON error page is not a robots.txt', () => {
  assert.equal(isRobotsBody('<html><body>404 Not Found</body></html>'), false);
  assert.equal(isRobotsBody('{"error":"not found"}'), false);
});

test('an empty file is allow-all; a real policy and a Sitemap-only file count', () => {
  assert.equal(isRobotsBody(''), true);
  assert.equal(isRobotsBody('\n\n   \n'), true);
  assert.equal(isRobotsBody(BLANK_LINES), true);
  assert.equal(isRobotsBody(API_BLOCK), true);
  assert.equal(isRobotsBody('Sitemap: https://example.com/sitemap.xml\n'), true);
});

test('a soft 200 skips the retry instead of allowing it', async () => {
  const v = await gate('https://example.com/jobs', '<html>404</html>');
  assert.equal(v.allowed, false);
  assert.equal(v.code, 'robots_not_robots_txt');
});

// ── Percent-encoding ─────────────────────────────────────────────────────

test('FAIL-OPEN REGRESSION: an encoded rule matches the decoded path', () => {
  assert.equal(isPathAllowed('User-agent: *\nDisallow: /foo%20bar\n', '*', '/foo bar'), false);
  assert.equal(isPathAllowed('User-agent: *\nDisallow: /foo%20bar\n', '*', '/foobar'), true);
});

test('an encoded query matches a rule end to end', async () => {
  const v = await gate('https://example.com/search?q=machine%20learning', 'User-agent: *\nDisallow: /search?q=machine%20learning\n');
  assert.equal(v.allowed, false);
  assert.equal(v.code, 'robots_disallowed');
});

test('a malformed escape is kept as written, never thrown on', () => {
  assert.equal(percentDecode('/a%zz'), '/a%zz');
  assert.equal(percentDecode('/100%'), '/100%');
  assert.equal(percentDecode('/%E0%A4%A'), '/%E0%A4%A');
  assert.equal(percentDecode('/%E2%82%AC%FF'), '/€%FF');
  assert.equal(isPathAllowed('User-agent: *\nDisallow: /%zz\n', '*', '/%zz/x'), false);
});

test('a non-ASCII path is matched decoded, as the URL parser encodes it', async () => {
  const body = 'User-agent: *\nDisallow: /職涯貼士/\nDisallow: /şirket/\n';
  for (const path of ['/職涯貼士/x', '/şirket/x']) {
    const v = await gate(`https://example.com${path}`, body);
    assert.equal(v.code, 'robots_disallowed', path);
  }
  assert.equal((await gate('https://example.com/cmp/x/reviews', body)).code, 'robots_allowed');
});

// ── Byte-order mark ──────────────────────────────────────────────────────

test('FAIL-OPEN REGRESSION: a BOM does not hide the first group', async () => {
  const body = '﻿User-agent: *\nDisallow: /\n';
  assert.equal(isPathAllowed(body, '*', '/x'), false);
  assert.equal(isPathAllowed(body, ROBOTS_PRODUCT_TOKEN, '/x'), false);
  assert.equal((await gate('https://example.com/jobs', body)).code, 'robots_disallowed');
  assert.equal(isRobotsBody('﻿Sitemap: https://example.com/sitemap.xml\n'), true);
  assert.equal(isRobotsBody('﻿'), true);
});

// ── Undecodable rules ────────────────────────────────────────────────────

// What a cp1254 file reads as once decoded as UTF-8 with replacement: every
// non-ASCII byte is invalid UTF-8 on its own, so each becomes U+FFFD.
const legacy = (text) => new TextDecoder('utf-8').decode(Uint8Array.from(Array.from(text, (ch) => {
  const code = ch.codePointAt(0);
  return code < 0x80 ? code : 0xFE; // any lone high byte
})));

test('FAIL-OPEN REGRESSION: an undecodable rule line skips the retry', async () => {
  const body = legacy('User-agent: *\nDisallow: /şirket/\n');
  assert.ok(body.includes('�'));
  const v = await gate('https://example.com/%C5%9Firket/x', body);
  assert.equal(v.allowed, false);
  assert.equal(v.code, 'robots_undecodable');
});

test('an undecodable `*` agent or field name skips the retry too', async () => {
  assert.equal((await gate('https://example.com/jobs', legacy('User-agent: * \nDisallow: /\n'))).code, 'robots_undecodable');
  assert.equal((await gate('https://example.com/jobs', legacy('User-agent: *\n Disallow: /jobs\n'))).code, 'robots_undecodable');
});

test('every rule field is checked, including a first line behind a BOM', () => {
  for (const body of [
    legacy('User-agent: Bot \n'),
    legacy('Allow: /ş/\n'),
    legacy('Disallow: /ş/\n'),
    `﻿${legacy('User-agent: * \nDisallow: /\n')}`,
  ]) {
    assert.equal(hasUndecodableRule(body), true, JSON.stringify(body));
  }
});

test('U+FFFD in a comment or an unrelated field is harmless', async () => {
  const body = legacy([
    '# Şirket politikası',
    'User-agent: *',
    'Disallow: /api/  # özel',
    'Sitemap: https://example.com/şirket.xml',
    'Açıklama: iş ilanları',
    '',
  ].join('\n'));
  assert.deepEqual(body.split('\n').filter((line) => line && !line.includes('�')), ['User-agent: *']);
  assert.equal(hasUndecodableRule(body), false);
  assert.equal((await gate('https://example.com/jobs', body)).code, 'robots_allowed');
  assert.equal((await gate('https://example.com/api/x', body)).code, 'robots_disallowed');
});

test('valid UTF-8 never reads as undecodable', () => {
  assert.equal(hasUndecodableRule('User-agent: *\nDisallow: /職涯貼士/\nDisallow: /şirket/\n'), false);
});

// ── Status mapping: fail closed ─────────────────────────────────────────

test('404 and 410 mean no published policy, which allows the retry', async () => {
  for (const status of [404, 410]) {
    const v = await gate('https://example.com/jobs/1', '<html>gone</html>', { status });
    assert.equal(v.allowed, true, String(status));
    assert.equal(v.code, 'robots_absent');
  }
});

test('an empty 200 allows the retry', async () => {
  const v = await gate('https://example.com/jobs/1', '  \n');
  assert.deepEqual([v.allowed, v.code], [true, 'robots_empty']);
});

test('every other status skips the retry, each with its own code', async () => {
  const cases = [
    [401, 'robots_forbidden'], [403, 'robots_forbidden'],
    [429, 'robots_http_error'], [400, 'robots_http_error'], [451, 'robots_http_error'],
    [500, 'robots_server_error'], [503, 'robots_server_error'],
  ];
  for (const [status, code] of cases) {
    const v = await gate('https://example.com/jobs/1', 'User-agent: *\nAllow: /\n', { status });
    assert.deepEqual([v.allowed, v.code], [false, code], String(status));
    assert.match(v.reason, new RegExp(String(status)));
  }
});

test('a timeout skips the retry, even when the transport ignores its signal', async () => {
  const fetchImpl = () => new Promise(() => {}); // never settles
  const v = await robotsAllows('https://example.com/jobs/1', { fetchImpl, resolver: async () => PUBLIC, cache: new Map(), timeoutMs: 20 });
  assert.deepEqual([v.allowed, v.code], [false, 'robots_timeout']);
});

test('a transport error skips the retry', async () => {
  const { fetchImpl } = transport(() => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
  const v = await robotsAllows('https://example.com/jobs/1', { fetchImpl, resolver: async () => PUBLIC, cache: new Map() });
  assert.deepEqual([v.allowed, v.code], [false, 'robots_fetch_error']);
});

test('the transport egress guard refusing a host skips the retry', async () => {
  const blocked = Object.assign(new Error('Refusing to connect to example.com: resolves to non-public address 10.0.0.1'), { code: 'ECAREEROPS_BLOCKED_ADDRESS' });
  const { fetchImpl } = transport(() => blocked);
  const v = await robotsAllows('https://example.com/jobs/1', { fetchImpl, resolver: async () => PUBLIC, cache: new Map() });
  assert.deepEqual([v.allowed, v.code], [false, 'robots_blocked_address']);
});

test('a body over the RFC 9309 parse floor skips the retry instead of being truncated', async () => {
  const body = `User-agent: *\nAllow: /\n${'#'.repeat(ROBOTS_MAX_BYTES)}\nDisallow: /jobs\n`;
  const v = await gate('https://example.com/jobs/1', body);
  assert.deepEqual([v.allowed, v.code], [false, 'robots_too_large']);
});

// ── Egress guard ─────────────────────────────────────────────────────────

test('an unresolvable host skips the retry without a fetch', async () => {
  for (const resolver of [
    async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); },
    async () => [],
  ]) {
    const v = await gate('https://example.com/jobs/1', 'User-agent: *\nAllow: /\n', { resolver });
    assert.deepEqual([v.allowed, v.code], [false, 'robots_unresolvable']);
    assert.equal(v.calls.length, 0);
  }
});

test('a host resolving into private space skips the retry without a fetch', async () => {
  for (const addresses of [['127.0.0.1'], ['169.254.169.254'], ['93.184.215.14', '10.0.0.5'], ['::ffff:127.0.0.1'], ['fd00::1']]) {
    const v = await gate('https://example.com/jobs/1', 'User-agent: *\nAllow: /\n', { resolver: async () => addresses });
    assert.deepEqual([v.allowed, v.code], [false, 'robots_blocked_address'], addresses.join(','));
    assert.equal(v.calls.length, 0);
  }
});

test('a literal private IP is refused without resolving or fetching', async () => {
  let resolved = 0;
  const { fetchImpl, calls } = transport({});
  for (const url of ['http://127.0.0.1/jobs', 'http://[::1]/jobs', 'http://169.254.169.254/latest']) {
    const v = await robotsAllows(url, { fetchImpl, resolver: async () => { resolved++; return PUBLIC; }, cache: new Map() });
    assert.deepEqual([v.allowed, v.code], [false, 'robots_blocked_address'], url);
  }
  assert.equal(resolved, 0);
  assert.equal(calls.length, 0);
});

test('a redirect is followed, and every hop is guarded again', async () => {
  const resolver = async (host) => (host === 'internal.example.com' ? ['10.1.2.3'] : PUBLIC);
  const { fetchImpl, calls } = transport({
    'https://example.com/robots.txt': { status: 301, headers: { location: 'https://www.example.com/robots.txt' } },
    'https://www.example.com/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /jobs\n' },
    'https://example.org/robots.txt': { status: 302, headers: { location: 'http://internal.example.com/robots.txt' } },
  });
  const followed = await robotsAllows('https://example.com/jobs/1', { fetchImpl, resolver, cache: new Map() });
  assert.deepEqual([followed.allowed, followed.code], [false, 'robots_disallowed']);
  assert.deepEqual(calls.map(({ url }) => url), ['https://example.com/robots.txt', 'https://www.example.com/robots.txt']);
  assert.ok(calls.every(({ init }) => init.redirect === 'manual'), 'the transport must never follow a redirect itself');

  const refused = await robotsAllows('https://example.org/jobs/1', { fetchImpl, resolver, cache: new Map() });
  assert.deepEqual([refused.allowed, refused.code], [false, 'robots_blocked_address']);
  assert.ok(!calls.some(({ url }) => url.startsWith('http://internal.')), 'a blocked hop is never fetched');
});

test('a redirect off http(s), without a Location, or past the hop limit skips the retry', async () => {
  const loop = transport((url) => ({ status: 302, headers: { location: `${url}?again` } }));
  const looped = await robotsAllows('https://example.com/jobs', { fetchImpl: loop.fetchImpl, resolver: async () => PUBLIC, cache: new Map() });
  assert.deepEqual([looped.allowed, looped.code], [false, 'robots_too_many_redirects']);
  assert.equal(loop.calls.length, 6, 'five redirects are followed, as RFC 9309 asks, and no more');

  const file = transport({ 'https://example.com/robots.txt': { status: 301, headers: { location: 'file:///etc/passwd' } } });
  const offHttp = await robotsAllows('https://example.com/jobs', { fetchImpl: file.fetchImpl, resolver: async () => PUBLIC, cache: new Map() });
  assert.deepEqual([offHttp.allowed, offHttp.code], [false, 'robots_redirect_refused']);

  const bare = transport({ 'https://example.com/robots.txt': { status: 302 } });
  const noLocation = await robotsAllows('https://example.com/jobs', { fetchImpl: bare.fetchImpl, resolver: async () => PUBLIC, cache: new Map() });
  assert.deepEqual([noLocation.allowed, noLocation.code], [false, 'robots_http_error']);
});

// ── Scheme and URL hardening ─────────────────────────────────────────────

test('a non-http(s) URL or one with no host is refused without a request', async () => {
  const { fetchImpl, calls } = transport({});
  for (const url of ['file:///etc/passwd', 'gopher://127.0.0.1:6379/_', 'ftp://example.com/robots.txt', 'example.com/path', 'not a url']) {
    const v = await robotsAllows(url, { fetchImpl, resolver: async () => PUBLIC, cache: new Map() });
    assert.deepEqual([v.allowed, v.code], [false, 'robots_invalid_url'], url);
  }
  assert.equal(calls.length, 0);
});

test('the robots URL is rebuilt from the origin, never the caller path or credentials', async () => {
  const { fetchImpl, calls } = transport({ 'https://example.com:8443/robots.txt': { body: 'User-agent: *\nAllow: /\n' } });
  await robotsAllows('https://user:secret@example.com:8443/-o/evil?q=1#frag', { fetchImpl, resolver: async () => PUBLIC, cache: new Map() });
  assert.deepEqual(calls.map(({ url }) => url), ['https://example.com:8443/robots.txt']);
});

test('robots.txt is requested as career-ops, with DEFAULT_USER_AGENT', async () => {
  const v = await gate('https://example.com/jobs/1', 'User-agent: *\nAllow: /\n');
  assert.equal(v.calls[0].init.headers['user-agent'], DEFAULT_USER_AGENT);
});

// ── Cache ────────────────────────────────────────────────────────────────

test('one robots.txt fetch per origin, shared by every path and concurrent caller', async () => {
  const { fetchImpl, calls } = transport({
    'https://example.com/robots.txt': { body: 'User-agent: *\nDisallow: /private\n' },
    'https://other.example.com/robots.txt': { status: 503 },
  });
  const cache = new Map();
  const opts = { fetchImpl, resolver: async () => PUBLIC, cache };
  const [a, b] = await Promise.all([
    robotsAllows('https://example.com/jobs/1', opts),
    robotsAllows('https://example.com/private/2', opts),
  ]);
  const c = await robotsAllows('https://example.com/jobs/3', opts);
  assert.deepEqual([a.code, b.code, c.code], ['robots_allowed', 'robots_disallowed', 'robots_allowed']);
  const failed = await robotsAllows('https://other.example.com/jobs/1', opts);
  await robotsAllows('https://other.example.com/jobs/2', opts);
  assert.equal(failed.code, 'robots_server_error');
  assert.deepEqual(calls.map(({ url }) => url), ['https://example.com/robots.txt', 'https://other.example.com/robots.txt']);
});

test('the default cache is per process and can be cleared', async () => {
  clearRobotsCache();
  const { fetchImpl, calls } = transport({ 'https://example.com/robots.txt': { body: 'User-agent: *\nAllow: /\n' } });
  const opts = { fetchImpl, resolver: async () => PUBLIC };
  await robotsAllows('https://example.com/a', opts);
  await robotsAllows('https://example.com/b', opts);
  assert.equal(calls.length, 1);
  clearRobotsCache();
  await robotsAllows('https://example.com/c', opts);
  assert.equal(calls.length, 2);
  clearRobotsCache();
});

// ── Crawl-delay ──────────────────────────────────────────────────────────
// Not part of RFC 9309, but the Source Indexing Policy (CONTRIBUTING.md,
// rule 6) asks a reader to honour a Crawl-delay the source states.

test('Crawl-delay: the own group wins over *, and * applies when there is none', () => {
  const text = 'User-agent: *\nCrawl-delay: 5\nDisallow: /api/\n\nUser-agent: career-ops\nCrawl-delay: 2\nAllow: /\n';
  assert.equal(crawlDelaySeconds(text, ROBOTS_PRODUCT_TOKEN), 2);
  assert.equal(crawlDelaySeconds(text, 'otherbot'), 5);
});

test('Crawl-delay: absent, malformed or negative reads as none', () => {
  assert.equal(crawlDelaySeconds('User-agent: *\nDisallow: /api/\n', ROBOTS_PRODUCT_TOKEN), null);
  assert.equal(crawlDelaySeconds('User-agent: *\nCrawl-delay: soon\nCrawl-delay: -3\n', ROBOTS_PRODUCT_TOKEN), null);
  assert.equal(crawlDelaySeconds('Crawl-delay: 9\nUser-agent: *\nAllow: /\n', ROBOTS_PRODUCT_TOKEN), null);
  assert.equal(crawlDelaySeconds('User-agent: *\nCrawl-delay: 1.5 # polite\n', ROBOTS_PRODUCT_TOKEN), 1.5);
});

test('an allowed verdict carries the Crawl-delay; a denied one does not', async () => {
  const allowed = await gate('https://example.com/c', 'User-agent: *\nCrawl-delay: 3\nDisallow: /api/\n');
  assert.deepEqual([allowed.allowed, allowed.crawlDelay], [true, 3]);
  const none = await gate('https://example.com/c', 'User-agent: *\nDisallow: /api/\n');
  assert.deepEqual([none.allowed, none.crawlDelay], [true, null]);
  const denied = await gate('https://example.com/api/x', 'User-agent: *\nCrawl-delay: 3\nDisallow: /api/\n');
  assert.deepEqual([denied.allowed, 'crawlDelay' in denied], [false, false]);
});
