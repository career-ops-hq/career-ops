#!/usr/bin/env node

/**
 * check-liveness.mjs — Playwright job link liveness checker
 *
 * Tests whether job posting URLs are still active or have expired.
 * Uses the same detection logic as scan.md step 7.5.
 * Zero Claude API tokens. Two rungs: a free ATS API check first
 * (Greenhouse/Lever — no browser), then Playwright for everything else.
 *
 * Usage:
 *   node check-liveness.mjs <url1> [url2] ...
 *   node check-liveness.mjs --file urls.txt
 *
 * Exit code: 0 if all active, 1 if any expired or uncertain
 */

import { chromium } from 'playwright';
import { readFile } from 'fs/promises';
import {
  checkUrlLivenessWithFallback,
  createHeadedPageProvider,
  newLivenessPage,
  jitteredDelayMs,
  sleep,
} from './liveness-browser.mjs';
import { checkLivenessViaApi } from './liveness-api.mjs';

async function main() {
  const args = process.argv.slice(2);

  // Portals like pracuj.pl serve a Cloudflare anti-bot wall to headless Chromium.
  // On a challenge we retry once in a headed browser (which clears it); pass
  // --no-fallback to stay fully headless (e.g. on a machine with no display).
  const noFallback = args.includes('--no-fallback');
  // --throttle or --throttle=<ms>: wait base..2*base ms (jittered) between checks
  // to stay under rate-based WAF limits. pracuj.pl's Cloudflare flags the session
  // after ~2 rapid hits, so a bulk run needs spacing. Default base 5000ms.
  const throttleArg = args.find((a) => a === '--throttle' || a.startsWith('--throttle='));
  const throttleBaseMs = throttleArg ? (Number(throttleArg.split('=')[1]) || 5000) : 0;
  const positional = args.filter((a) => a !== '--no-fallback' && a !== throttleArg);

  if (positional.length === 0) {
    console.error('Usage: node check-liveness.mjs [--no-fallback] [--throttle[=ms]] <url1> [url2] ...');
    console.error('       node check-liveness.mjs [--no-fallback] [--throttle[=ms]] --file urls.txt');
    process.exit(1);
  }

  let urls;
  if (positional[0] === '--file') {
    const text = await readFile(positional[1], 'utf-8');
    urls = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  } else {
    urls = positional;
  }

  const notes = [
    noFallback ? null : 'headed fallback on challenge',
    throttleBaseMs ? `throttle ~${throttleBaseMs / 1000}-${(throttleBaseMs * 2) / 1000}s` : null,
  ].filter(Boolean);
  console.log(`Checking ${urls.length} URL(s)...${notes.length ? ` (${notes.join(', ')})` : ''}\n`);

  // Lazy browser: the API rung resolves ATS postings with no browser at all, so we
  // only launch Playwright if a URL actually needs the fallback.
  let browser = null, page = null, headed = null;
  async function ensureBrowser() {
    if (browser) return;
    browser = await chromium.launch({ headless: true });
    page = await newLivenessPage(browser);
    headed = noFallback ? null : createHeadedPageProvider(chromium);
  }

  let active = 0, expired = 0, uncertain = 0, viaApi = 0;

  // Sequential — project rule: never Playwright in parallel
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    let result, reason, usedBrowser = false;

    // Rung 1: zero-token ATS API check. A conclusive active/expired wins; otherwise fall through.
    const api = await checkLivenessViaApi(url);
    if (api) {
      ({ result, reason } = api);
      viaApi++;
    } else {
      // Rung 2: Playwright — handles non-ATS pages and inconclusive API results.
      await ensureBrowser();
      const getHeadedPage = headed ? () => headed.get() : undefined;
      ({ result, reason } = await checkUrlLivenessWithFallback(page, url, { getHeadedPage }));
      usedBrowser = true;
    }

    const icon = { active: '✅', expired: '❌', uncertain: '⚠️' }[result];
    console.log(`${icon} ${result.padEnd(10)} ${api ? '(api) ' : '      '}${url}`);
    if (result !== 'active') console.log(`           ${reason}`);
    if (result === 'active') active++;
    else if (result === 'expired') expired++;
    else uncertain++;

    // Throttle only matters between browser checks (the API is cheap, not WAF-rate-limited).
    const wait = usedBrowser && i < urls.length - 1 ? jitteredDelayMs(throttleBaseMs) : 0;
    if (wait) await sleep(wait);
  }

  if (headed) await headed.close();
  if (browser) await browser.close();

  console.log(`\nResults: ${active} active  ${expired} expired  ${uncertain} uncertain  (${viaApi} via API, no browser)`);
  if (expired > 0 || uncertain > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
