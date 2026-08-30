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
  // Both spellings of every fused credential. A certification the user HOLDS
  // and writes the ordinary way must not come back as a gap: the tool then
  // tells them to go and earn something already on their CV, which is worse
  // than the silence this vocabulary was added to fix, because it is
  // confidently wrong. 'Certified Scrum Master' with the space is how most
  // people write it; 'PMI ACP', 'PRINCE 2', 'Six-Sigma' are the same story with
  // a hyphen or space moved. Each spaced form canonicalizes to the SAME display
  // string as its fused sibling (see CANONICAL), so recognition and the
  // known-skills set agree however the CV happens to spell it.
  'PMI-ACP', 'PMI ACP', 'PgMP', 'CAPM', 'PMBOK', 'PMP',
  'PRINCE2', 'PRINCE 2',
  'Certified Scrum Product Owner', 'Certified ScrumMaster', 'Certified Scrum Master', 'CSPO',
  'ITIL', 'COBIT', 'TOGAF',
  'Lean Six Sigma', 'Lean Six-Sigma', 'Six Sigma', 'Six-Sigma',
  'CISSP', 'CISM', 'CIPP',
  // DELIBERATELY OMITTED — 'CSM', and kept out on purpose after review (#2603).
  // It is a legitimate abbreviation for Certified ScrumMaster, but in job-ad
  // prose it far more often expands to Customer Success Manager, and the
  // collision lands hardest on exactly the people this vocabulary was added for:
  // program, product and delivery managers, whose postings are the ones that say
  // "part Customer Success Manager (CSM)". The fixture in
  // tests/skill-extract.test.mjs pins that sentence.
  //
  // The trade is asymmetric and runs the other way from the spellings above. A
  // missing alias costs a real credential ONCE, in a note the user can see and
  // correct. Admitting 'CSM' would mint a phantom certification gap out of every
  // customer-success posting the scanner touches, and "go get certified" for a
  // credential the role never asked for is advice with no fix attached.
  //
  // Both unambiguous spellings — 'Certified ScrumMaster' and 'Certified Scrum
  // Master' — are listed above and carry no such collision, so the credential is
  // still recognized whenever it is written out. CAPM and CIPP stay in for the
  // same reason: neither has an everyday expansion competing for the acronym.
  //
  // 'SAFe' is NOT here either — it is handled case-sensitively below, for the
  // same reason 'Go' is: 'safe' is an everyday English word.

  // ── Marketing / GTM / revenue operations (added 2026-08-30) ──────────────
  // The certification block above records that the vocabulary, not the scoring,
  // was the constraint for delivery and program managers. The same hole ran one
  // discipline further over: every token above this line is an engineering tool
  // or a delivery credential, so a marketing-operations candidate was
  // structurally invisible to the gap map.
  //
  // Measured on a real marketing-operations corpus: "ABM" was logged as an
  // explicit soft_gap in several linked reports — twice flagged in the report
  // text itself as a recurring gap — and never once reached the output. The
  // map's top-ranked entry was instead an observability vendor's name, matched
  // out of the provenance asides inside those very ABM sentences (a report
  // logging a recurring gap tends to cite the sibling companies where it was
  // logged before). The same blindness ran on the known-skills side: a
  // marketing cv.md yielded a known-skills set of FIVE, so almost nothing could
  // be excluded as already-held.
  //
  // Longest-first within each family, matching the 'React Native'-before-'React'
  // and 'Lean Six Sigma'-before-'Six Sigma' convention above.
  'Account-Based Marketing', 'Account Based Marketing', 'ABM',
  'Demand-Side Platform', 'Demand Side Platform', 'DSPs', 'DSP',
  // Only the MEDIA senses of "programmatic" — see the omission note below.
  'Programmatic Advertising', 'Programmatic Display', 'Programmatic Media',
  'Programmatic Buying',
  'Media Agency Management', 'Media Agencies', 'Media Agency',
  'Demand Generation', 'Demand Gen',
  'Marketing Automation', 'Marketing Operations',
  'Revenue Operations', 'RevOps',
  'Lifecycle Marketing', 'Growth Marketing', 'Product Marketing',
  'Partner Marketing', 'Performance Marketing', 'Field Marketing',
  'Content Marketing', 'Email Marketing',
  'Paid Media', 'Paid Social', 'Paid Search',
  'Conversion Rate Optimization',
  'Marketing Mix Modeling', 'Media Mix Modeling', 'Incrementality',
  'Lead Scoring', 'Marketing Attribution',
  // 'SEMrush' precedes 'SEM' by convention; the (?!\w) boundary already stops
  // 'SEM' from firing inside it, and the ordering keeps that independent of the
  // boundary rule.
  'SEMrush', 'SEO', 'SEM', 'PPC',
  // Platforms a marketing CV actually lists. These earn their place mostly on
  // the KNOWN side of the comparison: without them the known-skills set built
  // from a marketing cv.md cannot suppress anything the candidate already has.
  'HubSpot', 'Marketo', 'Pardot', 'Braze', 'Klaviyo', 'OneSignal', 'Intercom',
  'Ahrefs', 'Demandbase', '6sense', 'Google Tag Manager', 'Google Analytics',
  'Google Ads', 'GA4', 'Amplitude', 'Mixpanel', 'n8n', 'Zapier',
  //
  // DELIBERATELY OMITTED from this block, on the same asymmetry the 'CSM' note
  // above sets out — a missing token costs a real skill once, visibly, while a
  // colliding one mints a phantom gap out of ordinary prose on every posting:
  //
  //   'CRO'          — Conversion Rate Optimization in marketing copy, Chief
  //                    Revenue Officer in the org chart, and GTM postings are
  //                    full of the second ("reports to the CRO"). The spelled-out
  //                    'Conversion Rate Optimization' is listed instead.
  //   'GEO'          — Generative Engine Optimization in AI-search work, and
  //                    "geography" everywhere else, including the location prose
  //                    in most postings ("the EMEA geo").
  //   'Programmatic' — bare, it is an everyday engineering adjective
  //                    ("programmatic access to the API"). Only the media senses
  //                    are listed above; each canonicalizes to 'Programmatic',
  //                    so the display name survives without the collision.
  //   'Segment'      — the CDP, but "segment" is an everyday noun in exactly the
  //                    prose this block was added to read.
  //   'Iterable'     — the ESP, but this module is shared with jd-skill-gap,
  //                    which runs over full engineering JDs where "iterable" is
  //                    a language term.
  //   'MOps'/'MMM'   — abbreviations whose expansions are already listed and
  //                    whose bare forms read as noise ("mops", "mmm").
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
  // Alternate spellings of the SAME credential, each mapping to the display
  // form its fused sibling already uses. This is the half that makes the token
  // additions count: without it 'Certified Scrum Master' extracts as its own
  // string, never matches the known-skills set built from a CV that wrote it
  // 'Certified ScrumMaster', and the credential is reported as a gap the user
  // already holds. Aliasing to one display string is what collapses them.
  'certified scrum master': 'Certified ScrumMaster',
  'certified scrum product owner': 'CSPO',
  'pmi acp': 'PMI-ACP',
  'prince 2': 'PRINCE2',
  'lean six-sigma': 'Lean Six Sigma',
  'six-sigma': 'Six Sigma',
  // Marketing / GTM (2026-08-30). Only ALTERNATE spellings need an entry —
  // DISPLAY already resolves a token to its own casing ('abm' -> 'ABM'), so a
  // single-spelling token like 'HubSpot' needs nothing here. What must be
  // aliased is every way the same skill gets written, because the known-skills
  // set is built from the CV's spelling and the gap map from the report's, and
  // the two only cancel if both collapse to one display form.
  'account-based marketing': 'ABM', 'account based marketing': 'ABM',
  'demand-side platform': 'DSP', 'demand side platform': 'DSP', 'dsps': 'DSP',
  // Every media sense of "programmatic" lands on one display name, so the gap
  // map does not split one competency across four rows.
  'programmatic advertising': 'Programmatic',
  'programmatic display': 'Programmatic',
  'programmatic media': 'Programmatic',
  'programmatic buying': 'Programmatic',
  // "Lead relationships with media agencies" and "media agency management" are
  // the same competency in gap prose; splitting them would halve the count of a
  // gap that is already only named a handful of times.
  'media agency management': 'Media Agency Management',
  'media agencies': 'Media Agency Management',
  'media agency': 'Media Agency Management',
  'demand gen': 'Demand Generation',
  'revenue operations': 'RevOps',
  'marketing mix modeling': 'Media Mix Modeling',
  //
  // NOT aliased, deliberately, and the most consequential line in this block:
  // 'demandbase' does NOT map to 'ABM'. Demandbase is an ABM PLATFORM, and
  // holding a seat in it is not owning an ABM program — the corpus this block
  // was built from makes that distinction explicitly, in report after report,
  // because it is the difference between a defensible CV claim and an
  // indefensible one.
  // Aliasing the tool to the discipline would put ABM into the known-skills set
  // of anyone whose CV lists the tool, suppressing the exact gap this
  // vocabulary exists to surface — and it would read as "no gap found", which
  // is strictly worse than the silence being fixed. Same rule as the
  // no-umbrella-aliases policy above: "cloud" must never count as knowing AWS.
  //
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
