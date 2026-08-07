#!/usr/bin/env node
/**
 * skill-extract.mjs — the shared skill vocabulary + canonical extractor (#1896)
 *
 * Single source of truth for how career-ops recognizes and canonicalizes hard
 * skills. Lifted verbatim from upskill.mjs (the most-tested copy) so upskill,
 * jd-skill-gap, and analyze-patterns can converge on ONE vocabulary + canonical
 * form instead of three drifting ones — the drift class that shipped #1851
 * (CV "k8s" not suppressing JD "Kubernetes" is the same failure in jd-skill-gap).
 *
 * PR 1 of #1896 is a pure relocation: behavior is byte-identical to upskill's
 * former inline copy. `GO_SKILL_PATTERN` stays internal to extractSkills, and
 * canonicalize() passes unknown tokens through unchanged (no umbrella aliases —
 * "cloud" must never count as knowing AWS/GCP/Azure). Later PRs route
 * jd-skill-gap and analyze-patterns through this module.
 *
 * Pure + dependency-free, so it's unit-testable without a tracker or network.
 */

// Skill tokenizer. Superset of the tech regex in analyze-patterns.mjs
// (deliberately duplicated — see #1520 discussion: extracting a shared module
// from a tested core script is a follow-up once both call sites are stable).
export const SKILL_TOKENS = [
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
  // ── Certifications, frameworks and methodologies (added 2026-08-07) ──────
  // Every token above this line is an engineering tool. That made `upskill`
  // structurally blind to the gap class that actually screens out delivery and
  // program-management candidates: credentials. Measured on a 138-report corpus,
  // PMP appeared in 41 reports and ITIL in 26, while the top-ranked gap the tool
  // could see scored 1.9 off a SINGLE report. The vocabulary, not the scoring,
  // was the constraint.
  //
  // Longest-first within each family so alternation prefers the specific form
  // ('Lean Six Sigma' before 'Six Sigma'), matching the existing
  // 'React Native'-before-'React' convention above.
  'PMI-ACP', 'PgMP', 'CAPM', 'PMBOK', 'PMP',
  'PRINCE2', 'Certified ScrumMaster', 'CSPO',
  'ITIL', 'COBIT', 'TOGAF',
  'Lean Six Sigma', 'Six Sigma',
  'CISSP', 'CISM', 'CIPP',
  // DELIBERATELY OMITTED — 'CSM'. It is a legitimate abbreviation for Certified
  // ScrumMaster, but in this corpus it far more often means Customer Success
  // Manager, which is a documented FAIL family (lessons-learned 2026-07-03,
  // blocked in portals.yml → title_filter.negative). Adding it would turn every
  // CSM-shaped rejection into a phantom certification gap. 'Certified
  // ScrumMaster' is listed in full above and carries no such collision.
  //
  // 'SAFe' is NOT here either — it is handled case-sensitively below, for the
  // same reason 'Go' is: 'safe' is an everyday English word.
];

// 'SAFe' cannot join the case-insensitive list — "a safe environment", "safe to
// assume", "safety" would all register a certification. Same failure mode as
// 'Go', and the same fix: a separate CASE-SENSITIVE pass matching only the exact
// standalone token 'SAFe'. The trailing (?!\w) keeps "SAFety" from matching
// while still allowing "SAFe 6", "SAFe," and "(SAFe)".
const SAFE_CERT_PATTERN = /(?<!\w)SAFe(?!\w)/;

// \b fails at symbol edges (\bC\+\+\b needs a word char AFTER the +, \b\.NET
// needs one BEFORE the dot), so C++/C#/.NET would never match standalone.
// (?<!\w)/(?!\w) are equivalent to \b for word-char edges and correct for
// symbol edges.
export const SKILL_PATTERN = new RegExp(
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
export const DISPLAY = Object.fromEntries(
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
export const CANONICAL = {
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
  // Certifications / methodologies (2026-08-07). Uppercase display forms, since
  // DISPLAY lowercases its keys and these are acronyms rather than title-case
  // words — without these, "pmp" in a JD would canonicalize to "Pmp" and miss
  // the known-skills set, the exact drift class this module exists to prevent.
  'pmp': 'PMP', 'pmi-acp': 'PMI-ACP', 'pgmp': 'PgMP', 'capm': 'CAPM',
  'pmbok': 'PMBOK', 'prince2': 'PRINCE2', 'cspo': 'CSPO',
  'certified scrummaster': 'Certified ScrumMaster',
  'itil': 'ITIL', 'cobit': 'COBIT', 'togaf': 'TOGAF',
  'lean six sigma': 'Lean Six Sigma', 'six sigma': 'Six Sigma',
  'cissp': 'CISSP', 'cism': 'CISM', 'cipp': 'CIPP',
  // NOTE: no 'safe' entry here, deliberately. canonicalize() lowercases its
  // input before reading this map, so a 'safe' key would make
  // canonicalize('safe') return 'SAFe' — re-opening through the exported
  // canonicalize() the exact everyday-word hole that keeping SAFe out of
  // SKILL_TOKENS closes for extractSkills(). Without the key, both cases land
  // on the unknown-token pass-through and are returned unchanged: 'SAFe' stays
  // 'SAFe', 'safe' stays 'safe'. The certification is recognized only by
  // SAFE_CERT_PATTERN, which is case-sensitive by design.
};

/**
 * Canonical form of a single raw token. 'k8s'→'Kubernetes', 'graphql'→'GraphQL';
 * an unknown token is returned UNCHANGED (no umbrella aliasing).
 * @param {string} token
 * @returns {string}
 */
export function canonicalize(token) {
  const key = token.toLowerCase();
  // Alias map first (k8s → Kubernetes), then display casing from the token
  // list (graphql → GraphQL, pytorch → PyTorch) — never title-case, which
  // manufactures keys like "Graphql" that miss the known-skills set.
  return CANONICAL[key] || DISPLAY[key] || token;
}

/**
 * Extract the set of canonical skill names present in a free-text blob.
 * @param {string} text
 * @returns {Set<string>}
 */
export function extractSkills(text) {
  if (!text) return new Set();
  const found = new Set();
  for (const m of text.matchAll(SKILL_PATTERN)) {
    found.add(canonicalize(m[0]));
  }
  if (GO_SKILL_PATTERN.test(text)) found.add('Go');
  if (SAFE_CERT_PATTERN.test(text)) found.add('SAFe');
  return found;
}
