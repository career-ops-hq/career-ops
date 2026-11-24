import test from 'node:test';
import assert from 'node:assert/strict';
import {
  robotsAllows,
  isPathAllowed,
  crawlDelaySeconds,
  ROBOTS_PRODUCT_TOKEN,
} from '../robots-check.mjs';

test('a Crawl-delay-only * group does not inherit Disallow rules from the following agent group', async () => {
  const body = [
    'User-agent: *',
    'Crawl-delay: 5',
    '',
    'User-agent: GPTBot',
    'Disallow: /',
    '',
  ].join('\n');

  assert.equal(isPathAllowed(body, ROBOTS_PRODUCT_TOKEN, '/jobs/123'), true);
  assert.equal(isPathAllowed(body, '*', '/jobs/123'), true);
  assert.equal(isPathAllowed(body, 'GPTBot', '/jobs/123'), false);
  assert.equal(crawlDelaySeconds(body, ROBOTS_PRODUCT_TOKEN), 5);
  assert.equal(crawlDelaySeconds(body, 'GPTBot'), 5);

  const verdict = await robotsAllows('https://example.com/jobs/123', {
    fetchImpl: async () => new Response(body, { status: 200 }),
    resolver: async () => ['93.184.215.14'],
    cache: new Map(),
  });
  assert.deepEqual([verdict.allowed, verdict.code, verdict.crawlDelay], [true, 'robots_allowed', 5]);
});

test('a Crawl-delay-only named group does not inherit Disallow rules from the next group', () => {
  const body = [
    'User-agent: career-ops',
    'Crawl-delay: 2',
    '',
    'User-agent: BadBot',
    'Disallow: /',
    '',
  ].join('\n');

  assert.equal(isPathAllowed(body, ROBOTS_PRODUCT_TOKEN, '/jobs/123'), true);
  assert.equal(isPathAllowed(body, 'BadBot', '/jobs/123'), false);
  assert.equal(crawlDelaySeconds(body, ROBOTS_PRODUCT_TOKEN), 2);
});

test('a malformed Crawl-delay closes its User-agent block so a later group delay cannot leak into *', () => {
  const body = [
    'User-agent: *',
    'Crawl-delay: invalid',
    '',
    'User-agent: SlowBot',
    'Crawl-delay: 60',
    '',
  ].join('\n');

  assert.equal(crawlDelaySeconds(body, ROBOTS_PRODUCT_TOKEN), null);
  assert.equal(crawlDelaySeconds(body, 'SlowBot'), 60);
});

test('multiple User-agent lines before Crawl-delay share the delay without merging into the next group', () => {
  const body = [
    'User-agent: AlphaBot',
    'User-agent: BetaBot',
    'Crawl-delay: 3',
    '',
    'User-agent: GammaBot',
    'Disallow: /',
    '',
  ].join('\n');

  assert.equal(isPathAllowed(body, 'AlphaBot', '/jobs'), true);
  assert.equal(isPathAllowed(body, 'BetaBot', '/jobs'), true);
  assert.equal(isPathAllowed(body, 'GammaBot', '/jobs'), false);
  assert.equal(crawlDelaySeconds(body, 'AlphaBot'), 3);
  assert.equal(crawlDelaySeconds(body, 'BetaBot'), 3);
  assert.equal(crawlDelaySeconds(body, 'GammaBot'), null);
});

test('Crawl-delay followed by Disallow in the same group still binds that group and separates the next', () => {
  const body = [
    'User-agent: career-ops',
    'Crawl-delay: 2',
    'Disallow: /private',
    '',
    'User-agent: *',
    'Disallow: /',
    '',
  ].join('\n');

  assert.equal(isPathAllowed(body, ROBOTS_PRODUCT_TOKEN, '/jobs'), true);
  assert.equal(isPathAllowed(body, ROBOTS_PRODUCT_TOKEN, '/private'), false);
  assert.equal(isPathAllowed(body, 'OtherBot', '/jobs'), false);
  assert.equal(crawlDelaySeconds(body, ROBOTS_PRODUCT_TOKEN), 2);
});

test('a named group with only Crawl-delay still falls back to * path rules', () => {
  const body = [
    'User-agent: *',
    'Disallow: /',
    '',
    'User-agent: career-ops',
    'Crawl-delay: 2',
    '',
  ].join('\n');

  assert.equal(isPathAllowed(body, ROBOTS_PRODUCT_TOKEN, '/jobs'), false);
  assert.equal(crawlDelaySeconds(body, ROBOTS_PRODUCT_TOKEN), 2);
});
