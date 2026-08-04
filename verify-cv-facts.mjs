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
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCES = ['cv.md', 'article-digest.md'];
const DEFAULT_CONFIG = join(ROOT, 'config', 'cv-facts.json');
const TOOL_PROSE_WORDS = new Set([
  'a', 'an', 'and', 'at', 'built', 'by', 'containerized', 'deployment',
  'deployments', 'for', 'from', 'in', 'of', 'on', 'production', 'project',
  'team', 'the', 'to', 'using', 'with',
]);
const TOOL_PHRASE_PATTERN = /^(?=.{1,80}$)[\p{L}\p{N}.][\p{L}\p{N}+#./-]*(?:\s+[\p{L}\p{N}.][\p{L}\p{N}+#./-]*){0,2}$/u;
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
];
const COUNT_CLAIM_RE = new RegExp(
  String.raw`\b(\d[\d,.]*)\s*\+?\s*(?:[A-Za-z][A-Za-z-]*\s+){0,2}(${METRIC_NOUNS.join('|')})\b`,
  'gi'
);
const NOUN_SYNONYMS = new Map([
  ['repos', 'repositories'],
  ['enrolments', 'enrollments'],
  ['organisations', 'organizations'],
  ['cvs', 'resumes'],
  ['certificates', 'certifications'],
  ['articles', 'guides'],
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
 */
export function normalizeClaim(claim) {
  return String(claim)
    .toLowerCase()
    .replace(/(\d)[,\s\u00a0\u202f](?=\d{3}(?!\d))/g, '$1')
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
    ['employer', /\b(?:worked at|joined|employer\s*:\s*|company\s*:\s*)\s*([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4})/g],
    ['title', /\b(?:served as|worked as|title\s*:\s*|role\s*:\s*)\s*(?:an?\s+|the\s+)?([A-Z][\w/-]*(?:\s+[A-Z][\w/-]*){0,4})|\b(?:worked at|joined)\s+[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4}\s+as\s+(?:an?\s+|the\s+)?([A-Z][\w/-]*(?:\s+[A-Z][\w/-]*){0,4})/g],
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

/** Compare generated metric claims against source text without reading files. */
export function auditClaims(targetText, sourceText, config = {}) {
  const allowed = new Set([
    ...metricClaims(sourceText),
    ...(config.allow_metrics || []).map(normalizeClaim),
  ]);
  const invented = [...metricClaims(targetText)].filter(claim => !allowed.has(claim));
  const forbidden = (config.forbidden_phrases || [])
    .filter(Boolean)
    .filter(phrase => stripMarkup(targetText).toLowerCase().includes(String(phrase).toLowerCase()));
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
  const allowed = new Set([
    ...metricClaims(sourceText),
    ...config.allow_metrics.map(normalizeClaim),
  ]);
  const targetClaims = metricClaims(targetText);
  const invented = [...targetClaims].filter(claim => !allowed.has(claim));
  const sourceNormalized = normalizeFact(stripMarkup(sourceText));
  const allowedFacts = new Set(config.allow_facts.map(normalizeFact));
  const unsupportedFacts = factClaims(targetText)
    .filter(({ value }) => !sourceContainsFact(sourceNormalized, value) && !allowedFacts.has(value))
    .filter((claim, index, claims) => claims.findIndex(other => other.kind === claim.kind && other.value === claim.value) === index);
  const forbidden = config.forbidden_phrases
      .filter(Boolean)
      .filter(phrase => stripMarkup(targetText).toLowerCase().includes(String(phrase).toLowerCase()));
  const warnings = config.warn_phrases
      .filter(Boolean)
      .filter(phrase => stripMarkup(targetText).toLowerCase().includes(String(phrase).toLowerCase()));
  return {
    verdict: invented.length || unsupportedFacts.length || forbidden.length ? 'block' : warnings.length ? 'warn' : 'pass',
    invented,
    unsupportedFacts,
    forbidden,
    warnings,
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
non-metric facts (employers, titles, and tools) absent from source files.
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
  equal(
    'allow_metrics override',
    auditClaims('Reached 94,772 users', source, { allow_metrics: ['94,772 users'] }).invented,
    []
  );
  equal(
    'forbidden phrase',
    auditClaims('A proven track record', source, { forbidden_phrases: ['proven track record'] }).forbidden,
    ['proven track record']
  );

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
  // A four-digit left part is a year, not a group: nothing is joined.
  equal('a year is not glued to the next number', auditClaims('Joined in 2026 100 users', foldSource).invented, ['100 users']);

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
      console.log(JSON.stringify({ verdict: 'block', invented: [], unsupportedFacts: [], forbidden: [], warnings: [], errors: [err.message] }));
      return 1;
    }
    console.error(`ERROR: ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCli();
}
