/** Collect read-only ATS API and browser liveness observations for Python. */

import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { checkLivenessViaApi } from '../liveness-api.mjs';
import {
  checkUrlLivenessWithFallback,
  createHeadedPageProvider,
  newLivenessPage,
  jitteredDelayMs,
  sleep,
} from '../liveness-browser.mjs';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error('input and output JSON paths are required');

const { urls, headed_fallback: headedFallback, throttle_ms: throttleMs } =
  JSON.parse(await readFile(inputPath, 'utf8'));
if (!Array.isArray(urls) || urls.some(url => typeof url !== 'string')) {
  throw new Error('urls must be a string array');
}

let browser, page, headed;
const results = [];
try {
  for (let index = 0; index < urls.length; index++) {
    const url = urls[index];
    const api = await checkLivenessViaApi(url);
    let observation = api;
    if (!api) {
      if (!browser) {
        browser = await chromium.launch({ headless: true });
        page = await newLivenessPage(browser);
        headed = headedFallback ? createHeadedPageProvider(chromium) : null;
      }
      observation = await checkUrlLivenessWithFallback(page, url, {
        getHeadedPage: headed ? () => headed.get() : undefined,
      });
    }
    results.push({ url, result: observation.result, reason: observation.reason,
      via_api: Boolean(api) });
    if (!api && index < urls.length - 1 && throttleMs > 0) {
      await sleep(jitteredDelayMs(throttleMs));
    }
  }
} finally {
  if (headed) await headed.close();
  if (browser) await browser.close();
}

await writeFile(outputPath, JSON.stringify({ results }));
