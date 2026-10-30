#!/usr/bin/env node

/**
 * scan-hn.mjs — Hacker News scanner with Optional AI Enhancement.
 * Following the "Zero-Keys" architecture: 
 * 1. Deterministic fetch via HN Provider API.
 * 2. Optional AI-layer if GEMINI_API_KEY is present.
 * 3. Fallback to keyword-matching if no key is present.
 */

try {
  const { config } = await import('dotenv');
  config(); 
} catch (e) {}

import { readFileSync, existsSync } from 'fs';
import { loadYaml } from './lib/yaml-document.mjs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { appendToPipeline, appendToScanHistory, PORTALS_PATH } from './scan.mjs';
import { buildTitleFilter } from './title-keywords.mjs';
import { createAdmissionGate, formatSkipCounts } from './lib/admission-gate.mjs';
import { localToday } from './lib/local-today.mjs';

// Import the deterministic provider
import hnProvider from './providers/hackernews.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { printScanSummaryHeader } from './lib/scan-summary-marker.mjs';
import { validateFlags } from './lib/cli-flags.mjs';

const KNOWN_FLAGS = ['--help', '-h'];
const USAGE = `Usage:
  node scan-hn.mjs                  # scan the latest "Ask HN: Who is hiring?" thread

Fetches the newest hiring thread from Hacker News and keeps the postings whose
header line matches hn_hiring.keywords in portals.yml (default: "Software
Engineer"). title_filter.negative, location_filter and data/blacklist.md apply
as they do in scan.mjs. With GEMINI_API_KEY set, Gemini extracts the company,
title and location of each matching posting. New offers are appended to
data/pipeline.md and to the scan history.

Flags:
  --help, -h                        # show this help and exit`;

// ── Configuration ────────────────────────────────────────────────────
// Imported from scan.mjs so it honors CAREER_OPS_PORTALS and the data root (#3510).

function loadPortals() {
  if (!existsSync(PORTALS_PATH)) return {};
  try {
    return loadYaml(readFileSync(PORTALS_PATH, 'utf-8')) || {};
  } catch (err) {
    // Same message and exit as scan.mjs. Swallowing this ran the scan on the
    // default keyword, so a user who set hn_hiring.keywords got postings they
    // never asked for in data/pipeline.md and nothing saying why (#4921).
    console.error(`Error: failed to parse ${PORTALS_PATH}: ${err.message}`);
    process.exit(1);
  }
}

function loadKeywords(portals) {
  const keywords = portals?.hn_hiring?.keywords;
  // One keyword written without list brackets (`keywords: Platform Engineer`)
  // is a YAML scalar. buildTitleFilter reads only a list and drops anything
  // else, so the scanner's only positive filter was gone and every HN post
  // matched. This is scan-hn's own key, with no validator warning behind it
  // (title_filter's bare-string case gets one in validate-portals), so the
  // obvious reading is taken: one keyword.
  if (typeof keywords === 'string' && keywords.trim()) return [keywords];
  return keywords || ["Software Engineer"];
}

// hn_hiring.keywords is this scanner's positive list: a post's header line
// ("Company | Role | Location | URL") is not an ATS title, so title_filter's
// positives would not fit it. The user's title_filter negatives still apply,
// through the same compiled matcher scan.mjs uses (word boundaries for short
// acronyms, `word:` prefixes, accent folding), not a substring test (#5478).
export function buildHnTitleFilter(keywords, titleFilter = {}) {
  return buildTitleFilter({ positive: keywords, negative: titleFilter?.negative });
}

// extractWithAI's placeholder for "the post names no location". It is not a
// location, so the location filter must not judge it.
const UNKNOWN_LOCATION = 'Remote/Unknown';

// ── AI Extraction Layer ─────────────────────────────────────────
export async function extractWithAI(rawText, model) {
  const prompt = `--- BEGIN UNTRUSTED DATA ---\n${rawText.substring(0, 2000)}\n--- END UNTRUSTED DATA ---`;
  // A failed API call is not a non-match, so it is not caught here: an invalid
  // key, an exhausted quota or a retired model must reach the caller, which
  // counts it. Returning null for it made every job look like a non-match and
  // the run end with "New offers: 0" and exit 0.
  const result = await model.generateContent(prompt);
  try {
    const response = result.response.text();
    const clean = response.replace(/```yaml|```/g, '').trim();

    let parsed;
    try {
      parsed = loadYaml(clean);
    } catch {
      return null; // Always return null on parse errors
    }

    if (!parsed || typeof parsed !== 'object') return null;
    return {
      company: (parsed.company || parsed.COMPANY || '').trim(),
      title: (parsed.title || parsed.TITLE || '').trim(),
      location: (parsed.location || parsed.LOCATION || 'Remote/Unknown').trim()
    };
  } catch {
    return null;
  }
}

// ── Main Logic ───────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  const portals = loadPortals();
  const myKeywords = loadKeywords(portals);
  // One gate for both branches: the seen set (normalized URLs), the blacklist,
  // the keywords and title_filter negatives, and location_filter. The AI branch
  // used to admit every post Gemini could extract, because the keywords only
  // appeared in its prompt (#5478).
  const gate = createAdmissionGate({
    config: portals,
    titleFilter: buildHnTitleFilter(myKeywords, portals.title_filter),
  });

  console.log(`🔍 Fetching latest HN Hiring data...`);
  
  const ctx = { fetchJson: async (url) => (await fetch(url)).json() };
  const rawJobs = await hnProvider.fetch({ name: 'HN' }, ctx);

  const newOffers = [];
  let aiCalls = 0;
  let aiFailures = 0;
  let firstAiError = '';

  // STEP 2: The Architecture Branch
  if (apiKey) {
    console.log(`✨ AI Key detected. Processing with Gemini...`);
    // Same default as gemini-eval.mjs. gemini-1.5-flash is shut down and every
    // request to it returns 404.
    const modelName = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: `Extract job data. Match: [${myKeywords.join(', ')}]. Format: YAML (company, title, location).`,
    });

    for (const job of rawJobs) {
      // Through check(), not a bare continue, so the summary counts it as in
      // the no-key branch.
      if (gate.isSeen(job)) { gate.check(job); continue; }
      // The keywords decide before Gemini is paid to read the post. A post
      // whose header names none of them is recorded as a title skip here.
      if (!gate.titleFilter(job.title)) { gate.check(job); continue; }
      
      aiCalls++;
      let extracted;
      try {
        extracted = await extractWithAI(job.title + " " + (job.text || ""), model);
      } catch (err) {
        aiFailures++;
        if (!firstAiError) firstAiError = `${modelName}: ${err?.message || err}`;
        gate.markSeen(job);
        continue;
      }
      if (!extracted || !extracted.company || !extracted.title) { gate.markSeen(job); continue; }
      // The provider's own postedAt (the comment's created_at), never the scan
      // time: scan-history records it as posted_at, and a guessed date is
      // worse than an absent one (modes/oferta.md).
      const offer = { ...job, ...extracted, source: 'hn-hiring', postedAt: job.postedAt };
      // The blacklist and location filter judge what Gemini extracted; the
      // title filter reads the header line the keywords already matched.
      const judged = extracted.location === UNKNOWN_LOCATION ? { ...offer, location: job.location || '' } : offer;
      if (gate.check(judged, { titleText: job.title })) continue;
      newOffers.push(offer);
      console.log(`  ✅ AI Match: ${extracted.company}`);
    }
  } else {
    // STEP 3: Fallback Mode (Deterministic/No-Key)
    console.log(`⚠️ No AI key. Using keyword filtering mode...`);
    for (const job of rawJobs) {
      if (gate.check(job)) continue;
      newOffers.push({ ...job, source: 'hn-hiring' });
      console.log(`  ✅ Match: ${job.company}`);
    }
  }

  if (newOffers.length > 0) {
    await appendToPipeline(newOffers);
    await appendToScanHistory(newOffers, localToday(), 'added');
  }

  // Printed on every run, including the zero-match one. This scanner used to
  // end in silence when nothing matched, which reads identically to a run that
  // died at the fetch — the summary is what tells those apart (#3560).
  printScanSummaryHeader('HN Scan', localToday());
  console.log(`Postings fetched:   ${rawJobs.length}`);
  console.log(`New offers:         ${newOffers.length}`);
  const skipped = formatSkipCounts(gate.counts);
  if (skipped) console.log(`Skipped:            ${skipped}`);
  if (aiFailures > 0) {
    console.log(`AI errors:          ${aiFailures} of ${aiCalls}`);
    console.warn(`\n⚠️  ${aiFailures} of ${aiCalls} Gemini extractions failed, so those postings were not checked. First error: ${firstAiError}`);
    // Every call failed: the AI pass did not run at all, so a zero here is
    // not a result. Exit non-zero so a scheduled run does not report success.
    if (aiFailures === aiCalls) process.exitCode = 1;
  }
  if (newOffers.length > 0) console.log(`\n🎉 Success: ${newOffers.length} offers added.`);
}

if (isMainModule(import.meta.url)) {
  // Before main(): --help must not start a live scan, and a flag this script
  // does not have (a --dry-run it never had) must fail rather than fall
  // through to one. Inside the main-module guard because
  // tests/hn-scanner.test.mjs imports this module.
  validateFlags(process.argv.slice(2), KNOWN_FLAGS, USAGE);
  main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
}