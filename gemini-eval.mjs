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

import { createHash } from 'crypto';
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve, relative, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { TokenAccumulator, formatBreakdown } from './utils/token-tracker.mjs';
import { redactIfEnabled } from './utils/privacy-filter.mjs';
import {
  isPostingUrl, normalizedTrackerScore, parseScoreSummary, slugifyCompany, tsvSafe,
} from './lib/tracker-addition.mjs';
import { NO_INVENTED_PAY_RULE, normalizeEvaluationText } from './lib/eval-evidence.mjs';

const tracker = new TokenAccumulator();
tracker.recordZeroToken('scan');
tracker.recordZeroToken('pdf payload');
import { execFileSync } from 'child_process';
import { outputLanguageInstruction, parseOutputLanguage } from './profile-language.mjs';
import {
  formatReportNumber, releaseReportNumbers, reserveReportNumbers,
} from './reserve-report-num.mjs';
import { buildBudgetedPrompt } from './lib/context-budget.mjs';
import { loadYaml } from './lib/yaml-document.mjs';

// ---------------------------------------------------------------------------
// Bootstrap: load .env before anything else
// ---------------------------------------------------------------------------
try {
  const { config } = await import('dotenv');
  // The data root's .env first: doctor.mjs, remember-cli.mjs, scan.mjs and the
  // plugin engine all read it there. The working directory's .env, the only one
  // read before, still supplies what the data root's leaves unset.
  config({ path: [join(getCareerOpsRoot(), '.env'), join(process.cwd(), '.env')] });
} catch {
  // dotenv is optional — fall back to process.env if not installed
}

import { GoogleGenerativeAI } from '@google/generative-ai';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
import { getCareerOpsRoot, getProfilePath, resolveTrackerPath } from './path-resolver.mjs';
import { localToday } from './lib/local-today.mjs';
import { withJdArchiveSection } from './lib/jd-archive-section.mjs';
import { TSV_ADDITION_HEADER } from './tracker-parse.mjs';
import { assertGoogleRequestAllowed } from './lib/llm-outbound.mjs';
import { installPiiInterceptor } from './lib/pii-interceptor.mjs';

// The Google Generative AI SDK calls global fetch directly, so this ambient
// install is what covers its requests with no SDK-specific code. The explicit
// gate at the generateContent() call site is the primary layer.
installPiiInterceptor();

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
  custom:      join(DATA_ROOT, 'modes', '_custom.md'),
  profileYml:  getProfilePath(),
  reports:     join(DATA_ROOT, 'reports'),
  tracker:     resolveTrackerPath(DATA_ROOT),
  trackerAdditions: join(DATA_ROOT, 'batch', 'tracker-additions'),
};

// Determine the localization modes directory/directories and evaluation filename
// dynamically from config/profile.yml. language.modes_dir may be a single string
// (one declared market — the historical, still-default shape) or an array of
// strings (multiple simultaneously-declared candidate markets, #3793). The FIRST
// declared market is always "primary": it supplies the evaluation-mode file
// (oferta.md/angebot.md/...), because Block A-F evaluation logic can only run
// from one such file at a time. Every declared market's _shared.md is loaded
// into context (see below) so the agent can judge, from the JD's own signals —
// never from JD language alone — which declared market actually applies.
let modesDirs = ['modes'];
let evalFilename = 'oferta.md';

function stripBom(str) {
  return str.charCodeAt(0) === 0xFEFF ? str.slice(1) : str;
}

/** Validate one modes_dir candidate: must stay inside the project root and exist. */
function resolveModesDirCandidate(customModesDir) {
  if (typeof customModesDir !== 'string' || !customModesDir.trim()) return null;
  const dirPath = resolve(CODE_ROOT, customModesDir);
  const rel = relative(CODE_ROOT, dirPath);
  if (rel.startsWith('..') || isAbsolute(customModesDir)) {
    console.warn(`⚠️   modes_dir "${customModesDir}" escapes project root; skipping`);
    return null;
  }
  if (!existsSync(dirPath)) {
    console.warn(`⚠️   modes_dir "${customModesDir}" not found; skipping`);
    return null;
  }
  return customModesDir;
}

// Same recognition as resolveEvalModeFile in web/src/lib/career-ops.ts: the
// evaluation mode is the markdown file whose title states the block range it
// produces (A-F, A-G, or A-H; the dash may be ASCII or typographic). A
// filename allow-list goes stale whenever a market ships under a new name
// (#6398: annuncio, vacature, gonggo, lowongan, offer, tuyen-dung).
const EVAL_MODE_TITLE_RE = /A[-\u2010-\u2015][F-H]/;

function findEvaluationModeFile(dir) {
  let names;
  try {
    names = readdirSync(join(CODE_ROOT, dir));
  } catch {
    return null;
  }
  for (const name of names.sort()) {
    if (!name.endsWith('.md') || name.startsWith('_') || name === 'README.md') continue;
    try {
      const first = readFileSync(join(CODE_ROOT, dir, name), 'utf8').split('\n', 1)[0] ?? '';
      if (EVAL_MODE_TITLE_RE.test(first)) return name;
    } catch {
      // Unreadable file — keep looking.
    }
  }
  return null;
}

if (existsSync(PATHS.profileYml)) {
  try {
    const yamlContent = stripBom(readFileSync(PATHS.profileYml, 'utf-8'));
    const profile = loadYaml(yamlContent);
    const rawModesDir = profile && profile.language && profile.language.modes_dir;
    if (rawModesDir) {
      const candidates = Array.isArray(rawModesDir) ? rawModesDir : [rawModesDir];
      // AGENTS.md "Output Language vs Market Modes": the FIRST declared entry
      // is always primary. Resolve IT first, before touching the rest — an
      // unusable primary falls back to the DEFAULT evaluation mode, and must
      // NEVER silently promote a later declared market into the primary slot
      // (that would evaluate against the wrong market's A-F rules without
      // anyone asking for it).
      const primaryRaw = candidates[0];
      const primaryDir = resolveModesDirCandidate(primaryRaw);
      const primaryEvalFile = primaryDir && findEvaluationModeFile(primaryDir);
      const extras = candidates.slice(1).map(resolveModesDirCandidate).filter(Boolean);
      if (primaryDir && primaryEvalFile) {
        // Primary resolved. Any further declared markets only need to exist —
        // they contribute _shared.md context (below), never an evaluation
        // mode file of their own.
        modesDirs = [primaryDir, ...extras];
        evalFilename = primaryEvalFile;
      } else {
        // Primary directory exists but has no recognizable evaluation-mode
        // file in it — fall back to the default (modes/oferta.md), not to
        // any secondary declared market.
        if (primaryDir) {
          console.warn(`⚠️   No matching evaluation file found in ${primaryDir}; using default modes/oferta.md`);
        }
        // The primary may still have useful _shared.md context even when its
        // evaluation file is missing. Keep it after the default evaluation
        // directory, then append valid secondary markets.
        modesDirs = ['modes', ...(primaryDir && primaryDir !== 'modes' ? [primaryDir] : []), ...extras.filter((dir) => dir !== 'modes' && dir !== primaryDir)];
      }
      // else: resolveModesDirCandidate(primaryRaw) already warned why the
      // primary itself could not be resolved; falling through to the default
      // modes/oferta.md below.
    }
  } catch (err) {
    console.warn(`⚠️   Could not parse config/profile.yml: ${err.message}`);
  }
}

const modesDir = modesDirs[0];
PATHS.shared = join(CODE_ROOT, modesDir, '_shared.md');
PATHS.oferta = join(CODE_ROOT, modesDir, evalFilename);
// Additional declared markets (modes_dir given as an array with 2+ entries):
// their _shared.md files are read alongside the primary one further below.
const extraModesDirs = modesDirs.slice(1);

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
    --context-only   Print the resolved context/token budget and exit — never calls Gemini. Deterministic; used by automated tests to verify modes_dir resolution without live API calls.
    --help           Show this help

  SETUP
    1. Get a free API key at https://aistudio.google.com/apikey
    2. Add GEMINI_API_KEY=<your-key> to .env
    3. Run: npm install   (installs @google/generative-ai + dotenv)

  EXAMPLES
    node gemini-eval.mjs "We are looking for a Senior AI Engineer..."
    node gemini-eval.mjs --file ./jds/openai-swe.txt
    node gemini-eval.mjs --posting-url https://acme.com/jobs/42 --file ./jds/openai-swe.txt
    node gemini-eval.mjs --context-only --file ./jds/openai-swe.txt  # print context budget without calling Gemini
`);
  process.exit(0);
}

// Parse flags
let jdText = '';
let postingUrl = '';
let modelName = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
let saveReport = true;
let noCompress = false;
let contextOnly = false;

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
  } else if (args[i] === '--context-only') {
    contextOnly = true;
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

  // Read the way the other evaluators read it (#6332): parseScoreSummary()
  // drops the bold and bullet marks a model puts on the keys
  // (`**COMPANY:** Acme`, `- **SCORE**: 4.2/5`). Matched with `^KEY:`, a
  // bolded summary failed this check, and the evaluation was thrown away.
  const summary = parseScoreSummary(text);
  if (!summary) {
    issues.push('missing SCORE_SUMMARY block');
  } else {
    for (const key of ['company', 'role', 'archetype', 'legitimacy']) {
      const value = summary[key].trim();
      if (!value || (key !== 'company' && value.toLowerCase() === 'unknown')) {
        issues.push(`SCORE_SUMMARY ${key.toUpperCase()} is required`);
      }
    }

    const score = summary.score.match(/^([0-9]+(?:\.[0-9]+)?)/);
    const scoreValue = score ? Number(score[1]) : NaN;
    if (!Number.isFinite(scoreValue) || scoreValue < 0 || scoreValue > 5) {
      issues.push('SCORE_SUMMARY score must be a number between 0 and 5');
    }
  }

  if (issues.length > 0) {
    throw new Error(`Gemini returned an invalid career-ops report: ${issues.join('; ')}`);
  }
}

// ---------------------------------------------------------------------------
// Load context files
// ---------------------------------------------------------------------------
console.log('\n📂  Loading context files...');

const sharedLabel = join(modesDir, '_shared.md').replace(/\\/g, '/');
const ofertaLabel = join(modesDir, evalFilename).replace(/\\/g, '/');
let sharedContext    = readFile(PATHS.shared,      sharedLabel);
const ofertaLogic    = readFile(PATHS.oferta,      ofertaLabel);
// Market evaluation files are a layer over the canonical procedure: they cite
// its gates, provenance rule and scoring bands, then add local vocabulary.
// The web focused-evaluation path keeps those canonical rules and appends
// market text as context that does not replace them (evaluation-options.mjs,
// "MARKET CONTEXT (canonical scoring rules still apply)"). Gemini inlines
// both, in that order. modes/oferta.md itself is not included twice.
const CANONICAL_OFERTA_REL = 'modes/oferta.md';
const MARKET_CONTEXT_MARK = '\n\n--- MARKET CONTEXT (canonical scoring rules still apply) ---\n';
const resolvedOfertaRel = relative(CODE_ROOT, PATHS.oferta).replaceAll('\\', '/');
const ofertaPrompt = resolvedOfertaRel === CANONICAL_OFERTA_REL
  ? ofertaLogic
  : `${readFile(join(CODE_ROOT, CANONICAL_OFERTA_REL), CANONICAL_OFERTA_REL)}${MARKET_CONTEXT_MARK}${ofertaLogic}`;

// Multi-market (#3793): fold in every OTHER declared market's _shared.md so the
// agent has all declared candidates' vocabulary/legal-concept context, not just
// the primary one. It must pick per-JD by market signal (hiring-entity
// jurisdiction, currency, benefits/legal vocabulary), never by JD language alone
// — see AGENTS.md "Output Language vs Market Modes".
for (const extraDir of extraModesDirs) {
  const extraLabel = join(extraDir, '_shared.md').replace(/\\/g, '/');
  const extraContent = readFile(join(CODE_ROOT, extraDir, '_shared.md'), extraLabel);
  sharedContext += `\n\n--- Additional declared market: ${extraDir} (${extraLabel}) ---\n${extraContent}`;
}
// Opt-in privacy filter (privacy.redact_contact_info in config/profile.yml):
// keep name/contact details out of the prompt sent to the model.
const profileYmlRaw  = readFile(PATHS.profileYml,  'config/profile.yml');
const cvContent      = redactIfEnabled(readFile(PATHS.cv,      'cv.md'),            profileYmlRaw);
const profileContent = redactIfEnabled(readFile(PATHS.profile, 'modes/_profile.md'), profileYmlRaw);
const profileYml     = redactIfEnabled(profileYmlRaw, profileYmlRaw);
// _custom.md is optional: an absent file is a valid end state, so no warning.
const customContent  = existsSync(PATHS.custom) ? stripBom(readFileSync(PATHS.custom, 'utf-8')).trim() : '';
const languageInstruction = outputLanguageInstruction(parseOutputLanguage(profileYml));

// ---------------------------------------------------------------------------
// Build the system prompt with token budget management
// ---------------------------------------------------------------------------
const { contextBody, budgetReport } = buildBudgetedPrompt({
  sharedContent: sharedContext,
  ofertaContent: ofertaPrompt,
  cvContent,
  profileYml,
  profileContent,
  customContent,
  jdText,
  // The user turn below carries the JD. Left in the context too, it went to
  // Gemini twice, inside systemInstruction and again as the user turn; it is
  // still counted toward the budget once (#3950, as in openai-eval.mjs).
  jdInContext: false,
  noCompress,
  maxTokens: 1_048_576, // gemini-2.5-flash context window
});

if (contextOnly) {
  const resolvedEvalMode = relative(CODE_ROOT, PATHS.oferta).replaceAll('\\', '/');
  console.log(`🧭  Evaluation mode: ${resolvedEvalMode}`);
  // Fingerprints of the strings actually concatenated into the prompt, so a
  // test can check order without printing the mode files (they name _custom.md,
  // and an absent _custom.md must stay silent on stdout).
  const evaluationFingerprint = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
  if (resolvedEvalMode === CANONICAL_OFERTA_REL) {
    console.log(`🧭  Evaluation stack: ${CANONICAL_OFERTA_REL} ${evaluationFingerprint(ofertaPrompt)}`);
  } else {
    const splitAt = ofertaPrompt.indexOf(MARKET_CONTEXT_MARK);
    const prefix = splitAt === -1 ? '' : ofertaPrompt.slice(0, splitAt);
    const suffix = splitAt === -1 ? '' : ofertaPrompt.slice(splitAt + MARKET_CONTEXT_MARK.length);
    console.log(`🧭  Evaluation stack: ${CANONICAL_OFERTA_REL} ${evaluationFingerprint(prefix)} -> ${resolvedEvalMode} ${evaluationFingerprint(suffix)}`);
  }
}

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
   - ${NO_INVENTED_PAY_RULE}
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

// Deterministic seam for context-resolution tests. This reports the computed
// budget without constructing a client or making a network request.
if (!contextOnly) {

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
  // Privacy gate. `assertGoogleRequestAllowed` builds the request body from the
  // same systemInstruction and user turn the SDK receives, so the inspected
  // payload and the transmitted one are the same request. The SDK issues its own
  // global fetch, so the ambient interceptor is the backstop for anything this
  // reconstruction misses.
  const userTurn = `JOB DESCRIPTION TO EVALUATE:\n\n${jdText}`;
  assertGoogleRequestAllowed({
    systemInstruction: systemPrompt,
    turns: [userTurn],
  });
  const result = await model.generateContent(userTurn);
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

evaluationText = normalizeEvaluationText(evaluationText, jdText);

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
// The same reading the validator above passed (parseScoreSummary, #6332).
const summary    = parseScoreSummary(evaluationText);
const company    = summary?.company    || 'unknown';
const role       = summary?.role       || 'unknown';
const score      = summary?.score      || '?';
const archetype  = summary?.archetype  || 'unknown';
const legitimacy = summary?.legitimacy || 'unknown';

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

${withJdArchiveSection(evaluationText.replace(/---SCORE_SUMMARY---[\s\S]*?---END_SUMMARY---/, '').trim(), jdText).trimEnd()}
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
}
