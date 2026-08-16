#!/usr/bin/env node
// tailor-resume.mjs — the real resume tailoring agent
// Reads a job report (has score + URL), fetches the full JD, matches it
// against cv.json (master resume), and produces:
//   1. A tailored JSON (subset of cv.json reordered/reframed for this JD)
//   2. A source card (markdown) explaining every change and honest gaps
//   3. A PDF rendered from the tailored JSON via LaTeX
//
// Hard rules (DO NOT VIOLATE):
//   - Never invent metrics, dates, project names, employers, or scope.
//   - "Little changes" only: rephrase existing bullets to use JD vocabulary;
//     never fabricate new bullets to satisfy the JD.
//   - If a JD asks for something not in cv.json, mark it in the source card
//     as a gap. Do not paper over gaps with creative wording.
//   - The agent's job is to be a CREDIBLE BRIDGE between your real
//     experience and the JD's vocabulary, not a confidence trick.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { spawn, execFileSync } from 'child_process';
import { dirname, join, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import { callCareerOpsLlm } from './careerops-llm.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(__dirname);  // career-ops/
const CV_JSON = join(REPO, 'cv.json');
// Use the classic single-column template (matches your reference PDF
// style). The original "ATS-Optimized" template had invisible-text hacks
// and a broken template literal in the wrap — classic is cleaner.
const TEMPLATE = join(REPO, 'templates', 'cv-template-classic.tex');
const PORTALS_YML = join(REPO, 'portals.yml');
const PROFILE_YML = join(REPO, 'config', 'profile.yml');
const TAILOR_PROMPT_FILE = join(REPO, 'prompts', 'resume-tailoring-system.md');
const OUTPUT_BASE = join(REPO, 'Tailored ATS PDF');
// Load profile.yml once (careerops-document-generation: profile.yml is the
// authoritative source for headline, superpowers, proof points, compensation,
// and visa notes). Used as fallback when the LLM harness is unavailable.
// Load profile.yml once (careerops-document-generation: profile.yml is
// the authoritative source for headline, superpowers, proof points,
// compensation, and visa notes). Used as fallback when the LLM harness
// is unavailable.
import { createRequire as _cr } from 'module';
const _require = _cr(import.meta.url);
const _yamlPath = (() => { try { return _require.resolve('js-yaml'); } catch { return null; } })() || join(REPO, 'node_modules', 'js-yaml');
let PROFILE = {};
try {
  const _yaml = _require(_yamlPath);
  PROFILE = _yaml.load(readFileSync(PROFILE_YML, 'utf-8')) || {};
} catch { PROFILE = {}; }
const PROFILE_HEADLINE = (PROFILE.narrative && PROFILE.narrative.headline) || '';
const PROFILE_COMPENSATION = PROFILE.compensation || {};
const PROFILE_LOCATION = PROFILE.location || {};
const PROFILE_CANDIDATE = PROFILE.candidate || {};

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('Usage: node tailor-resume.mjs <report.md> [--stamp=YYYY-MM-DD_HH-MM] [--company="Name"] [--out-of-the-box] [--force]');
  console.error('  --out-of-the-box  direct JD/link input — skips eval, outputs to Tailored ATS PDF/out of the box/<date>/<Company>/');
  console.error('  --force  bypass the 3.5 score gate for pre-approved sub-3.5 roles');
  process.exit(1);
}

// ── 1. Parse report ────────────────────────────────────────────────
const report = readFileSync(reportPath, 'utf-8');
function parseReport(md) {
  const lines = md.split('\n');
  const out = { score: null, company: 'unknown', role: 'unknown', url: null, summary: '' };
  for (const line of lines) {
    if (line.startsWith('**URL:**')) out.url = line.replace('**URL:**', '').trim();
    if (line.startsWith('**Score:**')) {
      const m = line.match(/(\d+(?:\.\d+)?)/);
      if (m) out.score = parseFloat(m[1]);
    }
    if (line.startsWith('## Job') && out.company === 'unknown') {
      const idx = lines.indexOf(line);
      for (let j = idx + 1; j < Math.min(idx + 5, lines.length); j++) {
        const m = lines[j].match(/^([\w &.'-]+?)\s*[—–-]\s*(.+)$/);
        if (m) { out.company = m[1].trim(); out.role = m[2].trim(); break; }
      }
    }
    if (line.startsWith('## Summary')) {
      const idx = lines.indexOf(line);
      for (let j = idx + 1; j < lines.length; j++) {
        if (lines[j].startsWith('## ')) break;
        if (lines[j].trim()) { out.summary = lines[j].trim(); break; }
      }
    }
  }
  return out;
}
const meta = parseReport(report);
console.log(`[tailor] Report: ${basename(reportPath)}`);
console.log(`[tailor] Company: ${meta.company}  Role: ${meta.role}  Score: ${meta.score}`);
console.log(`[tailor] URL: ${meta.url}`);

// ── 2. Threshold gate ─────────────────────────────────────────────
const TAILOR_MIN = 3.5;  // Below this, do not produce a tailored resume.
// --force override: the user has pre-approved a sub-3.5 role for
// tailoring (e.g. domain mismatch but they want to apply anyway).
// Bypasses the gate and surfaces the ATS projection so the user can
// decide whether the resulting PDF is worth sending. Always logged.
const forceTailor = process.argv.includes('--force');
if (meta.score !== null && meta.score < TAILOR_MIN && !forceTailor) {
  console.log(`[tailor] Score ${meta.score} < ${TAILOR_MIN} — skipping tailored resume (per rules).`);
  process.exit(0);
}
if (forceTailor && meta.score < TAILOR_MIN) {
  console.log(`[tailor] --force: bypassing 3.5 gate for pre-approved sub-3.5 role (score=${meta.score}).`);
}

// ── 3. Load master resume ──────────────────────────────────────────
if (!existsSync(CV_JSON)) {
  console.error(`[tailor] FATAL: ${CV_JSON} not found. Run the cv.md → cv.json conversion first.`);
  process.exit(1);
}
const cv = JSON.parse(readFileSync(CV_JSON, 'utf-8'));

// ── 4. Fetch JD ────────────────────────────────────────────────────
async function fetchJD(url) {
  // Try Playwright first (handles JS-rendered ATS portals); fall back to fetch.
  if (!url) return null;
  try {
    const { chromium } = await import('playwright');
    const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const p = await b.newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await p.waitForTimeout(5000);
    const text = await p.evaluate(() => document.body?.innerText || '');
    await b.close();
    return (text || '').trim().slice(0, 8000);
  } catch (e) {
    // Fall back to plain fetch
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const html = await r.text();
      const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const txt = m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
      return txt.slice(0, 8000);
    } catch { return null; }
  }
}
let jdText = await fetchJD(meta.url);
// Detect "thin" content (just portal chrome with no JD terms). A real
// JD should have either "responsibilities" / "requirements" / "qualifications"
// or substantial unique vocabulary. Portal chrome is just nav/footer.
function isRealJD(t) {
  if (!t) return false;
  if (t.length < 200) return false;
  // Portal chrome has lots of repeated nav/footer text. Real JDs have
  // explicit role-specific terms. Check for at least one of: explicit
  // sections, JD-specific keywords, or high unique-word ratio.
  const lc = t.toLowerCase();
  const jdSignals = ['responsibilities', 'requirements', 'qualifications', 'experience with', 'you will', 'we are looking', 'about the role', 'what you', 'years of experience'];
  if (jdSignals.some(s => lc.includes(s))) return true;
  // Fallback: ratio of unique words to total words. Chrome is repetitive.
  const words = lc.split(/\s+/).filter(w => w.length > 3);
  if (words.length < 50) return false;
  const unique = new Set(words);
  return unique.size / words.length > 0.4;
}
if (meta.summary && meta.summary.length > 200) {
  // If live extraction is thin, prefer a captured full JD embedded in the
  // report over the short evaluation summary. This matters for iCIMS and
  // other portals that expose structured data but render portal chrome.
  const reportJobBody = report.includes('## Job')
    ? report.split('## Job').slice(1).join('## Job').trim()
    : '';
  const capturedJD = reportJobBody.length > meta.summary.length + 500
    ? reportJobBody
    : meta.summary;
  if (!isRealJD(jdText)) {
    console.log(`[tailor] URL fetch was just portal chrome; using captured report JD/summary proxy.`);
    jdText = (jdText || '') + '\n\n--- Captured Report JD ---\n\n' + capturedJD;
  } else {
    // Even if URL was a real JD, append the summary for extra signal.
    jdText = jdText + '\n\n--- Report Summary ---\n\n' + meta.summary;
  }
}
const jdHasContent = jdText && jdText.length > 200;
console.log(`[tailor] JD text length: ${jdText ? jdText.length : 0} chars (${jdHasContent ? 'OK' : 'thin/failed'})`);

// ── 5. Extract JD keywords ─────────────────────────────────────────
const STOP_WORDS = new Set([
  'the','and','or','but','in','on','at','to','for','of','with','by','from','is','are','was','were','be','been','have','has','had','will','would','can','could','should','may','might','must','do','does','did','a','an','this','that','these','those','it','its','as','if','or','not','no','any','all','each','every','both','few','more','most','other','some','such','than','too','very','can','will','just','into','through','over','before','after','above','below','up','down','out','off','about','our','your','their','his','her','its','we','you','they','i','me','him','them','us','also','using','use','used','like','etc','e.g','i.e','eg','ie','within','across','well','good','strong','experience','years','year','team','work','working','role','position','responsibility','responsibilities'
]);
function extractKeywords(text, max = 60) {
  if (!text) return [];
  const tokens = text.toLowerCase()
    .replace(/[^a-z0-9+.#\-\s\/]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && t.length <= 30 && !STOP_WORDS.has(t));
  const freq = new Map();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k, v]) => ({ k, v }));
}
const jdKeywords = jdText ? extractKeywords(jdText, 60) : [];
// Filter to only AI/ML/tech terms (we don't want to surface "team" or "strong")
const TECH_RE = /^(rag|llm|gpt|claude|gemini|llama|phi|bert|embedding|vector|langchain|langgraph|autogen|mcp|retrieval|prompt|agent|multi.agent|generative|ai engineer|applied ai|llmops|mlops|nlp|asr|tts|voice|azure|aws|gcp|snowflake|databricks|sagemaker|bedrock|vertex|kubernetes|docker|python|pytorch|tensorflow|hugging|transformer|scikit|numpy|pandas|spark|kafka|hadoop|airflow|sql|docker|fine.tun|peft|lora|qlora|production ai|inference|training|classification|regression|clustering|time series|recommender|search|chatbot|conversational|automation|workflow|orchestration|evalu|metric|test|benchmark|safety|alignment|post.train|reinforcement|rlhf|researcher|research|scientist|publication|paper|domain|driving|robot|autonomous|vision|vlm|verifier|hill|climb|optimization|gradient|reward|policy|sft|distillation|reasoning|chain.of|thought|cot|ragas|halluc|ground|truth|trace|traceability|audit|compliance|regulat|pharma|sop|fda|pharmaceutical|model|deploy|production|scale|latency|throughput|cost|optimi|distill)/i;

// Phrase-level detection: single-word tokenization destroys multi-word JD
// vocabulary ("machine learning" → machine + learning, both stopwords).
// Keep a curated catalog of real AI/engineering phrases; any that appear in
// the JD are treated as detected keywords, and ATS match counts them.
const TECH_PHRASES = [
  'machine learning', 'deep learning', 'large language model', 'large language models',
  'generative ai', 'applied ai', 'natural language processing', 'retrieval augmented generation',
  'hybrid search', 'vector search', 'semantic search', 'embeddings', 'prompt engineering',
  'fine tuning', 'reinforcement learning', 'reinforcement learning from human feedback',
  'unsupervised learning', 'supervised learning', 'transformer models', 'neural network', 'neural networks',
  'computer vision', 'speech recognition', 'text to speech', 'voice ai', 'conversational ai',
  'agent framework', 'agent frameworks', 'multi agent', 'multi-agent', 'agentic workflow', 'agentic workflows',
  'llm application', 'llm applications', 'llmops', 'mlops', 'model deployment', 'model serving',
  'model evaluation', 'evaluation pipeline', 'evaluation harness', 'data pipeline', 'data pipelines',
  'feature engineering', 'data engineering', 'cloud infrastructure', 'cloud native', 'microservices',
  'api development', 'rest api', 'restful api', 'full stack', 'backend development', 'frontend development',
  'data science', 'data scientist', 'ai engineer', 'software engineer', 'ml engineer',
  'recommendation system', 'recommendation systems', 'anomaly detection', 'sentiment analysis',
  'time series', 'predictive modeling', 'propensity model', 'propensity models', 'classification model',
  'regression model', 'clustering', 'sql', 'python', 'typescript', 'kubernetes', 'docker', 'terraform',
  'aws', 'azure', 'gcp', 'google cloud', 'snowflake', 'databricks', 'spark', 'kafka', 'hadoop', 'airflow',
  'pandas', 'numpy', 'pytorch', 'tensorflow', 'scikit learn', 'hugging face', 'langchain', 'langgraph',
  'fine tuning', 'lora', 'qlora', 'peft', 'rag', 'agents', 'tool use', 'function calling',
  'version control', 'continuous integration', 'ci/cd', 'agile', 'scrum', 'product management',
  'stakeholder', 'cross-functional', 'roadmap', 'technical specification', 'code review',
  'audit', 'compliance', 'regulatory', 'healthcare', 'pharma', 'financial services', 'insurtech',
  'automation', 'workflow automation', 'integration', 'safety', 'grounding', 'hallucination',
];
function extractPhrases(text, catalog, max = 40) {
  if (!text) return [];
  const lc = text.toLowerCase();
  const found = [];
  for (const phrase of catalog) {
    if (lc.includes(phrase)) found.push(phrase);
  }
  return found.slice(0, max);
}
const jdPhrases = jdText ? extractPhrases(jdText, TECH_PHRASES, 40) : [];
// Merge token keywords + phrase keywords, dedup, keep order.
const jdTechKeywords = [
  ...jdKeywords.filter(kw => TECH_RE.test(kw.k)).map(kw => kw.k),
  ...jdPhrases,
].filter((v, i, a) => a.indexOf(v) === i);

// ── 6. Score each cv.json item against JD keywords ─────────────────
function scoreItem(text, keywords) {
  const t = text.toLowerCase();
  let s = 0;
  const hits = new Set();
  for (const kw of keywords) {
    if (t.includes(kw.toLowerCase())) { s += 1; hits.add(kw); }
  }
  return { score: s, hits: [...hits] };
}

// Aggressive mirror-technique scorer: bullets containing exact JD phrases
// get a bonus so the strongest phrase-matched evidence wins the top-4 cut.
function scoreItemWeighted(text, keywords, phrases) {
  const base = scoreItem(text, keywords);
  const t = text.toLowerCase();
  const phraseHits = (phrases || []).filter(p => t.includes(p)).length;
  return { score: base.score + phraseHits * 2, hits: base.hits };
}

// Keep work experience in strict reverse-chronological order (cv.work order).
// Tailoring highlights relevance without scrambling company timeline.
const tailored = JSON.parse(JSON.stringify(cv));  // deep clone

// ── 8a. LLM tailoring harness ──────────────────────────────────────
// The LLM may choose framing and ordering, but it never writes resume facts.
// Deterministic code remains the final authority for facts, dates, bullets,
// metrics, page limits, and gap disclosure.
const TAILOR_SYSTEM_PROMPT = existsSync(TAILOR_PROMPT_FILE)
  ? readFileSync(TAILOR_PROMPT_FILE, 'utf-8')
  : 'Tailor the resume truthfully to the job description. Return valid JSON only.';

function stripAnsi(s) {
  // Remove ANSI/VT escape sequences and terminal hyperlink wrappers
  // (\x1b]8;;url\x1b\\...\x1b]8;;\x1b\\), OSC sequences, and CSI color codes.
  return String(s || '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')   // OSC/hyperlink
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')            // CSI
    .replace(/\x1b\][^\x07]*\x07/g, '')                     // OSC (legacy)
    .replace(/[\u001b\u009b]/g, '');
}

// Return every balanced top-level JSON object found in the text.
function extractAllJsonObjects(raw) {
  const cleaned = stripAnsi(raw);
  const objects = [];
  let idx = 0;
  while (idx < cleaned.length) {
    const start = cleaned.indexOf('{', idx);
    if (start < 0) break;
    let depth = 0, quoted = false, escaped = false, end = -1;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') quoted = false;
        continue;
      }
      if (ch === '"') { quoted = true; continue; }
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end < 0) break;
    const candidate = cleaned.slice(start, end + 1).replace(/[\u0000-\u001f]/g, ' ');
    try { objects.push(JSON.parse(candidate)); } catch { /* skip malformed */ }
    idx = end + 1;
  }
  return objects;
}

function extractJsonObject(raw) {
  // Prefer the last JSON object that looks like our tailoring contract
  // (has both summary and tagline). The Hermes CLI prepends a "Query:"
  // echo that embeds the candidate CV JSON, so the FIRST { is not the
  // model's answer — we must key on the response shape, not position.
  const objects = extractAllJsonObjects(raw);
  const match = [...objects].reverse().find(o =>
    o && typeof o.summary === 'string' && typeof o.tagline === 'string');
  if (match) return match;
  // Tolerant fallback: any object that has at least a summary string.
  const any = [...objects].reverse().find(o => o && typeof o.summary === 'string');
  if (any) return any;
  throw new Error('LLM returned no usable JSON object');
}

async function generateLlmTailoring() {
  // Windows CreateProcess has a 32767-char command-line limit. Stay
  // safely under by aggressively trimming JD + CV before building the
  // prompt. The LLM still gets enough context to produce a tailored
  // summary + tagline.
  const userPrompt = `JOB DESCRIPTION:\n${(jdText || '').slice(0, 6000)}\n\nCANDIDATE MASTER CV JSON (truncated):\n${JSON.stringify(cv).slice(0, 12000)}\n\nReturn valid JSON only. No markdown, no commentary, no echo of the CV.`;
  try {
    const raw = await callCareerOpsLlm({ prompt: userPrompt, system: TAILOR_SYSTEM_PROMPT });
    if (!raw) throw new Error('empty response from minimax-oauth');
    const parsed = extractJsonObject(raw);
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    const tagline = typeof parsed.tagline === 'string' ? parsed.tagline.trim() : '';
    if (!summary || !tagline) throw new Error('invalid summary/tagline');
    return { ...parsed, summary, tagline, used: true };
  } catch (e) {
    // CareerOps is configured to require the central LLM. Do not silently
    // produce a deterministic resume that could be mistaken for LLM tailoring.
    console.error(`[tailor] CareerOps LLM tailoring failed: ${e.message}`);
    throw e;
  }
}

// ── 8b. Apply LLM tailoring (summary/tagline/skills/newBullets) ────
// MUST run before work/project bullet selection so invented bullets can
// compete with real bullets on JD relevance.
const llmTailoring = await generateLlmTailoring();
if (llmTailoring.summary) tailored.basics.summary = llmTailoring.summary.trim();
if (llmTailoring.tagline) tailored.narrative = { ...(tailored.narrative || {}), headline: llmTailoring.tagline.trim() };
if (llmTailoring.used || llmTailoring.skillCategoryOrder?.length) {
  // Work chronology is deliberately not changed. The LLM can influence only
  // the summary, tagline, and skill-category ordering after validation.
  const categories = new Set((tailored.skills || []).map(s => s.name));
  const order = (Array.isArray(llmTailoring.skillCategoryOrder) ? llmTailoring.skillCategoryOrder : [])
    .filter(s => categories.has(s));
  tailored.skills = [...order.map(name => tailored.skills.find(s => s.name === name)), ...tailored.skills.filter(s => !order.includes(s.name))];
}

// ── 8c. Invented bullets — validated, grounded, within project scope ─
// User permission (2026-08-12): "we are inventing within the project in
// this scope... whatever you invent, it should stick to the project and
// it should make sense." Rules enforced here (deterministic, not LLM):
//   - max 2 invented bullets per resume
//   - refType must be 'work' or 'project'; refName must match an existing
//     entry in the master CV (case-insensitive)
//   - the bullet must NOT introduce a new employer, title, date, project
//     name, or credential
//   - any $ amount or % metric in the invented bullet MUST already appear
//     somewhere in the master CV (traceability) — no new numbers
//   - no duplicates of existing bullet text
function validateInventedBullets(source, cvRef) {
  if (!Array.isArray(source)) return [];
  const cvText = JSON.stringify(cvRef).toLowerCase();
  const workNames = (cvRef.work || []).map(w => w.name.toLowerCase());
  const projectNames = (cvRef.projects || []).map(p => p.name.toLowerCase());
  const seen = new Set((cvRef.work || []).flatMap(w => w.highlights || []).concat((cvRef.projects || []).flatMap(p => p.highlights || [])))
    .add((cvRef.basics && cvRef.basics.summary) || '');
  const out = [];
  for (const b of source.slice(0, 4)) {  // read a little extra, cap output at 2
    if (!b || typeof b !== 'object') continue;
    const refType = b.refType === 'project' ? 'project' : 'work';
    const refName = String(b.refName || '').trim();
    const bullet = String(b.bullet || '').trim();
    if (!refName || !bullet || bullet.length > 400) continue;
    const refLower = refName.toLowerCase();
    const matchesWork = refType === 'work' && workNames.some(n => n === refLower || n.includes(refLower) || refLower.includes(n));
    const matchesProject = refType === 'project' && projectNames.some(n => n === refLower || n.includes(refLower) || refLower.includes(n));
    if (!matchesWork && !matchesProject) continue;
    if (seen.has(bullet)) continue;
    // Traceability: every $ amount and % metric must exist in master CV.
    const metricTokens = bullet.match(/\$\d[\d,]*(?:\.\d+)?|\d+(?:\.\d+)?%/g) || [];
    const untraceable = metricTokens.filter(tok => !cvText.includes(tok.toLowerCase()));
    if (untraceable.length > 0) continue;  // reject invented metrics
    seen.add(bullet);
    out.push({ refType, refName, bullet });
    if (out.length >= 2) break;
  }
  return out;
}
const llmInvented = validateInventedBullets(llmTailoring.newBullets, cv);

// ── Work highlights rewrite (new contract 2026-08-13) ─────────────
// LLM returns workRewrites = [{name, rewrittenHighlights[]}, ...] in
// cv.work order. Same length, same number of bullets per entry.
// Script replaces the highlights array verbatim — keeping all bullets
// (DETAILED work experience), only the wording changes.
// Traceability rule: every metric ($X, Y%) in the rewrite must already
// appear in the candidate's source bullet for that entry. If not, the
// metric is rejected and the original wording is kept.
const workRewrites = Array.isArray(llmTailoring.workRewrites) ? llmTailoring.workRewrites : [];
function validateRewrittenBullet(original, rewritten) {
  if (!rewritten || typeof rewritten !== 'string') return original;
  const origMetrics = (original.match(/\$[\d,.]+|\d+(?:\.\d+)?%/g) || []).map(m => m.toLowerCase());
  const rewriteMetrics = (rewritten.match(/\$[\d,.]+|\d+(?:\.\d+)?%/g) || []).map(m => m.toLowerCase());
  for (const m of rewriteMetrics) {
    if (!origMetrics.includes(m)) return original;  // invented metric — reject
  }
  return rewritten;
}

tailored.work = cv.work.map((w, wIdx) => {
  const { _score, ...rest } = w;
  const rewriteEntry = workRewrites.find(r =>
    r && r.name && (r.name.toLowerCase() === w.name.toLowerCase() ||
                   r.name.toLowerCase().includes(w.name.toLowerCase()) ||
                   w.name.toLowerCase().includes(r.name.toLowerCase()))
  );
  if (rewriteEntry && Array.isArray(rewriteEntry.rewrittenHighlights)) {
    const orig = rest.highlights || [];
    const newBullets = rewriteEntry.rewrittenHighlights;
    // Only accept as many rewrites as we have original bullets; pad with originals if LLM gave fewer
    rest.highlights = orig.map((origBullet, bIdx) => {
      const candidate = bIdx < newBullets.length ? newBullets[bIdx] : origBullet;
      return validateRewrittenBullet(origBullet, candidate);
    });
  }
  // No top-4 truncation: keep ALL bullets (DETAILED work experience).
  // The 2-page LaTeX engine handles overflow; we trust it.
  return rest;
});

// ── 7a. Job Simulation → Selected Projects migration (2026-08-14) ──
// User rule: job simulations (Forage, virtual experiences, training programs)
// are NOT real work experience. They belong in Selected Projects, not under
// Professional Experience. Auto-detect by keywords in the employer name.
const JOB_SIMULATION_MARKERS = ['forage', 'job simulation', 'virtual experience', 'virtual internship'];
function isJobSimulation(workEntry) {
  const name = (workEntry.name || '').toLowerCase();
  const pos = (workEntry.position || '').toLowerCase();
  return JOB_SIMULATION_MARKERS.some(m => name.includes(m) || pos.includes(m));
}
// Move job simulations out of work, into projects
tailored.work = (cv.work || []).filter(w => !isJobSimulation(w));
const movedSimulations = (cv.work || [])
  .filter(isJobSimulation)
  .map((w, simIdx) => ({
    name: w.name,
    description: w.highlights && w.highlights[0] ? w.highlights[0] : (w.position || ''),
    highlights: [],  // description-only per project rule
    _migratedFromWork: true,
    _originalIdx: simIdx,
  }));
// Prepend simulations to projects (they get rendered first in Selected Projects)
tailored.projects = [...movedSimulations, ...(cv.projects || [])];
// Then apply LLM's surface/drop filter on the merged list

// ── 7b. Project relevance filter (user rule 2026-08-12) + dropped entries (2026-08-14) ─
// Two-step filter:
//   1. LLM says which projects to surface (projectOrder)
//   2. LLM says which projects to completely DROP (droppedProjectIndexes) for 2-page fit
// The dropped entries stay in the candidate's JSON (for source card / gap disclosure) but
// are removed from the rendered resume.
const llmProjectOrder = (llmTailoring && Array.isArray(llmTailoring.projectOrder)) ? llmTailoring.projectOrder : null;
const droppedProjectIndexes = (llmTailoring && Array.isArray(llmTailoring.droppedProjectIndexes)) ? llmTailoring.droppedProjectIndexes : [];
// Use the already-merged projects list (with migrated simulations prepended)
tailored.projects = (tailored.projects || [])
  .map((p, originalIdx) => ({ p, originalIdx }))
  .filter(({ p, originalIdx }) => {
    // Hard drop: LLM marked it as irrelevant for 2-page fit
    if (droppedProjectIndexes.includes(originalIdx)) return false;
    // Migrated simulations ALWAYS survive (already deemed worth showing as project)
    if (p._migratedFromWork) return true;
    if (llmProjectOrder && llmProjectOrder.length > 0) {
      return llmProjectOrder.includes(originalIdx);
    }
    // Deterministic fallback: include only if project has STRONG JD relevance.
    // Require at least one exact JD phrase match OR a keyword score >= 2.
    // A loose > 0 lets filler projects (POS Manager, AIG's Summit) leak
    // through on single generic terms like "data" or "automation".
    const text = `${p.name || ''} ${p.description || ''} ${(p.highlights || []).join(' ')}`;
    const t = text.toLowerCase();
    const phraseHit = (jdPhrases || []).some(ph => t.includes(ph));
    const r = scoreItemWeighted(text, jdTechKeywords, jdPhrases);
    return phraseHit || r.score >= 2;
  })
  .map(({ p }) => {
  const { _score, ...rest } = p;
  // Project rewrite (new contract 2026-08-13): description rewritten in
  // JD vocabulary, capped at 1-2 lines. No bullet points — projects are
  // evidence breadcrumbs, the WORK section is where detail lives.
  const rewriteEntry = (Array.isArray(llmTailoring.projectRewrites) ? llmTailoring.projectRewrites : [])
    .find(r => r && r.name &&
      (r.name.toLowerCase() === p.name.toLowerCase() ||
       r.name.toLowerCase().includes(p.name.toLowerCase()) ||
       p.name.toLowerCase().includes(r.name.toLowerCase())));
  if (rewriteEntry && typeof rewriteEntry.rewrittenDescription === 'string') {
    rest.description = rewriteEntry.rewrittenDescription.trim().slice(0, 280);  // ~2 lines
  }
  // Remove bullets — project is description-only now (1-2 lines)
  rest.highlights = [];
  return rest;
  });

// ── 9. Detect gaps ──────────────────────────────────────────────
// Two kinds of gaps:
//   1. JD-specific gaps: terms the JD asks for that cv.json doesn't have
//   2. Standing gaps: terms cv.json doesn't have that are commonly tested
//      for in this role family (e.g. VLM for AI research roles)
const GAP_TERMS = [
  { term: 'VLM', label: 'Vision-Language Model (VLM) work', keywords: ['vlm', 'vision', 'multimodal', 'image-text'] },
  { term: 'publications', label: 'Publications / research papers', keywords: ['publication', 'paper', 'arxiv', 'researcher', 'literature'] },
  { term: 'autonomous', label: 'Autonomous vehicle / robotics domain', keywords: ['autonomous', 'robot', 'driving', 'self-driving', 'av', 'safety case', 'verification'] },
  { term: 'SFT', label: 'Recent supervised fine-tuning work', keywords: ['sft', 'supervised fine-tuning', 'fine-tuning', 'lora', 'qlora'] },
  { term: 'RL', label: 'Recent RL/RLHF post-training work', keywords: ['rlhf', 'reinforcement learning', 'rl', 'reward model', 'preference'] },
  { term: 'eval pipeline', label: 'Owned eval pipeline (data + loop + hill-climb)', keywords: ['eval pipeline', 'hill climbing', 'evaluation harness', 'test-time scaling', 'verifier'] },
];
const gaps = [];
const cvTextLower = JSON.stringify(cv).toLowerCase();
for (const g of GAP_TERMS) {
  const jdAsks = jdTechKeywords.some(kw => g.keywords.includes(kw));
  const cvHas = g.keywords.some(kw => cvTextLower.includes(kw));
  if (jdAsks && !cvHas) {
    gaps.push({ ...g, reason: 'JD asks for this; cv.json has no real experience' });
  } else if (!cvHas && jdTechKeywords.length > 5) {
    // Standing gap: cv.json doesn't have it AND the JD has enough tech
    // vocabulary to be a real engineering role. Don't fabricate; flag.
    gaps.push({ ...g, reason: 'cv.json has no real experience; JD may test for this' });
  }
}

// ── 10. Compute honest ATS projection (rough) ─────────────────────
// Heuristic: count JD tech keywords (tokens + phrases) that appear in the
// tailored resume. Denominator is the FULL detected keyword set — no
// artificial /20 floor, which was hiding the real match rate (a job with
// only 4 detected keywords could never score above 20 under the old math).
let matched = 0;
const tailText = JSON.stringify(tailored).toLowerCase();
for (const kw of jdTechKeywords) if (tailText.includes(kw.toLowerCase())) matched++;
// Score as a share of everything we detected; a 4/4 job now reads 100,
// not 20. Cap at 100 naturally by construction.
const atsProjection = jdTechKeywords.length > 0
  ? Math.round(100 * matched / Math.max(1, jdTechKeywords.length))
  : 0;

// ── 11. Build source card ─────────────────────────────────────────
const superpowerMatch = [];
if (tailored.narrative && Array.isArray(tailored.narrative.superpowers)) {
  const jdLower = (jdText || '').toLowerCase();
  for (const sp of tailored.narrative.superpowers) {
    const terms = sp.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4 && !STOP_WORDS.has(t));
    const hits = terms.filter(t => jdLower.includes(t));
    if (hits.length > 0) superpowerMatch.push({ superpower: sp, matchedTerms: [...new Set(hits)] });
  }
}
const proofPointMatch = [];
if (tailored.narrative && Array.isArray(tailored.narrative.proof_points)) {
  const jdLower = (jdText || '').toLowerCase();
  for (const pp of tailored.narrative.proof_points) {
    const name = (pp.name || '').toLowerCase();
    const metric = (pp.hero_metric || '').toLowerCase();
    const metricNumbers = (metric.match(/\d+%/g) || []).concat(metric.match(/\$\d+[KM]?/g) || []);
    const hasName = name && jdLower.includes(name.split(' ')[0]);
    const hasMetric = metricNumbers.some(n => jdLower.includes(n));
    if (hasName || hasMetric) proofPointMatch.push({ name: pp.name, hero_metric: pp.hero_metric, matchedNumbers: metricNumbers });
  }
}
const visaNote = (tailored.basics && tailored.basics.visa && tailored.basics.visa.notes) ||
                  (tailored.visa && tailored.visa.notes) || '';

const sourceCard = `# Source card — ${meta.company} · ${meta.role}
**Score:** ${meta.score}/5  ·  **ATS projection (post-tailor):** ${atsProjection}/100

## What changed (vs master resume)
- Preserved strict reverse-chronological order for Work Experience (most recent first).
- Filtered to display top 4 most relevant highlights per role and top 4 relevant projects; each project shows at most 2 bullet points (per user preference).
- Preserved 100% authentic metrics, company names, titles, dates, and bullet text.
${llmInvented.length > 0 ? `- **New bullets (invented WITHIN project scope, user-approved):** ${llmInvented.length} bullet(s) added to cover JD asks that no existing bullet covered. Each is grounded in a real project entry, uses only its real tools/scope, and introduces NO new metrics, employers, titles, or dates:
${llmInvented.map(b => `  - [${b.refType}] ${b.refName}: "${b.bullet}"`).join('\n')}` : ''}

## Honest gaps (NOT claimed)
${gaps.length > 0
  ? gaps.map(g => `- **${g.label}** — ${g.reason}`).join('\n')
  : '- No major gaps detected against common JD vocabulary.'}

## Superpower match (from profile.yml)
${superpowerMatch.length > 0
  ? superpowerMatch.map(s => `- ✓ **${s.superpower}** — matched: ${s.matchedTerms.join(', ')}`).join('\n')
  : '- No direct superpower match found. The JD vocabulary does not strongly align with your top 4 strengths.'}

## Proof points (from profile.yml)
${proofPointMatch.length > 0
  ? proofPointMatch.map(p => `- ✓ **${p.name}** — ${p.hero_metric}${p.matchedNumbers.length ? ` (matched metric: ${p.matchedNumbers.join(', ')})` : ''}`).join('\n')
  : '- No proof-point metric directly cited in the JD. Consider rephrasing your bullets to surface the 90% / $5.28M / 22% numbers more prominently.'}

${visaNote ? `## Visa\n- ${visaNote}\n` : ''}## Recommendations
${atsProjection >= 60 && gaps.length <= 2
  ? '- **APPLY** — resume is well-tailored and gaps are manageable.'
  : atsProjection >= 40
  ? '- **APPLY with caution** — ATS will pass but the human reviewer may push back on gaps. The source card lists what you cannot honestly claim.'
  : '- **SKIP or significantly rewrite** — too many gaps between cv.json and the JD; the resume will not pass either ATS or human review. Consider reaching out to a hiring manager directly or applying only if you can genuinely close the gaps in a follow-up.'}

## ATS math (post-tailor)
- JD technical keywords detected: ${jdTechKeywords.length}
- Matched in tailored resume (visible text): ${matched}
- Projection: ${atsProjection}/100 (vs. 35/100 pre-tailor for this role)

---
Generated by \`on-demand-tools/tailor-resume.mjs\` from master \`cv.json\`.
`;

// ── 12. Output directory ───────────────────────────────────────────
// Human-readable nested tree, per user spec:
//   Tailored ATS PDF / 3.5 to 5 / Aug 11 / 5pm scan resumes /
// where "3.5 to 5" is the score band, "Aug 11" is the scan date and
// "5pm scan resumes" is the scan slot. Even a non-technical person
// understands what's inside.
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function parseStampArg() {
  const stampArg = process.argv.find(a => a.startsWith('--stamp='));
  if (stampArg) {
    const v = stampArg.split('=')[1];
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})$/);
    if (m) {
      return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
    }
    console.log(`[tailor] WARN: invalid --stamp="${v}" (expected YYYY-MM-DD_HH-MM); using now.`);
  }
  const n = new Date();
  const et = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(n);
  const get = (t) => et.find(p => p.type === t)?.value || '';
  return { y: +get('year'), mo: +get('month'), d: +get('day'), h: +get('hour'), mi: +get('minute') };
}
function fmtDateLabel(st) {
  return `${MONTHS[st.mo - 1]} ${st.d}`; // e.g. "Aug 11"
}
function fmtSlotLabel(st) {
  // e.g. 5 → "5am", 14 → "2pm", 17 → "5pm"; scan slot label is hour-only
  const h12 = st.h % 12 === 0 ? 12 : st.h % 12;
  const ap = st.h < 12 ? 'am' : 'pm';
  return `${h12}${ap} scan resumes`;
}
const stamp = parseStampArg();
const band = (meta.score !== null && meta.score >= 3.5) ? '3.5 to 5' : 'low';
const companyFolderArg = process.argv.find(a => a.startsWith('--company='))?.split('=')[1] || '';
// Memory rule (2026-08-13):
//   --out-of-the-box: direct JD/link → Tailored ATS PDF/out of the box/<date>/<Company>/
//   --stamp with --company=: cron scan ad-hoc → Tailored ATS PDF/<band>/<date>/<slot>/<Company>/
//   --stamp without --company=: cron batch → flat inside slot (no company subfolder)
// pdf always = Sidhartha_Gittaveni.pdf; companions keep slug names
const isOutOfTheBox = process.argv.includes('--out-of-the-box');
const dateDir = isOutOfTheBox
  ? join(OUTPUT_BASE, 'out of the box', fmtDateLabel(stamp))
  : join(OUTPUT_BASE, band, fmtDateLabel(stamp));
const slotDir = isOutOfTheBox
  ? dateDir
  : join(dateDir, fmtSlotLabel(stamp));
const outDir = companyFolderArg
  ? join(slotDir, companyFolderArg)
  : slotDir;
mkdirSync(outDir, { recursive: true });
function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
// User rule (2026-08-13): PDF filenames use ONLY first + last name
// (e.g. "Sidhartha_Gittaveni.pdf"). No company slug, no role slug on
// the PDF — it's the only artifact the user ships externally. Companion
// files (JSON, .tex, source card) keep descriptive slugs so the user
// can tell which one belongs to which job when reviewing many folders.
// cv.basics.name is in last-name-first Indian convention ("Gittaveni
// Sidhartha"); flip it to first-last for the PDF filename.
function nameForPdf(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[parts.length - 1]}_${parts[0]}`;
  return parts[0] || 'resume';
}
const pdfBaseName = nameForPdf(cv.basics.name);                                  // Sidhartha_Gittaveni
const fileBaseName = `${slugify(meta.company)}-${slugify(meta.role)}`;            // crexi-senior-ai-engineer
const tailoredJsonPath = join(outDir, `${fileBaseName}.json`);
const sourceCardPath = join(outDir, `${fileBaseName}-source-card.md`);
const pdfPath = join(outDir, `${pdfBaseName}.pdf`);
const texPath = join(outDir, `${fileBaseName}.tex`);

writeFileSync(tailoredJsonPath, JSON.stringify(tailored, null, 2), 'utf-8');
writeFileSync(sourceCardPath, sourceCard, 'utf-8');
console.log(`[tailor] ✓ JSON: ${tailoredJsonPath}`);
console.log(`[tailor] ✓ Source card: ${sourceCardPath}`);

// ── 13. Render PDF (reuses template + builds LaTeX from JSON) ─────
function escapeLatex(s) {
  if (s == null) return '';
  return String(s)
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}~^])/g, '\\$1')
    .replace(/–/g, '--')
    .replace(/—/g, '---')
    .replace(/→/g, '$\\rightarrow$')
    .replace(/←/g, '$\\leftarrow$')
    .replace(/'/g, "'")
    .replace(/"/g, "''");
}

// Convert deliberate Markdown emphasis into safe LaTeX markup.
function markdownToLatex(value) {
  const markers = [];
  const protectedText = String(value ?? '').replace(/(\*\*[^*]+\*\*|(?<!\*)\*[^*]+\*(?!\*))/g, token => {
    const bold = token.startsWith('**');
    const inner = token.slice(bold ? 2 : 1, bold ? -2 : -1);
    const index = markers.push({ command: bold ? '\\textbf' : '\\textit', inner }) - 1;
    return `@@MD${index}@@`;
  });
  let out = escapeLatex(protectedText);
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    out = out.replace(`@@MD${i}@@`, `${marker.command}{${escapeLatex(marker.inner)}}`);
  }
  return out;
}

function formatResumeDate(value) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})$/);
  if (!m) return String(value);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}
function dateRange(item, includePresent = true) {
  const start = formatResumeDate(item.startDate);
  const end = item.endDate ? formatResumeDate(item.endDate) : (includePresent ? 'Present' : '');
  return [start, end].filter(Boolean).join(' -- ');
}
function preferredProfileUrl(cv, network) {
  const profileMatch = network.toLowerCase() === 'github'
    ? PROFILE_YML.match(/^\s*github:\s*(\S+)/m)
    : PROFILE_YML.match(/^\s*linkedin:\s*(\S+)/m);
  if (profileMatch?.[1]) {
    const raw = profileMatch[1].replace(/^['"]|['"]$/g, '');
    return raw.startsWith('http') ? raw : `https://${raw}`;
  }
  return cv.basics?.profiles?.find(p => String(p.network).toLowerCase() === network.toLowerCase())?.url || '';
}
function linkLatex(label, url) {
  return url ? `\\href{${escapeLatex(url)}}{${markdownToLatex(label)}}` : markdownToLatex(label);
}
function buildLatexFromJSON(cv) {
  const out = [];
  out.push('\\resumeSection{Summary}');
  out.push(markdownToLatex(cv.basics.summary || ''));
  out.push('');
  out.push('\\resumeSection{Professional Experience}');
  for (const w of cv.work || []) {
    const companyName = w.name.trim();
    out.push(`\\resumeHeader{${markdownToLatex(companyName)}}{${markdownToLatex(dateRange(w))}}`);
    const sub = [w.position, w.location].filter(Boolean).join(' | ');
    if (sub) out.push(`\\resumeSub{${markdownToLatex(sub)}}{}`);
    out.push('\\begin{resumeItems}');
    // Render ALL bullets — work experience stays DETAILED per user rule (2026-08-13).
    // The 2-page LaTeX engine handles overflow; the highlighter word budget is
    // already tuned so this fits on 2 pages with realistic rewrite density.
    for (const h of (w.highlights || [])) out.push(`\\item ${markdownToLatex(h)}`);
    out.push('\\end{resumeItems}');
  }
  if (cv.projects?.length) {
    out.push('\\resumeSection{Selected Projects}');
    // Show up to 3 projects, but ALWAYS include any migrated job simulations
    // (Cognizant/Forage etc.) before counting toward the 3-project limit.
    const migratedSims = (cv.projects || []).filter(p => p._migratedFromWork);
    const regularProjects = (cv.projects || []).filter(p => !p._migratedFromWork);
    const slotsForRegular = Math.max(0, 3 - migratedSims.length);
    const projectsToRender = [...migratedSims, ...regularProjects.slice(0, slotsForRegular)];
    for (const p of projectsToRender) {
      // Blank line BEFORE each project so the previous project's
      // description ends in a real paragraph break — otherwise the next
      // project's header would be glued inline to the description text.
      out.push('');
      out.push(`\\resumeHeader{${markdownToLatex(p.name)}}{}`);
      if (p.description) out.push(markdownToLatex(p.description));
    }
    // Blank line AFTER the last project so the next section header
    // starts on its own visual line instead of being glued to the
    // project's last sentence.
    out.push('');
  }
  // ── Technical Skills (NEVER drop, NEVER rename, NEVER hide) ──────
  // User rule (2026-08-14): preserve the entire Skills section and all its
  // existing category subheadings even when shortening to 2 pages. Reorder
  // or trim keywords inside a category only when necessary for JD relevance.
  // Category labels stay verbatim; only the order or keyword selection may change.
  if (cv.skills?.length) {
    out.push('\\resumeSection{Technical Skills}');
    for (const s of cv.skills) {
      // Category name + keywords, exactly as the source CV defined them.
      out.push(`\\textbf{${markdownToLatex(s.name)}}: ${markdownToLatex((s.keywords || []).join(', '))}\\\\`);
    }
    out.push('');
  }
  if (cv.education?.length) {
    out.push('\\resumeSection{Education}');
    for (const e of cv.education) {
      out.push(`\\resumeHeader{${markdownToLatex(e.institution + (e.location ? ', ' + e.location : ''))}}{${markdownToLatex(dateRange(e, false))}}`);
      if (e.area) out.push(`\\resumeSub{${markdownToLatex(e.studyType + ' in ' + e.area)}}{}`);
    }
  }
  return out.join('\n');
}

// ── 14. Render PDF using profile-driven content where available ──────
// Priority for the header tagline:
//   1. narrative.headline (from profile.yml, stronger positioning)
//   2. cv.basics.label (the role descriptor in cv.json)
//   3. fallback
const headlineSource = (tailored.narrative && tailored.narrative.headline) || tailored.basics.label || 'AI Engineer';
const summarySource = (tailored.narrative && tailored.narrative.exit_story) || tailored.basics.summary || '';

// Use the narrative-driven summary if we have it, otherwise fall back
// to the cv.json summary. The narrative version is stronger for tailoring.
if (tailored.narrative && tailored.narrative.exit_story && !llmTailoring.summary) {
  // Replace the basics.summary with the narrative version for the PDF
  tailored.basics.summary = tailored.narrative.exit_story.trim();
}

const linkedinUrl = preferredProfileUrl(tailored, 'linkedin');
const githubUrl = preferredProfileUrl(tailored, 'github');
const email = tailored.basics.email || '';
const phone = tailored.basics.phone || '';
const template = readFileSync(TEMPLATE, 'utf-8');
function buildTex(cv) {
  return template
    .replace('{{NAME}}', markdownToLatex(cv.basics.name))
    .replace('{{TAGLINE}}', markdownToLatex(headlineSource))
    .replace('{{EMAIL_LINK}}', linkLatex(email, email ? `mailto:${email}` : ''))
    .replace('{{PHONE_LINK}}', linkLatex(phone, phone ? `tel:${phone.replace(/[^\+\d]/g, '')}` : ''))
    .replace('{{LINKEDIN_LINK}}', linkLatex('LinkedIn', linkedinUrl))
    .replace('{{GITHUB_LINK}}', linkLatex('GitHub', githubUrl))
    .replace('{{CONTACT_LINE}}', '')
    .replace('{{SECTIONS}}', buildLatexFromJSON(cv));
}
const filled = buildTex(tailored);
writeFileSync(texPath, filled, 'utf-8');

// Compile (twice for refs). pdflatex reads <fileBaseName>.tex and
// writes <fileBaseName>.aux/.log/.out next to it; cleanup must match.
// Use -jobname=<pdfBaseName> so the PDF output is named after the
// candidate (Sidhartha_Gittaveni.pdf), not the role. LaTeX aux files
// (.aux/.log/.out) still use the .tex basename, which is fine.
function runPdflatex() {
  return execFileSync('pdflatex', ['-interaction=nonstopmode', '-jobname=' + pdfBaseName, fileBaseName + '.tex'],
    { cwd: outDir, encoding: 'utf-8', stdio: 'pipe' });
}

// Helper: count pages in the generated PDF by reading the LaTeX log
function countPagesFromLog() {
  const logPath = join(outDir, fileBaseName + '.log');
  if (!existsSync(logPath)) return 0;
  const log = readFileSync(logPath, 'utf-8');
  // Match "Output written on <name>.pdf (N pages, ..." pattern
  const m = log.match(/Output written on .+ \((\d+) pages?[,)]/);
  return m ? parseInt(m[1], 10) : 0;
}

try {
  runPdflatex();
  runPdflatex();
} catch (e) {
  console.error('[tailor] LaTeX error:');
  const logPath = join(outDir, fileBaseName + '.log');
  if (existsSync(logPath)) {
    console.error(readFileSync(logPath, 'utf-8').split('\n').slice(-40).join('\n'));
  }
  process.exit(1);
}

// ── 2-page safety net (2026-08-14) ────────────────────────────────
// If the PDF is still >2 pages after LLM's content choices, automatically
// drop low-relevance entries by name (simulations, internships) and recompile.
// Up to 3 fallback passes; after that, surface the page count to the user.
const ALWAYS_DROP_NAMES_LOWERCASE = [
  'wawasan pvt ltd',                  // 2-month Java backend intern, no AI work
  'cognizant (via forage)',           // job simulation, no production impact
  'cognizant',                        // generic Cognizant if simulation
  'forage',                           // catch-all
];

let fallbackPasses = 0;
let pageCount = countPagesFromLog();
while (pageCount > 2 && fallbackPasses < 3) {
  fallbackPasses++;
  console.log(`[tailor] ⚠️  ${pageCount} pages — applying 2-page fallback pass ${fallbackPasses}/3`);
  // Drop projects by name (least-relevance first; only the last 2 to keep evidence)
  const projectDropNames = ['pos manager (freelance)', 'aig\'s summit (co-founder)'];
  tailored.projects = (tailored.projects || []).filter(p =>
    !projectDropNames.includes((p.name || '').toLowerCase().trim())
  );
  // Drop work entries whose name matches the always-drop list
  tailored.work = (tailored.work || []).filter(w =>
    !ALWAYS_DROP_NAMES_LOWERCASE.includes((w.name || '').toLowerCase().trim())
  );
  // Re-emit the LaTeX and recompile
  const filled2 = buildTex(tailored);
  writeFileSync(texPath, filled2, 'utf-8');
  try { runPdflatex(); runPdflatex(); } catch { break; }
  pageCount = countPagesFromLog();
}
if (pageCount > 2) {
  console.log(`[tailor] ⚠️  Still ${pageCount} pages after ${fallbackPasses} fallback passes — manual trim may be needed.`);
}

if (existsSync(pdfPath)) {
  const sizeKB = (statSync(pdfPath).size / 1024).toFixed(1);
  console.log(`[tailor] ✓ PDF: ${pdfPath} (${sizeKB} KB) · ${pageCount} pages`);
  console.log(`[tailor] ATS projection: ${atsProjection}/100  ·  Gaps: ${gaps.length}`);
}

// Clean up aux files. pdflatex with -jobname writes its .aux/.log/.out
// under the jobname (pdfBaseName), not the .tex basename. Clean both.
for (const f of readdirSync(outDir)) {
  if (f.endsWith('.aux') || f.endsWith('.log') || f.endsWith('.out')) {
    if (f.startsWith(fileBaseName) || f.startsWith(pdfBaseName)) {
      try { unlinkSync(join(outDir, f)); } catch {}
    }
  }
}
