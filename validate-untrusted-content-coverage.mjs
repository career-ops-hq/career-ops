#!/usr/bin/env node

/**
 * validate-untrusted-content-coverage.mjs — structural coverage check for the
 * "untrusted external content" directive.
 *
 * Every mode that ingests raw external text (a job posting, a scraped
 * company/profile page, an ATS form field, a recruiter email) is a prompt-
 * injection surface: that text can contain imperative language aimed at an
 * AI ("ignore previous instructions", a fake system line, an embedded tool
 * call) and must be treated as data, never instructions. The canonical rule
 * lives once in AGENTS.md; every ingesting mode must carry a reference back
 * to it so the guidance travels with the file even when read in isolation
 * (a mode file opened standalone, a headless batch prompt with no AGENTS.md
 * in context).
 *
 * This check does NOT enforce wording — only that the marker phrase
 * "Untrusted External Content" appears in AGENTS.md (as the canonical
 * heading) and in every file listed in COVERED_MODES (as a reference to
 * it). A missing reference is a coverage gap: a new/edited mode can silently
 * lose the directive with no signal until it's exploited.
 *
 * Run: node validate-untrusted-content-coverage.mjs
 * Exit 0 = clean. Exit 1 = coverage gap listed.
 */

import { readFileSync, existsSync, globSync } from 'fs';
import { dirname, join, sep } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { USER_PATHS } from './update-system.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

const MARKER = 'Untrusted External Content';
const CANONICAL_HEADING = `## ${MARKER} (CRITICAL)`;

// ── Derivation, not a hardcoded roster ────────────────────────────────────
// COVERED_MODES used to be a hand-maintained list. A hardcoded coverage list
// can only ever chase reality: #2368 named 10 modes, #2461 had to append 4,
// and while that PR was open `modes/pdf/hm-audit.md` landed ingesting
// WebSearch results — with this validator staying green throughout. So the
// roster is now DERIVED: any mode naming a fetch primitive is required to
// carry the marker, which makes a newly-added ingesting mode fail closed
// instead of silently extending the drift.

/** Instructions that pull raw external text into a mode's context. */
const FETCH_PRIMITIVES = /WebFetch|WebSearch|browser_navigate|Playwright|playwright/;

/**
 * Files that name a fetch primitive but do NOT ingest untrusted text.
 * Every entry carries its reason: an exclusion list without stated reasons is
 * just a second hardcode wearing a different hat, and a future reader has no
 * way to check whether it is still true.
 */
const EXCLUSIONS = new Map([
  ['batch/README.md', 'contributor docs — names Playwright as an install dependency ("Playwright chromium installed"), never fetches'],
  ['modes/_shared.md', 'checked separately below as the shared preamble every mode inherits, not as an ingesting mode'],
]);

/**
 * Modes that ingest untrusted text WITHOUT naming a fetch primitive, so
 * derivation alone would drop them. Both were already covered and must stay
 * covered: `batch` reads JD files supplied by the run, and `reply-watch`
 * classifies recruiter emails. Keeping them as an explicit floor is what stops
 * "derive the list" from quietly NARROWING coverage.
 */
const ALWAYS_REQUIRED = [
  'modes/batch.md',
  'modes/reply-watch.md',
  // Ingests PASTED contract text. It also names the primitives, but only to
  // FORBID them ("This mode must not call WebSearch, WebFetch") — the detector
  // cannot tell use from prohibition, so listing it here rests its coverage on
  // the real reason rather than on a match that happens to land right.
  'modes/offer-prep.md',
];

/**
 * Localized mode mirrors (`modes/<lang>/**`) are deliberately out of scope for
 * this validator. 91 of them name a fetch primitive because they translate a
 * top-level mode whose directive IS enforced here; requiring a translated
 * marker in all 91 is a separate decision about localization policy, not a
 * silent consequence of switching to derivation. Flagged in #2480.
 */
const LOCALIZED_MIRROR = /^modes\/[a-z]{2}(-[A-Z]{2})?\//;

/**
 * USER-layer files, derived from update-system.mjs's USER_PATHS rather than
 * re-listed here — a second hardcoded copy is how a fourth user file ends up
 * policed by tooling that must not have an opinion about it.
 *
 * Three of them live inside `modes/` (`_profile.md`, `_custom.md`,
 * `_brief.md`) and are gitignored, so a filesystem glob sees them on a real
 * installation but never in a clean checkout. A user who happens to mention
 * WebSearch in their own profile or custom rules would otherwise fail this
 * validator on a file the system layer is not allowed to govern
 * (DATA_CONTRACT.md). Empty checkouts pass, real users break — so this is the
 * data contract, not a style preference.
 */
const USER_LAYER = new Set(USER_PATHS.filter((p) => !p.endsWith('/')));
const USER_LAYER_DIRS = USER_PATHS.filter((p) => p.endsWith('/'));

/** @param {string} rel @returns {boolean} whether a path belongs to the USER layer. */
export function isUserLayerPath(rel) {
  return USER_LAYER.has(rel) || USER_LAYER_DIRS.some((d) => rel.startsWith(d));
}

/**
 * Pure, self-testable: given candidate paths and a reader, return the files
 * that must carry the directive marker.
 *
 * @param {string[]} paths - Candidate relative paths.
 * @param {(rel: string) => string} readFile - Returns a file's text.
 * @returns {string[]} Sorted paths requiring the marker.
 */
export function deriveIngestingModes(paths, readFile) {
  const required = new Set(ALWAYS_REQUIRED.filter((p) => paths.includes(p)));
  for (const rel of paths) {
    if (EXCLUSIONS.has(rel)) continue;
    if (isUserLayerPath(rel)) continue; // never police the user layer (#2480 review)
    if (LOCALIZED_MIRROR.test(rel)) continue;
    let text = '';
    try {
      text = readFile(rel);
    } catch {
      continue;
    }
    if (FETCH_PRIMITIVES.test(text)) required.add(rel);
  }
  return [...required].sort();
}

/** Pure, self-testable: does this file's text carry the directive marker? */
export function hasDirectiveMarker(text) {
  return typeof text === 'string' && text.includes(MARKER);
}

/** Pure, self-testable: does this text carry the canonical heading itself? */
export function hasCanonicalHeading(text) {
  return typeof text === 'string' && text.includes(CANONICAL_HEADING);
}

// Everything below is the CLI. Guarded so importing this module for its pure
// helpers (deriveIngestingModes, isUserLayerPath, hasDirectiveMarker) does not
// run the validation and process.exit() out from under the importer.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) {
    console.log('Running validate-untrusted-content-coverage.mjs self-tests...');

    const assert = (condition, message) => {
      if (!condition) {
        console.error(`FAIL: ${message}`);
        process.exit(1);
      }
    };

    assert(hasCanonicalHeading(`intro\n\n${CANONICAL_HEADING}\n\nbody`) === true, 'canonical heading must be detected when present');
    assert(hasCanonicalHeading('## Some Other Section (CRITICAL)') === false, 'a differently-named CRITICAL section must not match');
    assert(hasCanonicalHeading('') === false, 'empty text must not match');
    assert(hasCanonicalHeading(undefined) === false, 'non-string input must not match');

    assert(hasDirectiveMarker(`See "${MARKER}" in AGENTS.md.`) === true, 'a reference sentence must be detected');
    assert(hasDirectiveMarker('This mode has no such reference.') === false, 'text without the marker must not match');
    assert(hasDirectiveMarker(null) === false, 'non-string input must not match');

    // ── derivation (the whole point of #2480) ───────────────────────────────
    const fake = {
      'modes/uses-webfetch.md': 'Step 2 — WebFetch the posting URL.',
      'modes/uses-websearch.md': 'Research the company with WebSearch.',
      'modes/uses-playwright.md': 'Fall back to Playwright when JS-rendered.',
      'modes/no-ingestion.md': 'Reads cv.md and config/profile.yml only.',
      'modes/batch.md': 'Runs the batch workers.',
      'modes/reply-watch.md': 'Classifies replies.',
      'modes/offer-prep.md': 'This mode must not call WebSearch or WebFetch.',
      'batch/README.md': 'Node.js >= 18, Playwright chromium installed.',
      'modes/_shared.md': 'WebFetch appears in the shared preamble.',
      'modes/de/oferta.md': 'WebFetch die Stellenanzeige.',
    };
    const read = (rel) => fake[rel];
    const derived = deriveIngestingModes(Object.keys(fake), read);

    assert(derived.includes('modes/uses-webfetch.md'), 'a mode naming WebFetch must be derived as ingesting');
    assert(derived.includes('modes/uses-websearch.md'), 'a mode naming WebSearch must be derived as ingesting');
    assert(derived.includes('modes/uses-playwright.md'), 'a mode naming Playwright must be derived as ingesting');
    // The acceptance criterion: a BRAND NEW ingesting mode is required with no
    // list to edit. This is what a hardcoded roster could never do.
    assert(deriveIngestingModes(['modes/freshly-added.md'], () => 'WebFetch the URL').length === 1,
      'a freshly-created ingesting mode must be required automatically');
    assert(!derived.includes('modes/no-ingestion.md'), 'a mode with no fetch primitive must not be required');
    // Floor: these ingest without naming a primitive, so derivation alone would
    // DROP them — the regression this list exists to prevent.
    assert(derived.includes('modes/batch.md'), 'batch.md must stay required via the floor');
    assert(derived.includes('modes/reply-watch.md'), 'reply-watch.md must stay required via the floor');
    assert(derived.includes('modes/offer-prep.md'), 'offer-prep.md must stay required via the floor (pasted contract text)');
    // Exclusions, each for its stated reason.
    assert(!derived.includes('batch/README.md'), 'contributor docs naming Playwright as a dependency must be excluded');
    assert(!derived.includes('modes/_shared.md'), '_shared.md is checked separately, not as an ingesting mode');
    assert(!derived.includes('modes/de/oferta.md'), 'localized mirrors are out of scope for this validator');

    // USER-layer files are never policed (#2480 review). These are gitignored,
    // so a filesystem glob sees them on a real installation but never in a
    // clean checkout — empty checkouts would pass while real users break.
    const userFake = {
      'modes/_profile.md': 'Use WebSearch to check comp data before I apply.',
      'modes/_custom.md': 'Always WebFetch the careers page first.',
      'modes/_brief.md': 'Playwright for JS-heavy boards.',
      'modes/_profile.template.md': 'Use WebSearch for current market data.',
    };
    const userDerived = deriveIngestingModes(Object.keys(userFake), (rel) => userFake[rel]);
    assert(!userDerived.includes('modes/_profile.md'), 'modes/_profile.md is USER layer and must never be required');
    assert(!userDerived.includes('modes/_custom.md'), 'modes/_custom.md is USER layer and must never be required');
    assert(!userDerived.includes('modes/_brief.md'), 'modes/_brief.md is USER layer and must never be required');
    // The TEMPLATE ships in the system layer, so it stays governed — only the
    // user's own copy is off-limits.
    assert(userDerived.includes('modes/_profile.template.md'), 'the shipped template is SYSTEM layer and stays required');
    // Derived from USER_PATHS, so a fourth user file is covered automatically.
    assert(isUserLayerPath('cv.md') && isUserLayerPath('data/applications.md'),
      'isUserLayerPath must follow USER_PATHS, including its directory entries');

    console.log('ALL SELF-TESTS PASSED');
    process.exit(0);
  }

  const agentsPath = join(ROOT, 'AGENTS.md');
  if (!existsSync(agentsPath)) {
    console.error('FAIL: AGENTS.md not found');
    process.exit(1);
  }
  const agentsText = readFileSync(agentsPath, 'utf-8');

  const problems = [];

  if (!hasCanonicalHeading(agentsText)) {
    problems.push(`AGENTS.md is missing the canonical heading "${CANONICAL_HEADING}"`);
  }

  const sharedPath = join(ROOT, 'modes/_shared.md');
  if (!existsSync(sharedPath)) {
    problems.push('modes/_shared.md not found');
  } else if (!hasDirectiveMarker(readFileSync(sharedPath, 'utf-8'))) {
    problems.push(`modes/_shared.md does not reference "${MARKER}"`);
  }

  const candidates = [
    ...globSync('modes/**/*.md', { cwd: ROOT }),
    ...globSync('batch/*.md', { cwd: ROOT }),
  ].map((p) => p.split(sep).join('/'));

  const required = deriveIngestingModes(candidates, (rel) => readFileSync(join(ROOT, rel), 'utf-8'));

  for (const rel of required) {
    if (!hasDirectiveMarker(readFileSync(join(ROOT, rel), 'utf-8'))) {
      problems.push(`${rel} ingests external text but does not reference "${MARKER}"`);
    }
  }

  if (problems.length > 0) {
    console.error('Coverage gap — untrusted-content directive missing or unreferenced:');
    for (const p of problems) console.error(`  ${p}`);
    console.error('');
    console.error(`Add the canonical "${CANONICAL_HEADING}" section to AGENTS.md (if missing),`);
    console.error(`and a short reference to "${MARKER}" in every listed file.`);
    process.exit(1);
  }

  console.log(`OK: canonical directive present in AGENTS.md and referenced in modes/_shared.md + ${required.length} derived ingesting modes`);
  process.exit(0);
}
