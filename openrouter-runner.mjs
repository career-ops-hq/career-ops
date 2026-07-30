#!/usr/bin/env node
/**
 * career-ops OpenRouter Runner
 * No Claude Code CLI required — uses OpenRouter free models with automatic fallback.
 *
 * Usage:
 *   node openrouter-runner.mjs scan              → Scan Greenhouse API companies for new listings
 *   node openrouter-runner.mjs evaluate <url>    → Evaluate a job by URL
 *   node openrouter-runner.mjs evaluate          → Paste job text interactively
 *   node openrouter-runner.mjs pipeline          → Process all pending URLs from pipeline.md
 *   node openrouter-runner.mjs apply <report_no> → Generate draft application form answers
 *   node openrouter-runner.mjs models            → List available free models
 *   node openrouter-runner.mjs help              → Show this help
 *
 * Setup:
 *   1. copy .env.example .env
 *   2. Add OPENROUTER_API_KEY=sk-or-v1-... to .env
 *   3. Free API key: https://openrouter.ai
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import yaml from 'js-yaml';
import { outputLanguageInstruction, parseOutputLanguage } from './profile-language.mjs';
import {
  formatReportNumber, releaseReportNumbers, reserveReportNumbers,
} from './reserve-report-num.mjs';
import { TokenAccumulator, formatBreakdown, normalizeOpenAIUsage } from './utils/token-tracker.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tracker = new TokenAccumulator();
let activeModel = null;

// ---------------------------------------------------------------------------
// .env loader
// ---------------------------------------------------------------------------
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^(['"])(.*?)\1$/, '$2');
    }
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const OPENROUTER_API_URL    = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const MAX_TOKENS            = 8192;
const RATE_LIMIT_DELAY_MS   = 2500;  // pause between requests on free tier
const MODEL_TIMEOUT_MS      = 15_000; // abort a single model call after 15 s

// Provider priority order — models are sorted by provider prefix, not hardcoded names.
// Add, remove, or reorder providers here; model names are resolved at runtime from the API.
const PROVIDER_PRIORITY = [
  'google',
  'qwen',
  'openai',
  'meta-llama',
  'nvidia',
  'mistralai',
  'nousresearch',
  'minimax',
  'arcee-ai',
  // any unlisted provider goes last (alphabetical)
];

// In-memory model list — populated on first callOpenRouter()
let freeModels = null;   // string[]
let modelIndex = 0;      // current position in rotation

// Persistent blacklist file — survives process restarts
const BLACKLIST_FILE = path.join(__dirname, 'data', 'model-blacklist.json');
function loadPersistedBlacklist() {
  try {
    const data = JSON.parse(fs.readFileSync(BLACKLIST_FILE, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}
function saveBlacklist(set) {
  try {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
    fs.writeFileSync(BLACKLIST_FILE, JSON.stringify([...set], null, 2), 'utf-8');
  } catch {}
}

// Models that failed permanently (403, timeout, persistent 429) — never retry
const blacklistedModels = new Set(loadPersistedBlacklist());
if (blacklistedModels.size > 0) {
  console.log(`[blacklist] Loaded ${blacklistedModels.size} pre-blacklisted model(s) from disk.`);
}
// 429 failure count per model — auto-blacklist after 3 consecutive 429s
const rateLimitCounts = {};

// ---------------------------------------------------------------------------
// Fetch free models from OpenRouter API
// ---------------------------------------------------------------------------
async function loadFreeModels() {
  if (freeModels !== null) return freeModels;

  try {
    const resp = await fetch(OPENROUTER_MODELS_URL, {
      headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    // A model is free when its prompt and completion pricing are both "0"
    const list = (data.data ?? [])
      .filter(m => {
        const p = m.pricing ?? {};
        return String(p.prompt) === '0' && String(p.completion) === '0';
      })
      .map(m => m.id);

    if (list.length === 0) throw new Error('No free models found in API response');

    // Sort by provider priority; within the same provider sort alphabetically
    function providerOf(id) { return id.split('/')[0]; }
    function priorityOf(id) {
      const idx = PROVIDER_PRIORITY.indexOf(providerOf(id));
      return idx === -1 ? PROVIDER_PRIORITY.length : idx;
    }

    freeModels = list.sort((a, b) => {
      const diff = priorityOf(a) - priorityOf(b);
      return diff !== 0 ? diff : a.localeCompare(b);
    });

    console.log(`[models] ${freeModels.length} free models loaded from OpenRouter API.`);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const hasKey = Boolean(process.env.OPENROUTER_API_KEY);
    throw new Error(
      `[models] Failed to fetch free model list: ${reason}. ` +
      (hasKey ? 'Check that your API key is valid and that network access to OpenRouter is available.'
               : 'OPENROUTER_API_KEY is not set — copy .env.example to .env and add your key.')
    );
  }

  return freeModels;
}

// List and exit (helper command)
async function cmdModels() {
  const models = await loadFreeModels();
  console.log(`\nFree models available on OpenRouter (${models.length} total):\n`);
  models.forEach((id, i) => console.log(`  ${String(i + 1).padStart(2)}. ${id}`));
  console.log('');
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------
function readFile(relPath) {
  try { return fs.readFileSync(path.join(__dirname, relPath), 'utf-8'); }
  catch { return null; }
}

function writeFile(relPath, content) {
  const full = path.join(__dirname, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

function fileExists(relPath) {
  return fs.existsSync(path.join(__dirname, relPath));
}

// ---------------------------------------------------------------------------
// Prompt caching (#1709)
// ---------------------------------------------------------------------------
// The static system prefix (shared + profile + mode + cv, ~12K tokens) is
// byte-identical across every offer in a run, yet it was re-sent and re-billed
// on each call. Send it as a structured content block with an ephemeral
// `cache_control` breakpoint — OpenRouter's documented prompt-caching mechanism.
// Providers that support caching (Anthropic, Gemini, …) reuse the prefix across
// back-to-back calls within the cache TTL; providers that don't simply ignore
// the field, so this is a safe passthrough that never changes the prompt text.
export function buildCachedSystemMessage(systemPrompt) {
  return {
    role: 'system',
    content: [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
    ],
  };
}

// ---------------------------------------------------------------------------
// OpenRouter API call — automatic model rotation with fallback
// ---------------------------------------------------------------------------
async function callOpenRouter(systemPrompt, userMessage) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      'OPENROUTER_API_KEY not found.\n' +
      'Copy .env.example to .env and add your API key.\n' +
      'Free key: https://openrouter.ai'
    );
  }

  const pinnedModel = process.env.CAREER_OPS_MODEL;
  if (pinnedModel) {
    activeModel = pinnedModel;
    process.stdout.write(`[model] ${pinnedModel} (pinned) ... `);
    const body = JSON.stringify({
      model: pinnedModel,
      messages: [
        buildCachedSystemMessage(systemPrompt),
        { role: 'user', content: userMessage },
      ],
      max_tokens: MAX_TOKENS,
    });
    const ctrl = new AbortController();
    const timerId = setTimeout(() => ctrl.abort(), MODEL_TIMEOUT_MS);
    try {
      const resp = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type':  'application/json',
          'HTTP-Referer':  'https://github.com/santifer/career-ops',
          'X-Title':       'career-ops',
        },
        body,
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${t.slice(0, 120)}`);
      }
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      const content = data.choices?.[0]?.message?.content ?? '';
      if (!content) throw new Error('Empty response');
      console.log('OK');
      const usage = normalizeOpenAIUsage(data.usage);
      return { content, usage };
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(`Pinned model timed out after ${MODEL_TIMEOUT_MS / 1000}s`);
      throw e;
    } finally {
      clearTimeout(timerId);
    }
  }

  const models = await loadFreeModels();
  let lastError;

  if (models.length === 0) {
    throw new Error(
      'No free OpenRouter models are available. Model loading may have failed, or your account currently has no free models.'
    );
  }
  // Build the active (non-blacklisted) model list in rotation order
  const active = models.filter(m => !blacklistedModels.has(m));
  if (active.length === 0) throw new Error('All loaded models have been blacklisted this session.');

  for (let attempt = 0; attempt < active.length; attempt++) {
    const model = active[(modelIndex % active.length + attempt) % active.length];
    activeModel = model;
    process.stdout.write(`[model] ${model} ... `);

    try {
      const body = JSON.stringify({
        model,
        messages: [
          buildCachedSystemMessage(systemPrompt),
          { role: 'user', content: userMessage },
        ],
        max_tokens: MAX_TOKENS,
      });

      const controller = new AbortController();
      const timerId = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
      let data;
      try {
        const resp = await fetch(OPENROUTER_API_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type':  'application/json',
            'HTTP-Referer':  'https://github.com/santifer/career-ops',
            'X-Title':       'career-ops',
          },
          body,
          signal: controller.signal,
        });
        if (!resp.ok) {
          const t = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${t.slice(0, 120)}`);
        }
        data = await resp.json();
      } catch (e) {
        if (e.name === 'AbortError') throw new Error(`Timeout after ${MODEL_TIMEOUT_MS / 1000}s`);
        throw e;
      } finally {
        clearTimeout(timerId);
      }
      if (data.error) throw new Error(data.error.message);

      const content = data.choices?.[0]?.message?.content ?? '';
      if (!content) throw new Error('Empty response');

      const usage = normalizeOpenAIUsage(data.usage);

      modelIndex = (modelIndex + attempt + 1) % active.length;
      console.log('OK');
      return { content, usage };

    } catch (e) {
      lastError = e;
      const msg = e.message.split('\n')[0];

          const is403     = msg.includes('HTTP 403');
      const isTimeout = msg.startsWith('Timeout');
      const is429     = msg.includes('HTTP 429') || msg.includes('rate-li') || msg.includes('rate limit') || msg.includes('temporarily rate');
      if (is403 || isTimeout) {
        blacklistedModels.add(model);
        saveBlacklist(blacklistedModels);
        console.log(`SKIP (blacklisted: ${msg})`);
      } else if (is429) {
        rateLimitCounts[model] = (rateLimitCounts[model] ?? 0) + 1;
        if (rateLimitCounts[model] >= 3) {
          blacklistedModels.add(model);
          saveBlacklist(blacklistedModels);
          console.log(`SKIP (auto-blacklisted: persistent 429)`);
        } else {
          console.log(`FAILED (HTTP 429 [${rateLimitCounts[model]}/3])`);
          await new Promise(r => setTimeout(r, 800));
        }
      } else {
        console.log(`FAILED (${msg})`);
        await new Promise(r => setTimeout(r, 800));
      }
    }
  }

  throw new Error(`All ${active.length} active models failed. Last error: ${lastError?.message}`);
}

// ---------------------------------------------------------------------------
// Context loading
// ---------------------------------------------------------------------------
function loadContext() {
  return {
    cv:          readFile('cv.md')               ?? 'CV not found.',
    profile:     readFile('config/profile.yml')  ?? '',
    shared:      readFile('modes/_shared.md')    ?? '',
    profileMode: readFile('modes/_profile.md')   ?? '',
  };
}

export function buildSystemPrompt(modeContent, ctx) {
  const languageInstruction = outputLanguageInstruction(parseOutputLanguage(ctx.profile));
  return [
    ctx.shared,
    ctx.profileMode,
    modeContent,
    '---',
    'CANDIDATE PROFILE (YAML):',
    ctx.profile,
    '---',
    'CV (Markdown):',
    ctx.cv,
    '---',
    'OUTPUT LANGUAGE:',
    languageInstruction,
  ].filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------------------
// Job page content fetcher (Playwright-first, plain fetch fallback)
// ---------------------------------------------------------------------------
// Reject unsafe fetch targets (SSRF defense-in-depth): http(s) only, never
// loopback / link-local / private / cloud-metadata hosts. URLs come from the
// user's own portals.yml / pipeline.md, but we still fail closed.
function assertSafeRemoteUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`Invalid URL: ${url}`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error(`Refusing non-HTTP(S) URL: ${url}`);
  }
  const host = u.hostname.toLowerCase();
  const blocked = host === 'localhost' || host === '::1' || host.endsWith('.local') ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) throw new Error(`Refusing private/loopback host: ${host}`);
  return u;
}

async function fetchJobPage(url) {
  assertSafeRemoteUrl(url);
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.warn('[fetch] Playwright unavailable — falling back to plain fetch.');
  }

  if (chromium) {
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2000); // wait for SPA render
      const text = await page.evaluate(() => {
        document.querySelectorAll('script,style,nav,footer,header').forEach(el => el.remove());
        return (document.body?.innerText || document.body?.textContent || '').replace(/\s+/g, ' ').trim();
      });
      return text.slice(0, 16_000);
    } catch (e) {
      console.warn(`[fetch] Playwright error: ${e.message} — falling back to plain fetch.`);
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  // Plain HTTP fallback
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; career-ops/1.0)' }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    const html = await r.text();
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 16_000);
  } catch (e) {
    throw new Error(`Could not fetch job page: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// portals.yml parser — reads the canonical schema with js-yaml (same library and
// field names as scan.mjs: `title_filter.positive/negative` + `tracked_companies`),
// so it never drifts from the main scanner. The runner's no-CLI scan path covers
// companies that expose a direct JSON `api:`; careers_url-only / Playwright /
// search-query companies are handled by the full /career-ops scan pipeline.
// `rawOverride` lets tests feed YAML text directly (see test-all.mjs drift guard).
// ---------------------------------------------------------------------------
function normKeywords(v) {
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x ?? '').toLowerCase().trim()).filter(Boolean);
}

export function parsePortals(rawOverride) {
  const raw = rawOverride ?? readFile('portals.yml');
  if (!raw) throw new Error('portals.yml not found');
  const config = yaml.load(raw) || {};

  const tf = config.title_filter || {};
  const positive = normKeywords(tf.positive);
  const negative = normKeywords(tf.negative);
  function titleMatches(title) {
    const t = String(title ?? '').toLowerCase();
    return positive.some(k => t.includes(k)) && !negative.some(k => t.includes(k));
  }

  // Companies with a direct JSON `api:` endpoint (the no-CLI scan path).
  const tracked = Array.isArray(config.tracked_companies) ? config.tracked_companies : [];
  const companies = tracked
    .filter(c => c && c.api && c.enabled !== false)
    .map(c => ({ name: String(c.name ?? c.company ?? 'Unknown'), api: String(c.api).trim() }));

  return { companies, titleMatches };
}

// ---------------------------------------------------------------------------
// pipeline.md management
// ---------------------------------------------------------------------------
function readPipeline() {
  const content = readFile('data/pipeline.md') ?? '';
  const pending = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^- \[ \] (.+)/);
    if (m) {
      const parts = m[1].split(' | ');
      pending.push({
        url:     parts[0]?.trim() ?? '',
        company: parts[1]?.trim() ?? 'Unknown',
        role:    parts[2]?.trim() ?? 'Unknown',
      });
    }
  }
  return pending;
}

function markPipelineDone(url) {
  let content = readFile('data/pipeline.md') ?? '';
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  content = content.replace(
    new RegExp(`^(- \\[ \\] ${escaped}.*)$`, 'm'),
    (ln) => ln.replace('- [ ]', '- [x]')
  );
  writeFile('data/pipeline.md', content);
}

function addToPipeline(entries) {
  const history = readFile('data/scan-history.tsv') ?? 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n';
  const seenUrls = new Set(history.split('\n').slice(1).map(l => l.split('\t')[0]).filter(Boolean));

  const existingPipeline = readFile('data/pipeline.md') ?? '# Pipeline\n\n## Pending\n';
  const existingApps     = readFile('data/applications.md') ?? '';
  // extract URLs already tracked in applications.md (mirrors scan.mjs dedup logic)
  const appliedUrls = new Set(
    existingApps.split('\n')
      .map(l => l.match(/https?:\/\/[^\s|)]+/))
      .filter(Boolean).map(m => m[0])
  );

  const newEntries = entries.filter(e => {
    if (seenUrls.has(e.url)) return false;
    if (appliedUrls.has(e.url)) return false;
    // skip if already queued in pipeline
    if (existingPipeline.includes(e.url)) return false;
    return true;
  });

  if (newEntries.length === 0) return 0;

  const today = new Date().toISOString().split('T')[0];
  let pipeline = existingPipeline;
  let hist = history;

  for (const e of newEntries) {
    pipeline += `- [ ] ${e.url} | ${e.company} | ${e.role}\n`;
    hist     += `${e.url}\t${today}\tscan\t${e.role}\t${e.company}\tadded\t${e.location ?? ''}\n`;
  }

  writeFile('data/pipeline.md', pipeline);
  writeFile('data/scan-history.tsv', hist);
  return newEntries.length;
}

function extractCompanySlug(text, url) {
  // Try to extract from text (e.g. "Senior Engineer at Acme" or "Company: Acme")
  const m = text.match(/(?:at|@|company[:\s]+)\s*([A-Z][A-Za-z0-9]{2,25})/);
  if (m) return m[1].toLowerCase().replace(/[^a-z0-9]+/g, '-');
  // Fall back to URL hostname (e.g. job-boards.greenhouse.io/acme → acme)
  if (url) {
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      const slug = parts[0] ?? 'company';
      return slug.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    } catch { /* not a valid URL */ }
  }
  return 'company';
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

// -- SCAN --
async function cmdScan() {
  tracker.recordZeroToken('scan');
  tracker.recordZeroToken('evaluation');
  tracker.recordZeroToken('pdf payload');
  console.log('Scanning Greenhouse portals...\n');

  let portals;
  try { portals = parsePortals(); }
  catch (e) { console.error(e.message); return; }

  const { companies, titleMatches } = portals;
  console.log(`Greenhouse API companies: ${companies.length}\n`);

  const found = [];
  for (const c of companies) {
    process.stdout.write(`  ${c.name.padEnd(25)} → `);
    try {
      assertSafeRemoteUrl(c.api);
      const r = await fetch(c.api);
      if (!r.ok) { console.log(`HTTP ${r.status}`); continue; }
      const data = await r.json();
      const jobs = data.jobs ?? [];
      const matched = jobs.filter(j => titleMatches(j.title));
      console.log(`${jobs.length} listings, ${matched.length} matched`);
      for (const j of matched) {
        // Skip postings without a public URL — falling back to the API
        // endpoint would write an unusable link into the pipeline.
        if (!j.absolute_url) continue;
        found.push({ url: j.absolute_url, company: c.name, role: j.title, location: j.location?.name ?? '' });
      }
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
  }

  const added = addToPipeline(found);
  console.log(`\n✅ Scan complete. ${found.length} matches, ${added} new entries added to pipeline.md.`);
  if (added > 0) {
    console.log('\n→  node openrouter-runner.mjs pipeline\n   to evaluate pending listings.\n');
  }
}

// -- EVALUATE --
async function cmdEvaluate(input, ctx) {
  tracker.recordZeroToken('scan');
  tracker.recordZeroToken('pdf payload');
  const modeContent = readFile('modes/oferta.md') ?? readFile('modes/auto-pipeline.md') ?? '';

  let jdText = input;

  if (!input) {
    // Interactive paste mode
    console.log('Paste job description or URL, then press Enter on an empty line:\n');
    const rl = readline.createInterface({ input: process.stdin });
    const lines = [];
    try {
      for await (const line of rl) {
        if (line === '') break;
        lines.push(line);
      }
    } finally {
      rl.close();
    }
    jdText = lines.join('\n');
    if (!jdText.trim()) { console.log('No input provided.'); return null; }
  } else if (input.startsWith('http')) {
    console.log('Fetching job page...');
    try {
      const content = await fetchJobPage(input);
      jdText = `URL: ${input}\n\n${content}`;
    } catch (e) {
      console.error(e.message);
      return null;
    }
  }

  console.log('\nEvaluating...');
  const systemPrompt = buildSystemPrompt(modeContent, ctx);

  let resultObj;
  try {
    resultObj = await callOpenRouter(systemPrompt, `Evaluate this job listing:\n\n${jdText}`);
  } catch (e) {
    console.error(`OpenRouter error: ${e.message}`);
    return null;
  }
  tracker.record('evaluation', resultObj.usage);
  const result = resultObj.content;

  let reservedNumbers;
  try {
    reservedNumbers = await reserveReportNumbers(1, {
      rootDir: __dirname,
      reportsDir: path.join(__dirname, 'reports'),
    });
  } catch (e) {
    console.error(`Could not reserve a report number: ${e.message}`);
    return null;
  }

  try {
    // Save report
    const today   = new Date().toISOString().split('T')[0];
    const num     = reservedNumbers[0];
    const slug    = extractCompanySlug(jdText, typeof input === 'string' ? input : null);
    const numStr  = formatReportNumber(num);
    const relPath = `reports/${numStr}-${slug}-${today}.md`;

    // Extract Legitimacy from LLM output or fall back to placeholder
    const legitMatch = result.match(/\*\*Legitimacy:\*\*\s*([^\n]+)/);
    const legitLine  = legitMatch ? `**Legitimacy:** ${legitMatch[1].trim()}` : '**Legitimacy:** unconfirmed';
    writeFile(relPath, `**URL:** ${input || '(pasted)'}\n${legitLine}\n\n${result}`);

    const scoreMatch  = result.match(/(?:score|puntuaci[oó]n)[^\d]*(\d+\.?\d*)/i);
    const scoreValue  = scoreMatch ? parseFloat(scoreMatch[1]) : NaN;
    const scoreStr    = isFinite(scoreValue) ? `${scoreValue.toFixed(1)}/5` : '';
    const companyName = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const reportLink  = `[${numStr}](reports/${numStr}-${slug}-${today}.md)`;
    const tsvLine     = `${num}\t${today}\t${companyName}\t(see report)\tEvaluated\t${scoreStr}\t❌\t${reportLink}\t\n`;
    const tsvFile     = `batch/tracker-additions/or-${numStr}-${slug}.tsv`;
    writeFile(tsvFile, `num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n${tsvLine}`);

    console.log(`\n✅ Report saved: ${relPath}`);
    console.log('\n─── EVALUATION ──────────────────────────────────────\n');
    console.log(result);
    console.log('\n─────────────────────────────────────────────────────\n');

    return relPath;
  } finally {
    try {
      await releaseReportNumbers(reservedNumbers, { reportsDir: path.join(__dirname, 'reports') });
    } catch (e) {
      console.warn(`Could not release report reservation: ${e.message}`);
    }
  }
}

// -- PIPELINE --
async function cmdPipeline(ctx) {
  const pending = readPipeline();
  if (pending.length === 0) {
    console.log('No pending listings in pipeline.md.');
    return;
  }

  console.log(`Processing ${pending.length} pending listing(s) from pipeline.md...\n`);

  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    console.log(`\n[${i + 1}/${pending.length}] ${item.company} — ${item.role}`);
    try {
      const report = await cmdEvaluate(item.url, ctx);
      if (report) markPipelineDone(item.url);
    } catch (e) {
      console.error(`  Error: ${e.message}`);
    }
    if (i < pending.length - 1) {
      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS));
    }
  }

  console.log('\n✅ Pipeline processing complete.\n');
}

// -- APPLY --
async function cmdApply(ref, ctx) {
  tracker.recordZeroToken('scan');
  tracker.recordZeroToken('evaluation');
  tracker.recordZeroToken('pdf payload');
  const modeContent = readFile('modes/apply.md') ?? '';

  let reportContent;
  if (fileExists(ref)) {
    reportContent = readFile(ref);
  } else {
    const numStr = String(ref).padStart(3, '0');
    const reportsDir = path.join(__dirname, 'reports');
    const dirEntries = fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir) : [];
    const matches = dirEntries.filter(f => f.startsWith(numStr));
    if (matches.length === 0) {
      console.error(`Report not found: ${ref}`);
      return;
    }
    reportContent = readFile(`reports/${matches[0]}`);
  }

  if (!reportContent) { console.error('Could not read report content.'); return; }

  // Score-gate: warn and confirm before applying to low-fit roles (AGENTS.md Ethical Use)
  const scoreMatch = reportContent.match(/^\s*\*?\*?\s*(?:score|puntuaci[oó]n)\s*:\s*\*?\*?\s*(\d+(?:\.\d+)?)\s*\/\s*5/im);
  const scoreValue = scoreMatch ? parseFloat(scoreMatch[1]) : NaN;
  if (isFinite(scoreValue) && scoreValue < 4.0) {
    console.log(`\n⚠️  This report scored ${scoreValue.toFixed(1)}/5 — below the 4.0/5 threshold.`);
    console.log('Strongly discourage low-fit applications. Your time and the recruiter\'s time are both valuable.');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => {
      rl.question('Proceed anyway? (yes/no): ', resolve);
    });
    rl.close();
    if (answer.trim().toLowerCase() !== 'yes') {
      console.log('Aborted.');
      return;
    }
  }

  console.log('Generating application form answers...');
  const systemPrompt = buildSystemPrompt(modeContent, ctx);

  let resultObj;
  try {
    resultObj = await callOpenRouter(
      systemPrompt,
      `Generate application form answers based on this evaluation report:\n\n${reportContent}`
    );
  } catch (e) {
    console.error(`OpenRouter error: ${e.message}`);
    return;
  }
  tracker.record('apply', resultObj.usage);
  const result = resultObj.content;

  console.log('\n─── APPLICATION ANSWERS ─────────────────────────────\n');
  console.log(result);
  console.log('\n─────────────────────────────────────────────────────\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
// Only run the CLI when invoked directly (`node openrouter-runner.mjs ...`), so the
// module can be imported (e.g. by test-all.mjs) without executing a command.
const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const [,, command, ...args] = invokedDirectly ? process.argv : [];
const ctx = invokedDirectly ? loadContext() : null;

// Load free models list before running any AI command (skip when a model is pinned)
if (invokedDirectly && ['evaluate', 'eval', 'pipeline', 'apply', 'models'].includes(command) && !process.env.CAREER_OPS_MODEL) {
  await loadFreeModels();
}

if (invokedDirectly) switch (command) {
  case 'scan':
    await cmdScan();
    break;

  case 'evaluate':
  case 'eval':
    await cmdEvaluate(args.join(' ').trim() || null, ctx);
    break;

  case 'pipeline':
    await cmdPipeline(ctx);
    break;

  case 'apply':
    if (!args[0]) { console.error('Usage: node openrouter-runner.mjs apply <report_num|report_path>'); break; }
    await cmdApply(args[0], ctx);
    break;

  case 'models':
    await cmdModels();
    break;

  default:
    console.log(`
career-ops OpenRouter Runner
Auto-fetches free models from OpenRouter API and rotates through them with fallback.

COMMANDS:
  node openrouter-runner.mjs scan              → Scan Greenhouse APIs for new matching listings
  node openrouter-runner.mjs evaluate <url>    → Evaluate a listing by URL
  node openrouter-runner.mjs evaluate          → Paste a job description interactively
  node openrouter-runner.mjs pipeline          → Batch-evaluate all pending entries in pipeline.md
  node openrouter-runner.mjs apply <report_no> → Generate application form answers from a report
  node openrouter-runner.mjs models            → List available free models from OpenRouter

SETUP:
  1. Copy .env.example to .env
  2. Add your key: OPENROUTER_API_KEY=sk-or-v1-...
  3. Free API key: https://openrouter.ai

MODEL SELECTION:
  - Free models are fetched automatically via the OpenRouter API at runtime.
  - They are tried in sequence; if one fails the next is used automatically.
  - Pin a model:  CAREER_OPS_MODEL=deepseek/deepseek-r1:free node openrouter-runner.mjs eval <url>
`);
}

if (invokedDirectly && ['scan', 'evaluate', 'eval', 'pipeline', 'apply'].includes(command)) {
  const modelName = process.env.CAREER_OPS_MODEL || activeModel || 'free-rotation';
  console.log('\n' + formatBreakdown(tracker, modelName, 'openrouter'));
}
