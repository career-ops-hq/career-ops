#!/usr/bin/env node

/**
 * verify-cv-facts.mjs — Guard generated CVs against invented metrics.
 *
 * Usage:
 *   node verify-cv-facts.mjs <generated-cv.html|md|tex>
 *   node verify-cv-facts.mjs <generated-cv> --source cv.md --source article-digest.md
 *   node verify-cv-facts.mjs --self-test
 */

import { existsSync, readFileSync } from 'fs';
import { isAbsolute, join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCES = ['cv.md', 'article-digest.md'];
const DEFAULT_CONFIG = join(ROOT, 'config', 'cv-facts.json');

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

function stripMarkup(text) {
  return text
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

function normalizeClaim(claim) {
  return claim.toLowerCase().replace(/[,\s]+/g, ' ').trim();
}

// Countable nouns a CV routinely attaches a number to. Kept explicit rather
// than "any noun" so ordinary prose numbers (dates, versions, addresses) never
// become claims that need sourcing.
const METRIC_NOUNS = [
  'users', 'customers', 'clients', 'employees', 'engineers', 'teams', 'companies',
  'partners', 'organizations', 'organisations', 'brands', 'countries',
  'hours', 'days', 'weeks', 'months', 'years', 'minutes', 'seconds',
  'requests', 'tokens', 'documents', 'workflows', 'pipelines', 'agents',
  'interviews', 'applications', 'offers', 'reports', 'cvs', 'resumes',
  // Training / education artifacts.
  'enrollments', 'enrolments', 'completions', 'courses', 'certifications',
  'certificates', 'sessions', 'responses', 'surveys', 'cohorts',
  // Software / OSS artifacts.
  'commits', 'contributions', 'repositories', 'repos', 'modules', 'tools',
  'servers', 'guides', 'articles', 'datasets', 'examples', 'deployments',
  'services', 'downloads', 'stars', 'lines', 'projects', 'integrations', 'tests',
];

// Number-to-noun claims, tolerating up to two modifiers between the two
// ("16,181 active users", "605 partner organizations", "80+ open-access guides").
//
// The number and the noun are captured separately and recombined into a
// canonical "<number> <noun>" claim. That matters in both directions:
//   - detection: the old adjacent-only pattern silently missed every claim with
//     a modifier, so a CV could say "94,772 active users" against a source that
//     says "16,181 active users" and still pass the gate.
//   - false positives: canonicalizing means legitimate rewording between the
//     source and the CV ("16,181 users" vs "16,181 active users") still compares
//     equal, so only a changed NUMBER trips the check.
const COUNT_CLAIM_RE = new RegExp(
  String.raw`\b(\d[\d,.]*)\s*\+?\s*(?:[A-Za-z][A-Za-z-]*\s+){0,2}(${METRIC_NOUNS.join('|')})\b`,
  'gi'
);

// Nouns that name the same quantity in different words. Folded to one form so
// "77 repos" in a source and "77 repositories" in a generated CV compare equal
// instead of reading as an unsourced claim.
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
  // No leading \b: a currency symbol is a non-word char, so \b only held when
  // the amount was glued to a preceding word char. In real prose the symbol is
  // preceded by a space or start-of-string ("a $550K budget"), where \b fails -
  // which silently disabled currency checking almost everywhere it mattered.
  /(?<![\w$€£])[$€£]\s?\d[\d,.]*(?:\s?[kKmMbB])?/g,
  /\b\d+(?:\.\d+)?\s?x\b/gi,
];

function metricClaims(text) {
  const clean = stripMarkup(text);
  const claims = new Set();

  for (const pattern of SIMPLE_CLAIM_PATTERNS) {
    for (const match of clean.matchAll(pattern)) {
      claims.add(normalizeClaim(match[0]));
    }
  }

  COUNT_CLAIM_RE.lastIndex = 0;
  for (const match of clean.matchAll(COUNT_CLAIM_RE)) {
    const noun = match[2].toLowerCase();
    claims.add(normalizeClaim(`${match[1]} ${NOUN_SYNONYMS.get(noun) ?? noun}`));
  }

  return claims;
}

function loadConfig(path) {
  if (!existsSync(path)) return { allow_metrics: [], forbidden_phrases: [] };
  const config = JSON.parse(readFileSync(path, 'utf-8'));
  for (const key of ['allow_metrics', 'forbidden_phrases']) {
    if (config[key] == null) {
      config[key] = [];
    } else if (!Array.isArray(config[key])) {
      throw new Error(`${key} must be an array in ${path}`);
    }
  }
  return config;
}

function resolveInputPath(path) {
  return isAbsolute(path) ? path : join(process.cwd(), path);
}

/**
 * Compare a generated CV's metric claims against the allowed set.
 * @param {string} targetText
 * @param {string} sourceText
 * @param {{allow_metrics?: string[], forbidden_phrases?: string[]}} config
 * @returns {{invented: string[], forbidden: string[]}}
 */
function auditClaims(targetText, sourceText, config = {}) {
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

export { metricClaims, stripMarkup, normalizeClaim, auditClaims };

// ── Self-test ────────────────────────────────────────────────────────

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

  const source = 'Reached 16,181 active users and 289,760 enrollments across 80 courses, '
    + 'with ~95% satisfaction. Cut infrastructure cost ~60%. Managed a $550K budget. '
    + 'Certified partners earned 2x more. Authored 80+ open-access technical guides. '
    + 'Shipped across 605 partner organizations.';

  // Baseline: a truthful restatement must pass, including reworded modifiers.
  eq(
    'truthful CV passes',
    auditClaims('16,181 active users, 289,760 enrollments, 80 courses, ~95% satisfaction', source).invented,
    []
  );
  eq(
    'modifier rewording is not a false positive ("16,181 users" vs source "16,181 active users")',
    auditClaims('Grew the platform to 16,181 users', source).invented,
    []
  );
  eq(
    'extra modifiers are tolerated in either direction',
    auditClaims('80+ open-access technical guides', source).invented,
    []
  );

  // Regression: the original pattern required the number to sit immediately
  // before the noun, so any claim with a modifier in between was invisible to
  // the gate. A generated CV could inflate "16,181 active users" to an
  // arbitrary number and still pass, which is the exact failure this file
  // exists to prevent.
  eq(
    'inflated count WITH a modifier is caught',
    auditClaims('Reached 94,772 active users', source).invented,
    ['94 772 users']
  );
  eq(
    'inflated count WITHOUT a modifier is still caught',
    auditClaims('Reached 94,772 users', source).invented,
    ['94 772 users']
  );

  // Regression: nouns common to training and OSS CVs were absent from the noun
  // list, so entire categories of quantified claim were never checked.
  eq(
    'invented enrollment count is caught',
    auditClaims('Drove 900,000 enrollments', source).invented,
    ['900 000 enrollments']
  );
  eq(
    'invented course count is caught',
    auditClaims('Authored 400 courses', source).invented,
    ['400 courses']
  );
  eq(
    'invented repository count is caught',
    auditClaims('Maintains 500 repositories', source).invented,
    ['500 repositories']
  );

  // Percentages, currency and multipliers keep their original behaviour.
  eq('invented percentage is caught', auditClaims('cut cost ~88%', source).invented, ['88%']);
  eq('sourced percentage passes', auditClaims('cut cost ~60%', source).invented, []);
  eq('sourced multiplier passes', auditClaims('earned 2x more', source).invented, []);

  // Regression: the currency pattern led with \b, which only holds when the
  // amount is glued to a preceding word character. Real prose writes "a $550K
  // budget", where \b fails - so inflated currency figures passed the gate.
  eq(
    'invented currency figure is caught when space-preceded',
    auditClaims('Managed a $900K budget', source).invented,
    ['$900k']
  );
  eq(
    'sourced currency figure passes when space-preceded',
    auditClaims('Managed a $550K budget', source).invented,
    []
  );

  // Regression: noun synonyms must fold, or a truthful reword becomes a false
  // positive ("77 repos" in the source vs "77 repositories" in the CV).
  eq(
    'repos/repositories fold to one claim',
    auditClaims('Maintains 77 public repositories', 'Active across 77 repos').invented,
    []
  );
  eq(
    'folding does not hide a changed number',
    auditClaims('Maintains 500 public repositories', 'Active across 77 repos').invented,
    ['500 repositories']
  );

  // A bare year must not be mistaken for a claim needing a source.
  eq('ordinary prose numbers are not claims', auditClaims('Joined the team in 2013.', source).invented, []);

  // allow_metrics still overrides.
  eq(
    'allow_metrics whitelists an otherwise-unsourced claim',
    auditClaims('Reached 94,772 users', source, { allow_metrics: ['94,772 users'] }).invented,
    []
  );

  // forbidden_phrases still reported.
  eq(
    'forbidden phrase is reported',
    auditClaims('A proven track record', source, { forbidden_phrases: ['proven track record'] }).forbidden,
    ['proven track record']
  );

  console.log(`\nverify-cv-facts self-test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// ── CLI ──────────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);

  if (args.includes('--self-test')) {
    runSelfTest();
  } else {
    const sourceArgs = [];
    let targetArg = '';
    let configPath = DEFAULT_CONFIG;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--source') {
        if (!args[i + 1]) {
          console.error('ERROR: --source requires a path');
          process.exit(1);
        }
        sourceArgs.push(args[++i]);
      } else if (arg === '--config') {
        if (!args[i + 1]) {
          console.error('ERROR: --config requires a path');
          process.exit(1);
        }
        configPath = args[++i];
      } else if (arg === '--help' || arg === '-h') {
        // handled by usage block below
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

    if (!targetArg || args.includes('--help') || args.includes('-h')) {
      console.log(`Usage: node verify-cv-facts.mjs <generated-cv> [--source path] [--config path]

Checks generated CV text for metric-like claims that are absent from source files.
Default sources: cv.md, article-digest.md
Default config:  config/cv-facts.json (optional)`);
      process.exit(targetArg ? 0 : 1);
    }

    const targetPath = resolveInputPath(targetArg);
    if (!existsSync(targetPath)) {
      console.error(`ERROR: target file not found: ${targetArg}`);
      process.exit(1);
    }

    const sources = sourceArgs.length > 0 ? sourceArgs : DEFAULT_SOURCES;
    const sourceText = sources.map(path => readIfExists(resolveInputPath(path))).join('\n');
    const targetText = readFileSync(targetPath, 'utf-8');
    let config;
    try {
      config = loadConfig(resolveInputPath(configPath));
    } catch (err) {
      console.error(`ERROR: invalid config: ${err.message}`);
      process.exit(1);
    }

    const { invented, forbidden } = auditClaims(targetText, sourceText, config);

    if (invented.length === 0 && forbidden.length === 0) {
      console.log(`CV fact check passed: ${basename(targetPath)}`);
      process.exit(0);
    }

    console.error(`CV fact check failed: ${basename(targetPath)}`);
    if (invented.length > 0) {
      console.error('\nMetric-like claims absent from sources:');
      for (const claim of invented) console.error(`  - ${claim}`);
    }
    if (forbidden.length > 0) {
      console.error('\nForbidden phrases found:');
      for (const phrase of forbidden) console.error(`  - ${phrase}`);
    }
    console.error('\nAdd real evidence to cv.md/article-digest.md, or allow a verified exception in config/cv-facts.json.');
    process.exit(1);
  }
}
