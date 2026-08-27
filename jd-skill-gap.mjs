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
import { canonicalize, extractSkills } from './skill-extract.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

// ── Config ──────────────────────────────────────────────────────────

const CV_PATH = 'cv.md';

// ── JD skill extraction (regex, no LLM) ─────────────────────────────
//
// Looks for lines/phrases under common JD requirement headers and comma/
// bullet-separated skill lists. Deliberately conservative: under-extracting
// (missing a skill) is recoverable by the user reading the JD themselves;
// over-extracting noise into "required skills" is not — it would misreport
// gaps that aren't real.

// Real postings rarely use the word "Requirements". The literal-only list
// missed the phrasings most modern ATS boards actually ship ("What we're
// looking for", "Who you are", "You may be a good fit if", "You have"), so a
// JD could yield zero skills - which reads identically to "no gaps found" and
// is the more dangerous of the two failure modes this file warns about.
const REQUIREMENT_HEADER_RE = new RegExp(
  '^#{0,6}\\s*(?:' + [
    'required', 'requirements', 'qualifications', 'must[- ]have', 'preferred', 'nice[- ]to[- ]have',
    "what\\s+we(?:'|’)?\\s*re\\s+looking\\s+for",
    "what\\s+you(?:(?:'|’)ll|\\s+will)?\\s+bring",
    'who\\s+you\\s+are',
    'about\\s+you',
    'your\\s+(?:background|experience|profile)',
    'you\\s+(?:may|might|could)\\s+be\\s+a\\s+good\\s+fit',
    // Ashby's default template ships a bare "YOU HAVE:" heading (no markdown
    // hashes - already allowed by the ^#{0,6} prefix). Without this the whole
    // requirements block is invisible even though the bullets under it are
    // perfectly well formed.
    "you(?:(?:'|’)ll|\\s+will)?\\s+have",
    // Postings that phrase must-have/nice-to-have as full sentences rather
    // than noun headings.
    "it(?:'|’)?s\\s+important\\s+to\\s+us\\s+that\\s+you\\s+have",
    'it\\s+would\\s+be\\s+great\\s+if\\s+you\\s+ha(?:ve|d)',
    'ideal\\s+candidate',
    'skills\\s+(?:and|&)\\s+experience',
  ].join('|') + ')s?\\b.*$',
  'im'
);

// Headers that end a requirements block even when the posting uses no markdown
// heading levels. Without this the block stayed open to end-of-file and swept
// the benefits list into "required skills" - turning perks like "401k",
// "Equity" and "Carrot" into reported skill gaps.
const NON_REQUIREMENT_HEADER_RE = new RegExp(
  '^#{0,6}\\s*(?:' + [
    // Responsibilities. The negative lookahead keeps "You will have" on the
    // requirements side — this list is tested BEFORE REQUIREMENT_HEADER_RE in
    // scanJd(), so without it a "You will have:" heading would close a block
    // instead of opening one. Bare "YOU WILL" must close: the fallback that
    // ends a block on a new heading only fires for markdown headings (#{1,6}),
    // so an unhashed responsibilities heading left the block open and scored
    // its duties as required skills.
    'you\\s+will(?!\\s+have)',
    'benefits?', 'perks?', 'benefits\\s+and\\s+perks', 'compensation', 'salary', 'pay\\s+range',
    'what\\s+we\\s+offer', 'why\\s+(?:join|work|this\\s+role)',
    'about\\s+(?:us|the\\s+company|the\\s+team|the\\s+role)',
    'how\\s+(?:and\\s+where\\s+)?we\\s+work',
    'equal\\s+opportunity', 'eeo', 'diversity',
    'interview\\s+process', 'how\\s+to\\s+apply', 'to\\s+apply',
    'our\\s+(?:stack|process|values|mission)',
  ].join('|') + ')\\b.*$',
  'im'
);

// `\r?$` is required, not cosmetic: JS treats \r as a line terminator, so `.`
// cannot consume it and a bare `$` never matches on a CRLF-split line.
const BULLET_LINE_RE = /^\s*[-*•]\s*(.+)\r?$/;

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
  // Capitalized bullet-openers that read as skills but describe the candidate's
  // disposition, not a technology ("Deep fluency in…", "Interest in…").
  'deep', 'interest', 'genuine', 'solid', 'comfortable', 'passion', 'passionate',
  'track', 'record', 'real', 'bonus', 'plus', 'hands', 'proficiency', 'fluency',
  'expertise', 'demonstrated', 'extensive', 'practical', 'good', 'great', 'clear',
]);

/**
 * Scan a JD once, returning both the extracted skills and whether a
 * requirement-style section was ever opened.
 *
 * `sawRequirementSection` is what lets the caller tell apart the two very
 * different reasons an extraction can come back empty: "I never found a
 * requirements section, so I checked nothing" versus "I checked one and
 * recognized none of its terms". Both print as zero skills, and the first is
 * the one that silently skips the gate in modes/pdf.md Step 4.
 *
 * Kept as one state machine with extractJdSkills deliberately: a second copy of
 * the block-open/block-close logic would drift from this one, which is the exact
 * failure the shared skill-extract.mjs module was introduced to end.
 *
 * @param {string} jdText
 * @returns {{skills: string[], sawRequirementSection: boolean}}
 */
function scanJd(jdText) {
  const lines = jdText.split('\n');
  const skills = new Set();
  let inRequirementsBlock = false;
  let sawRequirementSection = false;

  for (const line of lines) {
    // Checked before the requirement test so a heading that satisfies both
    // (e.g. "Why this role") closes the block rather than reopening it.
    if (NON_REQUIREMENT_HEADER_RE.test(line)) {
      inRequirementsBlock = false;
      continue;
    }
    if (REQUIREMENT_HEADER_RE.test(line)) {
      inRequirementsBlock = true;
      sawRequirementSection = true;
      continue;
    }
    if (inRequirementsBlock && line.trim() === '') continue;
    if (inRequirementsBlock && /^#{1,6}\s/.test(line) && !REQUIREMENT_HEADER_RE.test(line)) {
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
  return { skills: [...skills], sawRequirementSection };
}

/**
 * Extract candidate skill tokens from a JD's requirement-style sections.
 * @param {string} jdText
 * @returns {string[]}
 */
function extractJdSkills(jdText) {
  return scanJd(jdText).skills;
}

/**
 * Explain an empty extraction, so "found nothing to check" stops reading as
 * "checked and found no gaps".
 *
 * Returns null when the run is conclusive (at least one skill was classified).
 * Otherwise returns a reason code and a message for the user.
 *
 * The second reason deliberately says "no skill candidates were extracted"
 * rather than blaming the vocabulary. Extraction can come back empty for
 * reasons that have nothing to do with dictionary coverage: SKILL_TOKEN_RE only
 * captures uppercase-leading tokens, so a lowercase bullet like
 * "- python and kubernetes experience" yields nothing even though
 * skill-extract.mjs knows both names. STOPWORDS can also empty a bullet. All the
 * caller can honestly be told is that nothing was classified.
 *
 * There is deliberately no minimum-length test here. That would need a
 * character cutoff, and this repo has no JD corpus to calibrate one against:
 * `jds/` is user-layer and gitignored, and the only JD-shaped files in the tree
 * (`evals/fixtures/*.txt`) are recorded score-summary stubs that all extract
 * zero skills already. A made-up cutoff would fire on those and still not
 * describe why a real JD came back empty. The structural question — was there a
 * requirements section to scan at all — separates the causes without a constant.
 *
 * @param {string} jdText
 * @param {string[]} jdSkills
 * @returns {{reason: string, message: string}|null}
 */
function diagnoseExtraction(jdText, jdSkills) {
  if (jdSkills.length > 0) return null;

  if (jdText.trim() === '') {
    return {
      reason: 'empty-jd',
      message: 'The JD file is empty, so nothing was checked.',
    };
  }

  if (!scanJd(jdText).sawRequirementSection) {
    return {
      reason: 'no-requirements-section',
      message:
        'No requirements section was recognized in this JD, so no text was scanned for skills. ' +
        'This is not the same as "no gaps": the check did not run. Read the JD yourself before drafting.',
    };
  }

  return {
    reason: 'no-skill-candidates',
    message:
      'A requirements section was found and scanned, but no skill candidates were extracted from it. ' +
      'This is not the same as "no gaps": nothing was classified. Read the JD yourself before drafting.',
  };
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

const SKILLS_HEADING_RE = /^#{1,6}\s*Skills\s*$/i;
const ANY_HEADING_RE = /^#{1,6}\s/;

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

  // Canonical skill sets present in each CV region. Folding BOTH the JD token
  // and the CV text through skill-extract.mjs's canonicalize() is what closes
  // the alias gap this file was reported for (#1896): a CV that writes "k8s"
  // and a JD that says "Kubernetes" resolve to the same canonical name instead
  // of being reported as a false gap. This is the shared tokenizer upskill.mjs
  // already promised — three parallel copies used to disagree.
  const namedCanon = extractSkills(namedSkillsText);
  const proseCanon = extractSkills(proseText);

  const existing = [];
  const supportedByResume = [];
  const gap = [];

  for (const skill of jdSkills) {
    const canon = canonicalize(skill);
    // "Known" = skill-extract recognizes this token (canonicalize rewrote it,
    // or SKILL_PATTERN matches it). For known skills the canonical-set lookup
    // is authoritative and alias-safe. Unknown/free tokens canonicalize to
    // themselves and fall through to the word-boundary heuristic below, which
    // is byte-for-byte the prior behavior — jd-skill-gap keeps its own
    // heuristics for free tokens (#1896 answer 2).
    const known = canon !== skill || extractSkills(skill).size > 0;

    if (known && namedCanon.has(canon)) {
      existing.push(skill);
    } else if (known && proseCanon.has(canon)) {
      supportedByResume.push(skill);
    } else if (skillMentionedInText(skill, namedSkillsText)) {
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
export { extractJdSkills, skillMentionedInText, classifySkillGaps, diagnoseExtraction };

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

  // The cv.md side of the six-level widening: SKILLS_HEADING_RE and
  // ANY_HEADING_RE also stopped at four. An h5 "Skills" heading meant no
  // named section was found at all (everything downgraded to
  // supportedByResume), and once it IS found, the h6 heading after it must
  // still close the section - otherwise Experience prose leaks into the
  // named skills and upgrades to existing. One assert per regex: reverting
  // SKILLS_HEADING_RE to #{1,4} turns the first red, reverting
  // ANY_HEADING_RE alone turns the second red.
  const deepHeadingCv = [
    '# Resume', '',
    '##### Skills', 'Python, Docker, PostgreSQL', '',
    '###### Experience', 'Deployed Kubernetes clusters for internal tools.',
  ].join('\n');
  const deepCvResult = classifySkillGaps(['Python', 'Docker', 'PostgreSQL', 'Kubernetes'], deepHeadingCv);
  eq('an h5 Skills heading is recognized as the named section', deepCvResult.existing.includes('Python'), true);
  eq('the named section stops at the h6 heading (Kubernetes stays prose)', deepCvResult.existing.includes('Kubernetes'), false);
  eq('prose under the h6 still classifies as supportedByResume', deepCvResult.supportedByResume.includes('Kubernetes'), true);

  // Regression: requirement headings that are full sentences or bare
  // uppercase rather than the noun forms ("Requirements", "Qualifications").
  // Each of these silently yielded ZERO skills, which is indistinguishable
  // from "no gaps found" — the failure mode this file's header warns about.
  const headerVariants = [
    ['bare uppercase "YOU HAVE:" (Ashby default template)', 'YOU HAVE:'],
    ['"You\'ll have"', "You'll have:"],
    ['"You will have"', 'You Will Have:'],
    ['"You might be a good fit if you:"', 'You Might Be a Good Fit If You:'],
    ['"You could be a good fit if you:"', 'You Could Be a Good Fit If You:'],
    ['"It\'s Important To Us That You Have"', "## It's Important To Us That You Have"],
    ['"It Would Be Great if You Had"', '## It Would Be Great if You Had'],
  ];
  for (const [label, heading] of headerVariants) {
    const jd = `# Role\n\n${heading}\n- Hands-on experience with React, TypeScript and AWS\n`;
    const skills = extractJdSkills(jd);
    eq(`${label} opens a requirements block`, skills.includes('React'), true);
  }

  // Guard the other direction: the responsibilities heading "You will" must NOT
  // open a requirements block. It reads as a near-miss for "you will have", and
  // treating duties as requirements is exactly the over-extraction this file
  // calls unrecoverable.
  const responsibilitiesJd = `# Role\n\nYOU WILL\n- Ship Kubernetes manifests for the platform team\n`;
  eq(
    '"YOU WILL" (responsibilities) does not open a requirements block',
    extractJdSkills(responsibilitiesJd).includes('Kubernetes'),
    false
  );

  // The assertion above only proves YOU WILL cannot OPEN a block. Closing is
  // the case that actually bites: postings routinely list requirements first
  // and duties second, and the block-ending fallback in scanJd() fires only on
  // markdown headings (#{1,6}) — so a bare responsibilities heading left the
  // block open and reported every duty as a missing skill.
  const dutiesAfterRequirementsJd = [
    '# Role', '', 'YOU HAVE:', '- Experience with Python', '',
    'YOU WILL', '- Ship Kubernetes manifests', '- Operate Terraform modules', '',
  ].join('\n');
  const dutiesSkills = extractJdSkills(dutiesAfterRequirementsJd);
  eq('requirements before a bare YOU WILL are still extracted', dutiesSkills.includes('Python'), true);
  eq('bare "YOU WILL" closes an open requirements block (Kubernetes)', dutiesSkills.includes('Kubernetes'), false);
  eq('bare "YOU WILL" closes an open requirements block (Terraform)', dutiesSkills.includes('Terraform'), false);

  // Guard the lookahead: "You will have" must still reach REQUIREMENT_HEADER_RE
  // even though NON_REQUIREMENT_HEADER_RE is tested first in scanJd().
  eq(
    '"You will have" opens a block despite the YOU WILL exclusion',
    extractJdSkills('# Role\n\nYou Will Have:\n- Experience with Kubernetes\n').includes('Kubernetes'),
    true
  );

  // Markdown defines six heading levels, and the block-ending fallback only
  // recognized four (CodeRabbit, reviewing #2176). A posting pasted out of a
  // deeply nested doc - or converted from HTML, where an ATS wraps sections in
  // h5/h6 - kept the requirements block open across its own next heading, so
  // everything below it scored as a required skill.
  const deepHeadingJd = [
    '##### Requirements', '- Experience with Python', '',
    '##### Benefits', '- Equity and a Carrot subscription', '',
    '###### About Us', '- We use Kubernetes internally for our own platform',
  ].join('\n');
  const deepSkills = extractJdSkills(deepHeadingJd);
  eq('an h5 requirements heading is recognized', deepSkills.includes('Python'), true);
  eq('an h5 heading closes the block (Equity)', deepSkills.includes('Equity'), false);
  eq('an h6 heading stays closed (Kubernetes)', deepSkills.includes('Kubernetes'), false);

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

  // Regression: most real postings never write the word "Requirements". The
  // literal-only header list matched none of these, so extraction returned an
  // empty list - indistinguishable from "this JD has no skill gaps", which is
  // the failure mode that silently skips the whole check.
  for (const header of [
    "What we're looking for",
    'What you will bring',
    'Who you are',
    'About you',
    'You may be a good fit if',
  ]) {
    const jd = `# Role\n\n${header}\n- Experience with Kubernetes and Terraform\n`;
    const found = extractJdSkills(jd);
    eq(`header "${header}" opens a requirements block`, found.includes('Kubernetes'), true);
  }

  // Regression: the block only closed on a markdown heading, so a posting whose
  // benefits section is plain text kept the block open to end-of-file and
  // reported perks as missing skills.
  const perksJd = `
# Role

## Requirements
- Experience with Kubernetes

Benefits and Perks (US Only)
- Competitive Equity and Healthcare
- Carrot fertility benefits
`;
  const perksSkills = extractJdSkills(perksJd);
  eq('requirement skill still extracted before the perks block', perksSkills.includes('Kubernetes'), true);
  eq('benefit "Equity" is not reported as a skill', perksSkills.includes('Equity'), false);
  eq('benefit "Healthcare" is not reported as a skill', perksSkills.includes('Healthcare'), false);
  eq('benefit "Carrot" is not reported as a skill', perksSkills.includes('Carrot'), false);

  // Regression: capitalized bullet-openers that describe disposition rather
  // than technology were surfacing as gaps ("Deep fluency in…", "Interest in…").
  const dispositionJd = `
# Role

## Requirements
- Deep fluency in TypeScript
- Interest in documentation as infrastructure
`;
  const dispositionSkills = extractJdSkills(dispositionJd);
  eq('real skill still extracted alongside a disposition opener', dispositionSkills.includes('TypeScript'), true);
  eq('does not extract "Deep" as a skill', dispositionSkills.includes('Deep'), false);
  eq('does not extract "Interest" as a skill', dispositionSkills.includes('Interest'), false);

  // Regression (#2540): a JD saved with CRLF line endings extracted zero skills.
  // JS treats \r as a line terminator, so `.` cannot consume it and the bare `$`
  // in BULLET_LINE_RE (no `m` flag) never matched — every requirement bullet
  // failed the test and the run returned an empty list, which reads exactly like
  // "no gaps" instead of erroring. Parity between the two line endings is the
  // property that was broken, so both variants are built explicitly: with
  // core.autocrlf the template literal below is already CRLF in a Windows
  // checkout, and an unnormalized fixture would compare CRLF against CRLF and
  // pass on the broken regex.
  const lineEndingJd = `
# Role

## Requirements
- Python, FastAPI, PostgreSQL
- Experience with Kubernetes
`;
  const lfSkills = extractJdSkills(lineEndingJd.replace(/\r\n/g, '\n'));
  const crlfSkills = extractJdSkills(lineEndingJd.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
  eq('CRLF JD extracts the same skills as the LF JD', crlfSkills, lfSkills);
  eq('CRLF JD extracts a non-zero number of skills', crlfSkills.length > 0, true);

  // Regression (#1896): the reported bug. A CV alias and a JD's canonical name
  // must not read as a gap. Before the shared skill-extract canonicalization,
  // classify compared the two literally — "k8s" in the CV vs "Kubernetes" in
  // the JD — and reported Kubernetes as a false gap. canonicalize() now folds
  // both to "Kubernetes" so it resolves to the region the CV actually uses it.
  const aliasCv = `
# Skills
Python, k8s, Postgres

# Experience
Built data pipelines with golang microservices.
`;
  const aliasResult = classifySkillGaps(['Kubernetes', 'PostgreSQL', 'Go', 'Rust'], aliasCv);
  eq('CV "k8s" satisfies JD "Kubernetes" (named section, not a false gap)', aliasResult.existing.includes('Kubernetes'), true);
  eq('CV "Postgres" satisfies JD "PostgreSQL" (named section)', aliasResult.existing.includes('PostgreSQL'), true);
  eq('CV prose "golang" satisfies JD "Go" (supportedByResume)', aliasResult.supportedByResume.includes('Go'), true);
  eq('genuinely-absent Rust is still a real gap', aliasResult.gap.includes('Rust'), true);

  // Regression (#1896, answer 2): unknown/free tokens keep the prior
  // word-boundary behavior — canonicalize passes them through unchanged, so a
  // JD token the shared module does not know still matches (or not) exactly as
  // before, byte-for-byte.
  const freeTokenCv = `
# Skills
Python, Fabrikam-SDK

# Experience
Maintained the internal Fabrikam-SDK build.
`;
  const freeResult = classifySkillGaps(['Fabrikam-SDK', 'Contoso-Cloud'], freeTokenCv);
  eq('unknown token present in CV still matches (word-boundary fallback preserved)', freeResult.existing.includes('Fabrikam-SDK'), true);
  eq('unknown token absent from CV is still a real gap', freeResult.gap.includes('Contoso-Cloud'), true);

  // Regression (#2278): a JD the extractor cannot read returns zero skills, and
  // the three buckets then print exactly like "checked, no gaps found".
  // modes/pdf.md Step 4 uses this output as a gate, so the two cases have to be
  // distinguishable. diagnoseExtraction() is what makes the empty case loud.

  // Conclusive run: at least one skill classified, so no warning.
  eq(
    'a JD that yields skills is diagnosed as conclusive (no warning)',
    diagnoseExtraction(fakeJd, extractJdSkills(fakeJd)),
    null
  );

  // The reported shape: a real, substantial JD whose sections use none of the
  // recognized requirement headers. Nothing is ever scanned, so zero skills come
  // back — not because the candidate has no gaps, but because the check no-opped.
  const unreadableJd = `
# Enablement Content Manager

## What you'll do
- Own the ADDIE and SAM design lifecycle for field-facing curriculum
- Build role-based learning paths, certifications and accreditation programs
- Produce e-learning modules, talk tracks, playbooks and demo flows
- Administer the LMS and design assessments and validation programs
`;
  eq('unreadable JD extracts zero skills', extractJdSkills(unreadableJd).length, 0);
  eq(
    'zero skills with no requirements section is reported as no-requirements-section',
    diagnoseExtraction(unreadableJd, extractJdSkills(unreadableJd)).reason,
    'no-requirements-section'
  );

  // The other zero shape: the requirements section IS found and scanned, but no
  // skill candidates come out of it. Different cause, so a different reason code
  // — this one points at extraction, not at header matching.
  const parserEmptyJd = `
# Enablement Content Manager

## Requirements
- adult learning principles and instructional design
- blended and scenario-based learning
`;
  eq('parser-empty JD extracts zero skills', extractJdSkills(parserEmptyJd).length, 0);
  eq(
    'zero skills inside a scanned requirements section is reported as no-skill-candidates',
    diagnoseExtraction(parserEmptyJd, extractJdSkills(parserEmptyJd)).reason,
    'no-skill-candidates'
  );

  // The reason code must not be read as "the vocabulary is missing these".
  // SKILL_TOKEN_RE only captures uppercase-leading tokens, so a lowercase bullet
  // extracts nothing even when skill-extract.mjs knows every name in it. Same
  // reason code, and the message must stay true here too.
  const lowercaseKnownJd = `
# Role

## Requirements
- python and kubernetes experience
`;
  eq(
    'a lowercase bullet of KNOWN skills still extracts zero candidates',
    extractJdSkills(lowercaseKnownJd).length,
    0
  );
  eq(
    'the vocabulary does know those names, so the empty result is not a coverage gap',
    [...extractSkills('python and kubernetes')].sort().join(','),
    'Kubernetes,Python'
  );
  eq(
    'a parser-empty result is reported as no-skill-candidates, not as a vocabulary gap',
    diagnoseExtraction(lowercaseKnownJd, extractJdSkills(lowercaseKnownJd)).reason,
    'no-skill-candidates'
  );
  eq(
    'the no-skill-candidates message does not claim the vocabulary is missing the terms',
    /vocabulary/i.test(diagnoseExtraction(lowercaseKnownJd, []).message),
    false
  );

  // An empty file is its own cause and should not be blamed on header matching.
  eq(
    'an empty JD is reported as empty-jd',
    diagnoseExtraction('   \n  \n', []).reason,
    'empty-jd'
  );

  // The warning must carry a caller-facing message, not just a code — the agent
  // following modes/pdf.md Step 4 surfaces this text to the user.
  eq(
    'the diagnosis carries a non-empty message',
    diagnoseExtraction(unreadableJd, []).message.length > 0,
    true
  );

  console.log(`\njd-skill-gap self-test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// ── Main ─────────────────────────────────────────────────────────────

if (isMainModule(import.meta.url)) {
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
  // Computed for BOTH output modes. The JSON branch is the one other tools
  // consume (modes/pdf.md Step 4 gates on it), so it is the branch that most
  // needs to say "nothing was classified" out loud - an empty three-bucket
  // object is otherwise indistinguishable from a clean bill of health.
  const diagnosis = diagnoseExtraction(jdText, jdSkills);

  if (summaryMode) {
    console.log(`\nJD Skill-Gap Check`);
    console.log('─'.repeat(40));
    console.log(`JD skills found: ${jdSkills.length}`);
    console.log(`  ✅ Already in Skills section:   ${result.existing.join(', ') || '(none)'}`);
    console.log(`  📝 Mentioned in resume prose:   ${result.supportedByResume.join(', ') || '(none)'}`);
    console.log(`  ⚠️  Real gaps (not found anywhere): ${result.gap.join(', ') || '(none)'}`);

    // An empty three-bucket summary is indistinguishable from a clean bill of
    // health, and modes/pdf.md Step 4 treats this output as a gate. Say out loud
    // that nothing was classified. Still exit 0: this is a warning, not a
    // failure, and the user decides how to proceed.
    if (diagnosis) {
      console.log('');
      console.log('  🚨 LOW CONFIDENCE: this is not a clean result.');
      console.log(`     ${diagnosis.message}`);
      console.log(`     (reason: ${diagnosis.reason})`);
    }
  } else {
    // Additive key: existing consumers reading the three buckets are unaffected.
    // null when the run was conclusive, {reason, message} when it was not.
    console.log(JSON.stringify({ ...result, lowConfidence: diagnosis }, null, 2));
  }
}
} // end CLI guard
