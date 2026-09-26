#!/usr/bin/env node

/**
 * cv-title-check.mjs — Zero-LLM job-title consistency checker (#2677).
 *
 * `pdf.md`'s tailoring pipeline legitimately reformulates bullets, the summary,
 * and framing per JD (Steps 10-15) — "keywords get reformulated, never
 * fabricated" per the Data Contract. But nothing checked whether a job TITLE
 * survives that reformulation unchanged from cv.md's own canonical title for
 * the same job. A tailored CV stating a more senior-sounding title than
 * cv.md's for the exact same {company, dates} is a narrower, checkable failure
 * mode, distinct from legitimate duty/keyword reformulation — and a real risk
 * if ever cross-checked (LinkedIn, a prior CV, a background check, or an
 * interviewer asking directly).
 *
 * Input format (IMPORTANT — why this and not HTML or the rendered PDF):
 * `modes/pdf.md` Step 17 already builds a compact JSON payload before any HTML
 * or PDF exists — `{ experience: [{ company, role, dates, ... }] }` — and
 * writes it to `/tmp/cv-{candidate}-{company}.json`. That payload is the
 * earliest point in the pipeline with company/title/dates as clean structured
 * fields, straight from the tailoring step, before `build-cv-html.mjs` ever
 * touches markup. Checking there means: no HTML/PDF text-scraping regressions
 * to maintain, and the check runs (and can stop bad output) BEFORE the fact
 * gate and PDF render, matching this script's sibling `jd-skill-gap.mjs`
 * (checks before drafting, not after rendering). See modes/pdf.md Step 17a.
 *
 * Matching rule (deliberately NOT fuzzy, per the issue): pair a tailored-CV
 * entry with a cv.md entry by {company, dates} — normalized on case/whitespace
 * only, via the same normalizeCompany() the rest of the tracker ecosystem uses
 * for company-name grouping (tracker-utils.mjs). Title is the field being
 * checked, so it can never also be the matching key. An exact string match
 * (case/whitespace-normalized, no fuzzy similarity scoring) is a silent pass;
 * any other difference is a warning printed with both strings side by side so
 * the user can judge intentional framing vs. unintended drift. Entries that
 * cannot be paired (a JD-only role, a cv.md entry never carried into this
 * particular tailored CV, or a date phrasing that doesn't literally line up)
 * are reported separately as unmatched — never a mismatch. A {company, dates}
 * key that resolves to more than one entry on either side is reported as
 * ambiguous instead of comparing anything: silently keeping "the first" entry
 * would hide the rest of the group and risk pairing the wrong role.
 *
 * Warn-only, matching this project's human-in-the-loop philosophy, for
 * COMPLETED comparisons: never blocks, never edits cv.md or the tailored CV,
 * never exits non-zero for a title mismatch or an ambiguous group. Exit 1 is
 * reserved for the check not actually running to completion — a missing or
 * unreadable cv.md/payload, unparseable JSON, or an experience entry missing
 * company/role/dates (which would otherwise silently narrow the comparison
 * to only the complete entries and report a false clean bill of health) —
 * plus --self-test failures.
 *
 * Usage:
 *   node cv-title-check.mjs /tmp/cv-jane-doe-acme.json
 *   node cv-title-check.mjs /tmp/cv-jane-doe-acme.json --summary
 *   node cv-title-check.mjs --self-test
 */

import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { normalizeCompany } from './tracker-utils.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const CV_PATH = 'cv.md';

// ── cv.md experience parsing ────────────────────────────────────────
//
// cv.md's canonical shape (see examples/cv-example.md):
//
//   ### Company Name -- Location
//
//   **Job Title**
//   2020-2024
//
//   - bullet
//
// Company/location are split on the first " -- " (or " – ", an em-dash
// variant some editors auto-substitute); location is optional. The title is
// the next bolded line; dates are the next non-empty line after that. Any
// entry missing a bolded title or a dates line is skipped rather than
// guessed at — a checker that invents a comparison side is worse than one
// that reports nothing for that entry.
const HEADING_RE = /^###\s+(.+?)\s*$/;
const BOLD_LINE_RE = /^\*\*(.+?)\*\*\s*$/;

export function parseCvExperience(cvText) {
  const lines = String(cvText ?? '').replace(/\r\n/g, '\n').split('\n');
  const entries = [];

  // Only scan inside a "## Work Experience" (or "## Experience") section, so
  // an unrelated "### " heading elsewhere in the CV (e.g. under Projects)
  // never gets misread as a job.
  let inExperience = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      inExperience = /^(work\s+)?experience$/i.test(h2[1].trim());
      continue;
    }
    if (!inExperience) continue;

    const heading = line.match(HEADING_RE);
    if (!heading) continue;

    const [companyPart] = heading[1].split(/\s+[-–—]{1,2}\s+/);
    const company = companyPart.trim();
    if (!company) continue;

    // Walk forward for the bolded title line, then the dates line, skipping
    // blank lines. Stop at the next heading (### or ##) so a malformed entry
    // never eats the following one.
    let title = null;
    let dates = null;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (/^#{2,3}\s+/.test(next)) break;
      if (next.trim() === '') continue;
      if (title === null) {
        const bold = next.match(BOLD_LINE_RE);
        if (bold) {
          title = bold[1].trim();
          continue;
        }
        break; // first non-blank line after the heading must be the title
      }
      if (dates === null) {
        dates = next.trim();
      }
      break;
    }

    if (title && dates) entries.push({ company, title, dates });
  }

  return entries;
}

// ── Tailored-CV payload parsing (modes/pdf.md Step 17 JSON schema) ──

/**
 * Parse `experience[]` out of the tailored-CV render payload.
 *
 * An entry missing `company`, `role`, or `dates` is a malformed payload, not
 * a job the check can skip: silently dropping it would compare only the
 * complete entries, exit 0, and report a clean bill of health for a CV that
 * was never fully checked. Same failure category as a payload that fails to
 * parse at all — throws so the CLI can exit non-zero and name exactly which
 * entry/field needs fixing, instead of quietly narrowing the comparison set.
 *
 * @throws {Error} if `experience` is absent/non-array, or if any entry is
 *   missing company/role/dates.
 */
export function parseTailoredExperience(payload) {
  const experience = payload?.experience;
  if (!Array.isArray(experience)) {
    throw new Error('tailored CV payload must contain an experience array');
  }
  const parsed = [];
  const incomplete = [];

  experience.forEach((e, index) => {
    const company = String(e?.company ?? '').trim();
    const title = String(e?.role ?? '').trim();
    const dates = String(e?.dates ?? '').trim();
    const missingFields = [];
    if (!company) missingFields.push('company');
    if (!title) missingFields.push('role');
    if (!dates) missingFields.push('dates');

    if (missingFields.length > 0) {
      incomplete.push(`experience[${index}] is missing ${missingFields.join(', ')}`);
    } else {
      parsed.push({ company, title, dates });
    }
  });

  if (incomplete.length > 0) {
    throw new Error(
      `tailored CV payload has ${incomplete.length} incomplete experience entr${incomplete.length === 1 ? 'y' : 'ies'} — ` +
      `title check cannot run on a partial comparison set: ${incomplete.join('; ')}`
    );
  }

  return parsed;
}

// ── Normalization / matching ────────────────────────────────────────

// Case/whitespace/dash normalization only — no fuzzy similarity. A date
// phrasing that differs in more than punctuation/spacing (e.g. "2020-2024"
// on the cv.md side vs "June 2020 - Present" on the tailored side) will not
// match, and the pair is reported as unmatched rather than forced together.
export function normalizeDates(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTitle(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function matchKey(company, dates) {
  return `${normalizeCompany(company)}||${normalizeDates(dates)}`;
}

function groupByKey(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = matchKey(entry.company, entry.dates);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return groups;
}

/**
 * Compare a tailored-CV payload's experience entries against cv.md's.
 *
 * A {company, dates} key is only ever compared when it is unique on BOTH
 * sides — cv.md never legitimately carries two different jobs at the same
 * company over the exact same date range, but a malformed cv.md or a
 * tailored CV that merged two roles could produce that shape, and silently
 * picking one entry (first-entry-wins) would hide the rest of the group and
 * risk comparing the wrong role. A key with more than one entry on either
 * side is reported as `ambiguous` instead — never silently resolved into a
 * clean match/mismatch, and never dropped.
 *
 * @param {Array<{company,title,dates}>} cvEntries
 * @param {Array<{company,title,dates}>} tailoredEntries
 * @returns {{matched: Array, mismatches: Array, ambiguous: Array, unmatchedTailored: Array, unmatchedCv: Array}}
 */
export function checkTitles(cvEntries, tailoredEntries) {
  const cvGroups = groupByKey(cvEntries);
  const tailoredGroups = groupByKey(tailoredEntries);

  const matched = [];
  const mismatches = [];
  const ambiguous = [];
  const unmatchedTailored = [];
  const unmatchedCv = [];
  const seenKeys = new Set();

  for (const [key, tailoredGroup] of tailoredGroups) {
    seenKeys.add(key);
    const cvGroup = cvGroups.get(key);

    if (!cvGroup) {
      unmatchedTailored.push(...tailoredGroup);
      continue;
    }

    if (cvGroup.length > 1 || tailoredGroup.length > 1) {
      ambiguous.push({
        company: cvGroup[0].company,
        dates: cvGroup[0].dates,
        cvTitles: cvGroup.map(e => e.title),
        tailoredTitles: tailoredGroup.map(e => e.title),
      });
      continue;
    }

    const cvEntry = cvGroup[0];
    const t = tailoredGroup[0];
    const pair = {
      company: cvEntry.company,
      dates: cvEntry.dates,
      cvTitle: cvEntry.title,
      tailoredTitle: t.title,
    };
    if (normalizeTitle(cvEntry.title) === normalizeTitle(t.title)) {
      matched.push(pair);
    } else {
      mismatches.push(pair);
    }
  }

  for (const [key, cvGroup] of cvGroups) {
    if (!seenKeys.has(key)) unmatchedCv.push(...cvGroup);
  }

  return { matched, mismatches, ambiguous, unmatchedTailored, unmatchedCv };
}

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

  const cvText = `
# CV -- Jane Doe

## Work Experience

### Acme Corp -- Remote

**Senior Software Engineer**
2020-2024

- Did things

### Globex Inc. -- Austin, TX

**Engineer**
2018-2020

- Did other things

## Projects

### Not A Job -- should be ignored
`;

  const cvEntries = parseCvExperience(cvText);
  eq('parses two experience entries from cv.md', cvEntries.length, 2);
  eq('does not parse ### headings outside Work Experience', cvEntries.some(e => e.company === 'Not A Job'), false);

  // Case 1: title unchanged -> no warning.
  const unchangedPayload = { experience: [{ company: 'Acme Corp', role: 'Senior Software Engineer', dates: '2020-2024' }] };
  const unchangedResult = checkTitles(cvEntries, parseTailoredExperience(unchangedPayload));
  eq('unchanged title produces zero mismatches', unchangedResult.mismatches.length, 0);
  eq('unchanged title is reported as matched', unchangedResult.matched.length, 1);

  // Case 2: same company/dates, drifted title -> warning with both strings.
  const driftedPayload = { experience: [{ company: 'Acme Corp', role: 'Engineering Lead', dates: '2020-2024' }] };
  const driftedResult = checkTitles(cvEntries, parseTailoredExperience(driftedPayload));
  eq('drifted title produces one mismatch', driftedResult.mismatches.length, 1);
  eq('mismatch carries the cv.md canonical title', driftedResult.mismatches[0]?.cvTitle, 'Senior Software Engineer');
  eq('mismatch carries the tailored CV title', driftedResult.mismatches[0]?.tailoredTitle, 'Engineering Lead');

  // Case 3: company-name formatting differences (trailing "Inc.", extra
  // whitespace) still pair up via normalizeCompany, and an unchanged title
  // under that formatting drift is still a clean match, not a false mismatch.
  const formattingPayload = { experience: [{ company: '  Globex   Inc  ', role: 'Engineer', dates: '2018 - 2020' }] };
  const formattingResult = checkTitles(cvEntries, parseTailoredExperience(formattingPayload));
  eq('company formatting differences still pair the entry', formattingResult.mismatches.length + formattingResult.matched.length, 1);
  eq('formatting-only differences do not produce a false mismatch', formattingResult.mismatches.length, 0);
  eq('formatting-only differences still match', formattingResult.matched.length, 1);

  // Unmatched: a company/dates pair with no cv.md counterpart is reported
  // separately, never forced into a mismatch.
  const unmatchedPayload = { experience: [{ company: 'Brand New Co', role: 'Founder', dates: '2024-Present' }] };
  const unmatchedResult = checkTitles(cvEntries, parseTailoredExperience(unmatchedPayload));
  eq('an entry with no cv.md counterpart is unmatched, not a mismatch', unmatchedResult.unmatchedTailored.length, 1);
  eq('an unmatched entry never appears as a mismatch', unmatchedResult.mismatches.length, 0);

  // Case sensitivity / whitespace-only title differences are not a mismatch.
  const caseOnlyPayload = { experience: [{ company: 'Acme Corp', role: '  senior software engineer ', dates: '2020-2024' }] };
  const caseOnlyResult = checkTitles(cvEntries, parseTailoredExperience(caseOnlyPayload));
  eq('case/whitespace-only title differences are not a mismatch', caseOnlyResult.mismatches.length, 0);

  // An incomplete experience entry (missing a required field) must fail
  // loudly, not be silently filtered out of the comparison set — a payload
  // mixing one valid entry with one incomplete entry must NOT quietly
  // compare only the valid one and report a clean result.
  const throwsFor = (label, payload) => {
    try {
      parseTailoredExperience(payload);
      failed++;
      console.log(`  FAIL: ${label}\n    expected: throw\n    actual:   no throw`);
    } catch {
      passed++;
    }
  };
  throwsFor('an entry missing dates throws instead of being dropped', {
    experience: [{ company: 'Acme Corp', role: 'Senior Software Engineer' }],
  });
  throwsFor('an entry missing role throws instead of being dropped', {
    experience: [{ company: 'Acme Corp', dates: '2020-2024' }],
  });
  throwsFor('an entry missing company throws instead of being dropped', {
    experience: [{ role: 'Senior Software Engineer', dates: '2020-2024' }],
  });
  throwsFor('one incomplete entry throws even alongside an otherwise-valid entry (no partial comparison)', {
    experience: [
      { company: 'Acme Corp', role: 'Senior Software Engineer', dates: '2020-2024' },
      { company: 'Globex Inc.', role: 'Engineer' }, // missing dates
    ],
  });
  try {
    parseTailoredExperience({
      experience: [{ company: 'Acme Corp', role: 'Senior Software Engineer' }],
    });
    failed++;
    console.log('  FAIL: incomplete-entry error names the missing field\n    expected: throw mentioning "dates"\n    actual:   no throw');
  } catch (err) {
    eq('incomplete-entry error names the missing field', err.message.includes('dates'), true);
    eq('incomplete-entry error names the entry index', err.message.includes('experience[0]'), true);
  }

  // A missing or non-array `experience` must throw, not silently become an
  // empty comparison set — {"experience": {}} must not exit 0 having checked
  // nothing.
  throwsFor('a payload with no experience key throws instead of defaulting to []', {});
  throwsFor('a non-array experience value (object) throws', { experience: {} });
  throwsFor('a non-array experience value (string) throws', { experience: 'none' });
  eq('an explicit empty experience array is still valid (no experience entries)',
    parseTailoredExperience({ experience: [] }).length, 0);

  // Duplicate {company, dates} key IN cv.md (two different jobs, same range —
  // malformed but possible): must be reported as ambiguous, never resolved by
  // silently picking one cv.md entry and hiding the other.
  const dupCvText = `
# CV -- Jane Doe

## Work Experience

### Acme Corp -- Remote

**Senior Software Engineer**
2020-2024

- Did things

### Acme Corp -- Remote

**Contractor**
2020-2024

- Did other things
`;
  const dupCvEntries = parseCvExperience(dupCvText);
  eq('parses both duplicate-key cv.md entries (neither is dropped)', dupCvEntries.length, 2);
  const dupCvPayload = { experience: [{ company: 'Acme Corp', role: 'Senior Software Engineer', dates: '2020-2024' }] };
  const dupCvResult = checkTitles(dupCvEntries, parseTailoredExperience(dupCvPayload));
  eq('a cv.md-side duplicate key is reported as ambiguous', dupCvResult.ambiguous.length, 1);
  eq('an ambiguous cv.md-side key is not silently matched', dupCvResult.matched.length, 0);
  eq('an ambiguous cv.md-side key is not silently reported as a mismatch either', dupCvResult.mismatches.length, 0);
  eq('the ambiguous group carries both cv.md titles', dupCvResult.ambiguous[0]?.cvTitles.sort(), ['Contractor', 'Senior Software Engineer']);

  // Duplicate {company, dates} key on the TAILORED-CV side (e.g. the payload
  // accidentally lists the same job twice, or two distinct roles collapsed
  // onto the same dates): also ambiguous, never resolved by picking one.
  const dupTailoredPayload = {
    experience: [
      { company: 'Acme Corp', role: 'Senior Software Engineer', dates: '2020-2024' },
      { company: 'Acme Corp', role: 'Engineering Lead', dates: '2020-2024' },
    ],
  };
  const dupTailoredResult = checkTitles(cvEntries, parseTailoredExperience(dupTailoredPayload));
  eq('a tailored-CV-side duplicate key is reported as ambiguous', dupTailoredResult.ambiguous.length, 1);
  eq('an ambiguous tailored-CV-side key is not silently matched', dupTailoredResult.matched.length, 0);
  eq('an ambiguous tailored-CV-side key is not silently reported as a mismatch either', dupTailoredResult.mismatches.length, 0);
  eq('the ambiguous group carries both tailored titles', dupTailoredResult.ambiguous[0]?.tailoredTitles.sort(), ['Engineering Lead', 'Senior Software Engineer']);

  // CLI exit-code contract (modes/pdf.md Step 17a relies on this distinction):
  // a genuine input failure (missing/malformed cv.md or payload) must exit
  // non-zero so the pipeline stops and repairs the input, while a completed
  // comparison — even one that FOUND mismatches or ambiguous groups — is
  // warn-only and always exits 0. Drives the real CLI as a subprocess against
  // fixture files, the only honest way to test process.exit() codes.
  const scriptPath = fileURLToPath(import.meta.url);
  const cliTmp = mkdtempSync(join(tmpdir(), 'cv-title-check-cli-'));
  try {
    const validCv = `
# CV -- Jane Doe

## Work Experience

### Acme Corp -- Remote

**Senior Software Engineer**
2020-2024

- Did things
`;
    writeFileSync(join(cliTmp, 'cv.md'), validCv);

    const runCli = (args, cwd = cliTmp) => spawnSync(process.execPath, [scriptPath, ...args], { cwd, encoding: 'utf-8' });

    // Missing payload argument entirely -> usage error, exit 1.
    eq('CLI exits 1 with no payload argument', runCli([]).status, 1);

    // Payload path that does not exist -> exit 1, never treated as "no mismatches".
    eq('CLI exits 1 when the payload file does not exist', runCli(['does-not-exist.json']).status, 1);

    // cv.md missing entirely -> exit 1 (this is the workspace-not-set-up case,
    // distinct from the check having run and found no mismatches).
    const noCvDir = mkdtempSync(join(tmpdir(), 'cv-title-check-nocv-'));
    try {
      writeFileSync(join(noCvDir, 'payload.json'), JSON.stringify({ experience: [] }));
      eq('CLI exits 1 when cv.md does not exist', runCli(['payload.json'], noCvDir).status, 1);
    } finally {
      rmSync(noCvDir, { recursive: true, force: true });
    }

    // Malformed JSON payload -> exit 1, not silently treated as zero entries.
    writeFileSync(join(cliTmp, 'malformed.json'), '{ this is not valid json');
    eq('CLI exits 1 on a malformed JSON payload', runCli(['malformed.json']).status, 1);

    // A payload mixing one valid entry with one incomplete entry (missing
    // dates) must fail loudly — never silently compare only the valid entry
    // and report success as though the whole CV had been checked.
    writeFileSync(join(cliTmp, 'partial.json'), JSON.stringify({
      experience: [
        { company: 'Acme Corp', role: 'Senior Software Engineer', dates: '2020-2024' },
        { company: 'Globex Inc.', role: 'Engineer' }, // missing dates
      ],
    }));
    const partialRun = runCli(['partial.json', '--summary']);
    eq('CLI exits 1 for a payload with one incomplete experience entry (no silent partial comparison)', partialRun.status, 1);
    eq('the exit-1 partial-payload run does not print a clean-result summary', /No title drift found/i.test(partialRun.stdout), false);

    // A completed comparison that FINDS a title mismatch is still warn-only:
    // exit 0, distinguishing "the check ran and found something to warn
    // about" from "the check could not run at all".
    writeFileSync(join(cliTmp, 'mismatch.json'), JSON.stringify({
      experience: [{ company: 'Acme Corp', role: 'Engineering Lead', dates: '2020-2024' }],
    }));
    const mismatchRun = runCli(['mismatch.json', '--summary']);
    eq('CLI exits 0 for a completed comparison that finds a title mismatch (warn-only)', mismatchRun.status, 0);
    eq('the exit-0 mismatch run still prints the warning', /title mismatch/i.test(mismatchRun.stdout), true);

    // A completed comparison that finds an ambiguous {company, dates} group
    // is likewise warn-only, not a failure.
    const ambiguousCv = validCv + `
### Acme Corp -- Remote

**Contractor**
2020-2024

- Did other things
`;
    const ambiguousDir = mkdtempSync(join(tmpdir(), 'cv-title-check-ambiguous-'));
    try {
      writeFileSync(join(ambiguousDir, 'cv.md'), ambiguousCv);
      writeFileSync(join(ambiguousDir, 'mismatch.json'), JSON.stringify({
        experience: [{ company: 'Acme Corp', role: 'Senior Software Engineer', dates: '2020-2024' }],
      }));
      const ambiguousRun = runCli(['mismatch.json', '--summary'], ambiguousDir);
      eq('CLI exits 0 for a completed comparison that finds an ambiguous group (warn-only)', ambiguousRun.status, 0);
      eq('the exit-0 ambiguous run still prints the warning', /ambiguous/i.test(ambiguousRun.stdout), true);
    } finally {
      rmSync(ambiguousDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(cliTmp, { recursive: true, force: true });
  }

  console.log(`\ncv-title-check self-test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// ── CLI ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const selfTestMode = args.includes('--self-test');
const payloadPathArg = args.find(a => !a.startsWith('--'));

if (isMainModule(import.meta.url)) {
  if (selfTestMode) {
    runSelfTest();
  } else {
    if (!payloadPathArg || !existsSync(payloadPathArg)) {
      console.error('Usage: node cv-title-check.mjs <tailored-cv-payload.json> [--summary]');
      console.error('       node cv-title-check.mjs --self-test');
      process.exit(1);
    }
    if (!existsSync(CV_PATH)) {
      console.error(`Error: ${CV_PATH} not found — this is a user-layer file, create it first.`);
      process.exit(1);
    }

    let payload;
    try {
      payload = JSON.parse(readFileSync(payloadPathArg, 'utf-8'));
    } catch (err) {
      console.error(`Error: could not parse ${payloadPathArg} as JSON: ${err.message}`);
      process.exit(1);
    }

    const cvEntries = parseCvExperience(readFileSync(CV_PATH, 'utf-8'));
    let tailoredEntries;
    try {
      tailoredEntries = parseTailoredExperience(payload);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    const result = checkTitles(cvEntries, tailoredEntries);

    if (summaryMode) {
      console.log('\nCV Title Consistency Check');
      console.log('─'.repeat(40));
      console.log(`Entries compared: ${result.matched.length + result.mismatches.length}`);
      if (result.mismatches.length === 0) {
        console.log('✅ No title drift found — every matched entry uses cv.md\'s canonical title.');
      } else {
        console.log(`⚠️  ${result.mismatches.length} title mismatch(es) found:`);
        for (const m of result.mismatches) {
          console.log(`\n  ${m.company} (${m.dates})`);
          console.log(`    cv.md:        "${m.cvTitle}"`);
          console.log(`    tailored CV:  "${m.tailoredTitle}"`);
        }
      }
      if (result.ambiguous.length > 0) {
        console.log(`\n⚠️  ${result.ambiguous.length} ambiguous {company, dates} key(s) — multiple entries on one or both sides, not auto-resolved:`);
        for (const a of result.ambiguous) {
          console.log(`\n  ${a.company} (${a.dates})`);
          console.log(`    cv.md titles:        ${a.cvTitles.map(t => `"${t}"`).join(', ')}`);
          console.log(`    tailored CV titles:  ${a.tailoredTitles.map(t => `"${t}"`).join(', ')}`);
        }
      }
      if (result.unmatchedTailored.length > 0) {
        console.log(`\n  (${result.unmatchedTailored.length} tailored entr${result.unmatchedTailored.length === 1 ? 'y has' : 'ies have'} no matching {company, dates} in cv.md — not checked)`);
      }
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

    // Warn-only: a title mismatch is never a failing exit code.
    process.exit(0);
  }
}
