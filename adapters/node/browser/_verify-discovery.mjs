#!/usr/bin/env node
/** Read posting liveness and optional moved URLs for Python discovery. */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  checkUrlLiveness, checkUrlLivenessWithFallback, createHeadedPageProvider,
  jitteredDelayMs, newLivenessPage, sleep,
} from './liveness-browser.mjs';

async function searchMovedUrl(page, offer) {
  const domain = offer.careersUrlDomain;
  if (!domain) return null;
  try {
    const query = `"${offer.title}" "${offer.company}" site:${domain}`;
    await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { waitUntil: 'domcontentloaded', timeout: 10_000 });
    const hrefs = await page.locator('a.result__a').evaluateAll(
      links => links.map(link => link.getAttribute('href')).filter(Boolean));
    for (const href of hrefs) {
      try {
        const parsed = new URL(href, 'https://duckduckgo.com');
        const target = (parsed.hostname === 'duckduckgo.com' || parsed.hostname.endsWith('.duckduckgo.com'))
          && parsed.pathname === '/l/' ? parsed.searchParams.get('uddg') : parsed.href;
        if (target && new URL(target).hostname === domain) return target;
      } catch { /* another result may be valid */ }
    }
  } catch {
    return null;
  } finally {
    try { await page.goto('about:blank'); } catch { /* best effort */ }
  }
  return null;
}

export async function verify(input, chromium) {
  if (!Array.isArray(input.offers)) throw new Error('offers must be an array');
  const browser = await chromium.launch({ headless: true });
  const headed = input.headed_fallback ? createHeadedPageProvider(chromium) : null;
  try {
    const page = await newLivenessPage(browser);
    const check = url => headed
      ? checkUrlLivenessWithFallback(page, url, { getHeadedPage: () => headed.get() })
      : checkUrlLiveness(page, url);
    const results = [];
    for (const [index, offer] of input.offers.entries()) {
      const initial = await check(offer.url);
      const observation = { url: offer.url, ...initial };
      if (input.rediscover_404 && initial.result === 'expired' && initial.code === 'http_gone'
          && offer.careersUrlDomain) {
        const moved_url = await searchMovedUrl(page, offer);
        if (moved_url) {
          observation.moved_url = moved_url;
          observation.moved_check = await check(moved_url);
        }
      }
      results.push(observation);
      if (index < input.offers.length - 1) {
        await sleep(jitteredDelayMs(input.throttle_ms || 0));
      }
    }
    return { results };
  } finally {
    if (headed) await headed.close();
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error('Usage: node lib/_verify-discovery.mjs <input.json> <output.json>');
    process.exitCode = 2;
  } else {
    try {
      const { chromium } = await import('playwright');
      writeFileSync(outputPath, JSON.stringify(await verify(JSON.parse(readFileSync(inputPath, 'utf8')), chromium)));
    } catch (error) {
      console.error(`posting verification failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
