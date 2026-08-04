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

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));

const MARKER = 'Untrusted External Content';
const CANONICAL_HEADING = `## ${MARKER} (CRITICAL)`;

// Every mode/prompt file that ingests raw external text (JD/posting body,
// scraped page, form field, recruiter email) must reference the canonical
// directive. Modes that only ever operate on already-vetted in-scope files
// (cv.md, config/profile.yml, the tracker) are not listed here — they have
// no untrusted-content ingestion surface to annotate.
const COVERED_MODES = [
  'modes/oferta.md',
  'modes/auto-pipeline.md',
  'modes/pipeline.md',
  'modes/scan.md',
  'modes/apply.md',
  'modes/batch.md',
  'batch/batch-prompt.md',
  'modes/deep.md',
  'modes/contacto.md',
  'modes/reply-watch.md',
  // #2368 set the criterion — "every mode that genuinely ingests raw external
  // text" — and named its only intentional exclusions (`ofertas`, `discover`).
  // These four meet the criterion and were not among the exclusions: triage
  // WebFetches posting URLs, cover works from a pasted JD, interview-prep
  // WebFetches the JD as its headless fallback, and expand reads third-party
  // READMEs and portfolio pages on its way to proposing cv.md additions.
  // cover.md and interview-prep.md do not load _shared.md at all, so for them
  // there was no transitive pointer either.
  'modes/triage.md',
  'modes/cover.md',
  'modes/interview-prep.md',
  'modes/expand.md',
];

/** Pure, self-testable: does this file's text carry the directive marker? */
export function hasDirectiveMarker(text) {
  return typeof text === 'string' && text.includes(MARKER);
}

/** Pure, self-testable: does this text carry the canonical heading itself? */
export function hasCanonicalHeading(text) {
  return typeof text === 'string' && text.includes(CANONICAL_HEADING);
}

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

for (const rel of COVERED_MODES) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) {
    problems.push(`${rel} listed in COVERED_MODES but does not exist`);
    continue;
  }
  if (!hasDirectiveMarker(readFileSync(p, 'utf-8'))) {
    problems.push(`${rel} does not reference "${MARKER}"`);
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

console.log(`OK: canonical directive present in AGENTS.md and referenced in modes/_shared.md + ${COVERED_MODES.length} ingesting modes`);
process.exit(0);
