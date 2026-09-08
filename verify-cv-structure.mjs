#!/usr/bin/env node

/**
 * Verify a tailored CV JSON payload preserves cv.md's structure — a
 * different class of bug than verify-cv-facts.mjs catches. That gate blocks
 * FABRICATION (a claim absent from the source); this one warns about silent
 * LOSS or REORDERING of what the source already has, which fabrication
 * checking has no way to see: an omitted company descriptor, a dropped
 * skills category, or an experience entry rendered out of chronological
 * order are all internally consistent with cv.md's own facts, just not
 * faithful to its structure.
 *
 * Non-blocking by design: the header shapes this understands
 * (`### Company {—|--|-} Location[ · descriptor]`) are common conventions,
 * not a system-wide cv.md spec, so a hard gate here would
 * enforce a habit nobody agreed to rather than a real contract. Findings
 * are surfaced as a warning the user reviews, not a failure that stops the
 * pipeline.
 *
 * Written 2026-08-24 after three same-day tailored CVs for different target
 * companies all silently dropped a company descriptor (a "· Series B
 * fintech"-style suffix), one also dropped the Languages skill category
 * and every education description, and all three swapped two experience
 * entries out of chronological order — none of which verify-cv-facts.mjs
 * is designed to catch, so all three PDFs passed that gate anyway.
 *
 * Understands `## Experience` and `## Work Experience` sections whose entry
 * headers use an em dash, double hyphen, or single hyphen between company and
 * location. These are common conventions, not a system-wide cv.md spec, so a
 * cv.md written another way parses to zero
 * entries — with nothing to compare against, this reports UNVERIFIED (exit 0)
 * rather than a false "passed", so a format mismatch warns instead of either
 * silently no-opping or blocking every user whose cv.md looks different.
 *
 * Usage:
 *   node verify-cv-structure.mjs <payload.json> [--source cv.md]
 *   node verify-cv-structure.mjs --self-test
 */

import { existsSync, readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { isAbsolute, join, dirname, basename } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE = 'cv.md';

/**
 * Parse cv.md's `## Experience` or `## Work Experience` entries from its
 * `### Company {—|--|-} Location[ · descriptor]` headers, in file order
 * (which IS the ground-truth
 * chronological order — cv.md is user-authored, never generated).
 *
 * Scoped to the recognized Experience section only, up to the next level-2
 * heading: a `### University — City, ST`-shaped header under `## Education`
 * (or any other section) would otherwise parse as a phantom experience
 * entry, capable of triggering a false order/descriptor warning if its name
 * happens to match something in the payload.
 *
 * @param {string} cvMdText
 * @returns {{ company: string, location: string }[]}
 */
export function parseCvMdExperience(cvMdText) {
  const entries = [];
  const sectionHeadingRe = /^##\s+(?:Work\s+)?Experience\s*$/mi;
  const sectionMatch = sectionHeadingRe.exec(cvMdText);
  if (!sectionMatch) return entries;
  const sectionStart = sectionMatch.index + sectionMatch[0].length;
  const nextSectionRe = /^##\s+\S/m;
  const rest = cvMdText.slice(sectionStart);
  const nextSectionMatch = nextSectionRe.exec(rest);
  const section = nextSectionMatch ? rest.slice(0, nextSectionMatch.index) : rest;
  const headerRe = /^###\s+(.+?)\s+(?:—|--|-)\s+(.+)$/gm;
  let match;
  while ((match = headerRe.exec(section))) {
    entries.push({ company: match[1].trim(), location: match[2].trim() });
  }
  return entries;
}

/**
 * Match a payload experience entry's `company` field to a cv.md entry.
 * Payload company names are sometimes a superset (e.g. cv.md's "Early
 * Career" becomes "Early Career — Acme Systems, Globex Inc, Initech" when a
 * tailored CV flattens three sub-roles into one entry), so this checks
 * either direction, case-insensitively.
 *
 * @param {string} payloadCompany
 * @param {string} cvMdCompany
 * @returns {boolean}
 */
function normalizeCompany(name) {
  return String(name || '').toLowerCase().trim();
}

function companiesMatch(payloadCompany, cvMdCompany) {
  const a = normalizeCompany(payloadCompany);
  const b = normalizeCompany(cvMdCompany);
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a) || a.includes(b) || b.includes(a);
}

/**
 * Find the best-matching index for `company` in `entries`. Prefers an exact
 * (normalized) match; falls back to companiesMatch's fuzzy containment only
 * when no exact match exists. Without this, "Acme Labs" in the payload
 * would resolve to an earlier "Acme" entry in cv.md (a valid substring
 * match) instead of its own "Acme Labs" entry, letting a genuinely swapped
 * "Acme"/"Acme Labs" pair slip past the order check.
 *
 * A fuzzy candidate is rejected when its name has an exact match on the
 * source side. That prevents an omitted "Acme" from borrowing the retained
 * "Acme Labs" payload entry when cv.md contains both companies; "Acme Labs"
 * belongs to its own exact source entry. Expansion forms such as
 * "Early Career — Acme, Globex" still fall back because no source entry owns
 * that full expanded name.
 *
 * @param {{company: string}[]} entries entries on the side being searched
 * @param {string} company company name from the source side
 * @param {{company: string}[]} sourceEntries all entries on the source side
 * @returns {number} index in entries, or -1 if nothing matches
 */
function findCompanyIndex(entries, company, sourceEntries = []) {
  const target = normalizeCompany(company);
  const exactIndex = entries.findIndex((e) => normalizeCompany(e.company) === target);
  if (exactIndex !== -1) return exactIndex;
  const sourceExactNames = new Set(sourceEntries.map((e) => normalizeCompany(e.company)));
  return entries.findIndex((e) => {
    const candidate = normalizeCompany(e.company);
    return companiesMatch(company, e.company) && !sourceExactNames.has(candidate);
  });
}

/**
 * Check chronological order: for every pair of payload experience entries
 * that both match a cv.md entry, the payload must present them in the same
 * relative order cv.md does. Catches two swapped entries without needing to
 * parse date strings at all — cv.md's own file order is the ground truth.
 *
 * @param {{company: string}[]} payloadExperience
 * @param {{company: string}[]} cvMdExperience
 * @returns {string[]} human-readable violations, empty when order is fine
 */
export function checkExperienceOrder(payloadExperience, cvMdExperience) {
  const violations = [];
  const cvMdIndexOf = (company) => findCompanyIndex(cvMdExperience, company, payloadExperience);
  const resolved = payloadExperience
    .map((e, payloadIndex) => ({ payloadIndex, company: e.company, cvMdIndex: cvMdIndexOf(e.company) }))
    .filter((e) => e.cvMdIndex !== -1);
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i];
      const b = resolved[j];
      // a appears before b in the payload; cv.md must agree they're in the
      // same relative order, or the payload has reordered them.
      if (a.cvMdIndex > b.cvMdIndex) {
        violations.push(`"${a.company}" is rendered before "${b.company}", but cv.md has them in the opposite order`);
      }
    }
  }
  return violations;
}

/**
 * Check that every payload experience entry whose matching cv.md entry has
 * a "· descriptor" suffix (e.g. "Series B healthcare automation") carries
 * that same descriptor in its own `location` field. A payload entry may
 * legitimately drop other cv.md content or reword bullets, but silently
 * losing the descriptor is the specific failure this catches.
 *
 * @param {{company: string, location?: string}[]} payloadExperience
 * @param {{company: string, location: string}[]} cvMdExperience
 * @returns {string[]} human-readable violations, empty when all descriptors survive
 */
export function checkLocationDescriptors(payloadExperience, cvMdExperience) {
  const violations = [];
  for (const cvMdEntry of cvMdExperience) {
    const descriptorMatch = cvMdEntry.location.match(/·\s*(.+)$/);
    if (!descriptorMatch) continue; // cv.md itself has no descriptor for this entry — nothing to lose
    const descriptor = descriptorMatch[1].trim();
    const payloadIndex = findCompanyIndex(payloadExperience, cvMdEntry.company, cvMdExperience);
    const payloadEntry = payloadIndex === -1 ? undefined : payloadExperience[payloadIndex];
    if (!payloadEntry) continue; // entry omitted entirely from this tailored CV — a legitimate choice, not this check's concern
    const payloadLocation = String(payloadEntry.location || '');
    if (!payloadLocation.includes(descriptor)) {
      violations.push(`"${cvMdEntry.company}" is missing its cv.md descriptor "${descriptor}" (payload location: "${payloadLocation || '(empty)'}")`);
    }
  }
  return violations;
}

/**
 * Run both structural checks against a tailored CV JSON payload.
 *
 * This gate understands `## Experience` and `## Work Experience` sections
 * whose `### Company {—|--|-} Location[ · descriptor]` headers use an em dash,
 * double hyphen, or single hyphen. Those are common conventions, not a
 * system-wide cv.md spec — AGENTS.md only requires "clean markdown, standard sections."
 * A cv.md written any other way parses to zero entries, and with nothing to
 * compare the payload against, both checks trivially find no violations. A
 * bare 'pass' there would be a false "verified" — the gate ran, found
 * nothing wrong, and never actually looked at anything. 'unverified' names
 * that failure mode instead of hiding it: same non-blocking exit code as
 * 'pass' (a cv.md-format mismatch shouldn't brick the pipeline for every
 * user who doesn't write cv.md exactly this way), but the CLI output cannot
 * be mistaken for a real check having run.
 *
 * @param {object} payload the parsed JSON payload build-cv-html.mjs consumes
 * @param {string} cvMdText raw cv.md content
 * @returns {{ verdict: 'pass'|'warn'|'unverified', orderViolations: string[], descriptorViolations: string[] }}
 */
export function verifyStructure(payload, cvMdText) {
  const cvMdExperience = parseCvMdExperience(cvMdText);
  if (cvMdExperience.length === 0) {
    return { verdict: 'unverified', orderViolations: [], descriptorViolations: [] };
  }
  // The CLI validates payload shape before ever calling verifyStructure(),
  // but this is an exported function any other caller can reach directly —
  // so it must be safe against malformed input on its own, not just when
  // reached through the CLI's pre-validated path.
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { verdict: 'unverified', orderViolations: [], descriptorViolations: [] };
  }
  // A present, non-array `experience` (null, an object, a string, ...) is a
  // malformed payload, not "no experience" — silently coercing it to []
  // would let checkExperienceOrder/checkLocationDescriptors find nothing to
  // compare and report a false 'pass'.
  if (payload.experience !== undefined && !Array.isArray(payload.experience)) {
    return { verdict: 'unverified', orderViolations: [], descriptorViolations: [] };
  }
  // A null (or otherwise non-object) entry inside an array experience would
  // otherwise reach checkExperienceOrder/checkLocationDescriptors' `e.company`
  // access uncaught.
  if (Array.isArray(payload.experience) && payload.experience.some((e) => e === null || typeof e !== 'object' || Array.isArray(e))) {
    return { verdict: 'unverified', orderViolations: [], descriptorViolations: [] };
  }
  const payloadExperience = Array.isArray(payload.experience) ? payload.experience : [];
  const orderViolations = checkExperienceOrder(payloadExperience, cvMdExperience);
  const descriptorViolations = checkLocationDescriptors(payloadExperience, cvMdExperience);
  return {
    verdict: orderViolations.length || descriptorViolations.length ? 'warn' : 'pass',
    orderViolations,
    descriptorViolations,
  };
}

function resolveInputPath(path, cwd = process.cwd()) {
  return isAbsolute(path) ? path : join(cwd, path);
}

function resolveSourcePath(path) {
  return isAbsolute(path) ? path : join(getCareerOpsRoot(), path);
}

function usage() {
  return `Usage: node verify-cv-structure.mjs <payload.json> [--source cv.md]
       node verify-cv-structure.mjs --self-test

Checks a tailored CV JSON payload (the input to build-cv-html.mjs) against cv.md
for two structural regressions fabrication-checking cannot see: experience
entries rendered out of cv.md's chronological order, and a company descriptor
("· Series B healthcare automation") silently dropped from an entry's location.
Default source: cv.md

This is a warning, not a hard gate: a structural pass, warn, or unverified
result always exits 0 — a finding means review the payload against cv.md and
decide whether the loss was intentional, but the check never stops the
pipeline over one. CLI usage errors, a missing/unreadable payload or source
file, invalid JSON, or a malformed payload shape (a non-object payload, or a
non-array/non-object payload.experience) exit 1 instead: those mean the
check itself could not run, not that it found something to review.

Understands "## Experience" and "## Work Experience" sections whose company
headers use an em dash, double hyphen, or single hyphen before the location.
A cv.md written another way parses to zero entries; the check then reports
UNVERIFIED rather than a false "passed".`;
}

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

  const cvMd = [
    '## Experience',
    '',
    '### Acme Corp — Austin, TX · Series B fintech',
    '',
    '**VP of Engineering** · Feb 2023 – present',
    '',
    '### Career Break — Lake Tahoe, CA',
    '',
    '**Sabbatical** · Jul 2021 – Feb 2023',
    '',
    '### Beta Industries — Chicago, IL · Series A last-mile logistics SaaS',
    '',
    '**Co-founder & Chief Technology Officer** · Mar 2011 – Jul 2021',
    '',
    '### Early Career — Columbus, OH / Dayton, OH',
    '',
    '## Education',
    '',
    '### Decoy University — Springfield, IL',
    '',
    '**B.S. Computer Science** · 2005 – 2009',
  ].join('\n');

  const correctOrder = [
    { company: 'Acme Corp', location: 'Austin, TX · Series B fintech' },
    { company: 'Career Break', location: 'Lake Tahoe, CA' },
    { company: 'Beta Industries', location: 'Chicago, IL · Series A last-mile logistics SaaS' },
    { company: 'Early Career — Globex Inc, Initech, Umbrella Corp', location: 'Columbus, OH / Dayton, OH' },
  ];
  equal('correct order, all descriptors present: no violations',
    verifyStructure({ experience: correctOrder }, cvMd),
    { verdict: 'pass', orderViolations: [], descriptorViolations: [] });

  const swappedOrder = [
    { company: 'Acme Corp', location: 'Austin, TX · Series B fintech' },
    { company: 'Beta Industries', location: 'Chicago, IL · Series A last-mile logistics SaaS' },
    { company: 'Career Break', location: 'Lake Tahoe, CA' },
  ];
  const swappedResult = verifyStructure({ experience: swappedOrder }, cvMd);
  equal('swapped Career Break/Beta Industries: order violation caught', swappedResult.verdict, 'warn');
  equal('swapped order names both entries',
    swappedResult.orderViolations,
    ['"Beta Industries" is rendered before "Career Break", but cv.md has them in the opposite order']);

  const missingDescriptor = [
    { company: 'Acme Corp', location: 'Austin, TX' }, // descriptor dropped
    { company: 'Career Break', location: 'Lake Tahoe, CA' },
    { company: 'Beta Industries', location: 'Chicago, IL · Series A last-mile logistics SaaS' },
  ];
  const missingResult = verifyStructure({ experience: missingDescriptor }, cvMd);
  equal('dropped descriptor: violation caught', missingResult.verdict, 'warn');
  equal('dropped descriptor names the entry and the missing text',
    missingResult.descriptorViolations,
    ['"Acme Corp" is missing its cv.md descriptor "Series B fintech" (payload location: "Austin, TX")']);

  const subsetOmitted = [
    { company: 'Acme Corp', location: 'Austin, TX · Series B fintech' },
    { company: 'Beta Industries', location: 'Chicago, IL · Series A last-mile logistics SaaS' },
  ];
  equal('a legitimately omitted entry (Career Break dropped for space) is not a violation',
    verifyStructure({ experience: subsetOmitted }, cvMd).verdict, 'pass');

  const noDescriptorInSource = [
    { company: 'Career Break', location: 'Lake Tahoe, CA, near the shoreline' }, // reworded, cv.md has no descriptor to lose
  ];
  equal('an entry cv.md never gave a descriptor has nothing to check',
    verifyStructure({ experience: noDescriptorInSource }, cvMd).verdict, 'pass');

  // A cv.md that doesn't use a recognized header shape (a different heading
  // level, prose instead of headers, or simply no Experience section at all)
  // parses to zero entries. With
  // nothing to compare against, a bare 'pass' would be a false "verified" —
  // this must report 'unverified' instead, and never fabricate a violation
  // against entries it never actually saw.
  const unrecognizedCvMd = '## Experience\n\nWorked at a company for a while.\n';
  const unverifiedResult = verifyStructure({ experience: correctOrder }, unrecognizedCvMd);
  equal('cv.md with no recognized headers: reports unverified, not a false pass',
    unverifiedResult.verdict, 'unverified');
  equal('unverified result names no violations (nothing was actually checked)',
    unverifiedResult.orderViolations.length + unverifiedResult.descriptorViolations.length, 0);

  // The example CV is the format shipped to users: "## Work Experience" and
  // double-hyphen company/location separators. It must be checked rather than
  // producing the default-input UNVERIFIED warning.
  const shippedCvMd = readFileSync(join(ROOT, 'examples', 'cv-example.md'), 'utf-8');
  const shippedEntries = parseCvMdExperience(shippedCvMd);
  equal('shipped example parses both Work Experience entries',
    shippedEntries.map((e) => e.company), ['TechFin Corp', 'DataStartup Inc']);
  equal('shipped example format produces a real structural verdict',
    verifyStructure({ experience: shippedEntries }, shippedCvMd).verdict, 'pass');

  const singleHyphenCvMd = [
    '## Experience',
    '',
    '### Single Hyphen Co - Remote · developer tools',
  ].join('\n');
  equal('single-hyphen company/location separator is recognized',
    parseCvMdExperience(singleHyphenCvMd),
    [{ company: 'Single Hyphen Co', location: 'Remote · developer tools' }]);

  // A "### Company — Location" header outside the Experience section (e.g.
  // a degree entry under Education) must not be parsed as an experience
  // entry — cv.md's `## Education` section carries a header shape that
  // collides with Experience's, and this gate scans by section boundary,
  // not by header shape alone.
  const decoyEntries = parseCvMdExperience(cvMd);
  equal('Education section header is excluded from parsed experience entries',
    decoyEntries.some((e) => e.company.includes('Decoy University')), false);
  equal('Experience section still yields its 4 real entries despite the Education decoy',
    decoyEntries.length, 4);

  // An exact company match must win over a fuzzy substring match: without
  // this, a payload's "Acme Corp" could resolve to cv.md's unrelated
  // "Acme" entry (a valid prefix match) instead of its own "Acme Corp"
  // entry, letting a genuinely swapped pair slip past the order check.
  const prefixCollisionCvMd = [
    '## Experience',
    '',
    '### Acme — City One, ST',
    '',
    '**Engineer** · Jan 2018 – Jan 2020',
    '',
    '### Acme Corp — City Two, ST',
    '',
    '**Senior Engineer** · Jan 2020 – present',
  ].join('\n');
  const prefixCollisionSwapped = [
    { company: 'Acme Corp', location: 'City Two, ST' },
    { company: 'Acme', location: 'City One, ST' },
  ];
  const prefixCollisionResult = verifyStructure({ experience: prefixCollisionSwapped }, prefixCollisionCvMd);
  equal('exact match beats fuzzy prefix: swapped "Acme"/"Acme Corp" is still caught',
    prefixCollisionResult.verdict, 'warn');
  equal('prefix-collision order violation names the correct pair',
    prefixCollisionResult.orderViolations,
    ['"Acme Corp" is rendered before "Acme", but cv.md has them in the opposite order']);

  // A fuzzy candidate that has its own exact source entry is unavailable to
  // an omitted sibling. Without this guard, omitted "Acme" borrows retained
  // "Acme Labs" and reports a descriptor that was never dropped.
  const omittedPrefixCvMd = [
    '## Experience',
    '',
    '### Acme — City One, ST · consumer marketplace',
    '',
    '**Engineer** · Jan 2018 – Jan 2020',
    '',
    '### Acme Labs — City Two, ST · AI tooling',
    '',
    '**Senior Engineer** · Jan 2020 – present',
  ].join('\n');
  const onlyAcmeLabs = [
    { company: 'Acme Labs', location: 'City Two, ST · AI tooling' },
  ];
  equal('omitted Acme does not fuzzy-match retained Acme Labs',
    verifyStructure({ experience: onlyAcmeLabs }, omittedPrefixCvMd),
    { verdict: 'pass', orderViolations: [], descriptorViolations: [] });

  // CLI-level regression tests: the null-payload and unreadable-source
  // guards live in runCli(), not verifyStructure(), so exercise them
  // in-process against real temp files rather than as in-memory unit tests.
  {
    const selfTestDir = mkdtempSync(join(tmpdir(), 'verify-cv-structure-selftest-'));
    try {
      const cvMdPath = join(selfTestDir, 'cv.md');
      writeFileSync(cvMdPath, cvMd, 'utf-8');
      const nullPayloadPath = join(selfTestDir, 'null-payload.json');
      writeFileSync(nullPayloadPath, 'null', 'utf-8');
      const validPayloadPath = join(selfTestDir, 'valid-payload.json');
      writeFileSync(validPayloadPath, JSON.stringify({ experience: correctOrder }), 'utf-8');
      const dirAsSourcePath = join(selfTestDir, 'a-directory-not-a-file');
      mkdirSync(dirAsSourcePath);
      const nullEntryPayloadPath = join(selfTestDir, 'null-entry-payload.json');
      writeFileSync(nullEntryPayloadPath, JSON.stringify({ experience: [null, ...correctOrder] }), 'utf-8');
      const nonArrayExperiencePath = join(selfTestDir, 'non-array-experience-payload.json');
      writeFileSync(nonArrayExperiencePath, JSON.stringify({ experience: null }), 'utf-8');
      const dataRoot = join(selfTestDir, 'data-root');
      mkdirSync(dataRoot);
      writeFileSync(join(dataRoot, 'cv.md'), cvMd, 'utf-8');
      const decoyCwd = join(selfTestDir, 'decoy-cwd');
      mkdirSync(decoyCwd);

      const origError = console.error;
      const origWarn = console.warn;
      const origLog = console.log;
      console.error = () => {};
      console.warn = () => {};
      console.log = () => {};
      let nullExit, dirSourceExit, nullEntryExit, nonArrayExperienceExit, dataRootSourceExit;
      const origCwd = process.cwd();
      const origDataRoot = process.env.CAREER_OPS_ROOT;
      try {
        nullExit = runCli([nullPayloadPath, '--source', cvMdPath]);
        dirSourceExit = runCli([validPayloadPath, '--source', dirAsSourcePath]);
        nullEntryExit = runCli([nullEntryPayloadPath, '--source', cvMdPath]);
        nonArrayExperienceExit = runCli([nonArrayExperiencePath, '--source', cvMdPath]);
        process.env.CAREER_OPS_ROOT = dataRoot;
        process.chdir(decoyCwd);
        dataRootSourceExit = runCli([validPayloadPath, '--source', 'cv.md']);
      } finally {
        process.chdir(origCwd);
        if (origDataRoot === undefined) delete process.env.CAREER_OPS_ROOT;
        else process.env.CAREER_OPS_ROOT = origDataRoot;
        console.error = origError;
        console.warn = origWarn;
        console.log = origLog;
      }
      equal('CLI rejects a null JSON payload instead of throwing', nullExit, 1);
      equal('CLI rejects an unreadable (directory) --source instead of throwing', dirSourceExit, 1);
      equal('CLI rejects a null entry inside payload.experience instead of throwing', nullEntryExit, 1);
      equal('CLI rejects a non-array payload.experience instead of a false pass', nonArrayExperienceExit, 1);
      equal('CLI resolves a relative --source from the configured data root, not cwd', dataRootSourceExit, 0);
    } finally {
      rmSync(selfTestDir, { recursive: true, force: true });
    }
  }

  // verifyStructure() itself must not silently coerce a present, non-array
  // payload.experience into an empty array — that would report a false
  // 'pass' against a recognized cv.md without ever checking the payload.
  const nonArrayExperienceResult = verifyStructure({ experience: 'not an array' }, cvMd);
  equal('verifyStructure never reports pass for a non-array experience value',
    nonArrayExperienceResult.verdict === 'pass', false);

  // verifyStructure() is exported and reachable by any caller, not only the
  // CLI's pre-validated path — it must not throw on malformed input either.
  equal('verifyStructure(null, cvMd) reports unverified instead of throwing',
    verifyStructure(null, cvMd),
    { verdict: 'unverified', orderViolations: [], descriptorViolations: [] });
  equal('verifyStructure with a null experience entry reports unverified instead of throwing',
    verifyStructure({ experience: [null, ...correctOrder] }, cvMd),
    { verdict: 'unverified', orderViolations: [], descriptorViolations: [] });

  console.log(`verify-cv-structure self-test: ${passed} passed, ${failed} failed`);
  return failed ? 1 : 0;
}

export function runCli(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--self-test') return runSelfTest();
  let targetArg = '';
  let sourcePath = DEFAULT_SOURCE;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--source') {
      if (!args[i + 1]) { console.error('ERROR: --source requires a path'); return 1; }
      sourcePath = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      return 0;
    } else if (!targetArg) {
      targetArg = arg;
    } else {
      console.error(`ERROR: unexpected extra positional argument: ${arg}`);
      return 1;
    }
  }
  if (!targetArg) {
    console.log(usage());
    return 1;
  }
  const targetPath = resolveInputPath(targetArg);
  if (!existsSync(targetPath)) {
    console.error(`ERROR: payload not found: ${targetArg}`);
    return 1;
  }
  const srcPath = resolveSourcePath(sourcePath);
  if (!existsSync(srcPath)) {
    console.error(`ERROR: source not found: ${sourcePath}`);
    return 1;
  }
  let payload;
  try {
    payload = JSON.parse(readFileSync(targetPath, 'utf-8'));
  } catch (err) {
    console.error(`ERROR: payload is not valid JSON: ${err.message}`);
    return 1;
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    console.error(`ERROR: payload must be a JSON object, got ${payload === null ? 'null' : Array.isArray(payload) ? 'an array' : typeof payload}: ${targetArg}`);
    return 1;
  }
  if ('experience' in payload && payload.experience !== undefined && !Array.isArray(payload.experience)) {
    const got = payload.experience === null ? 'null' : typeof payload.experience;
    console.error(`ERROR: payload.experience must be an array, got ${got}: ${targetArg}`);
    return 1;
  }
  if (Array.isArray(payload.experience)) {
    const badIndex = payload.experience.findIndex(
      (e) => e === null || typeof e !== 'object' || Array.isArray(e)
    );
    if (badIndex !== -1) {
      const bad = payload.experience[badIndex];
      const badType = bad === null ? 'null' : Array.isArray(bad) ? 'an array' : typeof bad;
      console.error(`ERROR: payload.experience[${badIndex}] must be an object, got ${badType}: ${targetArg}`);
      return 1;
    }
  }
  let cvMdText;
  try {
    cvMdText = readFileSync(srcPath, 'utf-8');
  } catch (err) {
    console.error(`ERROR: source is not readable: ${sourcePath}: ${err.message}`);
    return 1;
  }
  const result = verifyStructure(payload, cvMdText);
  if (result.verdict === 'unverified') {
    console.warn(`⚠️  CV structure check UNVERIFIED: ${basename(targetPath)}`);
    console.warn(`Could not find supported company/location headers in ${sourcePath} — nothing was checked.`);
    console.warn('Expected an Experience or Work Experience section with em-dash or hyphen-separated headers; review the tailored CV structure manually.');
    return 0;
  }
  if (result.verdict === 'pass') {
    console.log(`CV structure check passed: ${basename(targetPath)}`);
    return 0;
  }
  console.warn(`⚠️  CV structure check found possible regressions: ${basename(targetPath)}`);
  if (result.orderViolations.length) {
    console.warn('\nExperience entries out of cv.md order:');
    for (const v of result.orderViolations) console.warn(`  - ${v}`);
  }
  if (result.descriptorViolations.length) {
    console.warn('\nMissing company descriptors:');
    for (const v of result.descriptorViolations) console.warn(`  - ${v}`);
  }
  console.warn('\nThis is a warning, not a blocking gate — review against cv.md and fix the payload if the loss was unintentional, then rebuild the HTML and PDF.');
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runCli();
}
