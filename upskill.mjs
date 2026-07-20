#!/usr/bin/env node
/**
 * upskill.mjs — Aggregate skill-gap analyzer for career-ops (#1520, phase 1)
 *
 * Reads the tracker + every linked evaluation report, extracts skill tokens
 * from each report's gaps (Machine Summary hard_stops/soft_gaps + Gap table),
 * removes anything already present in cv.md / config/profile.yml, and emits a
 * weighted, tiered gap map as JSON for the `upskill` mode to narrate.
 *
 * Weighting: each report contributes (5.0 − score) per skill it names — a
 * 2.1/5 report says more about your gaps than a 4.5/5 one. A skill is counted
 * once per report (presence), not once per mention, so one ranty report can't
 * dominate the map.
 *
 * Tiers are fixed, explainable thresholds over the share of low-fit
 * (score < 4.0) reports naming the gap — NOT quantiles, which are noise at
 * the 5–20 report sample sizes this tool sees.
 *
 * Run: node upskill.mjs            (JSON to stdout)
 *      node upskill.mjs --summary  (human-readable table)
 *      node upskill.mjs --min-reports 3
 *      node upskill.mjs --self-test
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load as yamlLoad } from 'js-yaml';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const APPS_FILE = existsSync(join(CAREER_OPS, 'data/applications.md'))
  ? join(CAREER_OPS, 'data/applications.md')
  : join(CAREER_OPS, 'applications.md');
const CV_FILE = join(CAREER_OPS, 'cv.md');
const PROFILE_FILE = join(CAREER_OPS, 'config/profile.yml');

// Bump when extraction rules change in a way that would make gap lists from
// older runs non-comparable. The upskill mode's diff-vs-previous section only
// compares reports with the same schema_version, so a regex change can't
// masquerade as "gap closed".
export const SCHEMA_VERSION = 1;

// Reports below this global score count as "low fit" — the population whose
// gaps matter most. Matches the apply threshold in Ethical Use (CLAUDE.md).
const LOW_FIT_SCORE = 4.0;

// Skill tokenizer. Superset of the tech regex in analyze-patterns.mjs
// (deliberately duplicated — see #1520 discussion: extracting a shared module
// from a tested core script is a follow-up once both call sites are stable).
const SKILL_TOKENS = [
  // Languages
  'JavaScript', 'TypeScript', 'Python', 'Ruby', 'Java', 'Golang', 'Rust', 'PHP',
  'Kotlin', 'Swift', 'Scala', 'Elixir', 'C\\+\\+', 'C#', '\\.NET', 'SQL',
  // Frontend / frameworks
  'React Native', 'React', 'Angular', 'Vue\\.?js', 'Svelte', 'Next\\.?js',
  'Django', 'Flask', 'FastAPI', 'Rails', 'Laravel', 'Symfony', 'Spring',
  'Node\\.?js', 'NodeJS',
  // Data stores
  'MongoDB', 'MySQL', 'PostgreSQL', 'Postgres', 'Redis', 'Elasticsearch',
  'Snowflake', 'BigQuery', 'Databricks', 'DynamoDB', 'Cassandra',
  // APIs / messaging
  'GraphQL', 'gRPC', 'Kafka', 'RabbitMQ',
  // Cloud / infra
  'AWS', 'GCP', 'Azure', 'Docker', 'Kubernetes', 'k8s', 'Terraform',
  'Ansible', 'Helm', 'Jenkins', 'GitHub Actions', 'GitLab CI', 'CI/CD',
  'Prometheus', 'Grafana', 'Datadog', 'Supabase', 'Inngest',
  // Data / ML / AI
  'PyTorch', 'TensorFlow', 'scikit-learn', 'Pandas', 'NumPy', 'Spark',
  'Airflow', 'dbt', 'MLOps', 'MLflow', 'LangChain', 'LlamaIndex',
  'Hugging Face', 'RAG', 'LLMs?', 'Prompt Engineering', 'Fine-?tuning',
  'Computer Vision', 'NLP',
  // Analytics / enterprise
  'Tableau', 'Power BI', 'Looker', 'Salesforce', 'SAP',
];

// \b fails at symbol edges (\bC\+\+\b needs a word char AFTER the +, \b\.NET
// needs one BEFORE the dot), so C++/C#/.NET would never match standalone.
// (?<!\w)/(?!\w) are equivalent to \b for word-char edges and correct for
// symbol edges.
const SKILL_PATTERN = new RegExp(
  '(?<!\\w)(?:' + SKILL_TOKENS.join('|') + ')(?!\\w)',
  'gi'
);

// "Go" is an everyday English word, so it can't join the case-insensitive
// token list ("go the extra mile" would register a skill). Match it in a
// separate CASE-SENSITIVE pass: only the exact standalone token "Go" counts
// as the language; prose "go"/"GO" never do. "Golang" still resolves to "Go"
// via the main pattern + CANONICAL. A trailing hyphen also disqualifies:
// capitalized business phrases like "Go-to-market" and "Go-live" are not the
// language (punctuation like "Go," "Go/Rust" "(Go)" still counts).
const GO_SKILL_PATTERN = /(?<!\w)Go(?![\w-])/;

// lowercase → canonical display casing, derived from SKILL_TOKENS by stripping
// regex syntax ('Vue\\.?js' → 'Vue.js'). Keeps case-insensitive matches like
// "graphql" resolving to the same key ("GraphQL") as the CV-known-skills set.
const DISPLAY = Object.fromEntries(
  SKILL_TOKENS.map(t => {
    const display = t.replace(/\\/g, '').replace(/\?/g, '');
    return [display.toLowerCase(), display];
  })
);

// Exact-alias canonicalization ONLY (lowercased match → display name).
// Deliberately no umbrella aliases: "cloud" must never count as knowing
// AWS/GCP/Azure — a generous map silently suppresses real gaps, and the
// "cv skill never appears as gap" acceptance test rewards exactly that
// failure mode. Every entry here maps spellings of the SAME skill.
const CANONICAL = {
  'k8s': 'Kubernetes',
  'golang': 'Go',
  'postgres': 'PostgreSQL',
  'nodejs': 'Node.js', 'node.js': 'Node.js', 'nodejs.': 'Node.js',
  'vuejs': 'Vue.js', 'vue.js': 'Vue.js',
  'nextjs': 'Next.js', 'next.js': 'Next.js',
  'llm': 'LLMs', 'llms': 'LLMs',
  'finetuning': 'Fine-tuning', 'fine-tuning': 'Fine-tuning',
  'power bi': 'Power BI',
  'github actions': 'GitHub Actions',
  'gitlab ci': 'GitLab CI',
  'ci/cd': 'CI/CD',
  'hugging face': 'Hugging Face',
  'react native': 'React Native',
  'prompt engineering': 'Prompt Engineering',
  'computer vision': 'Computer Vision',
  'scikit-learn': 'scikit-learn',
  'c++': 'C++', 'c#': 'C#', '.net': '.NET',
  'nlp': 'NLP', 'rag': 'RAG', 'sql': 'SQL', 'aws': 'AWS', 'gcp': 'GCP',
  'grpc': 'gRPC', 'dbt': 'dbt', 'mlops': 'MLOps', 'mlflow': 'MLflow',
};

function canonicalize(token) {
  const key = token.toLowerCase();
  // Alias map first (k8s → Kubernetes), then display casing from the token
  // list (graphql → GraphQL, pytorch → PyTorch) — never title-case, which
  // manufactures keys like "Graphql" that miss the known-skills set.
  return CANONICAL[key] || DISPLAY[key] || token;
}

/** Extract the set of canonical skill names present in a free-text blob. */
export function extractSkills(text) {
  if (!text) return new Set();
  const found = new Set();
  for (const m of text.matchAll(SKILL_PATTERN)) {
    found.add(canonicalize(m[0]));
  }
  if (GO_SKILL_PATTERN.test(text)) found.add('Go');
  return found;
}

// --- Machine Summary + Gap table parsing ---
// Mirrors analyze-patterns.mjs (duplicated by design, see header comment).
function parseMachineSummary(content) {
  const fenceMatch = content.match(/##\s*Machine Summary\s*\n+```(?:yaml|yml|json)?\s*\n([\s\S]*?)\n```/i);
  if (!fenceMatch) return null;
  const raw = fenceMatch[1].trim();
  if (!raw) return null;
  try {
    const parsed = yamlLoad(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'object') return [];
  return [String(value).trim()].filter(Boolean);
}

/**
 * Parse one report file into { score, gapText, hasMachineSummary }.
 * gapText concatenates every gap description (hard stops, soft gaps, Gap
 * table rows) — the haystack the skill tokenizer runs over.
 */
export function parseReportGaps(content) {
  const gapDescriptions = [];
  let score = null;
  let hasMachineSummary = false;

  const summary = parseMachineSummary(content);
  if (summary) {
    hasMachineSummary = true;
    if (typeof summary.score === 'number' && Number.isFinite(summary.score)) score = summary.score;
    gapDescriptions.push(...normalizeList(summary.hard_stops));
    gapDescriptions.push(...normalizeList(summary.soft_gaps));
  }

  const plain = content.replace(/\*\*/g, '');
  if (score === null) {
    const glMatch = plain.match(/\|\s*(?:Global)\s*\|\s*([\d.]+)\/5\s*\|/i);
    if (glMatch) score = parseFloat(glMatch[1]);
  }

  const gapTableMatch = content.match(/\|\s*Gap\s*\|\s*Severity\s*\|.*?\n\|[-|\s]+\n([\s\S]*?)(?:\n\n|\n##|\n\*\*|$)/i);
  if (gapTableMatch) {
    for (const row of gapTableMatch[1].split('\n').filter(r => r.startsWith('|'))) {
      const cols = row.split('|').map(s => s.trim()).filter(Boolean);
      if (cols.length >= 2) gapDescriptions.push(cols[0]);
    }
  }

  return { score, gapText: gapDescriptions.join('\n'), hasMachineSummary };
}

/**
 * Pure aggregation over parsed reports. Exported for self-testing.
 *
 * @param {Array<{num:number|string, score:number|null, gapText:string}>} reports
 * @param {Set<string>} knownSkills — canonical names already in cv/profile
 */
export function aggregateGaps(reports, knownSkills) {
  const scored = reports.filter(r => Number.isFinite(r.score));
  const lowFit = scored.filter(r => r.score < LOW_FIT_SCORE);
  const totalLowFit = lowFit.length;

  const bySkill = new Map();
  const excludedCounts = new Map();

  for (const report of reports) {
    const skills = extractSkills(report.gapText);
    for (const skill of skills) {
      if (knownSkills.has(skill)) {
        excludedCounts.set(skill, (excludedCounts.get(skill) || 0) + 1);
        continue;
      }
      if (!bySkill.has(skill)) {
        bySkill.set(skill, { skill, reports: 0, lowFitReports: 0, weightedScore: 0, sources: [] });
      }
      const entry = bySkill.get(skill);
      entry.reports += 1;
      entry.sources.push(report.num);
      const weight = Number.isFinite(report.score) ? Math.max(0, 5.0 - report.score) : 1.0;
      entry.weightedScore += weight;
      if (Number.isFinite(report.score) && report.score < LOW_FIT_SCORE) entry.lowFitReports += 1;
    }
  }

  const gaps = [...bySkill.values()].map(g => {
    const share = totalLowFit > 0 ? g.lowFitReports / totalLowFit : 0;
    // Fixed thresholds — each tier is explainable in one sentence
    // ("named in 4/9 low-fit reports"), which quantiles at N=5–20 are not.
    let tier = 'Low';
    if (share >= 0.5 && g.lowFitReports >= 3) tier = 'Critical';
    else if (share >= 0.3 && g.lowFitReports >= 2) tier = 'High';
    else if (g.lowFitReports >= 2) tier = 'Medium';
    return {
      ...g,
      lowFitShare: Math.round(share * 100) / 100,
      weightedScore: Math.round(g.weightedScore * 100) / 100,
      tier,
    };
  }).sort((a, b) => b.weightedScore - a.weightedScore || b.reports - a.reports);

  const excludedAsKnown = [...excludedCounts.entries()]
    .map(([skill, reports]) => ({ skill, reports }))
    .sort((a, b) => b.reports - a.reports);

  return { gaps, excludedAsKnown, totalLowFit };
}

/**
 * Targeted-mode gap analysis for a single JD (#1739): which JD skills are gaps
 * vs. already known from the CV/profile.
 *
 * Uses the SAME canonicalization as the aggregate path (extractSkills on both
 * sides, canonical-to-canonical comparison) so a known CV skill is suppressed
 * and a real gap surfaces. The previous inline implementation matched raw
 * lowercased regex tokens with substring `.includes()`, which (a) never matched
 * symbol skills like `c\+\+`/`\.net` and (b) over-suppressed via substrings
 * (`go` ⊂ `mongodb`, `sql` ⊂ `postgresql`, `java` ⊂ `javascript`) — inverting the
 * result on every skill (#1851). Emits canonical names, matching aggregate mode.
 *
 * @param {string} jdText - the target job description text
 * @param {string} knownText - cv + profile text (already-known skills)
 * @returns {{ gaps: string[], excludedAsKnown: string[], knownSkills: string[] }}
 */
export function computeTargetedGaps(jdText, knownText) {
  const known = extractSkills(knownText);
  const gaps = [];
  const excludedAsKnown = [];
  for (const skill of extractSkills(jdText)) {
    (known.has(skill) ? excludedAsKnown : gaps).push(skill);
  }
  return { gaps, excludedAsKnown, knownSkills: [...known].sort() };
}

// --- Main ---
function analyze(minReports) {
  if (!existsSync(APPS_FILE)) {
    return { error: 'No applications tracker found. Run some evaluations first.' };
  }

  const lines = readFileSync(APPS_FILE, 'utf-8').split('\n');
  const colmap = resolveColumns(lines);
  const rows = lines.map(l => parseTrackerRow(l, colmap)).filter(Boolean);

  let reportsLinked = 0;
  let reportsRead = 0;
  let reportsWithMachineSummary = 0;
  const parsedReports = [];

  for (const row of rows) {
    const linkMatch = (row.report || '').match(/\]\(([^)]+)\)/);
    if (!linkMatch) continue;
    reportsLinked += 1;
    // Tracker links are normalized relative to the tracker file's directory
    // (see merge-tracker.mjs); resolve against it, with a root-relative fallback.
    const candidates = [join(dirname(APPS_FILE), linkMatch[1]), join(CAREER_OPS, linkMatch[1])];
    const reportPath = candidates.find(p => existsSync(p));
    if (!reportPath) continue;
    reportsRead += 1;
    const content = readFileSync(reportPath, 'utf-8');
    const { score, gapText, hasMachineSummary } = parseReportGaps(content);
    if (hasMachineSummary) reportsWithMachineSummary += 1;
    const trackerScore = parseFloat(row.score);
    parsedReports.push({
      num: row.num,
      score: Number.isFinite(trackerScore) ? trackerScore : score,
      gapText,
    });
  }

  const scoredCount = parsedReports.filter(r => Number.isFinite(r.score)).length;
  if (scoredCount < minReports) {
    return {
      error: `Not enough data: ${scoredCount}/${minReports} scored reports. Evaluate more offers and come back.`,
      current: scoredCount,
      threshold: minReports,
    };
  }

  const knownText = [
    existsSync(CV_FILE) ? readFileSync(CV_FILE, 'utf-8') : '',
    existsSync(PROFILE_FILE) ? readFileSync(PROFILE_FILE, 'utf-8') : '',
  ].join('\n');
  const knownSkills = extractSkills(knownText);

  const { gaps, excludedAsKnown, totalLowFit } = aggregateGaps(parsedReports, knownSkills);

  return {
    schema_version: SCHEMA_VERSION,
    metadata: {
      reportsLinked,
      reportsRead,
      reportsWithMachineSummary,
      reportsScored: scoredCount,
      lowFitReports: totalLowFit,
      lowFitScoreThreshold: LOW_FIT_SCORE,
      knownSkillCount: knownSkills.size,
    },
    gaps,
    excludedAsKnown,
    knownSkills: [...knownSkills].sort(),
  };
}

function printSummary(result) {
  if (result.error) {
    console.log(`upskill: ${result.error}`);
    return;
  }
  const m = result.metadata;
  console.log(`UPSKILL GAP MAP (schema v${result.schema_version})`);
  console.log(`Reports: ${m.reportsRead}/${m.reportsLinked} read, ${m.reportsScored} scored, ${m.lowFitReports} low-fit (<${m.lowFitScoreThreshold}), ${m.reportsWithMachineSummary} with Machine Summary`);
  console.log('');
  if (result.gaps.length === 0) {
    console.log('No skill gaps detected across your evaluated reports.');
  } else {
    const pad = (s, n) => String(s).padEnd(n);
    console.log(`${pad('TIER', 10)}${pad('SKILL', 22)}${pad('REPORTS', 9)}${pad('LOW-FIT', 9)}WEIGHTED`);
    for (const g of result.gaps) {
      console.log(`${pad(g.tier, 10)}${pad(g.skill, 22)}${pad(g.reports, 9)}${pad(`${g.lowFitReports}/${result.metadata.lowFitReports}`, 9)}${g.weightedScore}`);
    }
  }
  if (result.excludedAsKnown.length > 0) {
    console.log('');
    console.log(`Excluded (already in cv.md/profile): ${result.excludedAsKnown.map(e => e.skill).join(', ')}`);
  }
}

// --- Self-test (pure functions, no filesystem) ---
function runSelfTest() {
  const failures = [];

  // extractSkills: canonicalization
  const s1 = extractSkills('Needs k8s, golang and Postgres experience; NodeJS a plus');
  for (const expected of ['Kubernetes', 'Go', 'PostgreSQL', 'Node.js']) {
    if (!s1.has(expected)) failures.push(`extractSkills missing canonical ${expected} (got ${[...s1].join(',')})`);
  }

  // Symbol-terminated skills: \b-style boundaries would drop all three
  const s1b = extractSkills('Requires C++ and C# on .NET, plus SQL.');
  for (const expected of ['C++', 'C#', '.NET', 'SQL']) {
    if (!s1b.has(expected)) failures.push(`extractSkills missing symbol skill ${expected} (got ${[...s1b].join(',')})`);
  }

  // Standalone "Go" is matched case-SENSITIVELY: a capitalized token in a
  // skills list counts, but prose "go"/"GO" must never register as a skill
  // (the global pattern is case-insensitive, so Go lives outside it).
  const s1d = extractSkills('Skills: Go, Rust, TypeScript');
  if (!s1d.has('Go')) failures.push(`extractSkills missing standalone Go (got ${[...s1d].join(',')})`);
  const s1e = extractSkills('willing to go the extra mile; ready to GO live');
  if (s1e.has('Go')) failures.push('prose "go"/"GO" wrongly matched as Go skill');
  // Capitalized hyphenated business phrases must not register as the language
  const s1f = extractSkills('Own the Go-to-market strategy and Go-live support');
  if (s1f.has('Go')) failures.push('hyphenated "Go-to-market"/"Go-live" wrongly matched as Go skill');
  // ...but ordinary punctuation after the token still counts
  const s1g = extractSkills('Backend in Go/Rust (Go preferred). We ship Go.');
  if (!s1g.has('Go')) failures.push('punctuation-adjacent standalone Go missed');

  // Lowercase mentions of mixed-case skills must resolve to canonical casing,
  // or knownSkills.has() misses them (Graphql !== GraphQL)
  const s1c = extractSkills('familiar with graphql, pytorch and postgresql');
  for (const expected of ['GraphQL', 'PyTorch', 'PostgreSQL']) {
    if (!s1c.has(expected)) failures.push(`extractSkills lowercase mention not canonical ${expected} (got ${[...s1c].join(',')})`);
  }

  // Over-suppression guard: cv "Java" must NOT swallow a "JavaScript" gap,
  // and cv "AWS" must not swallow GCP/Azure. This is the failure mode the
  // "cv skill never appears as gap" acceptance test cannot see.
  const cvSkills = extractSkills('Expert in Java and AWS.');
  if (cvSkills.has('JavaScript')) failures.push('cv "Java" wrongly matched JavaScript');
  const { gaps: g1 } = aggregateGaps(
    [{ num: 1, score: 2.0, gapText: 'Missing JavaScript and GCP experience' }],
    cvSkills
  );
  const gapNames = g1.map(g => g.skill);
  if (!gapNames.includes('JavaScript')) failures.push('JavaScript gap suppressed by cv "Java"');
  if (!gapNames.includes('GCP')) failures.push('GCP gap suppressed by cv "AWS"');

  // Known-skill exclusion (the acceptance criterion itself)
  const { gaps: g2, excludedAsKnown: ex2 } = aggregateGaps(
    [{ num: 2, score: 3.0, gapText: 'Needs Java and Kubernetes' }],
    extractSkills('Java developer')
  );
  if (g2.some(g => g.skill === 'Java')) failures.push('known skill Java appeared as gap');
  if (!ex2.some(e => e.skill === 'Java')) failures.push('excludedAsKnown missing Java');
  if (!g2.some(g => g.skill === 'Kubernetes')) failures.push('Kubernetes gap missing');

  // Weighting: low score contributes more; presence counted once per report
  const { gaps: g3 } = aggregateGaps(
    [
      { num: 3, score: 2.0, gapText: 'Kubernetes Kubernetes Kubernetes' },
      { num: 4, score: 4.5, gapText: 'Kubernetes' },
    ],
    new Set()
  );
  const k = g3.find(g => g.skill === 'Kubernetes');
  if (!k) failures.push('Kubernetes not aggregated');
  else {
    if (k.reports !== 2) failures.push(`presence not deduped per report (reports=${k.reports})`);
    if (Math.abs(k.weightedScore - 3.5) > 1e-9) failures.push(`weightedScore expected 3.5, got ${k.weightedScore}`);
  }

  // Tiering: 3/5 low-fit reports naming a skill → Critical; 1/5 → Low
  const lowFitReports = [
    { num: 10, score: 2.0, gapText: 'Terraform' },
    { num: 11, score: 2.5, gapText: 'Terraform' },
    { num: 12, score: 3.0, gapText: 'Terraform and Spark' },
    { num: 13, score: 3.5, gapText: 'nothing here' },
    { num: 14, score: 3.9, gapText: 'nothing here' },
  ];
  const { gaps: g4 } = aggregateGaps(lowFitReports, new Set());
  const terraform = g4.find(g => g.skill === 'Terraform');
  const spark = g4.find(g => g.skill === 'Spark');
  if (terraform?.tier !== 'Critical') failures.push(`Terraform tier expected Critical, got ${terraform?.tier}`);
  if (spark?.tier !== 'Low') failures.push(`Spark tier expected Low, got ${spark?.tier}`);

  // parseReportGaps: Machine Summary + Gap table + score fallback
  const parsed = parseReportGaps(`
# 042 - Acme

| Gap | Severity | Mitigation |
|-----|----------|------------|
| No Kafka experience | soft gap | Learn it |

## Machine Summary

\`\`\`yaml
score: 3.2
hard_stops: []
soft_gaps:
  - "Limited Airflow exposure"
\`\`\`
`);
  if (parsed.score !== 3.2) failures.push(`report score expected 3.2, got ${parsed.score}`);
  if (!parsed.hasMachineSummary) failures.push('hasMachineSummary false');
  if (!/Kafka/.test(parsed.gapText)) failures.push('Gap table row not captured');
  if (!/Airflow/.test(parsed.gapText)) failures.push('soft_gaps not captured');

  // Targeted mode (#1851): known-skill suppression must be canonical-to-canonical,
  // never raw-token substring matching. The old inline path inverted every skill —
  // CV skills shown as gaps, real gaps hidden. This is the exact reproduction from
  // the bug report.
  {
    const { gaps, excludedAsKnown } = computeTargetedGaps(
      'Kubernetes, C++, .NET, Java, SQL, Go, LLMs',        // JD asks for
      'k8s, C++, .NET, JavaScript, PostgreSQL, MongoDB, LLMs' // CV already has
    );
    const gapSet = new Set(gaps);
    const exSet = new Set(excludedAsKnown);
    for (const g of ['Java', 'SQL', 'Go']) {
      if (!gapSet.has(g)) failures.push(`targeted: ${g} should be a gap (got ${gaps.join(',')})`);
      if (exSet.has(g)) failures.push(`targeted: real gap ${g} wrongly suppressed as known`);
    }
    for (const k of ['Kubernetes', 'C++', '.NET', 'LLMs']) {
      if (!exSet.has(k)) failures.push(`targeted: ${k} should be excluded as known (got ${excludedAsKnown.join(',')})`);
      if (gapSet.has(k)) failures.push(`targeted: known skill ${k} wrongly reported as gap`);
    }
  }

  // Targeted --url-text path (#1894): the fetched page text must reach
  // computeTargetedGaps as a plain STRING. It used to be run through normalizeJd
  // (which wants the { title, text } DOM object), yielding { text: '' } and then
  // a `text.matchAll is not a function` crash. Guard both halves: a realistic
  // multi-line JD string produces the right gaps, and the source no longer feeds
  // the raw string to normalizeJd.
  {
    const jdText = 'Requirements:\n- Kubernetes and Go\n- 5+ years experience';
    const { gaps } = computeTargetedGaps(jdText, 'Python, AWS'); // must not throw on a string
    if (!gaps.includes('Kubernetes') || !gaps.includes('Go')) {
      failures.push(`url-text: multi-line JD string should yield Kubernetes+Go gaps (got ${gaps.join(',')})`);
    }
    const selfSrc = readFileSync(fileURLToPath(import.meta.url), 'utf-8');
    if (/normalizeJd\(\s*targetText/.test(selfSrc)) {
      failures.push('url-text: upskill.mjs still passes the raw fetched string to normalizeJd (regression, #1894)');
    }
    if (!/compactText\(targetText\)/.test(selfSrc)) {
      failures.push('url-text: fetched text should be normalized with compactText (string->string), #1894');
    }
  }

  if (failures.length > 0) {
    console.error(`upskill self-test failed: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('upskill self-test OK (extraction, suppression guards, weighting, tiering, report parsing)');
  process.exit(0);
}

// --- CLI ---
// --- CLI ---
const args = process.argv.slice(2);
if (args.includes('--self-test')) runSelfTest();

// ====== SECURE TARGETED MODE PHASE 2a IMPLEMENTATION ======
const urlTextIdx = args.indexOf('--url-text');
const directUrl = args.find(arg => arg.startsWith('http://') || arg.startsWith('https://'));

// Helper function to enforce egress guard against SSRF (Private/Loopback IPs)
async function validateUrlSecurity(urlString) {
  const dns = await import('dns/promises');
  const url = new URL(urlString.endsWith('.') ? urlString.slice(0, -1) : urlString);
  const hostname = url.hostname;

  if (hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new Error('Access denied: Localhost or internal domain target detected.');
  }

  const addresses = await dns.resolve(hostname).catch(() => []);
  const lookupRes = await dns.lookup(hostname).catch(() => null);
  if (lookupRes) addresses.push(lookupRes.address);

  for (const ip of addresses) {
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.)/.test(ip)) {
      throw new Error(`Access denied: Egress guard blocked private target IP ${ip}`);
    }
    if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc00:') || ip.startsWith('fd00:')) {
      throw new Error(`Access denied: Egress guard blocked private target IPv6 ${ip}`);
    }
  }
  return url.toString();
}

if (urlTextIdx !== -1 || directUrl) {
  (async () => {
    let targetText = '';
    const inputSource = urlTextIdx !== -1 ? args[urlTextIdx + 1] : directUrl;

    if (!inputSource) {
      console.error('Error: Please provide a valid URL or file path after --url-text');
      process.exit(1);
    }

    if (inputSource.startsWith('http://') || inputSource.startsWith('https://')) {
      let browser;
      try {
        const secureUrl = await validateUrlSecurity(inputSource);
        const { chromium } = await import('playwright');
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();

        page.on('framenavigated', async (frame) => {
          if (frame === page.mainFrame()) {
            await validateUrlSecurity(frame.url()).catch((err) => {
              console.error(`Security Violation on Redirect: ${err.message}`);
              process.exit(1);
            });
          }
        });

        await page.goto(secureUrl, { waitUntil: 'networkidle', timeout: 30000 });
        targetText = await page.innerText('body');
      } catch (err) {
        console.warn('Playwright extraction failed or blocked, trying fallback WebFetch...', err.message);
        try {
          const secureUrl = await validateUrlSecurity(inputSource);
          // validateUrlSecurity only vets the initial URL; a redirect could still
          // steer the fetch at an internal host (SSRF). The Playwright path
          // re-validates per hop, but this plain fetch must refuse redirects
          // outright — fail closed rather than follow an unvetted Location (#1851).
          const res = await fetch(secureUrl, { signal: AbortSignal.timeout(30000), redirect: 'error' });
          if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
          targetText = await res.text();
        } catch (fetchErr) {
          console.error(`Fatal: Failed to fetch JD from URL: ${fetchErr.message}`);
          process.exit(1);
        }
      } finally {
        if (browser) await browser.close();
      }

      // Whitespace-collapse + length-cap the fetched page text. Use compactText
      // (string -> string), NOT normalizeJd: normalizeJd expects the { title,
      // text } DOM-read object and returns { url, title, text }, so feeding it
      // the innerText/fetch STRING silently produced { text: '' } — destroying
      // the JD and then throwing `text.matchAll is not a function` downstream
      // (#1894). compactText is the string-in/string-out helper this wants.
      try {
        const { compactText } = await import('./browser-extract.mjs');
        targetText = compactText(targetText);
      } catch (e) {}
    } else {
      if (existsSync(inputSource)) {
        targetText = readFileSync(inputSource, 'utf-8');
      } else {
        console.error(`Fatal: Target file not found at path: ${inputSource}`);
        process.exit(1);
      }
    }

    // Assemble the known-skills text (cv + profile), matching aggregate mode.
    // Targeted mode additionally falls back to cv-example.md when cv.md is absent
    // so a fresh checkout still produces a meaningful comparison.
    const knownTextChunks = [];
    if (existsSync(PROFILE_FILE)) {
      try { knownTextChunks.push(readFileSync(PROFILE_FILE, 'utf-8')); } catch (e) {}
    }
    let activeCvFile = CV_FILE;
    if (!existsSync(activeCvFile)) {
      activeCvFile = join(CAREER_OPS, 'cv-example.md');
    }
    if (existsSync(activeCvFile)) {
      try { knownTextChunks.push(readFileSync(activeCvFile, 'utf-8')); } catch (e) {}
    }

    const { gaps: gapList, excludedAsKnown, knownSkills } =
      computeTargetedGaps(targetText, knownTextChunks.join('\n'));

    console.log(JSON.stringify({
      mode: 'targeted',
      source: inputSource,
      gaps: gapList.map(skill => ({ skill })),
      excludedAsKnown: excludedAsKnown.map(skill => ({ skill })),
      knownSkills,
    }, null, 2));

    process.exit(0);
  })();
} else {
  // ====== ORIGINAL AGGREGATE MODE PIPELINE ======
  const minReportsIdx = args.indexOf('--min-reports');
  const MIN_REPORTS = (() => {
    if (minReportsIdx === -1 || args[minReportsIdx + 1] === undefined) return 5;
    const n = parseInt(args[minReportsIdx + 1], 10);
    return Number.isNaN(n) || n < 1 ? 5 : n;
  })();

  const result = analyze(MIN_REPORTS);
  if (args.includes('--summary')) {
    printSummary(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}
