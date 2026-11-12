// tests/liveness-robots-gate.test.mjs — the headed liveness retry asks
// robots.txt first (#5776).
//
// checkUrlLivenessWithFallback retries a bot-walled URL in a headed Chromium.
// With a `robotsGate`, that retry runs only when the gate allows it; a skip
// keeps the headless verdict (result and code) and only extends its reason, so
// the gate can drop an escalation but never a posting. With no gate, behavior
// is what it was before the gate existed. Fake Playwright pages stand in for
// the browser and the gate is injected, so nothing here touches the network.
//
// Run:  node --test tests/liveness-robots-gate.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkUrlLivenessWithFallback } from '../liveness-browser.mjs';
import { robotsAllows } from '../robots-check.mjs';
import { ROOT } from './helpers.mjs';

const URL = 'https://example.com/jobs/1004870954';
const isControlsRead = (fn) => String(fn).includes('querySelectorAll');
const fakePage = ({ status, bodyText, applyControls }) => ({
  async goto() { return { status: () => status }; },
  async waitForTimeout() {},
  url() { return URL; },
  async evaluate(fn) { return isControlsRead(fn) ? applyControls : bodyText; },
});
const challengePage = () => fakePage({
  status: 403,
  bodyText: 'Just a moment... Performing security verification. Ray ID: abc123. Cloudflare.',
  applyControls: [],
});
const livePage = () => fakePage({ status: 200, bodyText: 'Platform Engineer. '.repeat(20), applyControls: ['Apply for this job'] });
const expiredPage = () => fakePage({ status: 404, bodyText: 'This job is no longer available.', applyControls: [] });

/** A headed-page provider that counts how often it was asked. */
function headed(page = livePage) {
  const state = { asked: 0 };
  return { state, getHeadedPage: async () => { state.asked += 1; return page(); } };
}

test('an allowing gate lets the headed retry run', async () => {
  const h = headed();
  const gated = [];
  const result = await checkUrlLivenessWithFallback(challengePage(), URL, {
    getHeadedPage: h.getHeadedPage,
    robotsGate: async (url) => { gated.push(url); return { allowed: true, code: 'robots_allowed', reason: 'permits /jobs/1004870954 for career-ops' }; },
  });
  assert.equal(result.result, 'active');
  assert.deepEqual(gated, [URL]);
  assert.equal(h.state.asked, 1);
});

test('a disallowing gate skips the retry before a headed page is asked for', async () => {
  const h = headed();
  const result = await checkUrlLivenessWithFallback(challengePage(), URL, {
    getHeadedPage: h.getHeadedPage,
    robotsGate: async () => ({ allowed: false, code: 'robots_disallowed', reason: 'disallows /jobs/1004870954 for career-ops' }),
  });
  assert.equal(h.state.asked, 0, 'no headed Chromium is launched for a skipped retry');
  assert.equal(result.result, 'uncertain', 'a skip is never expired');
  assert.equal(result.code, 'bot_challenge', 'the headless code is kept');
  assert.match(result.reason, /\(headed retry skipped: robots\.txt disallows \/jobs\/1004870954 for career-ops\)$/);
});

test('a gate that throws, or answers nothing usable, counts as a skip', async () => {
  for (const robotsGate of [
    async () => { throw new Error('boom'); },
    async () => undefined,
    async () => ({ allowed: 'yes' }),
  ]) {
    const h = headed();
    const result = await checkUrlLivenessWithFallback(challengePage(), URL, { getHeadedPage: h.getHeadedPage, robotsGate });
    assert.equal(h.state.asked, 0);
    assert.equal(result.result, 'uncertain');
    assert.equal(result.code, 'bot_challenge');
    assert.match(result.reason, /headed retry skipped: robots\.txt/);
  }
});

test('the gate is consulted only after a challenge, never on the first request', async () => {
  let asked = 0;
  const robotsGate = async () => { asked += 1; return { allowed: false, reason: 'disallows everything' }; };
  const live = await checkUrlLivenessWithFallback(livePage(), URL, { getHeadedPage: headed().getHeadedPage, robotsGate });
  const gone = await checkUrlLivenessWithFallback(expiredPage(), URL, { getHeadedPage: headed().getHeadedPage, robotsGate });
  assert.equal(live.result, 'active');
  assert.equal(gone.result, 'expired');
  assert.equal(asked, 0, 'a verdict the headless check reached on its own never asks robots.txt');
});

test('with no headed provider, the gate is not asked', async () => {
  let asked = 0;
  const result = await checkUrlLivenessWithFallback(challengePage(), URL, { robotsGate: async () => { asked += 1; return { allowed: true }; } });
  assert.equal(asked, 0);
  assert.equal(result.code, 'bot_challenge');
});

test('with no gate passed, the headed retry runs as it always did', async () => {
  const h = headed();
  const result = await checkUrlLivenessWithFallback(challengePage(), URL, { getHeadedPage: h.getHeadedPage });
  assert.equal(result.result, 'active');
  assert.equal(h.state.asked, 1);
});

test('the real robotsAllows works as the gate, end to end', async () => {
  const fetchImpl = async () => new Response('User-agent: *\nDisallow: /jobs/\n', { status: 200 });
  const resolver = async () => ['93.184.215.14'];
  const h = headed();
  const result = await checkUrlLivenessWithFallback(challengePage(), URL, {
    getHeadedPage: h.getHeadedPage,
    robotsGate: (url) => robotsAllows(url, { fetchImpl, resolver, cache: new Map() }),
  });
  assert.equal(h.state.asked, 0);
  assert.equal(result.code, 'bot_challenge');
  assert.match(result.reason, /headed retry skipped: robots\.txt disallows \/jobs\/1004870954 for career-ops/);
});

test('both real callers pass the gate', () => {
  // Structural: a gate nothing passes is indistinguishable from no gate.
  const checkLiveness = readFileSync(join(ROOT, 'check-liveness.mjs'), 'utf-8');
  assert.match(checkLiveness, /checkUrlLivenessWithFallback\(page, url, \{ getHeadedPage, robotsGate: robotsAllows \}\)/);
  const scan = readFileSync(join(ROOT, 'scan.mjs'), 'utf-8');
  assert.match(scan, /robotsGate = robotsAllows,/, 'verifyOffers defaults its gate to robotsAllows');
  assert.match(scan, /checkUrlLivenessWithFallback\(page, url, \{ getHeadedPage: \(\) => headed\.get\(\), robotsGate \}\)/);
});
