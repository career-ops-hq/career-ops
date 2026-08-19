#!/usr/bin/env node

/**
 * scan-hn.mjs — Hacker News AI-powered scanner.
 * 
 * This script identifies the latest "Who is Hiring" thread on HN and uses 
 * Google Gemini to extract structured job data from unstructured comments.
 */

// ── ENVIRONMENT SETUP ────────────────────────────────────────────────
// This block ensures your .env variables are loaded into process.env
try {
  const { config } = await import('dotenv');
  config(); 
} catch (e) {
  // If dotenv isn't installed, it will fall back to system environment variables
}

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import * as yaml from 'js-yaml';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { appendToPipeline, appendToScanHistory, loadSeenUrls } from './scan.mjs';

// ── Configuration ────────────────────────────────────────────────────

const PORTALS_PATH  = 'portals.yml';
const apiKey        = process.env.GEMINI_API_KEY;
const modelName     = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

if (!apiKey) {
  console.error('❌ Error: GEMINI_API_KEY is not set in .env');
  console.error('Please add GEMINI_API_KEY=your_key_here to your .env file.');
  process.exit(1);
}

// ── Load User Keywords ───────────────────────────────────────────────

let configObj = {};
if (existsSync(PORTALS_PATH)) {
  configObj = yaml.load(readFileSync(PORTALS_PATH, 'utf-8')) || {};
}
// Pulls custom keywords from portals.yml if they exist
const myKeywords = configObj.hn_hiring?.keywords || ["Software Engineer"];

// ── AI Setup ─────────────────────────────────────────────────────────

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({
  model: modelName,
  systemInstruction: `Extract job data from Hacker News comments.
  Filter: Only return jobs matching: [${myKeywords.join(', ')}].
  Format: Return ONLY YAML with keys: company, title, location.
  If no match or not a job, return the string 'null'.`,
  generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
});

// ── Main Logic ───────────────────────────────────────────────────────

async function main() {
  const { seen } = loadSeenUrls();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log(`🔍 Accessing Hacker News (Model: ${modelName})...`);
    await page.goto('https://news.ycombinator.com/submitted?id=whoishiring', { waitUntil: 'networkidle' });

    // Find the latest "Who is Hiring" thread
    const thread = await page.evaluate(() => {
      const link = Array.from(document.querySelectorAll('.titleline a'))
        .find(a => a.innerText.includes('Who is hiring'));
      return link ? { url: link.href, title: link.innerText } : null;
    });

    if (!thread) throw new Error("Could not find recent hiring thread.");
    console.log(`🧵 Opening: ${thread.title}`);
    
    await page.goto(thread.url, { waitUntil: 'networkidle' });

    // Capture Comment Text + Unique ID for bulletproof deduplication
    const jobPosts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('tr.comtr')).slice(0, 20).map(tr => ({
        id: tr.getAttribute('id'),
        text: tr.querySelector('.commtext')?.innerText || ''
      }));
    });

    const newOffers = [];

    for (const post of jobPosts) {
      if (!post.text) continue;
      
      // Use the specific HN comment ID for the dedup URL
      const hnUrl = `https://news.ycombinator.com/item?id=${post.id}`;
      
      // seen.has handles the normalization internally via scan.mjs
      if (seen.has(hnUrl)) {
        continue; 
      }

      process.stdout.write(`  AI Analyzing post ${post.id}... `);
      const extracted = await extractWithAI(post.text);

      if (extracted && extracted.company) {
        const canonical = {
          url: hnUrl,
          company: extracted.company,
          title: extracted.title,
          location: extracted.location || 'Remote/Unknown',
          source: 'hn-hiring',
          postedAt: Date.now()
        };
        newOffers.push(canonical);
        seen.add(hnUrl);
        console.log(`✅ ${extracted.company}`);
      } else {
        console.log(`❌ No Match`);
      }
    }

    if (newOffers.length > 0) {
      // These functions are imported from scan.mjs and handle file locking
      await appendToPipeline(newOffers);
      await appendToScanHistory(newOffers, new Date().toISOString().slice(0, 10), 'added');
      console.log(`\n🎉 Success: ${newOffers.length} offers added to pipeline.`);
    }

  } finally {
    await browser.close();
  }
}

 export async function extractWithAI(text) {
  try {
    const result = await model.generateContent(text.substring(0, 2000));
    const response = result.response.text();
    // Strip markdown formatting if AI provides it
    const clean = response.replace(/```yaml|```/g, '').trim();
    if (clean.toLowerCase() === 'null') return null;
    return yaml.load(clean);
  } catch {
    return null;
  }
}

main().catch(err => console.error("Fatal:", err));