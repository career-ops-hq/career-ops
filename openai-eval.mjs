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
import { getCareerOpsRoot } from './path-resolver.mjs';
import { TSV_ADDITION_HEADER } from './tracker-parse.mjs';
import { outputLanguageInstruction, parseOutputLanguage } from './profile-language.mjs';
import {
  formatReportNumber, releaseReportNumbers, reserveReportNumbers,
} from './reserve-report-num.mjs';
import { TokenAccumulator, formatBreakdown, normalizeOpenAIUsage } from './utils/token-tracker.mjs';
import { buildBudgetedPrompt } from './lib/context-budget.mjs';

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
  cv:        join(DATA_ROOT, 'cv.md'),
  profileYml: join(DATA_ROOT, 'config', 'profile.yml'),
  reports:    join(DATA_ROOT, 'reports'),
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
    --posting-url <url>  Posting URL, recorded in the report header and
                     used as the tracker's dedup key
    --no-save        Do not save report to reports/ directory
    --no-compress    Skip token budget compression (full context injection)
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
let postingUrl = '';
let modelName  = process.env.OPENAI_MODEL || 'gpt-4o-mini';
let baseUrl    = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
let apiKey     = process.env.OPENAI_API_KEY || '';
let saveReport = true;
let noCompress = false;

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
  } else if (args[i] === '--posting-url' && args[i + 1]) {
    postingUrl = args[++i];
  } else if (args[i] === '--no-save') {
    saveReport = false;
  } else if (args[i] === '--no-compress') {
    noCompress = true;
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
// Tracker-addition helpers
// ---------------------------------------------------------------------------
/**
 * Whether a value is a complete http(s) URL, and so can become a dedup key.
 * @param {string} value - Candidate posting URL.
 * @returns {boolean} True only for a parseable http/https URL with a host.
 */
function isPostingUrl(value) {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * Slugify a company name for report/addition filenames.
 * @param {string} value - Raw company name.
 * @returns {string} Lowercase dash slug, or "unknown" when nothing survives.
 */
function slugifyCompany(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
}

/**
 * Flatten a value into a single TSV cell (tabs and newlines would shift columns).
 * @param {*} value - Raw cell value.
 * @returns {string} Single-line, trimmed cell.
 */
function tsvSafe(value) {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

/**
 * Normalize a model-reported score into the tracker's score cell.
 *
 * A missing or unparseable score becomes the documented `N/A` sentinel rather
 * than an empty cell — `looksLikeScoreCell` in tracker-parse.mjs recognizes
 * `N/A`, and a blank or unrecognized placeholder makes the row ambiguous and
 * gets it skipped with a warning (#1799).
 *
 * @param {string} value - Score as extracted from the model's summary block.
 * @returns {string} `X.X/5` or `N/A`.
 */
function normalizedTrackerScore(value) {
  const clean = tsvSafe(value);
  // Parse, do not pattern-match the string. Two bugs lived in the old guard:
  // `/n\/?a/i` was unanchored with an optional slash, so bare `na` matched and a
  // real score with trailing prose -- `4.2 (final)`, `4.2 (internal)`,
  // `4.5 - strong signal` -- was recorded as `N/A`; and the `/5` early return kept
  // the whole string, so `4.2/10` became `4.2/5` and merged as a genuine score.
  // Trailing prose is tolerated because models produce it; a denominator that is
  // not 5, or a value outside 0..5, is refused rather than reinterpreted.
  const parsed = clean.match(/^(\d+(?:\.\d+)?)/);
  if (!parsed) return 'N/A';
  const score = parseFloat(parsed[1]);
  // The denominator is load-bearing wherever it sits. Requiring it immediately
  // after the number read `4.2 (strong fit)/10` -- a ten-point score with an
  // annotation -- as a bare 4.2 and wrote `4.2/5`, the same wrong number
  // `8/10` used to produce. The first denominator in the cell is taken and must
  // be 5; absent one, the scale is the contract's. A cell that puts an unrelated
  // fraction first (`4.2 (fit 3/4 axes)`) is refused rather than guessed at --
  // N/A is recoverable, a wrong score is not.
  const denominator = clean.match(/\/\s*(\d+(?:\.\d+)?)/);
  const scale = denominator ? parseFloat(denominator[1]) : 5;
  if (!Number.isFinite(score) || scale !== 5 || score < 0 || score > 5) return 'N/A';
  return `${score}/5`;
}

// ---------------------------------------------------------------------------
// Load context files
// ---------------------------------------------------------------------------
console.log('\n📂  Loading context files...');

const sharedContext = readFile(PATHS.shared,     'modes/_shared.md');
const ofertaLogic   = readFile(PATHS.oferta,     'modes/oferta.md');
const cvContent     = readFile(PATHS.cv,         'cv.md');
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
  jdText,
  noCompress,
  maxTokens: 128_000, // gpt-4o-mini context window
});

// Log token budget info
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
// Prompt caching (#1709) — engine 2 of the four from #1709, same shape as the
// OpenRouter runner. The static prefix (shared + oferta + cv, ~12K tokens) is
// byte-identical across every offer, yet was re-sent and re-billed each call.
//
// Host-gated on purpose: OpenAI-compatible gateways (OpenRouter, DeepSeek, …)
// honor an ephemeral `cache_control` breakpoint on the prefix and reuse it
// across back-to-back calls within the cache TTL. api.openai.com instead caches
// long prefixes automatically and may reject the non-standard field, so it gets
// a plain-string system message. Either way the prompt TEXT is unchanged.
export function buildSystemMessage(prompt, host) {
  if (host === 'api.openai.com') return { role: 'system', content: prompt };
  return {
    role: 'system',
    content: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }],
  };
}

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
  // Streaming (SSE): llama.cpp/Unsloth brauchen bei langen Generationen den
  // sofortigen Header; Non-Streaming läuft in Node/undici in den 5-Minuten-
  // Header-Timeout, bevor die erste Zeile ankommt (8 t/s × 22k-Prefill).
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model:    modelName,
      messages: [
        buildSystemMessage(systemPrompt, endpointHost),
        { role: 'user', content: `JOB DESCRIPTION TO EVALUATE:\n\n${jdText}` },
      ],
      stream:      true,
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

  // SSE-Zeilen akkumulieren: content + reasoning_content getrennt
  const parts = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sseBuf = '';
  let thinkOpen = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = sseBuf.indexOf('\n')) >= 0) {
      const line = sseBuf.slice(0, nl).trim();
      sseBuf = sseBuf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let delta;
      try { delta = JSON.parse(payload); } catch { continue; }
      const d = delta.choices?.[0]?.delta ?? {};
      if (d.reasoning_content) {
        if (!thinkOpen) { parts.push('\n<think>\n'); thinkOpen = true; }
        parts.push(d.reasoning_content);
      } else {
        if (thinkOpen) { parts.push('\n</think>\n\n'); thinkOpen = false; }
        if (d.content) parts.push(d.content);
      }
    }
  }
  if (thinkOpen) parts.push('\n</think>\n');
  evaluationText = parts.join('').trim();
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
**Tool:** OpenAI-compatible (${modelName} @ ${endpointHost})

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
      tsvSafe(`OpenAI-compatible evaluation (${modelName})`),
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

console.log(formatBreakdown(tracker, modelName, 'openai'));
