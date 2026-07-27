#!/usr/bin/env node
/**
 * analyze-patterns.mjs — Rejection Pattern Detector for career-ops
 *
 * Parses applications.md + all linked reports, extracts dimensions
 * (archetype, seniority, remote, gaps, scores), classifies outcomes,
 * and outputs structured JSON with actionable patterns.
 *
 * Run: node analyze-patterns.mjs          (JSON to stdout)
 *      node analyze-patterns.mjs --summary (human-readable table)
 *      node analyze-patterns.mjs --min-threshold 3
 *      node analyze-patterns.mjs --min-vendor-n 8   (per-vendor sample floor)
 *      node analyze-patterns.mjs --self-test
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import { load as yamlLoad } from 'js-yaml';
import { resolveColumns, parseTrackerRow, normalizeVia } from './tracker-parse.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const APPS_FILE = existsSync(join(CAREER_OPS, 'data/applications.md'))
  ? join(CAREER_OPS, 'data/applications.md')
  : join(CAREER_OPS, 'applications.md');
const REPORTS_DIR = join(CAREER_OPS, 'reports');

const MACHINE_SUMMARY_FIELDS = new Set([
  'company',
  'role',
  'score',
  'legitimacy_tier',
  'archetype',
  'final_decision',
  'hard_stops',
  'soft_gaps',
  'top_strengths',
  'risk_level',
  'confidence',
  'next_action',
  // Optional context fields accepted for future reports.
  'domain',
  'seniority',
  'remote',
  'team_size',
  // Issue 1380: predicted skip/discard reasons from the agent.
  'discard_reasons',
  'advertised_comp',
  'via',
  'company_confidential',
  'risk_summary',
]);

// --- CLI args ---
const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const minThresholdIdx = args.indexOf('--min-threshold');
const MIN_THRESHOLD = minThresholdIdx !== -1 && args[minThresholdIdx + 1] !== undefined
  ? (Number.isNaN(parseInt(args[minThresholdIdx + 1])) ? 5 : parseInt(args[minThresholdIdx + 1]))
  : 5;

// Minimum per-vendor sample before a channel-yield recommendation fires. Kept
// modest (small trackers) but high enough that one unlucky bucket isn't a claim.
const minVendorNIdx = args.indexOf('--min-vendor-n');
const MIN_VENDOR_N = (() => {
  if (minVendorNIdx === -1 || args[minVendorNIdx + 1] === undefined) return 8;
  const n = parseInt(args[minVendorNIdx + 1], 10);
  // Reject 0/negative: a floor of 0 makes sufficientSample always true and
  // silently defeats the "don't claim on noise" guard the whole feature rests on.
  return Number.isNaN(n) || n < 1 ? 8 : n;
})();

// --- Status normalization (mirrors verify-pipeline.mjs) ---
const ALIASES = {
  'evaluada': 'evaluated', 'condicional': 'evaluated', 'hold': 'evaluated',
  'evaluar': 'evaluated', 'verificar': 'evaluated',
  'aplicado': 'applied', 'enviada': 'applied', 'aplicada': 'applied',
  'applied': 'applied', 'sent': 'applied',
  'respondido': 'responded',
  'entrevista': 'interview',
  'oferta': 'offer',
  'rechazado': 'rejected', 'rechazada': 'rejected',
  'descartado': 'discarded', 'descartada': 'discarded',
  'cerrada': 'discarded', 'cancelada': 'discarded',
  'no aplicar': 'skip', 'no_aplicar': 'skip', 'monitor': 'skip', 'geo blocker': 'skip',
};

function normalizeStatus(raw) {
  const clean = raw.replace(/\*\*/g, '').trim().toLowerCase()
    .replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
  return ALIASES[clean] || clean;
}

function classifyOutcome(status) {
  const s = normalizeStatus(status);
  if (['interview', 'offer', 'responded', 'applied'].includes(s)) return 'positive';
  if (['rejected', 'discarded'].includes(s)) return 'negative';
  if (['skip'].includes(s)) return 'self_filtered';
  return 'pending'; // evaluated
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'object') return [];
  return [String(value).trim()].filter(Boolean);
}

function normalizeScalar(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function parseMachineSummary(content) {
  const fenceMatch = content.match(/##\s*Machine Summary\s*\n+```(?:yaml|yml|json)?\s*\n([\s\S]*?)\n```/i);
  if (!fenceMatch) return null;

  const raw = fenceMatch[1].trim();
  if (!raw) return null;

  try {
    const parsed = yamlLoad(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return Object.fromEntries(
      Object.entries(parsed).filter(([key]) => MACHINE_SUMMARY_FIELDS.has(key))
    );
  } catch {
    return null;
  }
}

// --- Via channel analysis (#1596 follow-up) ---
// Pure: group submitted applications by their Via channel (agency/recruiter
// firm) and compute per-agency advance rates, plus the agency-vs-direct
// aggregate. Channel identity uses the SAME normalizeVia key as the
// merge-tracker dedup guard (tracker-parse.mjs): NFKC + Unicode letters/digits,
// so "Hays" / "HAYS " / full-width "ＨＡＹＳ" land in one bucket while distinct
// non-Latin agencies (リクルートAgent vs パーソルAgent) stay separate. The
// first raw spelling seen is kept for display. Rows in `submitted` whose Via
// cell is empty (legacy tracker without the column, or a blank cell — as
// opposed to the explicit `—` direct marker) belong to neither bucket; they
// are counted as `unknownVia` so agencySubmitted + directSubmitted can't
// silently undershoot the submitted total.
function buildViaChannelAnalysis(submitted, isAdvanced, minSample = MIN_VENDOR_N) {
  const viaOf = (e) => String(e.via ?? '').trim();
  const isDirect = (v) => v === '—' || v === '-';
  const agencySubmitted = submitted.filter(e => { const v = viaOf(e); return v !== '' && !isDirect(v); });
  const directSubmitted = submitted.filter(e => isDirect(viaOf(e)));
  const rate = (arr) => (arr.length > 0 ? Math.round((arr.filter(isAdvanced).length / arr.length) * 100) : 0);

  const byAgency = new Map();
  for (const e of agencySubmitted) {
    const raw = viaOf(e);
    // All-symbol names (e.g. "***") normalize to '' — fall back to the
    // NFKC-lowercased raw string so DISTINCT all-symbol names stay distinct
    // buckets instead of merging into one shared empty key.
    const key = normalizeVia(raw) || raw.normalize('NFKC').toLowerCase();
    if (!byAgency.has(key)) byAgency.set(key, { agency: raw, total: 0, advanced: 0 });
    const entry = byAgency.get(key);
    entry.total++;
    if (isAdvanced(e)) entry.advanced++;
  }
  const breakdown = [...byAgency.values()]
    .map(d => ({
      agency: d.agency,
      total: d.total,
      advanced: d.advanced,
      advanceRate: d.total > 0 ? Math.round((d.advanced / d.total) * 100) : 0,
      sufficientSample: d.total >= minSample,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    minSampleForClaim: minSample,
    agencySubmitted: agencySubmitted.length,
    directSubmitted: directSubmitted.length,
    // Coverage honesty: submitted rows with an empty Via cell (no `—` marker)
    // that fall into neither bucket. Non-zero means the agency/direct split
    // covers only a subset of submissions.
    unknownVia: submitted.length - agencySubmitted.length - directSubmitted.length,
    agencyAdvanceRate: rate(agencySubmitted),
    directAdvanceRate: rate(directSubmitted),
    breakdown,
  };
}

function runSelfTest() {
  const summary = parseMachineSummary(`
## Machine Summary

\`\`\`yaml
company: "Acme"
role: "Staff AI Engineer"
score: 4.4
legitimacy_tier: "High Confidence"
archetype: "AI Platform / LLMOps Engineer"
final_decision: "Apply"
hard_stops: []
soft_gaps:
  - "No direct healthcare domain experience"
top_strengths:
  - "Production evaluation pipelines"
risk_level: "Medium"
confidence: "High"
next_action: "Follow up on ticket #42 with tailored CV"
via: "Hays"
company_confidential: true
\`\`\`
`);

  const failures = [];
  if (!summary) failures.push('summary was not parsed');
  if (summary?.score !== 4.4) failures.push('numeric score was not parsed');
  if (!Array.isArray(summary?.hard_stops) || summary.hard_stops.length !== 0) failures.push('empty list was not parsed');
  if (summary?.soft_gaps?.[0] !== 'No direct healthcare domain experience') failures.push('list item was not parsed');
  if (summary?.next_action !== 'Follow up on ticket #42 with tailored CV') failures.push('hash-containing scalar field was not parsed');
  if (summary?.via !== 'Hays') failures.push('via was not preserved from Machine Summary');
  if (summary?.company_confidential !== true) failures.push('company_confidential boolean was not preserved from Machine Summary');

  // Backward compat (#1737): summaries without risk_summary parse as before, key simply absent.
  if ('risk_summary' in (summary ?? {})) failures.push('summary without risk_summary must not gain the key');

  // risk_summary preservation (#1737): the nested map must survive the
  // MACHINE_SUMMARY_FIELDS allowlist intact — nested keys preserved, not
  // flattened or dropped.
  const riskSummary = parseMachineSummary(`
## Machine Summary

\`\`\`yaml
company: "Acme"
role: "Staff AI Engineer"
score: 4.4
legitimacy_tier: "High Confidence"
risk_summary:
  legitimacy: high_confidence
  classification: clear
  culture: caution
  interview_redflags: not_evaluated
  ai_infra: not_evaluated
\`\`\`
`)?.risk_summary;
  if (!riskSummary || typeof riskSummary !== 'object' || Array.isArray(riskSummary)) {
    failures.push('risk_summary nested map was dropped or not parsed as a map');
  } else {
    if (riskSummary.legitimacy !== 'high_confidence') failures.push('risk_summary.legitimacy was not preserved');
    if (riskSummary.classification !== 'clear') failures.push('risk_summary.classification was not preserved');
    if (riskSummary.culture !== 'caution') failures.push('risk_summary.culture was not preserved');
    if (riskSummary.interview_redflags !== 'not_evaluated') failures.push('risk_summary.interview_redflags was not preserved');
    if (riskSummary.ai_infra !== 'not_evaluated') failures.push('risk_summary.ai_infra was not preserved');
  }

  // Vendor detection (community ATS only; white-labeled → null)
  const vendorCases = [
    ['https://boards.greenhouse.io/acme/jobs/12345', 'greenhouse'],
    ['https://job-boards.eu.greenhouse.io/acme/jobs/9', 'greenhouse'],
    ['https://jobs.lever.co/acme/abc-def', 'lever'],
    ['https://jobs.ashbyhq.com/acme/uuid', 'ashby'],
    ['https://acme.wd1.myworkdayjobs.com/en-US/careers/job/R-1', 'workday'],
    ['https://careers.icims.com/jobs/9/x', null],
    ['https://jobs.dayforcehcm.com/en-US/co/CANDIDATEPORTAL/jobs/1', null],
    ['not a url', null],
    ['', null],
    [null, null],
  ];
  for (const [url, expected] of vendorCases) {
    const got = detectVendor(url);
    if (got !== expected) failures.push(`detectVendor(${JSON.stringify(url)}) → ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
  }

  // Via channel analysis (#1596): agency vs direct yield, normalized buckets.
  const advanced = new Set(['responded', 'interview', 'offer']);
  const viaRows = [
    { via: 'Hays', normalizedStatus: 'interview' },
    { via: 'HAYS ', normalizedStatus: 'rejected' },   // same bucket as Hays
    { via: 'ＨＡＹＳ', normalizedStatus: 'rejected' }, // full-width → same bucket as Hays (NFKC)
    { via: 'Randstad', normalizedStatus: 'rejected' },
    { via: 'リクルートAgent', normalizedStatus: 'interview' }, // non-Latin: distinct agency...
    { via: 'パーソルAgent', normalizedStatus: 'rejected' },    // ...must NOT merge with the one above
    { via: '—', normalizedStatus: 'responded' },       // direct
    { via: '—', normalizedStatus: 'rejected' },        // direct
    { via: '', normalizedStatus: 'applied' },          // no Via column → unknownVia, neither bucket
  ];
  const viaResult = buildViaChannelAnalysis(viaRows, (e) => advanced.has(e.normalizedStatus), 2);
  if (viaResult.agencySubmitted !== 6) failures.push(`via: agencySubmitted → ${viaResult.agencySubmitted}, expected 6`);
  if (viaResult.directSubmitted !== 2) failures.push(`via: directSubmitted → ${viaResult.directSubmitted}, expected 2`);
  if (viaResult.unknownVia !== 1) failures.push(`via: unknownVia → ${viaResult.unknownVia}, expected 1 (submitted row with empty Via must be counted, not silently dropped)`);
  if (viaResult.directAdvanceRate !== 50) failures.push(`via: directAdvanceRate → ${viaResult.directAdvanceRate}, expected 50`);
  const hays = viaResult.breakdown.find(a => a.agency === 'Hays');
  if (!hays || hays.total !== 3 || hays.advanceRate !== 33) {
    failures.push(`via: Hays bucket wrong (case/space/full-width variants must merge) → ${JSON.stringify(hays)}`);
  }
  if (!hays?.sufficientSample) failures.push('via: Hays should meet the n=2 sample bar');
  const recruit = viaResult.breakdown.find(a => a.agency === 'リクルートAgent');
  const persol = viaResult.breakdown.find(a => a.agency === 'パーソルAgent');
  if (!recruit || !persol || recruit.total !== 1 || persol.total !== 1) {
    failures.push(`via: distinct non-Latin agencies must stay separate buckets → リクルートAgent=${JSON.stringify(recruit)}, パーソルAgent=${JSON.stringify(persol)}`);
  }
  const randstad = viaResult.breakdown.find(a => a.agency === 'Randstad');
  if (randstad?.sufficientSample) failures.push('via: Randstad (n=1) must be flagged as too small for a claim');
  if (buildViaChannelAnalysis([], () => false).breakdown.length !== 0) {
    failures.push('via: empty input must produce an empty breakdown');
  }

  if (failures.length > 0) {
    console.error(`analyze-patterns self-test failed: ${failures.join('; ')}`);
    process.exit(1);
  }

  console.log('analyze-patterns self-test OK (Machine Summary parser + vendor detection + via channel analysis)');
  process.exit(0);
}

// --- Parse applications.md ---
function parseTracker() {
  if (!existsSync(APPS_FILE)) return [];
  const content = readFileSync(APPS_FILE, 'utf-8');
  const lines = content.split('\n');
  const colmap = resolveColumns(lines);
  const entries = [];
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (row) entries.push(row);
  }
  return entries;
}

// --- Parse a single report file ---
function parseReport(reportPath) {
  if (!existsSync(reportPath)) return null;
  const content = readFileSync(reportPath, 'utf-8');
  const report = {
    company: null,
    role: null,
    url: null,
    archetype: null,
    legitimacyTier: null,
    finalDecision: null,
    seniority: null,
    remote: null,
    teamSize: null,
    comp: null,
    domain: null,
    riskLevel: null,
    confidence: null,
    nextAction: null,
    topStrengths: [],
    discardReasons: [],
    scores: {},
    gaps: [],
  };

  const machineSummary = parseMachineSummary(content);
  if (machineSummary) {
    report.machineSummary = machineSummary;
    report.company = normalizeScalar(machineSummary.company) || report.company;
    report.role = normalizeScalar(machineSummary.role) || report.role;
    report.archetype = normalizeScalar(machineSummary.archetype) || report.archetype;
    report.legitimacyTier = normalizeScalar(machineSummary.legitimacy_tier) || report.legitimacyTier;
    report.finalDecision = normalizeScalar(machineSummary.final_decision) || report.finalDecision;
    report.domain = normalizeScalar(machineSummary.domain) || report.domain;
    report.seniority = normalizeScalar(machineSummary.seniority) || report.seniority;
    report.remote = normalizeScalar(machineSummary.remote) || report.remote;
    report.teamSize = normalizeScalar(machineSummary.team_size) || report.teamSize;
    report.riskLevel = normalizeScalar(machineSummary.risk_level) || report.riskLevel;
    report.confidence = normalizeScalar(machineSummary.confidence) || report.confidence;
    report.nextAction = normalizeScalar(machineSummary.next_action) || report.nextAction;
    report.topStrengths = normalizeList(machineSummary.top_strengths);
    report.discardReasons = normalizeList(machineSummary.discard_reasons);

    if (typeof machineSummary.score === 'number') {
      report.scores.global = machineSummary.score;
    }

    for (const hardStop of normalizeList(machineSummary.hard_stops)) {
      report.gaps.push({ description: hardStop, severity: 'hard stop', mitigation: '' });
    }
    for (const softGap of normalizeList(machineSummary.soft_gaps)) {
      report.gaps.push({ description: softGap, severity: 'soft gap', mitigation: '' });
    }
  }

  // Strip bold markers for easier matching
  const plain = content.replace(/\*\*/g, '');

  // Extract Block A table (Role Summary) — works with both EN and ES headers
  // Archetype cell may be labeled "Archetype", "Arquetipo", or "Detected archetype" (drift from EN translation).
  const blockARegex = /\|\s*(?:Detected\s+)?(?:Archetype|Arquetipo)\s*\|\s*(.*?)\s*\|/i;
  const seniorityRegex = /\|\s*(?:Seniority|Nivel|Level)\s*\|\s*(.*?)\s*\|/i;
  const remoteRegex = /\|\s*(?:Remote|Remoto|Location)\s*\|\s*(.*?)\s*\|/i;
  const teamRegex = /\|\s*(?:Team|Team size|Equipo)\s*\|\s*(.*?)\s*\|/i;
  const compRegex = /\|\s*(?:Comp|Salary|Salario|Listed salary)\s*\|\s*(.*?)\s*\|/i;
  const domainRegex = /\|\s*(?:Domain|Dominio|Industry)\s*\|\s*(.*?)\s*\|/i;

  // Fallback: report header field `Archetype: ...` or `Arquetipo: ...` (newer reports use this).
  const headerArchRegex = /^(?:Archetype|Arquetipo):\s*(.+?)$/im;

  // Report header carries `**URL:**` between Score and PDF (see CLAUDE.md /
  // Pipeline Integrity). Capture the first http(s) URL on that line for vendor
  // detection; reports predating the field simply leave url null (→ unknown bucket).
  const urlMatch = plain.match(/^URL:\s*(https?:\/\/\S+)/im);
  if (urlMatch && !report.url) report.url = urlMatch[1].trim().replace(/[)>\].,]+$/, '');

  const archMatch = plain.match(blockARegex) || plain.match(headerArchRegex);
  if (archMatch && !report.archetype) report.archetype = archMatch[1].trim();

  const senMatch = plain.match(seniorityRegex);
  if (senMatch && !report.seniority) report.seniority = senMatch[1].trim();

  const remMatch = plain.match(remoteRegex);
  if (remMatch && !report.remote) report.remote = remMatch[1].trim();

  const teamMatch = plain.match(teamRegex);
  if (teamMatch && !report.teamSize) report.teamSize = teamMatch[1].trim();

  const compMatch = plain.match(compRegex);
  if (compMatch && !report.comp) report.comp = compMatch[1].trim();

  const domainMatch = plain.match(domainRegex);
  if (domainMatch && !report.domain) report.domain = domainMatch[1].trim();

  // Extract scoring table — look for table with "Global" row (using plain, bold already stripped)
  const scoreRegex = /\|\s*(?:CV Match|Match con CV)\s*\|\s*([\d.]+)\/5\s*\|/i;
  const northStarRegex = /\|\s*(?:North Star)\s*\|\s*([\d.]+)\/5\s*\|/i;
  const compScoreRegex = /\|\s*(?:Comp)\s*\|\s*([\d.]+)\/5\s*\|/i;
  const culturalRegex = /\|\s*(?:Cultural signals|Cultural)\s*\|\s*([\d.]+)\/5\s*\|/i;
  const redFlagsRegex = /\|\s*(?:Red flags)\s*\|\s*([-+]?[\d.]+)\s*\|/i;
  const globalRegex = /\|\s*(?:Global)\s*\|\s*([\d.]+)\/5\s*\|/i;

  const cvScoreMatch = plain.match(scoreRegex);
  if (cvScoreMatch && report.scores.cvMatch === undefined) report.scores.cvMatch = parseFloat(cvScoreMatch[1]);

  const nsMatch = plain.match(northStarRegex);
  if (nsMatch && report.scores.northStar === undefined) report.scores.northStar = parseFloat(nsMatch[1]);

  const csMatch = plain.match(compScoreRegex);
  if (csMatch && report.scores.comp === undefined) report.scores.comp = parseFloat(csMatch[1]);

  const culMatch = plain.match(culturalRegex);
  if (culMatch && report.scores.cultural === undefined) report.scores.cultural = parseFloat(culMatch[1]);

  const rfMatch = plain.match(redFlagsRegex);
  if (rfMatch && report.scores.redFlags === undefined) report.scores.redFlags = parseFloat(rfMatch[1]);

  const glMatch = plain.match(globalRegex);
  if (glMatch && report.scores.global === undefined) report.scores.global = parseFloat(glMatch[1]);

  // Extract gaps table
  const gapTableRegex = /\|\s*Gap\s*\|\s*Severity\s*\|.*?\n\|[-|\s]+\n([\s\S]*?)(?:\n\n|\n##|\n\*\*|$)/i;
  const gapTableMatch = content.match(gapTableRegex);
  if (gapTableMatch) {
    const gapRows = gapTableMatch[1].split('\n').filter(r => r.startsWith('|'));
    for (const row of gapRows) {
      const cols = row.split('|').map(s => s.trim()).filter(Boolean);
      if (cols.length >= 2) {
        const duplicate = report.gaps.some(g => g.description.toLowerCase() === cols[0].toLowerCase());
        if (!duplicate) {
          report.gaps.push({
            description: cols[0],
            severity: cols[1].toLowerCase(),
            mitigation: cols[2] || '',
          });
        }
      }
    }
  }

  return report;
}

// --- Classify remote policy into buckets ---
function classifyRemote(raw) {
  if (!raw) return 'unknown';
  const lower = raw.toLowerCase();
  // Order matters: check geo-restricted before general remote
  if (/\b(us[- ]?only|canada[- ]?only|residents only|usa only|us residents|canada residents)\b/.test(lower)) return 'geo-restricted';
  if (/\bargentina\s+remote\s+only\b/.test(lower)) return 'geo-restricted';
  if (/\b(hybrid|on-?site|office|columbus|cape town|relocat)\b/.test(lower)) return 'hybrid/onsite';
  if (/\b(global|anywhere|worldwide|no restrict|70\+|work from anywhere)\b/.test(lower)) return 'global remote';
  if (/\b(remote|latam|americas|brazil|fully remote)\b/.test(lower)) return 'regional remote';
  return 'unknown';
}

// --- Detect ATS vendor from a posting URL ---
// Host-only match, deliberately looser than liveness-api.mjs's resolveAtsApi()
// (which needs the full posting path to build an API URL) — a tracker report's
// URL may point at a board/careers page, not a canonical posting.
//
// SCOPE (intentional): only community ATS with clean, public URL fingerprints —
// Greenhouse, Lever, Ashby, Workday. White-labeled ATS (iCIMS/UKG/Dayforce) are
// NOT detectable from the URL alone and are deferred until the community adds a
// reliable signal (e.g. confirmation-email domain). Undetected → 'unknown'.
const VENDOR_HOST_PATTERNS = [
  { id: 'greenhouse', test: (h) => /(^|\.)greenhouse\.io$/.test(h) },
  { id: 'lever',      test: (h) => h === 'jobs.lever.co' || h.endsWith('.lever.co') },
  { id: 'ashby',      test: (h) => h === 'jobs.ashbyhq.com' || h.endsWith('.ashbyhq.com') },
  { id: 'workday',    test: (h) => h.endsWith('.myworkdayjobs.com') || h.endsWith('.myworkdaysite.com') },
];

function detectVendor(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let u;
  try { u = new URL(rawUrl.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  for (const v of VENDOR_HOST_PATTERNS) if (v.test(host)) return v.id;
  return null;
}

// --- Classify company size ---
function classifyCompanySize(teamSize) {
  if (!teamSize) return 'unknown';
  const lower = teamSize.toLowerCase();
  // Extract numbers
  const nums = lower.match(/[\d,]+/g);
  if (nums) {
    const max = Math.max(...nums.map(n => parseInt(n.replace(/,/g, ''))));
    if (max <= 50) return 'startup';
    if (max <= 500) return 'scaleup';
    return 'enterprise';
  }
  if (/\b(small|elite|tiny|founding)\b/.test(lower)) return 'startup';
  if (/\b(large|enterprise|global)\b/.test(lower)) return 'enterprise';
  return 'unknown';
}

// --- Extract hard blocker keywords from gaps ---
function extractBlockerType(gap) {
  const desc = gap.description.toLowerCase();
  const sev = gap.severity.toLowerCase();
  if (sev.includes('nice') || sev.includes('soft')) return null; // skip soft gaps
  if (/\b(residency|us[- ]only|canada|location|visa|geo|country|region)\b/.test(desc)) return 'geo-restriction';
  if (/\b(javascript|typescript|python|ruby|java|go|rust|node|react|angular|vue|django|flask|rails)\b/.test(desc)) return 'stack-mismatch';
  if (/\b(senior|staff|lead|principal|director|manager|head)\b/.test(desc)) return 'seniority-mismatch';
  if (/\b(hybrid|on-?site|office|relocat)\b/.test(desc)) return 'onsite-requirement';
  return 'other';
}

// --- Main analysis ---
function analyze() {
  const entries = parseTracker();

  if (entries.length === 0) {
    return { error: 'No applications found in tracker.' };
  }

  // Enrich entries with report data and classification
  const enriched = entries.map(e => {
    const reportMatch = e.report.match(/\]\(([^)]+)\)/);
    // Tracker links are relative to the tracker file's own directory (see
    // merge-tracker.mjs link normalization); fall back to repo root for
    // legacy root-relative links.
    let reportPath = null;
    if (reportMatch) {
      const fromTracker = join(dirname(APPS_FILE), reportMatch[1]);
      const candidate = existsSync(fromTracker) ? fromTracker : join(CAREER_OPS, reportMatch[1]);
      
      const repoRelative = relative(CAREER_OPS, candidate).split(sep).join('/');
      if (repoRelative.startsWith('reports/') && !repoRelative.includes('..')) {
        reportPath = existsSync(candidate) ? candidate : null;
      }
    }
    const reportData = reportPath ? parseReport(reportPath) : null;
    const outcome = classifyOutcome(e.status);
    const trackerScore = parseFloat(e.score);
    const score = Number.isFinite(trackerScore)
      ? trackerScore
      : (Number.isFinite(reportData?.scores?.global) ? reportData.scores.global : 0);

    // Fallback: if report didn't have Remote field, try the notes column
    const remoteSource = reportData?.remote || e.notes || '';
    const teamSource = reportData?.teamSize || '';

    return {
      ...e,
      normalizedStatus: normalizeStatus(e.status),
      outcome,
      score,
      report: reportData,
      remoteBucket: classifyRemote(remoteSource),
      companySize: classifyCompanySize(teamSource),
      vendor: detectVendor(reportData?.url),
    };
  });

  // Count entries beyond "Evaluated"
  const beyondEvaluated = enriched.filter(e => e.normalizedStatus !== 'evaluated');
  if (beyondEvaluated.length < MIN_THRESHOLD) {
    return {
      error: `Not enough data: ${beyondEvaluated.length}/${MIN_THRESHOLD} applications beyond "Evaluated". Keep applying and come back later.`,
      current: beyondEvaluated.length,
      threshold: MIN_THRESHOLD,
    };
  }

  // --- Funnel ---
  const funnel = {};
  for (const e of enriched) {
    const s = e.normalizedStatus;
    funnel[s] = (funnel[s] || 0) + 1;
  }

  // --- Score comparison by outcome ---
  const scoresByOutcome = { positive: [], negative: [], self_filtered: [], pending: [] };
  for (const e of enriched) {
    if (e.score > 0) scoresByOutcome[e.outcome].push(e.score);
  }

  const scoreStats = (arr) => {
    if (arr.length === 0) return { avg: 0, min: 0, max: 0, count: 0 };
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return {
      avg: Math.round(avg * 100) / 100,
      min: Math.min(...arr),
      max: Math.max(...arr),
      count: arr.length,
    };
  };

  const scoreComparison = {
    positive: scoreStats(scoresByOutcome.positive),
    negative: scoreStats(scoresByOutcome.negative),
    self_filtered: scoreStats(scoresByOutcome.self_filtered),
    pending: scoreStats(scoresByOutcome.pending),
  };

  // --- Archetype breakdown ---
  const archetypeMap = new Map();
  for (const e of enriched) {
    const arch = e.report?.archetype || 'Unknown';
    if (!archetypeMap.has(arch)) archetypeMap.set(arch, { total: 0, positive: 0, negative: 0, self_filtered: 0, pending: 0 });
    const entry = archetypeMap.get(arch);
    entry.total++;
    entry[e.outcome]++;
  }
  const archetypeBreakdown = [...archetypeMap.entries()].map(([archetype, data]) => ({
    archetype,
    ...data,
    conversionRate: data.total > 0 ? Math.round((data.positive / data.total) * 100) : 0,
  })).sort((a, b) => b.total - a.total);

  // --- Blocker analysis ---
  const blockerCounts = new Map();
  const totalWithGaps = enriched.filter(e => e.report?.gaps?.length > 0);
  for (const e of enriched) {
    if (!e.report?.gaps) continue;
    for (const gap of e.report.gaps) {
      const type = extractBlockerType(gap);
      if (!type) continue;
      blockerCounts.set(type, (blockerCounts.get(type) || 0) + 1);
    }
  }
  const blockerAnalysis = [...blockerCounts.entries()]
    .map(([blocker, frequency]) => ({
      blocker,
      frequency,
      percentage: Math.round((frequency / enriched.length) * 100),
    }))
    .sort((a, b) => b.frequency - a.frequency);

  // --- Remote policy breakdown ---
  const remoteMap = new Map();
  for (const e of enriched) {
    const policy = e.remoteBucket;
    if (!remoteMap.has(policy)) remoteMap.set(policy, { total: 0, positive: 0, negative: 0, self_filtered: 0, pending: 0 });
    const entry = remoteMap.get(policy);
    entry.total++;
    entry[e.outcome]++;
  }
  const remotePolicy = [...remoteMap.entries()].map(([policy, data]) => ({
    policy,
    ...data,
    conversionRate: data.total > 0 ? Math.round((data.positive / data.total) * 100) : 0,
  })).sort((a, b) => b.total - a.total);

  // --- Company size breakdown ---
  const sizeMap = new Map();
  for (const e of enriched) {
    const size = e.companySize;
    if (!sizeMap.has(size)) sizeMap.set(size, { total: 0, positive: 0, negative: 0, self_filtered: 0, pending: 0 });
    const entry = sizeMap.get(size);
    entry.total++;
    entry[e.outcome]++;
  }
  const companySizeBreakdown = [...sizeMap.entries()].map(([size, data]) => ({
    size,
    ...data,
    conversionRate: data.total > 0 ? Math.round((data.positive / data.total) * 100) : 0,
  })).sort((a, b) => b.total - a.total);

  // --- ATS vendor / channel analysis (algorithmic-monoculture aware) ---
  // Motivation: Bommasani et al., "Algorithmic Monocultures in Hiring" (FAccT
  // 2026, arXiv:2605.27371) — rejections routed through a shared screening
  // vendor are correlated, not independent. If a concentrated channel yields
  // nothing, feeding it the same profile has diminishing returns; the rational
  // move is to divert those companies to referral/direct contact.
  //
  // HONESTY: this reports CHANNEL YIELD, not discrimination. A single tracker
  // can't causally separate "the vendor's algorithm filters me" from "that
  // vendor skews toward a segment I fit poorly" — but "stop feeding a dead
  // channel, go around it" is rational under either explanation.
  //
  // "Advanced" here is STRICTER than the outcome=='positive' bucket: a bare
  // 'applied' (submitted, no reply yet) does NOT count as passing screening.
  const ADVANCED_STATUSES = new Set(['responded', 'interview', 'offer']);
  const SUBMITTED_STATUSES = new Set(['applied', 'responded', 'interview', 'offer', 'rejected', 'discarded']);
  const isAdvanced = (e) => ADVANCED_STATUSES.has(e.normalizedStatus);

  // Only applications we actually submitted count toward channel yield (drop
  // 'evaluated' = never applied, and 'skip' = self-filtered).
  const submitted = enriched.filter(e => SUBMITTED_STATUSES.has(e.normalizedStatus));
  const overallAdvanced = submitted.filter(isAdvanced).length;
  const overallAdvanceRate = submitted.length > 0
    ? Math.round((overallAdvanced / submitted.length) * 100) : 0;

  const vendorMap = new Map();
  for (const e of submitted) {
    const v = e.vendor || 'unknown';
    if (!vendorMap.has(v)) vendorMap.set(v, { total: 0, advanced: 0 });
    const entry = vendorMap.get(v);
    entry.total++;
    if (isAdvanced(e)) entry.advanced++;
  }

  // Recommendations only fire on buckets with enough n to not be noise; the
  // breakdown still SHOWS every bucket (with its n) so nothing is hidden.
  const vendorBreakdown = [...vendorMap.entries()]
    .filter(([v]) => v !== 'unknown')
    .map(([vendor, data]) => ({
      vendor,
      total: data.total,
      advanced: data.advanced,
      advanceRate: data.total > 0 ? Math.round((data.advanced / data.total) * 100) : 0,
      sharePct: submitted.length > 0 ? Math.round((data.total / submitted.length) * 100) : 0,
      sufficientSample: data.total >= MIN_VENDOR_N,
    }))
    .sort((a, b) => b.total - a.total);

  const identifiedCount = submitted.length - (vendorMap.get('unknown')?.total || 0);
  const vendorAnalysis = {
    scope: ['greenhouse', 'lever', 'ashby', 'workday'],
    minSampleForClaim: MIN_VENDOR_N,
    submitted: submitted.length,
    identified: identifiedCount,
    coveragePct: submitted.length > 0 ? Math.round((identifiedCount / submitted.length) * 100) : 0,
    overallAdvanceRate,
    breakdown: vendorBreakdown,
    citation: 'Bommasani et al., Algorithmic Monocultures in Hiring, FAccT 2026 (arXiv:2605.27371)',
  };

  // --- Via channel analysis (#1596 follow-up): per-agency advance rate ---
  // Same honesty rules as the vendor analysis above: this reports CHANNEL
  // YIELD. In an agency-mediated search the highest-leverage decision is which
  // recruiter relationships to invest in — this shows which ones convert.
  // Rows only carry `via` when the tracker has the optional Via column
  // (#1596); without it every bucket is empty and nothing is claimed.
  const viaChannelAnalysis = buildViaChannelAnalysis(submitted, isAdvanced);

  // --- Score threshold analysis ---
  const positiveScores = scoresByOutcome.positive.filter(s => s > 0);
  const minPositiveScore = positiveScores.length > 0 ? Math.min(...positiveScores) : 0;
  const scoreThreshold = {
    recommended: minPositiveScore > 0 ? Math.floor(minPositiveScore * 10) / 10 : 3.5,
    reasoning: positiveScores.length > 0
      ? `Lowest score among positive outcomes is ${minPositiveScore}. No applications below this score led to progress.`
      : 'Not enough positive outcome data to determine threshold.',
    positiveRange: positiveScores.length > 0
      ? `${Math.min(...positiveScores)} - ${Math.max(...positiveScores)}`
      : 'N/A',
  };

  // --- Generate recommendations ---
  const recommendations = [];

  // --- Discard reason analysis (Issue 1380) ---

  // Aggregates user-committed `DISCARD: <reason>` or `SKIP: <reason>` tags in the Notes column.
  const discardReasonCounts = new Map();
  for (const e of enriched) {
    if (e.outcome !== 'self_filtered' && e.outcome !== 'negative') continue;
    // From tracker Notes column: "DISCARD: <reason>" or "SKIP: <reason>"
    const notesMatch = (e.notes || '').match(/(?:DISCARD|SKIP):\s*([^,;\n]+)/gi);
    if (notesMatch) {
      for (const m of notesMatch) {
        const key = m.replace(/^(?:DISCARD|SKIP):\s*/i, '').trim().toLowerCase();
        if (key) discardReasonCounts.set(key, (discardReasonCounts.get(key) || 0) + 1);
      }
    }
  }
  const discardReasonStats = [...discardReasonCounts.entries()]
    .map(([reason, frequency]) => ({
      reason,
      frequency,
      percentage: Math.round((frequency / enriched.length) * 100),
    }))
    .sort((a, b) => b.frequency - a.frequency);

  // Recommend updating _custom.md when a single reason dominates
  const topDiscardReason = discardReasonStats[0];
  if (topDiscardReason && topDiscardReason.frequency >= Math.max(3, Math.ceil(enriched.length * 0.15))) {
    recommendations.push({
      action: `Add "${topDiscardReason.reason}" filter to modes/_custom.md to avoid wasting evaluation effort`,
      reasoning: `"${topDiscardReason.reason}" is the most frequent discard reason (${topDiscardReason.frequency}x, ${topDiscardReason.percentage}% of all applications).`,
      impact: 'high',
    });
  }

  // --- Tech stack gaps (from negative + self_filtered outcomes) ---
  // Canonical spellings keyed by lowercased match — the /i regex below returns
  // the source casing ("react native", "NODEJS"), and without this map each
  // case variant of the same tech lands in its own techStackGaps bucket.
  // Keys cover the optional-dot regex variants (node.js/nodejs, vue.js/vuejs).
  const TECH_CANONICAL = new Map([
    'JavaScript', 'TypeScript', 'Python', 'Ruby', 'Java', 'Go', 'Rust',
    'React Native', 'React', 'Angular', 'Django', 'Flask', 'Rails', 'PHP',
    'Laravel', 'Symfony', 'Kotlin', 'Swift', 'C++', 'C#', '.NET', 'MongoDB',
    'MySQL', 'PostgreSQL', 'Redis', 'GraphQL', 'REST', 'AWS', 'GCP', 'Azure',
    'Docker', 'Kubernetes', 'Terraform', 'Supabase', 'Inngest',
  ].map(t => [t.toLowerCase(), t]));
  TECH_CANONICAL.set('node.js', 'Node.js').set('nodejs', 'Node.js');
  TECH_CANONICAL.set('vue.js', 'Vue.js').set('vuejs', 'Vue.js');
  const stackGapCounts = new Map();
  for (const e of enriched) {
    if (e.outcome !== 'negative' && e.outcome !== 'self_filtered') continue;
    if (!e.report?.gaps) continue;
    for (const gap of e.report.gaps) {
      // Extract tech keywords from gap descriptions
      const techs = gap.description.match(/\b(JavaScript|TypeScript|Python|Ruby|Java|Go|Rust|Node\.?js|React Native|React|Angular|Vue\.?js|Django|Flask|Rails|PHP|Laravel|Symfony|Kotlin|Swift|C\+\+|C#|\.NET|MongoDB|MySQL|PostgreSQL|Redis|GraphQL|REST|AWS|GCP|Azure|Docker|Kubernetes|Terraform|Supabase|Inngest)\b/gi);
      if (techs) {
        for (const tech of techs) {
          const normalized = TECH_CANONICAL.get(tech.toLowerCase()) || tech;
          stackGapCounts.set(normalized, (stackGapCounts.get(normalized) || 0) + 1);
        }
      }
    }
  }
  const techStackGaps = [...stackGapCounts.entries()]
    .map(([skill, frequency]) => ({ skill, frequency }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 15);

  // Geo-restriction recommendation
  const geoBlocker = blockerAnalysis.find(b => b.blocker === 'geo-restriction');
  if (geoBlocker && geoBlocker.percentage >= 20) {
    recommendations.push({
      action: `Tighten location filters in portals.yml -- ${geoBlocker.percentage}% of applications hit a geo-restriction blocker`,
      reasoning: `${geoBlocker.frequency} of ${enriched.length} offers are location-restricted (US/Canada-only). These are wasted evaluation effort.`,
      impact: 'high',
    });
  }

  // Stack mismatch recommendation
  const stackBlocker = blockerAnalysis.find(b => b.blocker === 'stack-mismatch');
  if (stackBlocker && stackBlocker.percentage >= 15) {
    const topGaps = techStackGaps.slice(0, 3).map(g => g.skill).join(', ');
    recommendations.push({
      action: `Filter out roles requiring ${topGaps} as primary stack -- ${stackBlocker.percentage}% hit stack mismatch`,
      reasoning: `Core stack gaps (${topGaps}) are the most common technical blockers in negative outcomes.`,
      impact: 'high',
    });
  }

  // Score threshold recommendation
  if (minPositiveScore > 3.0) {
    recommendations.push({
      action: `Set minimum score threshold at ${scoreThreshold.recommended}/5 before generating PDFs`,
      reasoning: `No positive outcomes below ${minPositiveScore}/5. Scores below this are wasted effort.`,
      impact: 'medium',
    });
  }

  // Best archetype recommendation
  const bestArchetype = archetypeBreakdown.filter(a => a.total >= 2).sort((a, b) => b.conversionRate - a.conversionRate)[0];
  if (bestArchetype && bestArchetype.conversionRate > 0) {
    recommendations.push({
      action: `Double down on "${bestArchetype.archetype}" roles (${bestArchetype.conversionRate}% conversion rate)`,
      reasoning: `${bestArchetype.positive} of ${bestArchetype.total} applications in this archetype led to positive outcomes.`,
      impact: 'medium',
    });
  }

  // Remote policy recommendation
  const bestRemote = remotePolicy.filter(r => r.total >= 2).sort((a, b) => b.conversionRate - a.conversionRate)[0];
  const worstRemote = remotePolicy.filter(r => r.total >= 2 && r.conversionRate === 0)[0];
  if (worstRemote) {
    recommendations.push({
      action: `Avoid "${worstRemote.policy}" roles (0% conversion across ${worstRemote.total} applications)`,
      reasoning: `None of the ${worstRemote.total} applications with "${worstRemote.policy}" policy led to progress.`,
      impact: 'medium',
    });
  }

  // Channel-monoculture recommendation: a concentrated vendor (>= 25% of
  // submissions, sufficient sample) whose advance rate is well below EVERY OTHER
  // channel is a dead channel worth routing around, not re-feeding. The baseline
  // is leave-one-out (this vendor vs all other submissions) — comparing to an
  // overall rate that INCLUDES the vendor understates the gap when it dominates.
  let deadChannel = null;
  for (const v of vendorBreakdown) {
    if (!v.sufficientSample || v.sharePct < 25) continue;
    const others = submitted.filter(e => (e.vendor || 'unknown') !== v.vendor);
    if (others.length === 0) continue;
    const othersRate = Math.round((others.filter(isAdvanced).length / others.length) * 100);
    // Meaningful gap only: the rest of the pipeline must be doing at least
    // moderately better, so we're not flagging a uniformly cold market.
    if (v.advanceRate < othersRate && othersRate - v.advanceRate >= 10) {
      if (!deadChannel || v.advanceRate < deadChannel.advanceRate) deadChannel = { ...v, othersRate };
    }
  }
  if (deadChannel) {
    recommendations.push({
      action: `Route ${deadChannel.vendor} companies through referral / direct contact -- ${deadChannel.sharePct}% of your applications flow through it at a ${deadChannel.advanceRate}% advance rate (vs ${deadChannel.othersRate}% through other channels)`,
      reasoning: `${deadChannel.advanced}/${deadChannel.total} ${deadChannel.vendor} applications advanced past screening, well below your other channels. Under algorithmic monoculture (Bommasani et al., FAccT 2026) a shared screener's rejections are correlated -- re-applying the same profile through the same engine has diminishing returns; a human channel bypasses it. Channel yield, not a discrimination claim.`,
      impact: 'high',
    });
  }

  // Best-converting agency (#1596 follow-up): with a sufficient sample and a
  // clear lead over the overall pipeline, that recruiter relationship is worth
  // prioritizing. One recommendation at most — the breakdown shows the rest.
  const topAgency = viaChannelAnalysis.breakdown
    .filter(a => a.sufficientSample && a.advanced > 0 && a.advanceRate >= overallAdvanceRate + 10)
    .sort((a, b) => b.advanceRate - a.advanceRate)[0];
  if (topAgency) {
    recommendations.push({
      action: `Prioritize roles via ${topAgency.agency} -- ${topAgency.advanceRate}% advance rate across ${topAgency.total} submissions (overall: ${overallAdvanceRate}%)`,
      reasoning: `${topAgency.advanced}/${topAgency.total} applications through ${topAgency.agency} advanced past screening, well above your overall rate. In an agency-mediated search the highest-leverage decision is which recruiter relationships to invest in -- this one converts. Channel yield, not a causal claim.`,
      impact: 'medium',
    });
  }

  // Date range
  const dates = enriched.map(e => e.date).filter(Boolean).sort();

  return {
    metadata: {
      total: enriched.length,
      dateRange: { from: dates[0], to: dates[dates.length - 1] },
      analysisDate: new Date().toISOString().split('T')[0],
      byOutcome: {
        positive: enriched.filter(e => e.outcome === 'positive').length,
        negative: enriched.filter(e => e.outcome === 'negative').length,
        self_filtered: enriched.filter(e => e.outcome === 'self_filtered').length,
        pending: enriched.filter(e => e.outcome === 'pending').length,
      },
    },
    funnel,
    scoreComparison,
    archetypeBreakdown,
    blockerAnalysis,
    remotePolicy,
    companySizeBreakdown,
    vendorAnalysis,
    viaChannelAnalysis,
    scoreThreshold,
    techStackGaps,
    discardReasonStats,
    recommendations,
  };
}

// --- Summary mode (human-readable) ---
function printSummary(result) {
  if (result.error) {
    console.log(`\n${result.error}\n`);
    return;
  }

  const { metadata, funnel, scoreComparison, archetypeBreakdown, blockerAnalysis, remotePolicy, scoreThreshold, techStackGaps, discardReasonStats, recommendations } = result;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Pattern Analysis — ${metadata.analysisDate}`);
  console.log(`  ${metadata.total} applications (${metadata.dateRange.from} to ${metadata.dateRange.to})`);
  console.log(`${'='.repeat(60)}\n`);

  // Funnel
  console.log('CONVERSION FUNNEL');
  console.log('-'.repeat(40));
  const funnelOrder = ['evaluated', 'applied', 'responded', 'interview', 'offer', 'rejected', 'discarded', 'skip'];
  for (const status of funnelOrder) {
    if (funnel[status]) {
      const pct = Math.round((funnel[status] / metadata.total) * 100);
      console.log(`  ${status.padEnd(15)} ${String(funnel[status]).padStart(3)} (${pct}%)`);
    }
  }

  // Score comparison
  console.log('\nSCORE BY OUTCOME');
  console.log('-'.repeat(40));
  for (const [group, stats] of Object.entries(scoreComparison)) {
    if (stats.count > 0) {
      console.log(`  ${group.padEnd(15)} avg ${stats.avg}/5  (${stats.count} entries, range ${stats.min}-${stats.max})`);
    }
  }

  // Blockers
  if (blockerAnalysis.length > 0) {
    console.log('\nTOP BLOCKERS');
    console.log('-'.repeat(40));
    for (const b of blockerAnalysis) {
      console.log(`  ${b.blocker.padEnd(20)} ${String(b.frequency).padStart(2)}x (${b.percentage}% of all)`);
    }
  }

  // Remote policy
  console.log('\nREMOTE POLICY');
  console.log('-'.repeat(40));
  for (const r of remotePolicy) {
    console.log(`  ${r.policy.padEnd(20)} ${String(r.total).padStart(2)} total, ${r.positive} positive (${r.conversionRate}%)`);
  }

  // Tech gaps
  if (techStackGaps.length > 0) {
    console.log('\nTOP TECH STACK GAPS (negative outcomes)');
    console.log('-'.repeat(40));
    for (const g of techStackGaps.slice(0, 10)) {
      console.log(`  ${g.skill.padEnd(20)} ${g.frequency}x`);
    }
  }

  // Discard reasons
  if (discardReasonStats && discardReasonStats.length > 0) {
    console.log('\nTOP DISCARD / SKIP REASONS');
    console.log('-'.repeat(40));
    for (const d of discardReasonStats.slice(0, 10)) {
      console.log(`  ${d.reason.padEnd(30)} ${String(d.frequency).padStart(2)}x (${d.percentage}%)`);
    }
  }

  // ATS vendor / channel analysis
  const va = result.vendorAnalysis;
  if (va && va.breakdown.length > 0) {
    console.log('\nATS CHANNEL ANALYSIS (community ATS only)');
    console.log('-'.repeat(40));
    console.log(`  vendor identified for ${va.identified}/${va.submitted} submissions (${va.coveragePct}% coverage); overall advance rate ${va.overallAdvanceRate}%`);
    for (const v of va.breakdown) {
      const flag = v.sufficientSample ? '' : '  (n too small for a claim)';
      console.log(`  ${v.vendor.padEnd(12)} ${String(v.total).padStart(3)} apps  ${String(v.sharePct).padStart(3)}% share  ${String(v.advanceRate).padStart(3)}% advance${flag}`);
    }
    console.log('  Channel yield, not discrimination — see Bommasani et al., FAccT 2026.');
  }

  // Via channel analysis (#1596): which recruiter relationships convert
  const via = result.viaChannelAnalysis;
  if (via && (via.breakdown.length > 0 || via.directSubmitted > 0)) {
    console.log('\nVIA CHANNEL ANALYSIS (agency vs direct, #1596)');
    console.log('-'.repeat(40));
    console.log(`  direct  ${String(via.directSubmitted).padStart(3)} apps  ${String(via.directAdvanceRate).padStart(3)}% advance`);
    console.log(`  agency  ${String(via.agencySubmitted).padStart(3)} apps  ${String(via.agencyAdvanceRate).padStart(3)}% advance`);
    if (via.unknownVia > 0) {
      console.log(`  unknown ${String(via.unknownVia).padStart(3)} apps  (no Via recorded — not counted in either channel)`);
    }
    for (const a of via.breakdown) {
      const flag = a.sufficientSample ? '' : '  (n too small for a claim)';
      console.log(`    ${a.agency.padEnd(16)} ${String(a.total).padStart(3)} apps  ${String(a.advanceRate).padStart(3)}% advance${flag}`);
    }
  }

  // Score threshold
  console.log(`\nSCORE THRESHOLD: ${scoreThreshold.recommended}/5`);
  console.log(`  ${scoreThreshold.reasoning}`);

  // Recommendations
  if (recommendations.length > 0) {
    console.log(`\nRECOMMENDATIONS`);
    console.log('='.repeat(60));
    for (let i = 0; i < recommendations.length; i++) {
      const r = recommendations[i];
      console.log(`  ${i + 1}. [${r.impact.toUpperCase()}] ${r.action}`);
      console.log(`     ${r.reasoning}`);
    }
  }

  console.log('');
}

// --- Run ---
if (args.includes('--self-test')) {
  runSelfTest();
}

const result = analyze();

if (summaryMode) {
  printSummary(result);
} else {
  console.log(JSON.stringify(result, null, 2));
}

if (result.error) process.exit(1);
