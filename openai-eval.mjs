#!/usr/bin/env node
/**
 * openai-eval.mjs — OpenAI-compatible Job Offer Evaluator for career-ops
 *
 * Evaluate job offers with ANY OpenAI-compatible chat endpoint instead of Claude.
 * Works with OpenAI, OpenRouter, Together, Groq, DeepSeek, Zhipu GLM, MiniMax,
 * Fireworks, and local servers that speak the OpenAI API (LM Studio, llama.cpp,
 * vLLM, Ollama's /v1). Point it at a base URL + model + key and go.
 *
 * Reads evaluation logic from modes/oferta.md + modes/_shared.md, reads the
 * user's resume from cv.md, and evaluates a Job Description passed inline or
 * via --file. Mirrors ollama-eval.mjs / gemini-eval.mjs.
 *
 * Usage:
 *   node openai-eval.mjs "Paste full JD text here"
 *   node openai-eval.mjs --file ./jds/my-job.txt
 *   node openai-eval.mjs --url https://openrouter.ai/api/v1 --model meta-llama/llama-3.3-70b-instruct --file ./jds/job.txt
 *
 * Requires (for hosted endpoints):
 *   OPENAI_API_KEY (or --key)   — your provider key
 *   OPENAI_BASE_URL (or --url)  — the provider's OpenAI-compatible base, e.g.
 *                                 https://openrouter.ai/api/v1
 *   OPENAI_MODEL (or --model)   — the model id
 *
 * Privacy: your cv.md + the full JD are sent to the configured endpoint. Pick a
 * provider you trust; for fully local/private use, run a local server and point
 * --url at http://localhost:... (or use ollama-eval.mjs).
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  formatReportNumber, releaseReportNumbers, reserveReportNumbers,
} from './reserve-report-num.mjs';

try {
  const { config } = await import('dotenv');
  config();
} catch { /* dotenv optional */ }

const ROOT = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const PATHS = {
  shared:  join(ROOT, 'modes', '_shared.md'),
  oferta:  join(ROOT, 'modes', 'oferta.md'),
  cv:      join(ROOT, 'cv.md'),
  reports: join(ROOT, 'reports'),
};

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║       career-ops — OpenAI-compatible Evaluator (any endpoint)     ║
╚══════════════════════════════════════════════════════════════════╝

  Evaluate a job offer with any OpenAI-compatible chat API instead of Claude.

  USAGE
    node openai-eval.mjs "<JD text>"
    node openai-eval.mjs --file ./jds/my-job.txt
    node openai-eval.mjs --url <base> --model <id> --file ./jds/job.txt

  OPTIONS
    --file <path>    Read JD from a file instead of inline text
    --model <id>     Model id            (env OPENAI_MODEL, default gpt-4o-mini)
    --url <base>     OpenAI-compatible base URL, including any /v1
                     (env OPENAI_BASE_URL, default https://api.openai.com/v1)
    --key <key>      API key             (env OPENAI_API_KEY)
    --no-save        Do not save report to reports/ directory
    --help           Show this help

  ENV
    OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_TIMEOUT_MS

  PROVIDER EXAMPLES (cheap / free-tier friendly — addresses token cost)
    OpenRouter:  --url https://openrouter.ai/api/v1   --model deepseek/deepseek-chat
    Together:    --url https://api.together.xyz/v1     --model meta-llama/Llama-3.3-70B-Instruct-Turbo
    Groq:        --url https://api.groq.com/openai/v1  --model llama-3.3-70b-versatile
    DeepSeek:    --url https://api.deepseek.com/v1     --model deepseek-chat
    Zhipu GLM:   --url https://open.bigmodel.cn/api/paas/v4  --model glm-4-flash
    LM Studio:   --url http://localhost:1234/v1        --model <loaded-model>   (no key)

  EXAMPLES
    OPENAI_API_KEY=sk-... node openai-eval.mjs --file ./jds/job.txt
    node openai-eval.mjs --url http://localhost:1234/v1 --model local "<JD text>"
`);
  process.exit(0);
}

// Parse flags
let jdText     = '';
let modelName  = process.env.OPENAI_MODEL || 'gpt-4o-mini';
let baseUrl    = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
let apiKey     = process.env.OPENAI_API_KEY || '';
let saveReport = true;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file' && args[i + 1]) {
    const filePath = args[++i];
    if (!existsSync(filePath)) {
      console.error(`❌  File not found: ${filePath}`);
      process.exit(1);
    }
    try {
      jdText = readFileSync(filePath, 'utf-8').trim();
    } catch (err) {
      console.error(`❌  Could not read file: ${filePath}`);
      console.error(`    ${err.message}`);
      process.exit(1);
    }
  } else if (args[i] === '--model' && args[i + 1]) {
    modelName = args[++i];
  } else if (args[i] === '--url' && args[i + 1]) {
    baseUrl = args[++i].replace(/\/$/, '');
  } else if (args[i] === '--key' && args[i + 1]) {
    apiKey = args[++i];
  } else if (args[i] === '--no-save') {
    saveReport = false;
  } else if (!args[i].startsWith('--')) {
    jdText += (jdText ? '\n' : '') + args[i];
  }
}

if (!jdText) {
  console.error('❌  No Job Description provided. Run with --help for usage.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Endpoint + security guard.
// cv.md + the full JD (and the API key) are sent to this endpoint, so:
//   - Non-loopback endpoints MUST use HTTPS (never leak credentials/data in
//     cleartext); plain http is allowed only for localhost dev servers.
//   - Hosted (non-loopback) endpoints require an API key.
// ---------------------------------------------------------------------------
let endpointHost;
{
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    console.error(`❌  Invalid OPENAI_BASE_URL: "${baseUrl}"`);
    process.exit(1);
  }
  endpointHost = parsed.hostname;
  const isLoopback = endpointHost === 'localhost' || endpointHost === '127.0.0.1' || endpointHost === '::1';

  if (!isLoopback && parsed.protocol !== 'https:') {
    console.error(`
❌  Refusing to use a non-HTTPS remote endpoint: ${baseUrl}

   Your CV, the job description, and your API key would be sent in cleartext.
   Use an https:// endpoint, or http://localhost:... for a local server.
`);
    process.exit(1);
  }

  if (!isLoopback && !apiKey) {
    console.error(`
❌  No API key for ${endpointHost}.

   Set one and re-run:
     OPENAI_API_KEY=your_key node openai-eval.mjs ...
   or pass --key <key>. (Local servers at localhost may not need one.)
`);
    process.exit(1);
  }
}

// Build the chat-completions endpoint from the base URL (which already includes
// any provider version segment, e.g. ".../v1"), matching the OpenAI SDK convention.
const endpoint = `${baseUrl}/chat/completions`;

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------
/**
 * Read a file and return its trimmed contents, or a placeholder if missing.
 * @param {string} path - Absolute path to the file.
 * @param {string} label - Human-readable label used in the warning and placeholder.
 * @returns {string} File contents or a "[label not found]" placeholder.
 */
function readFile(path, label) {
  if (!existsSync(path)) {
    console.warn(`⚠️   ${label} not found at: ${path}`);
    return `[${label} not found — skipping]`;
  }
  return readFileSync(path, 'utf-8').trim();
}

// ---------------------------------------------------------------------------
// Load context files
// ---------------------------------------------------------------------------
console.log('\n📂  Loading context files...');

const sharedContext = readFile(PATHS.shared, 'modes/_shared.md');
const ofertaLogic   = readFile(PATHS.oferta, 'modes/oferta.md');
const cvContent     = readFile(PATHS.cv,     'cv.md');

// ---------------------------------------------------------------------------
// Build system prompt
// ---------------------------------------------------------------------------
const systemPrompt = `You are career-ops, an AI-powered job search assistant.
You evaluate job offers against the user's CV using a structured A-G scoring system.

Your evaluation methodology is defined below. Follow it exactly.

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
IMPORTANT OPERATING RULES FOR THIS SESSION
═══════════════════════════════════════════════════════
1. You do NOT have access to WebSearch, Playwright, or file writing tools.
   - Block D (Comp research): use training-data salary estimates; note them as estimates.
   - Block G (Legitimacy): analyze JD text only; skip URL/page freshness checks.
   - Post-evaluation file saving is handled by the script, not by you.
2. Generate Blocks A through G in full.
3. At the very end, output this exact machine-readable block:

---SCORE_SUMMARY---
COMPANY: <company name or "Unknown">
ROLE: <role title>
SCORE: <global score as decimal, e.g. 3.8>
ARCHETYPE: <detected archetype>
LEGITIMACY: <High Confidence | Proceed with Caution | Suspicious>
---END_SUMMARY---
`;

// ---------------------------------------------------------------------------
// Call the OpenAI-compatible endpoint
// ---------------------------------------------------------------------------
const timeoutMs = parseInt(process.env.OPENAI_TIMEOUT_MS || '300000', 10);
if (Number.isNaN(timeoutMs) || timeoutMs <= 0) {
  console.error(`❌  Invalid OPENAI_TIMEOUT_MS: "${process.env.OPENAI_TIMEOUT_MS}" — must be a positive integer (milliseconds).`);
  process.exit(1);
}

console.log(`\n🔒  Privacy: your cv.md + JD will be sent to ${endpointHost}.`);
console.log(`🤖  Calling ${modelName} via ${endpointHost}... this may take a minute.\n`);

const headers = { 'Content-Type': 'application/json' };
if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

let evaluationText;
try {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model:    modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: `JOB DESCRIPTION TO EVALUATE:\n\n${jdText}` },
      ],
      stream:      false,
      temperature: 0.4,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`❌  API error: HTTP ${res.status}`);
    console.error(`    ${body.slice(0, 300)}`);
    if (res.status === 401 || res.status === 403) {
      console.error(`    → Check your API key for ${endpointHost}.`);
    } else if (res.status === 404) {
      console.error(`    → Check --url (it should include any /v1 segment) and --model id.`);
    }
    process.exit(1);
  }

  const data = await res.json();
  evaluationText = data.choices?.[0]?.message?.content?.trim();
  if (!evaluationText) {
    console.error('❌  The endpoint returned an empty response.');
    process.exit(1);
  }
} catch (err) {
  if (err.name === 'TimeoutError') {
    console.error(`❌  Request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    console.error(`    Try a smaller/faster model, or increase OPENAI_TIMEOUT_MS.`);
  } else {
    console.error(`❌  API call failed: ${err.message}`);
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Display evaluation
// ---------------------------------------------------------------------------
console.log('\n' + '═'.repeat(66));
console.log('  CAREER-OPS EVALUATION — powered by ' + modelName + ' (' + endpointHost + ')');
console.log('═'.repeat(66) + '\n');
console.log(evaluationText);

// ---------------------------------------------------------------------------
// Parse score summary
// ---------------------------------------------------------------------------
const summaryMatch = evaluationText.match(/---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/);

let company    = 'unknown';
let role       = 'unknown';
let score      = '?';
let archetype  = 'unknown';
let legitimacy = 'unknown';

if (summaryMatch) {
  const extract = (key) => {
    const m = summaryMatch[1].match(new RegExp(`${key}:\\s*(.+)`));
    return m ? m[1].trim() : 'unknown';
  };
  company    = extract('COMPANY');
  role       = extract('ROLE');
  score      = extract('SCORE');
  archetype  = extract('ARCHETYPE');
  legitimacy = extract('LEGITIMACY');
}

// ---------------------------------------------------------------------------
// Save report
// ---------------------------------------------------------------------------
if (saveReport) {
  let reservedNumbers = [];
  try {
    if (!existsSync(PATHS.reports)) {
      mkdirSync(PATHS.reports, { recursive: true });
    }

    reservedNumbers   = await reserveReportNumbers(1, { rootDir: ROOT, reportsDir: PATHS.reports });
    const num         = formatReportNumber(reservedNumbers[0]);
    const today       = new Date().toISOString().split('T')[0];
    const companySlug = company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename    = `${num}-${companySlug}-${today}.md`;
    const reportPath  = join(PATHS.reports, filename);

    const reportContent = `# Evaluation: ${company} — ${role}

**Date:** ${today}
**Archetype:** ${archetype}
**Score:** ${score}/5
**Legitimacy:** ${legitimacy}
**PDF:** pending
**Tool:** OpenAI-compatible (${modelName} @ ${endpointHost})

---

${evaluationText.replace(/---SCORE_SUMMARY---[\s\S]*?---END_SUMMARY---/, '').trim()}
`;

    writeFileSync(reportPath, reportContent, 'utf-8');
    console.log(`\n✅  Report saved: reports/${filename}`);

    console.log(`\n📊  Tracker entry (add to data/applications.md):`);
    console.log(`    | ${num} | ${today} | ${company} | ${role} | ${score}/5 | Evaluated | ❌ | [${num}](reports/${filename}) |`);
  } catch (err) {
    console.warn(`⚠️   Could not save report: ${err.message}`);
  } finally {
    if (reservedNumbers.length > 0) {
      try {
        await releaseReportNumbers(reservedNumbers, { reportsDir: PATHS.reports });
      } catch (err) {
        console.warn(`⚠️   Could not release report reservation: ${err.message}`);
      }
    }
  }
}

console.log('\n' + '─'.repeat(66));
console.log(`  Score: ${score}/5  |  Archetype: ${archetype}  |  Legitimacy: ${legitimacy}`);
console.log('─'.repeat(66) + '\n');
