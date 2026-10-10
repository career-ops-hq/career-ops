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
import * as yaml from 'js-yaml';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { appendToPipeline, appendToScanHistory, loadSeenUrls, PORTALS_PATH } from './scan.mjs';
import { localToday } from './lib/local-today.mjs';

// Import the deterministic provider
import hnProvider from './providers/hackernews.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { printScanSummaryHeader } from './lib/scan-summary-marker.mjs';
import { validateFlags } from './lib/cli-flags.mjs';

const KNOWN_FLAGS = ['--help', '-h'];
const USAGE = `Usage:
  node scan-hn.mjs                  # scan the latest "Ask HN: Who is hiring?" thread

Fetches the newest hiring thread from Hacker News and keeps the postings that
match hn_hiring.keywords in portals.yml (default: "Software Engineer"). With
GEMINI_API_KEY set, Gemini extracts each posting instead of the keyword match.
New offers are appended to data/pipeline.md and to the scan history.

Flags:
  --help, -h                        # show this help and exit`;

// ── Configuration ────────────────────────────────────────────────────
// Imported from scan.mjs so it honors CAREER_OPS_PORTALS and the data root (#3510).

function loadKeywords() {
  const defaultKeywords = ["Software Engineer"];
  if (!existsSync(PORTALS_PATH)) return defaultKeywords;
  let configObj;
  try {
    configObj = yaml.load(readFileSync(PORTALS_PATH, 'utf-8'));
  } catch (err) {
    // Same message and exit as scan.mjs. Swallowing this ran the scan on the
    // default keyword, so a user who set hn_hiring.keywords got postings they
    // never asked for in data/pipeline.md and nothing saying why (#4921).
    console.error(`Error: failed to parse ${PORTALS_PATH}: ${err.message}`);
    process.exit(1);
  }
  return configObj?.hn_hiring?.keywords || defaultKeywords;
}

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
      parsed = yaml.load(clean);
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
  const myKeywords = loadKeywords();
  const { seen } = loadSeenUrls();

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
      if (seen.has(job.url)) continue;
      
      aiCalls++;
      let extracted;
      try {
        extracted = await extractWithAI(job.title + " " + (job.text || ""), model);
      } catch (err) {
        aiFailures++;
        if (!firstAiError) firstAiError = `${modelName}: ${err?.message || err}`;
        seen.add(job.url);
        continue;
      }
      if (extracted && extracted.company && extracted.title) {
        newOffers.push({ ...job, ...extracted, source: 'hn-hiring', postedAt: Date.now() });
        console.log(`  ✅ AI Match: ${extracted.company}`);
      }
      seen.add(job.url);
    }
  } else {
    // STEP 3: Fallback Mode (Deterministic/No-Key)
    console.log(`⚠️ No AI key. Using keyword filtering mode...`);
    for (const job of rawJobs) {
      if (seen.has(job.url)) continue;

      const matches = myKeywords.some(k => job.title.toLowerCase().includes(k.toLowerCase()));
      if (matches) {
        newOffers.push({ ...job, source: 'hn-hiring', postedAt: Date.now() });
        console.log(`  ✅ Match: ${job.company}`);
      }
      seen.add(job.url);
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