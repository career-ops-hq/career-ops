#!/usr/bin/env node
/**
 * fetch-jd.mjs — read a job description from its ATS's public API instead of
 * the rendered page (#2582).
 *
 * A headless caller that wants a JD today has one option: fetch the posting
 * page and strip HTML. That is 10-30k tokens of nav and markup on a
 * server-rendered board, and on a JS-rendered one (Ashby, Greenhouse's
 * embedded boards) it returns an unrendered shell — correctly detected as thin
 * and discarded — so the caller falls through to WebFetch, which hits the same
 * shell and fails the same way. Meanwhile the ATS's own public JSON endpoint,
 * the one liveness checks already use, ships the full JD body for free.
 *
 *   node fetch-jd.mjs <url>
 *
 * JD text on stdout, exit 0, when a known ATS answers with real content.
 * Exit 3 with `CLOSED_POSTING <evidence>` on stdout when the page itself says the
 * posting is closed: a JobPosting past its validThrough date, or closure text
 * in the visible page.
 * Exit 1 with empty stdout and no stderr noise otherwise — a miss is the
 * expected "fall back to the browser path" case, not an error condition, and
 * a visible miss is the whole point: never a fabricated JD.
 *
 * Coverage is JD_TEXT_API_ATS (liveness-api.mjs), including company careers
 * pages that carry only a Greenhouse `?gh_jid=`, and canonical/share-link
 * Workable postings (description, requirements and benefits).
 * When no API covers the host, the page's own schema.org JobPosting (JSON-LD)
 * is read next (lib/jd-page-fetch.mjs, behind the same egress guard). Phenom and
 * bespoke career sites render the JD from script data, so their visible HTML is
 * a shell that any text conversion, WebFetch included, reports as empty.
 * Every API fetch runs through fetchJdViaKnownApi() in browser-extract.mjs
 * — the same dispatch its own `jd` mode uses — so this script and the
 * interactive extractor cannot drift on which ATS is API-fetchable.
 */

import { fetchJdViaKnownApi } from './browser-extract.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { fetchJdFromPage, markCappedAtsText } from './lib/jd-page-fetch.mjs';

const TEXT_CAP = 20_000; // a batch report reads the whole JD; no token-budget reason to cap tighter
const TIMEOUT_MS = 15_000;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  node fetch-jd.mjs <url>
  node fetch-jd.mjs --help

Options:
  --help, -h  Print this usage block and exit`);
    process.exit(0);
  }

  const url = args[0];

  if (!url) {
    console.error('usage: node fetch-jd.mjs <url>');
    process.exit(1);
  }

  // Tier 1: the ATS's public API. Tier 2: the page's own JSON-LD JobPosting, for
  // template-driven boards no API covers (Phenom, bespoke sites) whose visible
  // HTML carries no JD at all.
  const result = (await fetchJdViaKnownApi(url, TEXT_CAP, TIMEOUT_MS))
    ?? (await fetchJdFromPage(url, TEXT_CAP, TIMEOUT_MS));
  // No stderr, by design: the caller's browser/WebFetch fallback is the
  // intended next step, and warning on every non-covered host would make the
  // normal path look broken.
  // Signal the miss via exitCode, not process.exit(1). On Windows, Node 24
  // aborts when process.exit() runs right after a request (nodejs/node#56645):
  // it prints a libuv assertion and exits with a crash code instead of 1.
  // Measured 2026-11-04 on Node 24.14.1: misses on Greenhouse, Workable,
  // SmartRecruiters and Workday aborted 4 times out of 4. Returning lets the
  // process exit 1 once the event loop drains, right after the answer.
  if (!result) {
    process.exitCode = 1;
    return;
  }

  // The posting's own data says it is closed: the page's JobPosting, its visible
  // text, or an ATS API flag such as Ashby's isListed: false. Say so with a
  // distinct exit code instead of a plain miss, so a caller does not fall back
  // to a fetch that could return the JD from the visible page and score it.
  if (result.closed) {
    process.stdout.write(`CLOSED_POSTING ${result.evidence}`);
    process.exitCode = 3;
    return;
  }

  const header = result.title ? `${result.title}\n\n` : '';
  process.stdout.write(header + markCappedAtsText(result.text, TEXT_CAP));
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(`fetch-jd: unexpected error — ${err?.message || err}`);
    process.exitCode = 1; // not process.exit(1), for the reason given at the miss
  });
}
