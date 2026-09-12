#!/usr/bin/env node
// Set Windows console to UTF-8 to prevent mojibake in terminal output
if (process.platform === 'win32') {
  try {
    const { execFileSync } = await import('child_process');
    execFileSync('chcp.com', ['65001'], { stdio: 'ignore' });
  } catch {
    // ignore
  }
}

/**
 * gemini-eval.mjs — Gemini-powered Job Offer Evaluator for career-ops
 *
 * A free-tier alternative to the Claude-based pipeline.
 * Reads evaluation logic from modes/oferta.md + modes/_shared.md,
 * reads the user's resume from cv.md, and evaluates a Job Description
 * passed as a command-line argument.
 *
 * Usage:
 *   node gemini-eval.mjs "Paste full JD text here"
 *   node gemini-eval.mjs --file ./jds/my-job.txt
 *   node gemini-eval.mjs --posting-url https://acme.com/jobs/42 --file ./jds/my-job.txt
 *
 * Requires:
 *   GEMINI_API_KEY in .env (or environment variable)
 *
 * Default model: gemini-3.6-flash (GA July 2026)
 *
 * Model deprecation reference (per Google AI for Developers, May 2026):
 *   - gemini-2.0-flash       deprecated 2026-03-31  (do not use — generateContent 404)
 *   - gemini-2.0-flash-lite  deprecated 2026-03-31
 *   - gemini-2.5-flash       deprecated 2026-06-17
 *   - gemini-2.5-flash-lite  deprecated 2026-07-22
 *   - gemini-3.5-flash       prior Flash generation (still available)
 *   - gemini-3.6-flash       current default (stable)
 *
 * Stable Gemini models follow a 12-month lifecycle from their release date.
 * Source: https://ai.google.dev/gemini-api/docs/models
 *
 * When the current default approaches its deprecation date, bump
 * `modelName` below and the `--model` examples accordingly.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve, relative, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { TokenAccumulator, formatBreakdown } from './utils/token-tracker.mjs';

const tracker = new TokenAccumulator();
tracker.recordZeroToken('scan');
tracker.recordZeroToken('pdf payload');
import { execFileSync } from 'child_process';
import { outputLanguageInstruction, parseOutputLanguage } from './profile-language.mjs';
import {
  formatReportNumber, releaseReportNumbers, reserveReportNumbers,
} from './reserve-report-num.mjs';
import { buildBudgetedPrompt } from './lib/context-budget.mjs';
import * as yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Bootstrap: load .env before anything else
// ---------------------------------------------------------------------------
try {
  const { config } = await import('dotenv');
  config();
} catch {
  // dotenv is optional — fall back to process.env if not installed
}

import { GoogleGenerativeAI } from '@google/generative-ai';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { TSV_ADDITION_HEADER } from './tracker-parse.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = getCareerOpsRoot();

const PATHS = {
  // Primary evaluation logic lives in these two mode files (default values)
  shared:      join(CODE_ROOT, 'modes', '_shared.md'),
  oferta:      join(CODE_ROOT, 'modes', 'oferta.md'),
  // Canonical skill path referenced in Issue #344
  evaluate:    join(CODE_ROOT, '.claude', 'skills', 'career-ops', 'SKILL.md'),
  cv:          join(DATA_ROOT, 'cv.md'),
  profile:     join(DATA_ROOT, 'modes', '_profile.md'),
  profileYml:  join(DATA_ROOT, 'config', 'profile.yml'),
  reports:     join(DATA_ROOT, 'reports'),
  tracker:     resolveTrackerPath(DATA_ROOT),
  trackerAdditions: join(DATA_ROOT, 'batch', 'tracker-additions'),
};

// Determine the localization modes directory and evaluation filename dynamically from config/profile.yml
let modesDir = 'modes';
let evalFilename = 'oferta.md';

function stripBom(str) {
  return str.charCodeAt(0) === 0xFEFF ? str.slice(1) : str;
}

if (existsSync(PATHS.profileYml)) {
  try {
    const yamlContent = stripBom(readFileSync(PATHS.profileYml, 'utf-8'));
    const profile = yaml.load(yamlContent);
    if (profile && profile.language && profile.language.modes_dir) {
      const customModesDir = profile.language.modes_dir;
      const dirPath = resolve(CODE_ROOT, customModesDir);
      const rel = relative(CODE_ROOT, dirPath);
      if (rel.startsWith('..') || isAbsolute(customModesDir)) {
        console.warn(`⚠️   modes_dir "${customModesDir}" escapes project root; using default modes/`);
      } else {
        if (existsSync(dirPath)) {
          const candidateFiles = ['oferta.md', 'angebot.md', 'offre.md', 'kyujin.md', 'is-ilani.md', 'naukri.md'];
          const found = candidateFiles.find((file) => existsSync(join(dirPath, file)));
          if (found) {
            modesDir = customModesDir;
            evalFilename = found;
          } else {
            console.warn(`⚠️   No matching evaluation file found in ${customModesDir}; using default modes/oferta.md`);
          }
        } else {
          console.warn(`⚠️   modes_dir "${customModesDir}" not found; using default modes/`);
        }
      }
    }
  } catch (err) {
    console.warn(`⚠️   Could not parse config/profile.yml: ${err.message}`);
  }
}

PATHS.shared = join(CODE_ROOT, modesDir, '_shared.md');
PATHS.oferta = join(CODE_ROOT, modesDir, evalFilename);

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║           career-ops — Gemini Evaluator (free-tier)             ║
╚══════════════════════════════════════════════════════════════════╝

  Evaluate a job offer using Google Gemini instead of Claude.

  USAGE
    node gemini-eval.mjs "<JD text>"
    node gemini-eval.mjs --file ./jds/my-job.txt
    node gemini-eval.mjs --model gemini-3.6-flash "<JD text>"

  OPTIONS
    --file <path>    Read JD from a file instead of inline text
    --model <name>   Gemini model to use (default: gemini-3.6-flash)
    --posting-url <url>  Posting URL, recorded in the report header and
                     used as the tracker's dedup key
    --no-save        Do not save report to reports/ directory
    --no-compress    Skip token budget compression (full context injection)
    --help           Show this help

  SETUP
    1. Get a free API key at https://aistudio.google.com/apikey
    2. Add GEMINI_API_KEY=<your-key> to .env
    3. Run: npm install   (installs @google/generative-ai + dotenv)

  EXAMPLES
    node gemini-eval.mjs "We are looking for a Senior AI Engineer..."
    node gemini-eval.mjs --file ./jds/openai-swe.txt
    node gemini-eval.mjs --posting-url https://acme.com/jobs/42 --file ./jds/openai-swe.txt
`);
  process.exit(0);
}

// Parse flags
let jdText = '';
let postingUrl = '';
let modelName = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
let saveReport = true;
let noCompress = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file' && args[i + 1]) {
    const filePath = args[++i];
    if (!existsSync(filePath)) {
      console.error(`❌  File not found: ${filePath}`);
      process.exit(1);
    }
    jdText = stripBom(readFileSync(filePath, 'utf-8')).trim();
  } else if (args[i] === '--model' && args[i + 1]) {
    modelName = args[++i];
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
// satisfies a prefix test and would then sit in the URL column looking like a
// key while normalizeUrl derives nothing from it, deduping nothing. A
// placeholder written there would be worse still, handing every such row the
// same key -- which is why an absent URL yields `(pasted)` in the report header
// and no url cell at all, rather than a stand-in.
if (postingUrl && !isPostingUrl(postingUrl)) {
  console.error(`❌  --posting-url must be a complete http(s) URL: "${postingUrl}"`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Validate environment
// ---------------------------------------------------------------------------
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error(`
❌  GEMINI_API_KEY not found.

   1. Get a free key at https://aistudio.google.com/apikey
   2. Add it to .env:   GEMINI_API_KEY=your_key_here
   3. Or export it:     export GEMINI_API_KEY=your_key_here
`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------
function readFile(path, label) {
  if (!existsSync(path)) {
    console.warn(`⚠️   ${label} not found at: ${path}`);
    return `[${label} not found — skipping]`;
  }
  return stripBom(readFileSync(path, 'utf-8')).trim();
}

function validateEvaluationShape(text) {
  const issues = [];
  const requiredBlocks = [
    ['A', /(?:^|\n)#{1,3}\s*(?:A[).:-]?|Block A\b)/im],
    ['B', /(?:^|\n)#{1,3}\s*(?:B[).:-]?|Block B\b)/im],
    ['C', /(?:^|\n)#{1,3}\s*(?:C[).:-]?|Block C\b)/im],
    ['D', /(?:^|\n)#{1,3}\s*(?:D[).:-]?|Block D\b)/im],
    ['E', /(?:^|\n)#{1,3}\s*(?:E[).:-]?|Block E\b)/im],
    ['F', /(?:^|\n)#{1,3}\s*(?:F[).:-]?|Block F\b)/im],
    ['G', /(?:^|\n)#{1,3}\s*(?:G[).:-]?|Block G\b)/im],
  ];

  for (const [label, pattern] of requiredBlocks) {
    if (!pattern.test(text)) issues.push(`missing Block ${label}`);
  }

  const summary = text.match(/---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/);
  if (!summary) {
    issues.push('missing SCORE_SUMMARY block');
  } else {
    const summaryBlock = summary[1];
    for (const key of ['COMPANY', 'ROLE', 'ARCHETYPE', 'LEGITIMACY']) {
      const field = summaryBlock.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'mi'));
      const value = field?.[1]?.trim() ?? '';
      if (!value || (key !== 'COMPANY' && value.toLowerCase() === 'unknown')) {
        issues.push(`SCORE_SUMMARY ${key} is required`);
      }
    }

    const score = summaryBlock.match(/^\s*SCORE:\s*([0-9]+(?:\.[0-9]+)?)/mi);
    const scoreValue = score ? Number(score[1]) : NaN;
    if (!Number.isFinite(scoreValue) || scoreValue < 0 || scoreValue > 5) {
      issues.push('SCORE_SUMMARY score must be a number between 0 and 5');
    }
  }

  if (issues.length > 0) {
    throw new Error(`Gemini returned an invalid career-ops report: ${issues.join('; ')}`);
  }
}

function slugifyCompany(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
}

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

function tsvSafe(value) {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

/**
 * Normalize a model-reported score into the tracker's score cell.
 *
 * `extract('SCORE')` returns the whole rest of the SCORE line, while
 * `validateEvaluationShape` only checks its numeric prefix -- so
 * `SCORE: 4.2 (strong fit)` passes validation and arrives here intact.
 *
 * @param {string} value - Score as extracted from the model's summary block.
 * @returns {string} `X.X/5`, or the documented `N/A` sentinel (#1799).
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

// Lazy import — only used when saving
let readdirSync;
try {
  ({ readdirSync } = await import('fs'));
} catch { /* already imported above via named exports */ }
// Use named import fallback
if (!readdirSync) {
  readdirSync = (await import('fs')).readdirSync;
}

// ---------------------------------------------------------------------------
// Load context files
// ---------------------------------------------------------------------------
console.log('\n📂  Loading context files...');

const sharedLabel = join(modesDir, '_shared.md').replace(/\\/g, '/');
const ofertaLabel = join(modesDir, evalFilename).replace(/\\/g, '/');
const sharedContext  = readFile(PATHS.shared,      sharedLabel);
const ofertaLogic    = readFile(PATHS.oferta,      ofertaLabel);
const cvContent      = readFile(PATHS.cv,          'cv.md');
const profileContent = readFile(PATHS.profile,     'modes/_profile.md');
const profileYml     = readFile(PATHS.profileYml,  'config/profile.yml');
const languageInstruction = outputLanguageInstruction(parseOutputLanguage(profileYml));

// ---------------------------------------------------------------------------
// Build the system prompt with token budget management
// ---------------------------------------------------------------------------
const { contextBody, budgetReport } = buildBudgetedPrompt({
  sharedContent: sharedContext,
  ofertaContent: ofertaLogic,
  cvContent,
  profileYml,
  profileContent,
  jdText,
  noCompress,
  maxTokens: 1_048_576, // gemini-2.5-flash context window
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
IMPORTANT OPERATING RULES FOR THIS CLI SESSION
═══════════════════════════════════════════════════════
1. You do NOT have access to WebSearch, Playwright, or file writing tools.
   - For Block D (Comp research): provide salary estimates based on your training data, clearly noted as estimates.
   - For Block G (Legitimacy): analyze the JD text only; skip URL/page freshness checks.
   - Post-evaluation file saving is handled by the script, not by you.
2. ${languageInstruction}
3. Generate Blocks A through G in full.
4. At the very end, output a machine-readable summary block in this exact format:

---SCORE_SUMMARY---
COMPANY: <company name or "Unknown">
ROLE: <role title>
SCORE: <global score as decimal, e.g. 3.8>
ARCHETYPE: <detected archetype>
LEGITIMACY: <High Confidence | Proceed with Caution | Suspicious>
---END_SUMMARY---
`;

// ---------------------------------------------------------------------------
// Call Gemini API
// ---------------------------------------------------------------------------
console.log(`🤖  Calling Gemini (${modelName})... this may take 30-60 seconds.\n`);

const genAI = new GoogleGenerativeAI(apiKey);
// Prompt caching (#1709) — engine 3 of the four, adapted to Gemini's shape.
// Gemini has no `cache_control` field; its lever is the ~12K-token static prefix
// (shared + oferta + cv) being a stable `systemInstruction` rather than the first
// turn of `contents` — that's what its 2.5 models cache implicitly across
// back-to-back requests. So the static context moves to `systemInstruction` and
// generateContent() carries only the per-JD user turn. The prompt text is
// unchanged — just where it sits in the request.
const model = genAI.getGenerativeModel({
  model: modelName,
  systemInstruction: systemPrompt,
  generationConfig: {
    temperature: 0.4,      // deterministic enough for structured evaluation
    maxOutputTokens: 8192, // full 7-block evaluation
  },
});

let evaluationText;
try {
  const result = await model.generateContent(`JOB DESCRIPTION TO EVALUATE:\n\n${jdText}`);
  evaluationText = result.response.text();
  const usage = {
    prompt_tokens: result.response.usageMetadata?.promptTokenCount ?? 0,
    completion_tokens: result.response.usageMetadata?.candidatesTokenCount ?? 0,
    total_tokens: result.response.usageMetadata?.totalTokenCount ?? 0,
    cached_tokens: result.response.usageMetadata?.cachedContentTokenCount ?? 0
  };
  tracker.record('evaluation', usage);
} catch (err) {
  const sanitizedMsg = (err.message || '').split(apiKey).join('[REDACTED]');
  console.error('❌  Gemini API error:', sanitizedMsg);
  if (sanitizedMsg.includes('API_KEY')) {
    console.error('    Check your GEMINI_API_KEY in .env');
  } else if (sanitizedMsg.includes('quota') || sanitizedMsg.includes('rate')) {
    console.error('    You may have hit the free-tier rate limit. Wait 60s and retry.');
  }
  process.exit(1);
}

try {
  validateEvaluationShape(evaluationText);
} catch (err) {
  console.error('❌  Gemini output failed validation:', err.message);
  console.error('    No report was saved. Retry, lower temperature, or use the Claude pipeline for this JD.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Display evaluation
// ---------------------------------------------------------------------------
console.log('\n' + '═'.repeat(66));
console.log('  CAREER-OPS EVALUATION — powered by Google Gemini');
console.log('═'.repeat(66) + '\n');
console.log(evaluationText);

// ---------------------------------------------------------------------------
// Parse score summary
// ---------------------------------------------------------------------------
const summaryMatch = evaluationText.match(
  /---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/
);

let company    = 'unknown';
let role       = 'unknown';
let score      = '?';
let archetype  = 'unknown';
let legitimacy = 'unknown';

if (summaryMatch) {
  const block = summaryMatch[1];
  const extract = (key) => {
    const prefix = `${key}:`;
    const lines = block.split('\n');
    for (const line of lines) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith(prefix)) {
        return trimmed.slice(prefix.length).trim();
      }
    }
    return 'unknown';
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
  let reportSaved = false;
  let reservedNumbers = [];
  try {
    try {
      if (!existsSync(PATHS.reports)) {
        mkdirSync(PATHS.reports, { recursive: true });
      }

      reservedNumbers   = await reserveReportNumbers(1, { rootDir: DATA_ROOT, reportsDir: PATHS.reports });
      const num         = formatReportNumber(reservedNumbers[0]);
      const today       = new Date().toISOString().split('T')[0];
      const companySlug = slugifyCompany(company);
      const filename    = `${num}-${companySlug}-${today}.md`;
      const reportPath  = join(PATHS.reports, filename);
      const trackerPath = join(PATHS.trackerAdditions, `${num}-${companySlug}.tsv`);

      const reportContent = `# Evaluation: ${company} — ${role}

**Date:** ${today}
**Archetype:** ${archetype}
**Score:** ${score}/5
**URL:** ${postingUrl || '(pasted)'}
**Legitimacy:** ${legitimacy}
**PDF:** pending
**Tool:** Gemini (${modelName})

---

${evaluationText.replace(/---SCORE_SUMMARY---[\s\S]*?---END_SUMMARY---/, '').trim()}
`;

      writeFileSync(reportPath, reportContent, 'utf-8');
      mkdirSync(PATHS.trackerAdditions, { recursive: true });
      const trackerFields = [
        String(parseInt(num, 10)),
        today,
        tsvSafe(company),
        tsvSafe(role),
        'Evaluated',
        normalizedTrackerScore(score),
        '❌',
        `[${num}](reports/${filename})`,
        'Gemini evaluation',
      ];
      // Optional `url` column, appended only when there is a real URL to put in
      // it. merge-tracker.mjs matches on the URL FIRST -- the one tier that can
      // prove two same-title rows are different openings -- so writing it here
      // puts the row on that tier at merge time instead of leaving it to a
      // later `--backfill-urls`. Label and value are appended together: the
      // headed path resolves cells by NAME, so a value without its label would
      // be dropped, and a label without its value would leave the url cell
      // absent (#3517).
      const trackerHeader = postingUrl ? `${TSV_ADDITION_HEADER}\turl` : TSV_ADDITION_HEADER;
      if (postingUrl) trackerFields.push(tsvSafe(postingUrl));
      // Header row first: merge-tracker resolves the fields by name, so this
      // row cannot be ingested into the wrong columns (#3517).
      writeFileSync(trackerPath, `${trackerHeader}\n${trackerFields.join('\t')}\n`, 'utf-8');
      console.log(`\n✅  Report saved: reports/${filename}`);
      console.log(`📊  Tracker addition saved: batch/tracker-additions/${num}-${companySlug}.tsv`);
      reportSaved = true;
    } catch (err) {
      console.warn(`⚠️   Could not save report: ${err.message}`);
      process.exitCode = 1;
    }

    if (reportSaved) {
      try {
        const mergeOutput = execFileSync(process.execPath, [join(CODE_ROOT, 'merge-tracker.mjs')], {
          cwd: CODE_ROOT,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 30000,
        });
        if (mergeOutput.trim()) console.log(mergeOutput.trim());
        console.log('📊  Tracker merged into data/applications.md.');
      } catch (err) {
        console.warn(`⚠️   Report saved, but could not merge tracker addition into data/applications.md: ${err.message}`);
        process.exitCode = 1;
      }
    }
  } finally {
    if (reservedNumbers.length > 0) {
      try {
        await releaseReportNumbers(reservedNumbers, { rootDir: DATA_ROOT, reportsDir: PATHS.reports });
      } catch (err) {
        console.warn(`⚠️   Could not release report reservation: ${err.message}`);
      }
    }
  }
}

console.log('\n' + '─'.repeat(66));
console.log(`  Score: ${score}/5  |  Archetype: ${archetype}  |  Legitimacy: ${legitimacy}`);
console.log('─'.repeat(66) + '\n');

console.log(formatBreakdown(tracker, modelName, 'gemini'));
