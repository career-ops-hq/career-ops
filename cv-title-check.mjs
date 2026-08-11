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
 * are reported separately as unmatched — never a mismatch.
 *
 * Warn-only, matching this project's human-in-the-loop philosophy: never
 * blocks, never edits cv.md or the tailored CV, never exits non-zero for a
 * title mismatch (exit 1 is reserved for usage/file errors and --self-test
 * failures).
 *
 * Usage:
 *   node cv-title-check.mjs /tmp/cv-jane-doe-acme.json
 *   node cv-title-check.mjs /tmp/cv-jane-doe-acme.json --summary
 *   node cv-title-check.mjs --self-test
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { normalizeCompany } from './tracker-utils.mjs';

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

export function parseTailoredExperience(payload) {
  const experience = Array.isArray(payload?.experience) ? payload.experience : [];
  return experience
    .map(e => ({
      company: String(e?.company ?? '').trim(),
      title: String(e?.role ?? '').trim(),
      dates: String(e?.dates ?? '').trim(),
    }))
    .filter(e => e.company && e.title && e.dates);
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

/**
 * Compare a tailored-CV payload's experience entries against cv.md's.
 *
 * @param {Array<{company,title,dates}>} cvEntries
 * @param {Array<{company,title,dates}>} tailoredEntries
 * @returns {{matched: Array, mismatches: Array, unmatchedTailored: Array, unmatchedCv: Array}}
 */
export function checkTitles(cvEntries, tailoredEntries) {
  const cvByKey = new Map();
  for (const entry of cvEntries) {
    const key = matchKey(entry.company, entry.dates);
    if (!cvByKey.has(key)) cvByKey.set(key, entry); // first entry wins on a duplicate key
  }

  const matched = [];
  const mismatches = [];
  const unmatchedTailored = [];
  const seenKeys = new Set();

  for (const t of tailoredEntries) {
    const key = matchKey(t.company, t.dates);
    const cvEntry = cvByKey.get(key);
    if (!cvEntry) {
      unmatchedTailored.push(t);
      continue;
    }
    seenKeys.add(key);
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

  const unmatchedCv = cvEntries.filter(e => !seenKeys.has(matchKey(e.company, e.dates)));

  return { matched, mismatches, unmatchedTailored, unmatchedCv };
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

  console.log(`\ncv-title-check self-test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// ── CLI ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const selfTestMode = args.includes('--self-test');
const payloadPathArg = args.find(a => !a.startsWith('--'));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
    const tailoredEntries = parseTailoredExperience(payload);
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
