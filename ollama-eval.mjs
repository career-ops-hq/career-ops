#!/usr/bin/env node
/**
 * ollama-eval.mjs — Ollama-powered Job Offer Evaluator for career-ops
 *
 * Local, free, private alternative to the Claude-based pipeline.
 * Reads evaluation logic from modes/oferta.md + modes/_shared.md,
 * reads the user's resume from cv.md, and evaluates a Job Description
 * passed as a CLI argument or file.
 *
 * Usage:
 *   node ollama-eval.mjs "Paste full JD text here"
 *   node ollama-eval.mjs --file ./jds/my-job.txt
 *   node ollama-eval.mjs --model qwen2.5:72b --file ./jds/my-job.txt
 *
 * Requires:
 *   Ollama running locally — https://ollama.com
 *   A model pulled:  ollama pull llama3.3
 *
 * Context window guidance:
 *   The prompt (cv + modes + JD) is ~10K-15K tokens.
 *   Recommended models (32K+ context): llama3.3, mistral-nemo, qwen2.5, gemma3
 *   Smaller models (llama3.2:3b, phi3) may produce incomplete evaluations.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { localToday } from './lib/local-today.mjs';
import { TSV_ADDITION_HEADER } from './tracker-parse.mjs';
import { outputLanguageInstruction, parseOutputLanguage } from './profile-language.mjs';
import {
  formatReportNumber, releaseReportNumbers, reserveReportNumbers,
} from './reserve-report-num.mjs';
import { TokenAccumulator, formatBreakdown, normalizeOpenAIUsage } from './utils/token-tracker.mjs';
import { buildBudgetedPrompt } from './lib/context-budget.mjs';
import {
  isPostingUrl, normalizedTrackerScore, slugifyCompany, tsvSafe,
} from './lib/tracker-addition.mjs';

const tracker = new TokenAccumulator();
tracker.recordZeroToken('scan');
tracker.recordZeroToken('pdf payload');

try {
  const { config } = await import('dotenv');
  config();
} catch { /* dotenv optional */ }

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = getCareerOpsRoot();

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const PATHS = {
  shared:  join(ROOT, 'modes', '_shared.md'),
  oferta:  join(ROOT, 'modes', 'oferta.md'),
  cv:      join(DATA_ROOT, 'cv.md'),
  profile: join(DATA_ROOT, 'modes', '_profile.md'),
  profileYml: join(DATA_ROOT, 'config', 'profile.yml'),
  reports: join(DATA_ROOT, 'reports'),
  // CAREER_OPS_ADDITIONS mirrors merge-tracker.mjs:43. Writing under DATA_ROOT
  // regardless would drop the addition somewhere the merge it instructs never
  // looks, so the evaluation would sit there unread.
  trackerAdditions: process.env.CAREER_OPS_ADDITIONS
    ? process.env.CAREER_OPS_ADDITIONS
    : join(DATA_ROOT, 'batch', 'tracker-additions'),
};

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║           career-ops — Ollama Evaluator (local / free)          ║
╚══════════════════════════════════════════════════════════════════╝

  Evaluate a job offer using a local Ollama model instead of Claude.

  USAGE
    node ollama-eval.mjs "<JD text>"
    node ollama-eval.mjs --file ./jds/my-job.txt
    node ollama-eval.mjs --model qwen2.5:72b "<JD text>"

  OPTIONS
    --file <path>    Read JD from a file instead of inline text
    --model <name>   Ollama model to use (default: llama3.3)
    --url <url>      Ollama base URL (default: http://localhost:11434)
    --posting-url <url>  Posting URL, recorded in the report header and
                     used as the tracker's dedup key
    --no-save        Do not save report to reports/ directory
    --help           Show this help

  SETUP
    1. Install Ollama:  https://ollama.com
    2. Pull a model:    ollama pull llama3.3
    3. Start server:    ollama serve   (or it auto-starts)
    4. Run this script

  EXAMPLES
    node ollama-eval.mjs "We are looking for a Senior AI Engineer..."
    node ollama-eval.mjs --file ./jds/openai-swe.txt
    OLLAMA_MODEL=mistral-nemo node ollama-eval.mjs --file ./jds/job.txt
`);
  process.exit(0);
}

// Parse flags
let jdText    = '';
let postingUrl = '';
let modelName = process.env.OLLAMA_MODEL || 'llama3.3';
let baseUrl   = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
// Context window for the request AND the prompt budget. Defaults to the previous hardcoded
// 32768, so behaviour is unchanged unless OLLAMA_NUM_CTX is set. Raise it for a model with a
// bigger window; `ollama show` reports each model's ceiling (qwen2.5 caps at 32768).
const numCtx = parseInt(process.env.OLLAMA_NUM_CTX || '32768', 10);
if (Number.isNaN(numCtx) || numCtx <= 0) {
  console.error(`❌  Invalid OLLAMA_NUM_CTX: "${process.env.OLLAMA_NUM_CTX}" — must be a positive integer (tokens).`);
  process.exit(1);
}
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
  } else if (args[i] === '--posting-url' && args[i + 1]) {
    postingUrl = args[++i];
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

// A posting URL is the tracker's deterministic dedup key, so it is taken only in
// a form that can actually become one. Parsed, not prefix-matched: `https://`
// satisfies a prefix test and merge-tracker.mjs:697 would then classify it as
// the URL extra, but normalizeUrl yields no key for it -- so it would sit in the
// URL column looking like a key while deduping nothing. A placeholder written
// there would be worse still, handing every such row the same key.
if (postingUrl && !isPostingUrl(postingUrl)) {
  console.error(`❌  --posting-url must be a complete http(s) URL: "${postingUrl}"`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------
/**
 * Read a file and return its trimmed contents, or a placeholder if missing.
 * Emits a console warning when the file is absent so the user knows context is incomplete.
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
// Loopback guard — cv.md + full JD are sent to this endpoint.
// A remote URL would silently exfiltrate private data.
// ---------------------------------------------------------------------------
{
  let hostname;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    console.error(`❌  Invalid OLLAMA_BASE_URL: "${baseUrl}"`);
    process.exit(1);
  }
  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  if (!isLoopback && process.env.OLLAMA_ALLOW_REMOTE !== '1') {
    console.error(`
❌  Remote Ollama endpoint detected: ${baseUrl}

   Your CV and job description would be sent to a remote server.
   This tool is designed for local use only.

   If you intentionally want to use a remote endpoint (e.g. tunnelled
   Ollama on a home server), set:
     OLLAMA_ALLOW_REMOTE=1 node ollama-eval.mjs ...
`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Check Ollama is reachable before burning time on prompt assembly
// ---------------------------------------------------------------------------
try {
  const probe = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5_000) });
  if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
} catch (err) {
  console.error(`
❌  Ollama not reachable at ${baseUrl}

   1. Install Ollama: https://ollama.com
   2. Start server:   ollama serve
   3. Pull a model:   ollama pull ${modelName}
`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load context files
// ---------------------------------------------------------------------------
console.log('\n📂  Loading context files...');

const sharedContext = readFile(PATHS.shared, 'modes/_shared.md');
const ofertaLogic   = readFile(PATHS.oferta, 'modes/oferta.md');
const cvContent     = readFile(PATHS.cv,     'cv.md');
const profileContent = readFile(PATHS.profile, 'modes/_profile.md');
const profileYml    = readFile(PATHS.profileYml, 'config/profile.yml');
const languageInstruction = outputLanguageInstruction(parseOutputLanguage(profileYml));

// ---------------------------------------------------------------------------
// Build system prompt with token budget management
// ---------------------------------------------------------------------------
const { contextBody, budgetReport } = buildBudgetedPrompt({
  sharedContent: sharedContext,
  ofertaContent: ofertaLogic,
  cvContent,
  profileYml,
  profileContent,
  jdText,
  maxTokens: numCtx, // matches options.num_ctx below
});

if (budgetReport.compressed) {
  console.log(`📊  Token budget: ${budgetReport.beforeTokens} → ${budgetReport.afterTokens} tokens (saved ${budgetReport.beforeTokens - budgetReport.afterTokens})`);
  console.log(`    Trimmed sections: ${budgetReport.removed.join(', ')}`);
  if (budgetReport.overBudget) {
    console.log(`    ⚠️  Still ${budgetReport.afterTokens - budgetReport.budget} tokens over budget after compression`);
  }
} else if (budgetReport.overBudget) {
  console.log(`⚠️  Token budget: ${budgetReport.totalTokens} tokens exceeds ${budgetReport.budget} limit by ${budgetReport.totalTokens - budgetReport.budget}`);
} else {
  console.log(`📊  Token budget: ${budgetReport.totalTokens} tokens (within ${budgetReport.budget} limit)`);
}

const systemPrompt = `You are career-ops, an AI-powered job search assistant.
You evaluate job offers against the user's CV using a structured A-G scoring system.

Your evaluation methodology is defined below. Follow it exactly.

${contextBody}

═══════════════════════════════════════════════════════
IMPORTANT OPERATING RULES FOR THIS SESSION
═══════════════════════════════════════════════════════
1. You do NOT have access to WebSearch, Playwright, or file writing tools.
   - Block D (Comp research): use training-data salary estimates; note them as estimates.
   - Block G (Legitimacy): analyze JD text only; skip URL/page freshness checks.
   - Post-evaluation file saving is handled by the script, not by you.
2. ${languageInstruction}
3. Generate Blocks A through G in full.
4. At the very end, output this exact machine-readable block:

---SCORE_SUMMARY---
COMPANY: <company name or "Unknown">
ROLE: <role title>
SCORE: <global score as decimal, e.g. 3.8>
ARCHETYPE: <detected archetype>
LEGITIMACY: <High Confidence | Proceed with Caution | Suspicious>
---END_SUMMARY---
`;

// ---------------------------------------------------------------------------
// Call Ollama
// ---------------------------------------------------------------------------
const endpoint = `${baseUrl}/api/chat`;
const timeoutMs = parseInt(process.env.OLLAMA_TIMEOUT_MS || '300000', 10);
if (Number.isNaN(timeoutMs) || timeoutMs <= 0) {
  console.error(`❌  Invalid OLLAMA_TIMEOUT_MS: "${process.env.OLLAMA_TIMEOUT_MS}" — must be a positive integer (milliseconds).`);
  process.exit(1);
}

console.log(`🤖  Calling Ollama (${modelName})... this may take a minute.\n`);

let evaluationText;
try {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:    modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: `JOB DESCRIPTION TO EVALUATE:\n\n${jdText}` },
      ],
      // stream:true so response headers arrive with the FIRST token. With stream:false
      // Ollama sends nothing until the whole report is generated, and Node's undici client
      // gives up at its own 300s headersTimeout — a deadline neither OLLAMA_TIMEOUT_MS nor
      // AbortSignal.timeout controls, which surfaced as a bare "fetch failed" at 5:01.
      stream: true,
      // Ollama's native /api/chat reads generation params from `options` only.
      // This call targets that endpoint (NOT the OpenAI-compatible /v1 route,
      // which ignores `options` and has no num_ctx equivalent), so both the
      // deterministic temperature and the enlarged context window actually take
      // effect. Without num_ctx here Ollama defaults to a 2048-token context and
      // silently truncates the prompt; without temperature it runs at 0.8.
      options: { temperature: 0.4, num_ctx: numCtx },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`❌  Ollama API error: HTTP ${res.status}`);
    console.error(`    ${body.slice(0, 300)}`);
    process.exit(1);
  }

  // Streamed /api/chat is newline-delimited JSON: one object per token, the last carrying
  // done:true and the token counts.
  let acc = '', buf = '', promptCount = 0, evalCount = 0;
  let completed = false;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const consumeLine = line => {
    if (!line.trim()) return;
    const obj = JSON.parse(line);
    if (obj.error) throw new Error(String(obj.error));
    if (completed) throw new Error('Unexpected data after completed evaluation');
    if (obj.message?.content) acc += obj.message.content;
    if (obj.done === true) {
      if (obj.done_reason && obj.done_reason !== 'stop') {
        throw new Error(`Incomplete evaluation: done_reason=${obj.done_reason}`);
      }
      completed = true;
      promptCount = obj.prompt_eval_count ?? 0;
      evalCount = obj.eval_count ?? 0;
    }
  };
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      consumeLine(line);
    }
  }
  consumeLine(buf + decoder.decode());
  if (!completed) throw new Error('Incomplete evaluation: stream ended before done:true');
  evaluationText = acc.trim();
  // Native /api/chat reports tokens as prompt_eval_count / eval_count, not an
  // OpenAI-shaped `usage` object; map them through the shared normalizer.
  const usage = normalizeOpenAIUsage({
    prompt_tokens: promptCount,
    completion_tokens: evalCount,
    total_tokens: promptCount + evalCount,
  });
  tracker.record('evaluation', usage);
  if (!evaluationText) {
    console.error('❌  Ollama returned an empty response.');
    process.exit(1);
  }
} catch (err) {
  if (err.name === 'TimeoutError') {
    console.error(`❌  Request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    console.error(`    Try a smaller/faster model, or increase OLLAMA_TIMEOUT_MS.`);
  } else {
    console.error(`❌  Ollama API call failed: ${err.message}`);
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Display evaluation
// ---------------------------------------------------------------------------
console.log('\n' + '═'.repeat(66));
console.log('  CAREER-OPS EVALUATION — powered by Ollama (' + modelName + ')');
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
    // LOCAL calendar day (#3070). This one value becomes three things that have to
    // agree with each other and with the user's calendar: the report FILENAME
    // ({num}-{slug}-{today}.md), the report's own `**Date:**` header, and the date
    // column of the tracker row written for it.
    //
    // On the UTC day an evaluation run on a Sunday evening in the Americas produces
    // 042-acme-2026-08-18.md, dated the 18th, in a tracker row dated the 18th —
    // while every other date the user sees, and every date the other scripts now
    // stamp, says the 17th. The filename is the part that cannot be corrected
    // later: reports are addressed by it.
    const today       = localToday();
    const companySlug = slugifyCompany(company);
    const filename    = `${num}-${companySlug}-${today}.md`;
    const reportPath  = join(PATHS.reports, filename);

    const reportContent = `# Evaluation: ${company} — ${role}

**Date:** ${today}
**Archetype:** ${archetype}
**Score:** ${score}/5
**URL:** ${postingUrl || '(pasted)'}
**Legitimacy:** ${legitimacy}
**PDF:** pending
**Tool:** Ollama (${modelName})

---

${evaluationText.replace(/---SCORE_SUMMARY---[\s\S]*?---END_SUMMARY---/, '').trim()}
`;

    writeFileSync(reportPath, reportContent, 'utf-8');
    console.log(`\n✅  Report saved: reports/${filename}`);

    // AGENTS.md Pipeline Integrity rule 1: never hand the user a row to paste
    // into data/applications.md. Evaluations persist as a tracker addition and
    // merge-tracker.mjs applies dedup, status validation, report-link
    // normalization and the tracker lock. A pasted literal skipped all of that,
    // and at 8 cells it was also silently dropped by every reader's width guard.
    // Field order is the TSV contract's -- status BEFORE score; merge-tracker
    // swaps them into the tracker's own column order, resolved by name.
    const additionName = `${num}-${companySlug}.tsv`;
    const trackerFields = [
      String(parseInt(num, 10)),
      today,
      tsvSafe(company),
      tsvSafe(role),
      'Evaluated',
      normalizedTrackerScore(score),
      '❌',
      `[${num}](reports/${filename})`,
      tsvSafe(`Ollama evaluation (${modelName})`),
    ];
    // Optional tenth field, labelled in the header below so it resolves by name.
    // Pass 0 can then match on it instead of waiting for --backfill-urls.
    if (postingUrl) trackerFields.push(tsvSafe(postingUrl));
    // Header row first (#3517/#3706): merge-tracker resolves the fields by name,
    // so this row cannot be ingested into the wrong columns. The optional URL
    // needs its own label -- values are read BY label, so a tenth field the
    // header does not name is not mis-mapped, it is dropped.
    const additionHeader = postingUrl ? `${TSV_ADDITION_HEADER}\turl` : TSV_ADDITION_HEADER;
    mkdirSync(PATHS.trackerAdditions, { recursive: true });
    writeFileSync(
      join(PATHS.trackerAdditions, additionName),
      `${additionHeader}\n${trackerFields.join('\t')}\n`,
      'utf-8',
    );
    console.log(`\n📊  Tracker addition saved: batch/tracker-additions/${additionName}`);
    console.log('    Run `node merge-tracker.mjs` to merge it into the tracker.');
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

console.log(formatBreakdown(tracker, modelName, 'ollama'));
