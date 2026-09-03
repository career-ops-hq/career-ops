#!/usr/bin/env node

/**
 * Verify generated candidate-facing documents against the user's source facts.
 *
 * The CLI remains useful for CVs, while the exported verifyFacts function is
 * shared by PDF generators so every generated document gets the same gate.
 *
 * Usage:
 *   node verify-cv-facts.mjs <generated-cv.html|md|tex>
 *   node verify-cv-facts.mjs <generated-cv> --source cv.md --source article-digest.md
 *   node verify-cv-facts.mjs --self-test
 */

import { existsSync, readFileSync } from 'fs';
import { isAbsolute, join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { isMainModule } from './lib/is-main-module.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCES = ['cv.md', 'article-digest.md'];
const DEFAULT_CONFIG = join(ROOT, 'config', 'cv-facts.json');
const TOOL_PROSE_WORDS = new Set([
  'a', 'an', 'and', 'at', 'built', 'by', 'containerized', 'deployment',
  'deployments', 'for', 'from', 'in', 'of', 'on', 'production', 'project',
  'team', 'the', 'to', 'using', 'with',
]);
const TOOL_PHRASE_PATTERN = /^(?=.{1,80}$)[\p{L}\p{N}.][\p{L}\p{N}+#./-]*(?:\s+[\p{L}\p{N}.][\p{L}\p{N}+#./-]*){0,2}$/u;
const DELEGATED_PARTY_RE = /\b(?:vendors?|agenc(?:y|ies)|contractors?|consultanc(?:y|ies)|consultants?|external teams?|outsourc(?:ed|ing)|implementation partners?)\b/i;
const DELEGATION_RE = /\b(?:commissioned|coordinated|directed|engaged|hired|managed|oversaw|partnered with|supervised)\b/i;
const DIRECT_AUTHORSHIP_SIGNAL_RE = /\b(?:authored|built|coded|developed|engineered|implemented|programmed|wrote)\b/i;
const THIRD_PARTY_EXECUTION_RE = /\b(?:vendors?|agenc(?:y|ies)|contractors?|consultanc(?:y|ies)|consultants?|external teams?|outsourc(?:ed|ing)|implementation partners?)\b[^.;!?]{0,120}\b(?:which|who|that)\b[^.;!?]{0,120}\b(?:authored|built|coded|developed|engineered|implemented|programmed|wrote)\b/i;
const DIRECT_AUTHORSHIP_CLAIM_RE = /\b(authored|built|coded|developed|engineered|implemented|programmed|wrote)\b\s+(?:the\s+|an?\s+|my\s+|our\s+)?([^.;!?]{1,160})/giu;
const ATTRIBUTION_STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'authored', 'build', 'built', 'by', 'coded',
  'commissioned', 'coordinated', 'created', 'developed', 'directed', 'engineered',
  'engaged', 'for', 'from', 'hired', 'implemented', 'in', 'managed', 'my', 'of',
  'on', 'our', 'oversaw', 'partnered', 'programmed', 'supervised', 'the', 'through',
  'to', 'vendor', 'vendors', 'with', 'wrote',
]);
const METRIC_NOUNS = [
  'users', 'customers', 'clients', 'employees', 'engineers', 'teams', 'companies',
  'partners', 'organizations', 'organisations', 'brands', 'countries',
  'hours', 'days', 'weeks', 'months', 'years', 'minutes', 'seconds',
  'requests', 'tokens', 'documents', 'workflows', 'pipelines', 'agents',
  'interviews', 'applications', 'offers', 'reports', 'cvs', 'resumes',
  'enrollments', 'enrolments', 'completions', 'courses', 'certifications',
  'certificates', 'sessions', 'responses', 'surveys', 'cohorts',
  'commits', 'contributions', 'repositories', 'repos', 'modules', 'tools',
  'servers', 'guides', 'articles', 'datasets', 'examples', 'deployments',
  'services', 'downloads', 'stars', 'lines', 'projects', 'integrations', 'tests',
  // Headcount outside software. The list above counts users, engineers and
  // repos, so a CV in operations, facilities, healthcare, education or the
  // trades produced NO claim for the one number those CVs actually inflate:
  // how many people were managed. "Managed 45 staff" against a source saying
  // 20 passed the gate silently, which is the exact fabrication class this
  // script exists to catch.
  'staff', 'personnel', 'people', 'technicians', 'operators', 'contractors',
  'vendors', 'scientists', 'researchers', 'volunteers', 'students', 'patients',
  'crew',
  // Physical assets and scale, for the same reason.
  'facilities', 'sites', 'buildings', 'rooms', 'labs', 'laboratories', 'plants',
  'machines', 'devices', 'instruments', 'vehicles', 'units', 'locations',
  'acres', 'hectares', 'shifts', 'rounds', 'inspections', 'audits', 'incidents',
  'alarms', 'tickets',
  // Education and training, for the same reason as the headcount block above.
  // 'students' and 'staff' were already here, but the nouns an education or
  // L&D CV actually inflates were not: how many people were put through a
  // program and how many sites it covered. "Trained 900+ candidates across 60
  // schools" against a source saying 250 and 20 passed the gate in silence.
  'candidates', 'trainees', 'learners', 'participants', 'attendees',
  'graduates', 'alumni', 'teachers', 'instructors', 'educators', 'faculty',
  'schools', 'districts', 'campuses', 'classrooms', 'programs', 'programmes',
  'workshops', 'assessments', 'exams',
];
// How many words may sit between a number and the noun it counts. The same
// regex parses the generated CV and the sources, so the window is symmetric by
// construction — but a window still decides WHETHER a claim exists, and the CV
// and its source rarely word a fact identically. At {0,2}, "~5 live Cloud Run
// deployments" (three modifiers) yielded no claim while the paraphrase
// "~5 Cloud Run deployments" (two) did, which broke the gate in both
// directions (#2279):
//
//   - a truthful CV failed, because the claim existed on the CV side only;
//   - a CHANGED number passed, because a 3-modifier phrasing on the CV side
//     produced no claim to compare — and catching invented numbers is the
//     entire point of this script.
//
// Four covers the phrasings seen in real CVs ("live Cloud Run deployments",
// "active monthly paying customers"). Widening cannot hide an invented number:
// it only ever extracts MORE claims, on both sides. A number is a hard barrier
// for the chain — modifiers are alphabetic only — so a wider window still
// cannot jump across an intervening figure to bind an unrelated noun.
const MODIFIER_WINDOW = 4;
// The number capture takes an immediately-adjacent magnitude suffix (50k, 1.5M)
// as part of the number, mirroring what the currency pattern below already does.
// Without it the modifier window re-consumed that letter as a generic word, so
// "50k users" normalized to the claim "50 users" and matched a CV that said 50 —
// letting a 1000x inflation through the gate while a smaller "900 users" was
// correctly caught.
//
// `[kKmMbB]\b` requires the suffix to END the token, so "50 million users" (space,
// handled by the modifier window) and "50kg users" (k not at a boundary) both keep
// their existing behaviour and still normalize to "50".
const COUNT_CLAIM_RE = new RegExp(
  // LAZY (`{0,N}?`), so the number binds to the NEAREST noun in the window
  // rather than the farthest. Greedy, the quantifier consumed as many filler
  // words as the window allowed before looking for a noun, and only backtracked
  // if that failed — so whenever two METRIC_NOUNS sat within the window it
  // reported the wrong one (#3414):
  //
  //   "15+ years scaling teams and platforms"        -> 15 platforms, not 15 years
  //   "20+ years leading engineering organizations"  -> 20 organizations, not 20 years
  //
  // The same sentence's plainer paraphrase ("15+ years of experience") produced
  // "15 years", so a truthful line copied verbatim out of cv.md could be flagged
  // as invented: the CV and the source stated the same fact and the extractor
  // read two different claims out of them.
  //
  // Lazy cannot LOSE a claim. Both directions match exactly when some noun sits
  // inside the window; only WHICH one is bound differs, and the nearest is the
  // one a human reads. #2279's wide-window cases are unaffected — "~5 live
  // Cloud Run deployments" still yields "5 deployments", because there is only
  // one noun to bind to.
  String.raw`\b(\d[\d,.]*(?:[kKmMbB]\b)?)\s*\+?\s*(?:[A-Za-z][A-Za-z-]*\s+){0,${MODIFIER_WINDOW}}?(${METRIC_NOUNS.join('|')})\b`,
  'gi'
);
const NOUN_SYNONYMS = new Map([
  ['repos', 'repositories'],
  ['enrolments', 'enrollments'],
  ['organisations', 'organizations'],
  ['cvs', 'resumes'],
  ['certificates', 'certifications'],
  ['articles', 'guides'],
  // A CV and its source rarely word a headcount identically; "20 personnel"
  // restating a source's "20 staff" is a paraphrase, not a fabrication.
  ['personnel', 'staff'],
  ['labs', 'laboratories'],
]);
const SIMPLE_CLAIM_PATTERNS = [
  /\b\d+(?:\.\d+)?\s?%/g,
  /(?<![\w$€£])[$€£]\s?\d[\d,.]*(?:\s?[kKmMbB])?/g,
  /\b\d+(?:\.\d+)?\s?x\b/gi,
];

/** Read a UTF-8 file when it exists, otherwise return an empty string. */
function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

// Unicode decimal-digit blocks, by the code point of their zero. Every claim
// pattern in this file is written with ASCII `\d`, so a CV that spells its
// numbers in any other script produced ZERO claims and the gate reported a
// pass without having checked anything — in ar, hi, ja, zh and zh-TW, all of
// which ship mode sets. NFKC alone is not enough: it folds full-width digits
// (ja/zh) but leaves Arabic-Indic, Persian and Devanagari untouched.
const DIGIT_ZEROS = [
  0x0660, // Arabic-Indic (ar)
  0x06f0, // Extended Arabic-Indic (fa, ur)
  0x0966, // Devanagari (hi)
  0x09e6, // Bengali
  0x0a66, // Gurmukhi
  0x0ae6, // Gujarati
  0x0b66, // Oriya
  0x0be6, // Tamil
  0x0c66, // Telugu
  0x0ce6, // Kannada
  0x0d66, // Malayalam
  0x0e50, // Thai
  0x0ed0, // Lao
  0x0f20, // Tibetan
  0x1040, // Myanmar
  0x17e0, // Khmer
  0x1810, // Mongolian
];

/**
 * Rewrite every Unicode decimal digit as its ASCII counterpart, plus the
 * separators and percent signs that travel with them, so the claim patterns
 * see the same numbers whatever script wrote them.
 *
 * Applied to the generated document AND to the sources, so it can only ever
 * make MORE claims visible on both sides — it cannot hide one.
 *
 * @param {string} text
 * @returns {string}
 */
export function foldDigits(text) {
  // NFKC first: it maps full-width digits and ％ to ASCII outright.
  let out = text.normalize('NFKC');
  out = out.replace(/\p{Nd}/gu, (char) => {
    const cp = char.codePointAt(0) ?? 0;
    if (cp >= 0x30 && cp <= 0x39) return char;
    for (const zero of DIGIT_ZEROS) {
      const value = cp - zero;
      if (value >= 0 && value <= 9) return String(value);
    }
    return char; // a decimal digit from a block we don't list: left as-is
  });
  // Arabic separators and percent sign, which NFKC does not fold either.
  out = out
    .replace(/\u066a/g, '%')   // ٪ Arabic percent sign
    .replace(/\u066b/g, '.')   // ٫ Arabic decimal separator
    .replace(/\u066c/g, ',');  // ٬ Arabic thousands separator
  // A SPACE-grouped thousand ("16 181", common in fr/ru/sv and as NNBSP in
  // typeset text) has to be joined here, before extraction: the claim pattern
  // reads a number as `\d[\d,.]*`, so it would stop at the space and extract
  // "181 users" — a claim the sources never contain, failing a truthful CV.
  // The `(?<!\d)\d{1,3}` guard keeps it to real grouping: in "in 2026 100
  // users" the left part is four digits, so nothing is joined.
  return out.replace(/(?<!\d)(\d{1,3})[\s\u00a0\u202f](?=\d{3}(?!\d))/g, '$1');
}

/** Remove HTML, basic LaTeX commands, and excess whitespace from document text. */
export function stripMarkup(text) {
  return foldDigits(String(text))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    // Only strip things that actually look like tags: `<name …>` or `</name>`.
    // A bare `<` is ordinary prose in these sources (`p<0.001`, `ρ < 0.3`, `<30 min`),
    // and `[^>]` matches newlines — so the old `/<[^>]+>/g` let one stray `<` swallow
    // everything up to the next `>`, deleting real evidence from the allow-list and
    // failing truthful CVs (article-digest.md lost 1,327 chars, incl. two metrics).
    // A BLOCK boundary becomes a sentence break, not a space. Collapsing
    // `</li><li>` to ' ' glues two bullets into one line, and the employer /
    // title captures chain consecutive Capitalised words — so a truthful
    // "…as a Principal Engineer" followed by a bullet starting "Built…" was
    // read as the title "Principal Engineer Built", which no source contains.
    // The markdown sources never had the problem (their newlines break the
    // chain), so the two sides now normalise the same way.
    .replace(/<\/?(?:li|p|div|tr|h[1-6]|section|article|ul|ol|table|br)\b[^>\n]*>/gi, '. ')
    .replace(/<\/?[a-zA-Z][^>\n]*>/g, ' ')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{([^}]*)\})?/g, ' $1 ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a claim for case- and whitespace-insensitive comparison.
 *
 * Thousands separators are removed FIRST, so the same number compares equal
 * however it is grouped: "16,181" / "16 181" / "16181". Without that step the
 * old rule turned "16,181" into "16 181" while an ungrouped source stayed
 * "16181", and the two never matched — a truthful CV failed the gate because
 * of a comma. That bites hardest in the scripts folded above, since Arabic and
 * Devanagari numerals are usually written without a separator at all.
 *
 * Only a separator followed by EXACTLY three digits is removed, so a decimal
 * comma ("1,2 million") and ordinary prose are left alone.
 *
 * The period is in the class for the same reason the comma is, from the other
 * side of the convention: this repo ships mode sets for markets that group
 * with a period, so a JD or a portfolio note written "16.181 users" is a
 * source a CV written "16,181 users" is checked against. Grouping style is not
 * evidence of a different number, and the gate reported one as invented.
 *
 * The three-digit window is what makes this safe to widen: it leaves a genuine
 * decimal alone at every precision a metric noun realistically carries ("2.5
 * hours", "99.95 uptime"). It cannot disambiguate a three-place decimal, where
 * "1.250 million" reads as thousands - an ambiguity the comma branch already
 * carries in the mirror direction, and one no separator rule can resolve
 * without knowing the document's locale. allow_metrics covers the rest.
 */
export function normalizeClaim(claim) {
  return String(claim)
    .toLowerCase()
    .replace(/(\d)[,.\s\u00a0\u202f](?=\d{3}(?!\d))/g, '$1')
    .replace(/[,\s]+/g, ' ')
    .trim();
}

/** Normalize a non-metric fact and remove terminal punctuation. */
function normalizeFact(value) {
  return normalizeClaim(value).replace(/[.;:,]+$/g, '').trim();
}

/** Keep likely technology names while dropping ordinary prose fragments. */
function isLikelyTool(value) {
  const normalized = normalizeFact(value);
  const words = normalized.split(' ');
  if (!normalized || words.length > 3 || words.some(word => TOOL_PROSE_WORDS.has(word))) return false;
  // The surrounding grammar ("using", "built with", "tech stack") already
  // asserts that each short fragment is a tool. Requiring capitalization or a
  // hand-maintained allowlist makes unknown lowercase tools bypass the gate.
  return TOOL_PHRASE_PATTERN.test(value.trim());
}

/** Extract explicitly asserted employer, title, and tool claims from text. */
export function factClaims(text) {
  const clean = stripMarkup(text);
  const claims = [];
  const patterns = [
    // The TRIGGER is case-insensitive, the CAPTURE is not. Both patterns used
    // to be plain /g, so only a lowercase trigger matched — and a CV is
    // written in capitalised bullets, so the phrasings that actually occur
    // were invisible:
    //
    //   "- Worked at Initech as a Principal Engineer"  ->  no claim, gate passed
    //   "he worked at Initech as a Principal Engineer" ->  employer + title
    //
    // A fabricated employer or title therefore shipped unflagged in the
    // spelling CVs use, which is the half of this gate that enforces
    // AGENTS.md's "authorship claims are non-negotiable".
    //
    // The `i` flag is NOT applied to the whole regex on purpose: the capture
    // leans on `[A-Z]` to tell a proper noun from ordinary prose, and making
    // that case-insensitive would read "worked at the office as a manager" as
    // an employer claim. Only the trigger words carry an explicit case class.
    ['employer', /\b(?:[Ww]orked [Aa]t|[Jj]oined|[Ee]mployer\s*:\s*|[Cc]ompany\s*:\s*)\s*([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4})/g],
    // A title may carry a lowercase connector: stopping at it truncated "Head
    // of Data" to "head", which made it indistinguishable from "Head of
    // Engineering" — so an inflated title compared equal to the real one and
    // passed the gate (CodeRabbit review). The connector list is closed and
    // each one must be followed by another Capitalised word, so the capture
    // cannot wander into ordinary prose.
    ['title', /\b(?:[Ss]erved [Aa]s|[Ww]orked [Aa]s|[Tt]itle\s*:\s*|[Rr]ole\s*:\s*)\s*(?:an?\s+|the\s+)?([A-Z][\w/-]*(?:\s+(?:of|for|and|the)\s+[A-Z][\w/-]*|\s+[A-Z][\w/-]*){0,4})|\b(?:[Ww]orked [Aa]t|[Jj]oined)\s+[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4}\s+[Aa]s\s+(?:an?\s+|the\s+)?([A-Z][\w/-]*(?:\s+(?:of|for|and|the)\s+[A-Z][\w/-]*|\s+[A-Z][\w/-]*){0,4})/g],
    ['tool', /\b(?:using|built with|worked with|technologies?\s*:\s*|tech stack\s*:\s*)([^.;\n]+?)(?=\s+\bfor\b|[.;\n]|$)/gi],
  ];
  for (const [kind, pattern] of patterns) {
    for (const match of clean.matchAll(pattern)) {
      const rawText = kind === 'tool' ? match[1].trim() : '';
      const rawValues = kind === 'tool'
        ? (/^the\s+/i.test(rawText) ? [] : rawText.split(/,|\band\b|\bwith\b|\bin\b/i))
        : [match[1] || match[2]];
      for (const raw of rawValues) {
        const value = normalizeFact(raw);
        if (value && (kind !== 'tool' || isLikelyTool(raw))) claims.push({ kind, value });
      }
    }
  }
  return claims;
}

/** Split generated/source documents into bounded statements for attribution checks. */
function factStatements(text) {
  const withLineBoundaries = String(text ?? '').replace(/\r?\n+/g, '. ');
  return stripMarkup(withLineBoundaries)
    .split(/(?:[.!?]\s+|[.!?]$)/u)
    .map(statement => statement.trim())
    .filter(Boolean);
}

/** Return conservative content tokens used only to link a rewrite to its source statement. */
function attributionTokens(text) {
  return normalizeFact(text)
    .split(/[^\p{L}\p{N}+#./-]+/u)
    .filter(token => token.length >= 3 && !ATTRIBUTION_STOP_WORDS.has(token));
}

/**
 * Detect a narrow authorship escalation: a source explicitly attributes
 * execution to a third party, while the generated rewrite claims direct
 * implementation and drops that attribution.
 *
 * This deliberately does not guess from generic leadership prose. It requires
 * a delegation verb, a named third-party role, and at least two shared content
 * tokens between the source and generated statements. Ambiguous source
 * statements that also contain a direct implementation verb are left alone;
 * an explicit relative clause such as "vendor X, which built Y" is treated as
 * third-party execution evidence rather than candidate direct-work evidence.
 */
export function delegatedAuthorshipClaims(targetText, sourceText) {
  const sourceStatements = factStatements(sourceText);
  const directSources = sourceStatements
    .filter(statement => DIRECT_AUTHORSHIP_SIGNAL_RE.test(statement))
    .filter(statement => !THIRD_PARTY_EXECUTION_RE.test(statement))
    .map(statement => new Set(attributionTokens(statement)));
  const delegatedSources = sourceStatements
    .filter(statement => DELEGATED_PARTY_RE.test(statement) && DELEGATION_RE.test(statement))
    .filter(statement => (
      !DIRECT_AUTHORSHIP_SIGNAL_RE.test(statement) || THIRD_PARTY_EXECUTION_RE.test(statement)
    ))
    .map(statement => ({
      statement,
      tokens: new Set(attributionTokens(statement)),
    }));
  if (!delegatedSources.length) return [];

  const claims = [];
  for (const statement of factStatements(targetText)) {
    // Keeping the third-party attribution is not an authorship escalation.
    if (DELEGATED_PARTY_RE.test(statement)) continue;
    DIRECT_AUTHORSHIP_CLAIM_RE.lastIndex = 0;
    for (const match of statement.matchAll(DIRECT_AUTHORSHIP_CLAIM_RE)) {
      const value = normalizeFact(`${match[1]} ${match[2]}`);
      const tokens = [...new Set(attributionTokens(match[2]))];
      if (tokens.length < 2) continue;
      // Explicit direct-work evidence wins over a nearby delegated project
      // that happens to use the same technology or artifact vocabulary.
      if (directSources.some(source => tokens.filter(token => source.has(token)).length >= 2)) {
        continue;
      }
      const delegatedSource = delegatedSources.find(source => (
        tokens.filter(token => source.tokens.has(token)).length >= 2
      ));
      if (delegatedSource) {
        claims.push({ kind: 'authorship', value });
      }
    }
  }
  return claims.filter((claim, index, all) => (
    all.findIndex(other => other.value === claim.value) === index
  ));
}

/** Extract metric-like claims that require source evidence. */
export function metricClaims(text) {
  const clean = stripMarkup(text);
  const claims = new Set();
  for (const pattern of SIMPLE_CLAIM_PATTERNS) {
    for (const match of clean.matchAll(pattern)) claims.add(normalizeClaim(match[0]));
  }
  COUNT_CLAIM_RE.lastIndex = 0;
  for (const match of clean.matchAll(COUNT_CLAIM_RE)) {
    const noun = match[2].toLowerCase();
    claims.add(normalizeClaim(`${match[1]} ${NOUN_SYNONYMS.get(noun) ?? noun}`));
  }
  return claims;
}

// A number counting a word, in ANY script — the language-agnostic SHAPE of the
// claims COUNT_CLAIM_RE recognises only when the noun happens to be English.
// Used solely to answer "were there count claims this gate could not read?",
// never to build a claim: it has no lexicon, so it cannot say what was counted.
const GENERIC_COUNT_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(\d[\d,.]*)\s*\+?\s*(?:[\p{L}][\p{L}\p{M}-]*[\s]+){0,${MODIFIER_WINDOW}}([\p{L}][\p{L}\p{M}]{2,})`,
  'giu',
);
// A year is not a count. "Led the 2024 migration" is the shape above and none
// of its meaning, and every CV has several.
const YEAR_LIKE = /^(?:19|20)\d{2}$/;

/**
 * Count-shaped spans in `text`, whatever language it is written in.
 *
 * @param {string} text
 * @returns {string[]}
 */
function countShapedSpans(text) {
  const clean = stripMarkup(String(text ?? ''));

  // Ranges the language-neutral patterns already own. "$120k and closed a
  // $90,000 deal" is currency followed by prose, and reads as two counts to a
  // detector that only knows "digits, then a word" — but those amounts ARE
  // checked, in every language, so reporting them as unread is a false alarm.
  // Derived from SIMPLE_CLAIM_PATTERNS rather than re-guessed, so the two
  // cannot drift.
  const covered = [];
  for (const pattern of SIMPLE_CLAIM_PATTERNS) {
    for (const m of clean.matchAll(pattern)) covered.push([m.index, m.index + m[0].length]);
  }
  const alreadyChecked = (i) => covered.some(([from, to]) => i >= from && i < to);

  const out = [];
  for (const m of clean.matchAll(GENERIC_COUNT_RE)) {
    if (YEAR_LIKE.test(m[1].replace(/[,.]/g, ''))) continue;
    // The digits are what a simple pattern would have claimed, so test their
    // position, not the span's — the span starts at the number either way, but
    // a currency match starts one character earlier, at the symbol.
    if (alreadyChecked(m.index) || alreadyChecked(m.index + m[0].indexOf(m[1]))) continue;
    out.push(m[0].trim());
  }
  return out;
}

/**
 * Whether this document contains count claims the extractor could not read.
 *
 * METRIC_NOUNS is an English word list, and COUNT_CLAIM_RE's modifier window is
 * `[A-Za-z]`. Percentages, currency and multipliers are language-neutral and
 * still checked everywhere — but a COUNT is checked only in English, and this
 * file's own METRIC_NOUNS comment names counts as the class that gets inflated:
 * "Managed 45 staff against a source saying 20 passed the gate silently, which
 * is the exact fabrication class this script exists to catch."
 *
 * For a CV written in one of the market languages the project ships modes for,
 * that sentence is true of EVERY count, not only the ones outside the list:
 *
 *   ES  "Gestioné 45 empleados en 3 instalaciones."  -> 0 count claims, pass
 *   DE  "Leitete 45 Mitarbeiter an 3 Standorten."    -> 0 count claims, pass
 *   JA  "3拠点で45名のスタッフを管理。"                   -> 0 count claims, pass
 *
 * AGENTS.md makes non-English output a first-class case (`language.output`
 * governs "reports, tracker notes, PDFs, cover letters ... any user-visible
 * prose"), so this is not an edge.
 *
 * Reporting it rather than blocking is the same choice jd-skill-gap.mjs's
 * diagnoseExtraction() and story-provenance-check.mjs's diagnose() make, and
 * for the reason story-provenance states outright: so "an empty/near-empty
 * result isn't misread as 'scanned and clean'". Blocking instead would fail
 * every non-English document, trading a silent gap for a wall.
 *
 * DELIBERATELY CONSERVATIVE. It fires only when the document has two or more
 * count-shaped spans and the extractor produced NO count claim at all — a
 * document where the lexicon reached something is assumed to be reaching it in
 * the language it was written in. Under-reporting is the right direction for a
 * signal added to a gate every generated document already runs.
 *
 * TWO KNOWN BLIND SPOTS, stated rather than implied:
 *
 *   - Coincidental coverage. French "3 sites" matches the English noun, so one
 *     recognised count silences the warning for a French CV whose other counts
 *     are invisible.
 *   - CJK. This detector needs whitespace: it locates a count by a digit run
 *     that is not preceded by a letter and is followed by one. Japanese and
 *     Chinese put digits flush against the surrounding text ("3拠点で45名"),
 *     so the second number is preceded by a letter and is not seen at all.
 *     Relaxing the lookbehind to fix that would match digits inside Latin
 *     identifiers, so it needs script-aware segmentation rather than a looser
 *     regex — separate work, and the reason this is a partial answer.
 *
 * So this closes the silent pass for space-delimited languages (de, es, tr, pt,
 * it, pl, ru, ...). A ja/zh CV can still reach 'pass' unchecked, which is why
 * the real answer is a lexicon those languages are in, not a better detector.
 *
 * @param {string} targetText
 * @returns {{reason: string, message: string, spans: string[]}|null}
 */
export function diagnoseCoverage(targetText) {
  const spans = countShapedSpans(targetText);
  if (spans.length < 2) return null;
  COUNT_CLAIM_RE.lastIndex = 0;
  const recognized = [...stripMarkup(String(targetText ?? '')).matchAll(COUNT_CLAIM_RE)];
  if (recognized.length > 0) return null;
  return {
    reason: 'no-count-claims-recognized',
    message:
      `${spans.length} count-like claims are present but none matched the metric extractor, whose noun ` +
      'list is English-only — so no count in this document was checked against your sources. ' +
      'Percentages, currency and multipliers were still checked. Verify the counts by hand, or add ' +
      'them to allow_metrics in config/cv-facts.json once confirmed.',
    spans,
  };
}

/**
 * Build the allow-list a metric claim is checked against.
 *
 * Claims extracted from text are folded through NOUN_SYNONYMS; allow_metrics
 * entries used to be normalized only, so an exception written in the spelling
 * a human reaches for - `77 repos` - never matched the canonical `77
 * repositories` the extractor produces. The entry then did nothing at all and
 * the CV still failed the gate, with no diagnostic pointing at the allow-list
 * (CodeRabbit, reviewing #2175). A silently inert exception is the same failure
 * class this script exists to catch.
 *
 * Both spellings are added rather than the canonical one alone: metricClaims()
 * yields nothing for an entry no pattern recognizes (a bare `$900k`, a
 * percentage), so replacing normalizeClaim outright would drop those exceptions
 * instead of widening them. The union can only ever allow more, never less.
 */
function allowedMetricSet(sourceText, allowMetrics) {
  const allowed = new Set(metricClaims(sourceText));
  for (const entry of allowMetrics || []) {
    allowed.add(normalizeClaim(entry));
    for (const canonical of metricClaims(String(entry))) allowed.add(canonical);
  }
  return allowed;
}

/** Compare generated metric claims against source text without reading files. */
export function auditClaims(targetText, sourceText, config = {}) {
  const allowed = allowedMetricSet(sourceText, config.allow_metrics);
  const invented = [...metricClaims(targetText)].filter(claim => !allowed.has(claim));
  // Hoisted: stripMarkup re-ran the whole markup pass once per configured
  // phrase (CodeRabbit, reviewing #2175). Same result, one pass.
  const targetPlain = stripMarkup(targetText).toLowerCase();
  const forbidden = (config.forbidden_phrases || [])
    .filter(Boolean)
    .filter(phrase => targetPlain.includes(String(phrase).toLowerCase()));
  return { invented, forbidden };
}

/** Load and validate the optional fact-gate configuration file. */
function loadConfig(path) {
  if (!existsSync(path)) return { allow_metrics: [], allow_facts: [], forbidden_phrases: [], warn_phrases: [] };
  const config = JSON.parse(readFileSync(path, 'utf-8'));
  for (const key of ['allow_metrics', 'allow_facts', 'forbidden_phrases', 'warn_phrases']) {
    if (config[key] == null) config[key] = [];
    else if (!Array.isArray(config[key])) throw new Error(`${key} must be an array in ${path}`);
  }
  return config;
}

/** Resolve a CLI or configuration path relative to the selected working directory. */
function resolveInputPath(path, cwd = process.cwd()) {
  return isAbsolute(path) ? path : join(cwd, path);
}

/** Check a normalized fact as a complete token or phrase, not a substring. */
function sourceContainsFact(sourceText, value) {
  const escaped = value
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}+#/-])${escaped}(?=$|[^\\p{L}\\p{N}+#/-])`, 'iu').test(sourceText);
}

/**
 * @param {string} targetText generated candidate-facing HTML/Markdown/text
 * @param {{ sourcePaths?: string[], configPath?: string, cwd?: string }} options
 * @returns {{ verdict: 'pass'|'warn'|'block', invented: string[], unsupportedFacts: object[], forbidden: string[], warnings: string[] }}
 * @throws when the config is invalid
 */
export function verifyFacts(targetText, {
  sourcePaths = DEFAULT_SOURCES,
  configPath = DEFAULT_CONFIG,
  cwd = process.cwd(),
} = {}) {
  const sourceText = sourcePaths.map(path => readIfExists(resolveInputPath(path, cwd))).join('\n');
  const config = loadConfig(resolveInputPath(configPath, cwd));
  const allowed = allowedMetricSet(sourceText, config.allow_metrics);
  const targetClaims = metricClaims(targetText);
  const invented = [...targetClaims].filter(claim => !allowed.has(claim));
  const sourceNormalized = normalizeFact(stripMarkup(sourceText));
  const allowedFacts = new Set(config.allow_facts.map(normalizeFact));
  const unsupportedFacts = [...factClaims(targetText), ...delegatedAuthorshipClaims(targetText, sourceText)]
    .filter(({ value }) => !sourceContainsFact(sourceNormalized, value) && !allowedFacts.has(value))
    .filter((claim, index, claims) => claims.findIndex(other => other.kind === claim.kind && other.value === claim.value) === index);
  const forbidden = config.forbidden_phrases
      .filter(Boolean)
      .filter(phrase => stripMarkup(targetText).toLowerCase().includes(String(phrase).toLowerCase()));
  const warnings = config.warn_phrases
      .filter(Boolean)
      .filter(phrase => stripMarkup(targetText).toLowerCase().includes(String(phrase).toLowerCase()));
  // Never downgrades a block and never creates one: a document that fails on
  // real evidence still fails on that, and a coverage gap only turns a would-be
  // 'pass' into 'warn' so the caller is told the gate could not read it.
  const coverage = diagnoseCoverage(targetText);
  const blocked = invented.length || unsupportedFacts.length || forbidden.length;
  return {
    verdict: blocked ? 'block' : (warnings.length || coverage) ? 'warn' : 'pass',
    invented,
    unsupportedFacts,
    forbidden,
    warnings,
    coverage,
  };
}

/** Verify a document and throw when it contains a blocking unsupported claim. */
export function assertFacts(targetText, options = {}) {
  const result = verifyFacts(targetText, options);
  if (result.verdict === 'block') {
    const details = [];
    if (result.invented.length) details.push(`metric-like claims absent from sources: ${result.invented.join(', ')}`);
    if (result.unsupportedFacts.length) details.push(`non-metric facts absent from sources: ${result.unsupportedFacts.map(({ kind, value }) => `${kind}=${value}`).join(', ')}`);
    if (result.forbidden.length) details.push(`forbidden phrases found: ${result.forbidden.join(', ')}`);
    throw new Error(`Fact check failed${options.label ? ` for ${options.label}` : ''}: ${details.join('; ')}`);
  }
  return result;
}

/** Parse the fact-validator command-line arguments. */
function parseCliArgs(args) {
  const sourcePaths = [];
  let targetArg = '';
  let configPath = DEFAULT_CONFIG;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--source' || arg === '--config') {
      if (!args[i + 1]) throw new Error(`${arg} requires a path`);
      if (arg === '--source') sourcePaths.push(args[++i]);
      else configPath = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      return { help: true };
    } else if (arg === '--json') {
      json = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else if (!targetArg) {
      targetArg = arg;
    } else {
      throw new Error(`unexpected extra positional argument: ${arg}`);
    }
  }
  return { targetArg, sourcePaths, configPath, json, help: false };
}

/** Return the command-line usage text. */
function usage() {
  return `Usage: node verify-cv-facts.mjs <generated-document> [--source path] [--config path] [--json]
       node verify-cv-facts.mjs --self-test

Checks generated candidate-facing text for unsupported metrics and explicitly asserted
non-metric facts (employers, titles, tools, and delegated-work authorship) absent
from source files.
Default sources: cv.md, article-digest.md
Default config:  config/cv-facts.json (optional)`;
}

/** Exercise the metric extraction regressions that the shared gate depends on. */
function runSelfTest() {
  let passed = 0;
  let failed = 0;
  const equal = (label, actual, expected) => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      passed++;
      return;
    }
    failed++;
    console.error(`FAIL: ${label}`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  actual:   ${JSON.stringify(actual)}`);
  };
  const source = [
    'Reached 16,181 active users and 289,760 enrollments across 80 courses.',
    'Cut infrastructure cost 60%. Managed a $550K budget.',
    'Certified partners earned 2x more. Authored 80+ open-access technical guides.',
  ].join(' ');

  equal('truthful modifier restatement', auditClaims('Reached 16,181 users', source).invented, []);
  // The normalized claim now carries no thousands separator, since grouping no
  // longer decides whether two spellings of the same number match.
  equal('inflated modifier count', auditClaims('Reached 94,772 active users', source).invented, ['94772 users']);
  equal('new training noun', auditClaims('Drove 900,000 enrollments', source).invented, ['900000 enrollments']);
  equal('truthful currency', auditClaims('Managed a $550K budget', source).invented, []);
  equal('inflated currency', auditClaims('Managed a $900K budget', source).invented, ['$900k']);
  equal('truthful multiplier', auditClaims('Partners earned 2x more', source).invented, []);
  equal('noun synonym', auditClaims('Authored 80 articles', source).invented, []);
  equal('ordinary year is ignored', auditClaims('Joined the team in 2013', source).invented, []);

  // The number binds to the NEAREST noun in the window, not the farthest (#3414).
  // Greedy, each of these bound the wrong noun while the SAME fact worded plainly
  // bound the right one — so a truthful line copied verbatim out of cv.md read as
  // a different claim from its own source, and the gate flagged it as invented.
  const claimsOf = (text) => [...metricClaims(text)].sort().join(' | ');
  equal('nearest noun wins over a farther one', claimsOf('15+ years scaling teams and platforms'), '15 years');
  equal('nearest noun wins across three modifiers', claimsOf('20+ years leading engineering organizations'), '20 years');
  equal('the plain phrasing of the same fact agrees', claimsOf('I have 15+ years of experience.'), '15 years');
  // …and the whole point of a truthful restatement passing the gate:
  equal('a verbatim experience line is not invented',
    auditClaims('15+ years scaling teams and platforms', '15+ years of experience.').invented, []);
  // #2279 is why the window is wide: one noun, several modifiers. Lazy must not
  // shrink the reach, only decide which noun wins when there are two.
  equal('a 3-modifier single-noun phrase still resolves', claimsOf('~5 live Cloud Run deployments'), '5 deployments');
  equal('and its 2-modifier paraphrase agrees', claimsOf('~5 Cloud Run deployments'), '5 deployments');
  // A number is a hard barrier for the chain, so two counts stay separate.
  equal('two counts in one sentence stay distinct', claimsOf('8 years supporting 40 engineers'), '40 engineers | 8 years');
  equal(
    'allow_metrics override',
    auditClaims('Reached 94,772 users', source, { allow_metrics: ['94,772 users'] }).invented,
    []
  );
  // An exception is written in the spelling a human reaches for, which is not
  // always the canonical noun the extractor emits. Before the allow-list was
  // folded too, this entry matched nothing and the CV stayed red.
  equal('a synonym-spelled exception is honoured',
    auditClaims('Maintained 77 repositories', source, { allow_metrics: ['77 repos'] }).invented, []);
  equal('the canonical spelling still works',
    auditClaims('Maintained 77 repositories', source, { allow_metrics: ['77 repositories'] }).invented, []);
  // and folding the allow-list must not swallow an entry no claim pattern
  // recognizes, which is what routing it through metricClaims alone would do.
  equal('a currency exception survives the folding',
    auditClaims('Managed a $900K budget', source, { allow_metrics: ['$900K'] }).invented, []);
  equal('an unrelated exception still leaves the claim invented',
    auditClaims('Maintained 77 repositories', source, { allow_metrics: ['12 repos'] }).invented, ['77 repositories']);
  equal(
    'forbidden phrase',
    auditClaims('A proven track record', source, { forbidden_phrases: ['proven track record'] }).forbidden,
    ['proven track record']
  );

  // Non-software domains. METRIC_NOUNS counted users, engineers and repos but
  // not staff, facilities or sites, so an operations/facilities/healthcare CV
  // yielded no claim at all for its headcount — the one number such a CV is
  // most likely to inflate. The gate reported a pass having checked nothing.
  const opsSource = [
    'Managed 20 staff across shift coverage: 8 scientists and 12 support personnel.',
    'Built out four facilities and ran a research program across 45 hectares.',
    'Held temperature setpoints across 3 production rooms.',
  ].join(' ');

  equal('truthful headcount', auditClaims('Managed 20 staff', opsSource).invented, []);
  equal('inflated headcount is caught', auditClaims('Managed 45 staff', opsSource).invented, ['45 staff']);
  equal('inflated specialist count is caught',
    auditClaims('Led 30 scientists', opsSource).invented, ['30 scientists']);
  equal('headcount paraphrase is not a fabrication',
    auditClaims('Managed 20 personnel', opsSource).invented, []);
  equal('inflated site count is caught',
    auditClaims('Built out 12 facilities', opsSource).invented, ['12 facilities']);
  equal('truthful area', auditClaims('Ran a program across 45 hectares', opsSource).invented, []);
  equal('inflated area is caught',
    auditClaims('Ran a program across 450 hectares', opsSource).invented, ['450 hectares']);
  equal('truthful room count', auditClaims('Setpoints across 3 rooms', opsSource).invented, []);
  equal('inflated room count is caught',
    auditClaims('Setpoints across 30 rooms', opsSource).invented, ['30 rooms']);

  // Non-ASCII digits: every claim pattern here is written with ASCII \d, so a
  // CV in ar/hi/ja/zh produced ZERO claims and the gate reported a pass having
  // checked nothing — in five markets this repo ships mode sets for.
  const foldSource = 'Reached 16,181 active users across 80 courses. Cut cost 60%.';
  equal('fabricated full-width metric is caught', auditClaims('Reached ９４，７７２ users', foldSource).invented, ['94772 users']);
  equal('fabricated Arabic-Indic metric is caught', auditClaims('Reached ٩٤٧٧٢ users', foldSource).invented, ['94772 users']);
  equal('fabricated Devanagari metric is caught', auditClaims('Reached ९४७७२ users', foldSource).invented, ['94772 users']);
  equal('fabricated Arabic percentage is caught', auditClaims('Cut cost ٩٩٪', foldSource).invented, ['99%']);
  // …and the folding must not turn a TRUTHFUL localized CV red.
  equal('truthful Arabic-Indic metric passes', auditClaims('Reached ١٦١٨١ users', foldSource).invented, []);
  equal('truthful full-width metric passes', auditClaims('Reached １６，１８１ users', foldSource).invented, []);

  // Thousands grouping must not decide whether a claim matches: the extraction
  // pattern stops at a space, so "16 181 users" used to yield "181 users" — a
  // claim no source contains.
  equal('space-grouped thousands compare equal', auditClaims('Reached 16 181 users', foldSource).invented, []);
  equal('ungrouped compares equal to a grouped source', auditClaims('Reached 16181 users', foldSource).invented, []);
  equal('a fabricated space-grouped number is still caught', auditClaims('Reached 94 772 users', foldSource).invented, ['94772 users']);
  // Multi-group values fold in full: `.replace(/…/g)` evaluates each separator
  // against the ORIGINAL string, where every group is preceded by a space, not
  // a digit, so the lookbehind passes at each one (CodeRabbit asked).
  equal('a multi-group number folds completely', auditClaims('Reached 1 234 567 users', 'Reached 1234567 active users.').invented, []);
  equal('an eight-digit multi-group number folds too', auditClaims('Reached 12 345 678 users', 'Reached 12345678 active users.').invented, []);
  // Period grouping is the convention in several of the markets this repo
  // ships mode sets for, so a period-grouped source and a comma-grouped CV
  // describe the same number and must compare equal in both directions.
  equal('a period-grouped CV matches a comma-grouped source',
    auditClaims('Reached 16.181 users', foldSource).invented, []);
  equal('a comma-grouped CV matches a period-grouped source',
    auditClaims('Reached 16,181 users', 'Reached 16.181 active users.').invented, []);
  equal('a fabricated period-grouped number is still caught',
    auditClaims('Reached 94.772 users', foldSource).invented, ['94772 users']);
  // Widening the class must not eat an ordinary decimal, which is what the
  // exactly-three-digit window is for.
  equal('a decimal is not read as grouping',
    auditClaims('Cut build time to 2.5 hours', 'Cut build time to 2.5 hours.').invented, []);
  // Assert the canonical form directly, not just that the two sides agree:
  // the case above puts '2.5 hours' on BOTH sides of auditClaims, so a
  // regression that stripped the period from every claim would keep them
  // equal and stay green while silently folding 2.5 into 25. Pinning the
  // output of normalizeClaim is what makes this case able to fail.
  equal('an ordinary decimal survives normalization',
    normalizeClaim('2.5 hours'), '2.5 hours');
  // A four-digit left part is a year, not a group: nothing is joined.
  equal('a year is not glued to the next number', auditClaims('Joined in 2026 100 users', foldSource).invented, ['100 users']);

  // The employer/title triggers used to be lowercase-only (plain /g), so the
  // phrasing a CV actually uses — a capitalised bullet — produced NO claim,
  // and a fabricated employer shipped unflagged. This is the half of the gate
  // that enforces "authorship claims are non-negotiable".
  const kinds = (text) => factClaims(text).map((f) => `${f.kind}:${f.value}`);
  equal('a capitalised CV bullet yields employer + title',
    kinds('- Worked at Initech as a Principal Engineer'),
    ['employer:initech', 'title:principal engineer']);
  equal('the lowercase phrasing still works',
    kinds('he worked at Initech as a Principal Engineer'),
    ['employer:initech', 'title:principal engineer']);
  equal('Joined, capitalised', kinds('Joined Globex in 2024'), ['employer:globex']);
  equal('Employer: label, capitalised', kinds('Employer: Initech'), ['employer:initech']);
  // A lowercase connector is part of the title: truncating at it made "Head of
  // Data" and "Head of Engineering" the same claim, so an inflated title
  // matched the real one and passed (CodeRabbit review).
  equal('a connector keeps the title whole', kinds('Served as Head of Data'), ['title:head of data']);
  equal('an inflated title is a different claim', kinds('Served as Head of Engineering'), ['title:head of engineering']);
  equal('a longer title survives too', kinds('Served as Vice President of Sales'), ['title:vice president of sales']);
  // The title expression is duplicated across the two alternatives, so the
  // connector must be covered on the "Worked at X as Y" branch as well — a fix
  // applied to one and not the other would pass every test above (CodeRabbit).
  equal('the connector works on the worked-at branch too',
    kinds('Worked at Initech as Head of Data'),
    ['employer:initech', 'title:head of data']);
  // The capture stays case-SENSITIVE: only the triggers are relaxed, so
  // ordinary prose is never read as an employer or title claim.
  equal('ordinary prose is not a claim', kinds('Worked at the office as a manager'), []);
  equal('ordinary prose, lowercase', kinds('joined the team as a contractor'), []);

  // A block boundary is a sentence break: gluing two list items let the title
  // capture chain across them ("Principal Engineer Built"), a string no source
  // contains — a truthful CV failing the gate.
  equal('a title does not chain across a list-item boundary',
    kinds('<ul><li>Worked at Initech as a Principal Engineer</li><li>Built pipelines</li></ul>'),
    ['employer:initech', 'title:principal engineer']);
  // #2279 — the modifier count must never decide whether a claim exists. The
  // source words the fact with three modifiers, the CV with two: at the old
  // {0,2} window the claim was extracted from the CV side only, and a true
  // statement failed the gate.
  const modifierSource = 'Consolidated 25+ services down to ~5 live Cloud Run deployments.';
  equal(
    'same number, fewer modifiers in the CV',
    auditClaims('25+ services consolidated to ~5 Cloud Run deployments', modifierSource).invented,
    []
  );
  equal(
    'same number, more modifiers in the CV',
    auditClaims('Consolidated to ~5 live production Cloud Run deployments', modifierSource).invented,
    []
  );
  // The direction that matters: a CHANGED number hid behind the 3-modifier
  // phrasing, because the CV side yielded no claim to compare at all.
  equal(
    'changed number behind three modifiers is caught',
    auditClaims('Consolidated to ~9 live Cloud Run deployments', modifierSource).invented,
    ['9 deployments']
  );
  equal(
    'changed number with the plain phrasing is still caught',
    auditClaims('Consolidated to ~9 Cloud Run deployments', modifierSource).invented,
    ['9 deployments']
  );
  // A wider window must not let the chain jump over an intervening figure to
  // bind a number to a noun it does not count. The source states the two facts
  // in SEPARATE sentences on purpose: with identical text on both sides, a
  // wrong "7 hours" extraction would appear on both and cancel itself out, so
  // the assertion would pass while proving nothing. Both nouns are metric
  // nouns, so each real claim is independently evidenced and the only thing
  // that can surface as invented is a cross-number binding.
  const numericBarrierSource = 'Ran 7 tests. Logged 40 hours.';
  equal(
    'a figure still blocks the chain',
    auditClaims('Ran 7 tests over 40 hours', numericBarrierSource).invented,
    []
  );
  equal(
    'no cross-number binding invents evidence',
    auditClaims('Shipped 3 integrations', 'Shipped 3 features across 12 integrations').invented,
    ['3 integrations']
  );

  // A magnitude suffix belongs to the number, not the modifier window. Without
  // that, "50k users" normalized to "50 users" and matched a CV saying 50 — the
  // gate passed a 1000x inflation while catching a smaller "900 users".
  equal(
    'an inflated magnitude suffix is caught',
    auditClaims('Grew the product to 50k users', 'Reached 50 users.').invented,
    ['50k users']
  );
  equal(
    'a magnitude claim the source supports still passes',
    auditClaims('Grew to 50k users', 'Reached 50k users.').invented,
    []
  );
  equal(
    'a lowercase m suffix is caught too',
    auditClaims('Drove 1.5M downloads', 'Drove 50 downloads.').invented,
    ['1.5m downloads']
  );
  equal(
    'an uppercase B suffix is caught too',
    auditClaims('Reached 2B users', 'Reached 1B users.').invented,
    ['2b users']
  );
  // The suffix must END the token, so a spelled-out magnitude and a unit that
  // merely starts with k/m/b keep their previous normalization. Asserting on
  // metricClaims directly (not auditClaims(...).invented) matters here: target
  // and source text are identical, so an empty `invented` list would pass even
  // if metricClaims extracted nothing at all — these assert the real claim a
  // truthful CV would produce.
  equal(
    'a spelled-out magnitude is unaffected',
    [...metricClaims('Reached 50 million users')],
    ['50 users']
  );
  equal(
    'a unit beginning with a suffix letter is unaffected',
    [...metricClaims('Shipped 50kg servers')],
    ['50 servers']
  );

  console.log(`verify-cv-facts self-test: ${passed} passed, ${failed} failed`);
  return failed ? 1 : 0;
}

/** Run the fact validator CLI and return its process exit code. */
export function runCli(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--self-test') return runSelfTest();
  let parsed;
  try {
    parsed = parseCliArgs(args);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    return 1;
  }
  if (parsed.help || !parsed.targetArg) {
    console.log(usage());
    return parsed.help ? 0 : 1;
  }
  const targetPath = resolveInputPath(parsed.targetArg);
  if (!existsSync(targetPath)) {
    console.error(`ERROR: target file not found: ${parsed.targetArg}`);
    return 1;
  }
  try {
    const result = verifyFacts(readFileSync(targetPath, 'utf-8'), {
      sourcePaths: parsed.sourcePaths.length ? parsed.sourcePaths : DEFAULT_SOURCES,
      configPath: parsed.configPath,
    });
    if (parsed.json) {
      console.log(JSON.stringify(result));
      return result.verdict === 'block' ? 1 : 0;
    }
    if (result.verdict === 'pass') {
      console.log(`CV fact check passed: ${basename(targetPath)}`);
      return 0;
    }
    if (result.verdict === 'warn') {
      console.error(`CV fact check warning: ${basename(targetPath)}`);
      for (const phrase of result.warnings) console.error(`  - advisory phrase: ${phrase}`);
      if (result.coverage) {
        console.error(`  - not checked: ${result.coverage.message}`);
        for (const span of result.coverage.spans.slice(0, 8)) console.error(`      ${span}`);
      }
      return 0;
    }
    console.error(`CV fact check failed: ${basename(targetPath)}`);
    if (result.invented.length) {
      console.error('\nMetric-like claims absent from sources:');
      for (const claim of result.invented) console.error(`  - ${claim}`);
    }
    if (result.unsupportedFacts.length) {
      console.error('\nNon-metric facts absent from sources:');
      for (const { kind, value } of result.unsupportedFacts) console.error(`  - ${kind}: ${value}`);
    }
    if (result.forbidden.length) {
      console.error('\nForbidden phrases found:');
      for (const phrase of result.forbidden) console.error(`  - ${phrase}`);
    }
    console.error('\nAdd real evidence to cv.md/article-digest.md, or allow a verified exception in config/cv-facts.json.');
    return 1;
  } catch (err) {
    if (parsed.json) {
      console.log(JSON.stringify({ verdict: 'block', invented: [], unsupportedFacts: [], forbidden: [], warnings: [], coverage: null, errors: [err.message] }));
      return 1;
    }
    console.error(`ERROR: ${err.message}`);
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runCli();
}
