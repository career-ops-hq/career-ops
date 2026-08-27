#!/usr/bin/env node

/**
 * verify-ats.mjs — Score a generated CV's ATS-friendliness (deterministic, read-only).
 *
 * The twin of verify-cv-facts.mjs: that gate guards *what* a CV claims; this one
 * guards *whether an ATS can parse it at all*. No LLM, no network, no writes — it
 * reads one CV HTML (the output of `pdf` mode, before PDF rendering) and reports a
 * 0-100 structural score, a letter grade, and a list of concrete, fixable issues.
 *
 * Usage:
 *   node verify-ats.mjs <generated-cv.html>
 *   node verify-ats.mjs <generated-cv.html> --keywords "python,kubernetes,rag"
 *   node verify-ats.mjs <generated-cv.html> --role "Senior Backend Engineer"
 *   node verify-ats.mjs <generated-cv.html> --min-score 80 --json
 *   node verify-ats.mjs --self-test
 *
 * Exit code: 0 when the structural score >= --min-score (default 70) and no
 * critical issue is present; 1 otherwise. Keyword coverage is reported but never
 * changes the structural score (it is advisory and only computed when supplied).
 */

import { readFileSync, statSync } from 'fs';
import { isAbsolute, join, basename } from 'path';
import { fileURLToPath } from 'url';
import { isMainModule } from './lib/is-main-module.mjs'; 

const DEFAULT_MIN_SCORE = 70;

// Weights sum to 100. Kept explicit so the score is auditable and the self-test
// can pin each check independently.
const WEIGHTS = {
  text: 15,        // real, selectable text present (not image-only / rasterized)
  sections: 20,    // standard, recognizable section headings
  contact: 15,     // email (+ phone) reachable in the body
  layout: 20,      // single-column, no layout tables / multi-column CSS
  images: 10,      // no CV text baked into images
  fonts: 10,       // standard, embeddable fonts
  charset: 5,      // UTF-8 declared
  hidden: 5,       // no hidden text / keyword stuffing
};

const TEXT_MIN_CHARS = 300;      // below this, the CV likely has no real text layer
const TEXT_LOW_WITH_IMG = 800;   // images + this little text ⇒ text probably baked in

// Fonts that ATS PDF text extractors handle reliably (all widely available and
// embeddable). Lowercased. Anything outside this list (and the generic families
// below) is flagged — not because it always fails, but because it is a risk worth
// surfacing. Includes the CJK/Arabic fallbacks the shipped template ships with, so
// a truthful multilingual CV is never penalised.
const ATS_SAFE_FONTS = new Set([
  'arial', 'helvetica', 'helvetica neue', 'liberation sans', 'dejavu sans',
  'calibri', 'candara', 'corbel', 'segoe ui', 'tahoma', 'verdana', 'trebuchet ms',
  'times new roman', 'times', 'georgia', 'cambria', 'garamond', 'book antiqua',
  'palatino', 'palatino linotype', 'lato', 'roboto', 'open sans', 'noto sans',
  'source sans pro', 'pt sans',
  // CJK / Arabic fallbacks used by templates/cv-template.html.
  'hiragino sans', 'hiragino kaku gothic pron', 'yu gothic', 'yugothic',
  'noto sans cjk jp', 'noto sans jp', 'meiryo', 'ms pgothic', 'pingfang sc',
  'hiragino sans gb', 'microsoft yahei', 'noto sans cjk sc', 'noto sans sc',
  'source han sans sc',
]);

// Generic CSS families — always valid, never "non-standard", so skip them.
const GENERIC_FAMILIES = new Set([
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji',
  '-apple-system', 'blinkmacsystemfont', 'inherit', 'initial', 'unset',
]);

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
// A run of phone-shaped characters. The length is bounded ({7,24}), so the regex
// itself is ReDoS-safe; the >= 9-digit rule that separates a real number from a
// CV date range like "2019 - 2024" (8 digits) is enforced in hasPhoneNumber, not
// in the pattern (counting digits in a regex without an ambiguous quantifier is
// awkward, so we keep the pattern simple and count afterwards).
const PHONE_CANDIDATE_RE = /\+?\(?\d[\d\s().-]{6,23}\d/g;
const PHONE_MIN_DIGITS = 9;
const PHONE_MAX_CANDIDATES = 50;   // bound the work on adversarial digit-heavy input

/**
 * Collapse all runs of whitespace to single spaces and trim the ends.
 * @param {string} text
 * @returns {string}
 */
function collapse(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/** Strip a fragment of inner tags to a plain-text label. */
function stripInline(fragment) {
  return collapse(fragment.replace(/<[^>]+>/g, ' '));
}

/**
 * Remove the regions an ATS text extractor never sees as content — `<script>`
 * and `<style>` bodies and HTML comments — while leaving element tags in place.
 * Used both for visible-text extraction and for link parsing, so a `mailto:`/
 * `tel:` hidden in a comment or script cannot masquerade as reachable contact
 * info.
 * @param {string} html
 * @returns {string}
 */
function stripNonContentRegions(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

/**
 * Extract the human-visible text of the CV: drop script/style/comments, unwrap
 * tags, decode the handful of entities that appear in these documents, collapse
 * whitespace. This is what an ATS text extractor is (roughly) left with.
 * @param {string} html
 * @returns {string}
 */
function extractVisibleText(html) {
  return collapse(
    stripNonContentRegions(html)
      .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      // &amp; is decoded LAST: doing it earlier could turn "&amp;lt;" into "&lt;"
      // and then into "<", double-unescaping text that was never an entity.
      .replace(/&amp;/gi, '&')
  );
}

/**
 * Whether `text` contains something that looks like a real phone number: a
 * bounded phone-shaped run carrying at least PHONE_MIN_DIGITS digits. Only the
 * first PHONE_MAX_CANDIDATES runs are inspected, so pathological digit-heavy
 * input can't blow up. Short numeric spans such as the date range "2019 - 2024"
 * (8 digits) are rejected.
 * @param {string} text
 * @returns {boolean}
 */
function hasPhoneNumber(text) {
  const candidates = text.match(PHONE_CANDIDATE_RE);
  if (!candidates) return false;
  for (const candidate of candidates.slice(0, PHONE_MAX_CANDIDATES)) {
    if ((candidate.match(/\d/g) || []).length >= PHONE_MIN_DIGITS) return true;
  }
  return false;
}

/**
 * Parse actual `<a href>` targets (both quote forms), ignoring script/style/
 * comment regions, and report whether a reachable `mailto:`/`tel:` link exists.
 * This is the fallback for contact info whose visible text isn't the address
 * itself (e.g. `<a href="mailto:…">Email me</a>`), without letting raw-HTML
 * noise satisfy the check.
 * @param {string} html
 * @returns {{email:boolean, phone:boolean}}
 */
function linkContacts(html) {
  let email = false, phone = false;
  for (const m of stripNonContentRegions(html).matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const href = (m[1] ?? m[2]).trim();
    if (/^mailto:.+@.+/i.test(href)) email = true;
    else if (/^tel:.*\d/i.test(href)) phone = true;
  }
  return { email, phone };
}

/**
 * Whether a CSS declaration blob asks for two or more columns, via either
 * `column-count: N` (N >= 2, any number of digits) or the `columns` shorthand
 * (a bare integer token >= 2). Values carrying a unit like `11px` are column
 * widths, not counts, so they are deliberately not treated as multi-column.
 * @param {string} blob
 * @returns {boolean}
 */
function hasMultiColumn(blob) {
  const count = blob.match(/column-count\s*:\s*(\d+)/i);
  if (count && Number(count[1]) >= 2) return true;
  for (const m of blob.matchAll(/\bcolumns\s*:\s*([^;{}]+)/gi)) {
    for (const token of m[1].trim().split(/\s+/)) {
      if (/^\d+$/.test(token) && Number(token) >= 2) return true;
    }
  }
  return false;
}

/**
 * Concatenated text of every `<style>` block.
 * @param {string} html
 * @returns {string}
 */
function extractStyleText(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
}

/**
 * Every inline `style="…"` / `style='…'` attribute value. Both quote forms are
 * accepted so hidden-text and keyword-stuffing detection cannot be bypassed by
 * switching quote styles.
 * @param {string} html
 * @returns {string[]}
 */
function extractInlineStyles(html) {
  return [...html.matchAll(/style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map(m => m[1] ?? m[2]);
}

/**
 * Candidate section headings: the template's `.section-title` divs plus any
 * generic <h1>–<h6>. Lowercased so downstream matching is case-insensitive.
 * @param {string} html
 * @returns {string[]}
 */
function extractHeadings(html) {
  const out = [];
  for (const m of html.matchAll(/<[^>]*class\s*=\s*"[^"]*\bsection-title\b[^"]*"[^>]*>([\s\S]*?)<\//gi)) {
    out.push(stripInline(m[1]));
  }
  for (const m of html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
    out.push(stripInline(m[1]));
  }
  return out.map(s => s.toLowerCase()).filter(Boolean);
}

/**
 * Build the target keyword set for the advisory coverage check. `--keywords` is
 * split on commas; `--role` is split only on commas, slashes, and the word
 * "and", so a plain title like "Senior Backend Engineer" stays a single phrase
 * matched verbatim against the CV text (it is NOT tokenized into words).
 * @param {string|string[]|undefined} keywords
 * @param {string|undefined} role
 * @returns {string[]} De-duplicated, trimmed keyword phrases (length >= 2).
 */
function normalizeKeywords(keywords, role) {
  const list = [];
  if (Array.isArray(keywords)) list.push(...keywords);
  else if (typeof keywords === 'string') list.push(...keywords.split(','));
  if (role) list.push(...String(role).split(/[,/]|\band\b/i));
  return [...new Set(list.map(k => k.trim()).filter(k => k.length >= 2))];
}

/**
 * Map a 0-100 structural score to a letter grade.
 * @param {number} score
 * @returns {string} One of A, B, C, D, F.
 */
function gradeFor(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Score a CV HTML string for ATS-friendliness.
 * @param {string} html
 * @param {{keywords?: string|string[], role?: string}} [opts]
 * @returns {{score:number, grade:string, issues:{severity:string,message:string}[], keywordCoverage:null|{total:number,found:number,percent:number,missing:string[]}}}
 */
function auditAts(html, opts = {}) {
  const text = extractVisibleText(html);
  const css = extractStyleText(html);
  const inlineStyles = extractInlineStyles(html);
  // Every place a CSS declaration can live, so equivalent evasions are caught
  // whether the rule sits in a <style> block or an inline style attribute.
  const styleBlobs = [css, ...inlineStyles];
  const issues = [];
  let score = 0;

  const add = (severity, message) => issues.push({ severity, message });

  // 1. Real, selectable text.
  if (text.length >= TEXT_MIN_CHARS) {
    score += WEIGHTS.text;
  } else {
    add('critical', `Very little selectable text (${text.length} chars, expected >= ${TEXT_MIN_CHARS}). The CV may be image-based or rasterized; ATS parsers need a real text layer.`);
  }

  // 2. Standard section headings.
  const headingBlob = extractHeadings(html).join(' | ');
  const required = [
    { name: 'Experience', re: /experience|work history|employment/ },
    { name: 'Education', re: /education|academic/ },
    { name: 'Skills', re: /skills|competenc|proficienc/ },
  ];
  const missing = [];
  for (const s of required) {
    if (s.re.test(headingBlob)) score += 5;
    else missing.push(s.name);
  }
  const bonus = [/summary|profile|objective/, /projects/, /certificat|licenses/]
    .filter(re => re.test(headingBlob)).length;
  score += Math.min(5, bonus * 2);
  if (missing.length) {
    add(missing.length >= 2 ? 'critical' : 'warning',
      `Missing standard section heading(s): ${missing.join(', ')}. ATS parsers key off recognizable headings (Experience, Education, Skills).`);
  }

  // 3. Contact info reachable in the body. We strip only *semantic* <header>/
  // <footer> elements: those map to the PDF page header/footer regions ATS
  // extractors routinely discard. The generated template's contact block sits in
  // a plain <div class="header"> in the normal document flow, which parses fine —
  // so it is deliberately NOT stripped (doing so would false-positive every
  // shipped CV). This warning therefore targets hand-authored / alternate HTML
  // that puts contact details inside real <header>/<footer> tags.
  const bodyOnlyHtml = html
    .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ');
  const bodyText = extractVisibleText(bodyOnlyHtml);
  const links = linkContacts(html);
  const bodyLinks = linkContacts(bodyOnlyHtml);
  const hasEmail = EMAIL_RE.test(text) || links.email;
  const emailInBody = EMAIL_RE.test(bodyText) || bodyLinks.email;
  const hasPhone = hasPhoneNumber(text) || links.phone;
  // The 10 email points are contingent on the address being reachable in the
  // body: an email that survives only inside a semantic <header>/<footer> is
  // effectively invisible to the ATS, so it earns no points and is a critical
  // (a bare warning would be ignored by isPass and let the CV pass anyway).
  if (emailInBody) {
    score += 10;
  } else if (hasEmail) {
    add('critical', 'Contact email appears only inside a semantic <header>/<footer> element; ATS routinely drop those regions, so the address is effectively unreachable. Move contact details into the main document body.');
  } else {
    add('critical', 'No email address found. ATS and recruiters need a parseable contact email in the body of the CV.');
  }
  if (hasPhone) score += 5;
  else add('info', 'No phone number detected (optional, but many ATS intake forms expect one).');

  // 4. Single-column, no layout tables. `display:table` on a single element does
  // not reorder content, so it is deliberately NOT flagged (the template's
  // definition-list-style certifications block uses it and parses fine).
  let layout = WEIGHTS.layout;
  const tableTags = (html.match(/<table\b/gi) || []).length;
  const multiColumn = styleBlobs.some(hasMultiColumn);
  const absPos = (css.match(/position\s*:\s*absolute/gi) || []).length
    + inlineStyles.filter(s => /position\s*:\s*absolute/i.test(s)).length;
  if (tableTags > 0) {
    layout -= 12;
    add('critical', `Found ${tableTags} <table> element(s). Table-based layouts scramble the reading order ATS extractors follow; use a single-column flow.`);
  }
  if (multiColumn) {
    layout -= 8;
    add('warning', 'CSS multi-column layout detected (column-count/columns). Single-column content parses most reliably.');
  }
  if (absPos > 0) {
    layout -= 4;
    add('warning', `Found ${absPos} absolutely-positioned element(s); absolute positioning can break ATS reading order.`);
  }
  score += Math.max(0, layout);

  // 5. No CV text baked into images.
  let imageScore = WEIGHTS.images;
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  const contentImgs = imgs.filter(tag => !/class\s*=\s*(?:"[^"]*\bcv-photo\b[^"]*"|'[^']*\bcv-photo\b[^']*')/i.test(tag));
  if (contentImgs.length > 0 && text.length < TEXT_LOW_WITH_IMG) {
    imageScore = 0;
    add('critical', `Found ${contentImgs.length} content image(s) with little surrounding text (${text.length} chars). Text baked into images is invisible to ATS.`);
  } else if (contentImgs.length > 0) {
    imageScore -= 5;
    add('warning', `Found ${contentImgs.length} non-photo image(s). Ensure no CV text (skills, headings, contact) is baked into images — ATS cannot read image text.`);
  }
  score += Math.max(0, imageScore);

  // 6. Standard, embeddable fonts. Scan both <style> blocks and inline styles so
  // an inline font-family is scored the same as one in a stylesheet.
  const families = new Set();
  for (const blob of styleBlobs) {
    for (const m of blob.matchAll(/font-family\s*:\s*([^;{}]+)/gi)) {
      for (const raw of m[1].split(',')) {
        const fam = raw.replace(/['"]/g, '').trim().toLowerCase();
        if (fam && !GENERIC_FAMILIES.has(fam)) families.add(fam);
      }
    }
  }
  const unsafeFonts = [...families].filter(f => !ATS_SAFE_FONTS.has(f));
  if (unsafeFonts.length === 0) {
    score += WEIGHTS.fonts;
  } else {
    score += Math.max(0, WEIGHTS.fonts - unsafeFonts.length * 3);
    add('warning', `Non-standard font(s): ${unsafeFonts.join(', ')}. Prefer widely-supported, embeddable fonts (Arial, Helvetica, Calibri, Times New Roman, Georgia) for reliable ATS text extraction.`);
  }

  // 7. UTF-8 declared.
  if (/<meta[^>]*charset\s*=\s*["']?\s*utf-8/i.test(html)) {
    score += WEIGHTS.charset;
  } else {
    add('warning', 'No <meta charset="utf-8"> declared. Declare UTF-8 so accented characters and symbols survive ATS text extraction.');
  }

  // 8. No hidden text / keyword stuffing. display:none / visibility:hidden /
  // font-size:0 are scanned across both <style> blocks and inline styles.
  const hiddenSignals = [];
  if (styleBlobs.some(s => /display\s*:\s*none/i.test(s))) hiddenSignals.push('display:none');
  if (styleBlobs.some(s => /visibility\s*:\s*hidden/i.test(s))) hiddenSignals.push('visibility:hidden');
  if (styleBlobs.some(s => /font-size\s*:\s*0(?:px|pt|em|rem|%)?\b/i.test(s))) hiddenSignals.push('font-size:0');
  // White text is checked on INLINE styles only, by design: a white color in a
  // <style> block is overwhelmingly legitimate (white-on-colored badges, section
  // headers, the header gradient), so scanning stylesheets for it would flag
  // normal templates. Inline `style="color:#fff"` on a text span is the classic
  // white-on-white stuffing trick and is the reliable signal.
  if (inlineStyles.some(s => /color\s*:\s*(?:#fff(?:fff)?\b|white\b|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))/i.test(s))) {
    hiddenSignals.push('white-on-white text');
  }
  if (hiddenSignals.length === 0) {
    score += WEIGHTS.hidden;
  } else {
    add('warning', `Possible hidden text / keyword stuffing (${hiddenSignals.join(', ')}). Hidden keywords are penalised by modern ATS and by recruiters who read the extracted text.`);
  }

  // Optional, advisory keyword coverage — never folded into the structural score.
  let keywordCoverage = null;
  const keywords = normalizeKeywords(opts.keywords, opts.role);
  if (keywords.length) {
    const haystack = text.toLowerCase();
    const found = keywords.filter(k => haystack.includes(k.toLowerCase()));
    const missingKeywords = keywords.filter(k => !haystack.includes(k.toLowerCase()));
    keywordCoverage = {
      total: keywords.length,
      found: found.length,
      percent: Math.round((found.length / keywords.length) * 100),
      missing: missingKeywords,
    };
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, grade: gradeFor(score), issues, keywordCoverage };
}

/**
 * Whether a result passes the gate: score at or above the threshold and no
 * critical issue.
 * @param {{score:number, issues:{severity:string}[]}} result
 * @param {number} minScore
 * @returns {boolean}
 */
function isPass(result, minScore) {
  return result.score >= minScore && !result.issues.some(i => i.severity === 'critical');
}

export {
  extractVisibleText,
  extractHeadings,
  auditAts,
  gradeFor,
  isPass,
  normalizeKeywords,
  DEFAULT_MIN_SCORE,
};

// ── Self-test ────────────────────────────────────────────────────────

/**
 * Build a clean, ATS-friendly CV HTML fixture for the self-test, with hooks to
 * override individual pieces (font, email, charset, sections, extra body) so a
 * single check can be regressed in isolation.
 * @param {{font?:string, email?:string, charset?:string, education?:string, skills?:string, extraBody?:string}} [overrides]
 * @returns {string} A full HTML document.
 */
function buildCleanHtml(overrides = {}) {
  const {
    font = "'Liberation Sans', Arial, sans-serif",
    email = '<a href="mailto:jane@example.com">jane@example.com</a>',
    charset = '<meta charset="UTF-8">',
    education = '<div class="section"><div class="section-title">Education</div><p>B.S. Computer Science, State University, 2018. Graduated with honors.</p></div>',
    skills = '<div class="section"><div class="section-title">Skills</div><p>Python, Kubernetes, Docker, PostgreSQL, distributed systems, CI/CD pipelines.</p></div>',
    extraBody = '',
  } = overrides;
  return `<!DOCTYPE html><html lang="en"><head>${charset}
<style>body{font-family:${font};font-size:11px;} .section-title{font-weight:700;text-transform:uppercase;}</style>
</head><body>
  <div class="header">
    <h1>Jane Smith</h1>
    <div class="contact-row">${email} | +1 415 555 0100 | San Francisco, CA</div>
  </div>
  <div class="section"><div class="section-title">Professional Summary</div>
    <p>Senior backend engineer with a decade of experience designing reliable, high-throughput
    distributed systems. Led platform teams delivering resilient services on Kubernetes, with a
    focus on observability, cost efficiency, and clean, well-tested Python codebases used daily
    across the organization.</p></div>
  <div class="section"><div class="section-title">Work Experience</div>
    <p>Staff Engineer, Acme Corp (2020-present). Built and operated the core payments platform,
    reducing incident rates and improving deployment cadence across multiple engineering teams.</p></div>
  <div class="section"><div class="section-title">Projects</div>
    <p>Open-source tracing toolkit adopted by several teams for latency debugging.</p></div>
  ${education}
  ${skills}
  <div class="section"><div class="section-title">Certifications</div>
    <p>Certified Kubernetes Administrator (CNCF), 2022.</p></div>
  ${extraBody}
</body></html>`;
}

/**
 * Run the built-in regression suite over inline fixtures and print a pass/fail
 * summary. Exits with status 1 if any assertion fails.
 * @returns {void}
 */
function runSelfTest() {
  let passed = 0, failed = 0;
  const check = (label, cond) => {
    if (cond) { passed++; } else { failed++; console.log(`  FAIL: ${label}`); }
  };
  const hasIssue = (issues, substr) => issues.some(i => i.message.toLowerCase().includes(substr.toLowerCase()));
  const hasCritical = issues => issues.some(i => i.severity === 'critical');

  // Baseline: a clean, single-column CV with every standard section scores top marks.
  const clean = auditAts(buildCleanHtml());
  check('clean CV scores A (>=90)', clean.score >= 90 && clean.grade === 'A');
  check('clean CV has no critical issues', !hasCritical(clean.issues));
  check('clean CV passes the default gate', isPass(clean, DEFAULT_MIN_SCORE));

  // Missing two required headings ⇒ critical, and both names surfaced.
  const noSections = auditAts(buildCleanHtml({ education: '', skills: '' }));
  check('missing Education+Skills is flagged', hasIssue(noSections.issues, 'Education') && hasIssue(noSections.issues, 'Skills'));
  check('missing two required sections is critical', hasCritical(noSections.issues));

  // Table-based layout ⇒ critical, reading order warning.
  const tableCv = auditAts(
    '<html><head><meta charset="utf-8"></head><body><table><tr><td>' +
    'Experience</td><td>Education</td></tr><tr><td>Skills: Python, Kubernetes and a long ' +
    'description of responsibilities to provide enough selectable text for the parser to read ' +
    'without tripping the low-text image heuristic here.</td><td>jane@example.com</td></tr></table></body></html>'
  );
  check('table layout is flagged', hasIssue(tableCv.issues, '<table>'));
  check('table layout is critical', hasCritical(tableCv.issues));

  // Content image with almost no text ⇒ text-baked-into-image critical.
  const imgCv = auditAts('<html><head><meta charset="utf-8"></head><body><img src="resume.png"><p>Resume</p></body></html>');
  check('content image with low text is flagged', hasIssue(imgCv.issues, 'image'));
  check('content image with low text is critical', hasCritical(imgCv.issues));

  // Non-standard font ⇒ warning naming the font.
  const badFont = auditAts(buildCleanHtml({ font: "'Comic Sans MS', cursive" }));
  check('non-standard font is flagged', hasIssue(badFont.issues, 'comic sans ms'));

  // No email anywhere ⇒ critical.
  const noEmail = auditAts(buildCleanHtml({ email: 'San Francisco' }));
  check('missing email is flagged', hasIssue(noEmail.issues, 'no email'));
  check('missing email is critical', hasCritical(noEmail.issues));

  // Hidden white-on-white text ⇒ stuffing warning.
  const hidden = auditAts(buildCleanHtml({ extraBody: '<span style="color:#ffffff">python kubernetes aws rust golang</span>' }));
  check('hidden white text is flagged', hasIssue(hidden.issues, 'hidden text'));

  // Single-quoted inline styles must not bypass hidden-text detection.
  const hiddenSingleQuote = auditAts(buildCleanHtml({ extraBody: "<span style='color:#ffffff'>python rust golang aws terraform</span>" }));
  check('single-quoted white text is flagged', hasIssue(hiddenSingleQuote.issues, 'hidden text'));

  // Inline font-family is scored the same as a stylesheet font-family.
  const inlineFont = auditAts(buildCleanHtml({ extraBody: '<p style="font-family:\'Comic Sans MS\'">extra line</p>' }));
  check('inline non-standard font is flagged', hasIssue(inlineFont.issues, 'comic sans ms'));

  // PHONE_RE must not treat a bare year range as a phone number.
  const yearRangeOnly = auditAts(
    '<html><head><meta charset="utf-8"></head><body>' +
    '<div class="section-title">Work Experience</div><div class="section-title">Education</div>' +
    '<div class="section-title">Skills</div>' +
    '<p>Reach me at jane@example.com. Employed 2019 - 2024 building reliable, high-throughput ' +
    'distributed systems on Kubernetes, with clean, well-tested Python services used daily across ' +
    'the whole organization and its many engineering teams.</p></body></html>'
  );
  check('a bare year range is not counted as a phone', hasIssue(yearRangeOnly.issues, 'no phone number'));
  check('a real phone number is detected', !hasIssue(auditAts(buildCleanHtml()).issues, 'no phone number'));

  // Email only inside a semantic <header> is unreachable ⇒ critical (a warning
  // alone would be ignored by isPass and let the CV pass anyway).
  const headerOnlyEmail = auditAts(
    '<html><head><meta charset="utf-8"></head><body>' +
    '<header><div>jane@example.com | +1 415 555 0100</div></header>' +
    '<div class="section-title">Work Experience</div>' +
    '<div class="section-title">Education</div><div class="section-title">Skills</div>' +
    '<p>Built and operated reliable, high-throughput distributed systems on Kubernetes with ' +
    'clean, well-tested Python services used daily across many engineering teams, focusing on ' +
    'observability, cost efficiency, and resilient delivery pipelines shipped safely to ' +
    'production several times per day for years.</p></body></html>'
  );
  check('email only in a semantic <header> is critical', hasCritical(headerOnlyEmail.issues) && hasIssue(headerOnlyEmail.issues, '<header>'));
  check('email only in a semantic <header> fails the gate', !isPass(headerOnlyEmail, DEFAULT_MIN_SCORE));

  // A mailto:/tel: buried in a comment or <script> must NOT satisfy detection…
  const buriedContact = auditAts(
    '<html><head><meta charset="utf-8"></head><body>' +
    '<!-- <a href="mailto:ghost@example.com">x</a> --><script>var t = "tel:+15551234567";</script>' +
    '<div class="section-title">Work Experience</div><div class="section-title">Education</div>' +
    '<div class="section-title">Skills</div>' +
    '<p>Built and operated reliable, high-throughput distributed systems on Kubernetes with clean, ' +
    'well-tested Python services used daily across many engineering teams for years and years now.</p>' +
    '</body></html>'
  );
  check('mailto/tel in a comment or script is not a reachable email', hasIssue(buriedContact.issues, 'no email'));

  // …but a mailto: href whose visible text is not the address itself does count.
  const mailtoHrefOnly = auditAts(buildCleanHtml({ email: '<a href="mailto:jane@example.com">Email me</a>' }));
  check('mailto: href with non-email link text still counts', !hasIssue(mailtoHrefOnly.issues, 'no email'));

  // Multi-column layout is flagged for two-digit counts and for inline styles.
  const twoDigitCols = auditAts(buildCleanHtml({ extraBody: '<style>.grid{column-count:10;}</style>' }));
  check('two-digit column-count is flagged', hasIssue(twoDigitCols.issues, 'multi-column'));
  const inlineCols = auditAts(buildCleanHtml({ extraBody: '<div style="columns: 2">a b</div>' }));
  check('inline columns shorthand is flagged', hasIssue(inlineCols.issues, 'multi-column'));

  // Keyword coverage is opt-in and never touches the structural score.
  const withKeywords = auditAts(buildCleanHtml(), { keywords: 'python, kubernetes, rust' });
  check('keyword coverage computed when supplied', withKeywords.keywordCoverage !== null);
  check('keyword coverage percent is correct (2/3)', withKeywords.keywordCoverage.percent === 67);
  check('missing keyword is listed', withKeywords.keywordCoverage.missing.includes('rust'));
  check('supplying keywords does not change the score', withKeywords.score === clean.score);
  check('no keyword coverage without --keywords/--role', clean.keywordCoverage === null);

  console.log(`\nverify-ats self-test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// ── CLI ──────────────────────────────────────────────────────────────

/**
 * Print a human-readable ATS report (score, grade, issues, keyword coverage,
 * pass/fail) to stdout.
 * @param {{score:number, grade:string, issues:{severity:string,message:string}[], keywordCoverage:null|{found:number,total:number,percent:number,missing:string[]}}} result
 * @param {string} file - Display name for the checked file.
 * @param {number} minScore
 * @returns {void}
 */
function printHuman(result, file, minScore) {
  const pass = isPass(result, minScore);
  console.log(`ATS check: ${file}`);
  console.log(`Score: ${result.score}/100 (${result.grade})   Threshold: ${minScore}`);
  if (result.issues.length) {
    console.log('\nIssues:');
    for (const i of result.issues) console.log(`  [${i.severity}] ${i.message}`);
  }
  if (result.keywordCoverage) {
    const k = result.keywordCoverage;
    console.log(`\nKeyword coverage: ${k.found}/${k.total} (${k.percent}%)`);
    if (k.missing.length) console.log(`  Missing: ${k.missing.join(', ')}`);
  }
  console.log(`\nATS check ${pass ? 'passed' : 'failed'}: ${file}`);
  if (!pass) {
    console.log('Fix the critical/warning items above, or lower the bar with --min-score if you accept the risk.');
  }
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);

  if (args.includes('--self-test')) {
    runSelfTest();
  } else {
    let targetArg = '';
    let keywords = '';
    let role = '';
    let minScore = DEFAULT_MIN_SCORE;
    let asJson = false;

    // A value is "missing" if there is no next token or the next token is itself
    // an option flag (e.g. `--keywords --json` must error, not swallow --json).
    const missingValue = (t) => t === undefined || t.startsWith('-');

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--keywords') {
        if (missingValue(args[i + 1])) { console.error('ERROR: --keywords requires a comma-separated list'); process.exit(1); }
        keywords = args[++i];
      } else if (arg === '--role') {
        if (missingValue(args[i + 1])) { console.error('ERROR: --role requires a value'); process.exit(1); }
        role = args[++i];
      } else if (arg === '--min-score') {
        if (!args[i + 1]) { console.error('ERROR: --min-score requires a number'); process.exit(1); }
        minScore = Number(args[++i]);
        if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
          console.error('ERROR: --min-score must be a number between 0 and 100');
          process.exit(1);
        }
      } else if (arg === '--json') {
        asJson = true;
      } else if (arg === '--help' || arg === '-h') {
        // handled below
      } else if (arg.startsWith('--')) {
        console.error(`ERROR: unknown option: ${arg}`);
        process.exit(1);
      } else if (!targetArg) {
        targetArg = arg;
      } else {
        console.error(`ERROR: unexpected extra positional argument: ${arg}`);
        process.exit(1);
      }
    }

    const helpRequested = args.includes('--help') || args.includes('-h');
    if (!targetArg || helpRequested) {
      console.log(`Usage: node verify-ats.mjs <generated-cv.html> [--keywords "a,b,c"] [--role "..."] [--min-score N] [--json]

Scores a generated CV's HTML for ATS parseability (0-100 + letter grade) and lists
concrete, fixable issues. Deterministic, read-only. Exits 0 when score >= --min-score
(default ${DEFAULT_MIN_SCORE}) and no critical issue is present, else 1.

Keyword coverage (--keywords / --role) is advisory and never changes the score.`);
      // An explicit --help is a success; a missing target is a usage error.
      process.exit(helpRequested ? 0 : 1);
    }

    const targetPath = isAbsolute(targetArg) ? targetArg : join(process.cwd(), targetArg);
    let html;
    try {
      if (!statSync(targetPath).isFile()) throw new Error('not a regular file');
      html = readFileSync(targetPath, 'utf-8');
    } catch (err) {
      console.error(`ERROR: cannot read target file: ${targetArg} (${err.code || err.message})`);
      process.exit(1);
    }
    const result = auditAts(html, { keywords, role });
    const pass = isPass(result, minScore);
    const file = basename(targetPath);

    if (asJson) {
      console.log(JSON.stringify({ file, pass, minScore, ...result }, null, 2));
    } else {
      printHuman(result, file, minScore);
    }
    // Set exitCode (don't process.exit) so buffered stdout drains before exit.
    process.exitCode = pass ? 0 : 1;
  }
}
