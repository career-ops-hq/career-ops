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
import { planExpiredHistoryRows, trackerLivenessTargets, DEFAULT_TRACKER_STATUSES, planExpiredDiscards, postingClosedNote, DEFAULT_DISCARD_STATUSES } from './liveness-core.mjs';
import { appendToScanHistory, normalizeUrlForDedup, SCAN_HISTORY_PATH } from './scan.mjs';
import { withPipelineLock } from './pipeline-lock.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { localToday } from './lib/local-today.mjs';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';

const USAGE = `Usage:
  node check-liveness.mjs [--no-fallback] [--throttle[=ms]] [--no-record] <url1> [url2] ...
  node check-liveness.mjs [--no-fallback] [--throttle[=ms]] [--no-record] --file urls.txt
  node check-liveness.mjs --tracker [--status=Evaluated,Applied]   # postings of tracker rows in these statuses
  node check-liveness.mjs --tracker --discard-expired [--apply]    # dry-run move expired Evaluated rows to Discarded; --apply writes
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
 * The read and the append share ONE critical section. What to append is decided
 * by what the file already says, so reading outside the lock is a check-then-act:
 * a scanner appending the same `skipped_expired` row in between would leave two
 * death certificates for one posting. The lock is not reentrant, hence
 * `alreadyLocked` on the append rather than a second acquisition.
 *
 * @param {{url: string, result: string}[]} verdicts
 * @returns {Promise<number>} How many rows were written.
 */
export async function recordExpiredVerdicts(verdicts) {
  // This one check is deliberately OUTSIDE the lock, unlike the read below.
  // No history means no URL is known, so there is nothing to retire and no
  // reason to pay for a lock — and locking it would buy nothing, because the
  // scenario it looks like it prevents is not preventable. A scanner that
  // creates the file and surfaces this URL a microsecond after the check is
  // indistinguishable from one that does it a second after the whole function
  // returns: either way the posting was discovered after the verdict, and the
  // next sweep is what covers it. (The file is created by atomicWriteFile,
  // which renames into place, so this can never see a half-written history.)
  if (!existsSync(SCAN_HISTORY_PATH)) return 0;
  return withPipelineLock(SCAN_HISTORY_PATH, async () => {
    const rows = planExpiredHistoryRows(
      readFileSync(SCAN_HISTORY_PATH, 'utf-8'),
      verdicts,
      normalizeUrlForDedup,
    );
    if (rows.length > 0) await appendToScanHistory(rows, localToday(), 'skipped_expired', { alreadyLocked: true });
    return rows.length;
  });
}

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));

function runSetStatus(args, trackerPath) {
  try {
    return JSON.parse(execFileSync(process.execPath, [join(CODE_ROOT, 'set-status.mjs'), ...args], {
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_TRACKER: trackerPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
  } catch (err) {
    try {
      return JSON.parse(err.stdout);
    } catch {
      return { error: (typeof err.stderr === 'string' && err.stderr.trim()) || err.message };
    }
  }
}

/**
 * Move planned rows to Discarded through set-status.mjs (locked atomic write).
 * Dry-run when apply is false: resolve only, write nothing.
 *
 * The liveness sweep can take minutes, so each row is planned again against
 * the tracker as it is now, and set-status refuses the write under its lock
 * if the tracker changed after that re-plan.
 *
 * @param {{num: number, company: string, role: string, status: string, url: string}[]} rows
 * @param {{apply: boolean, note: string, trackerPath: string, reportsRoot: string}} options
 * @returns {{num: number, company: string, role: string, url: string, changed: boolean, dryRun: boolean, error?: string, skipped?: string}[]}
 */
export function discardExpiredRows(rows, { apply, note, trackerPath, reportsRoot }) {
  return rows.map((row) => {
    const base = { num: row.num, company: row.company, role: row.role, url: row.url, changed: false, dryRun: !apply };
    const current = readFileSync(trackerPath, 'utf-8');
    if (!planExpiredDiscards(current, [row.url], { reportsRoot }).some((r) => r.num === row.num)) {
      return { ...base, skipped: 'no longer Evaluated with this posting' };
    }
    const args = ['--row', String(row.num), 'Discarded', '--note', note, '--json',
      '--expect-tracker', createHash('sha256').update(current, 'utf8').digest('hex')];
    if (!apply) args.push('--dry-run');
    const out = runSetStatus(args, trackerPath);
    if (out.error) return { ...base, error: out.error };
    return { ...base, changed: Boolean(out.changed), dryRun: Boolean(out.dryRun) || !apply };
  });
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
  const statusArg = args.find((a) => a.startsWith('--status='));
  const fromTracker = args.includes('--tracker');
  const discardExpired = args.includes('--discard-expired');
  const applyDiscards = args.includes('--apply');
  const positional = args.filter((a) => a !== '--no-fallback' && a !== '--no-record' && a !== throttleArg
    && a !== '--tracker' && a !== '--discard-expired' && a !== '--apply' && a !== statusArg);

  if (discardExpired && !fromTracker) {
    console.error('--discard-expired requires --tracker.');
    process.exitCode = 1;
    return;
  }

  if (positional.length === 0 && !fromTracker) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  let urls;
  const labels = new Map();
  let trackerPath = null;
  let trackerText = null;
  let reportsRoot = null;
  if (fromTracker) {
    const root = getCareerOpsRoot();
    trackerPath = resolveTrackerPath(root);
    reportsRoot = join(root, 'reports');
    if (!existsSync(trackerPath)) {
      console.error(`No tracker at ${trackerPath}. Evaluate a role first.`);
      process.exitCode = 1;
      return;
    }
    trackerText = readFileSync(trackerPath, 'utf-8');
    const statuses = statusArg ? statusArg.slice('--status='.length).split(',') : DEFAULT_TRACKER_STATUSES;
    const { targets, noUrl } = trackerLivenessTargets(trackerText, { statuses, reportsRoot });
    console.log(`Tracker rows with status ${statuses.join(' or ')}: ${targets.length} with a posting URL${noUrl.length ? `, ${noUrl.length} without (${noUrl.map((n) => `#${n}`).join(' ')})` : ''}`);
    for (const t of targets) labels.set(t.url, `#${t.num} ${t.company} · ${t.role} (${t.status})`);
    urls = targets.map((t) => t.url);
  } else if (positional[0] === '--file') {
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
    const launched = await chromium.launch({ headless: true });
    try {
      page = await newLivenessPage(launched);
      headed = noFallback ? null : createHeadedPageProvider(chromium);
    } catch (err) {
      // Never leave a launched process behind when setup fails half way.
      await launched.close().catch(() => {});
      throw err;
    }
    browser = launched;
  }

  let active = 0, expired = 0, uncertain = 0, viaApi = 0;
  const verdicts = [];

  // Sequential — project rule: never Playwright in parallel
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    let result, reason, code, usedBrowser = false;

    // Rung 1: zero-token ATS API check. A conclusive active/expired wins; otherwise fall through.
    const api = await checkLivenessViaApi(url);
    if (api) {
      ({ result, reason, code } = api);
      viaApi++;
    } else {
      // Rung 2: Playwright — handles non-ATS pages and inconclusive API results.
      // A browser that will not launch (missing binaries after a Playwright
      // update, no display) must not end the batch: every URL after it would
      // lose its verdict, including API-checkable ATS URLs that never needed
      // the browser. Report the URLs that needed it as uncertain with the
      // install hint and keep going; the exit code still reflects that they
      // were not confirmed.
      try {
        await ensureBrowser();
        const getHeadedPage = headed ? () => headed.get() : undefined;
        ({ result, reason, code } = await checkUrlLivenessWithFallback(page, url, { getHeadedPage }));
        usedBrowser = true;
      } catch (err) {
        result = 'uncertain';
        code = 'browser_unavailable';
        reason = `browser unavailable (${String(err?.message ?? err).split('\n')[0]}); run \`npx playwright install\` and re-run`;
      }
    }

    const icon = { active: '✅', expired: '❌', uncertain: '⚠️' }[result];
    console.log(`${icon} ${result.padEnd(10)} ${api ? '(api) ' : '      '}${labels.has(url) ? `${labels.get(url)}  ` : ''}${url}`);
    if (result !== 'active') console.log(`           ${reason}`);
    if (result === 'active') active++;
    else if (result === 'expired') expired++;
    else uncertain++;
    verdicts.push({ url, result, code });

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

  if (discardExpired) {
    const expiredUrls = verdicts.filter((v) => v.result === 'expired').map((v) => v.url);
    const planned = planExpiredDiscards(trackerText, expiredUrls, {
      statuses: DEFAULT_DISCARD_STATUSES,
      reportsRoot,
    });
    const note = postingClosedNote(localToday());
    if (planned.length === 0) {
      console.log('\nDiscard expired: no Evaluated rows matched an expired posting.');
    } else {
      const mode = applyDiscards ? 'apply' : 'dry-run';
      console.log(`\nDiscard expired (${mode}): ${planned.length} Evaluated row(s) → Discarded`);
      const results = discardExpiredRows(planned, { apply: applyDiscards, note, trackerPath, reportsRoot });
      for (const r of results) {
        if (r.skipped) {
          console.log(`  · #${r.num} ${r.company} · ${r.role} — skipped, ${r.skipped}`);
          continue;
        }
        if (r.error) {
          console.log(`  ❌ #${r.num} ${r.company} · ${r.role} — ${r.error}`);
          process.exitCode = 1;
          continue;
        }
        const verb = r.dryRun ? 'would discard' : (r.changed ? 'discarded' : 'already Discarded');
        console.log(`  ${r.dryRun ? '·' : '✅'} #${r.num} ${r.company} · ${r.role} — ${verb} (${note})`);
      }
      if (!applyDiscards) {
        console.log('Re-run with --apply to write. Uncertain and Applied rows are left alone.');
      }
    }
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
