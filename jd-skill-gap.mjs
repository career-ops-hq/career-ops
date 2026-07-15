#!/usr/bin/env node

/**
 * jd-skill-gap.mjs — Zero-LLM JD skill-gap checker.
 *
 * Extracts an explicit skill/requirement list from a JD (regex-based, no LLM
 * call — see extractJdSkills()), then classifies each one against cv.md into
 * three buckets so a CV can be tailored honestly instead of guessed at:
 *
 *   existing            — already a named skill in cv.md's Skills section
 *   supportedByResume    — not a named skill, but appears in prose elsewhere in cv.md
 *   gap                  — JD requires it, cv.md has no trace of it at all
 *   (nothing is ever auto-added — this tool only classifies and reports)
 *
 * Design note: the three-way classification (existing / supportedByResume / gap)
 * is inspired by the skill-verification pattern in srbhr/Resume-Matcher
 * (Apache-2.0) — specifically their four-way verify_skill_target_plan() split.
 * This is an independent reimplementation, not a code port: different language,
 * zero LLM calls, and folded down to three buckets because career-ops never
 * auto-adds a claim to cv.md either way (their jd_added/unsupported distinction
 * only matters if a tool is allowed to add something automatically).
 *
 * Usage:
 *   node jd-skill-gap.mjs jds/acme.md
 *   node jd-skill-gap.mjs jds/acme.md --summary
 *   node jd-skill-gap.mjs --self-test
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';

// ── Config ──────────────────────────────────────────────────────────

const CV_PATH = 'cv.md';

// ── JD skill extraction (regex, no LLM) ─────────────────────────────
//
// Looks for lines/phrases under common JD requirement headers and comma/
// bullet-separated skill lists. Deliberately conservative: under-extracting
// (missing a skill) is recoverable by the user reading the JD themselves;
// over-extracting noise into "required skills" is not — it would misreport
// gaps that aren't real.

const REQUIREMENT_HEADER_RE =
  /^#{0,4}\s*(required|requirements|qualifications|must[- ]have|preferred|nice[- ]to[- ]have)s?\b.*$/im;

const BULLET_LINE_RE = /^\s*[-*•]\s*(.+)$/;

// A conservative skill-token extractor: pulls comma/slash/and-separated
// technical-looking tokens out of a requirement bullet, rather than treating
// the whole bullet as one skill string (JD bullets are often full sentences).
//
// Trailing boundary: \b fails at symbol edges (\bC\+\+\b needs a word char
// AFTER the +), so C++/C#/F# would never match standalone — same bug and fix
// as upskill.mjs's SKILL_PATTERN, where (?!\w) is equivalent to \b for
// word-char edges and correct for symbol edges. Because the char class here
// is greedy and contains ".", the last token char is additionally pinned to
// a word char / # / + so a sentence-ending period is never swallowed into
// the token ("Docker." still extracts as "Docker"). The leading \b stays:
// tokens start with [A-Z], a word char, where \b and (?<!\w) are equivalent.
const SKILL_TOKEN_RE = /\b([A-Z][A-Za-z0-9+.#]{0,29}[A-Za-z0-9+#](?:\.[a-z]{2,4})?)(?!\w)/g;

// Deliberately broad: this list exists specifically to stop generic
// capitalized nouns/adjectives from JD bullets (e.g. "Bachelor's degree
// required", "3+ years of experience") from being misreported as missing
// "skills" — the exact failure mode this file's design note warns against.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'you', 'your', 'our', 'this', 'that', 'these', 'those',
  'must', 'able', 'ability', 'strong', 'excellent', 'proven', 'a', 'an', 'or', 'in', 'of', 'to', 'as', 'is', 'are',
  // degree / education boilerplate
  'bachelor', 'bachelors', 'master', 'masters', 'degree', 'diploma', 'certification', 'certificate',
  // experience / seniority boilerplate
  'experience', 'years', 'year', 'senior', 'junior', 'entry', 'level', 'minimum', 'preferred', 'required',
  // generic sentence-starters that show up capitalized at the start of a bullet
  'candidates', 'candidate', 'applicants', 'applicant', 'ideal', 'successful',
  'knowledge', 'understanding', 'familiarity', 'exposure', 'background',
  'skills', 'skill', 'communication', 'team', 'teams', 'work', 'working',
]);

/**
 * Extract candidate skill tokens from a JD's requirement-style sections.
 * @param {string} jdText
 * @returns {string[]}
 */
function extractJdSkills(jdText) {
  const lines = jdText.split('\n');
  const skills = new Set();
  let inRequirementsBlock = false;

  for (const line of lines) {
    if (REQUIREMENT_HEADER_RE.test(line)) {
      inRequirementsBlock = true;
      continue;
    }
    if (inRequirementsBlock && line.trim() === '') continue;
    if (inRequirementsBlock && /^#{1,4}\s/.test(line) && !REQUIREMENT_HEADER_RE.test(line)) {
      inRequirementsBlock = false;
    }

    const bulletMatch = BULLET_LINE_RE.exec(line);
    if (inRequirementsBlock && bulletMatch) {
      const bulletText = bulletMatch[1];
      let m;
      SKILL_TOKEN_RE.lastIndex = 0;
      while ((m = SKILL_TOKEN_RE.exec(bulletText)) !== null) {
        const token = m[1].trim();
        if (!STOPWORDS.has(token.toLowerCase()) && token.length > 1) {
          skills.add(token);
        }
      }
    }
  }
  return [...skills];
}

// ── Word-boundary text matching (same technique as Resume-Matcher's
//    _skill_mentioned_in_text — prevents "Java" matching inside "JavaScript") ──

/**
 * Word-boundary, case-insensitive check for whether a skill token appears in text.
 * @param {string} skill
 * @param {string} text
 * @returns {boolean}
 */
function skillMentionedInText(skill, text) {
  const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'i');
  return re.test(text);
}

// ── Skills-section split ─────────────────────────────────────────────
//
// Line-scan instead of a single regex: JS regex has no `\Z`-style
// end-of-string anchor (unlike Python, where this pattern was designed),
// so a lookahead built on `\Z` either fails to match a trailing Skills
// section at all or matches a literal "Z" character later in the text.
// Scanning line-by-line for the next heading avoids the anchor entirely.

const SKILLS_HEADING_RE = /^#{1,4}\s*Skills\s*$/i;
const ANY_HEADING_RE = /^#{1,4}\s/;

/**
 * Split cv.md into its named "Skills" section (if any) and the remaining
 * prose, without relying on a Python-style end-of-string regex anchor.
 * @param {string} cvText
 * @returns {{namedSkillsText: string, proseText: string}}
 */
function splitSkillsSection(cvText) {
  const lines = cvText.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SKILLS_HEADING_RE.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) {
    return { namedSkillsText: '', proseText: cvText };
  }

  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (ANY_HEADING_RE.test(lines[i])) {
      end = i;
      break;
    }
  }

  const namedSkillsText = lines.slice(start, end).join('\n');
  const proseText = lines.slice(0, start - 1).concat(lines.slice(end)).join('\n');
  return { namedSkillsText, proseText };
}

// ── Classification ───────────────────────────────────────────────────

/**
 * Classify each JD skill against cv.md into existing / supportedByResume / gap.
 * @param {string[]} jdSkills
 * @param {string} cvText
 * @returns {{existing: string[], supportedByResume: string[], gap: string[]}}
 */
function classifySkillGaps(jdSkills, cvText) {
  const { namedSkillsText, proseText } = splitSkillsSection(cvText);

  const existing = [];
  const supportedByResume = [];
  const gap = [];

  for (const skill of jdSkills) {
    if (skillMentionedInText(skill, namedSkillsText)) {
      existing.push(skill);
    } else if (skillMentionedInText(skill, proseText)) {
      supportedByResume.push(skill);
    } else {
      gap.push(skill);
    }
  }

  return { existing, supportedByResume, gap };
}

// ── Exports (for test-all.mjs and other consumers) ───────────────────
export { extractJdSkills, skillMentionedInText, classifySkillGaps };

// ── CLI ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const selfTestMode = args.includes('--self-test');
const jdPathArg = args.find(a => !a.startsWith('--'));

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

  const fakeJd = `
# Senior Engineer — Fabrikam Inc.

## Requirements
- Python, FastAPI, PostgreSQL
- Experience with Kubernetes
- Strong communication skills
`;
  const fakeCv = `
# Skills
Python, PostgreSQL, Docker

# Experience
Deployed services onto Kubernetes clusters and wrote FastAPI endpoints for internal tools.
`;

  const jdSkills = extractJdSkills(fakeJd);
  eq('extracts Python from requirements bullet', jdSkills.includes('Python'), true);
  eq('extracts Kubernetes from a separate bullet', jdSkills.includes('Kubernetes'), true);
  eq('does not extract stopword "Strong"', jdSkills.includes('Strong'), false);

  const result = classifySkillGaps(['Python', 'PostgreSQL', 'Kubernetes', 'FastAPI', 'Rust'], fakeCv);
  eq('Python classified as existing (named skill)', result.existing.includes('Python'), true);
  eq('Kubernetes classified as supportedByResume (prose only)', result.supportedByResume.includes('Kubernetes'), true);
  eq('FastAPI classified as supportedByResume (prose only)', result.supportedByResume.includes('FastAPI'), true);
  eq('Rust classified as a real gap', result.gap.includes('Rust'), true);

  // Regression: a Skills section that is the LAST section in cv.md, with no
  // trailing heading after it. The original draft used a Python-style `\Z`
  // end-of-string anchor, which JS regex has no equivalent for — it either
  // failed to match this case at all, or matched a literal "Z" character
  // later in the text. This fixture is that exact shape (Skills is last,
  // and the text contains a "Z"-adjacent word to catch the literal-match
  // failure mode too).
  const trailingSkillsCv = `
# Experience
Worked with Rust in a prior role.

# Skills
Python, Docker, Zookeeper
`;
  const trailingResult = classifySkillGaps(['Python', 'Zookeeper'], trailingSkillsCv);
  eq(
    'trailing Skills section (last in doc, contains a "Z" word) is still captured as named skills',
    trailingResult.existing.includes('Zookeeper'),
    true
  );

  // Regression: generic JD boilerplate must not be misreported as a skill gap.
  const boilerplateJd = `
# Role

## Requirements
- Bachelor's degree required
- Experience with cross-functional teams (5+ years)
- Communication skills and Ability to self-organize
`;
  // The asserted words are capitalized in the fixture on purpose:
  // SKILL_TOKEN_RE only captures uppercase-leading tokens, so a lowercase
  // "experience" would never become a candidate and the assertion would
  // pass without exercising the STOPWORDS filter at all.
  const boilerplateSkills = extractJdSkills(boilerplateJd);
  eq('does not extract "Bachelor" as a skill', boilerplateSkills.includes('Bachelor'), false);
  eq('does not extract "Experience" as a skill', boilerplateSkills.includes('Experience'), false);
  eq('does not extract "Communication" as a skill', boilerplateSkills.includes('Communication'), false);
  eq('does not extract "Ability" as a skill', boilerplateSkills.includes('Ability'), false);

  // Regression: tokens ending in a symbol (C#, C++, F#). The original trailing
  // \b needs a word char AFTER the symbol, so these never matched standalone —
  // same bug upskill.mjs's SKILL_PATTERN fixed with a (?!\w) lookahead. The
  // sentence-ending "Docker." assertion guards the other edge of the fix: the
  // greedy char class contains ".", so the lookahead alone would swallow the
  // trailing period into the token.
  const symbolEdgeJd = `
# Role

## Requirements
- C#, C++ or F# for backend services
- Familiarity with Docker.
`;
  const symbolEdgeSkills = extractJdSkills(symbolEdgeJd);
  eq('extracts C# standalone (symbol-edge boundary)', symbolEdgeSkills.includes('C#'), true);
  eq('extracts C++ standalone (symbol-edge boundary)', symbolEdgeSkills.includes('C++'), true);
  eq('extracts F# standalone (symbol-edge boundary)', symbolEdgeSkills.includes('F#'), true);
  eq('sentence-ending token stays clean ("Docker", not "Docker.")', symbolEdgeSkills.includes('Docker'), true);
  eq('trailing period is not swallowed into the token', symbolEdgeSkills.includes('Docker.'), false);

  console.log(`\njd-skill-gap self-test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// ── Main ─────────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
if (selfTestMode) {
  runSelfTest();
} else {
  if (!jdPathArg || !existsSync(jdPathArg)) {
    console.error('Usage: node jd-skill-gap.mjs <jd-file> [--summary]');
    console.error('       node jd-skill-gap.mjs --self-test');
    process.exit(1);
  }
  if (!existsSync(CV_PATH)) {
    console.error(`Error: ${CV_PATH} not found — this is a user-layer file, create it first.`);
    process.exit(1);
  }

  const jdText = readFileSync(jdPathArg, 'utf-8');
  const cvText = readFileSync(CV_PATH, 'utf-8');
  const jdSkills = extractJdSkills(jdText);
  const result = classifySkillGaps(jdSkills, cvText);

  if (summaryMode) {
    console.log(`\nJD Skill-Gap Check`);
    console.log('─'.repeat(40));
    console.log(`JD skills found: ${jdSkills.length}`);
    console.log(`  ✅ Already in Skills section:   ${result.existing.join(', ') || '(none)'}`);
    console.log(`  📝 Mentioned in resume prose:   ${result.supportedByResume.join(', ') || '(none)'}`);
    console.log(`  ⚠️  Real gaps (not found anywhere): ${result.gap.join(', ') || '(none)'}`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}
} // end CLI guard
