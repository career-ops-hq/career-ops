#!/usr/bin/env node
/**
 * interview-readiness.mjs — Zero-LLM Interview Topic Prioritizer for career-ops
 *
 * Reads `interview-prep/question-bank.md` (user layer — accumulated across
 * `interview/debrief`, `interview/practice`, and `interview/drill` sessions),
 * scores every topic in the technical topic taxonomy
 * (`templates/interview-topics.yml`, user-overridable at
 * `config/interview-topics.yml`) on how urgently it needs more prep, and
 * ranks the result. Deterministic and offline — no LLM call, so it can run
 * before every prep session as a cheap "what should I study next" signal.
 *
 * The taxonomy and the question-bank schema are separate, deliberately:
 * the taxonomy is system-owned and evolves independently of any one user's
 * question history, and question-bank.md stays free-form enough that a bare
 * legacy `- **Q:** ... 🔴` line (no metadata) still parses. See
 * templates/question-bank.template.md for the full entry format and its
 * binding backward-compatibility constraint with weekly-digest.mjs's
 * extractGapsByCompany() — question entries must never use `###`
 * sub-headings, or a heading between the company heading and the question
 * clears company attribution there too.
 *
 * Scoring is a weighted blend of four signals, each in [0, 1]:
 *   - weakness:   how often this topic's own tracked history skewed toward
 *                 gaps rather than solid/strong answers
 *   - staleness:  how long since this topic was last asked or practiced
 *   - demand:     whether the current JD (if supplied) actually calls for it
 *   - confidence: the inverse of the user's own self-rated confidence
 * See the weight constants below for the exact formula and the reasoning
 * behind each weight.
 *
 * Run: node interview-readiness.mjs                     (JSON to stdout)
 *      node interview-readiness.mjs --summary            (human-readable table)
 *      node interview-readiness.mjs --top 10              (limit ranked topics, default 5)
 *      node interview-readiness.mjs --jd path/to/jd.md    (weight JD-demanded topics higher)
 *      node interview-readiness.mjs --file path/to/qb.md  (question-bank override; test isolation)
 *      node interview-readiness.mjs --taxonomy path/to.yml (taxonomy override)
 *      node interview-readiness.mjs --self-test
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load as yamlLoad } from 'js-yaml';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { flagValue, validateFlags, safeIntFlag } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAREER_OPS = getCareerOpsRoot();

// Every data path is derived from getCareerOpsRoot(), never from __dirname
// directly — several sibling scripts hard-coded a path relative to the
// script's own location and silently read/wrote the WRONG tree once
// CAREER_OPS_ROOT/CAREER_OPS_DATA_DIR or the .career-ops-data marker file
// pointed the data root somewhere else. The taxonomy is the one exception:
// its SYSTEM default genuinely does live next to this script (it ships with
// the package), so that one path is __dirname-relative on purpose, with the
// user's own root checked first.
const DEFAULT_QUESTION_BANK_PATH = join(CAREER_OPS, 'interview-prep', 'question-bank.md');
const DEFAULT_TAXONOMY_PATH = existsSync(join(CAREER_OPS, 'config', 'interview-topics.yml'))
  ? join(CAREER_OPS, 'config', 'interview-topics.yml')
  : join(__dirname, 'templates', 'interview-topics.yml');
// Reserved for a future cross-check against interview-prep/sessions/*.md
// (weekly-digest.mjs already rolls those up); not read by this script yet,
// declared here so the default lives in one place when that lands.
const DEFAULT_SESSIONS_DIR = join(CAREER_OPS, 'interview-prep', 'sessions');

// ── Scoring weights ─────────────────────────────────────────────────
//
// Each weight is named and justified independently — a future change to one
// should be a deliberate, reviewable edit to a single named constant, not a
// buried literal inside the formula.

// Weakness gets the largest weight: a topic with a real track record of
// gaps is the single strongest signal that more prep is needed RIGHT NOW —
// stronger than staleness or JD demand, both of which are proxies for risk
// rather than direct evidence of it.
export const W_WEAKNESS = 0.40;
// Staleness is the second-largest weight: even a topic once mastered decays
// without practice, and a stale strong answer is a real interview risk —
// but it is still a proxy (time passing is not the same as forgetting), so
// it sits below weakness.
export const W_STALENESS = 0.25;
// Demand is deliberately below staleness: a JD keyword match is a coarse
// signal (substring matching, no semantic understanding) and should nudge
// the ranking, not dominate it.
export const W_DEMAND = 0.20;
// Confidence gets the smallest weight because it is self-reported and the
// most subjective of the four — useful as a tiebreaker-ish nudge, not as a
// primary driver.
export const W_CONFIDENCE = 0.15;

// A topic not practiced or asked in 60+ days is treated as maximally stale
// (staleness caps at 1.0). Two months roughly matches the cadence of a
// typical active job search's interview loop — long enough that forgetting
// is a real risk, short enough to still be actionable.
export const STALENESS_HORIZON_DAYS = 60;

// A JD-unmatched topic is not assumed irrelevant (demand 0) — nothing reads
// every JD verbatim into this tool, and a topic that is not named in THIS
// JD may still come up in a live interview. 0.4 keeps it a meaningful but
// clearly secondary signal relative to an explicit match (1.0).
export const DEMAND_BASELINE = 0.4;

// A topic with no confidence self-rating at all is treated as moderately
// (not maximally) under-confident: 1 - 0.6 = 0.4 mean-confidence-equivalent,
// slightly below the taxonomy's own midpoint (2.5/5) — absence of a rating
// is itself a small negative signal (the user never got around to rating
// it), without punishing it as hard as an explicit low score would.
const NO_CONFIDENCE_GAP = 0.6;

// A topic whose question-bank entries exist but carry NO status marker at all
// — the state `interview/drill` writes: questions generated from a JD, never
// yet answered out loud. This is NOT the same as `untested` (no entries at
// all), and it must not be scored as either extreme:
//
//   * counting them as 🔴 gaps fabricates a measured failure that never
//     happened, and inflates the topic above genuinely-failed ones;
//   * counting them at weakness 0 — what a `total`-based denominator did —
//     made an undrilled topic look as strong as one with a wall of ✅, so
//     drilling a topic and never answering it LOWERED its priority.
//
// Same reasoning as NO_CONFIDENCE_GAP above: absent evidence gets a
// moderately-weak placeholder, and `answeredCount` is emitted so no consumer
// has to guess whether the number was measured.
const NO_STATUS_WEAKNESS = 0.6;

const STATUS_EMOJI = [
  { emoji: '🔴', status: 'gap' },
  { emoji: '🟡', status: 'solid' },
  { emoji: '✅', status: 'strong' },
];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(s) {
  if (!ISO_DATE_RE.test(String(s || ''))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// ── question-bank.md parsing ─────────────────────────────────────────
//
// Format documented in templates/question-bank.template.md. Company is the
// nearest preceding heading of ANY level — unlike weekly-digest.mjs's
// extractGapsByCompany(), there is no known-company allowlist to filter
// against here, so every heading is taken at face value and simply resets
// attribution, matching the template's own stated rule ("a heading resets
// it").
//
// Exported so external tests (and weekly-digest's own cross-check fixture)
// can call this directly on a markdown string.
export function parseQuestionBank(content) {
  if (typeof content !== 'string') return [];

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const entries = [];
  let currentCompany = null;
  let current = null;

  const flush = () => {
    if (current) entries.push(current);
    current = null;
  };

  const HEADING_RE = /^#{1,6}\s+(.*)$/;
  const QUESTION_RE = /^-\s*\*\*Q:\*\*\s*(.*)$/;
  // Indented (leading whitespace) `- key: value` sub-bullet. Only matched
  // when a question entry is already open — an indented dash line before any
  // `- **Q:**` bullet has nothing to attach to and is ignored.
  const SUBFIELD_RE = /^\s+-\s*([A-Za-z]+)\s*:\s*(.*)$/;

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;

    const headingMatch = rawLine.match(HEADING_RE);
    if (headingMatch) {
      flush();
      currentCompany = headingMatch[1].trim() || null;
      continue;
    }

    const isIndented = /^\s/.test(rawLine);
    if (isIndented && current) {
      const subMatch = rawLine.match(SUBFIELD_RE);
      if (subMatch) {
        applyField(current, subMatch[1].toLowerCase(), subMatch[2].trim());
      }
      // An indented line that isn't a recognized `key: value` sub-bullet is
      // tolerated silently — free-text notes under a question are common and
      // must not break parsing.
      continue;
    }

    const qMatch = rawLine.match(QUESTION_RE);
    if (qMatch) {
      flush();
      const { question, status } = parseQuestionLine(qMatch[1]);
      current = {
        company: currentCompany,
        question,
        status,
        topic: null,
        domain: null,
        round: null,
        asked: null,
        practiced: null,
        attempts: null,
        confidence: null,
        gap: null,
        source: null,
      };
      continue;
    }

    // Any other top-level (non-indented) line — plain prose, a blank
    // separator already skipped above, etc. — closes out whatever entry was
    // open, so trailing free text after a question's metadata block never
    // gets mistaken for a new field.
    flush();
  }
  flush();

  return entries;
}

// Splits a `- **Q:**` line's remainder into the question text and its
// inline status emoji. The optional `— Status: <emoji> <label>` suffix
// (em dash or hyphen, case-insensitive "Status:") is stripped from the
// question text; the emoji anywhere on the line (not just inside that
// suffix) determines status, so `Status:` itself is not required — only the
// emoji is load-bearing, matching the brief's "no emoji -> unknown" rule.
function parseQuestionLine(rest) {
  let status = 'unknown';
  for (const { emoji, status: s } of STATUS_EMOJI) {
    if (rest.includes(emoji)) {
      status = s;
      break;
    }
  }

  const statusIdx = rest.search(/[—-]?\s*Status:/i);
  let question = statusIdx !== -1 ? rest.slice(0, statusIdx) : rest;
  question = question.replace(/[—-]\s*$/, '').trim();

  return { question, status };
}

// Applies one indented `key: value` sub-bullet to an in-progress entry.
// Every field is optional and independently tolerant of malformed input —
// a bad date or a non-integer attempts count just leaves that field null
// rather than aborting the whole entry (brief: "malformed dates (leave
// null)").
function applyField(entry, key, rawValue) {
  const value = rawValue.trim();
  switch (key) {
    case 'topic':
      entry.topic = value || null;
      entry.domain = value ? value.split('/')[0] : null;
      break;
    case 'round':
      entry.round = value || null;
      break;
    case 'asked':
      entry.asked = isValidIsoDate(value) ? value : null;
      break;
    case 'practiced':
      entry.practiced = isValidIsoDate(value) ? value : null;
      break;
    case 'attempts': {
      if (value === '') {
        entry.attempts = null;
        break;
      }
      const n = Number(value);
      entry.attempts = Number.isSafeInteger(n) && n >= 0 ? n : null;
      break;
    }
    case 'confidence': {
      if (value === '') {
        entry.confidence = null;
        break;
      }
      const n = Number(value);
      entry.confidence = Number.isSafeInteger(n) && n >= 0 && n <= 5 ? n : null;
      break;
    }
    case 'gap':
      entry.gap = value || null;
      break;
    case 'source':
      entry.source = value || null;
      break;
    default:
      // Unknown field name — forward-compatible with a future field this
      // version doesn't know about yet; ignored rather than rejected.
      break;
  }
}

// ── Taxonomy loading ─────────────────────────────────────────────────
//
// js-yaml is already a project dependency (used throughout the codebase —
// see tests/js-yaml-import-form.test.mjs, which enforces the namespace/named
// import form because js-yaml 5's ESM build has no default export), so this
// reuses it rather than hand-rolling a YAML parser for one file.
//
// Exported so tests can load a fixture taxonomy string directly.
export function loadTaxonomy(yamlText) {
  const parsed = yamlLoad(String(yamlText ?? ''));
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.domains)) {
    throw new Error('taxonomy YAML must be an object with a `domains` array');
  }

  if (parsed.version !== undefined && (!Number.isSafeInteger(parsed.version) || parsed.version < 1)) {
    throw new Error('taxonomy.version must be a positive integer when supplied');
  }

  const domainIds = new Set();
  const topicKeys = new Set();
  parsed.domains.forEach((domain, domainIndex) => {
    const domainPath = `taxonomy.domains[${domainIndex}]`;
    if (!domain || typeof domain !== 'object' || Array.isArray(domain)) {
      throw new Error(`${domainPath} must be an object`);
    }
    if (typeof domain.id !== 'string' || domain.id.trim() === '') {
      throw new Error(`${domainPath}.id must be a non-empty string`);
    }
    if (domain.id !== domain.id.trim()) {
      throw new Error(`${domainPath}.id must not have leading or trailing whitespace`);
    }
    if (domainIds.has(domain.id)) {
      throw new Error(`${domainPath}.id duplicates domain id ${JSON.stringify(domain.id)}`);
    }
    domainIds.add(domain.id);

    if (domain.aliases !== undefined && !Array.isArray(domain.aliases)) {
      throw new Error(`${domainPath}.aliases must be an array when supplied`);
    }
    (domain.aliases || []).forEach((alias, aliasIndex) => {
      if (typeof alias !== 'string') {
        throw new Error(`${domainPath}.aliases[${aliasIndex}] must be a string`);
      }
    });

    if (!Array.isArray(domain.topics)) {
      throw new Error(`${domainPath}.topics must be an array`);
    }
    const topicIds = new Set();
    domain.topics.forEach((topicId, topicIndex) => {
      const topicPath = `${domainPath}.topics[${topicIndex}]`;
      if (typeof topicId !== 'string' || topicId.trim() === '') {
        throw new Error(`${topicPath} must be a non-empty string`);
      }
      if (topicId !== topicId.trim()) {
        throw new Error(`${topicPath} must not have leading or trailing whitespace`);
      }
      if (topicIds.has(topicId)) {
        throw new Error(`${topicPath} duplicates topic id ${JSON.stringify(topicId)} within domain ${JSON.stringify(domain.id)}`);
      }
      topicIds.add(topicId);
      const key = `${domain.id}/${topicId}`;
      if (topicKeys.has(key)) {
        throw new Error(`${topicPath} produces duplicate topic key ${JSON.stringify(key)}`);
      }
      topicKeys.add(key);
    });
  });
  return parsed;
}

// ── Scoring ──────────────────────────────────────────────────────────

function parseIsoDateToUTCms(s) {
  if (!isValidIsoDate(s)) return null;
  const parsed = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

// Whole days between `dateStr` and `today` (a Date). Both sides are
// normalized to UTC midnight before subtracting, so the result is a clean
// integer day count regardless of the caller's local timezone or the time
// component `today` happens to carry.
function daysSince(dateStr, today) {
  const targetMs = parseIsoDateToUTCms(dateStr);
  if (targetMs == null) return null;
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((todayMs - targetMs) / 86400000);
}

// One short sentence naming the dominant weighted factor, so `--summary`
// output tells the user WHY a topic ranked where it did without them having
// to reverse-engineer the four numbers themselves.
function buildRationale({ weakness, staleness, demand, confidenceGap, untested, unanswered, gapCount }) {
  if (untested) {
    // Untested topics are ranked on demand alone (see scoreTopics) — the
    // other factors are placeholders standing in for absent data, not
    // measurements, so the rationale must not imply they were measured.
    return 'Untested — the JD calls for this and nothing has ever tested it.';
  }
  if (unanswered) {
    // Questions exist (a drill generated them) but none has a verdict yet, so
    // naming a weakness factor would report a placeholder as a measurement.
    return 'Drilled but never answered — questions are in the bank with no verdict yet.';
  }
  // The weakness factor leads whenever it is non-zero, which happens for a
  // recorded gap OR for merely-solid answers. Naming it "gaps outweigh..."
  // when gapCount is 0 reports a failure that never happened — and ready.md
  // relays this sentence to the candidate verbatim.
  const weaknessLabel = gapCount > 0
    ? 'a weak track record (gaps outweigh solid/strong answers)'
    : 'a track record of merely solid answers (nothing yet rated strong)';
  const factors = [
    { label: weaknessLabel, weighted: W_WEAKNESS * weakness },
    { label: 'staleness (not asked or practiced recently)', weighted: W_STALENESS * staleness },
    { label: 'high demand in the supplied JD', weighted: W_DEMAND * demand },
    { label: 'low self-rated confidence', weighted: W_CONFIDENCE * confidenceGap },
  ];
  factors.sort((a, b) => b.weighted - a.weighted);
  return `Prioritized mainly for ${factors[0].label}.`;
}

// Case-insensitive boundary-safe match of any domain alias, or any topic id
// with hyphens replaced by spaces, against the JD text. Boundaries are based
// on ASCII letters/digits rather than `\b`, so punctuation-bearing aliases
// such as `c++` still match while short aliases such as `go` and `rag` do not
// match inside `ongoing` or `storage`. No JD supplied -> every topic is
// jdMatched: false (brief).
// A domain alias match is intentionally domain-wide: aliases describe the
// domain as a whole (e.g. "transformer" for the llm domain), so a hit
// applies to every topic in that domain, not just one. Only the topic-id
// substring check below is specific to a single topic.
function containsJdTerm(jdTextLower, rawTerm) {
  const term = String(rawTerm).trim().toLowerCase();
  if (!term) return false;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const leftBoundary = /^[a-z0-9]/.test(term) ? '(^|[^a-z0-9])' : '';
  const rightBoundary = /[a-z0-9]$/.test(term) ? '(?=$|[^a-z0-9])' : '';
  return new RegExp(`${leftBoundary}${escaped}${rightBoundary}`, 'i').test(jdTextLower);
}

function isJdMatched(domain, topicId, jdTextLower) {
  if (!jdTextLower) return false;
  const aliases = Array.isArray(domain.aliases) ? domain.aliases : [];
  if (aliases.some((alias) => containsJdTerm(jdTextLower, alias))) return true;
  return containsJdTerm(jdTextLower, topicId.replace(/-/g, ' '));
}

/**
 * Scores every topic in `taxonomy` against the parsed question-bank
 * `entries`, per the formula documented on the weight constants above.
 *
 * A topic is only matched to entries whose `topic` field is exactly
 * `domain-id/topic-id` — a bare `domain-id` entry (topic unspecified) counts
 * toward the question bank's overall size but not toward any single topic's
 * score, since attributing it to every topic in the domain would inflate
 * every sibling topic's weakness/staleness off one imprecise entry.
 *
 * Evidence-backed topics (`totalQuestions > 0`) and untested topics
 * (`totalQuestions === 0`, only kept when JD-matched) are returned as two
 * SEPARATE lists rather than one merged ranking. Merging them was tried
 * first and was wrong: an untested, JD-matched topic maxes out weakness
 * (1.0, "no evidence" standing in for "assume the worst"), staleness (1.0,
 * "never touched"), and demand (1.0, JD match) simultaneously, so it
 * structurally out-scores any topic with a confirmed recent 🔴 — a topic
 * that was recently practiced necessarily has LOW staleness, so real
 * evidence of an unresolved gap could never outrank a total unknown. That
 * inverts the tool's purpose: a confirmed, still-red failure would never
 * surface in `--top 5`. Untested topics are therefore scored on the one
 * axis that actually discriminates them — demand — and are never
 * numerically compared against evidence-backed topics.
 *
 * @param {Array} entries - parseQuestionBank() output.
 * @param {{domains: Array}} taxonomy - loadTaxonomy() output.
 * @param {{jdText?: string, today?: Date|string}} [opts]
 * @returns {{topics: Array, untested: Array}} Two lists, each sorted
 *   priority DESC, then domain ASC, then topic ASC. `topics` holds every
 *   topic with at least one question-bank entry, scored by the full
 *   weighted formula. `untested` holds JD-demanded topics with zero
 *   entries, scored by demand alone (`weakness`/`staleness`/`confidenceGap`
 *   are `null` on these objects — placeholders, not measurements).
 */
export function scoreTopics(entries, taxonomy, opts = {}) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const domains = taxonomy && Array.isArray(taxonomy.domains) ? taxonomy.domains : [];
  const jdTextLower = typeof opts.jdText === 'string' ? opts.jdText.toLowerCase() : '';

  let today;
  if (opts.today instanceof Date && !Number.isNaN(opts.today.getTime())) {
    today = opts.today;
  } else if (typeof opts.today === 'string') {
    const parsed = new Date(opts.today);
    today = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  } else {
    today = new Date();
  }

  const topics = [];
  const untestedTopics = [];

  for (const domain of domains) {
    if (!domain || typeof domain.id !== 'string') continue;
    const domainTopics = Array.isArray(domain.topics) ? domain.topics : [];

    for (const topicId of domainTopics) {
      if (typeof topicId !== 'string') continue;
      const key = `${domain.id}/${topicId}`;
      const topicEntries = safeEntries.filter((e) => e && e.topic === key);

      const total = topicEntries.length;
      const jdMatched = isJdMatched(domain, topicId, jdTextLower);

      if (total === 0) {
        // Zero-entry, JD-unmatched topics carry no signal at all and are
        // dropped rather than reported at a meaningless baseline score.
        if (!jdMatched) continue;

        const demand = 1.0;
        const priority = Math.round(100 * demand);
        untestedTopics.push({
          domain: domain.id,
          topic: topicId,
          priority,
          weakness: null,
          staleness: null,
          demand,
          confidenceGap: null,
          untested: true,
          totalQuestions: 0,
          gapCount: 0,
          solidCount: 0,
          strongCount: 0,
          answeredCount: 0,
          unanswered: true,
          lastTouched: null,
          meanConfidence: null,
          rationale: buildRationale({ untested: true }),
        });
        continue;
      }

      const gapCount = topicEntries.filter((e) => e.status === 'gap').length;
      const solidCount = topicEntries.filter((e) => e.status === 'solid').length;
      const strongCount = topicEntries.filter((e) => e.status === 'strong').length;

      // Denominator is answeredCount, not `total`: an entry with no status
      // marker carries no verdict, so including it would dilute a real gap
      // (1 gap + 1 unanswered scored 0.5 instead of 1.0).
      const answeredCount = gapCount + solidCount + strongCount;
      const weakness = answeredCount === 0
        ? NO_STATUS_WEAKNESS
        : (2 * gapCount + solidCount) / (2 * answeredCount);

      const dates = topicEntries
        .flatMap((e) => [e.practiced, e.asked])
        .filter((date) => isValidIsoDate(date));
      const lastTouched = dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null;
      const elapsedDays = lastTouched == null ? null : daysSince(lastTouched, today);
      const staleness = elapsedDays == null || !Number.isFinite(elapsedDays)
        ? 1.0
        : Math.max(0, Math.min(1, elapsedDays / STALENESS_HORIZON_DAYS));

      const demand = jdMatched ? 1.0 : DEMAND_BASELINE;

      const confidenceValues = topicEntries
        .map((e) => e.confidence)
        .filter((c) => Number.isInteger(c) && c >= 0 && c <= 5);
      const meanConfidence = confidenceValues.length > 0
        ? confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length
        : null;
      const confidenceGap = meanConfidence == null ? NO_CONFIDENCE_GAP : 1 - (meanConfidence / 5);

      const priority = Math.round(
        100 * (
          W_WEAKNESS * weakness
          + W_STALENESS * staleness
          + W_DEMAND * demand
          + W_CONFIDENCE * confidenceGap
        ),
      );

      topics.push({
        domain: domain.id,
        topic: topicId,
        priority,
        weakness,
        staleness,
        demand,
        confidenceGap,
        untested: false,
        totalQuestions: total,
        gapCount,
        solidCount,
        strongCount,
        answeredCount,
        unanswered: answeredCount === 0,
        lastTouched,
        meanConfidence,
        rationale: buildRationale({ weakness, staleness, demand, confidenceGap, untested: false, unanswered: answeredCount === 0, gapCount }),
      });
    }
  }

  const byPriorityThenName = (a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
    return a.topic.localeCompare(b.topic);
  };
  topics.sort(byPriorityThenName);
  untestedTopics.sort(byPriorityThenName);

  // Orphan tags: entries whose `topic:` id is not in the taxonomy.
  //
  // Scoring walks the TAXONOMY, not the entries, so a question tagged with an id
  // that does not exist there is never scored, never counted, and never
  // mentioned -- it simply vanishes from the readiness loop. That is the most
  // likely mistake `interview/drill` makes: a plausible-but-wrong id
  // (`rag/evaluation` where the taxonomy says `rag/rag-evaluation`) reads fine to
  // a human and loses the question forever. Collect them so a consumer can say
  // so out loud. Reported only; never scored, never guessed into a real topic --
  // silently remapping a tag would invent an association the candidate never
  // made.
  const knownKeys = new Set();
  const knownDomainIds = new Set();
  for (const domain of domains) {
    if (!domain || typeof domain.id !== 'string') continue;
    const domainTopics = Array.isArray(domain.topics) ? domain.topics : [];
    knownDomainIds.add(domain.id);
    knownKeys.add(domain.id);
    for (const topicId of domainTopics) {
      if (typeof topicId === 'string') knownKeys.add(`${domain.id}/${topicId}`);
    }
  }
  const orphanCounts = new Map();
  for (const e of safeEntries) {
    if (!e || typeof e.topic !== 'string' || !e.topic) continue;
    if (knownKeys.has(e.topic)) continue;
    orphanCounts.set(e.topic, (orphanCounts.get(e.topic) || 0) + 1);
  }
  const orphanTopics = [...orphanCounts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => a.topic.localeCompare(b.topic));

  const summarizeUnscoredEntry = (entry) => ({
    question: typeof entry.question === 'string' ? entry.question : null,
    company: typeof entry.company === 'string' ? entry.company : null,
    topic: typeof entry.topic === 'string' && entry.topic ? entry.topic : null,
  });
  const unscoredQuestions = {
    missingTopic: safeEntries
      .filter((entry) => entry && (typeof entry.topic !== 'string' || entry.topic.trim() === ''))
      .map(summarizeUnscoredEntry),
    domainOnly: safeEntries
      .filter((entry) => entry && typeof entry.topic === 'string' && knownDomainIds.has(entry.topic))
      .map(summarizeUnscoredEntry),
  };

  return { topics, untested: untestedTopics, orphanTopics, unscoredQuestions };
}

// `--top N` truncation, shared by the CLI and the self-test so both apply
// the exact same slice semantics.
function applyTop(topics, n) {
  return Number.isFinite(n) && n >= 0 ? topics.slice(0, n) : topics;
}

// `--top N` for the UNTESTED list, which needs different truncation semantics.
//
// Every untested topic scores exactly 100 (priority there is `100 * demand`, and
// demand is 1.0 for all of them), so the comparator never separates them and the
// whole ordering falls through to the alphabetical domain tie-break. A plain
// slice(0, 5) then hands all five slots to whichever domain sorts first: a JD
// asking for both Postgres and RAG surfaced five `databases` topics and not one
// `rag` topic, so half of what the JD actually demanded was invisible at the
// default --top. Round-robin across domains instead, so the slice spans the
// demand the JD expressed rather than the alphabet.
function applyTopDiverse(topics, n) {
  if (!Number.isFinite(n) || n < 0) return topics;
  if (topics.length <= n) return topics;

  const byDomain = new Map();
  for (const t of topics) {
    if (!byDomain.has(t.domain)) byDomain.set(t.domain, []);
    byDomain.get(t.domain).push(t);
  }

  const picked = [];
  const queues = [...byDomain.values()];
  while (picked.length < n) {
    let tookOne = false;
    for (const q of queues) {
      if (picked.length >= n) break;
      if (q.length === 0) continue;
      picked.push(q.shift());
      tookOne = true;
    }
    if (!tookOne) break; // every queue drained — cannot reach n
  }

  // Re-sort the selection so display order stays canonical and deterministic;
  // the round-robin decides WHICH topics survive, never how they are listed.
  picked.sort((a, b) =>
    a.domain !== b.domain
      ? a.domain.localeCompare(b.domain)
      : a.topic.localeCompare(b.topic),
  );
  return picked;
}

// ── I/O helpers ──────────────────────────────────────────────────────

function loadQuestionBankFile(path) {
  if (!existsSync(path)) return { found: false, entries: [] };
  return { found: true, entries: parseQuestionBank(readFileSync(path, 'utf-8')) };
}

function loadTaxonomyFile(path) {
  const text = readFileSync(path, 'utf-8');
  return loadTaxonomy(text);
}

// ── Summary mode ─────────────────────────────────────────────────────

function printTopicTable(topics) {
  const header =
    '  '
    + 'Pri'.padEnd(5)
    + 'Domain'.padEnd(22)
    + 'Topic'.padEnd(28)
    + 'Gap/Solid/Strong'.padEnd(18)
    + 'Last touched';
  console.log(header);
  console.log('  ' + '-'.repeat(90));

  for (const t of topics) {
    const pri = String(t.priority).padEnd(5);
    const domain = t.domain.substring(0, 20).padEnd(22);
    const topic = t.topic.substring(0, 26).padEnd(28);
    const counts = `${t.gapCount}/${t.solidCount}/${t.strongCount}`.padEnd(18);
    const lastTouched = t.lastTouched || 'never';
    console.log('  ' + pri + domain + topic + counts + lastTouched);
    console.log(`      ↳ ${t.rationale}`);
  }
}

// Prints the evidence-backed table first (these are measured), then the
// untested list as a clearly separate, clearly labeled secondary section —
// a reader must never be able to confuse "measured weakness" with "we have
// no data at all". If there are no untested topics, that section is
// omitted entirely rather than printing an empty heading.
function printSummary(
  { topics, untested, orphanTopics = [], unscoredQuestions = { missingTopic: [], domainOnly: [] } },
  { questionBankFound, questionBankPath, totalTopics = topics.length, totalUntested = untested.length },
) {
  const unscoredCount = unscoredQuestions.missingTopic.length + unscoredQuestions.domainOnly.length;
  console.log(`\n${'='.repeat(78)}`);
  console.log('  Interview Readiness — career-ops');
  console.log(
    `  ranked topics: ${topics.length} returned / ${totalTopics} total`
    + (totalUntested > 0 ? `, untested: ${untested.length} returned / ${totalUntested} total` : ''),
  );
  console.log(`${'='.repeat(78)}\n`);

  if (!questionBankFound) {
    console.log(`  No question bank yet at ${questionBankPath}.`);
    console.log('  Run interview/debrief or interview/drill to start tracking measured topics.\n');
  }

  if (totalTopics === 0 && totalUntested === 0 && orphanTopics.length === 0 && unscoredCount === 0) {
    console.log('  Nothing to rank yet — no tracked topics, and no JD-matched gaps found.\n');
    return;
  }

  if (topics.length > 0) {
    console.log('  Measured — from your tracked question-bank history:\n');
    printTopicTable(topics);
    console.log('');
  }

  if (untested.length > 0) {
    console.log('  Not yet tested — the JD asks for these and your question bank has no record of them:\n');
    printTopicTable(untested);
    console.log('');
  }

  if (orphanTopics.length > 0) {
    const n = orphanTopics.reduce((sum, o) => sum + o.count, 0);
    console.log(`  ⚠ ${n} question${n === 1 ? ' carries' : 's carry'} a topic tag that is not in the taxonomy,`);
    console.log(`  so ${n === 1 ? 'it is' : 'they are'} invisible to this ranking. Fix the tag in your question bank:\n`);
    for (const o of orphanTopics) {
      console.log(`    ${o.topic}  (${o.count} question${o.count === 1 ? '' : 's'})`);
    }
    console.log('');
  }

  if (unscoredCount > 0) {
    console.log(`  ⚠ ${unscoredCount} question${unscoredCount === 1 ? ' is' : 's are'} not scored because the topic metadata is incomplete:\n`);
    const printUnscoredGroup = (label, entries) => {
      if (entries.length === 0) return;
      console.log(`    ${label} (${entries.length}):`);
      for (const entry of entries) {
        const company = entry.company ? ` — ${entry.company}` : '';
        console.log(`      - ${entry.question || '(question text unavailable)'}${company}`);
      }
    };
    printUnscoredGroup('Missing topic', unscoredQuestions.missingTopic);
    printUnscoredGroup('Domain-only topic', unscoredQuestions.domainOnly);
    console.log('');
  }
}

// ── Self-test ────────────────────────────────────────────────────────

function runSelfTest() {
  let pass = 0;
  let fail = 0;
  const check = (cond, label) => {
    if (cond) { pass += 1; } else { fail += 1; console.error(`  FAIL: ${label}`); }
  };

  // 1. legacy bare `- **Q:**` line parses with company attribution
  const legacyMd = [
    '## Acme Corp',
    '',
    '- **Q:** How would you shard a write-heavy Postgres table? Status: 🔴 Gap',
  ].join('\n');
  const legacyEntries = parseQuestionBank(legacyMd);
  check(legacyEntries.length === 1, 'legacy bare line parses into exactly one entry');
  if (legacyEntries.length === 1) {
    check(legacyEntries[0].company === 'Acme Corp', 'legacy entry attributed to Acme Corp');
    check(legacyEntries[0].status === 'gap', 'legacy entry status is gap');
    check(legacyEntries[0].topic === null, 'legacy entry has no topic (no sub-bullets)');
  }

  // 2. structured entry parses all sub-bullets
  const structuredMd = [
    '## Acme Corp',
    '',
    '- **Q:** How would you shard a write-heavy Postgres table? — Status: 🔴 Gap',
    '  - topic: databases/indexing-partitioning',
    '  - round: technical',
    '  - asked: 2026-08-20',
    '  - practiced: 2026-08-25',
    '  - attempts: 3',
    '  - confidence: 2',
    '  - gap: no precise vocabulary for partition pruning',
    '  - source: debrief',
  ].join('\n');
  const structuredEntries = parseQuestionBank(structuredMd);
  check(structuredEntries.length === 1, 'structured entry parses into exactly one entry');
  if (structuredEntries.length === 1) {
    const e = structuredEntries[0];
    check(e.topic === 'databases/indexing-partitioning', 'topic sub-bullet parsed');
    check(e.domain === 'databases', 'domain derived from topic');
    check(e.round === 'technical', 'round sub-bullet parsed');
    check(e.asked === '2026-08-20', 'asked sub-bullet parsed');
    check(e.practiced === '2026-08-25', 'practiced sub-bullet parsed');
    check(e.attempts === 3, 'attempts sub-bullet parsed as integer');
    check(e.confidence === 2, 'confidence sub-bullet parsed as integer');
    check(e.gap === 'no precise vocabulary for partition pruning', 'gap sub-bullet parsed');
    check(e.source === 'debrief', 'source sub-bullet parsed');
  }

  // 3. a heading between company and question resets company
  const resetMd = [
    '## Acme Corp',
    '### Round 1',
    '- **Q:** Explain CAP theorem. Status: 🟡 Solid',
  ].join('\n');
  const resetEntries = parseQuestionBank(resetMd);
  check(resetEntries.length === 1, 'question after a sub-heading still parses');
  if (resetEntries.length === 1) {
    check(resetEntries[0].company === 'Round 1', 'sub-heading resets company attribution (documented, binding constraint)');
  }

  // 4. CRLF input
  const crlfMd = '## Beta Inc\r\n\r\n- **Q:** What is a hash table? Status: ✅ Strong\r\n';
  const crlfEntries = parseQuestionBank(crlfMd);
  check(crlfEntries.length === 1, 'CRLF input parses');
  if (crlfEntries.length === 1) {
    check(crlfEntries[0].company === 'Beta Inc', 'CRLF entry company attribution correct');
    check(crlfEntries[0].status === 'strong', 'CRLF entry status correct');
  }

  // 5. parseQuestionBank(null) / non-string input returns []
  check(Array.isArray(parseQuestionBank(null)) && parseQuestionBank(null).length === 0, 'parseQuestionBank(null) returns []');
  check(Array.isArray(parseQuestionBank(42)) && parseQuestionBank(42).length === 0, 'parseQuestionBank(non-string) returns []');
  check(parseQuestionBank('').length === 0, 'parseQuestionBank(empty string) returns []');

  // 6. weakness math on a known fixture (2 gaps, 1 solid, 1 strong -> weakness = (2*2+1)/(2*4) = 0.625)
  const fixtureTaxonomy = {
    domains: [{ id: 'databases', label: 'Databases', aliases: ['sql'], topics: ['indexing-partitioning'] }],
  };
  const fixtureEntries = [
    { topic: 'databases/indexing-partitioning', status: 'gap', asked: '2026-08-01', practiced: null, confidence: 2 },
    { topic: 'databases/indexing-partitioning', status: 'gap', asked: '2026-08-01', practiced: null, confidence: 1 },
    { topic: 'databases/indexing-partitioning', status: 'solid', asked: '2026-08-01', practiced: null, confidence: 3 },
    { topic: 'databases/indexing-partitioning', status: 'strong', asked: '2026-08-01', practiced: null, confidence: 4 },
  ];
  const weaknessScored = scoreTopics(fixtureEntries, fixtureTaxonomy, { today: new Date('2026-08-01T00:00:00Z') }).topics;
  check(weaknessScored.length === 1, 'weakness fixture scores exactly one topic');
  if (weaknessScored.length === 1) {
    check(Math.abs(weaknessScored[0].weakness - 0.625) < 1e-9, `weakness math correct (got ${weaknessScored[0].weakness})`);
    check(weaknessScored[0].totalQuestions === 4, 'weakness fixture totalQuestions is 4');
    check(weaknessScored[0].gapCount === 2 && weaknessScored[0].solidCount === 1 && weaknessScored[0].strongCount === 1, 'status counts correct');
  }

  // 7. staleness at 0 / 30 / 90 days / never-touched
  const stalenessTaxonomy = {
    domains: [{ id: 'algorithms', label: 'Algorithms', aliases: [], topics: ['hashing'] }],
  };
  const today = new Date('2026-08-31T00:00:00Z');
  const stalenessCase = (asked) => scoreTopics(
    [{ topic: 'algorithms/hashing', status: 'solid', asked, practiced: null, confidence: 3 }],
    stalenessTaxonomy,
    { today },
  ).topics[0];
  check(stalenessCase('2026-08-31').staleness === 0, 'staleness at 0 days is 0');
  check(Math.abs(stalenessCase('2026-08-01').staleness - 30 / 60) < 1e-9, 'staleness at 30 days is 0.5');
  check(stalenessCase('2026-06-02').staleness === 1, 'staleness at 90 days caps at 1');
  const neverTouched = scoreTopics(
    [{ topic: 'algorithms/hashing', status: 'gap', asked: null, practiced: null, confidence: null }],
    stalenessTaxonomy,
    { today },
  ).topics[0];
  check(neverTouched.staleness === 1, 'staleness with no asked/practiced date is 1 (never-touched)');

  // 8. JD alias matching pulls in an untested topic, in the SEPARATE
  // `untested` list. A domain-level alias match applies to every topic in
  // that domain (aliases are declared per domain, not per topic) — only a
  // topic-id substring match is specific to one topic. A sibling domain
  // with no alias/id match at all stays excluded.
  const jdTaxonomy = {
    domains: [
      { id: 'llm', label: 'LLM', aliases: ['transformer', 'large language model'], topics: ['transformer-internals', 'tokenization'] },
      { id: 'rag', label: 'RAG', aliases: ['retrieval augmented generation'], topics: ['chunking-strategies'] },
    ],
  };
  const jdScored = scoreTopics([], jdTaxonomy, { jdText: 'We use transformer models heavily.', today: new Date('2026-08-31T00:00:00Z') });
  check(jdScored.topics.length === 0, 'zero-entry topics never appear in the topics list, only in untested');
  check(jdScored.untested.some((t) => t.topic === 'transformer-internals' && t.untested === true), 'untested topic pulled in via domain alias match');
  check(jdScored.untested.some((t) => t.topic === 'tokenization'), 'sibling topic in the SAME domain is also pulled in by the domain-level alias match');
  check(!jdScored.untested.some((t) => t.topic === 'chunking-strategies'), 'topic in an unrelated domain with no alias/id match is NOT pulled in');
  check(jdScored.untested.every((t) => t.weakness === null && t.staleness === null && t.confidenceGap === null), 'untested topics carry null placeholders, not assumed measurements');
  const jdScoredById = scoreTopics([], jdTaxonomy, { jdText: 'strong tokenization pipeline experience required', today: new Date('2026-08-31T00:00:00Z') });
  check(jdScoredById.untested.some((t) => t.topic === 'tokenization'), 'untested topic pulled in via topic-id (hyphens-as-spaces) match');

  // 9. sorting is deterministic (priority DESC, then domain ASC, then topic ASC)
  const sortTaxonomy = {
    domains: [
      { id: 'zeta', label: 'Zeta', aliases: [], topics: ['topic-a', 'topic-b'] },
      { id: 'alpha', label: 'Alpha', aliases: [], topics: ['topic-a'] },
    ],
  };
  const sortEntries = [
    { topic: 'zeta/topic-a', status: 'gap', asked: '2026-01-01', practiced: null, confidence: 0 },
    { topic: 'zeta/topic-b', status: 'gap', asked: '2026-01-01', practiced: null, confidence: 0 },
    { topic: 'alpha/topic-a', status: 'gap', asked: '2026-01-01', practiced: null, confidence: 0 },
  ];
  const sorted = scoreTopics(sortEntries, sortTaxonomy, { today: new Date('2026-08-31T00:00:00Z') }).topics;
  check(sorted.length === 3, 'sort fixture scores all three topics');
  check(
    sorted[0].priority === sorted[1].priority && sorted[1].priority === sorted[2].priority,
    'sort fixture: all three topics tie on priority (isolates the tiebreakers)',
  );
  check(
    sorted[0].domain === 'alpha' && sorted[1].domain === 'zeta' && sorted[1].topic === 'topic-a' && sorted[2].topic === 'topic-b',
    'tied priority breaks by domain ASC then topic ASC',
  );

  // 10. --top truncation
  check(applyTop(sorted, 2).length === 2, '--top truncates to N');
  check(applyTop(sorted, 0).length === 0, '--top 0 truncates to empty');
  check(applyTop(sorted, 999).length === 3, '--top larger than the list returns the whole list');

  // 11. REGRESSION (pins the untested-outranks-evidence bug): a confirmed
  // recent 🔴 on a topic must appear in `topics`, scored on its own merits,
  // and must NOT be evicted from --top 5 by a flood of untested topics in
  // the same JD-matched domain. This assertion fails against the pre-fix
  // merged-ranking behavior, where untested topics (weakness=staleness=
  // demand=1.0) always out-scored a topic with real, recent evidence.
  const regressionTaxonomy = {
    domains: [
      {
        id: 'databases',
        label: 'Databases',
        aliases: ['postgres', 'sharding'],
        topics: [
          'schema-design', 'indexing-partitioning', 'query-optimization',
          'transactions-isolation', 'replication', 'database-selection',
        ],
      },
    ],
  };
  const regressionEntries = [
    { topic: 'databases/indexing-partitioning', status: 'gap', asked: null, practiced: '2026-08-25', confidence: 2 },
  ];
  const regressionScored = scoreTopics(regressionEntries, regressionTaxonomy, {
    jdText: 'We need strong Postgres sharding experience.',
    today: new Date('2026-08-31T00:00:00Z'),
  });
  const confirmedGap = regressionScored.topics.find((t) => t.topic === 'indexing-partitioning');
  check(!!confirmedGap, 'confirmed 🔴 topic appears in the topics list, not merged into untested');
  const top5 = applyTop(regressionScored.topics, 5);
  check(top5.some((t) => t.topic === 'indexing-partitioning'), 'confirmed recent 🔴 is NOT displaced out of --top 5 by untested topics');

  // 12. REGRESSION (pins the untested tie-break bug): every untested topic
  // ties at priority 100, so a plain slice awarded all --top slots to the
  // alphabetically-first domain. A JD naming two domains must surface both.
  const diverseTaxonomy = {
    domains: [
      {
        id: 'databases',
        label: 'Databases',
        aliases: ['postgres'],
        topics: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'],
      },
      {
        id: 'rag',
        label: 'RAG',
        aliases: ['retrieval'],
        topics: ['r1', 'r2'],
      },
    ],
  };
  const diverseScored = scoreTopics([], diverseTaxonomy, {
    jdText: 'Postgres and retrieval experience.',
    today: new Date('2026-08-31T00:00:00Z'),
  });
  check(
    applyTop(diverseScored.untested, 5).every((t) => t.domain === 'databases'),
    'sanity: plain --top truncation would show only the first domain (the bug)',
  );
  const diverseTop = applyTopDiverse(diverseScored.untested, 5);
  check(diverseTop.length === 5, 'diverse truncation still returns exactly N');
  check(
    diverseTop.some((t) => t.domain === 'rag'),
    'diverse truncation surfaces the second JD-matched domain within --top 5',
  );
  check(
    diverseTop.filter((t) => t.domain === 'rag').length === 2,
    'diverse truncation drains a small domain fully rather than capping it',
  );
  check(
    diverseTop.every((t, i, a) => i === 0 || a[i - 1].domain <= t.domain),
    'diverse truncation still displays in canonical domain order',
  );
  check(
    applyTopDiverse(diverseScored.untested, 999).length === diverseScored.untested.length,
    'diverse truncation larger than the list returns the whole list',
  );

  // 13. REGRESSION (pins the drilled-but-unanswered bug): `interview/drill`
  // writes questions with no status marker. Those entries must not be scored
  // as verdicts in either direction — not as gaps (a failure that never
  // happened) and not as weakness 0 (which made drilling a topic LOWER its
  // priority below an untouched one).
  const drillTaxonomy = {
    domains: [
      { id: 'rag', label: 'RAG', aliases: [], topics: ['chunking-strategies', 'reranking'] },
    ],
  };
  const drillToday = new Date('2026-08-31T00:00:00Z');
  const drilled = scoreTopics(
    [{ topic: 'rag/chunking-strategies', status: 'unknown', asked: null, practiced: null, confidence: null }],
    drillTaxonomy,
    { jdText: '', today: drillToday },
  ).topics.find((t) => t.topic === 'chunking-strategies');
  check(!!drilled, 'a drilled-but-unanswered topic is measured, not dropped');
  check(drilled.answeredCount === 0 && drilled.unanswered === true, 'unanswered topic reports answeredCount 0 and unanswered true');
  check(drilled.gapCount === 0, 'an unanswered entry is NOT counted as a gap');
  check(drilled.weakness === NO_STATUS_WEAKNESS, 'unanswered weakness uses the no-evidence placeholder, not a false zero');
  check(
    drilled.rationale.startsWith('Drilled but never answered'),
    'unanswered topic gets its own rationale instead of naming a placeholder factor',
  );

  // The denominator bug this shares a root with: an unanswered entry sitting
  // alongside a real 🔴 must not dilute it.
  const dilution = scoreTopics(
    [
      { topic: 'rag/reranking', status: 'gap', asked: null, practiced: null, confidence: null },
      { topic: 'rag/reranking', status: 'unknown', asked: null, practiced: null, confidence: null },
    ],
    drillTaxonomy,
    { jdText: '', today: drillToday },
  ).topics.find((t) => t.topic === 'reranking');
  check(dilution.weakness === 1, 'an unanswered entry does not dilute a confirmed gap on the same topic');
  check(dilution.answeredCount === 1 && dilution.totalQuestions === 2, 'answeredCount and totalQuestions are reported separately');

  // 14. Orphan topic tags: an entry tagged with an id absent from the taxonomy
  // is unscorable, and scoring walks the taxonomy, so it would otherwise vanish
  // without a trace. It must be reported, and must NOT be silently remapped to
  // the nearest real id.
  const orphanTaxonomy = {
    domains: [
      { id: 'rag', label: 'RAG', aliases: [], topics: ['rag-evaluation'] },
    ],
  };
  const orphanScored = scoreTopics(
    [
      // `rag/evaluation` is the plausible-but-wrong form of `rag/rag-evaluation`.
      { topic: 'rag/evaluation', status: 'unknown', asked: null, practiced: null, confidence: null },
      { topic: 'rag/evaluation', status: 'gap', asked: null, practiced: null, confidence: null },
      { topic: 'rag/rag-evaluation', status: 'gap', asked: null, practiced: null, confidence: null },
    ],
    orphanTaxonomy,
    { jdText: '', today: new Date('2026-08-31T00:00:00Z') },
  );
  check(orphanScored.orphanTopics.length === 1, 'exactly one distinct orphan tag is reported');
  check(
    orphanScored.orphanTopics[0].topic === 'rag/evaluation' && orphanScored.orphanTopics[0].count === 2,
    'orphan tag is reported verbatim with its entry count',
  );
  check(
    !orphanScored.topics.some((t) => t.topic === 'evaluation'),
    'an orphan tag is never scored as if it were a real topic',
  );
  const realTopic = orphanScored.topics.find((t) => t.topic === 'rag-evaluation');
  check(!!realTopic && realTopic.totalQuestions === 1, 'orphan entries are not folded into the similarly-named real topic');

  // A bank whose tags are all valid reports no orphans (no false positives).
  const cleanScored = scoreTopics(
    [{ topic: 'rag/rag-evaluation', status: 'gap', asked: null, practiced: null, confidence: null }],
    orphanTaxonomy,
    { jdText: '', today: new Date('2026-08-31T00:00:00Z') },
  );
  check(cleanScored.orphanTopics.length === 0, 'a fully-valid question bank reports zero orphan tags');

  // A bare domain-level tag is legal per the template's field rules, so it is
  // not an orphan even though it names no specific topic.
  const bareDomain = scoreTopics(
    [{ topic: 'rag', status: 'gap', asked: null, practiced: null, confidence: null }],
    orphanTaxonomy,
    { jdText: '', today: new Date('2026-08-31T00:00:00Z') },
  );
  check(bareDomain.orphanTopics.length === 0, 'a bare domain-id tag is valid, not an orphan');

  console.log(`\n  interview-readiness self-test: ${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

// ── CLI ──────────────────────────────────────────────────────────────

const KNOWN_FLAGS = ['--summary', '--top', '--jd', '--file', '--taxonomy', '--self-test', '--help', '-h'];
const VALUE_FLAGS = ['--top', '--jd', '--file', '--taxonomy'];

const USAGE = `Usage:
  node interview-readiness.mjs                        # JSON report
  node interview-readiness.mjs --summary               # human-readable table
  node interview-readiness.mjs --top <N>                # limit each list (measured, untested) to N (default 5 each)
  node interview-readiness.mjs --jd <path>              # weight JD-demanded topics higher
  node interview-readiness.mjs --file <path>            # question-bank.md override (test isolation)
  node interview-readiness.mjs --taxonomy <path>        # interview-topics.yml override
  node interview-readiness.mjs --self-test              # run the built-in fixtures
  node interview-readiness.mjs --help                   # show this message`;

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });

  if (args.includes('--self-test')) {
    runSelfTest();
  }

  const questionBankPath = flagValue(args, '--file') ?? DEFAULT_QUESTION_BANK_PATH;
  const taxonomyFlagValue = flagValue(args, '--taxonomy');
  const taxonomyPath = taxonomyFlagValue ?? DEFAULT_TAXONOMY_PATH;
  const jdPath = flagValue(args, '--jd');
  const top = safeIntFlag(flagValue(args, '--top'), 5);

  // An explicit --taxonomy path that doesn't exist is a usage mistake, not a
  // "nothing to rank" condition — unlike the question bank (whose absence is
  // the normal first-run state), there is no meaningful score without SOME
  // taxonomy, so this fails loudly rather than silently falling back.
  if (taxonomyFlagValue !== undefined && !existsSync(taxonomyPath)) {
    console.error(`Error: taxonomy file not found: ${taxonomyPath}`);
    process.exit(1);
  }

  let jdText;
  if (jdPath !== undefined) {
    if (!existsSync(jdPath)) {
      console.error(`Error: JD file not found: ${jdPath}`);
      process.exit(1);
    }
    jdText = readFileSync(jdPath, 'utf-8');
  }

  let taxonomy;
  try {
    taxonomy = loadTaxonomyFile(taxonomyPath);
  } catch (err) {
    console.error(`Error: could not parse taxonomy at ${taxonomyPath}: ${err.message}`);
    process.exit(1);
  }

  const { found: questionBankFound, entries } = loadQuestionBankFile(questionBankPath);
  const today = new Date();
  const allScored = scoreTopics(entries, taxonomy, { jdText, today });
  const topics = applyTop(allScored.topics, top);
  const untested = applyTopDiverse(allScored.untested, top);
  const orphanTopics = allScored.orphanTopics;
  const unscoredQuestions = allScored.unscoredQuestions;
  const unscoredEntryCount = Object.values(unscoredQuestions)
    .reduce((sum, group) => sum + group.length, 0);

  if (args.includes('--summary')) {
    printSummary(
      { topics, untested, orphanTopics, unscoredQuestions },
      {
        questionBankFound,
        questionBankPath,
        totalTopics: allScored.topics.length,
        totalUntested: allScored.untested.length,
      },
    );
  } else {
    console.log(JSON.stringify({
      metadata: {
        questionBankFound,
        taxonomySource: taxonomyPath,
        totalEntries: entries.length,
        totalTopics: allScored.topics.length,
        returnedTopics: topics.length,
        untestedCount: allScored.untested.length,
        returnedUntested: untested.length,
        orphanTopicCount: orphanTopics.length,
        unscoredEntryCount,
        jdProvided: jdPath !== undefined,
        today: today.toISOString().slice(0, 10),
      },
      topics,
      untested,
      orphanTopics,
      unscoredQuestions,
    }, null, 2));
  }
}
