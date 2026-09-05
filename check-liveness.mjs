#!/usr/bin/env node

/**
 * check-liveness.mjs — Playwright job link liveness checker
 *
 * Tests whether job posting URLs are still active or have expired.
 * Uses the same detection logic as scan.md step 7.5.
 * Zero Claude API tokens. Two rungs: a free public-API check first
 * (liveness-api.mjs, no browser), then Playwright for everything else.
 *
 * An `expired` verdict is recorded back into data/scan-history.tsv as a
 * `skipped_expired` row, so a posting confirmed dead once stops resurfacing
 * (#3891). See recordExpiredVerdicts below for why that is default-on.
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
import { planExpiredHistoryRows } from './liveness-core.mjs';
import { appendToScanHistory, normalizeUrlForDedup, SCAN_HISTORY_PATH } from './scan.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { localToday } from './lib/local-today.mjs';
import { existsSync, readFileSync } from 'fs';

const USAGE = `Usage:
  node check-liveness.mjs [--no-fallback] [--throttle[=ms]] [--no-record] <url1> [url2] ...
  node check-liveness.mjs [--no-fallback] [--throttle[=ms]] [--no-record] --file urls.txt
  node check-liveness.mjs --no-record             # check only; write nothing to scan-history
  node check-liveness.mjs --help                  # print this usage block and exit
  node check-liveness.mjs -h                      # alias for --help`;

/**
 * Is this run allowed to record its verdicts?
 *
 * Default-ON, opt-OUT. An opt-IN flag would be the bug wearing a fix: the
 * scheduled routines pass no flags, so a gated recording never runs from the
 * one caller that produces most of these verdicts — which is precisely how the
 * expensive `expired` result came to be computed and discarded (#3891).
 * `--no-record` covers the real need for the opposite: a read-only spot check
 * that leaves no trace.
 *
 * @param {string[]} args - process.argv.slice(2).
 * @returns {boolean}
 */
export function recordingEnabled(args = []) {
  return !args.includes('--no-record');
}

/**
 * Write the run's `expired` verdicts into data/scan-history.tsv.
 *
 * Everything about WHICH rows get written is decided by planExpiredHistoryRows
 * (only expired, only URLs the history knows, once each); this is the effect.
 * A history file that does not exist yet means no URL is known, so there is
 * nothing to retire and nothing to create.
 *
 * The row is stamped with localToday(), like every other scan-history writer:
 * a UTC day is the wrong day for most of the world for part of every day.
 *
 * @param {{url: string, result: string}[]} verdicts
 * @returns {Promise<number>} How many rows were written.
 */
export async function recordExpiredVerdicts(verdicts) {
  if (!existsSync(SCAN_HISTORY_PATH)) return 0;
  const rows = planExpiredHistoryRows(
    readFileSync(SCAN_HISTORY_PATH, 'utf-8'),
    verdicts,
    normalizeUrlForDedup,
  );
  if (rows.length > 0) await appendToScanHistory(rows, localToday(), 'skipped_expired');
  return rows.length;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }

  // Portals like pracuj.pl serve a Cloudflare anti-bot wall to headless Chromium.
  // On a challenge we retry once in a headed browser (which clears it); pass
  // --no-fallback to stay fully headless (e.g. on a machine with no display).
  const noFallback = args.includes('--no-fallback');
  // --throttle or --throttle=<ms>: wait base..2*base ms (jittered) between checks
  // to stay under rate-based WAF limits. pracuj.pl's Cloudflare flags the session
  // after ~2 rapid hits, so a bulk run needs spacing. Default base 5000ms.
  const throttleArg = args.find((a) => a === '--throttle' || a.startsWith('--throttle='));
  const throttleBaseMs = throttleArg ? (Number(throttleArg.split('=')[1]) || 5000) : 0;
  const record = recordingEnabled(args);
  const positional = args.filter((a) => a !== '--no-fallback' && a !== '--no-record' && a !== throttleArg);

  if (positional.length === 0) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
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
    record ? null : 'no-record',
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
  const verdicts = [];

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
    verdicts.push({ url, result });

    // Throttle only matters between browser checks (the API is cheap, not WAF-rate-limited).
    const wait = usedBrowser && i < urls.length - 1 ? jitteredDelayMs(throttleBaseMs) : 0;
    if (wait) await sleep(wait);
  }

  if (headed) await headed.close();
  if (browser) await browser.close();

  console.log(`\nResults: ${active} active  ${expired} expired  ${uncertain} uncertain  (${viaApi} via API, no browser)`);

  // Close the loop: the verdict is the expensive part of this run and it used
  // to die with the process. `--no-record` leaves no trace, so the write is
  // skipped entirely rather than computed and thrown away.
  if (record) {
    const recorded = await recordExpiredVerdicts(verdicts);
    if (recorded > 0) console.log(`Recorded ${recorded} expired posting(s) in ${SCAN_HISTORY_PATH}`);
  }

  if (expired > 0 || uncertain > 0) process.exitCode = 1;
}

// Only run main() when invoked directly (`node check-liveness.mjs`), not when
// imported — the arg parsing above would otherwise read an importing test's argv.
if (isMainModule(import.meta.url)) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exitCode = 1;
  });
}
