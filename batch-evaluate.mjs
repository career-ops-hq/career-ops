#!/usr/bin/env node

/**
 * batch-evaluate.mjs — Robust batch evaluator using Gemini SDK natively.
 * 
 * Replaces the fragile bash array + CLI agent approach.
 * Features:
 *  - Native Playwright JD extraction
 *  - Native Google Generative AI SDK calls (no subprocess overhead)
 *  - Strict Concurrency limit (p-limit style)
 *  - Exponential Backoff for 429/503 API limits
 *  - Inline updates of data/pipeline.md (marks [ ] as [x])
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';

try {
  const { config } = await import('dotenv');
  config();
} catch {}

import { GoogleGenerativeAI } from '@google/generative-ai';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PATHS = {
  shared:      join(ROOT, 'modes', '_shared.md'),
  oferta:      join(ROOT, 'modes', 'oferta.md'),
  cv:          join(ROOT, 'cv.md'),
  profile:     join(ROOT, 'modes', '_profile.md'),
  profileYml:  join(ROOT, 'config', 'profile.yml'),
  reports:     join(ROOT, 'reports'),
  trackerAdditions: join(ROOT, 'batch', 'tracker-additions'),
  pipeline:    join(ROOT, 'data', 'pipeline.md')
};

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("❌ GEMINI_API_KEY not found in .env");
  process.exit(1);
}

const modelName = 'gemini-2.5-flash-lite';
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({
  model: modelName,
  generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
});

// --- File Helpers ---
function readFile(path, label) {
  if (!existsSync(path)) return `[${label} not found — skipping]`;
  return readFileSync(path, 'utf-8').trim();
}

function nextReportNumber() { // fix(gemini): uses atomic execFileSync
  return execFileSync('node', [join(ROOT, 'reserve-report-num.mjs')], { encoding: 'utf-8' }).trim();
}

function slugifyCompany(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function tsvSafe(value) {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

function normalizedTrackerScore(value) { // fix(gemini): added NaN and robust parsing
  const clean = tsvSafe(value);
  if (!clean || clean === '?' || /n\/?a/i.test(clean) || isNaN(parseFloat(clean))) return 'N/A';
  return /\/5$/i.test(clean) ? clean : parseFloat(clean) + '/5';
}

// Load Context
console.log('📂 Loading context files...');
const sharedContext  = readFile(PATHS.shared, '_shared.md');
const ofertaLogic    = readFile(PATHS.oferta, 'oferta.md');
const cvContent      = readFile(PATHS.cv, 'cv.md');
const profileContent = readFile(PATHS.profile, '_profile.md');
const profileYml     = readFile(PATHS.profileYml, 'profile.yml');

const systemPromptTemplate = `You are career-ops, an AI-powered job search assistant.
You evaluate job offers against the user's CV using a structured A-G scoring system.

═══════════════════════════════════════════════════════
SYSTEM CONTEXT (_shared.md)
═══════════════════════════════════════════════════════
${sharedContext}

═══════════════════════════════════════════════════════
EVALUATION MODE (oferta.md)
═══════════════════════════════════════════════════════
${ofertaLogic}

═══════════════════════════════════════════════════════
CANDIDATE RESUME (cv.md)
═══════════════════════════════════════════════════════
${cvContent}

═══════════════════════════════════════════════════════
CANDIDATE PROFILE & TARGETS (config/profile.yml)
═══════════════════════════════════════════════════════
${profileYml}

═══════════════════════════════════════════════════════
USER ARCHETYPES & NARRATIVE (_profile.md)
═══════════════════════════════════════════════════════
${profileContent}

═══════════════════════════════════════════════════════
IMPORTANT OPERATING RULES FOR THIS CLI SESSION
═══════════════════════════════════════════════════════
1. You do NOT have access to WebSearch, Playwright, or file writing tools.
2. Generate Blocks A through G in full, in English.
3. Output a machine-readable summary block in this exact format:

---SCORE_SUMMARY---
COMPANY: <company name>
ROLE: <role title>
SCORE: <global score as decimal, e.g. 3.8>
ARCHETYPE: <detected archetype>
LEGITIMACY: <High Confidence | Proceed with Caution | Suspicious>
---END_SUMMARY---
`;

async function scrapeUrl(browser, url) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000); // wait for dynamic content
    const text = await page.evaluate(() => {
      document.querySelectorAll('script, style, noscript, iframe, svg, img').forEach(s => s.remove());
      return document.body.innerText;
    });
    return text.trim();
  } finally {
    await page.close();
  }
}

async function evaluateWithRetry(jdText, retries = 5) {
  let attempt = 0;
  let delay = 5000;
  while (attempt < retries) {
    try {
      const result = await model.generateContent([
        { text: systemPromptTemplate },
        { text: `\n\nJOB DESCRIPTION TO EVALUATE:\n\n${jdText}` },
      ]);
      return result.response.text();
    } catch (err) {
      attempt++;
      console.error(`⚠️ API Error (attempt ${attempt}/${retries}): ${err.message}`);
      if (attempt >= retries) throw err;
      console.log(`⏳ Waiting ${delay/1000}s before retry...`);
      await new Promise(r => setTimeout(r, delay));
      delay *= 2; // Exponential backoff
    }
  }
}

async function processOffer(browser, line, idx) {
  const match = line.match(/- \[\s*\]\s+(https?:\/\/\S+)(?:\s*\|\s*([^|]+)\s*\|\s*(.+))?/);
  if (!match) return { line, processed: false };

  const url = match[1];
  let companyHint = match[2] ? match[2].trim() : 'Unknown';
  let titleHint = match[3] ? match[3].trim() : 'Unknown';

  console.log(`\n========================================`);
  console.log(`🔄 Processing [${idx}]: ${companyHint} - ${titleHint}`);
  console.log(`🔗 URL: ${url}`);

  try {
    const jdText = await scrapeUrl(browser, url);
    if (!jdText || jdText.length < 100) {
      throw new Error('Extracted text too short (likely blocked or empty)');
    }

    console.log(`🧠 Calling Gemini (${modelName})...`);
    const evaluationText = await evaluateWithRetry(`URL: ${url}\n\n${jdText}`);

    // Parse output
    const summaryMatch = evaluationText.match(/---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/);
    if (!summaryMatch) {
      console.error('Missing SCORE_SUMMARY block from model output:\n' + evaluationText.slice(0, 500));
      throw new Error('Missing SCORE_SUMMARY block from model output');
    }
    
    const block = summaryMatch[1];
    const extract = (key) => {
      const m = block.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'mi'));
      return m ? m[1].trim() : 'unknown';
    };

    const company = extract('COMPANY');
    const role = extract('ROLE');
    const score = extract('SCORE');
    const archetype = extract('ARCHETYPE');
    const legitimacy = extract('LEGITIMACY');

    // Save
    mkdirSync(PATHS.reports, { recursive: true });
    mkdirSync(PATHS.trackerAdditions, { recursive: true });

    const num = nextReportNumber();
    const today = new Date().toISOString().split('T')[0];
    const companySlug = slugifyCompany(company);
    const filename = `${num}-${companySlug}-${today}.md`;
    const reportPath = join(PATHS.reports, filename);

    const reportContent = `# Evaluation: ${company} — ${role}\n
**Date:** ${today}
**URL:** ${url}
**Archetype:** ${archetype}
**Score:** ${score}/5
**Legitimacy:** ${legitimacy}
**PDF:** pending
**Tool:** Gemini (${modelName})\n
---\n
${evaluationText.replace(/---SCORE_SUMMARY---[\s\S]*?---END_SUMMARY---/, '').trim()}\n`;

    writeFileSync(reportPath, reportContent, 'utf-8');

    const trackerPath = join(PATHS.trackerAdditions, `${num}-${companySlug}.tsv`);
    const trackerFields = [
      String(parseInt(num, 10)), today, tsvSafe(company), tsvSafe(role),
      'Evaluated', normalizedTrackerScore(score), '❌', `[${num}](reports/${filename})`,
      'Batch Gemini evaluation'
    ];
    writeFileSync(trackerPath, `${trackerFields.join('\t')}\n`, 'utf-8');

    console.log(`✅ Success: ${company} - ${role} | Score: ${score}/5 | Saved as ${filename}`);
    
    // Mark as checked
    const newLine = line.replace(/- \[\s*\]/, '- [x]');
    return { line: newLine, processed: true };

  } catch (err) {
    console.error(`❌ Failed processing ${url}: ${err.message}`);
    return { line, processed: false }; // Leave unchecked
  }
}

async function main() {
  const limitArg = process.argv.find(a => a.startsWith("--limit="));
  const limitCount = limitArg ? parseInt(limitArg.split("=")[1], 10) : 0;
  
  const concArg = process.argv.find(a => a.startsWith("--concurrency="));
  const CONCURRENCY = concArg ? parseInt(concArg.split("=")[1], 10) : 2;

  if (!existsSync(PATHS.pipeline)) {
    console.log("No pipeline.md found.");
    return;
  }

  const pipelineLines = readFileSync(PATHS.pipeline, 'utf-8').split('\n');
  const pendingIndices = pipelineLines
    .map((l, i) => l.trim().startsWith('- [ ]') ? i : -1)
    .filter(i => i !== -1);

  if (limitCount > 0) {
    pendingIndices.splice(limitCount);
  }
  if (pendingIndices.length === 0) {
    console.log("No pending [-] offers found in pipeline.md.");
    return;
  }

  console.log(`Found ${pendingIndices.length} pending offers.`);
  const browser = await chromium.launch({ headless: true });
  
  // Concurrency queue
  let active = 0;
  let index = 0;
  
  const results = new Map();

  await new Promise((resolve) => {
    function next() {
      if (index >= pendingIndices.length && active === 0) {
        resolve();
        return;
      }
      while (active < CONCURRENCY && index < pendingIndices.length) {
        active++;
        const currentIndex = index++;
        const lineIdx = pendingIndices[currentIndex];
        
        processOffer(browser, pipelineLines[lineIdx], currentIndex + 1)
          .then(res => {
            results.set(lineIdx, res);
          })
          .catch(() => {})
          .finally(() => {
            active--;
            next();
          });
      }
    }
    next();
  });

  await browser.close();

  // Rewrite pipeline.md inline
  for (const [lineIdx, res] of results.entries()) {
    if (res.processed) {
      pipelineLines[lineIdx] = res.line;
    }
  }
  writeFileSync(PATHS.pipeline, pipelineLines.join('\n'), 'utf-8');

  console.log(`\n🎉 Batch processing complete! Merging tracker additions...`);
  try {
    const mergeOutput = execFileSync(process.execPath, [join(ROOT, 'merge-tracker.mjs')], { cwd: ROOT, encoding: 'utf-8' });
    console.log(mergeOutput.trim());
  } catch (err) {
    console.error(`⚠️ Failed to merge tracker: ${err.message}`);
  }
}

main().catch(console.error);
