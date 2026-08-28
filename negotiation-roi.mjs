#!/usr/bin/env node
/**
 * negotiation-roi.mjs — ROI-based salary-negotiation talking-point generator
 *
 * `salary-gap.mjs` tells a candidate where an offer sits relative to market
 * (a comparison). This script gives them something to *say* instead: a draft
 * talking point anchored in a quantified, VERIFIED achievement from
 * `interview-prep/story-bank.md`, translated into an estimated dollar value.
 *
 * v1 safety gate (the whole point of this file — read before touching the
 * verification logic):
 *
 *   A story-bank.md numeric claim is used ONLY if the same number, with a
 *   matching unit, ALSO appears verbatim in cv.md. If it doesn't, the claim
 *   is EXCLUDED from output entirely — not flagged, not included with a
 *   caveat. Pulling an unverified figure into words a candidate will say out
 *   loud in a negotiation is a higher-stakes place for a fabrication to land
 *   than an interview answer: if challenged and it doesn't hold up, the
 *   damage is to credibility and the offer, not just to one interview
 *   answer. This is deliberately the narrowest possible check — direct
 *   substring match, no fuzzy scoring, no new infrastructure. A richer
 *   four-tier provenance classifier for story-bank.md claims is in progress
 *   on a separate, unmerged branch (`story-provenance-check.mjs`, PR #2948).
 *   Once that lands, this script would be a natural candidate to consume its
 *   `existing` bucket directly instead of doing its own narrower check — but
 *   that is a future upgrade, not a dependency: this file has zero import
 *   from that branch and ships standalone.
 *
 * Second invariant: wage basis and task frequency are NEVER guessed. Both
 * must come from either (a) explicit text in the story-bank entry itself
 * (e.g. "$45/hr", "this happens weekly"), or (b) an explicit CLI flag
 * (`--wage`, `--frequency`/`--occurrences`). A claim missing either input is
 * reported as uncalculable with a clear reason — never silently assigned a
 * default.
 *
 * Numeric-claim extraction scope (deliberately not exhaustive — see
 * TIME_REDUCTION_RE / PERCENT_REDUCTION_RE below):
 *   - "N hours ... to M hours" (arrow, "down to", or bare "to"; the second
 *     unit may be omitted and inherits the first, e.g. "8 hours to 2")
 *   - "cut/reduced/decreased/dropped/shaved ... by X%"
 *   Only the hour-family unit (hour/hours/hr/hrs/h) is recognized; other
 *   units (days, minutes, FTEs) are out of scope for v1. Percent-reduction
 *   claims are extracted and verified but never calculable in v1 — turning a
 *   percentage into a dollar figure needs a baseline duration this script
 *   does not infer.
 *
 * Read-only / draft-only: never writes to any file, never sends or submits
 * anything. Prints a draft for the user to review themselves (AGENTS.md
 * "Ethical Use" — human always reviews before anything goes out).
 *
 * Run: node negotiation-roi.mjs                                  (JSON)
 *      node negotiation-roi.mjs --summary                        (human-readable)
 *      node negotiation-roi.mjs --wage 45 --frequency weekly     (supply missing inputs)
 *      node negotiation-roi.mjs --wage 45 --occurrences 52       (direct annual count)
 *      node negotiation-roi.mjs --self-test
 *
 * Issue #2949 — github.com/santifer/career-ops
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { parseStories } from './match-star.mjs';
import { flagValue, hasFlag } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const STORY_BANK_PATH = join(CAREER_OPS, 'interview-prep', 'story-bank.md');
const DATA_ROOT = getCareerOpsRoot();
const CV_PATH = join(DATA_ROOT, 'cv.md');

// ── Frequency vocabulary ─────────────────────────────────────────────
// Occurrences per year, business-cadence convention (matches how a candidate
// would talk about a recurring work task, not calendar days).
const FREQUENCY_MAP = {
  daily: 260, weekly: 52, biweekly: 26, 'bi-weekly': 26,
  monthly: 12, quarterly: 4, annually: 1, yearly: 1,
};

// Ordered so the first match wins; longer/more-specific phrases first so
// "every other week" isn't swallowed by a looser "week" pattern.
const FREQUENCY_TEXT_PATTERNS = [
  { re: /\bbi-?weekly\b|\bevery\s+(?:other|two)\s+weeks?\b/i, key: 'biweekly' },
  { re: /\bdaily\b|\bevery\s+day\b|\beach\s+day\b/i, key: 'daily' },
  { re: /\bweekly\b|\bevery\s+week\b|\beach\s+week\b|\bonce\s+a\s+week\b/i, key: 'weekly' },
  { re: /\bmonthly\b|\bevery\s+month\b|\beach\s+month\b|\bonce\s+a\s+month\b/i, key: 'monthly' },
  { re: /\bquarterly\b|\bevery\s+quarter\b/i, key: 'quarterly' },
  { re: /\bannually\b|\byearly\b|\bevery\s+year\b|\bonce\s+a\s+year\b/i, key: 'annually' },
];

const WAGE_TEXT_RE = /\$\s?(\d+(?:\.\d+)?)\s*(?:\/|per\s+)\s*(?:hr|hour)\b/i;

// ── Numeric-claim extraction ─────────────────────────────────────────

// Second unit is OPTIONAL and inherits the first ("8 hours to 2" — the
// example this issue was filed with). `[^.\n\d]{0,40}?` keeps the connector
// short so unrelated numbers elsewhere in the sentence aren't bridged.
const TIME_REDUCTION_RE = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)\b[^.\n\d]{0,40}?(?:down to|to|→|->|➞)\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)?\b/gi;

const PERCENT_REDUCTION_RE = /(?:cut|reduced?|decreased?|dropped|shaved)[^.\n]{0,60}?by\s+(\d+(?:\.\d+)?)\s*%/gi;

function sentenceAround(text, start, end) {
  const beforeDot = text.lastIndexOf('. ', start);
  const sStart = beforeDot === -1 ? 0 : beforeDot + 2;
  let sEnd = text.indexOf('. ', end);
  sEnd = sEnd === -1 ? text.length : sEnd + 1;
  return text.slice(sStart, sEnd).trim();
}

/**
 * Extract quantified numeric claims from one story's combined text.
 * @param {string} storyText - situation+task+action+result+reflection, joined.
 * @param {string} storyTitle
 * @returns {Array<object>} claim objects (not yet verified against cv.md)
 */
export function extractQuantifiedClaims(storyText, storyTitle) {
  const claims = [];
  const text = String(storyText || '');

  TIME_REDUCTION_RE.lastIndex = 0;
  let m;
  while ((m = TIME_REDUCTION_RE.exec(text)) !== null) {
    const beforeVal = parseFloat(m[1]);
    const beforeUnit = m[2];
    const afterVal = parseFloat(m[3]);
    const afterUnit = m[4] || beforeUnit; // inherited when omitted
    claims.push({
      story: storyTitle,
      type: 'time-reduction',
      raw: m[0].trim(),
      sentence: sentenceAround(text, m.index, m.index + m[0].length),
      before: { value: beforeVal, unit: beforeUnit },
      after: { value: afterVal, unit: afterUnit },
    });
  }

  PERCENT_REDUCTION_RE.lastIndex = 0;
  while ((m = PERCENT_REDUCTION_RE.exec(text)) !== null) {
    claims.push({
      story: storyTitle,
      type: 'percent-reduction',
      raw: m[0].trim(),
      sentence: sentenceAround(text, m.index, m.index + m[0].length),
      percent: parseFloat(m[1]),
    });
  }

  return claims;
}

// ── Verification gate (the v1 safety boundary) ───────────────────────

const HOUR_UNIT_FAMILY = ['hour', 'hours', 'hr', 'hrs', 'h'];

function numberVariants(value, unitFamily) {
  const num = String(value);
  const variants = [];
  for (const u of unitFamily) {
    variants.push(`${num} ${u}`);
    variants.push(`${num}${u}`);
  }
  return variants;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Boundary-aware match: a numeric variant like "8 hours" must NOT match
// inside "18 hours", and "60%" must NOT match inside "160%". Plain substring
// matching (`includes`) is unbounded and lets a candidate's story-bank claim
// "verify" against an unrelated, larger number in cv.md — the exact
// fabrication-into-negotiation gap this gate exists to close. A negative
// lookbehind/lookahead for an adjacent digit (or decimal point) rules that
// out while still matching the variant anywhere else in the text.
function anyVariantInText(variants, text) {
  const hay = text.toLowerCase();
  return variants.some((v) => {
    const escaped = escapeRegExp(v.toLowerCase());
    const re = new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`, 'i');
    return re.test(hay);
  });
}

/**
 * Verify a claim's number(s) appear verbatim (with a matching unit) in cv.md.
 * Returns { verified: boolean, checkedVariants: string[] } — never mutates
 * the claim, never partially includes an unverified figure.
 * @param {object} claim
 * @param {string} cvText
 */
export function verifyClaim(claim, cvText) {
  const text = String(cvText || '');
  if (claim.type === 'time-reduction') {
    const beforeVariants = numberVariants(claim.before.value, HOUR_UNIT_FAMILY);
    const afterVariants = numberVariants(claim.after.value, HOUR_UNIT_FAMILY);
    const beforeOk = anyVariantInText(beforeVariants, text);
    const afterOk = anyVariantInText(afterVariants, text);
    return { verified: beforeOk && afterOk, checkedVariants: [...beforeVariants, ...afterVariants] };
  }
  if (claim.type === 'percent-reduction') {
    const variants = [`${claim.percent}%`, `${claim.percent} %`];
    return { verified: anyVariantInText(variants, text), checkedVariants: variants };
  }
  return { verified: false, checkedVariants: [] };
}

// ── ROI calculation ───────────────────────────────────────────────────

/**
 * Resolve occurrences/year for one claim: story text > CLI flag. Never guesses.
 * @returns {{ occurrencesPerYear: number, source: string } | null}
 */
export function resolveFrequency(storyText, opts) {
  for (const { re, key } of FREQUENCY_TEXT_PATTERNS) {
    if (re.test(storyText)) {
      return { occurrencesPerYear: FREQUENCY_MAP[key], source: `story text ("${key}")` };
    }
  }
  if (opts.occurrencesPerYear != null) {
    return { occurrencesPerYear: opts.occurrencesPerYear, source: 'CLI --occurrences' };
  }
  if (opts.frequency && FREQUENCY_MAP[opts.frequency] != null) {
    return { occurrencesPerYear: FREQUENCY_MAP[opts.frequency], source: `CLI --frequency ${opts.frequency}` };
  }
  return null;
}

/**
 * Resolve an hourly wage basis for one claim: story text > CLI flag. Never guesses.
 * @returns {{ hourlyWage: number, source: string } | null}
 */
export function resolveWage(storyText, opts) {
  const m = storyText.match(WAGE_TEXT_RE);
  if (m) return { hourlyWage: parseFloat(m[1]), source: `story text ("$${m[1]}/hr")` };
  if (opts.wage != null) return { hourlyWage: opts.wage, source: 'CLI --wage' };
  return null;
}

/**
 * Compute the full, visible calculation for one verified time-reduction claim.
 * Returns null (never a guessed number) when any required input is missing.
 * @param {object} claim
 * @param {string} storyText
 * @param {object} opts - { wage, frequency, occurrencesPerYear }
 */
export function computeCalculation(claim, storyText, opts) {
  if (claim.type !== 'time-reduction') return { calculation: null, reason: 'percent-only claim: no time baseline to convert into hours saved (out of scope for v1)' };

  const hoursSaved = claim.before.value - claim.after.value;
  if (!(hoursSaved > 0)) {
    return { calculation: null, reason: `not a time reduction (before ${claim.before.value}h is not greater than after ${claim.after.value}h)` };
  }

  const wageResolved = resolveWage(storyText, opts);
  if (!wageResolved) {
    return { calculation: null, reason: 'missing hourly-wage basis — supply --wage <number> or state it in the story ("$X/hr")' };
  }

  const freqResolved = resolveFrequency(storyText, opts);
  if (!freqResolved) {
    return { calculation: null, reason: 'missing task frequency — supply --frequency <daily|weekly|biweekly|monthly|quarterly|annually> / --occurrences <N>, or state it in the story ("this happens weekly")' };
  }

  const annualValue = hoursSaved * wageResolved.hourlyWage * freqResolved.occurrencesPerYear;
  return {
    calculation: {
      hoursSavedPerOccurrence: hoursSaved,
      hourlyWage: wageResolved.hourlyWage,
      wageSource: wageResolved.source,
      occurrencesPerYear: freqResolved.occurrencesPerYear,
      frequencySource: freqResolved.source,
      annualValue,
      formula: `${hoursSaved}h × $${wageResolved.hourlyWage}/hr × ${freqResolved.occurrencesPerYear}/year = $${annualValue.toLocaleString()}/year`,
    },
    reason: null,
  };
}

/**
 * Parse a CLI flag that must be a positive, finite number (e.g. --wage,
 * --occurrences). `Number()` rejects trailing garbage like "40usd" (returns
 * NaN for the whole string, unlike `parseFloat()` which would silently parse
 * a leading numeric prefix); combined with the finite/positive check this
 * also rejects negative values, zero, and Infinity/-Infinity.
 * @param {string|undefined} raw
 * @param {string} label - flag name for the error message, e.g. "--wage"
 * @returns {{ value: number|null, error: string|null }}
 */
export function parsePositiveNumberFlag(raw, label) {
  if (raw === undefined) return { value: null, error: null };
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return { value: null, error: `${label} must be a positive finite number, got "${raw}"` };
  }
  return { value, error: null };
}

/**
 * Draft talking-point paragraph. Achievement text is quoted from the source
 * (story-bank/cv.md), never invented. Always ends with the transferability
 * reminder — the script computes arithmetic only, it does not vouch for the
 * analogy holding in the target role.
 */
export function buildDraftParagraph(claim, calc) {
  const parts = [
    `Achievement: ${claim.sentence}`,
    `Estimated value: ${calc.formula}`,
    'Note: this is arithmetic only — it does not judge whether this achievement\'s context (company size, industry, scale) transfers to the target role. That judgment is yours to make before using this number in a real conversation.',
  ];
  return parts.join('\n');
}

// ── Orchestration (the testable core) ─────────────────────────────────

/**
 * Full analysis: extract -> verify -> calculate -> draft. Pure function over
 * its inputs so self-test can exercise it without touching disk.
 * @param {string} storyBankText
 * @param {string} cvText
 * @param {object} opts - { wage: number|null, frequency: string|null, occurrencesPerYear: number|null }
 */
export function analyze(storyBankText, cvText, opts = {}) {
  const stories = parseStories(storyBankText);
  const warnings = [];

  let claimsFound = 0;
  let excludedUnverified = 0;
  const calculable = [];
  const uncalculable = [];

  for (const story of stories) {
    const storyText = [story.situation, story.task, story.action, story.result, story.reflection]
      .filter(Boolean).join(' ');
    const storyLabel = story.theme ? `[${story.theme}] ${story.title}` : story.title;
    const claims = extractQuantifiedClaims(storyText, storyLabel);
    claimsFound += claims.length;

    for (const claim of claims) {
      const { verified } = verifyClaim(claim, cvText);
      if (!verified) { excludedUnverified += 1; continue; } // v1 safety gate — silently excluded, not flagged

      const { calculation, reason } = computeCalculation(claim, storyText, opts);
      if (calculation) {
        calculable.push({
          story: claim.story,
          claimType: claim.type,
          achievement: claim.sentence,
          calculation,
          draftParagraph: buildDraftParagraph(claim, calculation),
        });
      } else {
        uncalculable.push({ story: claim.story, claimType: claim.type, achievement: claim.sentence, reason });
      }
    }
  }

  if (excludedUnverified > 0) {
    warnings.push(`${excludedUnverified} quantified claim${excludedUnverified === 1 ? '' : 's'} found in story-bank.md ${excludedUnverified === 1 ? 'was' : 'were'} excluded: no matching figure found verbatim in cv.md (v1 safety gate).`);
  }
  if (stories.length === 0) {
    warnings.push('No stories found in story-bank.md.');
  }

  return {
    storiesScanned: stories.length,
    claimsFound,
    verified: calculable.length + uncalculable.length,
    excludedUnverified,
    calculable,
    uncalculable,
    warnings,
  };
}

// ── Self-test ───────────────────────────────────────────────────────

const STORY_BANK_FIXTURE = `
### [Process Improvement] Cut onboarding paperwork time

**Source:** Acme Corp, 2025

**S (Situation):** New-hire onboarding paperwork was a recurring bottleneck for the HR team.

**T (Task):** Reduce the manual processing time without adding headcount.

**A (Action):** I built a template automation that cut a recurring process from 8 hours to 2 hours per batch.

**R (Result):** The team reclaimed significant capacity.

**Reflection:** This freed up capacity for higher-value onboarding work.

**Best for questions about:** process improvement, automation

### [Cost Savings] Reduced vendor review cycle

**Source:** Acme Corp, 2025

**S (Situation):** Vendor contract review was slow and manual.

**T (Task):** Speed up the review cycle.

**A (Action):** I reduced review turnaround by 60% through a standardized checklist.

**R (Result):** Vendor onboarding sped up considerably.

**Reflection:** N/A

**Best for questions about:** efficiency

### [Unverifiable] Claim with no cv.md backing

**Source:** Acme Corp, 2025

**S (Situation):** A different recurring task existed.

**T (Task):** Improve it.

**A (Action):** I cut this task from 15 hours to 3 hours.

**R (Result):** Time saved.

**Reflection:** N/A

**Best for questions about:** efficiency

### [Missing Wage] Claim verified but no wage supplied

**Source:** Acme Corp, 2025

**S (Situation):** A recurring reporting task existed.

**T (Task):** Streamline it.

**A (Action):** I cut the reporting process from 10 hours to 4 hours, done daily.

**R (Result):** Reporting sped up.

**Reflection:** N/A

**Best for questions about:** efficiency

### [Missing Frequency] Claim verified but no frequency supplied or stated

**Source:** Acme Corp, 2025

**S (Situation):** A recurring audit task existed.

**T (Task):** Streamline it.

**A (Action):** I cut the audit process from 20 hours to 5 hours.

**R (Result):** Audits sped up.

**Reflection:** N/A

**Best for questions about:** efficiency
`;

// cv.md backs the FIRST and FOURTH and FIFTH claims' numbers exactly
// (8h/2h, 10h/4h, 20h/5h) but never mentions 15h or 3h — the "Unverifiable"
// story's numbers are deliberately absent so the safety-gate test has
// something real to exclude.
const CV_FIXTURE = `
# Yuting Sun

## Experience

- Cut onboarding paperwork processing from 8 hours to 2 hours per batch via a template automation.
- Reduced a manual reporting process from 10 hours to 4 hours through streamlining.
- Cut a recurring audit process from 20 hours to 5 hours.
`;

function selfTest() {
  const assert = (cond, msg) => {
    if (!cond) { console.error(`SELF-TEST FAIL: ${msg}`); process.exit(1); }
  };

  // extractQuantifiedClaims
  const claims = extractQuantifiedClaims('I cut a recurring process from 8 hours to 2. Then reduced errors by 60%.', 'Test Story');
  assert(claims.length === 2, `expected 2 claims, got ${claims.length}`);
  const trClaim = claims.find(c => c.type === 'time-reduction');
  assert(trClaim.before.value === 8 && trClaim.before.unit === 'hours', 'before = 8 hours');
  assert(trClaim.after.value === 2 && trClaim.after.unit === 'hours', 'omitted second unit inherits first (hours)');
  const pctClaim = claims.find(c => c.type === 'percent-reduction');
  assert(pctClaim.percent === 60, 'percent claim = 60');

  // verifyClaim
  const verifiedOk = verifyClaim({ type: 'time-reduction', before: { value: 8 }, after: { value: 2 } }, CV_FIXTURE);
  assert(verifiedOk.verified === true, '8h/2h verified against cv.md fixture');
  const verifiedFail = verifyClaim({ type: 'time-reduction', before: { value: 15 }, after: { value: 3 } }, CV_FIXTURE);
  assert(verifiedFail.verified === false, '15h/3h NOT in cv.md fixture -> excluded');

  // Boundary-aware matching (CodeRabbit finding #1 on PR #2950): a claim of
  // "8 hours" must NOT verify against cv.md text that only contains
  // "18 hours" (unbounded substring match would incorrectly say it does).
  // Same for "60%" not matching inside "160%".
  const boundaryHourFail = verifyClaim(
    { type: 'time-reduction', before: { value: 8 }, after: { value: 2 } },
    'The old process took 18 hours and now takes 12 hours.'
  );
  assert(boundaryHourFail.verified === false, '"8 hours" must not verify inside "18 hours" (substring collision)');
  const boundaryPercentFail = verifyClaim(
    { type: 'percent-reduction', percent: 60 },
    'Throughput improved by 160% last quarter.'
  );
  assert(boundaryPercentFail.verified === false, '"60%" must not verify inside "160%" (substring collision)');
  // Sanity: the same variants DO verify when genuinely present with a boundary.
  const boundaryHourOk = verifyClaim(
    { type: 'time-reduction', before: { value: 8 }, after: { value: 2 } },
    'Cut the process from 8 hours to 2 hours.'
  );
  assert(boundaryHourOk.verified === true, '"8 hours" still verifies against genuine "8 hours" text');

  // resolveFrequency / resolveWage — never guess
  assert(resolveFrequency('no frequency mentioned here', {}) === null, 'no frequency source -> null, not guessed');
  assert(resolveFrequency('this happens weekly', {}).occurrencesPerYear === 52, 'frequency read from story text');
  assert(resolveFrequency('nothing here', { frequency: 'monthly' }).occurrencesPerYear === 12, 'frequency read from CLI flag');
  assert(resolveWage('no wage mentioned', {}) === null, 'no wage source -> null, not guessed');
  assert(resolveWage('paid at $45/hr for this role', {}).hourlyWage === 45, 'wage read from story text');
  assert(resolveWage('nothing here', { wage: 50 }).hourlyWage === 50, 'wage read from CLI flag');

  // Full pipeline — golden test
  const result = analyze(STORY_BANK_FIXTURE, CV_FIXTURE, { wage: 40 }); // global wage fallback; frequency only from story text
  assert(result.storiesScanned === 5, `5 stories scanned, got ${result.storiesScanned}`);

  // Fixture 1: verified (8h/2h in cv.md) but this story states no frequency
  // and no --frequency/--occurrences flag was passed -> uncalculable.
  const onboarding = result.uncalculable.find(u => u.story.includes('Cut onboarding paperwork time'));
  assert(onboarding, 'onboarding claim verified but present in uncalculable (no frequency)');
  assert(/frequency/.test(onboarding.reason), `onboarding reason mentions frequency, got: ${onboarding.reason}`);

  // Fixture 2 (percent-reduction, 60%): verified? cv.md fixture never states
  // "60%" -> excluded by the safety gate, not present anywhere in output.
  assert(!result.calculable.some(c => c.story.includes('Reduced vendor review cycle')), 'unverified percent claim excluded from calculable');
  assert(!result.uncalculable.some(u => u.story.includes('Reduced vendor review cycle')), 'unverified percent claim excluded from uncalculable too — gate is silent exclusion');

  // Fixture 3: numbers (15h/3h) never appear in cv.md -> excluded entirely,
  // must not leak into calculable OR uncalculable. Core safety-gate test.
  assert(!result.calculable.some(c => c.story.includes('Unverifiable')), '15h/3h claim excluded from calculable');
  assert(!result.uncalculable.some(u => u.story.includes('Unverifiable')), '15h/3h claim excluded from uncalculable');
  assert(result.excludedUnverified >= 1, 'excludedUnverified count reflects the gated claim');

  // Fixture 4: verified (10h/4h in cv.md), story says "daily" -> frequency
  // resolved from story text, wage from CLI --wage 40 -> fully calculable.
  const reporting = result.calculable.find(c => c.story.includes('Missing Wage'));
  assert(reporting, 'reporting claim (10h/4h, daily, wage from CLI) is calculable');
  assert(reporting.calculation.hoursSavedPerOccurrence === 6, '10h - 4h = 6h saved');
  assert(reporting.calculation.occurrencesPerYear === 260, 'daily -> 260/year');
  assert(reporting.calculation.hourlyWage === 40, 'wage from CLI --wage fallback');
  assert(reporting.calculation.annualValue === 6 * 40 * 260, 'annual value = hours x wage x occurrences');
  assert(/does not judge whether this achievement/.test(reporting.draftParagraph), 'draft paragraph carries the transferability reminder');

  // Fixture 5: verified (20h/5h in cv.md) but no frequency stated in story
  // AND no CLI --frequency/--occurrences passed in this run -> uncalculable.
  const audit = result.uncalculable.find(u => u.story.includes('Missing Frequency'));
  assert(audit, 'audit claim verified but uncalculable (missing frequency)');
  assert(/frequency/.test(audit.reason), `audit reason mentions frequency, got: ${audit.reason}`);

  // Now supply --frequency explicitly and confirm the same claim becomes calculable.
  const result2 = analyze(STORY_BANK_FIXTURE, CV_FIXTURE, { wage: 40, frequency: 'quarterly' });
  const auditCalc = result2.calculable.find(c => c.story.includes('Missing Frequency'));
  assert(auditCalc, 'audit claim becomes calculable once --frequency is supplied');
  assert(auditCalc.calculation.occurrencesPerYear === 4, 'quarterly -> 4/year');
  assert(auditCalc.calculation.hoursSavedPerOccurrence === 15, '20h - 5h = 15h saved');

  // No wage at all -> every verified time-reduction claim is uncalculable for
  // the missing-wage reason, never a guessed dollar figure.
  const result3 = analyze(STORY_BANK_FIXTURE, CV_FIXTURE, {});
  assert(result3.calculable.length === 0, 'zero calculable claims with no wage basis anywhere');
  assert(result3.uncalculable.every(u => u.claimType !== 'time-reduction' || /wage/.test(u.reason)), 'every time-reduction claim blocked on missing wage, not silently defaulted');

  // parsePositiveNumberFlag (CodeRabbit finding #2 on PR #2950): malformed,
  // negative, zero, and non-finite CLI values must be rejected, not silently
  // truncated to a leading numeric prefix.
  assert(parsePositiveNumberFlag(undefined, '--wage').error === null, 'flag not passed -> no error, value null');
  assert(parsePositiveNumberFlag(undefined, '--wage').value === null, 'flag not passed -> value null');
  assert(parsePositiveNumberFlag('40', '--wage').value === 40, 'valid numeric string parses');
  assert(parsePositiveNumberFlag('40usd', '--wage').error !== null, '"40usd" rejected, not silently parsed as 40');
  assert(parsePositiveNumberFlag('-10', '--wage').error !== null, 'negative value rejected');
  assert(parsePositiveNumberFlag('Infinity', '--wage').error !== null, 'Infinity rejected');
  assert(parsePositiveNumberFlag('0', '--wage').error !== null, 'zero rejected');
  assert(parsePositiveNumberFlag('40usd', '--occurrences').error !== null, '"40usd" rejected for --occurrences too');
  assert(parsePositiveNumberFlag('-10', '--occurrences').error !== null, 'negative rejected for --occurrences too');
  assert(parsePositiveNumberFlag('Infinity', '--occurrences').error !== null, 'Infinity rejected for --occurrences too');

  // A standalone trailing --wage/--occurrences with no value must error, not
  // silently fall through to "flag absent" (CodeRabbit follow-up, PR #2950).
  // This lives in main()'s CLI parsing, which calls process.exit() on error,
  // so it has to be exercised as a real subprocess rather than in-process.
  const selfPath = fileURLToPath(import.meta.url);
  const trailingWage = spawnSync(process.execPath, [selfPath, '--wage'], { encoding: 'utf-8' });
  assert(trailingWage.status === 1, `trailing --wage with no value must exit 1, got ${trailingWage.status}`);
  assert(/--wage requires a value/.test(trailingWage.stderr || ''), 'trailing --wage error message names the flag');
  const trailingOcc = spawnSync(process.execPath, [selfPath, '--occurrences'], { encoding: 'utf-8' });
  assert(trailingOcc.status === 1, `trailing --occurrences with no value must exit 1, got ${trailingOcc.status}`);
  assert(/--occurrences requires a value/.test(trailingOcc.stderr || ''), 'trailing --occurrences error message names the flag');

  console.log('negotiation-roi self-test OK (extraction + verification gate + boundary matching + wage/frequency invariants + calculation + draft paragraph + CLI flag validation)');
}

// ── CLI ────────────────────────────────────────────────────────────────

function printSummary(result) {
  console.log('\nNEGOTIATION ROI — talking points anchored in verified achievements\n');
  console.log(`  Stories scanned: ${result.storiesScanned}`);
  console.log(`  Quantified claims found: ${result.claimsFound}`);
  console.log(`  Verified against cv.md: ${result.verified}`);
  console.log(`  Excluded (no verbatim match in cv.md): ${result.excludedUnverified}`);

  if (result.calculable.length) {
    console.log('\n  Draft talking points:\n');
    for (const c of result.calculable) {
      console.log(`  ── ${c.story} ──`);
      console.log(`  ${c.draftParagraph.replace(/\n/g, '\n  ')}`);
      console.log('');
    }
  } else {
    console.log('\n  No calculable talking points yet.');
  }

  if (result.uncalculable.length) {
    console.log('  Verified but not calculable:');
    for (const u of result.uncalculable) {
      console.log(`    - ${u.story} (${u.claimType}): ${u.reason}`);
    }
    console.log('');
  }

  if (result.warnings.length) {
    console.log('  Warnings:');
    for (const w of result.warnings) console.log(`    ⚠ ${w}`);
    console.log('');
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) { selfTest(); return; }

  // Argument validation runs before any filesystem/live-data requirement, so
  // a malformed flag fails fast with a clear error rather than being masked
  // by an unrelated "story-bank.md not found" message (also makes this path
  // testable without needing real user-layer fixtures on disk).
  //
  // A standalone trailing flag (e.g. `--wage` with nothing after it) makes
  // flagValue() return undefined — indistinguishable, on its own, from the
  // flag never being passed at all. hasFlag() sees the bare flag either way,
  // so hasFlag() true + flagValue() undefined means "present but missing its
  // value", which must error rather than silently fall through to "absent"
  // (CodeRabbit, PR #2950).
  const wageRaw = flagValue(args, '--wage');
  if (hasFlag(args, '--wage') && wageRaw === undefined) {
    console.error('Error: --wage requires a value.');
    process.exit(1);
  }
  const occRaw = flagValue(args, '--occurrences');
  if (hasFlag(args, '--occurrences') && occRaw === undefined) {
    console.error('Error: --occurrences requires a value.');
    process.exit(1);
  }

  if (!existsSync(STORY_BANK_PATH)) {
    console.error(`Error: ${STORY_BANK_PATH} not found.`);
    console.error('Run /career-ops interview-prep on a role first to populate your story bank.');
    process.exit(1);
  }
  if (!existsSync(CV_PATH)) {
    console.error(`Error: ${CV_PATH} not found — this is a user-layer file, create it first.`);
    process.exit(1);
  }
  const wageParsed = parsePositiveNumberFlag(wageRaw, '--wage');
  if (wageParsed.error) {
    console.error(`Error: ${wageParsed.error}`);
    process.exit(1);
  }
  const wage = wageParsed.value;

  const frequency = flagValue(args, '--frequency') ?? null;
  if (frequency && !Object.hasOwn(FREQUENCY_MAP, frequency)) {
    console.error(`Error: --frequency must be one of ${Object.keys(FREQUENCY_MAP).join(', ')}, got "${frequency}"`);
    process.exit(1);
  }

  const occParsed = parsePositiveNumberFlag(occRaw, '--occurrences');
  if (occParsed.error) {
    console.error(`Error: ${occParsed.error}`);
    process.exit(1);
  }
  const occurrencesPerYear = occParsed.value;

  const storyBankText = readFileSync(STORY_BANK_PATH, 'utf-8');
  const cvText = readFileSync(CV_PATH, 'utf-8');
  const result = analyze(storyBankText, cvText, { wage, frequency, occurrencesPerYear });

  if (hasFlag(args, '--summary')) {
    printSummary(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

if (isMainModule(import.meta.url)) {
  main();
}
