#!/usr/bin/env node

/**
 * prescore.mjs — zero-token heuristic pre-score for one job description.
 *
 * The gate RFC #494 asked for, spun out as #3680: a cheap fit score computed
 * from data already present at intake, so the A-G evaluation is never spent on
 * a posting a human would reject on sight. No network call, no model call: four
 * regex and set-comparison signals over the JD text, config/profile.yml and
 * cv.md.
 *
 * OFF BY DEFAULT, IN CODE. `pipeline.prescore.enabled: true` in config/profile.yml
 * turns it on; with the key absent or false every verdict is `proceed`
 * (`override: 'disabled'`) while the score and signals are still printed, so
 * the gate can be inspected before it is trusted. `modes/pipeline.md` says
 * where it sits in the loop.
 *
 * WHAT IT IS NOT. It does not touch the 1-5 evaluation score, which is a frozen
 * contract (the web viewer, the calibration tools and every tracker row read it
 * with one meaning). The number this script prints is a separate pre-filter
 * figure that never reaches a report, a tracker row or `modes/_shared.md`.
 *
 * THE UNKNOWN RULE. Every signal scores 0-5, and a signal with NO EVIDENCE
 * scores 4, never a neutral 3. The gate exists to drop obvious nos, so a skip has
 * to rest on evidence rather than on the absence of it: a posting that states no
 * salary, or whose requirements section the extractor does not recognize, must
 * survive to full evaluation. Read every `unknown: true` below as "no evidence
 * against".
 *
 * THREE RULES THAT HOLD AT ANY THRESHOLD. The unknown rule alone is arithmetic
 * on the default threshold, and arithmetic stops protecting anyone the moment a
 * user raises `gate_threshold`. So the two invariants that matter are rules on
 * the verdict, not consequences of the weights:
 *
 *   1. A SKIP REQUIRES EVIDENCE. `dominantNegative` must be non-null: at least
 *      one signal with evidence scoring below 4. If every signal is unknown the
 *      verdict is `proceed` however low the score sits (`override: 'no-evidence'`).
 *   2. COMP CANNOT VETO. If compensation is the ONLY signal with evidence below
 *      4, the verdict is `proceed` regardless of threshold (`override:
 *      'comp-only'`). Posted comp is the least reliable field in job data
 *      (absent in a large share of listings, lowballed bands, base-vs-total
 *      ambiguity), so a hard comp filter would enforce the posting's disclosure
 *      habits rather than the user's floor.
 *   3. The weight inequality (1 - w_comp) * 5 >= DEFAULT_THRESHOLD holds and is
 *      asserted, as an independent check on the defaults.
 *
 * FAIL-OPEN IS OPERATIONAL, NOT JUST STATISTICAL. An exception inside any single
 * signal leaves that signal unknown, prints one warning line on stderr, and
 * exits 0 having proceeded. A missing or malformed config/profile.yml, or a
 * missing cv.md, goes further: those two files are what "fit" MEANS here, so
 * without either the verdict is `proceed` outright (`override:
 * 'not-configured'`) rather than a filter run on the half the gate can still
 * see. Only an unreadable JD input is exit 2, and only a failed append to the
 * discard log is exit 3.
 *
 * A KNOWN FAIL-OPEN: requirement coverage is computed over MUST-haves only
 * (`extractJdSkillsByClass` in jd-skill-gap.mjs), and that extractor only sees
 * capitalized tokens under a recognized header. A posting whose bullets read
 * "- python and kubernetes experience" yields nothing, so the requirements
 * signal comes back unknown and the posting proceeds. That is the correct side
 * to fail on.
 *
 * Usage:
 *   node prescore.mjs jds/acme.md
 *   node prescore.mjs jds/acme.md --summary
 *   node prescore.mjs jds/acme.md --url https://acme.example/jobs/1 --company Acme --summary --log
 *   node prescore.mjs - --title "Staff ML Engineer" --company "Acme Corp" < posting.txt
 *   node prescore.mjs /tmp/jd.md --summary --log     # Title:, Company: and URL: lines inside the file
 *   CAREER_OPS_ROOT=/path/to/data node prescore.mjs jds/acme.md --threshold 3.5
 *
 * Exit codes:
 *   0  both verdicts (a skip is a result, not an error) and every fail-open path
 *   1  usage error
 *   2  the JD input could not be read
 *   3  the verdict was `skip` but the discard row could not be appended
 * A NON-ZERO EXIT MEANS PROCEED. A posting is never marked skipped without its
 * audit line, so a caller that cannot read a verdict must send the URL on to
 * full evaluation rather than dropping it.
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import * as yaml from 'js-yaml';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { extractJdSkillsByClass, classifySkillGaps } from './jd-skill-gap.mjs';
import { parseAmount } from './salary-gap.mjs';
import { ROLE_STOPWORDS, BASELINE_TOKENS, normalizeTitle } from './role-matcher.mjs';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

// ── Weights and threshold ────────────────────────────────────────────
//
// The four weights sum to 1.0, so a perfect posting scores 5.0 and the
// all-unknown posting scores 4.0. They are literal constants and are NOT
// renormalized at runtime: renormalizing would quietly absorb an edit to comp's
// weight, which is the one number the weight inequality depends on.
// tests/prescore.test.mjs pins both the sum and that inequality.
export const WEIGHTS = Object.freeze({
  title: 0.35,
  requirements: 0.35,
  domain: 0.10,
  comp: 0.20,
});

/**
 * Default gate threshold, borrowed from the band this repo already uses.
 *
 * `modes/_brief.template.md`'s Quick Scoring Guide and the two-pass triage gate
 * in `config/profile.example.yml` agree on one boundary: a score below 3.0 is
 * the FAIL band, "does not clear the bar — filtered", and it is the only band
 * filtered silently (3.0 up to the triage threshold is MARGINAL and is shown to
 * the user). The pre-score cuts at exactly that line, so a posting it drops
 * silently is one the triage pass would also have dropped silently. Scores are
 * rounded to 0.1 before the comparison, the same as triage.
 *
 * RFC #494 proposed 4.0. That was written for a scale where a missing signal is
 * neutral; here a missing signal scores 4, so a 4.0 gate would skip every
 * posting that merely omits a salary line.
 */
export const DEFAULT_THRESHOLD = 3.0;

/** The score every signal takes when it has no evidence to work with. */
export const UNKNOWN_SCORE = 4;

/**
 * Tie-break order for `dominantNegative` when two signals lose the same
 * weighted score. Fixed and explicit so the reason a posting was skipped is
 * reproducible: title and requirements share a weight, so `title: 1` and
 * `requirements: 1` both lose exactly 1.4 and the winner cannot be left to
 * object key order.
 */
export const SIGNAL_PRIORITY = Object.freeze(['title', 'requirements', 'domain', 'comp']);

/** Score rounding: one decimal, half away from zero, same as triage. */
const roundScore = (n) => Math.round(n * 10) / 10;

/**
 * Dash-like Unicode characters (figure dash, en dash, em dash, horizontal bar)
 * normalized to a plain hyphen. Every evidence string interpolates untrusted JD
 * or profile text (a title, a comp range, a target-role name), and real job
 * titles routinely carry one ("Software Engineer — Backend"), so the "no
 * em-dashes anywhere" promise `summaryLine` makes has to be enforced here.
 */
const DASH_RE = /[\u2012-\u2015]/g;

/** Collapse text to one field-safe line (the discard log is TSV; JDs are untrusted). */
export function sanitizeField(text) {
  return String(text ?? '').replace(DASH_RE, '-').replace(/[\t\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

// ── Role-title normalization ─────────────────────────────────────────

/**
 * Alias table, applied as ordered phrase rewrites so both spellings of one
 * concept land on the same tokens.
 *
 * Deliberately NOT `canonicalize()` from skill-extract.mjs: that maps SKILL
 * tokens ("k8s" -> "Kubernetes") and knows nothing about title vocabulary, and
 * running a title through it would silently rewrite words that mean something
 * else in a job title.
 *
 * Direction matters and is chosen per concept. "swe" expands to "software
 * engineer" because both halves are `GENERIC_TITLE_NOUNS` (defined below, near
 * `scoreTitle`) and must stay generic: the shared-token tier would otherwise
 * treat "swe" as a discriminating overlap. "machine learning" contracts to
 * "ml" for the mirror reason: it IS discriminating, and one token is easier to
 * match than two.
 *
 * Longest phrases first; each rewrite runs once over the space-joined tokens.
 */
const TITLE_ALIASES = Object.freeze([
  ['site reliability', 'sre'],
  ['artificial intelligence', 'ai'],
  ['machine learning', 'ml'],
  // After the two above, so "machine learning ops" has already become "ml ops".
  ['ml ops', 'mlops'],
  ['back end', 'backend'],
  ['front end', 'frontend'],
  ['full stack', 'fullstack'],
  ['dev ops', 'devops'],
  ['swe', 'software engineer'],
]);

/**
 * Function words that survive `ROLE_STOPWORDS` because they are not job
 * vocabulary at all. "Head of Data" and "Director of Sales" share "of", and
 * without this a shared "of" would read as role overlap.
 */
const FUNCTION_WORDS = new Set(['of', 'in', 'on', 'at', 'to', 'for', 'and', 'the', 'a', 'an', 'or', 'with', 'per', 'via']);

/**
 * Fold a value for comparison against ANOTHER arbitrary display string: a JD
 * title against a target role, a scraped company heading against `--company`.
 *
 * Neither side is known to be ASCII the way a hostname or an ATS slug is, so
 * this is not `asciiFold` (lib/ascii-fold.mjs), which deletes every letter
 * outside Latin script: under it a Cyrillic title folds to `''`, and a title
 * that mixes a non-Latin occupation with one Latin token ("Врач AI", "Инженер
 * AI") folds to just that token, so two different occupations compare as
 * identical. `normalizeTitle` from role-matcher.mjs is the fold this repo
 * already uses for title-against-title comparison: lowercase, Latin accents
 * stripped, every other script kept whole (including the combining marks that
 * carry meaning in Devanagari or kana). This adds only the separator collapse,
 * so `/`, `&`, `,` and `-` all become one space; marks are not separators.
 *
 * @param {string} value
 * @returns {string} Non-empty only when `value` has letter or digit content.
 */
export function foldForCompare(value) {
  return normalizeTitle(value).replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

/**
 * Normalize a role title into a comparable phrase and its content tokens.
 *
 * Fold, expand the alias table, then drop seniority / mode / location noise.
 * `text` is space-padded so `includes` is a word-boundary test: " ml engineer "
 * never matches inside "engineering".
 *
 * Reuses `ROLE_STOPWORDS` from role-matcher.mjs, the vocabulary this repo
 * already curates for seniority/mode/location noise, but NOT `roleTokens()`
 * itself, whose `length > 3` filter is calibrated for tracker dedup, where a
 * short token like "ai" or "ml" caused false merges. Here those two are the
 * most discriminating tokens a target role can carry. Nor `BASELINE_TOKENS`
 * as-is: see `GENERIC_TITLE_NOUNS`, near `scoreTitle`.
 *
 * @param {string} title
 * @returns {{text: string, tokens: string[]}} `text` is padded with single
 *   spaces; `tokens` excludes stopwords and function words.
 */
export function normalizeRoleTitle(title) {
  let text = foldForCompare(title);
  if (!text) return { text: '', tokens: [] };

  for (const [from, to] of TITLE_ALIASES) {
    text = ` ${text} `.split(` ${from} `).join(` ${to} `).trim();
  }

  const tokens = text
    .split(' ')
    .filter((w) => w.length >= 2 && !ROLE_STOPWORDS.has(w) && !FUNCTION_WORDS.has(w));

  return { text: ` ${text} `, tokens };
}

// ── Title detection ──────────────────────────────────────────────────

// A labelled title line, which is what the scraped-JD captures in `jds/` and
// most ATS text exports carry. Checked before the markdown heading because a
// capture often opens with the COMPANY as its `# ` heading and states the role
// on a labelled line below it.
const TITLE_LABEL_RE = /^\s*(?:job\s+)?(?:title|role|position)\s*[:\-]\s*(.+)$/im;
// The same shape for the company and the posting URL, read when `--company`
// and `--url` are not given. The three labels let `modes/pipeline.md` hand the
// script the pipeline row's Role, Company and URL inside the JD file, so no
// external text is ever placed on a command line.
const COMPANY_LABEL_RE = /^\s*company\s*[:\-]\s*(.+)$/im;
const URL_LABEL_RE = /^\s*url\s*[:\-]\s*(\S+)/im;
const MD_HEADING_RE = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/;

/**
 * Occupation nouns, software and otherwise, that make a line read as a JOB
 * TITLE rather than a company name or a section header.
 *
 * Deliberately occupation-agnostic and independent of the user's profile. The
 * question this answers is "which line is the title", not "is this a good fit":
 * ranking candidate lines by how well they match `target_roles` would turn title
 * detection into a search for the most flattering reading of the posting, which
 * is the one thing a gate must never do.
 */
const ROLE_NOUN_RE = /\b(?:engineer|engineering|developer|programmer|architect|scientist|analyst|designer|manager|director|lead|head|principal|specialist|consultant|coordinator|administrator|technician|researcher|officer|representative|associate|assistant|intern|apprentice|nurse|physician|surgeon|dentist|pharmacist|practitioner|therapist|counselor|teacher|professor|driver|chef|cook|cashier|barista|accountant|bookkeeper|paralegal|attorney|lawyer|receptionist|janitor|electrician|plumber|welder|carpenter|mechanic|machinist|recruiter|writer|editor|marketer|strategist|advisor|auditor|controller|supervisor|operator|clerk|steward|guard|agent|sre|swe)\b/i;

/** Headings that structure a posting rather than name the job. */
const SECTION_HEADING_RE = /^\s*(?:about|overview|summary|benefits?|perks?|compensation|salary|requirements?|qualifications?|responsibilities|what\s+we|what\s+you|who\s+we|who\s+you|why\s+|our\s+|the\s+team|the\s+role|how\s+we|how\s+to\s+apply|to\s+apply|equal\s+opportunity|job\s+description|role\s+description)\b/i;

/**
 * Common ATS metadata headings ("## Location: Berlin", a Greenhouse and Lever
 * staple). Consulted ONLY by `detectTitle`'s residual fallback, never by
 * `looksLikeTitle`: "Location" is also a real job title ("Location Manager",
 * film and TV production), and folding it into `SECTION_HEADING_RE` would
 * reject that title outright. The fallback has no such risk, because it never
 * runs while a title-shaped heading exists.
 */
const POSTING_METADATA_HEADING_RE = /^\s*(?:location|department|employment\s+type|job\s+type|seniority(?:\s+level)?|reports\s+to|start\s+date|contract\s+type|work\s+arrangement|schedule)\b/i;

/** A job title is short. Twelve words is generous for the decorated ones. */
const MAX_TITLE_WORDS = 12;

/**
 * Is this line shaped like a job title rather than a company or a section?
 *
 * @param {string} line
 * @returns {boolean}
 */
const isTitleLength = (line) => line.trim().split(/\s+/).length <= MAX_TITLE_WORDS;

function looksLikeTitle(line) {
  return isTitleLength(line)
    && !SECTION_HEADING_RE.test(line)
    && ROLE_NOUN_RE.test(line);
}

/**
 * The role title a JD states, or null when it states none.
 *
 * Order: `--title` (the pipeline row's Role column, or the CLI extractor's
 * title) > a labelled `Title:`/`Role:`/`Position:` line > the first heading that
 * reads like a job title > the first heading that is neither the company's own
 * name nor a known section or metadata heading > the first heading other than
 * the company > the first heading > the first line that reads like a job title
 * > the first non-empty line, when it is title-length. A posting collapsed to
 * one line has no title to detect and yields null rather than the posting.
 *
 * The "reads like a job title" step is not cosmetic. Scraped captures very
 * commonly open with the COMPANY as the `# ` heading and put the role in a later
 * heading with no label ("# Northwind Labs" / "## Senior AI Engineer"), and
 * taking the first heading returns the company, which shares no token with any
 * target role, scores the title 1, and can skip a posting the user wants.
 *
 * `ROLE_NOUN_RE` behind that step is an English occupation-noun list, so it
 * cannot recognize a title in any other language, and that is the same capture
 * shape again: a non-English posting whose role heading names no English noun.
 * `company` is the mitigation available without a per-language noun list.
 * `modes/pipeline.md` passes it on every real invocation (it comes from the
 * pipeline row, independent of the posting's language), so when no heading
 * passes the vocabulary test, a heading that IS the known company name is
 * skipped in favour of a different one rather than returned as the title. A
 * heading that reads as a section ("About the Company") or as ATS metadata
 * ("Location") is skipped for the same reason: it is no more likely to be the
 * role than the company heading is. This never inspects `target_roles`; the
 * detector stays occupation-agnostic.
 *
 * @param {string} jdText - Raw JD text.
 * @param {string|null} [explicit] - `--title` override; wins outright.
 * @param {string|null} [company] - The posting's known company name (`--company`),
 *   used only to skip a heading identical to it when nothing looks like a title.
 * @returns {string|null} Trimmed title, or null.
 */
export function detectTitle(jdText, explicit = null, company = null) {
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const text = String(jdText ?? '');

  // A labelled line is trusted only at title length. A capture whose
  // whitespace was collapsed to one line ("Job Title: Senior Engineer Apply
  // now About us ...") would otherwise hand the rest of the posting back as
  // the title, and the title signal would become a body-text search.
  const labelled = TITLE_LABEL_RE.exec(text);
  if (labelled && labelled[1].trim() && isTitleLength(labelled[1])) return labelled[1].trim();

  const lines = text.split('\n');
  const headings = [];
  const plainLines = [];
  for (const line of lines) {
    const heading = MD_HEADING_RE.exec(line);
    if (heading && heading[1].trim()) headings.push(heading[1].trim());
    else if (line.trim()) plainLines.push(line.trim());
  }

  const titledHeading = headings.find(looksLikeTitle);
  if (titledHeading) return titledHeading;

  if (headings.length > 0) {
    // No heading reads like a job title by the English vocabulary above. Still
    // English-only: a non-English section heading is not recognized here and
    // is the same residual gap as an unrecognized non-English title noun.
    const companyFolded = foldForCompare(company);
    const isCompanyHeading = (h) => Boolean(companyFolded) && foldForCompare(h) === companyFolded;
    const isKnownNonTitle = (h) => SECTION_HEADING_RE.test(h) || POSTING_METADATA_HEADING_RE.test(h);
    const best = headings.find((h) => !isCompanyHeading(h) && !isKnownNonTitle(h));
    if (best) return best;
    const other = headings.find((h) => !isCompanyHeading(h));
    if (other) return other;
    return headings[0];
  }

  // No headings at all: a plain-text export. Same preference, bounded to the top
  // of the document so a role noun buried in the body is never mistaken for the
  // title.
  const head = plainLines.slice(0, 5);
  const first = head.find(looksLikeTitle) ?? head[0] ?? null;
  return first !== null && isTitleLength(first) ? first : null;
}

/**
 * Does either title contain the other as a whole phrase?
 *
 * Reverse containment (the target role contains the JD title) is only accepted
 * when the JD title carries at least two content tokens. Without that guard a
 * posting titled "Engineer" would match "Senior AI Engineer" outright, which is
 * the degenerate case the token tier exists to score as a 3.
 *
 * @param {{text: string, tokens: string[]}} jd
 * @param {{text: string, tokens: string[]}} target
 * @returns {boolean}
 */
function titlesOverlapAsPhrase(jd, target) {
  if (!jd.text || !target.text) return false;
  if (jd.text === target.text) return true;
  if (jd.text.includes(target.text)) return true;
  return target.text.includes(jd.text) && jd.tokens.length >= 2;
}

/**
 * Occupation nouns so generic that sharing ONLY one of them does not count as
 * title overlap (#3680: "drop generic engineer/developer/manager when they are
 * the only overlap").
 *
 * role-matcher.mjs's `BASELINE_TOKENS` is the vocabulary this repo already
 * calibrated for "two titles whose only overlap is in this set are not the same
 * opening": "Financial Analyst" and "Data Analyst", "Sales Architect" and
 * "Solutions Architect" share a job-family suffix and nothing else. Four of its
 * entries are dropped here because for a FIT gate they are real signal, not
 * noise: a posting titled "Backend Developer" against a target of "Senior
 * Backend Engineer" shares exactly the word this gate exists to reward.
 * "software" stays generic, which is what lets `TITLE_ALIASES` expand "swe" to
 * "software engineer" without creating overlap.
 */
export const GENERIC_TITLE_NOUNS = new Set(
  [...BASELINE_TOKENS].filter((t) => !['backend', 'frontend', 'platform', 'product'].includes(t)),
);

/**
 * Score the JD title against the user's target roles.
 *
 * 5 = a `target_roles.primary` entry, exactly or as a phrase inside the title.
 * 4 = a `target_roles.archetypes[].name`, same test.
 * 3 = at least one shared CONTENT token, with `GENERIC_TITLE_NOUNS` subtracted
 *     so a shared "engineer" or "manager" alone is not treated as overlap.
 * 1 = no overlap at all.
 * 4 = unknown, when the JD states no title or the profile names no roles.
 *
 * @param {string|null} title - JD title.
 * @param {{primary: string[], archetypes: string[]}} targets
 * @returns {{score: number, evidence: string, unknown: boolean}}
 */
export function scoreTitle(title, targets) {
  const primary = (targets?.primary ?? []).filter((t) => typeof t === 'string' && t.trim());
  const archetypes = (targets?.archetypes ?? []).filter((t) => typeof t === 'string' && t.trim());
  const named = [...primary, ...archetypes];

  if (!title) {
    return { score: UNKNOWN_SCORE, evidence: 'the posting states no title', unknown: true };
  }
  if (named.length === 0) {
    return {
      score: UNKNOWN_SCORE,
      evidence: 'config/profile.yml names no target_roles to compare against',
      unknown: true,
    };
  }

  const jd = normalizeRoleTitle(title);

  for (const role of primary) {
    if (titlesOverlapAsPhrase(jd, normalizeRoleTitle(role))) {
      return { score: 5, evidence: `matches target role "${role}"`, unknown: false };
    }
  }
  for (const role of archetypes) {
    if (titlesOverlapAsPhrase(jd, normalizeRoleTitle(role))) {
      return { score: 4, evidence: `matches archetype "${role}"`, unknown: false };
    }
  }

  const jdTokens = new Set(jd.tokens);
  const shared = new Set();
  for (const role of named) {
    for (const token of normalizeRoleTitle(role).tokens) {
      if (jdTokens.has(token) && !GENERIC_TITLE_NOUNS.has(token)) shared.add(token);
    }
  }
  if (shared.size > 0) {
    return {
      score: 3,
      evidence: `partial overlap with target roles on ${[...shared].map((t) => `"${t}"`).join(', ')}`,
      unknown: false,
    };
  }

  return {
    score: 1,
    evidence: `no overlap between "${title}" and target roles (${named.join(', ')})`,
    unknown: false,
  };
}

// ── Requirements coverage ────────────────────────────────────────────

/**
 * Score how much of the JD's MUST-have list cv.md already supports.
 *
 * Required only, via `extractJdSkillsByClass`. A ratio over the flat list would
 * punish a posting for being generous with its nice-to-haves: two must-haves and
 * eight nice-to-haves would score 20% coverage on a perfect must-have match.
 *
 * No must-have block found, including a posting that states only nice-to-haves,
 * is unknown, not zero coverage.
 *
 * @param {string} jdText
 * @param {string} cvText - cv.md contents; empty when the user has no CV yet.
 * @returns {{score: number, evidence: string, unknown: boolean}}
 */
export function scoreRequirements(jdText, cvText) {
  if (!String(cvText ?? '').trim()) {
    return { score: UNKNOWN_SCORE, evidence: 'no cv.md to compare against', unknown: true };
  }

  const { required, preferred } = extractJdSkillsByClass(String(jdText ?? ''));
  if (required.length === 0) {
    return {
      score: UNKNOWN_SCORE,
      evidence: preferred.length > 0
        ? `the posting names ${preferred.length} nice-to-have(s) and no must-haves`
        : 'no must-have requirements could be extracted from the posting',
      unknown: true,
    };
  }

  const { existing, supportedByResume } = classifySkillGaps(required, cvText);
  const covered = existing.length + supportedByResume.length;
  const coverage = covered / required.length;

  const score = coverage >= 0.75 ? 5
    : coverage >= 0.5 ? 4
      : coverage >= 0.3 ? 3
        : coverage >= 0.15 ? 2
          : 1;

  return {
    score,
    evidence: `cv.md covers ${covered} of ${required.length} must-have requirements (${Math.round(coverage * 100)}%)`,
    unknown: false,
  };
}

// ── Domain ───────────────────────────────────────────────────────────

/**
 * Occupations that are clearly not the software/AI work career-ops targets.
 *
 * Deliberately short, and matched against the TITLE ONLY. Body text is never
 * used: a posting that mentions "accounting software" is a software job, and a
 * denylist run over prose would drop it. Multi-word entries are used wherever
 * the single word is ambiguous in tech ("warehouse associate", not "warehouse",
 * because a Data Warehouse Engineer is squarely on target; "truck driver", not
 * "driver", because device-driver roles exist).
 */
export const NON_SOFTWARE_TITLE_TERMS = Object.freeze([
  // healthcare
  'nurse', 'nursing', 'physician', 'surgeon', 'dentist', 'pharmacist',
  'veterinarian', 'paramedic', 'caregiver', 'phlebotomist', 'radiographer',
  // transport / logistics / facilities
  'truck driver', 'delivery driver', 'bus driver', 'courier',
  'warehouse associate', 'warehouse worker', 'forklift operator', 'janitor',
  'custodian', 'housekeeper', 'groundskeeper',
  // food and retail service
  'cashier', 'barista', 'waiter', 'waitress', 'bartender', 'line cook',
  'sous chef', 'head chef', 'retail associate', 'store associate',
  'sales representative', 'sales associate',
  // trades
  'plumber', 'electrician', 'welder', 'carpenter', 'roofer', 'machinist',
  'auto mechanic', 'hvac technician',
  // office / professional services outside software
  'accountant', 'bookkeeper', 'paralegal', 'attorney', 'notary',
  'receptionist', 'security guard', 'flight attendant', 'firefighter',
  'police officer', 'social worker', 'teacher', 'preschool',
]);

/**
 * Occupation nouns that make a posting a software/data role whatever else the
 * title says. When one of these appears the denylist is not consulted at all:
 * "Nurse Scheduling Platform Engineer" is an engineering job, and "Chef" is a
 * kitchen title and also a configuration-management tool.
 *
 * Nouns only, not qualifiers: "software", "data", "cloud" or "security" in a
 * title do not make it a software job ("Software Sales Representative", "Data
 * Entry Clerk", "Security Guard"), and letting them bypass the denylist would
 * hand the sales and guard postings a free pass past it.
 */
const TECH_ROLE_RE = /\b(?:engineer|engineering|developer|programmer|architect|scientist|devops|sre|sdet|mlops)\b/i;

/**
 * Classify the posting as software-adjacent or clearly not, from the title.
 *
 * 5 = the title names a software/data occupation.
 * 1 = the title names a non-software occupation.
 * 4 = neither: no evidence either way, and unknown when there is no title.
 *
 * @param {string|null} title
 * @returns {{score: number, evidence: string, unknown: boolean}}
 */
export function scoreDomain(title) {
  if (!title) {
    return { score: UNKNOWN_SCORE, evidence: 'no title to classify', unknown: true };
  }
  if (TECH_ROLE_RE.test(title)) {
    return { score: 5, evidence: 'title names a software/data occupation', unknown: false };
  }
  const { text } = normalizeRoleTitle(title);
  for (const term of NON_SOFTWARE_TITLE_TERMS) {
    if (text.includes(` ${term} `)) {
      return {
        score: 1,
        evidence: `title names a non-software occupation ("${term}")`,
        unknown: false,
      };
    }
  }
  return { score: UNKNOWN_SCORE, evidence: 'title names no non-software occupation', unknown: false };
}

// ── Compensation ─────────────────────────────────────────────────────

const SYMBOL_CURRENCY = Object.freeze({ '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' });

const ISO_CODES = [
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK',
  'DKK', 'PLN', 'CZK', 'INR', 'SGD', 'BRL', 'MXN', 'ZAR',
];

const CUR = `[$€£¥]|(?:${ISO_CODES.join('|')})`;
// A number with optional grouping/decimal separators and an optional k suffix.
// `parseAmount` from salary-gap.mjs owns what the separators MEAN (a period is
// thousands grouping in half of Europe); this pattern only has to find the run.
//
// The leading run is unbounded (a plain "150000" must be captured whole), and a
// grouping separator (space, comma or period) counts as part of the SAME number
// only when it is immediately followed by exactly three more digits, the actual
// shape of thousands grouping and the same rule `parseAmount`'s
// `canonicalizeSeparators` applies. Space is a grouping separator in French,
// German and Nordic listings ("75 000 EUR").
const NUM = String.raw`\d+(?:[ ,.]\d{3})*(?:[.,]\d+)?\s*[kK]?`;

// Range connectors between the two bounds: "-"/"to" in English, "et"/"à" in
// French ("entre 75 000 EUR et 90 000 EUR", "de 50 000 EUR à 70 000 EUR"),
// "bis" in German ("80.000 bis 100.000 EUR"). Each alternative is bounded by
// the mandatory `\s*` on both sides, and if no number follows, the optional
// group backtracks away cleanly ("50,000 et al." never partially matches).
const RANGE_CONNECTOR = '(?:[-–—]|to|et|à|bis)';

// Leading currency: "$120,000 - $150,000", "EUR 80k-100k", "£95,000".
const COMP_LEAD_RE = new RegExp(
  `(${CUR})\\s*(${NUM})(?:\\s*${RANGE_CONNECTOR}\\s*(?:${CUR})?\\s*(${NUM}))?`,
  'gi',
);
// Trailing currency: "80.000 - 100.000 EUR", "1,200,000 JPY". Symbols are not
// accepted trailing: "100 $" is rare, and "$" after a number is more often a
// shell prompt or a code sample than a salary. The ISO code is optional after
// the FIRST bound as well, because French postings repeat it on each ("75 000
// EUR et 90 000 EUR"). Capture groups: 1 = lo, 2 = the code repeated after lo
// (ignored), 3 = hi, 4 = the code that closes the match.
const COMP_TRAIL_RE = new RegExp(
  `\\b(${NUM})\\s*(?:(${ISO_CODES.join('|')}))?(?:\\s*${RANGE_CONNECTOR}\\s*(${NUM}))?\\s*(${ISO_CODES.join('|')})\\b`,
  'gi',
);

// Any cadence that is not "per year". A comp figure sitting next to one of
// these is not an annual band and is treated as no evidence, never compared
// against an annual floor.
const NON_ANNUAL_RE = /\b(?:per\s+hour|an\s+hour|hourly|\/\s*(?:hr|hour)|per\s+day|daily|per\s+diem|\/\s*(?:d|day)|per\s+week|weekly|\/\s*(?:wk|week)|per\s+month|monthly|\/\s*(?:mo|month))\b/i;

const CONTEXT_CHARS = 40;

/**
 * India's de-facto annual-comp notation: "12 LPA", "22-28 LPA", "CTC 18 LPA"
 * (Lakhs Per Annum; 1 lakh = 100,000). Matched on its own because a posting or
 * a profile floor written this way virtually never also carries a currency
 * symbol or ISO code: "LPA" already implies INR and an annual cadence.
 *
 * Four digits is more lakhs than any posting states, and the second bound is
 * reached only through a connector, so a long digit run cannot make the two
 * number groups backtrack against each other.
 */
const LPA_NUM = String.raw`\d{1,4}(?:\.\d+)?`;
const LPA_RE = new RegExp(`\\b(${LPA_NUM})(?:\\s*(?:[-–—]|to)\\s*(${LPA_NUM}))?\\s*lpa\\b`, 'gi');
/** The same notation in a single profile value, where one match is all that is wanted. */
const LPA_FLOOR_RE = new RegExp(LPA_RE.source, 'i');
const LPA_MULTIPLIER = 100_000;

/**
 * A stated annual figure smaller than this fraction of the user's own floor is
 * not the salary the user is reading: it is a signing bonus, a learning budget,
 * a stipend, or a funding round captured at the wrong magnitude ("$10 million"
 * matches as 10). Whatever it is, it is not evidence about pay for the role, so
 * `scoreComp` ignores it rather than scoring it as a lowball.
 */
const PLAUSIBLE_FLOOR_FRACTION = 0.25;

/**
 * Normalize a captured currency token to an ISO-4217-style code.
 *
 * @param {string|undefined} token
 * @returns {string|null}
 */
function toCurrencyCode(token) {
  if (!token) return null;
  const trimmed = String(token).trim();
  return SYMBOL_CURRENCY[trimmed] ?? (/^[A-Za-z]{3}$/.test(trimmed) ? trimmed.toUpperCase() : null);
}

/**
 * Hand a captured numeric run (or pair) to salary-gap.mjs's `parseAmount`.
 *
 * `parseAmount` is anchored and accepts `-`, `–` and `—` between the bounds but
 * not the word "to", so the pair is rejoined with a hyphen here. Whitespace
 * inside a run ("120 k") is removed for the same reason.
 *
 * @param {string} lo
 * @param {string|undefined} hi
 * @returns {{min: number, max: number, mid: number}|null}
 */
function parseCapturedRange(lo, hi) {
  const clean = (s) => String(s ?? '').replace(/\s+/g, '');
  const loText = clean(lo);
  if (!loText) return null;
  const hiText = clean(hi);
  return parseAmount(hiText ? `${loText}-${hiText}` : loText);
}

/**
 * Every stated compensation figure in a JD, in document order.
 *
 * A currency marker (or the LPA notation) is required, which is what keeps
 * years, headcounts and version numbers out. A figure sitting next to an
 * hourly/daily/weekly/monthly cadence word is reported separately as
 * `nonAnnual`: that is evidence the posting stated comp, and evidence that it
 * cannot be compared with an annual floor, so `scoreComp` treats it as unknown
 * rather than as a match. Choosing between several annual figures is
 * `scoreComp`'s job, because it needs the user's floor to do it.
 *
 * @param {string} jdText
 * @returns {{annual: Array<{min: number, max: number, open: boolean, currency: string|null, raw: string}>,
 *            nonAnnual: {raw: string}|null}} `open` marks a lower bound with no top ("$100k+").
 */
export function extractJdComp(jdText) {
  const text = String(jdText ?? '');
  const annual = [];
  let nonAnnual = null;

  const consider = (match, currencyToken, lo, hi) => {
    const parsed = parseCapturedRange(lo, hi);
    if (!parsed) return;
    const start = Math.max(0, match.index - CONTEXT_CHARS);
    const context = text.slice(start, match.index + match[0].length + CONTEXT_CHARS);
    if (NON_ANNUAL_RE.test(context)) {
      nonAnnual ??= { raw: match[0].trim() };
      return;
    }
    // "$100k+": a lower bound with no top. Kept apart so a floor above it is
    // read as "no top to compare", never as "top of band below floor".
    const open = text[match.index + match[0].trimEnd().length] === '+';
    annual.push({
      index: match.index,
      min: parsed.min,
      max: parsed.max,
      open,
      currency: toCurrencyCode(currencyToken),
      raw: match[0].trim() + (open ? '+' : ''),
    });
  };

  for (const m of text.matchAll(COMP_LEAD_RE)) consider(m, m[1], m[2], m[3]);
  for (const m of text.matchAll(COMP_TRAIL_RE)) consider(m, m[4], m[1], m[3]);
  for (const m of text.matchAll(LPA_RE)) {
    const lo = Number(m[1]);
    const hi = m[2] !== undefined ? Number(m[2]) : lo;
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    annual.push({
      index: m.index,
      min: Math.min(lo, hi) * LPA_MULTIPLIER,
      max: Math.max(lo, hi) * LPA_MULTIPLIER,
      open: false,
      currency: 'INR',
      raw: m[0].trim(),
    });
  }

  annual.sort((a, b) => a.index - b.index);
  return {
    annual: annual.map(({ index, ...figure }) => figure),
    nonAnnual,
  };
}

/**
 * The user's walk-away number, from `compensation.minimum`.
 *
 * Absent is `null`. Present but unreadable ("TBD", "competitive", a negative
 * number) is returned with `value: null` and the raw text, so `scoreComp` can
 * say which it was: "no floor configured" and "the floor could not be read"
 * call for different fixes in config/profile.yml.
 *
 * @param {object|null} profile - Parsed config/profile.yml.
 * @returns {{value: number|null, currency: string|null, raw: string}|null}
 */
export function profileFloor(profile) {
  const comp = profile?.compensation;
  const raw = comp?.minimum;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const rawText = String(raw).trim();
  const declared = comp?.currency ? String(comp.currency).trim().toUpperCase() : null;

  // "18 LPA": `parseAmount` would strip "LPA" as a generic trailing 3-letter
  // code and read the floor as a bare 18, a number no posting fails to clear.
  const lpa = LPA_FLOOR_RE.exec(rawText);
  if (lpa) {
    const lo = Number(lpa[1]);
    if (Number.isFinite(lo)) {
      return { value: lo * LPA_MULTIPLIER, currency: declared ?? 'INR', raw: rawText };
    }
  }

  const parsed = parseAmount(rawText);
  const symbol = rawText.match(/[$€£¥]/)?.[0];
  return { value: parsed ? parsed.min : null, currency: declared ?? toCurrencyCode(symbol), raw: rawText };
}

/**
 * Score the posting's stated comp against the user's floor.
 *
 * Every path that cannot make a like-for-like comparison scores 4 (unknown):
 * no floor configured or none readable, no figure in the posting, only an
 * hourly/monthly figure, a different currency, or no figure large enough to be
 * an annual salary. There is no FX conversion here and there should not be: a
 * cross-currency comparison would be a guess wearing a number.
 *
 * Among the comparable figures the LARGEST is the band: a salary is never
 * smaller than the bonus or stipend stated beside it, and when the largest
 * figure is the top of a total-comp band, that top is what the tiers below
 * compare anyway. Picking the largest can only err toward proceed. An
 * open-ended band ("$100k+") clears the floor when its start does and is
 * otherwise unknown: there is no top to call "below floor".
 *
 * @param {ReturnType<typeof extractJdComp>} comp
 * @param {ReturnType<typeof profileFloor>} floor
 * @returns {{score: number, evidence: string, unknown: boolean}}
 */
export function scoreComp(comp, floor) {
  if (!floor) {
    return { score: UNKNOWN_SCORE, evidence: 'config/profile.yml states no compensation.minimum', unknown: true };
  }
  if (floor.value === null) {
    return {
      score: UNKNOWN_SCORE,
      evidence: `compensation.minimum "${floor.raw}" in config/profile.yml is not a figure this gate can compare against`,
      unknown: true,
    };
  }
  const annual = comp?.annual ?? [];
  if (annual.length === 0) {
    if (comp?.nonAnnual) {
      return {
        score: UNKNOWN_SCORE,
        evidence: `the posting states a non-annual rate ("${comp.nonAnnual.raw}"), not comparable with an annual floor`,
        unknown: true,
      };
    }
    return { score: UNKNOWN_SCORE, evidence: 'the posting states no compensation', unknown: true };
  }

  const comparable = annual.filter((f) => f.currency && floor.currency && f.currency === floor.currency);
  if (comparable.length === 0) {
    return {
      score: UNKNOWN_SCORE,
      evidence: `posting comp "${annual[0].raw}" is not in the profile currency (${floor.currency ?? 'unset'})`,
      unknown: true,
    };
  }

  const plausible = comparable.filter((f) => f.max >= floor.value * PLAUSIBLE_FLOOR_FRACTION);
  if (plausible.length === 0) {
    return {
      score: UNKNOWN_SCORE,
      evidence: `no stated figure ("${comparable[0].raw}") is large enough to be an annual salary against the ${floor.value} ${floor.currency} floor`,
      unknown: true,
    };
  }

  const band = plausible.reduce((best, f) => (f.max > best.max ? f : best));
  if (band.open) {
    if (band.min >= floor.value) {
      return { score: 5, evidence: `stated band ("${band.raw}") starts at or above the ${floor.value} ${floor.currency} floor`, unknown: false };
    }
    return {
      score: UNKNOWN_SCORE,
      evidence: `the posting states only a lower bound ("${band.raw}") below the ${floor.value} ${floor.currency} floor, with no top to compare`,
      unknown: true,
    };
  }
  if (band.max < floor.value) {
    return {
      score: 1,
      evidence: `top of the stated band ("${band.raw}") is below the ${floor.value} ${floor.currency} floor`,
      unknown: false,
    };
  }
  if (band.max < floor.value * 1.1) {
    return {
      score: 3,
      evidence: `top of the stated band ("${band.raw}") is within 10% of the ${floor.value} ${floor.currency} floor`,
      unknown: false,
    };
  }
  return {
    score: 5,
    evidence: `stated band ("${band.raw}") clears the ${floor.value} ${floor.currency} floor`,
    unknown: false,
  };
}

// ── Profile and brief reading ────────────────────────────────────────

/**
 * Read the target roles a profile declares.
 *
 * @param {object|null} profile
 * @returns {{primary: string[], archetypes: string[]}}
 */
export function profileTargets(profile) {
  const roles = profile?.target_roles;
  const primary = Array.isArray(roles?.primary) ? roles.primary.map((r) => String(r)) : [];
  const archetypes = Array.isArray(roles?.archetypes)
    ? roles.archetypes.map((a) => String(a?.name ?? '')).filter(Boolean)
    : [];
  return { primary, archetypes };
}

const PRIORITY_HEADING_RE = /^\s*#{1,6}\s*priority\s+override\s+list\b/i;

/**
 * Company names from the `## Priority Override List` section of `modes/_brief.md`.
 *
 * The same list `modes/triage.md` honours, read here so the two passes cannot
 * disagree about which companies are always surfaced. Bullets are
 * `- Company — reason`; only the part before the dash is the company. Template
 * placeholders (`- {Company name — reason}`) are skipped, so an unedited
 * `_brief.md` contributes nothing.
 *
 * @param {string} briefText
 * @returns {string[]}
 */
export function parsePriorityOverrides(briefText) {
  const lines = String(briefText ?? '').split('\n');
  const out = [];
  let inSection = false;
  for (const line of lines) {
    if (PRIORITY_HEADING_RE.test(line)) { inSection = true; continue; }
    if (inSection && /^\s*#{1,6}\s/.test(line)) break;
    if (!inSection) continue;
    const bullet = /^\s*[-*•]\s*(.+?)\s*$/.exec(line);
    if (!bullet) continue;
    // A placeholder the user never filled in.
    if (bullet[1].includes('{')) continue;
    const company = bullet[1].split(/\s+[—–-]\s+/)[0].trim();
    if (company) out.push(company);
  }
  return out;
}

/**
 * Is this company on the priority override list?
 *
 * Case- and accent-insensitive, in any script. An entry also matches when it
 * appears as a whole phrase inside the supplied company ("Northwind Labs"
 * matches "Northwind Labs, Inc."), but never the reverse: a one-word
 * `--company` must not match a longer entry it merely prefixes.
 *
 * @param {string|null} company
 * @param {string[]} overrides
 * @returns {string|null} The matching entry, or null.
 */
export function matchPriorityOverride(company, overrides) {
  const folded = foldForCompare(company);
  if (!folded) return null;
  const padded = ` ${folded} `;
  for (const entry of overrides ?? []) {
    const entryFolded = foldForCompare(entry);
    if (!entryFolded) continue;
    if (entryFolded === folded || padded.includes(` ${entryFolded} `)) return entry;
  }
  return null;
}

/**
 * Read `pipeline.prescore.gate_threshold`, saying whether it is usable.
 *
 * A score can only ever be 0-5, so a configured gate outside that range is not
 * a strict setting but a broken one that silently repurposes the gate: 6 skips
 * every posting that has evidence against it however slight, and -1 proceeds
 * on everything while the flag reads as enabled. The whole string has to be a
 * number: `Number.parseFloat("4.5garbage")` would read 4.5 and turn a typo into
 * a different gate with no warning. `--threshold` rejects an unusable value
 * loudly (it is a per-run typo); a config value falls back to the default
 * instead, because failing a whole pipeline run over one profile key would be
 * worse, but the CLI says so.
 *
 * @param {object|null} profile
 * @returns {{raw: unknown, value: number|null, valid: boolean}} `value` is null
 *   when the key is absent (valid) or unusable (invalid).
 */
export function configuredThreshold(profile) {
  const raw = profile?.pipeline?.prescore?.gate_threshold;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { raw: null, value: null, valid: true };
  }
  const text = String(raw).trim();
  const parsed = typeof raw === 'number'
    ? raw
    : (/^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5) {
    return { raw, value: null, valid: false };
  }
  return { raw, value: parsed, valid: true };
}

/**
 * The gate threshold in force: `--threshold` > `pipeline.prescore.gate_threshold`
 * > DEFAULT_THRESHOLD.
 *
 * @param {object|null} profile
 * @param {number|null} [override]
 * @returns {number}
 */
export function resolveThreshold(profile, override = null) {
  if (typeof override === 'number' && Number.isFinite(override)) return override;
  return configuredThreshold(profile).value ?? DEFAULT_THRESHOLD;
}

// ── Assembly ─────────────────────────────────────────────────────────

/**
 * Run one signal, turning any exception into an unknown rather than a crash.
 *
 * Fail-open is the design, and it has to survive a bug too: a regex that throws
 * on one pathological posting must not take the whole pipeline run with it, and
 * must not silently score that posting toward a skip either.
 *
 * @param {string} name
 * @param {() => {score: number, evidence: string, unknown: boolean}} fn
 * @param {string[]} warnings - Collected, printed once by the CLI.
 * @returns {{score: number, evidence: string, unknown: boolean}}
 */
function safeSignal(name, fn, warnings) {
  try {
    return fn();
  } catch (err) {
    const detail = err?.message ?? String(err);
    warnings.push(`the ${name} signal could not be computed (${detail}), scored as unknown`);
    return { score: UNKNOWN_SCORE, evidence: `signal failed: ${detail}`, unknown: true };
  }
}

/**
 * Score one posting.
 *
 * @param {object} input
 * @param {string} input.jdText - Raw JD text.
 * @param {string} [input.cvText] - cv.md contents.
 * @param {object|null} [input.profile] - Parsed config/profile.yml.
 * @param {string|null} [input.title] - `--title` override.
 * @param {string|null} [input.company] - `--company`, for the priority list;
 *   a `Company:` line in the JD is the fallback.
 * @param {string[]} [input.priorityCompanies] - From `modes/_brief.md`.
 * @param {number|null} [input.threshold] - `--threshold` override.
 * @param {string[]} [input.warnings] - Pre-seeded fail-open warnings.
 * @returns {object} See the header for the shape.
 */
export function prescore({
  jdText,
  cvText = '',
  profile = null,
  title = null,
  company = null,
  priorityCompanies = [],
  threshold = null,
  warnings = [],
}) {
  const notes = [...warnings];
  const jd = String(jdText ?? '');
  const knownCompany = (typeof company === 'string' && company.trim())
    ? company.trim()
    : (COMPANY_LABEL_RE.exec(jd)?.[1]?.trim() ?? null);

  // Title detection feeds two signals, so its own failure is handled here rather
  // than inside safeSignal: a null title makes both title and domain unknown,
  // which is the correct fail-open reading of "we could not tell what this
  // posting is for".
  let detected = null;
  try {
    detected = detectTitle(jd, title, knownCompany);
  } catch (err) {
    notes.push(`the posting title could not be detected (${err?.message ?? err}), so title and domain scored as unknown`);
  }

  const signals = {
    // profileTargets() is read INSIDE the guard, not hoisted above it: a profile
    // whose shape surprises us must degrade this one signal to unknown, not take
    // the whole run down.
    title: { ...safeSignal('title', () => scoreTitle(detected, profileTargets(profile)), notes), weight: WEIGHTS.title },
    requirements: { ...safeSignal('requirements', () => scoreRequirements(jdText, cvText), notes), weight: WEIGHTS.requirements },
    domain: { ...safeSignal('domain', () => scoreDomain(detected), notes), weight: WEIGHTS.domain },
    comp: {
      ...safeSignal('comp', () => scoreComp(extractJdComp(jdText), profileFloor(profile)), notes),
      weight: WEIGHTS.comp,
    },
  };

  let raw = 0;
  for (const signal of Object.values(signals)) raw += signal.weight * signal.score;
  const score = roundScore(raw);

  let gate = DEFAULT_THRESHOLD;
  try {
    gate = resolveThreshold(profile, threshold);
  } catch (err) {
    notes.push(`the configured gate threshold could not be read (${err?.message ?? err}), using ${DEFAULT_THRESHOLD}`);
  }

  // Signals that actually argue against the posting: evidence, and below the
  // no-evidence-against baseline of 4.
  const negatives = SIGNAL_PRIORITY.filter((name) => !signals[name].unknown && signals[name].score < UNKNOWN_SCORE);

  // The dominant negative is the signal that cost the most weighted score, so a
  // skip line names the reason a human would have given. Ties break by
  // SIGNAL_PRIORITY, which is the iteration order here, and the comparison is
  // strictly `>` so the earlier signal keeps the slot.
  let dominantNegative = null;
  let worstLoss = 0;
  for (const name of negatives) {
    const loss = signals[name].weight * (5 - signals[name].score);
    if (loss > worstLoss) {
      worstLoss = loss;
      dominantNegative = { signal: name, reason: sanitizeField(signals[name].evidence) };
    }
  }

  // Verdict. The overrides below are rules on the VERDICT, not consequences of
  // the weights, so they hold at any threshold a user configures.
  const priorityHit = matchPriorityOverride(knownCompany, priorityCompanies);
  // The two inputs that define what "fit" MEANS here. Without a profile the gate
  // does not know which roles the user wants; without a CV it cannot tell which
  // requirements they already meet. Missing either is an operational failure, not
  // evidence against a posting, so the gate declines to filter at all rather than
  // filtering on the half it can still see.
  const missingInputs = [];
  if (!profile) missingInputs.push('config/profile.yml');
  if (!String(cvText ?? '').trim()) missingInputs.push('cv.md');

  let verdict;
  let override = null;
  let overrideReason = null;

  if (missingInputs.length > 0) {
    verdict = 'proceed';
    override = 'not-configured';
    overrideReason = `no usable ${missingInputs.join(' or ')}`;
  } else if (profile.pipeline?.prescore?.enabled !== true) {
    // Off by default, enforced here and not only in modes/pipeline.md: a gate
    // that filters when nobody opted in is the one outcome the flag exists to
    // rule out. The score and signals are still reported for inspection.
    verdict = 'proceed';
    override = 'disabled';
    overrideReason = 'gate disabled: pipeline.prescore.enabled is not true';
  } else if (priorityHit) {
    verdict = 'proceed';
    override = 'priority-list';
    overrideReason = `priority list: ${sanitizeField(priorityHit)}`;
  } else if (score >= gate) {
    verdict = 'proceed';
  } else if (dominantNegative === null) {
    // Rule 1: a skip requires evidence. Every signal is unknown, so there is
    // nothing to skip on however low the arithmetic came out.
    verdict = 'proceed';
    override = 'no-evidence';
    overrideReason = 'no evidence against';
  } else if (negatives.length === 1 && negatives[0] === 'comp') {
    // Rule 2: comp cannot veto. It is the only signal arguing against this
    // posting, and posted comp is not reliable enough to end an evaluation.
    verdict = 'proceed';
    override = 'comp-only';
    overrideReason = 'comp cannot veto';
  } else {
    verdict = 'skip';
  }

  return {
    score,
    threshold: gate,
    verdict,
    title: detected,
    company: knownCompany,
    signals,
    dominantNegative,
    override,
    overrideReason,
    warnings: notes,
    discardLogged: false,
  };
}

/**
 * The one-line `--summary` rendering.
 *
 * `prescore {score}/5 {verdict}[ ({override reason})][: {signal}: {reason}]`.
 * No em-dashes anywhere, so the line survives copying into a TSV note or a
 * pipeline row without a second sanitizing pass.
 *
 * @param {ReturnType<typeof prescore>} result
 * @returns {string}
 */
export function summaryLine(result) {
  let line = `prescore ${result.score.toFixed(1)}/5 ${result.verdict}`;
  if (result.overrideReason) line += ` (${result.overrideReason})`;
  if (result.dominantNegative) {
    line += `: ${result.dominantNegative.signal}: ${result.dominantNegative.reason}`;
  }
  return sanitizeField(line);
}

/**
 * The reason written into the discard log and quoted by `modes/pipeline.md`.
 *
 * Self-describing on purpose: `data/discard.log` is shared with the LLM
 * pre-screen gate, and a reader (or `discard-analytics.mjs`) has to be able to
 * tell which pass dropped a posting. Every pre-score row starts `pre-score`.
 *
 * @param {ReturnType<typeof prescore>} result
 * @returns {string}
 */
export function discardReason(result) {
  const head = `pre-score ${result.score.toFixed(1)}/5`;
  if (!result.dominantNegative) return `${head}: below threshold ${result.threshold}`;
  return sanitizeField(`${head}: ${result.dominantNegative.signal}: ${result.dominantNegative.reason}`);
}

/**
 * One discard-log row: `{ISO8601}\t{url}\t{reason}`.
 *
 * Three fields, matching the interactive format in `modes/pipeline.md` and what
 * `discard-analytics.mjs` parses. The four-field variant belongs to
 * `batch/logs/discard.log`, which this script does not write. A URL is required
 * by the parser, so an unknown one is the sentinel `-`.
 *
 * Every field is sanitized: the URL and the reason both carry text that came out
 * of an untrusted posting, and one tab in a scraped title would silently turn a
 * three-field row into a four-field one, which the parser reads as a BATCH row
 * and whose fields it then assigns to the wrong columns.
 *
 * @param {string} timestamp - ISO 8601.
 * @param {string|null} url
 * @param {string} reason
 * @returns {string} The row, newline included.
 */
export function discardLogLine(timestamp, url, reason) {
  return `${sanitizeField(timestamp)}\t${sanitizeField(url) || '-'}\t${sanitizeField(reason)}\n`;
}

// ── CLI ──────────────────────────────────────────────────────────────

const KNOWN_FLAGS = ['--url', '--title', '--company', '--threshold', '--summary', '--log', '--help', '-h'];
const VALUE_FLAGS = ['--url', '--title', '--company', '--threshold'];

const USAGE = `Usage:
  node prescore.mjs <jd-file|-> [options]

Options:
  --url <u>          Posting URL, recorded in the discard log; default: a "URL:" line in the JD
  --title <t>        Role title; default: a "Title:" line in the JD, then the JD's headings
  --company <c>      Company name, for the modes/_brief.md priority list; default: a "Company:" line in the JD
  --threshold <n>    Gate threshold (default ${DEFAULT_THRESHOLD}, or pipeline.prescore.gate_threshold)
  --summary          One human-readable line instead of JSON
  --log              On a skip verdict, append one row to data/discard.log
  --help, -h         This message

config/profile.yml, cv.md and modes/_brief.md are read from the data root
(CAREER_OPS_ROOT, the .career-ops-data marker, or the repository).

Exit codes: 0 both verdicts and every fail-open path, 1 usage error,
2 the JD could not be read, 3 the skip could not be logged.
A non-zero exit means PROCEED: never mark a posting skipped without its audit line.`;

/**
 * The positional JD operand, ignoring flags and their space-separated values.
 *
 * Written out rather than reusing `args.find(a => !a.startsWith('-'))` because
 * `-` IS the operand for stdin, and because `--title Senior Engineer` would
 * otherwise donate "Senior" as the file name.
 *
 * @param {string[]} args
 * @returns {{operand: string|null, flagArgs: string[]}}
 */
export function splitOperand(args) {
  let operand = null;
  const flagArgs = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (VALUE_FLAGS.includes(arg)) {
      flagArgs.push(arg);
      if (args[i + 1] !== undefined && !args[i + 1].startsWith('--')) flagArgs.push(args[++i]);
      continue;
    }
    // A bare `-` is the stdin operand, not a flag. Every OTHER leading-dash
    // token is a flag, including `-h`: treating "starts with a single dash" as
    // "positional" would make `prescore.mjs -h` try to read a file named "-h".
    if (arg === '-' && operand === null) {
      operand = arg;
      continue;
    }
    if (arg.startsWith('-')) {
      flagArgs.push(arg);
      continue;
    }
    if (operand === null) operand = arg;
    else flagArgs.push(arg);
  }
  return { operand, flagArgs };
}

/**
 * Parse `--threshold`. A supplied-but-unusable value is a loud usage error, not
 * a silent fall back to the default: the caller asked for a specific gate.
 *
 * @param {string|undefined} raw
 * @returns {number|null}
 */
function parseThresholdFlag(raw) {
  if (raw === undefined) return null;
  const text = String(raw).trim();
  const value = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
  if (!(value >= 0 && value <= 5)) {
    console.error(`Error: --threshold expects a number between 0 and 5, got "${raw}"`);
    process.exit(1);
  }
  return value;
}

/**
 * Read a YAML file. Absent is silent; malformed is a fail-open warning.
 *
 * @param {string} path
 * @param {string} label - How the file is named in the warning.
 * @returns {{value: object|null, warning: string|null}}
 */
function readYaml(path, label) {
  if (!existsSync(path)) return { value: null, warning: null };
  try {
    const loaded = yaml.load(readFileSync(path, 'utf-8'));
    // YAML that parses to a LIST (`[]`, or a file that is one long bullet list)
    // satisfies `typeof === 'object'`; without the Array check the caller would
    // treat it as a configured profile and let title/domain/requirements
    // evidence produce a skip against a profile shape that names nothing.
    if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
      return { value: loaded, warning: null };
    }
    return { value: null, warning: `${label} did not parse to a mapping, so its signals scored as unknown` };
  } catch (err) {
    return { value: null, warning: `${label} could not be read (${err?.message ?? err}), so its signals scored as unknown` };
  }
}

/**
 * Read a text file, returning '' when absent or unreadable.
 *
 * @param {string} path
 * @param {string} label - How the file is named in the warning.
 * @returns {{value: string, warning: string|null}}
 */
function readTextOrEmpty(path, label) {
  if (!existsSync(path)) return { value: '', warning: null };
  try {
    return { value: readFileSync(path, 'utf-8'), warning: null };
  } catch (err) {
    return { value: '', warning: `${label} could not be read (${err?.message ?? err}), so its signals scored as unknown` };
  }
}

function main() {
  const args = process.argv.slice(2);
  const { operand, flagArgs } = splitOperand(args);
  validateFlags(flagArgs, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });

  if (!operand) {
    console.error(USAGE);
    process.exit(1);
  }

  let jdText;
  try {
    jdText = operand === '-' ? readFileSync(0, 'utf-8') : readFileSync(operand, 'utf-8');
  } catch (err) {
    console.error(`Error: cannot read JD input "${operand}": ${err.message}`);
    process.exit(2);
  }

  const dataRoot = getCareerOpsRoot();
  const warnings = [];
  const profileRead = readYaml(join(dataRoot, 'config/profile.yml'), 'config/profile.yml');
  if (profileRead.warning) warnings.push(profileRead.warning);
  const cvRead = readTextOrEmpty(join(dataRoot, 'cv.md'), 'cv.md');
  if (cvRead.warning) warnings.push(cvRead.warning);
  const briefRead = readTextOrEmpty(join(dataRoot, 'modes/_brief.md'), 'modes/_brief.md');
  if (briefRead.warning) warnings.push(briefRead.warning);

  const profile = profileRead.value;
  const configured = configuredThreshold(profile);
  if (!configured.valid) {
    warnings.push(
      `pipeline.prescore.gate_threshold is "${configured.raw}", which is not a score between 0 and 5; using the default ${DEFAULT_THRESHOLD}`,
    );
  }

  const result = prescore({
    jdText,
    cvText: cvRead.value,
    profile,
    title: flagValue(args, '--title') ?? null,
    company: flagValue(args, '--company') ?? null,
    priorityCompanies: parsePriorityOverrides(briefRead.value),
    threshold: parseThresholdFlag(flagValue(args, '--threshold')),
    warnings,
  });

  // One warning line, whatever went wrong. Several separate lines would make a
  // batch log unreadable and invite a caller to grep for the wrong one.
  // sanitizeField, because a parser's own message is often multi-line (js-yaml
  // prints the offending snippet with a caret).
  if (result.warnings.length > 0) {
    console.error(sanitizeField(`Warning: ${result.warnings.join('; ')}. Proceeding.`));
  }

  let logFailure = null;
  // A priority-list proceed is never logged: it was not filtered, so there is
  // nothing to audit.
  if (hasFlag(args, '--log') && result.verdict === 'skip') {
    const logPath = join(dataRoot, 'data', 'discard.log');
    try {
      mkdirSync(dirname(logPath), { recursive: true });
      appendFileSync(
        logPath,
        discardLogLine(new Date().toISOString(), flagValue(args, '--url') ?? URL_LABEL_RE.exec(jdText)?.[1] ?? null, discardReason(result)),
        'utf-8',
      );
      result.discardLogged = true;
    } catch (err) {
      logFailure = err?.message ?? String(err);
    }
  }

  if (hasFlag(args, '--summary')) console.log(summaryLine(result));
  else console.log(JSON.stringify(result, null, 2));

  if (logFailure !== null) {
    // Exit 3, and the caller must PROCEED. A skip that cannot be written to the
    // audit log is not an auditable skip, and silently dropping the posting is
    // exactly the black box the discard log exists to prevent.
    console.error(`Error: the skip could not be logged to data/discard.log (${logFailure}). Treat this posting as PROCEED.`);
    process.exit(3);
  }
}

if (isMainModule(import.meta.url)) {
  main();
}
