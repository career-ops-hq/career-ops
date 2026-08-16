#!/usr/bin/env node
/**
 * eval-batch.mjs — Batch evaluation through the centrally configured CareerOps LLM
 * 
 * For each pipeline item:
 *   1. Fetch JD page via Playwright
 *   2. Build prompt with CV + profile + JD inline
 *   3. Evaluate through config/careerops-llm.yml
 *   4. Parse JSON score, save report + tracker TSV
 * 
 * Usage: node eval-batch.mjs [--max N]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { spawn, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import yaml from 'js-yaml';
import { callCareerOpsLlm } from './on-demand-tools/careerops-llm.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CV = path.join(DIR, 'cv.md');
const PROFILE = path.join(DIR, 'config', 'profile.yml');
const PORTALS = path.join(DIR, 'portals.yml');
const PIPELINE = path.join(DIR, 'data', 'pipeline.md');

// Load context once
const cvText = existsSync(CV) ? readFileSync(CV, 'utf-8') : '';
const profileText = existsSync(PROFILE) ? readFileSync(PROFILE, 'utf-8') : '';
const userName = (() => { try { return yaml.load(profileText)?.name || 'Sidhartha'; } catch { return 'Sidhartha'; } })();

function pipe() {
  if (!existsSync(PIPELINE)) return [];
  return readFileSync(PIPELINE, 'utf-8').split('\n')
    .filter(l => /^- \[ \] /.test(l))
    .map(l => {
      // Positional: url | company | role | [location] | [compensation] | [posted: ...]
      const p = l.replace(/^- \[ \] /, '').split(' | ');
      const url = p[0]?.trim() || '';
      const company = p[1]?.trim() || '';
      const role = p[2]?.trim() || '';
      // Location is the 4th column when it doesn't look like a salary or a
      // posted: marker. Heuristic: keep the first column after role that does
      // NOT start with "$" (salary) or "posted:" and isn't an empty string.
      let location = '';
      for (let i = 3; i < p.length; i++) {
        const cell = (p[i] || '').trim();
        if (!cell) continue;
        if (cell.startsWith('$')) continue;            // salary
        if (cell.startsWith('posted:')) continue;     // posted-date marker
        if (cell.startsWith('note:')) continue;       // note marker
        location = cell;
        break;
      }
      return { url, company, role, location };
    });
}

// Stage 1 is deliberately deterministic and zero-cost: evaluate the strongest
// title/source matches first, while preserving the formal AI score for Stage 2.
// Stage 1 also applies the same location filter the scanner uses, so legacy
// non-US pipeline entries (from before the scan-time filter was tightened) get
// dropped before any LLM tokens are spent on them.
async function stageOneRank(items) {
  const { buildLocationFilter } = await import('./scan.mjs');
  let cfg = {};
  try { cfg = yaml.load(readFileSync(PORTALS, 'utf-8')) || {}; } catch { /* portals are optional here */ }
  const positive = (cfg.title_filter?.positive || []).map(String).map(x => x.toLowerCase());
  const negative = (cfg.title_filter?.negative || []).map(String).map(x => x.toLowerCase());
  const highIntent = ['ai engineer','applied ai engineer','ai solutions architect','ai solutions engineer','ai product engineer','llm engineer','rag engineer','machine learning engineer','data scientist','mlops engineer','llmops engineer','ai automation engineer','voice ai engineer','conversational ai engineer'];
  const directHosts = ['greenhouse.io','lever.co','ashbyhq.com','myworkdayjobs.com','bamboohr.com'];
  const locationFilter = buildLocationFilter(cfg?.location_filter);
  return items.filter(item => {
    const role = item.role.toLowerCase();
    if (negative.some(term => role.includes(term))) return false;
    if (positive.length && !positive.some(term => role.includes(term))) return false;
    // Location filter reads `item.location`; pipeline rows carry it as the
    // 4th positional column. Some legacy rows lack a location — treat empty
    // as "unknown" and let it through (the LLM eval will see the JD and
    // can still score if the JD mentions "Remote - US").
    if (item.location && !locationFilter(item.location)) return false;
    return true;
  }).map(item => {
    const role = item.role.toLowerCase();
    const exact = highIntent.reduce((n, term) => n + (role.includes(term) ? 1 : 0), 0);
    const source = directHosts.some(host => item.url.toLowerCase().includes(host)) ? 2 : 0;
    const junior = /\b(junior|associate|i)\b/.test(role) ? 1 : 0;
    return { ...item, _stageOneScore: exact * 10 + source + junior };
  }).sort((a, b) => b._stageOneScore - a._stageOneScore);
}

function markDone(url) {
  if (!existsSync(PIPELINE)) return;
  const esc = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  writeFileSync(PIPELINE, readFileSync(PIPELINE, 'utf-8').replace(new RegExp(`^(- \\[ \\] ${esc}).*$`, 'm'), l => l.replace('- [ ]', '- [x]')));
}

// Scan-time stamp in America/New_York (ET): YYYY-MM-DD_HH-MM.
// Matches the cron slot that found the job (5/8/11/2/5 PM ET runs, or the
// manual run's wall time), so tailored-resume artifacts sort into the same
// date/time folder the user sees in the automation log — not the UTC date,
// which can differ after ~7 PM ET.
function etScanStamp() {
  const supplied = process.argv.find(a => a.startsWith('--stamp='))?.split('=')[1];
  if (supplied && /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/.test(supplied)) return supplied;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}_${get('hour')}-${get('minute')}`;
}

function nextNum() {
  const d = path.join(DIR, 'reports');
  if (!existsSync(d)) return 1;
  let max = 0;
  for (const f of readdirSync(d)) {
    const m = f.match(/^(\d+)-/);
    if (m) max = Math.max(max, parseInt(m[1]));
  }
  return max + 1;
}

// Two-tier JD fetch: try cheap HTTP first; only spin up Playwright when
// the static page is empty (SPA shells like Oracle CXS / Amex / Stellantis).
// Most ATS boards (Greenhouse, Lever, Workday, BambooHR) finish in ~1 s;
// the SPA fallback stays at ~5–8 s. Net effect: ~80% of evals save ~7 s.
async function fetchJD(url) {
  const cheap = await tryFetchCheap(url);
  if (cheap && cheap.length > 250 && /[a-z]{4,}/.test(cheap)) return cheap;
  return await tryFetchPlaywright(url);
}
async function tryFetchCheap(url) {
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' },
    });
    const html = await r.text();
    const m = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i);
    if (m) {
      try {
        const j = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
        const desc = j?.description || '';
        if (typeof desc === 'string' && desc.length > 250) {
          return desc
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 6000);
        }
      } catch {}
    }
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const body = bodyMatch ? bodyMatch[1] : html;
    const text = body
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > 250 ? text.slice(0, 6000) : '';
  } catch {
    return '';
  }
}
async function tryFetchPlaywright(url) {
  try {
    const { chromium } = await import('playwright');
    const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const p = await b.newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await p.waitForTimeout(5000);
    const t = await p.evaluate(() => document.body?.innerText || '');
    await b.close();
    return (t || '').trim().slice(0, 6000);
  } catch {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const h = await r.text();
      const m = h.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000) : '(empty)';
    } catch { return '(fetch failed)'; }
  }
}

async function evalJob(item) {
  const jd = await fetchJD(item.url);
  // Dead posting check
  const deadSignals = ['no longer open', 'no longer accepting', 'interviewing other candidates', 'this position has been filled', 'job expired', 'we are not accepting applications'];
  if (deadSignals.some(s => jd.toLowerCase().includes(s))) {
    return { score: 0, summary: 'Job posting is closed/dead', legitimacy: 'confirmed', jd };
  }
  // US security clearance / citizenship requirement check (2026-08-12, hardened 2026-08-14).
  // The user does not hold US citizenship and cannot obtain Secret/Top
  // Secret/SCI clearance. Any JD that mandates these is hard-rejected
  // before the LLM evaluator runs (saves tokens + prevents a misleading
  // numeric score from reaching the email).
  const jdLower = jd.toLowerCase();
  const clearanceSignals = [
    'security clearance required', 'clearance required', 'active secret clearance',
    'active top secret', 'top secret clearance', 'ts/sci', 'ts sci',
    'sci clearance', 'polygraph', 'full scope polygraph',
    'must be a u.s. citizen', 'u.s. citizen required', 'us citizen required',
    'must be a us citizen', 'citizenship required', 'green card required',
    'permanent resident required',
    'must be eligible to obtain a security clearance',
    'eligible to obtain a security clearance', 'eligible for a security clearance',
    'ability to obtain a security clearance',
    'public trust clearance', 'public trust position', 'sensitive compartmented',
  ];
  if (clearanceSignals.some(s => jdLower.includes(s))) {
    return { score: 0, summary: 'Job requires US citizenship/security clearance (not eligible)', legitimacy: 'confirmed', jd };
  }
  // Non-AI/IRRELEVANT check (support/design/sales jobs with AI in title)
  const roleLower = (item.role || '').toLowerCase();
  const relevantKeywords = ['engineer', 'scientist', 'developer', 'architect', 'machine learning', 'llm', 'nlp', 'data', 'ai', 'research', 'applied', 'platform', 'infrastructure', 'product manager', 'technical program'];
  if (!relevantKeywords.some(k => roleLower.includes(k))) {
    return { score: 0, summary: 'Role type not relevant to target', legitimacy: 'confirmed', jd };
  }
  const prompt = [
    `You are evaluating a job listing for ${userName}. Analyze the match carefully.`,
    ``,
    `Scoring criteria:`, 
    `- 4.5-5.0: Exceptional fit — nearly all skills required, ideal company/location, strong growth`,
    `- 4.0-4.4: Strong fit — most skills match, good company, minor gaps`,
    `- 3.0-3.9: Decent fit — some skills match, but notable gaps in required experience or domain`,
    `- 2.0-2.9: Weak fit — few skills match, wrong domain, location mismatch`,
    `- 1.0-1.9: Poor fit — wrong role type, major mismatch`,
    ``,
    `Consider: (a) skill match vs JD requirements, (b) location/remote fit, (c) company quality/domain, (d) career growth, (e) visa feasibility (${userName} needs H-1B sponsorship, F-1 STEM OPT through 2027, cap-exempt eligible). Do NOT recommend roles that mandate US citizenship or require an active security clearance.`,
    `Be honest — if the role requires management experience and ${userName} is an IC, that reduces score. If it's a dead/closed posting, score 0.`,
    ``,
    `Return ONLY valid JSON (no markdown, no tool calls, no code fences). The JSON must have exactly three keys:`,
    `- "score": a number from 1.0 to 5.0 based ONLY on the scoring criteria above. NEVER output a placeholder — compute the real value from the JD and CV.`,
    `- "summary": your own original 1-2 sentence analysis of this specific JD vs this specific candidate. It MUST mention concrete evidence from the JD (required skills, location, company) and from the CV. Do NOT copy any example wording.`,
    `- "legitimacy": exactly one of "confirmed", "likely", or "unconfirmed".`,
    `Your summary must be unique to THIS job — if it could apply to any job, rewrite it.`,
    ``,
    `--- CV ---`,
    cvText.slice(0, 4000),
    `--- PROFILE ---`,
    profileText.slice(0, 2000),
    `--- JOB ---`,
    `Company: ${item.company}`,
    `Role: ${item.role}`,
    `URL: ${item.url}`,
    jd.slice(0, 5000),
  ].join('\n');

  // Parse JSON — the agent may wrap it in conversational text
  let parsed = parseEvalOut(await callCareerOpsLlm({ prompt }));
  // Echo-detection: if the model copied the example/placeholder verbatim, retry once
  if (isEcho(parsed)) {
    console.log(`  ⚠ Echo detected for ${item.company}, retrying...`);
    const retryPrompt = prompt + '\n\nWARNING: Your previous response was rejected because it echoed the prompt placeholder. Respond now with a REAL score and a REAL summary specific to this job.';
    const out2 = await callCareerOpsLlm({ prompt: retryPrompt });
    parsed = parseEvalOut(out2);
    if (isEcho(parsed)) parsed = { score: 0, summary: 'Eval failed: model echoed placeholder after retry', legitimacy: 'unconfirmed' };
  }
  if (typeof parsed.score !== 'number') parsed.score = 0;
  return { ...parsed, jd };
}

function isEcho(p) {
  if (!p || typeof p.score !== 'number') return false;
  if (String(p.summary || '').toLowerCase().includes('10-15 word justification')) return true;
  // A score of exactly 3.5 with a generic summary is suspicious — but don't over-flag;
  // the concrete echo marker is the placeholder text itself.
  return false;
}

function parseEvalOut(out) {
  try {
    const m = out.match(/\{[^]*?"score"[^]*?\}/);
    return m ? JSON.parse(m[0]) : { score: 0, summary: '(parse failed)', legitimacy: 'unconfirmed' };
  } catch {
    return { score: 0, summary: '(parse failed)', legitimacy: 'unconfirmed' };
  }
}



async function save(item, result) {
  const today = new Date().toISOString().split('T')[0];
  const num = nextNum();
  const ns = String(num).padStart(3, '0');
  const slug = item.company.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'unknown';
  // Preserve the URL the pipeline gave us. Empty URLs flow through — the
  // email renderer (run-automation.mjs applyCell) shows a "no link" badge.
  // This is critical: silently dropping URL-less rows hides the eval from
  // the user entirely.
  const urlField = (typeof item.url === 'string' && item.url.trim()) ? item.url.trim() : '';
  const report = path.join(DIR, 'reports', `${ns}-${slug}-${today}.md`);
  writeFileSync(report, [
    `**URL:** ${urlField || '(no URL captured)'}`,
    `**Legitimacy:** ${result.legitimacy}`,
    `**Score:** ${result.score.toFixed(1)}/5`,
    ``,
    `## Summary`,
    result.summary,
    ``,
    `## Job`,
    `${item.company} — ${item.role}`,
    result.jd,
  ].join('\n'));

  const tsvDir = path.join(DIR, 'batch', 'tracker-additions');
  mkdirSync(tsvDir, { recursive: true });
  // AGENTS.md contract: SINGLE data line, no header. Columns: num date company role status score pdf report notes
  writeFileSync(path.join(tsvDir, `eval-${ns}-${slug}.tsv`),
    `${num}\t${today}\t${item.company}\t${item.role}\tEvaluated\t${result.score.toFixed(1)}/5\t❌\t[${ns}](reports/${ns}-${slug}-${today}.md)\t${result.summary}\n`);

  markDone(item.url);
  // Return the report path too so the caller can auto-trigger a tailored
  // resume against the artifact we just wrote.
  return { num, score: result.score, report };
}

async function main() {
  const max = parseInt(process.argv.find(a => a.startsWith('--max='))?.split('=')[1]) || 999999;
  const items = (await stageOneRank(pipe())).slice(0, max);
  if (!items.length) { console.log('No pipeline items to evaluate.'); return; }

  let evals = 0, qual = 0;
  const CONCURRENCY = 3;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (item) => {
      const idx = i + batch.indexOf(item) + 1;
      try {
        const result = await evalJob(item);
        const { score, report } = await save(item, result);
        evals++;
        if (score >= 3.5) qual++;
        // Per-job line for run-automation.mjs to parse (Score: X.X/5 pattern)
        console.log(`Score: ${score.toFixed(1)}/5 | ${item.company} | ${item.role} | ${result.summary || ''} | ${item.url}`);

        // Auto-generate tailored resume for ANY passing eval (≥3.5).
        // Uses the new tailoring agent (cv.json + JD fetch + LaTeX), which
        // writes PDF + source card + JSON into Tailored ATS PDF/<tier>/<scan-date>/<scan-time>/.
        // PAUSE GATE (2026-08-12): user requested a one-day pause so they can
        // spot-check the latest tailoring output before the pipeline resumes.
        // Set CAREEROPS_TAILORING_PAUSED=1 to halt auto-tailoring without
        // disabling the rest of the pipeline. Flip the env var (or just remove
        // the check) to resume.
        if (score >= 3.5 && process.env.CAREEROPS_TAILORING_PAUSED !== '1') {
          const tailorScript = path.join(DIR, 'on-demand-tools', 'tailor-resume.mjs');
          if (existsSync(tailorScript)) {
            try {
              // Stamp the output with the scan time (ET), not wall-clock now,
              // so artifacts sort by the cron slot that found the job.
              const stamp = etScanStamp();
              const tailorOut = execFileSync('node', [tailorScript, report, `--stamp=${stamp}`], {
                timeout: 180000, stdio: 'pipe', encoding: 'utf-8'
              });
              const pdfMatch = tailorOut.match(/✓ PDF: ([^\n]+)/);
              if (pdfMatch) {
                console.log(`  ✅ Tailored PDF: ${pdfMatch[1]}`);
              } else {
                console.log(`  ✅ Tailored resume generated (see output). Tailor cmd exit 0.`);
              }
            } catch (pdfErr) {
              console.log(`  ⚠ Tailored resume skipped: ${pdfErr.message}`);
            }
          }
        }
      } catch (e) {
        console.log(`  FAILED ${item.company}: ${e.message}`);
      }
    }));
    console.log(`  Batch ${Math.floor(i/CONCURRENCY)+1}/${Math.ceil(items.length/CONCURRENCY)}: ${Math.min(i+CONCURRENCY, items.length)}/${items.length} done, ${qual} qualifying so far`);
  }
  console.log(`\nDone. ${evals} evaluated, ${qual} qualifying (>=3.5)`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
