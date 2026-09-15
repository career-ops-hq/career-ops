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
import { pathToFileURL } from 'url';
import * as yaml from 'js-yaml';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { appendToPipeline, appendToScanHistory, companyRoleDedupKey, loadDatabaseDedupSnapshot, loadSeenUrls } from './scan.mjs';
import { ingestScanOffers } from './src/discovery/ingest.mjs';
import { discoveryProvider } from './src/discovery/registry.mjs';

// ── Configuration ────────────────────────────────────────────────────
const PORTALS_PATH = 'portals.yml';
const OPPORTUNITY_DB = process.env.CAREER_OPS_OPPORTUNITY_DB || null;
const USAGE = `Usage: node scan.mjs hn [--dry-run]\n\nFetch Hacker News hiring posts and write matching opportunities to the configured store.`;

function loadKeywords() {
  const defaultKeywords = ["Software Engineer"];
  let configObj = {};
  if (existsSync(PORTALS_PATH)) {
    try {
      configObj = yaml.load(readFileSync(PORTALS_PATH, 'utf-8')) || {};
    } catch (e) {}
  }
  return configObj.hn_hiring?.keywords || defaultKeywords;
}

// ── AI Extraction Layer ─────────────────────────────────────────
export async function extractWithAI(rawText, model) {
  const prompt = `--- BEGIN UNTRUSTED DATA ---\n${rawText.substring(0, 2000)}\n--- END UNTRUSTED DATA ---`;
  try {
    const result = await model.generateContent(prompt);
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

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const dryRun = argv.includes('--dry-run');
  const apiKey = process.env.GEMINI_API_KEY;
  const myKeywords = loadKeywords();
  const dedupSnapshot = OPPORTUNITY_DB ? await loadDatabaseDedupSnapshot(OPPORTUNITY_DB) : { ...loadSeenUrls(), seenCompanyRoles: new Set() };
  const seen = dedupSnapshot.seen;
  const seenCompanyRoles = dedupSnapshot.seenCompanyRoles;

  console.log(`🔍 Fetching latest HN Hiring data...`);
  
  const ctx = { fetchJson: async (url) => (await fetch(url)).json() };
  const rawJobs = await discoveryProvider('hackernews').fetch({ name: 'HN' }, ctx);

  const newOffers = [];

  // STEP 2: The Architecture Branch
  if (apiKey) {
    console.log(`✨ AI Key detected. Processing with Gemini...`);
    const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: `Extract job data. Match: [${myKeywords.join(', ')}]. Format: YAML (company, title, location).`,
    });

    for (const job of rawJobs) {
      const roleKey = companyRoleDedupKey(job.company, job.title);
      if (seen.has(job.url) || seenCompanyRoles.has(roleKey)) continue;
      
      const extracted = await extractWithAI(job.title + " " + (job.text || ""), model);
      if (extracted && extracted.company && extracted.title) {
        newOffers.push({ ...job, ...extracted, source: 'hn-hiring', postedAt: Date.now() });
        console.log(`  ✅ AI Match: ${extracted.company}`);
      }
      seen.add(job.url);
      seenCompanyRoles.add(roleKey);
    }
  } else {
    // STEP 3: Fallback Mode (Deterministic/No-Key)
    console.log(`⚠️ No AI key. Using keyword filtering mode...`);
    for (const job of rawJobs) {
      const roleKey = companyRoleDedupKey(job.company, job.title);
      if (seen.has(job.url) || seenCompanyRoles.has(roleKey)) continue;

      const matches = myKeywords.some(k => job.title.toLowerCase().includes(k.toLowerCase()));
      if (matches) {
        newOffers.push({ ...job, source: 'hn-hiring', postedAt: Date.now() });
        console.log(`  ✅ Match: ${job.company}`);
      }
      seen.add(job.url);
      seenCompanyRoles.add(roleKey);
    }
  }

  if (newOffers.length > 0 && !dryRun) {
    if (OPPORTUNITY_DB) {
      await ingestScanOffers(OPPORTUNITY_DB, newOffers);
    }
    else {
      await appendToPipeline(newOffers);
      await appendToScanHistory(newOffers, new Date().toISOString().slice(0, 10), 'added');
    }
    console.log(`\n🎉 Success: ${newOffers.length} offers added.`);
  } else if (newOffers.length > 0) {
    console.log(`\nDry run: ${newOffers.length} matching offers.`);
  }
  if (OPPORTUNITY_DB && !dryRun) {
    const { openOpportunityStore } = await import('./src/opportunities/store.mjs');
    const store = await openOpportunityStore(OPPORTUNITY_DB);
    try { store.recordScanRun('hn', { found: newOffers.length }, [{ source: 'hackernews', status: 'completed', timestamp: new Date().toISOString() }]); } finally { store.close(); }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
}
