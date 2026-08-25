#!/usr/bin/env node

/**
 * story-provenance-check.mjs — Zero-LLM story-bank provenance checker.
 *
 * Companion to jd-skill-gap.mjs (read that file first — this one deliberately
 * follows its shape: regex-based extraction, no LLM call, classify-and-report
 * only, never auto-edits the user's data files). Where jd-skill-gap.mjs
 * classifies JD *skills* against cv.md in three buckets (existing /
 * supportedByResume / gap), this script classifies *numeric claims found in
 * interview-prep/story-bank.md* against cv.md in FOUR buckets — the extra
 * state is the whole point of this checker (see "Why four buckets" below).
 *
 * ── Background (issue #2947) ─────────────────────────────────────────
 *
 * `cv.md` is user-authored. `story-bank.md` is *accumulated* — commonly
 * extracted from past interview-prep documents, which are themselves
 * AI-written mappings of the user's experience onto a specific job posting's
 * language. AGENTS.md used to say story-bank.md carries "the same trust
 * level as cv.md". It doesn't, in practice: nothing enforced that a
 * story-bank claim traces back to a user-authored file. That is the
 * unguarded channel this script exists to catch:
 *
 *   JD-shaped phrasing in a prep doc -> absorbed into story-bank.md as a
 *   standalone story -> treated as cv.md-equivalent fact -> surfaces in CV
 *   bullets, cover letters, and interview talk tracks -> drifts further on
 *   reuse.
 *
 * See AGENTS.md's "Source-of-Truth Boundary" section for the tiered file
 * list this script's classification exists to enforce.
 *
 * ── Why four buckets, not jd-skill-gap.mjs's three ────────────────────
 *
 * jd-skill-gap.mjs only ever asks "does cv.md have a trace of this or not" —
 * a binary trace/no-trace question is enough there because nothing is ever
 * auto-added to cv.md either way. This problem needs a state jd-skill-gap.mjs
 * has no equivalent for: not "no trace found (yet)" but "asked, and the user
 * genuinely could not confirm it". A binary verified/unverified flag can't
 * represent that — a scale figure from a job years ago may simply be
 * unknowable, and treating "I don't know" the same as "not yet checked"
 * invites a future re-scan (or a leading confirmation prompt) to silently
 * launder a guess into a "verified" fact. `user-cannot-confirm` is a durable
 * third state, distinct from `derived-unverified`, that must never decay
 * back into either "verified" or "not yet checked" through repetition.
 *
 *   existing            — the claim's number (or, for a range, both its
 *                          endpoints) appears in cv.md, OR the story-bank
 *                          entry's own Provenance field explicitly reads
 *                          `user-stated YYYY-MM-DD` (the user has already
 *                          confirmed this figure even though cv.md's prose
 *                          doesn't carry that precision — AGENTS.md's tiering
 *                          language allows a claim to satisfy this bar by
 *                          tracing to a primary file OR carrying an explicit
 *                          provenance marker, not only the former).
 *   supportedByResume    — the number itself isn't in cv.md, but cv.md's
 *                          prose describes the same underlying fact/role
 *                          closely enough (word-overlap heuristic) that the
 *                          claim reads as plausible-adjacent, just unverified
 *                          at this precision.
 *   derived-unverified    — the number appears ONLY in story-bank.md, has no
 *                          traceable cv.md support, and has not been
 *                          explicitly confirmed via the Provenance field.
 *   user-cannot-confirm    — the story-bank entry's Provenance field is
 *                          explicitly set to `user-cannot-confirm`. This is a
 *                          HARD override: it wins over whatever the numeric
 *                          heuristic would otherwise conclude, and it is
 *                          never silently reclassified back to
 *                          derived-unverified (or up to existing) on a later
 *                          run just because the same claim gets cited again.
 *                          See "Confirmation UX invariant" below.
 *
 * ── Provenance field convention (story-bank.md) ───────────────────────
 *
 * match-star.mjs's parser already reads story-bank.md as `### [Theme] Title`
 * blocks of `**Label:** value` lines (Situation / Task / Action / Result /
 * Reflection / Source / Best for questions about). A `**Source:**` field
 * already exists there for a different purpose (where the story itself came
 * from — e.g. a debrief transcript). This script introduces a SEPARATE label
 * for the same block shape, so it composes with the existing parser
 * convention instead of overloading a field that already means something
 * else:
 *
 *   **Provenance:** source: cv.md
 *   **Provenance:** user-stated 2026-08-10
 *   **Provenance:** derived-unverified
 *   **Provenance:** user-cannot-confirm
 *
 * Absent field == `derived-unverified` (the safe default: unmarked numeric
 * claims get no special trust). This script only READS the field — writing
 * it back is the explicit responsibility of a future confirmation workflow
 * (see next section), never this one.
 *
 * ── Confirmation UX invariant (DESIGN REQUIREMENT — read before building
 *    the consuming workflow) ───────────────────────────────────────────
 *
 * This script is read-only: it reports `derived-unverified` findings, it
 * does not resolve them. Building the interactive confirmation flow that
 * asks the user and writes the Provenance marker back to story-bank.md is
 * explicitly OUT OF SCOPE for this script (issue #2947) — but the contract
 * that flow MUST honor is documented here so a future implementer can't get
 * it wrong:
 *
 *   1. When a `derived-unverified` finding is surfaced to the user, the
 *      prompt must NOT lead with the unverified number as if confirm/deny
 *      were the only options. Leading with the number invites a guess, and a
 *      confirmed guess is worse than an honest unknown — it launders the
 *      guess into a "verified" fact.
 *   2. Present the claim plainly and offer FOUR distinct, unbiased outcomes:
 *        (a) confirm the claim is accurate as stated
 *        (b) provide the correct figure
 *        (c) mark it narrative-only / not a quantified claim
 *        (d) "I don't know" -> sets `user-cannot-confirm`, durably
 *   3. `user-cannot-confirm` must NEVER decay back into being treated as
 *      verified through repeated citation or a later re-scan. Every
 *      consumer of story-bank.md (CV generation, cover letters, interview
 *      prep) must treat a `user-cannot-confirm` entry as narrative texture
 *      only — never as a quantified claim in interview-facing output where a
 *      follow-up question would probe it. This script enforces the
 *      READ-side half of that invariant (the override always wins, see
 *      classifyStoryBank() below); the WRITE-side half (never re-prompting
 *      a `user-cannot-confirm` entry into a guess) belongs to that future
 *      workflow.
 *
 * ── Pattern coverage (what IS and ISN'T scanned) ──────────────────────
 *
 * Deliberately not exhaustive — matches jd-skill-gap.mjs's design stance
 * that under-extraction is recoverable (the user can still read the story)
 * while over-extraction would misreport narrative prose as a "claim". Five
 * patterns, each documented at its declaration below:
 *
 *   percent      \d+(\.\d+)?%                      "cut costs 40%"
 *   plus-noun     \d+\+\s+word                       "500+ employees"
 *   hour-range    N hours/hrs (→|->|to) M hours/hrs   "8 hours to 2 hours"
 *   scale-hyphen  \d+-(person|member)                 "15-person team"
 *   scale-noun    \d+ (students|employees|...)        "50 students"
 *
 * Known gaps (not covered, intentionally, to keep the pattern set legible
 * and low-noise — same tradeoff jd-skill-gap.mjs's SKILL_TOKEN_RE makes):
 *   - spelled-out numbers ("fifty students")
 *   - currency figures ("$40K budget") — verify-cv-facts.mjs already owns
 *     currency/metric-noun extraction for generated documents; this script
 *     stays scoped to story-bank.md's narrative shapes instead of
 *     duplicating that gate
 *   - non-ASCII digit scripts (verify-cv-facts.mjs's foldDigits() solves
 *     this for generated CVs; story-bank.md is authored in the profile's
 *     language, so this is a smaller gap here, but still a gap)
 *   - a bare number with no adjacent noun/unit ("trained 40 in Q1")
 *
 * Usage:
 *   node story-provenance-check.mjs
 *   node story-provenance-check.mjs --summary
 *   node story-provenance-check.mjs --story-bank path/to/file.md --cv path/to/cv.md
 *   node story-provenance-check.mjs --self-test
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { flagValue } from './lib/cli-flags.mjs';

// ── Config ──────────────────────────────────────────────────────────

const DEFAULT_STORY_BANK_PATH = 'interview-prep/story-bank.md';
const DEFAULT_CV_PATH = 'cv.md';

// ── Numeric claim patterns ──────────────────────────────────────────
// Each pattern extracts {kind, text, index, values}. `values` are the
// numbers a cv.md match must reproduce for the claim to count as `existing`.

const CLAIM_PATTERNS = [
  // "cut costs 40%" / "improved completion 12.5%"
  {
    kind: 'percent',
    re: /\d+(?:\.\d+)?%/g,
    values: (m) => [parseFloat(m[0])],
  },
  // "500+ employees", "50+ courses" — number, literal +, a following word.
  // The following word is NOT captured as a required noun (kept loose on
  // purpose — real prose has too many phrasings to enumerate), it only
  // anchors the pattern away from bare "50+" with nothing after it.
  {
    kind: 'plus-noun',
    re: /\b(\d+)\+\s+[a-zA-Z]+/g,
    values: (m) => [parseFloat(m[1])],
  },
  // "8 hours to 2 hours", "8 hrs -> 2 hrs" — the classic before/after
  // automation-story shape. Both endpoints must match cv.md for `existing`.
  {
    kind: 'hour-range',
    re: /\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:→|->|to)\s*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/gi,
    values: (m) => [parseFloat(m[1]), parseFloat(m[2])],
  },
  // "15-person team", "6-member panel"
  {
    kind: 'scale-hyphen',
    re: /\b(\d+)-(?:person|member)\b/gi,
    values: (m) => [parseFloat(m[1])],
  },
  // "50 students", "200 employees", "12 instructors"
  {
    kind: 'scale-noun',
    re: /\b(\d+)\s+(?:students?|employees?|people|staff|learners?|instructors?|departments?|cohorts?)\b/gi,
    values: (m) => [parseFloat(m[1])],
  },
];

// Generic number scanner used to build the set of numeric values present in
// cv.md. Deliberately permissive (no unit/context requirement) — cv.md is
// the trust anchor, so over-matching here can only make MORE claims count as
// `existing`, never fewer, which is the safe direction to err in.
const NUMBER_SCAN_RE = /\d+(?:\.\d+)?/g;

// Filtered out of context-word overlap so common connective words don't
// manufacture a false supportedByResume match.
const STOPWORDS = new Set([
  'this', 'that', 'these', 'those', 'with', 'from', 'into', 'onto', 'over',
  'were', 'have', 'that', 'were', 'while', 'about', 'their', 'there',
  'which', 'through', 'across', 'within', 'without', 'after', 'before',
  'during', 'being', 'been', 'each', 'every', 'other', 'than', 'then',
  'them', 'they', 'when', 'where', 'what', 'more', 'most', 'some', 'such',
  'only', 'also', 'just', 'like', 'very', 'used', 'using',
]);

// ── Story-bank parsing ──────────────────────────────────────────────
// Same block shape match-star.mjs's parseStories() already relies on
// (`### [Theme] Title` headers, `**Label:** value` lines) — reimplemented
// narrowly here rather than imported, so this checker doesn't take on a
// dependency on match-star.mjs's STAR-specific fields it doesn't need.

/**
 * Parse story-bank.md into blocks with title, provenance marker, and body.
 * @param {string} content
 * @returns {Array<{title: string, provenance: string|null, body: string}>}
 */
function parseStoryBlocks(content) {
  const blocks = content.split(/^### /m).slice(1);
  const stories = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const header = lines[0].trim();
    if (!header) continue;

    const themeMatch = header.match(/^\[([^\]]+)\]\s*(.+)/);
    const title = themeMatch ? themeMatch[2].trim() : header;

    const provMatch = block.match(/\*\*Provenance:\*\*\s*(.+)/i);
    const provenance = provMatch ? provMatch[1].trim().toLowerCase() : null;

    stories.push({ title, provenance, body: block });
  }

  return stories;
}

// ── Claim extraction ─────────────────────────────────────────────────

/**
 * Extract numeric claims from a story block's body text.
 * @param {string} body
 * @returns {Array<{kind: string, text: string, index: number, values: number[]}>}
 */
function extractClaims(body) {
  const claims = [];
  for (const { kind, re, values } of CLAIM_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(body)) !== null) {
      claims.push({ kind, text: m[0], index: m.index, values: values(m) });
    }
  }
  claims.sort((a, b) => a.index - b.index);
  return claims;
}

/**
 * Numeric values present anywhere in a text (cv.md), as a Set for O(1) lookup.
 * @param {string} text
 * @returns {Set<number>}
 */
function extractNumbers(text) {
  const out = new Set();
  let m;
  const re = new RegExp(NUMBER_SCAN_RE);
  while ((m = re.exec(text)) !== null) out.add(parseFloat(m[0]));
  return out;
}

/**
 * Map of numeric value -> array of context-word lists, one per occurrence of
 * that number in cv.md. This scopes the `existing` bucket's number match to
 * the same metric/context, not a bare digit-string coincidence: a story
 * claiming "15-person team" must not count as verified just because cv.md
 * separately says "15 years of experience" with no team/headcount language
 * nearby (issue #2947, CodeRabbit finding — unscoped number matching).
 * Reuses contextWords(), the same mechanism already used to scope the
 * `supportedByResume` bucket below, instead of a second parallel heuristic.
 * @param {string} cvText
 * @returns {Map<number, string[][]>}
 */
function buildCvNumberContexts(cvText) {
  const map = new Map();
  const re = new RegExp(NUMBER_SCAN_RE);
  let m;
  while ((m = re.exec(cvText)) !== null) {
    const value = parseFloat(m[0]);
    const words = contextWords(cvText, m.index, m[0].length);
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(words);
  }
  return map;
}

/**
 * Content words (length >= 4, not a stopword, not itself a number) in a
 * window around a claim's position — the signal used for the
 * `supportedByResume` heuristic.
 *
 * The strip keeps letters, combining marks and digits of ANY script. It used
 * to be `[^a-z0-9\s]`, which deletes every non-ASCII letter, and that broke
 * this checker in both directions on a CV that is not written in ASCII:
 *
 *   - Cyrillic, Greek, Hebrew, Arabic, CJK — every character is stripped, the
 *     window yields NO words at all, and an empty list makes both
 *     hasScopedNumberMatch (`claimWords.includes`) and hasContextOverlap
 *     (`words.some`) unconditionally false. So `existing` and
 *     `supportedByResume` are unreachable and every claim the patterns do
 *     extract lands in `derived-unverified` — including a figure sitting
 *     verbatim in cv.md with matching context.
 *   - Accented Latin — the strip does not just delete, it re-cuts the word:
 *     "évaluation" becomes " valuation", a DIFFERENT real English word that
 *     can then overlap cv.md prose that has nothing to do with the claim.
 *     Shorter words vanish outright ("Größe", "naïve", "señor" all fall under
 *     the length floor once split).
 *
 * That matters more here than in a grouping key. `derived-unverified` is what
 * AGENTS.md's "Confirmation UX invariant" hands to the user to confirm or
 * deny, and its stated risk is that a confirmed guess launders a guess into a
 * verified fact. A checker that reports 100% unverified for a non-ASCII CV
 * hands over a list where every entry is noise, which is how a user learns to
 * confirm without reading.
 *
 * `\p{L}\p{M}\p{N}` is the alphabet tracker-parse.mjs's normalizeTextKey
 * settled on for exactly this class of bug (#2393/#2429/#2569/#2666), down to
 * keeping \p{M} so Indic matras survive. It is mirrored rather than imported:
 * normalizeTextKey builds a solid identity KEY and this needs word boundaries
 * preserved, and importing tracker-parse.mjs would make a story-bank check
 * fail hard on a missing tracker-aliases.json it has no other use for.
 *
 * @param {string} body
 * @param {number} matchIndex
 * @param {number} matchLength
 * @param {number} windowChars
 * @returns {string[]}
 */
/**
 * NFKC, lowercased, with the combining dot a lowercased Turkish `İ` leaves
 * behind removed.
 *
 * Extracted so the two sides of every comparison below are folded IDENTICALLY.
 * contextWords() folds the claim window; hasContextOverlap() searches cv.md.
 * Folding only one of them is a bug that hides: a cv.md written "İstanbul"
 * lowercases to `i` + U+0307 and stops matching a claim word the strip has
 * already reduced to plain "istanbul".
 *
 * @param {string} text
 * @returns {string}
 */
function foldForContext(text) {
  return String(text ?? '')
    // NFKC before the strip so a full-width "４０％" folds like "40%", the same
    // normalization order normalizeTextKey uses.
    .normalize('NFKC')
    .toLowerCase()
    // Lowercasing a Turkish dotted capital leaves a bare combining dot
    // (U+0307) behind, and \p{M} in the strip below keeps it — so "İstanbul"
    // and "Istanbul" would not compare equal. Same one-character strip, and
    // the same reason, as normalizeTextKey's.
    .replace(/\u0307/gu, '');
}

function contextWords(body, matchIndex, matchLength, windowChars = 90) {
  const start = Math.max(0, matchIndex - windowChars);
  const end = Math.min(body.length, matchIndex + matchLength + windowChars);
  const snippet = foldForContext(body.slice(start, end))
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ');
  const words = snippet.split(/\s+/).filter(Boolean);
  // `\p{N}` not `\d`: a token of Devanagari or full-width digits is just as
  // much "a number, not a content word" as an ASCII one.
  return [...new Set(words.filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\p{N}+$/u.test(w)))];
}

/**
 * Whether any context word appears, on a word boundary, in cv.md prose.
 *
 * The boundary is a lookaround pair, not `\b`. `\b` is defined against `\w`,
 * which is `[A-Za-z0-9_]` — so for a Cyrillic, Greek, Hebrew, Arabic or CJK
 * word BOTH sides of every edge are non-word characters and the assertion is
 * never satisfied:
 *
 *   /\bсократил\b/i.test('сократил расходы')   ->  false
 *
 * That made this the second half of the same defect as the ASCII strip in
 * contextWords: even once the words survive folding, they could never be found
 * in cv.md, so `supportedByResume` stayed unreachable for a non-Latin CV and
 * every claim still fell to `derived-unverified`.
 *
 * Mirrors the `bounded()` helper scan.mjs already uses for company names, down
 * to its escape set — `\-` is an invalid identity escape under `u`. Both
 * operands here are folded output (letters, marks, digits and spaces only), so
 * the escape is defensive rather than load-bearing.
 *
 * @param {string[]} words - Claim context words, already folded.
 * @param {string} cvText - Raw cv.md; folded here so both sides match.
 * @returns {boolean}
 */
function hasContextOverlap(words, cvText) {
  const haystack = foldForContext(cvText);
  const bounded = (w) => new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{M}\\p{N}])`,
    'u',
  );
  return words.some((w) => bounded(w).test(haystack));
}

/**
 * Whether a claim's context words overlap with the context words of at
 * least one cv.md occurrence of the same number — the scoping check that
 * keeps the `existing` bucket from firing on a bare digit-string
 * coincidence (see buildCvNumberContexts() above).
 * @param {string[]} claimWords
 * @param {string[][]} cvContextLists
 * @returns {boolean}
 */
function hasScopedNumberMatch(claimWords, cvContextLists) {
  return cvContextLists.some((cvWords) => cvWords.some((w) => claimWords.includes(w)));
}

const USER_STATED_RE = /^user-stated\s+\d{4}-\d{2}-\d{2}$/;

// ── Classification ───────────────────────────────────────────────────

/**
 * Classify every numeric claim in story-bank.md against cv.md into the four
 * buckets documented at the top of this file.
 * @param {string} storyBankText
 * @param {string} cvText
 * @returns {{existing: object[], supportedByResume: object[], derivedUnverified: object[], userCannotConfirm: object[]}}
 */
function classifyStoryBank(storyBankText, cvText) {
  const cvNumberContexts = buildCvNumberContexts(cvText);
  const stories = parseStoryBlocks(storyBankText);

  const buckets = { existing: [], supportedByResume: [], derivedUnverified: [], userCannotConfirm: [] };

  for (const story of stories) {
    const claims = extractClaims(story.body);
    for (const claim of claims) {
      const entry = { story: story.title, claim: claim.text, pattern: claim.kind };

      // HARD override — checked first, wins over every heuristic below, and
      // is never itself overridden. This is the invariant #2947 exists to
      // guarantee: an explicit "I don't know" must not decay into "verified"
      // or back into "unverified-but-maybe" on a later run just because the
      // heuristic below would have reached a different conclusion this time.
      if (story.provenance === 'user-cannot-confirm') {
        buckets.userCannotConfirm.push({
          ...entry,
          reason: 'explicit Provenance marker (user-cannot-confirm) — durable, never reclassified',
        });
        continue;
      }

      // Explicit user-confirmed provenance markers — checked before the
      // numeric/context heuristics below, not as a fallback after them.
      // Without this ordering, a story carrying `user-stated YYYY-MM-DD` or
      // `source: cv.md` could get misclassified into `supportedByResume` (or
      // worse) whenever the heuristic below happened to find only partial
      // context overlap, even though the marker already asserts the claim is
      // verified. AGENTS.md's tiering language allows either a trace to a
      // primary file OR an explicit provenance marker to satisfy `existing`.
      if (story.provenance && (USER_STATED_RE.test(story.provenance) || story.provenance === 'source: cv.md')) {
        buckets.existing.push({
          ...entry,
          reason: `confirmed via Provenance marker (${story.provenance})`,
        });
        continue;
      }

      const claimWords = contextWords(story.body, claim.index, claim.text.length);

      // Scoped number match: the number must appear in cv.md AND the cv.md
      // occurrence's own context must share a term with the claim's context
      // — a bare digit-string coincidence elsewhere in cv.md (e.g. cv.md's
      // "15 years of experience" against a story's "15-person team") must
      // not count as `existing`.
      const matchesCv = claim.values.every((v) => {
        const cvContextLists = cvNumberContexts.get(v);
        return cvContextLists ? hasScopedNumberMatch(claimWords, cvContextLists) : false;
      });
      if (matchesCv) {
        buckets.existing.push(entry);
        continue;
      }

      if (hasContextOverlap(claimWords, cvText)) {
        buckets.supportedByResume.push({ ...entry, contextWords: claimWords });
        continue;
      }

      buckets.derivedUnverified.push(entry);
    }
  }

  return buckets;
}

/**
 * Explain a low-confidence run so an empty/near-empty result isn't misread
 * as "scanned and clean" — same purpose as jd-skill-gap.mjs's
 * diagnoseExtraction().
 * @param {boolean} storyBankExists
 * @param {boolean} cvExists
 * @param {number} storyCount
 * @param {number} claimCount
 * @param {string} [storyBankPath]
 * @param {string} [cvPath]
 * @returns {{reason: string, message: string}|null}
 */
function diagnose(storyBankExists, cvExists, storyCount, claimCount, storyBankPath = DEFAULT_STORY_BANK_PATH, cvPath = DEFAULT_CV_PATH) {
  if (!storyBankExists) {
    return { reason: 'no-story-bank', message: `${storyBankPath} not found — nothing was checked.` };
  }
  if (!cvExists) {
    return { reason: 'no-cv', message: `${cvPath} not found — claims cannot be checked against a primary source.` };
  }
  if (storyCount === 0) {
    return { reason: 'no-stories-parsed', message: 'story-bank.md exists but no `### ` story blocks were parsed from it.' };
  }
  if (claimCount === 0) {
    return {
      reason: 'no-numeric-claims-found',
      message: 'Stories were parsed but no numeric claims matched the covered patterns. This is not the same as "no risk" — see the pattern-coverage note in this script\'s header for what is not scanned.',
    };
  }
  return null;
}

// ── Exports (for test-all.mjs and other consumers) ───────────────────
export { parseStoryBlocks, extractClaims, extractNumbers, classifyStoryBank, diagnose };

// ── CLI ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const selfTestMode = args.includes('--self-test');
const storyBankPath = flagValue(args, '--story-bank') || DEFAULT_STORY_BANK_PATH;
const cvPath = flagValue(args, '--cv') || DEFAULT_CV_PATH;

function runSelfTest() {
  let passed = 0, failed = 0;
  const eq = (label, actual, expected) => {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) {
      passed++;
    } else {
      failed++;
      console.log(`  FAIL: ${label}\n    expected: ${e}\n    actual:   ${a}`);
    }
  };

  const fakeCv = `
# Experience

## Instructional Designer — Acme University (2022-2025)
- Reduced onboarding ramp time from 8 hours to 2 hours per cohort by automating manual configuration steps.
- Led a cross-functional team through a full LMS migration with zero data loss.

# Filler

Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

# Summary

Brings 15 years of unrelated professional background in adult education prior to instructional design work.
`;

  const fakeStoryBank = `
### [Automation] Onboarding Workflow
**Situation:** New hires spent too long configuring onboarding tools manually.
**Task:** Cut ramp time without losing quality.
**Action:** Built an automated workflow using a custom LMS integration.
**Result:** Ramp time dropped from 8 hours to 2 hours per cohort.
**Best for questions about:** automation, process improvement

### [Leadership] LMS Migration Team
**Situation:** The LMS migration needed dedicated team leadership.
**Task:** Keep the migration on schedule with no data loss.
**Action:** Led a 15-person team through the full migration.
**Result:** Migration completed on time with zero data loss.
**Best for questions about:** leadership, project management

### [Scale] Statewide Rollout
**Situation:** Leadership wanted a large-scale training rollout.
**Task:** Reach as many staff as possible within one quarter.
**Action:** Built self-paced modules and distributed them broadly.
**Result:** 500+ employees completed the rollout within the quarter.
**Best for questions about:** scale, training design

### [Budget] Vendor Negotiation
**Provenance:** user-cannot-confirm
**Situation:** The training budget needed renegotiation with a vendor.
**Task:** Cut licensing costs without losing seats.
**Action:** Renegotiated the vendor contract.
**Result:** Estimated 40% savings on licensing costs, though the original invoice could not be located to confirm the exact figure.
**Best for questions about:** negotiation, cost savings
`;

  // Fixture 1: numeric claim present in cv.md -> existing
  const result = classifyStoryBank(fakeStoryBank, fakeCv);
  eq(
    'hour-range claim matching cv.md verbatim numbers is existing',
    result.existing.some((c) => c.story === 'Onboarding Workflow' && c.pattern === 'hour-range'),
    true
  );

  // Fixture 2: cv.md prose supports the underlying fact without the exact figure -> supportedByResume
  eq(
    'scale-hyphen claim not in cv.md, but cv.md prose supports the fact, is supportedByResume',
    result.supportedByResume.some((c) => c.story === 'LMS Migration Team' && c.pattern === 'scale-hyphen'),
    true
  );

  // Fixture 2b (regression, CodeRabbit finding — unscoped number matching):
  // cv.md separately contains the bare number 15 in a completely unrelated
  // sentence ("15 years of professional experience", no team/headcount
  // language nearby). A claim of "a 15-person team" must NOT be promoted to
  // `existing` just because that digit string coincidentally appears
  // elsewhere in cv.md — the match must be scoped to shared context, not a
  // bare digit-string coincidence.
  eq(
    'a claim number matching cv.md only via an unrelated coincidental occurrence is NOT existing',
    result.existing.some((c) => c.story === 'LMS Migration Team' && c.pattern === 'scale-hyphen'),
    false
  );

  // Fixture 3: numeric claim only in story-bank.md, no cv.md trace, no marker -> derived-unverified
  eq(
    'plus-noun claim with no cv.md trace is derived-unverified',
    result.derivedUnverified.some((c) => c.story === 'Statewide Rollout' && c.pattern === 'plus-noun'),
    true
  );

  // Fixture 4: explicit user-cannot-confirm marker overrides the heuristic
  // (which alone would have said derived-unverified, since cv.md has no
  // trace of the vendor negotiation or the 40% figure at all).
  eq(
    'percent claim under an explicit user-cannot-confirm marker is user-cannot-confirm, not derived-unverified',
    result.userCannotConfirm.some((c) => c.story === 'Vendor Negotiation' && c.pattern === 'percent'),
    true
  );
  eq(
    'the user-cannot-confirm claim does NOT also land in derivedUnverified',
    result.derivedUnverified.some((c) => c.story === 'Vendor Negotiation'),
    false
  );

  // Fixture 5: stability across repeated runs — a user-cannot-confirm entry
  // must classify identically every time, not just once. Re-run the same
  // classification from scratch (a fresh parse + fresh classify, exactly
  // what a second CLI invocation would do) and diff the two results.
  const rerun1 = classifyStoryBank(fakeStoryBank, fakeCv);
  const rerun2 = classifyStoryBank(fakeStoryBank, fakeCv);
  eq('repeated classification of the same story-bank is byte-identical (idempotent)', rerun1, rerun2);
  eq(
    'user-cannot-confirm entry is stable across repeated runs, not just present once',
    rerun2.userCannotConfirm.some((c) => c.story === 'Vendor Negotiation'),
    true
  );

  // Fixture 6: explicit user-stated marker counts as an existing-equivalent
  // confirmation even though cv.md doesn't carry the exact figure — the
  // "OR carry an explicit provenance marker" half of the AGENTS.md rule.
  const userStatedBank = `
### [Scale] Conference Talk
**Provenance:** user-stated 2026-01-15
**Situation:** Was asked to present at a regional conference.
**Task:** Design a session for a large mixed audience.
**Action:** Delivered a workshop attended by roughly 300 students.
**Result:** Session feedback scores were among the highest of the day.
**Best for questions about:** public speaking
`;
  const userStatedResult = classifyStoryBank(userStatedBank, fakeCv);
  eq(
    'a user-stated marker promotes an otherwise-unverified claim to existing',
    userStatedResult.existing.some((c) => c.story === 'Conference Talk' && c.pattern === 'scale-noun'),
    true
  );

  // Fixture 7 (regression, CodeRabbit finding — explicit markers evaluated
  // too late): a claim whose number is NOT in cv.md, but whose surrounding
  // context happens to share a word with cv.md ("cohort", verbatim from
  // fakeCv's "per cohort"), must still resolve straight to `existing` via
  // the marker — not get redirected into `supportedByResume` by the
  // context-overlap heuristic running first. Tested for both explicit
  // marker forms: `user-stated YYYY-MM-DD` and the literal `source: cv.md`.
  const userStatedOverlapBank = `
### [Scale] Certification Program
**Provenance:** user-stated 2026-02-01
**Situation:** New hires needed a scalable certification path.
**Task:** Build a training program covering core software skills.
**Action:** Delivered training to 275 employees across each cohort rotation.
**Result:** All participants passed the certification assessment.
**Best for questions about:** training delivery, certification design
`;
  const userStatedOverlapResult = classifyStoryBank(userStatedOverlapBank, fakeCv);
  eq(
    'user-stated marker + overlapping cv.md context still classifies as existing, not supportedByResume',
    userStatedOverlapResult.existing.some((c) => c.story === 'Certification Program' && c.pattern === 'scale-noun'),
    true
  );
  eq(
    'user-stated marker claim does NOT land in supportedByResume despite the context overlap',
    userStatedOverlapResult.supportedByResume.some((c) => c.story === 'Certification Program'),
    false
  );

  // Control case (CodeRabbit follow-up, PR #2948): the negative assertion
  // above passes vacuously if the context-overlap heuristic stops producing
  // any overlap at all (e.g. a future change to the stopword list or context
  // window), silently stopping this test from actually proving the marker
  // wins an ordering race. Classify the identical story body with the
  // Provenance line removed and assert it DOES land in supportedByResume —
  // proving the heuristic really would fire here, so the marker is what's
  // overriding it above, not an absence of overlap in the first place.
  const noMarkerOverlapBank = userStatedOverlapBank.replace(/\*\*Provenance:\*\* user-stated 2026-02-01\n/, '');
  const noMarkerOverlapResult = classifyStoryBank(noMarkerOverlapBank, fakeCv);
  eq(
    'control: the same story body WITHOUT a provenance marker lands in supportedByResume — proves the heuristic would fire absent the marker',
    noMarkerOverlapResult.supportedByResume.some((c) => c.story === 'Certification Program'),
    true
  );

  const sourceCvOverlapBank = `
### [Scale] Certification Program
**Provenance:** source: cv.md
**Situation:** New hires needed a scalable certification path.
**Task:** Build a training program covering core software skills.
**Action:** Delivered training to 275 employees across each cohort rotation.
**Result:** All participants passed the certification assessment.
**Best for questions about:** training delivery, certification design
`;
  const sourceCvOverlapResult = classifyStoryBank(sourceCvOverlapBank, fakeCv);
  eq(
    'literal "source: cv.md" marker + overlapping cv.md context still classifies as existing, not supportedByResume',
    sourceCvOverlapResult.existing.some((c) => c.story === 'Certification Program' && c.pattern === 'scale-noun'),
    true
  );
  eq(
    '"source: cv.md" marker claim does NOT land in supportedByResume despite the context overlap',
    sourceCvOverlapResult.supportedByResume.some((c) => c.story === 'Certification Program'),
    false
  );

  const noMarkerOverlapBank2 = sourceCvOverlapBank.replace(/\*\*Provenance:\*\* source: cv\.md\n/, '');
  const noMarkerOverlapResult2 = classifyStoryBank(noMarkerOverlapBank2, fakeCv);
  eq(
    'control: the same story body WITHOUT the "source: cv.md" marker lands in supportedByResume — proves the heuristic would fire absent the marker',
    noMarkerOverlapResult2.supportedByResume.some((c) => c.story === 'Certification Program'),
    true
  );

  // diagnose() — low-confidence signaling
  eq('missing story-bank.md is diagnosed as no-story-bank', diagnose(false, true, 0, 0).reason, 'no-story-bank');
  eq('missing cv.md is diagnosed as no-cv', diagnose(true, false, 0, 0).reason, 'no-cv');
  eq('zero parsed stories is diagnosed as no-stories-parsed', diagnose(true, true, 0, 0).reason, 'no-stories-parsed');
  eq('stories parsed but zero claims is diagnosed as no-numeric-claims-found', diagnose(true, true, 3, 0).reason, 'no-numeric-claims-found');
  eq('a conclusive run (claims found) is not diagnosed', diagnose(true, true, 3, 2), null);

  // parseStoryBlocks — theme-prefixed and bare titles both parse
  const blocks = parseStoryBlocks(fakeStoryBank);
  eq('parses all four story blocks', blocks.length, 4);
  eq('strips the [Theme] prefix from the title', blocks[0].title, 'Onboarding Workflow');
  eq('provenance is null when the field is absent', blocks[0].provenance, null);
  eq('provenance is parsed and lowercased when present', blocks[3].provenance, 'user-cannot-confirm');

  console.log(`\nstory-provenance-check self-test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// ── Main ─────────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (selfTestMode) {
    runSelfTest();
  } else {
    const storyBankExists = existsSync(storyBankPath);
    const cvExists = existsSync(cvPath);
    const storyBankText = storyBankExists ? readFileSync(storyBankPath, 'utf-8') : '';
    const cvText = cvExists ? readFileSync(cvPath, 'utf-8') : '';

    const result = classifyStoryBank(storyBankText, cvText);
    const storyCount = storyBankExists ? parseStoryBlocks(storyBankText).length : 0;
    const claimCount = result.existing.length + result.supportedByResume.length
      + result.derivedUnverified.length + result.userCannotConfirm.length;
    const diagnosis = diagnose(storyBankExists, cvExists, storyCount, claimCount, storyBankPath, cvPath);

    if (summaryMode) {
      console.log(`\nStory Provenance Check`);
      console.log('─'.repeat(40));
      console.log(`Story bank: ${storyBankPath}${storyBankExists ? '' : ' (not found)'}`);
      console.log(`CV:         ${cvPath}${cvExists ? '' : ' (not found)'}`);
      console.log(`Claims checked: ${claimCount}\n`);

      const printBucket = (label, emoji, items) => {
        console.log(`  ${emoji} ${label} (${items.length})`);
        for (const item of items) {
          console.log(`     - [${item.story}] "${item.claim}" (${item.pattern})${item.reason ? ` — ${item.reason}` : ''}`);
        }
      };
      printBucket('existing (traces to cv.md or an explicit marker)', '✅', result.existing);
      printBucket('supportedByResume (cv.md supports the fact, not this precision)', '📝', result.supportedByResume);
      printBucket('derived-unverified (only in story-bank.md, unconfirmed)', '⚠️', result.derivedUnverified);
      printBucket('user-cannot-confirm (explicitly marked, durable)', '🔒', result.userCannotConfirm);

      if (diagnosis) {
        console.log('');
        console.log('  🚨 LOW CONFIDENCE: this is not a clean result.');
        console.log(`     ${diagnosis.message}`);
        console.log(`     (reason: ${diagnosis.reason})`);
      }
    } else {
      console.log(JSON.stringify({ ...result, lowConfidence: diagnosis }, null, 2));
    }
  }
}
