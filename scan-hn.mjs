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
import { appendToPipeline, appendToScanHistory, loadSeenUrls } from './scan.mjs';
import { localToday } from './lib/local-today.mjs';

// Import the deterministic provider
import hnProvider from './providers/hackernews.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

// ── Configuration ────────────────────────────────────────────────────
const PORTALS_PATH = 'portals.yml';

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

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  const myKeywords = loadKeywords();
  const { seen } = loadSeenUrls();

  console.log(`🔍 Fetching latest HN Hiring data...`);
  
  const ctx = { fetchJson: async (url) => (await fetch(url)).json() };
  const rawJobs = await hnProvider.fetch({ name: 'HN' }, ctx);

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
      if (seen.has(job.url)) continue;
      
      const extracted = await extractWithAI(job.title + " " + (job.text || ""), model);
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
    console.log(`\n🎉 Success: ${newOffers.length} offers added.`);
  }
}

if (isMainModule(import.meta.url)) {
  main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
}