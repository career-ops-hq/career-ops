#!/usr/bin/env node
/**
 * jd-rescue.mjs — recover a job description from a page whose *visible* text is
 * too thin to use, before the batch runner spends a worker on it.
 *
 * Usage:  node batch/jd-rescue.mjs <url> <raw-html-file> <out-file> [stripped-words]
 * Output: "<words>\t<method>" on stdout; exit 0 on success, 1 on failure.
 *         On success <out-file> is overwritten with clean plain text.
 *
 * WHY THIS EXISTS
 *
 * The runner strips <script> and <style> blocks before counting visible words,
 * so a JS-rendered board scores near zero and the JD file is emptied — the
 * worker is then told to WebFetch, which hits the same wall from the same kind
 * of address and fails. Observed in one batch run: 14 of 24 offers
 * (58% of the run's spend) died as "JD file empty/boilerplate; WebFetch
 * returned only title/company", and the failures clustered by ATS vendor, not
 * randomly — 6/7 Ashby (jobs.ashbyhq.com/acme/...) and 6/9 Greenhouse-embedded
 * (careers.example.com/job?gh_jid=...), while 7/7 plain boards.greenhouse.io
 * postings in the same run succeeded.
 *
 * The decisive finding: for those pages the description was *already in the
 * bytes curl downloaded*, inside the very <script> blocks the strip discards.
 * The same Ashby posting that stripped down to 13 words ("Data Scientist @ Acme
 * You need to enable JavaScript to run this app.") carries 898 words of clean
 * JD in its application/ld+json JobPosting. Nothing needs to be re-fetched and
 * no browser needs to run — the data just has to be read out of the right place.
 *
 * Strategies run in order, cheapest first. 1 and 3 are pure offline parsing of
 * bytes already on disk; only 2 makes a network request, a single
 * unauthenticated JSON GET to the ATS's public API. All three are zero-LLM-token.
 *
 * WHEN A RESCUE IS ACCEPTED
 *
 * A thin page is not the only failure shape, and the word count alone does not
 * separate them. The embed pages stripped to 126 words — above the
 * runner's 80-word floor — so they were never flagged as thin; the worker was
 * handed 126 words of the company's own page chrome and correctly reported that
 * it had no job description. What actually distinguishes those pages is not how
 * much text they have but *where the JD lives*: the posting is served from
 * the ATS's own API, a different origin than the document curl fetched,
 * so no amount of parsing that document can produce it.
 *
 * Hence two accept conditions rather than one:
 *   - the stripped page is thin (< minWords), or
 *   - the rescued text is longer than the stripped page, meaning the visible
 *     text was demonstrably missing content the structured source has.
 * A structured JobPosting is high-precision, so "longer" here means "more JD",
 * not "more navigation". Where the stripped page already wins — a canonical
 * Greenhouse board posting renders its own JD server-side — the rescue is
 * rejected and the existing text is kept untouched, so pages that work today
 * cannot regress.
 */

import fs from 'node:fs';
import { isMainModule } from '../lib/is-main-module.mjs';
import { fromLdJson, fromEmbeddedDescription, ldJsonBlocks, wordCount } from '../lib/jd-parse.mjs';

// Re-exported so existing importers of this module keep working.
export { fromLdJson, fromEmbeddedDescription, ldJsonBlocks, wordCount };

/* ---------------------------------------------------------------- strategy 2
 * The ATS's own public API, through upstream's fetchJdViaKnownApi().
 *
 * A company that embeds Greenhouse on its own careers domain
 * (careers.example.com/job?gh_jid=1234567) serves a host page with no JD text
 * in it, and the posting lives on another origin, so no amount of parsing the
 * downloaded document can produce it. browser-extract.mjs already knows how to
 * ask the right API for every ATS in JD_TEXT_API_ATS (the same dispatch
 * fetch-jd.mjs and the `jd` mode use), so this strategy calls it rather than
 * carrying a second copy of the per-ATS code. A URL it does not recognise
 * answers null without any network request.
 */
async function fromKnownApi(url) {
  try {
    const { fetchJdViaKnownApi } = await import('../browser-extract.mjs');
    const result = await fetchJdViaKnownApi(url, 20_000, 15_000);
    if (!result?.text) return null;
    // A delisted/closed posting is not a JD to rescue: report closure so the chain
    // stops and the runner skips the offer instead of scoring other text from the page.
    if (result.closed) return { closed: true, evidence: result.evidence };
    const text = result.title ? `${result.title}\n\n${result.text}` : result.text;
    return { text, method: `ats-api:${result.ats}` };
  } catch {
    return null;
  }
}

/**
 * Run the rescue strategies in order. A closed ATS posting ends the chain at once
 * (`{ closed, evidence }`), so text another source holds for the same page is never
 * rescued into a JD for a role the board has delisted. Otherwise the first candidate
 * that clears the word floor, and (for a non-thin page) beats the page's own text, wins.
 * @param {Array<() => Promise<any>|any>} runners
 */
export async function runRescueChain(runners, { minWords, strippedWords, thin }) {
  let found = null;
  let thinFound = null;
  let notBetter = null;
  for (const run of runners) {
    const candidate = await run();
    if (!candidate) continue;
    if (candidate.closed) return { closed: true, evidence: candidate.evidence };
    const w = wordCount(candidate.text);
    if (w < minWords) { thinFound ??= candidate; continue; }
    // Never replace a page that already had more JD than the rescue found.
    if (!thin && w <= strippedWords) { notBetter ??= candidate; continue; }
    found = candidate;
    break;
  }
  return { found, thinFound, notBetter };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  node batch/jd-rescue.mjs <url> <raw-html-file> <out-file> [stripped-words]
  node batch/jd-rescue.mjs --help

Recover a JD from a page's structured data (JSON-LD, ATS API, embedded payload)
when its visible text is too thin. Prints "<words>\\t<method>"; exit 0 on success.

Options:
  --help, -h  Print this usage block and exit`);
    process.exit(0);
  }
  const [url, rawFile, outFile, strippedArg] = args;
  const minWords = Number(process.env.JD_RESCUE_MIN_WORDS || 80);
  const strippedWords = Number.isFinite(Number(strippedArg)) ? Number(strippedArg) : 0;
  const thin = strippedWords < minWords;

  if (!url || !rawFile || !outFile) {
    process.stdout.write('0\tusage\n');
    process.exit(1);
  }

  let html = '';
  try { html = fs.readFileSync(rawFile, 'utf-8'); } catch {
    process.stdout.write('0\tno-raw-file\n');
    process.exit(1);
  }

  const chain = await runRescueChain(
    [() => fromLdJson(html), () => fromKnownApi(url), () => fromEmbeddedDescription(html)],
    { minWords, strippedWords, thin },
  );
  if (chain.closed) {
    // Terminal: exit 3 with the evidence on one line, whatever the other sources hold.
    process.stdout.write(`0\tclosed:${String(chain.evidence ?? '').replace(/\s+/g, ' ').slice(0, 160)}\n`);
    process.exit(3);
  }
  const { found, thinFound, notBetter } = chain;

  if (!found) {
    // A rescue that yields another thin page is not a rescue. Reporting it as
    // one would put the worker back in exactly the position this module exists
    // to avoid, so it is a failure and the caller routes the offer to Playwright.
    if (notBetter) process.stdout.write(`${wordCount(notBetter.text)}\t${notBetter.method}:not-better\n`);
    else if (thinFound) process.stdout.write(`${wordCount(thinFound.text)}\t${thinFound.method}:thin\n`);
    else process.stdout.write('0\tnone\n');
    process.exit(1);
  }

  const words = wordCount(found.text);
  // Write beside the target and rename, so a failed write leaves the existing
  // JD file intact for the fallbacks that follow.
  const tmp = `${outFile}.rescue-${process.pid}`;
  try {
    fs.writeFileSync(tmp, found.text);
    fs.renameSync(tmp, outFile);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw err;
  }
  process.stdout.write(`${words}\t${found.method}\n`);
}

// Importable for fetch-jd.mjs's page tier, so the parsers have one copy. The CLI
// tail runs only when this file is the process entry.
if (isMainModule(import.meta.url)) {
  main().catch(() => {
    process.stdout.write('0\terror\n');
    process.exit(1);
  });
}
