#!/usr/bin/env node
/**
 * openai-tailor.mjs — OpenAI-compatible CV Tailoring for career-ops
 *
 * Tailor your CV with ANY OpenAI-compatible chat endpoint instead of Claude.
 * This is the headless companion to openai-eval.mjs. It takes an evaluation
 * report and the job description, applies anti-fabrication rules, and returns a
 * structured CV payload which build-cv-html.mjs renders into a filled
 * cv-template.html ready to be turned into a PDF.
 *
 * JSON payload migration: the model used to be handed the whole HTML template
 * and asked to return a complete raw HTML document. That put the template's
 * markup into both the prompt and the response on every call, and left the
 * model making escaping and layout decisions that belong to a deterministic
 * renderer. The model now returns a compact JSON payload (the key contract in
 * lib/cv-payload-schema.mjs); this script normalizes its shape, validates it,
 * and hands it to build-cv-html.mjs, which owns every tag, class and escape.
 *
 * Usage:
 *   node openai-tailor.mjs --jd ./jds/my-job.txt --report reports/001-company-2026.md
 *   node openai-tailor.mjs --self-test          # offline, no API call
 *
 * Requires (for hosted endpoints):
 *   OPENAI_API_KEY (or --key)   — your provider key
 *   OPENAI_BASE_URL (or --url)  — the provider's OpenAI-compatible base
 *   OPENAI_MODEL (or --model)   — the model id
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { normalizePayload } from './lib/payload-normalizer.mjs';
import * as yaml from 'js-yaml';

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
  shared:   join(ROOT, 'modes', '_shared.md'),
  writing:  join(ROOT, 'modes', '_writing.md'),
  pdfMode:  join(ROOT, 'modes', 'pdf.md'),
  cv:       join(DATA_ROOT, 'cv.md'),
  profile:  join(DATA_ROOT, 'config', 'profile.yml'),
  template: join(ROOT, 'templates', 'cv-template.html'),
  output:   join(DATA_ROOT, 'output'),
};

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
// Payload pipeline (extracted so --self-test exercises the real code path)
// ---------------------------------------------------------------------------

const HTML_MARKUP_RE = /<!DOCTYPE|<html\b|<style\b|<div\b|<ul\b|<li\b/i;

/**
 * Strip a markdown fence, reject an HTML response, parse JSON.
 * HTML is refused rather than coerced: this mode is the JSON contract end to
 * end, and an HTML response means the model ignored it.
 *
 * @returns {{ok: true, json: string} | {ok: false, reason: string, detail: string}}
 */
export function parseModelOutput(modelOutput) {
  const rawJson = String(modelOutput)
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '');

  if (HTML_MARKUP_RE.test(rawJson)) {
    return {
      ok: false,
      reason: 'The model returned HTML instead of the JSON payload.',
      detail: 'This mode emits a structured payload only — the renderer owns all markup.',
    };
  }
  return { ok: true, json: rawJson };
}

/**
 * Run the normalizer (shape repair) and then the shared validator on the
 * result, so `errors`/`warnings` describe the payload that will actually
 * render rather than the raw model output.
 *
 * @returns {{payload: object, notes: string[], errors: string[], warnings: string[]}}
 */
export function preparePayload(parsed) {
  return normalizePayload(parsed, { format: 'html' });
}

/**
 * Stage the validated payload to JSON and hand it to build-cv-html.mjs, which
 * owns every tag, class and escaping decision. Returns the renderer's own JSON
 * report, parsed when possible.
 *
 * @param {object} payload
 * @param {string} payloadPath
 * @param {string} htmlPath
 * @returns {{ok: true, report: object|null, stdout: string} | {ok: false, stderr: string}}
 */
export function renderPayload(payload, payloadPath, htmlPath) {
  const builder = join(ROOT, 'build-cv-html.mjs');
  if (!existsSync(builder)) {
    return { ok: false, stderr: `Renderer not found: ${builder}` };
  }
  writeFileSync(payloadPath, JSON.stringify(payload, null, 2), 'utf-8');

  let stdout;
  try {
    stdout = execFileSync(
      process.execPath,
      [builder, payloadPath, htmlPath],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (err) {
    // build-cv-html.mjs exits 1 when its own validatePayload() rejects the
    // payload — surface its stderr rather than a bare "Command failed".
    return { ok: false, stderr: String(err.stderr || err.message).trim() };
  }

  const start = stdout.indexOf('{');
  let report = null;
  if (start !== -1) {
    try { report = JSON.parse(stdout.slice(start)); } catch { report = null; }
  }
  return { ok: true, report, stdout };
}

/**
 * Offline contract test. Runs the same parse -> normalize -> validate ->
 * render stages against fixtures that mimic a model migrating from HTML output
 * to JSON, with no API call. Exits non-zero if the contract is not enforced.
 */
export function runSelfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'openai-tailor-selftest-'));

  const good = {
    lang: 'en',
    candidate: { name: 'Test Candidate', email: 'test@example.com' },
    summary: 'Product owner with backlog ownership across regulated delivery.',
    competencies: ['Product Discovery', 'Requirements, PRDs & User Stories'],
    experience: [{
      company: 'Test Corp',
      role: 'Product Owner',
      dates: '2022 - 2024',
      bullets: ['Owned a backlog of 20+ features shipped from user feedback'],
    }],
    education: [{ title: 'MBA', org: 'Test University', year: '2022' }],
    skills: [{ category: 'Product', items: ['Jira', 'Confluence'] }],
  };

  const cases = [
    {
      name: 'parses a fenced JSON payload',
      input: '```json\n' + JSON.stringify(good) + '\n```',
      expect: (r) => r.ok && r.json.includes('"competencies"'),
    },
    {
      name: 'rejects an HTML response (the token leak we are closing)',
      input: '<!DOCTYPE html><html><body><ul><li>Owned a backlog</li></ul></body></html>',
      expect: (r) => !r.ok && /HTML/.test(r.reason),
    },
    {
      name: 'repairs bullets delivered as a newline-joined string',
      input: JSON.stringify({ ...good, experience: [{ company: 'A', role: 'B', bullets: 'One\nTwo' }] }),
      expect: (r) => { const p = preparePayload(JSON.parse(r.json)); return p.notes.length > 0 && Array.isArray(p.payload.experience[0].bullets) && p.payload.experience[0].bullets.length === 2; },
    },
    {
      name: 'renames the LaTeX education dialect into the html one',
      input: JSON.stringify({ ...good, education: [{ institution: 'Test University', degree: 'MBA', dates: '2022' }] }),
      expect: (r) => { const p = preparePayload(JSON.parse(r.json)); return p.errors.length === 0 && p.payload.education[0].title === 'Test University'; },
    },
    {
      name: 'surfaces a misspelled root key as a warning, not a silent drop',
      input: JSON.stringify({ ...good, educations: [{ title: 'X' }] }),
      expect: (r) => { const p = preparePayload(JSON.parse(r.json)); return p.warnings.some(w => w.includes('educations')); },
    },
    {
      name: 'fails validation when a required field is blank',
      input: JSON.stringify({ ...good, education: [{ title: '' }] }),
      expect: (r) => preparePayload(JSON.parse(r.json)).errors.length > 0,
    },
  ];

  let pass = 0;
  for (const c of cases) {
    let r;
    try { r = parseModelOutput(c.input); } catch (e) { r = { ok: false, reason: e.message }; }
    const good2 = c.expect(r);
    console.log(`${good2 ? '  ok  ' : ' FAIL '} ${c.name}`);
    if (good2) pass++;
  }

  // End-to-end render through the real builder.
  const payloadPath = join(tmp, 'fixture.payload.json');
  const htmlPath = join(tmp, 'fixture.html');
  const rendered = renderPayload(good, payloadPath, htmlPath);
  const htmlOk = rendered.ok && existsSync(htmlPath) && readFileSync(htmlPath, 'utf-8').includes('Test Candidate');
  console.log(`${htmlOk ? '  ok  ' : ' FAIL '} renders a payload end-to-end via build-cv-html.mjs`);
  if (htmlOk) pass++;

  rmSync(tmp, { recursive: true, force: true });

  console.log(`\n${pass}/${cases.length + 1} checks passed`);
  if (pass !== cases.length + 1) process.exit(1);
}

// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

if (args.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║      career-ops — OpenAI-compatible CV Tailoring (Headless)      ║
╚══════════════════════════════════════════════════════════════════╝

  Tailor your CV with any OpenAI-compatible API to output a structured payload.

  USAGE
    node openai-tailor.mjs --jd <path> --report <path>
    node openai-tailor.mjs --url <base> --model <id> --jd <path> --report <path>
    node openai-tailor.mjs --self-test

  OPTIONS
    --jd <path>      Path to the Job Description text file
    --report <path>  Path to the evaluation report generated by openai-eval.mjs
    --model <id>     Model id            (env OPENAI_MODEL, default gpt-4o)
    --url <base>     OpenAI-compatible base URL, including any /v1
                     (env OPENAI_BASE_URL, default https://api.openai.com/v1)
    --key <key>      API key             (env OPENAI_API_KEY)
    --self-test      Run the offline payload pipeline (no API call) against
                     fixtures that mimic a model migrating from HTML to JSON:
                     bullets-as-string, wrong education dialect, and an HTML
                     response. Exits non-zero if the contract is not enforced.
    --help           Show this help

  ENV
    OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_TIMEOUT_MS

  EXAMPLES
    OPENAI_API_KEY=sk-... node openai-tailor.mjs --jd ./jds/job.txt --report reports/001-company-2026-01-01.md
`);
  process.exit(0);
}

// Parse flags
let jdPath     = '';
let reportPath = '';
let modelName  = process.env.OPENAI_MODEL || 'gpt-4o'; // Tailoring needs a smarter model default than eval
let baseUrl    = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
let apiKey     = process.env.OPENAI_API_KEY || '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--jd' && args[i + 1]) {
    jdPath = args[++i];
  } else if (args[i] === '--report' && args[i + 1]) {
    reportPath = args[++i];
  } else if (args[i] === '--model' && args[i + 1]) {
    modelName = args[++i];
  } else if (args[i] === '--url' && args[i + 1]) {
    baseUrl = args[++i].replace(/\/$/, '');
  } else if (args[i] === '--key' && args[i + 1]) {
    apiKey = args[++i];
  }
}

if (!jdPath || !reportPath) {
  console.error('❌  Both --jd and --report are required. Run with --help for usage.');
  process.exit(1);
}

if (!existsSync(jdPath)) {
  console.error(`❌  JD file not found: ${jdPath}`);
  process.exit(1);
}
if (!existsSync(reportPath)) {
  console.error(`❌  Report file not found: ${reportPath}`);
  process.exit(1);
}

const jdText = readFileSync(jdPath, 'utf-8').trim();
const reportText = readFileSync(reportPath, 'utf-8').trim();

// Attempt to parse company slug and candidate name
const reportFilename = basename(reportPath);
const match = reportFilename.match(/^\d+-([a-z0-9-]+)-\d{4}-\d{2}-\d{2}\.md$/);
const companySlug = match ? match[1] : 'unknown-company';

// Extract role from report header (e.g., "# Evaluation: Company - Role Title")
let roleSlug = 'role';
const roleMatch = reportText.match(/^#\s+Evaluation:\s+[^-]+\s+-\s+(.+?)$/m);
if (roleMatch && roleMatch[1]) {
  roleSlug = roleMatch[1]
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Endpoint + security guard.
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
   Your data and API key would be sent in cleartext.
   Use an https:// endpoint, or http://localhost:... for a local server.
`);
    process.exit(1);
  }

  if (!isLoopback && !apiKey) {
    console.error(`
❌  No API key for ${endpointHost}.
   Set one and re-run: OPENAI_API_KEY=your_key node openai-tailor.mjs ...
`);
    process.exit(1);
  }
}

const endpoint = `${baseUrl}/chat/completions`;

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------
function readFile(path, label, required = false) {
  if (!existsSync(path)) {
    if (required) {
      console.error(`❌  Required context file not found: ${label} at ${path}`);
      process.exit(1);
    }
    console.warn(`⚠️   ${label} not found at: ${path}`);
    return `[${label} not found — skipping]`;
  }
  return readFileSync(path, 'utf-8').trim();
}

// ---------------------------------------------------------------------------
// Load context files
// ---------------------------------------------------------------------------
console.log('\\n📂  Loading context files...');

const sharedContext  = readFile(PATHS.shared, 'modes/_shared.md', false);
// Writing guardrails (Voice DNA / Writing Style / Professional Writing) live in
// _writing.md since #1710 — a CV-tailoring script needs them, unlike the eval
// engines that read the eval-core _shared.md alone.
const writingContext = readFile(PATHS.writing, 'modes/_writing.md', false);
const pdfModeLogic   = readFile(PATHS.pdfMode, 'modes/pdf.md', false);
const cvContent      = readFile(PATHS.cv, 'cv.md', true);
const profileContent = readFile(PATHS.profile, 'config/profile.yml', true);
// templates/cv-template.html is deliberately NOT read here. It used to be
// injected into this prompt so the model could fill {{PLACEHOLDERS}} itself,
// which put the whole document's markup into both the prompt and the response.
// build-cv-html.mjs now owns the template end to end — see the JSON migration
// note in the output contract below.

// ---------------------------------------------------------------------------
// Build system prompt
// ---------------------------------------------------------------------------
const systemPrompt = `You are career-ops, an AI-powered CV tailoring engine.
You read a candidate's base CV, profile, an evaluation report, and a Job Description.
Your job is to apply strict anti-fabrication tailoring rules and return a single
structured CV payload as JSON. You never write HTML, CSS, or document markup —
a deterministic renderer owns every tag and escaping decision.

═══════════════════════════════════════════════════════
SYSTEM CONTEXT (_shared.md)
═══════════════════════════════════════════════════════
${sharedContext}

═══════════════════════════════════════════════════════
WRITING GUARDRAILS (_writing.md)
═══════════════════════════════════════════════════════
${writingContext}

═══════════════════════════════════════════════════════
PDF TAILORING MODE (pdf.md)
═══════════════════════════════════════════════════════
${pdfModeLogic}

═══════════════════════════════════════════════════════
CANDIDATE BASE CV & PROFILE
═══════════════════════════════════════════════════════
[cv.md]
${cvContent}

[config/profile.yml]
${profileContent}

═══════════════════════════════════════════════════════
IMPORTANT OPERATING RULES FOR THIS SESSION
═══════════════════════════════════════════════════════
1. NEVER invent skills, metrics, or experience the candidate does not have.
2. Inject keywords naturally by reformulating the real experience using JD vocabulary.
3. Apply the 6-second clarity gate: strongest matching evidence first.
4. Output contract: a single JSON object matching the SCHEMA below, and nothing else.

═══════════════════════════════════════════════════════
OUTPUT SCHEMA (strict JSON — the renderer reads these exact keys)
═══════════════════════════════════════════════════════
Top-level keys: lang, page_format, candidate, summary, competencies,
experience, projects, education, certifications, awards, skills, interests

- candidate: { name, phone, email, location, photo, photo_style,
  linkedin: {url, display}, github: {url, display}, portfolio: {url, display} }
- summary: string (30-55 words, 2-3 sentences, exactly ONE anchor metric)
- competencies: array of strings (the PM/product spine, NOT tool names)
- experience: array of { company, role, location, dates, bullets: [string] }
    • company and role are REQUIRED — an entry missing either renders nothing
    • bullets MUST be an array of strings, never a newline-joined string,
      never prose, never HTML "<li>" markup
- projects: array of { name, badge, description, bullets: [string], tech, url }
    • name is REQUIRED; bullets, when present, MUST be an array of strings
- education: array of { title, org, location, year, description }
    • title is REQUIRED. Use THIS vocabulary (title/org/year) — do NOT emit
      institution/degree/dates, which are the LaTeX dialect and render nothing
- certifications: array of { title, org, year }   • title is REQUIRED
- awards: array of { title, org, year }            • title is REQUIRED
- skills: array of { category, items }
    • items may be a comma-separated string OR an array of strings
- interests: array of strings

═══════════════════════════════════════════════════════
HARD OUTPUT RULES
═══════════════════════════════════════════════════════
5. Respond with RAW JSON only. Do NOT wrap it in \`\`\`json fences, and do NOT
   add any prose before or after the object.
6. Do NOT emit any HTML, CSS, <style>, <div>, <ul>, <li>, <html>, or <!DOCTYPE>
   anywhere in the output — not as template filler, not as bullet text, not
   inside a string field. All markup is the renderer's job.
7. Every entry MUST use the key names above verbatim. A misspelled key
   (e.g. "educations", "institution", "period" on a project) is dropped from
   the rendered CV with no warning, so spell them exactly as specified.`;

// ---------------------------------------------------------------------------
// Prompt caching (#1709, closing the gap in #2432) — same shape as
// openai-eval.mjs. This system prompt (shared + writing + pdf mode + cv +
// profile) is byte-identical across every offer, yet was re-sent and re-billed
// each call. Dropping the HTML template from the prompt (the JSON migration)
// shrinks this prefix further, which is cached too.
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

let modelOutput;
try {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model:    modelName,
      messages: [
        buildSystemMessage(systemPrompt, endpointHost),
        { role: 'user',   content: `EVALUATION REPORT:\n\n${reportText}\n\nJOB DESCRIPTION:\n\n${jdText}\n\nNow produce the tailored CV payload as a single raw JSON object matching the OUTPUT SCHEMA. Output ONLY the JSON object.` },
      ],
      stream:      false,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`❌  API error: HTTP ${res.status}`);
    console.error(`    ${body.slice(0, 300)}`);
    process.exit(1);
  }

  const data = await res.json();
  modelOutput = data.choices?.[0]?.message?.content?.trim();
  if (!modelOutput) {
    console.error('❌  The endpoint returned an empty response.');
    process.exit(1);
  }
} catch (err) {
  console.error(`❌  API call failed: ${err.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse -> normalize -> validate (see the extracted pipeline above)
// ---------------------------------------------------------------------------
const parsedOrError = parseModelOutput(modelOutput);
if (!parsedOrError.ok) {
  console.error(`❌  ${parsedOrError.reason}`);
  console.error(`    ${parsedOrError.detail}`);
  console.error(`    First 300 characters of the response: ${parsedOrError.json.slice(0, 300)}`);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(parsedOrError.json);
} catch (err) {
  console.error(`❌  Failed to parse the model response as JSON: ${err.message}`);
  console.error(`    First 300 characters: ${parsedOrError.json.slice(0, 300)}`);
  process.exit(1);
}

// Fatal errors mean an entry would render nothing — stop rather than ship a
// CV with a hole. Notes and warnings are the model's contract drift made
// visible; they render, so they are reported rather than fatal.
const { payload, notes, errors, warnings } = preparePayload(parsed);

if (notes.length) {
  console.log(`\n🔧  Normalizer applied ${notes.length} repair(s):`);
  for (const message of notes) console.log(`   - ${message}`);
}
if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} payload warning(s):`);
  for (const message of warnings) console.log(`   - ${message}`);
}
if (errors.length) {
  console.error('\n❌  Invalid CV payload — refusing to render:');
  for (const message of errors) console.error(`   - ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Hand the validated payload to the deterministic renderer
//
// build-cv-html.mjs owns every tag, class and escaping decision — that split
// is the whole point of the JSON migration. It is a CLI script (it reads the
// payload from a path), so the payload is staged to a temp JSON file and the
// script is invoked on it. The payload file is kept alongside the HTML: it is
// the artefact that lets a later run re-render without re-paying for the model.
// ---------------------------------------------------------------------------
try {
  if (!existsSync(PATHS.output)) {
    mkdirSync(PATHS.output, { recursive: true });
  }

  let candidateName = 'candidate';
  try {
    const profile = yaml.load(profileContent);
    if (profile && profile.name) {
      candidateName = profile.name;
    }
  } catch (err) {
    console.warn(`⚠️   Failed to parse profile.yml: ${err.message}`);
  }
  candidateName = candidateName
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const filename = `cv-${candidateName}-${companySlug}.html`;
  const htmlPath = join(PATHS.output, filename);
  const payloadPath = join(PATHS.output, `cv-${candidateName}-${companySlug}.payload.json`);

  const rendered = renderPayload(payload, payloadPath, htmlPath);
  if (!rendered.ok) {
    console.error(`❌  build-cv-html.mjs rejected the payload:\n${rendered.stderr}`);
    process.exit(1);
  }
  console.log(`\n📦  Validated payload saved: ${payloadPath}`);

  // build-cv-html.mjs prints its own JSON report (valid/counts/warnings).
  if (rendered.report) console.log(JSON.stringify(rendered.report, null, 2));
  else console.log(rendered.stdout);
  console.log(`\n✅  Tailored HTML saved: ${htmlPath}`);

  // Print next steps
  const pdfFilename = `cv-${candidateName}-${companySlug}-${roleSlug}-${new Date().toISOString().split('T')[0]}.pdf`;
  const reportNumMatch = reportFilename.match(/^(\d+)-/);
  const reportNum = reportNumMatch ? reportNumMatch[1] : '001';

  console.log(`\n📄  Next step (generate PDF):\n    node generate-pdf.mjs output/${filename} output/${pdfFilename} --format=letter --report=${reportNum}\n`);

} catch (err) {
  console.warn(`⚠️   Could not build HTML: ${err.message}`);
  process.exit(1);
}
