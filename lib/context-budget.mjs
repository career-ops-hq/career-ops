/**
 * context-budget.mjs — Token budget management for career-ops evaluators
 *
 * Provides lightweight token estimation and priority-based compression of
 * _shared.md context sections. Keeps evaluation-critical sections (P0:
 * scoring, archetypes, legitimacy, global rules) intact while trimming
 * generation-oriented sections (P2: voice DNA, writing style, ATS rules)
 * when the prompt approaches the model's context limit.
 *
 * Zero external dependencies — uses character-based estimation (~4 chars/token
 * for English text) with a safety margin to stay within model context windows.
 */

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Estimate the number of tokens in a text string.
 *
 * Uses a simple character-based heuristic: effective characters ÷ 4.
 * Whitespace is collapsed before counting. This is ~12% accurate for English
 * prose, which is sufficient when combined with a safety margin.
 *
 * @param {string} text - The text to estimate tokens for.
 * @returns {number} Estimated token count (always ≥ 0).
 */
export function estimateTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  // Collapse whitespace (tokens aren't sensitive to repeated spaces/newlines)
  const effectiveChars = text.replace(/\s+/g, ' ').length;
  return Math.ceil(effectiveChars / 4);
}

// ---------------------------------------------------------------------------
// Section priority classification
// ---------------------------------------------------------------------------

/**
 * Priority map for _shared.md sections.
 *
 * P0 (never compress): Scoring System, Archetype Detection, Posting Legitimacy,
 *   Global Rules — these directly determine evaluation quality.
 * P1 (compress when budget tight): Company Type taxonomy, Spend Tier routing —
 *   useful but the model often has this knowledge baked in.
 * P2 (prefer to compress): Voice DNA, Writing Style Calibration, Professional
 *   Writing & ATS, Sources of Truth — these serve text generation, not scoring.
 *
 * Sections not listed default to P2 (safe to compress).
 *
 * Keys are lowercase for case-insensitive matching against `## Section Name` headers.
 *
 * @type {Record<string, number>}
 */
export const SECTION_PRIORITY = {
  // P0 — evaluation-critical (never compress)
  'scoring system': 0,
  'archetype detection': 0,
  'posting legitimacy': 0,
  'global rules': 0,

  // P1 — useful but non-critical (compress when budget tight)
  'company type and compensation reliability': 1,
  'spend tier': 1,

  // P2 — generation-oriented (prefer to compress)
  'sources of truth': 2,
  'voice dna': 2,
  'writing style calibration': 2,
  'writing style': 2,
  'professional writing & ats compatibility': 2,
};

/**
 * Default priority for sections not explicitly listed in SECTION_PRIORITY.
 * Conservative: unknown sections are treated as safe to compress (P2).
 *
 * @type {number}
 */
export const DEFAULT_PRIORITY = 2;

// ---------------------------------------------------------------------------
// Context budget defaults
// ---------------------------------------------------------------------------

/**
 * Default maximum prompt tokens (GPT-4o-mini context window).
 * @type {number}
 */
export const DEFAULT_MAX_TOKENS = 128000;

/**
 * Safety margin reserved for the model's maxOutputTokens / response.
 * @type {number}
 */
export const DEFAULT_SAFETY_MARGIN = 8192;

// ---------------------------------------------------------------------------
// Section parsing helpers
// ---------------------------------------------------------------------------

/**
 * Split _shared.md into an array of { name, content } section objects.
 *
 * Sections are delimited by `## Section Name` headers. Content before the
 * first `## ` header is treated as a preamble (name = '').
 *
 * @param {string} sharedContent - Raw _shared.md content.
 * @returns {Array<{ name: string, content: string }>}
 */
function parseSections(sharedContent) {
  const sections = [];
  // Split on `## ` at line start, capturing the header text.
  // Parts[0] = preamble, then [header1, body1, header2, body2, ...]
  const parts = sharedContent.split(/^## (.+)$/gm);

  if (parts[0] && parts[0].trim()) {
    sections.push({ name: '', content: parts[0] });
  }

  for (let i = 1; i < parts.length; i += 2) {
    const name = (parts[i] || '').trim();
    const body = parts[i + 1] || '';
    if (name) {
      sections.push({ name, content: `## ${name}${body}` });
    }
  }

  return sections;
}

/** @type {Set<string>} Tracks already-warned section names to avoid log spam. */
const _warnedSections = new Set();

/**
 * Look up the priority of a section by its header name.
 *
 * Emits a warning when a section falls through to DEFAULT_PRIORITY so drift
 * between _shared.md headings and SECTION_PRIORITY is observable.
 *
 * @param {string} sectionName - The section header text (e.g., "Scoring System").
 * @returns {number} 0 (P0), 1 (P1), or 2 (P2 / default).
 */
function getPriority(sectionName) {
  const key = sectionName.toLowerCase()
    // Strip parenthetical suffixes like "(Block G)" or "(writing guardrail)"
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!(key in SECTION_PRIORITY) && !_warnedSections.has(key)) {
    _warnedSections.add(key);
    console.warn(`⚠️  Unrecognized _shared.md section "${sectionName}" → defaulting to P${DEFAULT_PRIORITY} (compressible). Update SECTION_PRIORITY in lib/context-budget.mjs if this section is evaluation-critical.`);
  }
  return SECTION_PRIORITY[key] ?? DEFAULT_PRIORITY;
}

// ---------------------------------------------------------------------------
// Compression
// ---------------------------------------------------------------------------

/**
 * Compress _shared.md content by removing lower-priority sections.
 *
 * Sections are identified by `## Section Name` headers and removed in
 * priority order (P2 first, then P1) until the target token reduction
 * is met or no more removable sections remain.
 *
 * P0 sections (scoring, archetypes, legitimacy, global rules) are never removed.
 *
 * @param {string} sharedContent - Raw _shared.md content.
 * @param {number} targetReduction - Target number of tokens to remove.
 * @returns {{ compressed: string, removed: string[] }}
 *   compressed — the content with sections removed.
 *   removed — list of section names that were removed.
 */
export function compressSharedContext(sharedContent, targetReduction) {
  if (!sharedContent || targetReduction <= 0) {
    return { compressed: sharedContent || '', removed: [] };
  }

  const sections = parseSections(sharedContent);
  if (sections.length === 0) {
    return { compressed: sharedContent, removed: [] };
  }

  // Classify each section
  const classified = sections.map(s => ({
    ...s,
    priority: s.name ? getPriority(s.name) : -1, // preamble: never remove
    tokens: estimateTokens(s.content),
  }));

  // Collect removable sections (P2 first, then P1), sorted by priority descending (2 before 1)
  const removable = classified
    .filter(s => s.priority >= 1)
    .sort((a, b) => b.priority - a.priority); // P2 before P1

  let tokensRemoved = 0;
  const removed = [];

  for (const section of removable) {
    if (tokensRemoved >= targetReduction) break;
    tokensRemoved += section.tokens;
    removed.push(section.name);
  }

  // Build compressed output: keep sections not in the removed set
  const removedSet = new Set(removed);
  const compressed = classified
    .filter(s => !removedSet.has(s.name))
    .map(s => s.content)
    .join('');

  return { compressed, removed };
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

/**
 * Build a token-budgeted context body for job offer evaluation.
 *
 * Assembles the context sections from _shared.md, oferta.md, cv.md, and
 * optional profile files. If the total estimated tokens exceed the available
 * budget, lower-priority sections of _shared.md are compressed.
 *
 * The returned `contextBody` is inserted between the evaluator's header
 * and operating rules — each evaluator (Gemini, OpenAI) keeps its own
 * framing text.
 *
 * @param {object} opts
 * @param {string} opts.sharedContent   - Raw _shared.md content.
 * @param {string} opts.ofertaContent   - Raw oferta.md content (evaluation mode).
 * @param {string} opts.cvContent       - Raw cv.md content (candidate resume).
 * @param {string} [opts.profileYml]    - Raw profile.yml content (optional).
 * @param {string} [opts.profileContent] - Raw _profile.md content (optional).
 * @param {string} opts.jdText          - The job description text to evaluate.
 * @param {number} [opts.maxTokens]     - Model context window (default 128000).
 * @param {number} [opts.safetyMargin]  - Reserved for output tokens (default 8192).
 * @param {boolean} [opts.noCompress]   - If true, skip compression entirely.
 * @returns {{ contextBody: string, budgetReport: object }}
 *   contextBody — the assembled context sections string.
 *   budgetReport — { totalTokens, budget, compressed, removed, beforeTokens,
 *     afterTokens, overBudget }.
 */
export function buildBudgetedPrompt(opts) {
  const {
    sharedContent = '',
    ofertaContent = '',
    cvContent = '',
    profileYml = '',
    profileContent = '',
    jdText = '',
    maxTokens = DEFAULT_MAX_TOKENS,
    safetyMargin = DEFAULT_SAFETY_MARGIN,
    noCompress = false,
  } = opts;

  const budget = maxTokens - safetyMargin;

  // Build the ordered section list (matches the evaluator prompt structure)
  const sectionDefs = [
    { name: '_shared.md', content: sharedContent, compressible: true },
    { name: 'oferta.md', content: ofertaContent, compressible: false },
    { name: 'cv.md', content: cvContent, compressible: false },
  ];

  if (profileYml) {
    sectionDefs.push({ name: 'profile.yml', content: profileYml, compressible: false });
  }
  if (profileContent) {
    sectionDefs.push({ name: '_profile.md', content: profileContent, compressible: false });
  }

  // JD is always last and non-compressible
  sectionDefs.push({ name: 'JD', content: jdText, compressible: false });

  // Calculate per-section tokens
  const sections = sectionDefs.map(s => ({
    ...s,
    tokens: estimateTokens(s.content),
  }));

  const estimatedTotal = sections.reduce((sum, s) => sum + s.tokens, 0);

  // Build the budget report
  const report = {
    totalTokens: estimatedTotal,
    budget,
    compressed: false,
    removed: [],
    beforeTokens: estimatedTotal,
    afterTokens: estimatedTotal,
    overBudget: false,
  };

  // If under budget or compression disabled, assemble as-is
  if (estimatedTotal <= budget || noCompress) {
    report.overBudget = estimatedTotal > budget;
    const contextBody = assembleContext(sections.map(s => ({
      name: s.name,
      content: s.content,
    })));
    return { contextBody, budgetReport: report };
  }

  // Need to compress _shared.md
  const reductionNeeded = estimatedTotal - budget;
  const sharedSection = sections.find(s => s.name === '_shared.md');
  const { compressed, removed } = compressSharedContext(sharedSection.content, reductionNeeded);

  report.compressed = removed.length > 0;
  report.removed = removed;

  // Rebuild sections with compressed _shared.md
  const compressedSections = sections.map(s => {
    if (s.name === '_shared.md') {
      const compressedTokens = estimateTokens(compressed);
      return { ...s, content: compressed, tokens: compressedTokens };
    }
    return s;
  });

  report.afterTokens = compressedSections.reduce((sum, s) => sum + s.tokens, 0);
  report.overBudget = report.afterTokens > budget;

  const contextBody = assembleContext(compressedSections.map(s => ({
    name: s.name,
    content: s.content,
  })));

  return { contextBody, budgetReport: report };
}

// ---------------------------------------------------------------------------
// Internal: assemble context sections into the prompt body
// ---------------------------------------------------------------------------

/**
 * @param {Array<{ name: string, content: string }>} sections
 * @returns {string}
 */
function assembleContext(sections) {
  const labels = {
    '_shared.md':   'SYSTEM CONTEXT (_shared.md)',
    'oferta.md':    'EVALUATION MODE (oferta.md)',
    'cv.md':        'CANDIDATE RESUME (cv.md)',
    'profile.yml':  'CANDIDATE PROFILE & TARGETS (config/profile.yml)',
    '_profile.md':  'USER ARCHETYPES & NARRATIVE (_profile.md)',
    'JD':           'JOB DESCRIPTION',
  };

  const parts = [];
  for (const s of sections) {
    if (!s.content) continue;
    const label = labels[s.name] || s.name;
    parts.push(
      `═══════════════════════════════════════════════════════\n` +
      `${label}\n` +
      `═══════════════════════════════════════════════════════\n` +
      `${s.content}`
    );
  }

  return parts.join('\n\n');
}
