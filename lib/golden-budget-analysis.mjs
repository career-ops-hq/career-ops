#!/usr/bin/env node
/**
 * golden-budget-analysis.mjs — Static token budget analysis for golden cases
 *
 * For each golden case at multiple budget tiers + CV lengths, computes:
 *   1. Token count with full context (--no-compress)
 *   2. Token count with compressed context (default)
 *   3. Which sections would be trimmed
 *   4. Whether any P0 section would be affected (should NEVER happen)
 *
 * Zero API calls — purely static analysis of the compression logic against
 * the actual _shared.md and golden case JDs.
 *
 * Usage:
 *   node lib/golden-budget-analysis.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildBudgetedPrompt, SECTION_PRIORITY } from './context-budget.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN_DIR = join(ROOT, 'evals', 'golden');

if (!existsSync(GOLDEN_DIR)) {
  console.error('Golden directory not found:', GOLDEN_DIR);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load context files
// ---------------------------------------------------------------------------
function readFile(path, label) {
  if (!existsSync(path)) {
    console.warn(`  ⚠️  ${label} not found: ${path}`);
    return `[${label} not found]`;
  }
  return readFileSync(path, 'utf-8').trim();
}

const sharedContent = readFile(join(ROOT, 'modes', '_shared.md'), '_shared.md');
const ofertaContent = readFile(join(ROOT, 'modes', 'oferta.md'), 'oferta.md');

const p0Keys = Object.entries(SECTION_PRIORITY)
  .filter(([, p]) => p === 0)
  .map(([k]) => k);

// ---------------------------------------------------------------------------
// Synthetic CVs — a real cv.md is 500-3000 lines of markdown.
// ---------------------------------------------------------------------------
const CV_BLURB = [
  '',
  '### Head of AI — TechCorp (2022-Present)',
  '- Built multi-agent orchestration platform serving 2M+ requests/day',
  '- Reduced inference latency 40% via custom batching and KV-cache optimization',
  '- Managed $1.2M GPU budget across AWS and GCP',
  '- Hired and mentored team of 6 ML engineers',
  '- Designed evaluation framework with 95% recall on regression detection',
  '',
  '### Senior ML Engineer — StartupAI (2020-2022)',
  '- Designed RAG pipeline over 50M documents using pgvector + Cohere embeddings',
  '- Built evaluation framework (ragas + custom metrics) catching 23% of bad retrievals',
  '- Shipped 3 product features from 0→1 in 18 months',
  '- Migrated training pipeline from CPU to GPU, reducing epoch time from 4h to 12min',
  '',
  '### ML Engineer — DataCo (2018-2020)',
  '- Deployed first production NLP pipeline (NER + classification)',
  '- Migrated legacy ML infra to Kubernetes, cutting costs 35%',
  '- Built internal feature store serving 50+ model endpoints',
  '',
  '## Skills',
  'Python, PyTorch, LangChain, Vector DBs (pgvector, Pinecone, Qdrant), Kubernetes,',
  'AWS/GCP, Docker, CI/CD, Prompt Engineering, Evals & Observability,',
  'Ray, MLflow, Weights & Biases, Terraform, GraphQL, gRPC, PostgreSQL, Redis,',
  '',
  '## Projects & Publications',
  '- "Scaling RAG to 50M Documents" — blog post, 12K reads on medium',
  '- Open-source contributor: LangChain (3 PRs), pgvector (1 PR)',
  '- Speaker: AI Engineer Summit 2025, MLOps Community Berlin',
  '- Built internal code-review bot using LLMs, adopted by 3 teams',
  '',
  '## Education',
  'MS Computer Science, Stanford University (2018)',
  'BS Computer Science, UC Berkeley (2016)',
];

function makeCV(repeatBlurb) {
  const header = [
    '# John Doe — Senior AI Engineer',
    '',
    '## Summary',
    'Senior AI/ML engineer with 8+ years building production LLM systems,',
    'RAG pipelines, and agent orchestration platforms. Led teams of 3-8 engineers.',
  ];
  return header.concat(...Array(repeatBlurb).fill(CV_BLURB).flat()).join('\n');
}

// Short CV — ~38 lines, ~1.7K chars (concise, well-edited)
const CV_SHORT = makeCV(1);
// Long CV — ~170 lines, ~7.8K chars (detailed, many projects & publications)
const CV_LONG  = makeCV(5);

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
const SCENARIOS = {
  // 1. Most common case: Gemini Flash free tier → no need to compress at all.
  //    _shared + oferta + short CV + JD ≈ 16K tokens, budget = 120K.
  'Gemini Flash, short CV — baseline (no compression needed)':
    { cv: CV_SHORT, budget: 128000, margin: 8192 },

  // 2. Realistic cost-saving: medium-context model, detailed CV.
  //    Prompt ≈ 17K tokens, budget = 16K → saves ~7% by trimming P2.
  'Medium model, long CV — cost-saving mode (20K budget)':
    { cv: CV_LONG,  budget:  20000, margin: 4096 },

  // 3. Survival mode: small local model, even a short CV overflows.
  //    Prompt ≈ 16K tokens, budget = 6K → saves ~26%, P2+P1 trimmed.
  'Ollama 8K, short CV — survival mode (6K budget)':
    { cv: CV_SHORT, budget:   8000, margin: 2000 },
};

// ---------------------------------------------------------------------------
// Analyze each golden case
// ---------------------------------------------------------------------------
const caseFiles = readdirSync(GOLDEN_DIR).filter(f => f.endsWith('.json'));

for (const [scenarioName, { cv, budget, margin }] of Object.entries(SCENARIOS)) {
  const cvLines = cv.split('\n').length;
  console.log(`\n${'═'.repeat(90)}`);
  console.log(`Scenario: ${scenarioName}`);
  console.log(`CV: ${cv.length} chars, ${cvLines} lines  |  Budget: ${budget - margin} tokens`);
  console.log(`${'═'.repeat(90)}\n`);

  const results = [];
  let totalTokensSaved = 0;
  let totalCasesCompressed = 0;

  for (const file of caseFiles) {
    const tc = JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf8'));

    // Run with compression (default)
    const { budgetReport: compressedReport } = buildBudgetedPrompt({
      sharedContent,
      ofertaContent,
      cvContent: cv,
      jdText: tc.jd,
      maxTokens: budget,
      safetyMargin: margin,
    });

    // Run without compression (--no-compress)
    const { budgetReport: fullReport } = buildBudgetedPrompt({
      sharedContent,
      ofertaContent,
      cvContent: cv,
      jdText: tc.jd,
      maxTokens: budget,
      safetyMargin: margin,
      noCompress: true,
    });

    const saved = fullReport.totalTokens - compressedReport.afterTokens;
    const savedPct = fullReport.totalTokens > 0
      ? Math.round((saved / fullReport.totalTokens) * 100)
      : 0;

    // Safety check: are any P0 sections in the removed list?
    const p0Violated = compressedReport.removed.some(name => {
      const key = name.toLowerCase()
        .replace(/\s*\([^)]*\)\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return p0Keys.includes(key);
    });

    if (compressedReport.compressed) totalCasesCompressed++;
    totalTokensSaved += saved;

    results.push({
      id: tc.id,
      labelArchetype: tc.label.archetype,
      labelScore: tc.label.score,
      compressed: compressedReport.compressed,
      beforeTokens: fullReport.totalTokens,
      afterTokens: compressedReport.afterTokens,
      saved,
      savedPct,
      removed: compressedReport.removed,
      p0Violated,
    });
  }

  // Per-case table
  console.log('Case                           | Archetype (label)         | Before  | After   | Saved |  % | Status');
  console.log('───────────────────────────────┼───────────────────────────┼─────────┼─────────┼───────┼────┼───────');

  let p0Clean = true;
  for (const r of results) {
    const id = r.id.padEnd(29).slice(0, 29);
    const arch = r.labelArchetype.padEnd(25).slice(0, 25);
    const savedStr = String(r.saved).padStart(5);
    const pctStr = (r.savedPct + '%').padStart(3);
    const status = r.compressed
      ? (r.p0Violated ? '⚠️ P0 VIOLATION' : '✅ compressed')
      : '  not needed';

    if (r.p0Violated) p0Clean = false;
    console.log(`${id} | ${arch} | ${String(r.beforeTokens).padStart(7)} | ${String(r.afterTokens).padStart(7)} | ${savedStr} | ${pctStr} | ${status}`);
  }

  // Summary
  const avgSavedPct = results.length > 0
    ? Math.round(results.reduce((s, r) => s + r.savedPct, 0) / results.length)
    : 0;

  console.log(`\n  Summary:`);
  console.log(`  Cases compressed:     ${totalCasesCompressed}/${results.length}`);
  console.log(`  Avg tokens saved:     ${results.length > 0 ? Math.round(totalTokensSaved / results.length) : 0}/case`);
  console.log(`  Avg savings %:        ${avgSavedPct}%`);
  console.log(`  P0 integrity:         ${p0Clean ? '✅ CLEAN — no P0 section trimmed' : '❌ VIOLATED'}`);

  if (totalCasesCompressed > 0) {
    const trimCounts = {};
    for (const r of results) {
      for (const name of r.removed) {
        trimCounts[name] = (trimCounts[name] || 0) + 1;
      }
    }
    console.log(`  Trimmed sections:`);
    const sorted = Object.entries(trimCounts).sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sorted) {
      const key = name.toLowerCase()
        .replace(/\s*\([^)]*\)\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const p = SECTION_PRIORITY[key];
      const label = p != null ? `P${p}` : `P${2}*`;
      console.log(`    ${label} — ${name} (${count}/${results.length})`);
    }
  }
}

console.log('');
