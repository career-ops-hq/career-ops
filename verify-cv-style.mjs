#!/usr/bin/env node

/**
 * verify-cv-style.mjs — Style + precision gate for generated CVs.
 *
 * Enforces the house rules a peer review exposed as unenforceable prose in
 * modes/_custom.md. Those rules were written down but nothing checked them, so
 * every regression came back silently: a 60-word summary returned, a "Core
 * themes from recent target roles" keyword tail reappeared, a lane lost its
 * GxP skills line, contact details went back to being plain text, and a
 * "GxP-compliant" claim crept into a bullet that should have said the CLIENT
 * was GxP-regulated. Rules that nothing checks are suggestions.
 *
 * Read-only. Never edits, never generates, never fails a build into existence.
 *
 * Usage:
 *   node verify-cv-style.mjs                      # every lane in output/master cv/ + cv.md
 *   node verify-cv-style.mjs <file>               # one .json / .md / .html / .pdf
 *   node verify-cv-style.mjs --summary            # human-readable table
 *   node verify-cv-style.mjs --json               # machine-readable
 *   node verify-cv-style.mjs --strict             # warnings become failures
 *   node verify-cv-style.mjs --self-test
 *
 * Exit codes: 0 clean · 1 findings (or any finding under --strict) · 2 usage/IO error
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'node:child_process';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const DATA_ROOT = getCareerOpsRoot();
const MASTER_DIR = join(DATA_ROOT, 'output', 'master cv');

// ── Rules ────────────────────────────────────────────────────────────────────

/**
 * Summary budget. modes/_custom.md "Summary — 30–55 words, one anchor metric".
 * The band is a floor AND a ceiling: an upper limit alone is what produced the
 * 7–12 word label that read as a bare-bones positioning line instead of a
 * summary, so both ends are enforced. modes/pdf.md asks the per-application
 * path for a 3–4 line profile; this is the master-path equivalent, and the two
 * must not drift.
 */
const SUMMARY_MIN_WORDS = 30;
const SUMMARY_MAX_WORDS = 55;

/**
 * Tenure claims, per modes/_custom.md. The documented work history totals
 * ~6.33 years of professional experience, so "6+ years" is supportable and
 * "7+ years" is not. A summary that overstates tenure is the easiest claim on
 * the page to catch in a reference check, and it discredits the claims
 * underneath it.
 */
const TENURE_MAX_YEARS = 6.33;
const TENURE_CLAIM_RE = /\b(\d+(?:\.\d+)?)\s*\+?\s*years?\b/gi;

/**
 * Personal-disclosure terms that must never reach a page. The Oct 2024 --
 * Oct 2025 break was family caregiving plus a home project; it is interview
 * material only (modes/_profile.md timeline item 2).
 *
 * The exclusions are load-bearing, not decoration. The candidate's own CV
 * already contains `career.shivanand@gmail.com` and describes InstaCure as a
 * "Health-tech startup", so a naive /care|health/ scan fires on legitimate
 * content and would have forced a bad edit. Match personal CONTEXT only.
 */
const PERSONAL_DISCLOSURE = [
  { re: /\b(?:mother|mum|mom|parents?)\b(?=[^.\n]{0,40}\b(?:health|ill|hospital|care|condition))/i, why: 'family health disclosure' },
  { re: /\bfamily health\b/i, why: 'family health disclosure' },
  { re: /\bbereav/i, why: 'bereavement disclosure' },
  { re: /\billness\b/i, why: 'illness disclosure' },
  { re: /\bmedical (?:leave|condition|reason)\b/i, why: 'medical disclosure' },
  { re: /\bcaregiv/i, why: 'caregiving disclosure' },
  { re: /\bgrief\b/i, why: 'grief disclosure' },
  { re: /\bhospit(?:al|is|ised|ized)\b/i, why: 'hospitalisation disclosure' },
  { re: /\bdiagnos(?:is|ed|tic)\b/i, why: 'diagnosis disclosure' },
  { re: /\b(?:death|passing) of\b/i, why: 'bereavement disclosure' },
];

/**
 * Quantified claims in a summary, split into two tiers.
 *
 * OUTCOME = an impact or result figure (%, currency, count of things
 * delivered). Limit 1. This is the "25% / 18% / $500K" pile the house rule
 * bans — a run of outcome numbers reads as keyword pressure and buries the
 * positioning claim.
 *
 * SCOPE = a responsibility/scale qualifier (team size, endpoints, sites).
 * These do something different — they establish the scale of ownership — so
 * they are counted separately and only capped, to stop a summary decaying into
 * a number dump.
 *
 * Tenure figures are stripped first and never counted as anchors: every
 * summary legitimately carries one or two of them.
 */
const OUTCOME_ANCHOR_RE = /(?:\d+(?:\.\d+)?\s*%)|(?:[$₹€£]\s?\d[\d.,]*\s?[KMB]?\b)|(?:\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\b(?=[^.\n]{0,30}\b(?:product|build|ship|deliver|client|site|tool|app|platform|venture)s?\b))/gi;
const SCOPE_FIGURE_RE = /\b\d+\+?\b(?=[^.\n]{0,24}\b(?:endpoints?|trucks?|persons?|people|teams?|staff|clients?|users?|sites?|devices?|nodes?)\b)/gi;
const MAX_OUTCOME_ANCHORS = 1;
const MAX_TOTAL_QUANTIFIED = 3;


/**
 * Claims the CV must never make. Two of these are the precise failure a
 * regulated-industry interviewer probes: "GxP-compliant" and "validated" imply
 * he performed validation, which the client's QA function held. "A/B testing"
 * implies an experiment that is not recorded in any primary file. "seed of
 * SigmaX" is chronologically impossible — ClearState shipped Feb 2026, three
 * months AFTER the Nov 2025 founding.
 */
const FORBIDDEN = [
  { re: /GxP[- ]compliant/i, why: "implies he made the system compliant; the CLIENT was GxP-regulated" },
  { re: /ensured (GxP )?compliance/i, why: 'same claim as GxP-compliant' },
  { re: /\bvalidated (the )?(NMT|Network Modelling)/i, why: "validation was the client's QA function, not his" },
  { re: /owned validation/i, why: 'validation was the client QA function' },
  { re: /\bA\/B (test|testing|experiment)/i, why: 'no A/B test is recorded in a primary file; outcome measurement is the supported claim' },
  { re: /\bExperimentation\b/i, why: 'same as the A/B rule — measure outcomes, do not claim experiments' },
  { re: /seed of SigmaX/i, why: 'ClearState shipped Feb 2026, three months after the Nov 2025 founding' },
  { re: /Core themes from recent target roles/i, why: 'a self-advertising keyword tail; see the summary rule' },
  { re: /became the seed/i, why: 'same chronological error as "seed of SigmaX"' },
  { re: /post-?certification/i, why: 'implies the certification preceded and seeded the build — the company was founded Nov 2025, before the Jan 2026 cert' },
  { re: /\bafter the IBM\b|\bfollowing the IBM\b/i, why: 'same chronological implication as post-certification' },
];

/** Goodtime economics. Never characterised in either direction; capital reason is unprompted-only. */
const GOODTIME_ECONOMICS = [
  /profitable/i, /unprofitable/i, /\bmade a loss\b/i, /\bbreak-?even\b/i,
  /capital[- ]intensive/i, /\braise[ds]?\b/i, /\bfundrais/i, /ran out of (money|cash|funds)/i,
];

/** Canonical dates. Every one of these must agree across every file. */
const CANONICAL_DATES = {
  sigmax: 'Nov 2025 -- Present',
  goodtime: 'May 2025 -- Oct 2025',
};
const STALE_DATES = [
  { re: /Feb 2026\s*(?:--|–|—|-)\s*Present/i, why: `SigmaX starts Nov 2025, not Feb 2026 (canonical: ${CANONICAL_DATES.sigmax})` },
  { re: /May 2025\s*(?:--|–|—|-)\s*Nov 2025/i, why: `Goodtime ends Oct 2025 (canonical: ${CANONICAL_DATES.goodtime})` },
];

/** The PM spine target JDs and ATS screens look for. L1 must carry all of it. */
const PM_SPINE = [
  /product discovery|user research/i,
  /requirements|prds?|user stories/i,
  /roadmap/i,
  /prioritis|prioritiz/i,
  /agile|scrum/i,
  /stakeholder/i,
  /outcome measurement|product analytics|kpi/i,
  /lifecycle/i,
  /gxp|regulated/i,
];

/** Lanes whose competencies are expected to read as a PM job description. */
const PM_LANES = new Set(['ai-product-manager']);

/** The moat a headline must name somewhere: regulated-industry delivery. */
const MOAT_RE = /gxp|regulat|lifecycle|validation/i;

/** Tools that were deliberately demoted into Skills, never a headline slot. */
const DEMOTED_TOOL_RE = [
  { re: /genai evaluation/i, source: '"GenAI evaluation"' },
  { re: /human-in-the-loop/i, source: '"human-in-the-loop workflows"' },
  { re: /\bllm evaluation\b/i, source: '"LLM evaluation"' },
];

/** Tool names that must not appear in a PM competencies block. */
const TOOL_IN_COMPETENCY = /\b(n8n|prompt engineering|node\/express|openrouter|vercel|supabase|rag|mcp)\b/i;

/** Every lane must carry a GxP/regulated skills line — it is the whole moat. */
const REGULATED_SKILL = /gxp|regulat|validation|data integrity|risk management/i;

// ── Finding helpers ──────────────────────────────────────────────────────────

function finding(code, severity, target, detail) {
  return { code, severity, target, detail };
}

function wordCount(s) {
  return String(s ?? '').trim().split(/\s+/).filter(Boolean).length;
}

function scanForbidden(text, target, out) {
  for (const { re, why } of FORBIDDEN) {
    const lines = String(text).split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) out.push(finding('forbidden-claim', 'fail', target, `${lines[i].trim().slice(0, 110)} — ${why} (line ${i + 1})`));
    }
  }
}

function scanStaleDates(text, target, out) {
  for (const { re, why } of STALE_DATES) {
    const m = re.exec(text);
    if (m) out.push(finding('date-drift', 'fail', target, `"${m[0]}" — ${why}`));
  }
}

// ── PDF link annotations ─────────────────────────────────────────────────────

/**
 * Count /URI annotations in a PDF. A shipped CV whose contact line is plain
 * text makes the reader retype every address, which is exactly what a peer
 * review flagged. Uses pypdf via python3 because parsing PDF xref tables by
 * hand is not worth the maintenance. Degrades to 'skip', never to a false pass.
 */
function pdfUriCount(pdfPath) {
  const py = [
    'import sys',
    'try:',
    '    from pypdf import PdfReader',
    'except Exception:',
    '    print("SKIP"); sys.exit(0)',
    'try:',
    '    r = PdfReader(sys.argv[1])',
    '    n = 0',
    '    for pg in r.pages:',
    '        for a in (pg.get("/Annots") or []):',
    '            o = a.get_object()',
    '            if o.get("/Subtype") == "/Link" and (o.get("/A") or {}).get("/URI"):',
    '                n += 1',
    '    print(n)',
    'except Exception as e:',
    '    print("SKIP")',
  ].join('\n');
  const res = spawnSync('python3', ['-c', py, pdfPath], { encoding: 'utf-8' });
  const out = (res.stdout || '').trim();
  if (!/^\d+$/.test(out)) return null; // skip: pypdf missing or unreadable
  return Number(out);
}

// ── JSON payload checks ──────────────────────────────────────────────────────

/**
 * The four summary rules, in one place so the JSON payload path and the
 * markdown text path cannot drift apart (they did once, when the .md path
 * kept the old 20-word ceiling while the JSON path moved).
 *
 *  1. length band, both ends
 *  2. one outcome anchor, capped total quantification (tenure excluded)
 *  3. tenure defensible against the documented timeline
 *  4. no personal disclosure
 */
function scanSummary(summary, target, out) {
  const text = String(summary || '').trim();
  if (!text) return out;

  const wc = wordCount(text);
  if (wc < SUMMARY_MIN_WORDS) {
    out.push(finding('summary-too-thin', 'fail', target, `${wc} words, floor ${SUMMARY_MIN_WORDS}. Under this length the summary is a positioning label, not a profile — the reader gets no scope, evidence or through-line. modes/_custom.md "Summary — 30–55 words".`));
  }
  if (wc > SUMMARY_MAX_WORDS) {
    out.push(finding('summary-too-long', 'fail', target, `${wc} words, ceiling ${SUMMARY_MAX_WORDS}. modes/_custom.md "Summary — 30–55 words".`));
  }

  const withoutTenure = text.replace(TENURE_CLAIM_RE, ' ');
  const outcome = (withoutTenure.match(OUTCOME_ANCHOR_RE) || []).length;
  const scope = (withoutTenure.match(SCOPE_FIGURE_RE) || []).length;
  const total = outcome + scope;
  if (outcome > MAX_OUTCOME_ANCHORS) {
    out.push(finding('summary-metric-stack', 'fail', target, `${outcome} outcome metrics (limit ${MAX_OUTCOME_ANCHORS}): a run of result figures reads as keyword pressure and buries the positioning claim. Keep one; the bullets own the rest.`));
  }
  if (total > MAX_TOTAL_QUANTIFIED) {
    out.push(finding('summary-number-dump', 'warn', target, `${total} quantified claims (${outcome} outcome, ${scope} scope; cap ${MAX_TOTAL_QUANTIFIED}). Passable, but the summary is drifting toward a number dump — consider pushing a scope figure down to the bullets.`));
  }

  for (const m of text.matchAll(TENURE_CLAIM_RE)) {
    const years = parseFloat(m[1]);
    if (Number.isFinite(years) && years > TENURE_MAX_YEARS) {
      out.push(finding('tenure-overstated', 'fail', target, `summary claims "${m[0].trim()}" but the documented work history totals ~${TENURE_MAX_YEARS} years. "6+ years" is supportable, "7+ years" is not — an overstated tenure is the first claim a reference check will catch.`));
    }
  }

  const lines = text.split('\n');
  for (const { re, why } of PERSONAL_DISCLOSURE) {
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        out.push(finding('personal-disclosure', 'fail', target, `${why} in summary: "${lines[i].trim().slice(0, 100)}" — interview material only (modes/_custom.md "Off-Limits").`));
      }
    }
  }

  return out;
}

function checkJsonPayload(payload, target) {
  const out = [];
  const exp = Array.isArray(payload.experience) ? payload.experience : [];
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  const lane = (payload.__lane) || target;

  // 1. Summary: band, anchor count, tenure, disclosure. Shared with
  // checkTextFile so the .json and .md paths can never enforce different bars.
  scanSummary(payload.summary || '', target, out);

  scanForbidden(payload.summary || '', `${target} (summary)`, out);
  scanForbidden((payload.competencies || []).join('\n'), `${target} (competencies)`, out);

  // 1b. Headline leads with the moat, and never advertises a demoted tool.
  // The headline sits directly above the summary and directly above the
  // competency spine, so when it disagrees with them the page contradicts
  // itself: "GenAI evaluation | human-in-the-loop" sat above a summary about
  // GxP delivery and a spine that had just demoted both to Skills.
  if (payload.headline) {
    if (!MOAT_RE.test(payload.headline)) {
      out.push(finding('headline-misses-moat', 'fail', target, `headline "${payload.headline}" names no moat — it must mention regulated/GxP delivery somewhere. A headline that led with a bare credential or a demoted tool contradicted the summary and the competency spine directly beneath it.`));
    }
    for (const tool of DEMOTED_TOOL_RE) {
      if (tool.re.test(payload.headline)) {
        out.push(finding('headline-advertises-tool', 'fail', target, `headline advertises ${tool.source} — that is a tool and lives in Skills; the headline contradicted the competency spine beneath it`));
      }
    }
  }

  // 2. PM spine in PM lanes
  if (PM_LANES.has(lane)) {
    const comps = (payload.competencies || []).join(' | ');
    const missing = PM_SPINE.filter((re) => !re.test(comps)).map((re) => re.source);
    if (missing.length) {
      out.push(finding('pm-spine-incomplete', 'fail', target, `competencies missing: ${missing.join(', ')}`));
    }
  }

  // 3. Tool names must not sit in a PM competencies block
  for (const c of payload.competencies || []) {
    if (TOOL_IN_COMPETENCY.test(c)) {
      out.push(finding('tool-in-competency', 'warn', target, `"${c}" — tool names belong in Skills, not competencies`));
    }
  }

  // 4. NMT present in every lane, and never trimmed
  const deloitte = exp.find((e) => /deloitte/i.test(e.company || ''));
  if (deloitte) {
    const bullets = (deloitte.bullets || []).join('\n');
    if (!/network modelling|NMT/i.test(bullets)) {
      out.push(finding('nmt-missing', 'fail', target, 'no NMT bullet in the Deloitte block — it is a never-trim item in every lane'));
    }
  }

  // 5. GxP/regulated skills line
  const skillText = (payload.skills || []).flatMap((s) => [s.category || '', ...(s.items || [])]).join(' | ');
  if (skillText && !REGULATED_SKILL.test(skillText)) {
    out.push(finding('no-regulated-skill', 'fail', target, 'no GxP/regulated line in the skills block — the moat is missing from this lane'));
  }

  // 6. Goodtime economics language
  const goodtime = exp.find((e) => /goodtime/i.test(e.company || ''));
  if (goodtime) {
    const bullets = (goodtime.bullets || []).join('\n');
    for (const re of GOODTIME_ECONOMICS) {
      const m = re.exec(bullets);
      if (m) {
        out.push(finding('goodtime-economics', 'fail', target, `"${m[0]}" — never characterise Goodtime financially; the capital reason is unprompted-only`));
      }
    }
    if (/\bPresent\b|\bCurrent(ly)?\b/i.test(goodtime.dates || '')) {
      out.push(finding('goodtime-not-dormant', 'fail', target, `dates read "${goodtime.dates}" — Goodtime ended Oct 2025 and is dormant`));
    }
  }

  // 7. Dates
  const sigmax = exp.find((e) => /sigmax/i.test(e.company || ''));
  if (sigmax && sigmax.dates && sigmax.dates !== CANONICAL_DATES.sigmax) {
    out.push(finding('date-drift', 'fail', target, `SigmaX dates "${sigmax.dates}" ≠ canonical "${CANONICAL_DATES.sigmax}"`));
  }
  if (goodtime && goodtime.dates && goodtime.dates !== CANONICAL_DATES.goodtime) {
    out.push(finding('date-drift', 'fail', target, `Goodtime dates "${goodtime.dates}" ≠ canonical "${CANONICAL_DATES.goodtime}"`));
  }

  scanForbidden(projects.map((p) => p.description || '').join('\n'), `${target} (projects)`, out);

  return out;
}

// ── Text checks (md / html) ──────────────────────────────────────────────────

function checkTextFile(text, target) {
  const out = [];
  const m = text.match(/##\s*Professional Summary\s*\n+([^\n]+)/);
  if (m) scanSummary(m[1], target, out);
  scanForbidden(text, target, out);
  scanStaleDates(text, target, out);
  return out;
}

function checkPdf(path, target) {
  const out = [];
  const n = pdfUriCount(path);
  if (n === null) {
    out.push(finding('link-check-skipped', 'warn', target, 'could not read /URI annotations (pypdf unavailable)'));
  } else if (n === 0) {
    out.push(finding('no-clickable-link', 'fail', target, '0 /URI annotations — contact details are plain text, so a reader must retype them'));
  }
  return out;
}

// ── Collection ───────────────────────────────────────────────────────────────

function collectTargets(explicit) {
  if (explicit) return [explicit];
  const targets = [];
  const cvMd = join(DATA_ROOT, 'cv.md');
  if (existsSync(cvMd)) targets.push(cvMd);
  if (!existsSync(MASTER_DIR)) return targets;
  for (const lane of readdirSync(MASTER_DIR)) {
    const dir = join(MASTER_DIR, lane);
    for (const f of ['cv.json', 'cv.md', 'cv.pdf']) {
      const p = join(dir, f);
      if (existsSync(p)) targets.push(p);
    }
  }
  return targets;
}

export function checkFile(path) {
  const lower = path.toLowerCase();
  const target = path.replace(`${DATA_ROOT}/`, '');
  try {
    if (lower.endsWith('.json')) {
      const payload = JSON.parse(readFileSync(path, 'utf-8'));
      const lane = path.split('/').slice(-2, -1)[0];
      return checkJsonPayload({ ...payload, __lane: lane }, target);
    }
    if (lower.endsWith('.pdf')) return checkPdf(path, target);
    return checkTextFile(readFileSync(path, 'utf-8'), target);
  } catch (err) {
    return [finding('io-error', 'fail', target, err.message)];
  }
}

export function verify(targets) {
  const findings = [];
  for (const t of targets) findings.push(...checkFile(t));
  return {
    verdict: findings.some((f) => f.severity === 'fail') ? 'block' : findings.length ? 'warn' : 'ok',
    targets: targets.map((t) => t.replace(`${DATA_ROOT}/`, '')),
    findings,
  };
}

// ── Output ───────────────────────────────────────────────────────────────────

const SEV = { fail: 'FAIL', warn: 'WARN' };

function printSummary(result) {
  console.log('CV Style Check');
  console.log('─'.repeat(60));
  console.log(`Targets: ${result.targets.length}   Verdict: ${result.verdict.toUpperCase()}`);
  console.log('');
  if (!result.findings.length) {
    console.log('  ✅ all style + precision rules pass');
    return;
  }
  const grouped = new Map();
  for (const f of result.findings) {
    if (!grouped.has(f.code)) grouped.set(f.code, []);
    grouped.get(f.code).push(f);
  }
  for (const [code, items] of grouped) {
    console.log(`  ${items.some((i) => i.severity === 'fail') ? '❌' : '⚠️ '} ${code} (${items.length})`);
    for (const i of items.slice(0, 12)) console.log(`       ${i.target} — ${i.detail}`);
    if (items.length > 12) console.log(`       … ${items.length - 12} more`);
  }
}

// ── Self-test ────────────────────────────────────────────────────────────────

function runSelfTest() {
  const cases = [
    ['summary over the ceiling is caught', checkJsonPayload({ summary: 'word '.repeat(60), experience: [] }, 't').some((f) => f.code === 'summary-too-long'), true],
    ['summary under the floor is caught', checkJsonPayload({ summary: 'AI product manager with hands-on LLM agents.', experience: [] }, 't').some((f) => f.code === 'summary-too-thin'), true],
    ['in-band summary passes the band', checkJsonPayload({ summary: 'word '.repeat(40), experience: [] }, 't').some((f) => f.code.startsWith('summary-too-')), false],
    ['GxP-compliant is caught', checkJsonPayload({ summary: 'Built a GxP-compliant system', experience: [] }, 't').some((f) => f.code === 'forbidden-claim'), true],
    ['GxP-regulated client is allowed', checkJsonPayload({ summary: 'A system a GxP-regulated client depended on', experience: [] }, 't').some((f) => f.code === 'forbidden-claim'), false],
    ['A/B testing is caught', checkJsonPayload({ summary: 'Ran A/B testing', experience: [] }, 't').some((f) => f.code === 'forbidden-claim'), true],
    ['Outcome Measurement is allowed', checkJsonPayload({ summary: 'Product Analytics, KPIs & Outcome Measurement', experience: [] }, 't').some((f) => f.code === 'forbidden-claim'), false],
    ['missing NMT is caught', checkJsonPayload({ experience: [{ company: 'Deloitte USI', bullets: ['unrelated'] }] }, 't').some((f) => f.code === 'nmt-missing'), true],
    ['present NMT passes', checkJsonPayload({ experience: [{ company: 'Deloitte USI', bullets: ['Network Modelling Tool migration'] }] }, 't').some((f) => f.code === 'nmt-missing'), false],
    ['missing GxP skill is caught', checkJsonPayload({ skills: [{ category: 'AI', items: ['n8n'] }] }, 't').some((f) => f.code === 'no-regulated-skill'), true],
    ['present GxP skill passes', checkJsonPayload({ skills: [{ category: 'Regulated', items: ['GxP'] }] }, 't').some((f) => f.code === 'no-regulated-skill'), false],
    ['Goodtime capital language is caught', checkJsonPayload({ experience: [{ company: 'The Goodtime Co.', dates: 'May 2025 -- Oct 2025', bullets: ['capital-intensive, could not raise'] }] }, 't').some((f) => f.code === 'goodtime-economics'), true],
    ['Goodtime Present is caught', checkJsonPayload({ experience: [{ company: 'The Goodtime Co.', dates: 'May 2025 -- Present', bullets: ['ran it'] }] }, 't').some((f) => f.code === 'goodtime-not-dormant'), true],
    ['SigmaX Feb 2026 is caught', checkJsonPayload({ experience: [{ company: 'SigmaX Labs', dates: 'Feb 2026 -- Present', bullets: [] }] }, 't').some((f) => f.code === 'date-drift'), true],
    ['SigmaX Nov 2025 passes', checkJsonPayload({ experience: [{ company: 'SigmaX Labs', dates: 'Nov 2025 -- Present', bullets: [] }] }, 't').some((f) => f.code === 'date-drift'), false],
    ['PM spine incomplete is caught', checkJsonPayload({ __lane: 'ai-product-manager', competencies: ['Product Discovery'], experience: [] }, 't').some((f) => f.code === 'pm-spine-incomplete'), true],
    ['PM spine complete passes', checkJsonPayload({ __lane: 'ai-product-manager', competencies: ['Product Discovery & User Research', 'Requirements, PRDs & User Stories', 'Product Roadmapping & Prioritisation', 'Agile/Scrum & Cross-functional Delivery', 'Stakeholder Management & Alignment', 'Product Analytics, KPIs & Outcome Measurement', 'Product Lifecycle Ownership', 'GxP-regulated Product Delivery'], experience: [] }, 't').some((f) => f.code === 'pm-spine-incomplete'), false],
    ['tool in competency warns', checkJsonPayload({ __lane: 'ai-product-manager', competencies: ['n8n Workflow Automation'], experience: [] }, 't').some((f) => f.code === 'tool-in-competency'), true],
    ['stale date in text is caught', checkTextFile('SigmaX Labs\nFeb 2026 -- Present\n', 't').some((f) => f.code === 'date-drift'), true],
    ['keyword tail is caught', checkTextFile('x Core themes from recent target roles: a, b.', 't').some((f) => f.code === 'forbidden-claim'), true],
    ['post-certification is caught', checkJsonPayload({ projects: [{ description: 'shipped in ~1 month post-certification' }] }, 't').some((f) => f.code === 'forbidden-claim'), true],
    ['first-shipped-build wording is allowed', checkJsonPayload({ projects: [{ description: 'the first shipped build under SigmaX Labs (Feb 2026)' }] }, 't').some((f) => f.code === 'forbidden-claim'), false],
    ['headline naming the moat passes', checkJsonPayload({ headline: 'AI Product Manager | GxP-regulated delivery | hands-on LLM agents' }, 't').some((f) => f.code.startsWith('headline-')), false],
    ['headline leading with a demoted tool is caught', checkJsonPayload({ headline: 'AI Product Manager | GenAI evaluation | human-in-the-loop workflows' }, 't').some((f) => f.code === 'headline-advertises-tool'), true],
    ['headline leading with a bare credential is caught', checkJsonPayload({ headline: 'Strategy consultant | MBA (IIM Rohtak) | Deloitte USI delivery' }, 't').some((f) => f.code === 'headline-misses-moat'), true],
    ['old founder headline is caught', checkJsonPayload({ headline: 'Founder & AI-ops operator | two shipped ventures | Deloitte USI alum' }, 't').some((f) => f.code === 'headline-misses-moat'), true],
    ['founder headline carrying the moat passes', checkJsonPayload({ headline: 'Founder, AI-ops consultancy | two ventures | GxP delivery background' }, 't').some((f) => f.code.startsWith('headline-')), false],

    // ── Summary rules added with the 30–55 word band ────────────────────────
    // The L1 draft, verbatim. It is the reference case that must stay clean:
    // 53 words, one outcome anchor, two tenure figures, no disclosure.
    ['reference L1 draft produces no summary finding', checkJsonPayload({ summary: "AI product manager with 6+ years across product and solutions delivery, including 2+ years building for GxP-regulated and life-sciences clients at Deloitte USI. Runs discovery, PRDs, roadmaps and release cadence, and builds the automation directly - including an LLM-agent prototype that replaced manual spreadsheet handoffs. Cut a bilingual donor platform's release cycles by 25%.", experience: [] }, 't').some((f) => f.code.startsWith('summary-') || f.code === 'tenure-overstated' || f.code === 'personal-disclosure'), false],
    ['two outcome metrics are caught', checkJsonPayload({ summary: 'Consultant who cut release cycles 25% and scoped a $500K savings MVP for clinical and regulatory stakeholders across many engagements over years.', experience: [] }, 't').some((f) => f.code === 'summary-metric-stack'), true],
    ['one outcome anchor passes', checkJsonPayload({ summary: 'Consultant who cut a bilingual donor platform release cycles by 25% while building regulated-industry delivery experience across client engagements.', experience: [] }, 't').some((f) => f.code === 'summary-metric-stack'), false],
    ['7+ years tenure is caught', checkJsonPayload({ summary: 'Consultant with 7+ years of delivery experience across regulated industries, building automation for clients and owning end-to-end engagements.', experience: [] }, 't').some((f) => f.code === 'tenure-overstated'), true],
    ['6+ years tenure passes', checkJsonPayload({ summary: 'Consultant with 6+ years of delivery experience across regulated industries, building automation for clients and owning end-to-end engagements.', experience: [] }, 't').some((f) => f.code === 'tenure-overstated'), false],

    // ── Personal disclosure: the negatives are the load-bearing half ─────────
    // A naive /care|health/ scan fires on the candidate's OWN CV content, so
    // these three must stay clean or the rule is worse than no rule.
    ["a parent's failing health is caught", checkJsonPayload({ summary: "My mother's health failed and I was the one handling that, and I also took charge of designing and supervising a home project end to end.", experience: [] }, 't').some((f) => f.code === 'personal-disclosure'), true],
    ['caregiving language is caught', checkJsonPayload({ summary: 'Spent the period in caregiving for a family member, then returned to full-time delivery work across regulated industries.', experience: [] }, 't').some((f) => f.code === 'personal-disclosure'), true],
    ['Health-tech industry descriptor is allowed', checkJsonPayload({ summary: 'Health-tech startup regional sales operations, 30% vendor base growth; then regulated-industry delivery for life-sciences clients across many engagements.', experience: [] }, 't').some((f) => f.code === 'personal-disclosure'), false],
    ['career email address is allowed', checkJsonPayload({ summary: 'Contact career.shivanand@gmail.com; consultant with 6+ years across delivery and founding, building regulated-industry automation for clients.', experience: [] }, 't').some((f) => f.code === 'personal-disclosure'), false],
    ['the markdown path enforces the same band', checkTextFile('## Professional Summary\n\nAI product manager with hands-on LLM agents.\n', 't').some((f) => f.code === 'summary-too-thin'), true],
  ];
  let failed = 0;
  for (const [name, got, want] of cases) {
    const ok = got === want;
    if (!ok) failed++;
    console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  }
  console.log(`\n${cases.length - failed}/${cases.length} self-tests pass`);
  return failed ? 1 : 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function usage() {
  return [
    'Usage: node verify-cv-style.mjs [<file>] [options]',
    '',
    '  <file>            one .json / .md / .html / .pdf to check',
    '  (no file)         every lane in output/master cv/ plus cv.md',
    '  --summary         human-readable table (default)',
    '  --json            machine-readable',
    '  --strict          treat warnings as failures',
    '  --self-test       run the rule self-tests',
    '  -h, --help        this message',
  ].join('\n');
}

export function runCli(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--self-test') return runSelfTest();
  if (args.includes('-h') || args.includes('--help')) { console.log(usage()); return 0; }

  const json = args.includes('--json');
  const strict = args.includes('--strict');
  const positional = args.filter((a) => !a.startsWith('--'));
  if (positional.length > 1) { console.error(`ERROR: expected at most one file, got ${positional.length}\n\n${usage()}`); return 2; }
  if (positional.length === 1 && !existsSync(positional[0])) { console.error(`ERROR: file not found: ${positional[0]}`); return 2; }

  const targets = collectTargets(positional[0] || null);
  if (!targets.length) { console.error(`ERROR: nothing to check — no cv.md and no ${MASTER_DIR}`); return 2; }

  const result = verify(targets);
  if (json) { console.log(JSON.stringify(result, null, 2)); }
  else { printSummary(result); }

  if (result.verdict === 'block') return 1;
  if (strict && result.findings.length) return 1;
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runCli();
}
