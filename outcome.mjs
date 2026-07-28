#!/usr/bin/env node

/**
 * outcome.mjs — Record application outcomes, archive artifacts, and sync tracker (#1722).
 *
 * Usage:
 *   node outcome.mjs <report#|company> <outcome_type> [--stage "..."] [--feedback "..."] [--note "..."] [--role "..."] [--cv "..."] [--cover "..."] [--dry-run] [--json]
 *
 * Outcomes:
 *   interview_progress | offer_received | hired | offer_declined | rejected | no_response | interview_only
 *
 * Artifacts saved in data/outcomes/{num}_{company_slug}_{role_slug}/:
 *   - submitted_cv.md
 *   - submitted_cover_letter.md (if provided)
 *   - posting.pdf or posting_missing.md (explicit stub)
 *   - outcome.md (append-only outcome journal)
 *
 * Synchronizes tracker status using set-status.mjs under shared tracker lock.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { parseTrackerRow, resolveColumns, extractTrackerReportNumbers } from './tracker-parse.mjs';
import { roleFuzzyMatch } from './role-matcher.mjs';
import { resolveTrackerPath, normalizeCompany } from './tracker-utils.mjs';
import { parsePdfIndex } from './find.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const SET_STATUS_SCRIPT = join(CAREER_OPS, 'set-status.mjs');
const ARCHIVE_POSTING_SCRIPT = join(CAREER_OPS, 'archive-posting.mjs');

const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_NOT_FOUND = 2;
const EXIT_AMBIGUOUS = 3;

function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'unknown';
}

function today() {
  return new Date().toISOString().split('T')[0];
}

const OUTCOME_MAP = {
  interview_progress: { state: 'Interview', defaultNote: 'Stage updated' },
  stage_reached: { state: 'Interview', defaultNote: 'Stage updated' },
  interview: { state: 'Interview', defaultNote: 'Interview stage' },
  offer_received: { state: 'Offer', defaultNote: 'Offer received' },
  offer: { state: 'Offer', defaultNote: 'Offer received' },
  hired: { state: 'Hired', defaultNote: 'Offer accepted' },
  accepted: { state: 'Hired', defaultNote: 'Offer accepted' },
  offer_declined: { state: 'Discarded', defaultNote: 'Offer declined by candidate' },
  declined: { state: 'Discarded', defaultNote: 'Offer declined by candidate' },
  rejected: { state: 'Rejected', defaultNote: 'Application rejected' },
  rejection: { state: 'Rejected', defaultNote: 'Application rejected' },
  no_response: { state: 'Discarded', defaultNote: 'No response / ghosted' },
  ghosted: { state: 'Discarded', defaultNote: 'No response / ghosted' },
  interview_only: { state: 'Interview', defaultNote: 'Interview process completed' },
};

const USAGE = `Usage: node outcome.mjs <report#|company> <outcome_type> [options]

  <report#|company>  Tracker selector (# or company name)
  <outcome_type>     interview_progress | offer_received | hired | offer_declined | rejected | no_response | interview_only
  --stage "..."      Stage reached (e.g. "Tech Screen", "Final Round")
  --feedback "..."   Verbatim candidate/recruiter feedback
  --note "..."       Custom note to append to tracker
  --role "..."       Disambiguate company match
  --cv "..."         Path to submitted CV (defaults to cv.md)
  --cover "..."      Path to submitted cover letter
  --dry-run          Preview outcome logging without writing
  --json             Machine-readable JSON output`;

const rawArgs = process.argv.slice(2);
const positional = [];
const flags = {
  stage: null,
  feedback: null,
  note: null,
  role: null,
  cv: null,
  cover: null,
  url: null,
  dryRun: false,
  json: false,
};

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (['--stage', '--feedback', '--note', '--role', '--cv', '--cover', '--url'].includes(a)) {
    const val = rawArgs[i + 1];
    if (val === undefined || val.startsWith('--')) {
      console.error(`❌ Missing value for ${a}`);
      process.exit(EXIT_USAGE);
    }
    const key = a.slice(2);
    flags[key] = val;
    i++;
  } else if (a === '--dry-run') {
    flags.dryRun = true;
  } else if (a === '--json') {
    flags.json = true;
  } else if (a === '--help' || a === '-h') {
    console.log(USAGE);
    process.exit(EXIT_OK);
  } else if (a.startsWith('--')) {
    console.error(`❌ Unknown flag: ${a}`);
    process.exit(EXIT_USAGE);
  } else {
    positional.push(a);
  }
}

if (positional.length < 2) {
  if (flags.json) {
    console.log(JSON.stringify({ error: 'Expected 2 positional arguments: <selector> <outcome_type>', code: 'usage' }));
  } else {
    console.error(`❌ Expected 2 positional arguments: <selector> <outcome_type>\n\n${USAGE}`);
  }
  process.exit(EXIT_USAGE);
}

const [selector, rawOutcomeType] = positional;
const normalizedOutcomeKey = rawOutcomeType.toLowerCase().replace(/-/g, '_');
const outcomeConfig = OUTCOME_MAP[normalizedOutcomeKey];

if (!outcomeConfig) {
  const validTypes = Object.keys(OUTCOME_MAP).join(' · ');
  if (flags.json) {
    console.log(JSON.stringify({ error: `Invalid outcome_type "${rawOutcomeType}". Valid types: ${validTypes}`, code: 'invalid-outcome' }));
  } else {
    console.error(`❌ Invalid outcome_type "${rawOutcomeType}". Valid types: ${validTypes}`);
  }
  process.exit(EXIT_USAGE);
}

const appsFile = resolveTrackerPath(CAREER_OPS);
if (!existsSync(appsFile)) {
  console.error(`❌ Tracker not found at ${appsFile}`);
  process.exit(EXIT_NOT_FOUND);
}

const content = readFileSync(appsFile, 'utf-8');
const lines = content.split('\n');
const colmap = resolveColumns(lines);
const rows = [];

for (let i = 0; i < lines.length; i++) {
  const r = parseTrackerRow(lines[i], colmap);
  if (r) rows.push(r);
}

if (rows.length === 0) {
  console.error(`❌ Tracker at ${appsFile} is empty`);
  process.exit(EXIT_NOT_FOUND);
}

let matchedRow = null;
if (/^\d+$/.test(selector)) {
  const num = parseInt(selector, 10);
  let matches = rows.filter(r => r.num === num);
  if (matches.length === 0) {
    console.error(`❌ No tracker row with #${num}`);
    process.exit(EXIT_NOT_FOUND);
  }
  if (matches.length > 1 && flags.role) {
    const narrowed = matches.filter(r => roleFuzzyMatch(r.role, flags.role));
    if (narrowed.length === 1) matches = narrowed;
  }
  if (matches.length > 1) {
    console.error(`❌ Ambiguous tracker #${num} match`);
    process.exit(EXIT_AMBIGUOUS);
  }
  matchedRow = matches[0];
} else {
  const key = normalizeCompany(selector);
  let matches = rows.filter(r => normalizeCompany(r.company) === key);
  if (matches.length === 0) {
    matches = rows.filter(r => normalizeCompany(r.company).includes(key) || key.includes(normalizeCompany(r.company)));
  }
  if (matches.length === 0) {
    console.error(`❌ No tracker row for company matching "${selector}"`);
    process.exit(EXIT_NOT_FOUND);
  }
  if (matches.length > 1 && flags.role) {
    const narrowed = matches.filter(r => roleFuzzyMatch(r.role, flags.role));
    if (narrowed.length === 1) matches = narrowed;
  }
  if (matches.length > 1) {
    console.error(`❌ Multiple tracker rows for company "${selector}" — pass --role or row #`);
    process.exit(EXIT_AMBIGUOUS);
  }
  matchedRow = matches[0];
}

const companySlug = slugify(matchedRow.company);
const roleSlug = slugify(matchedRow.role);
const trackerDir = dirname(appsFile);
const repoRoot = dirname(trackerDir);
const outcomeDir = join(trackerDir, 'outcomes', `${matchedRow.num}_${companySlug}_${roleSlug}`);

const noteToAppend = flags.note || (flags.stage ? `${outcomeConfig.defaultNote}: ${flags.stage}` : outcomeConfig.defaultNote);

if (flags.dryRun) {
  const dryRunResult = {
    dryRun: true,
    num: matchedRow.num,
    company: matchedRow.company,
    role: matchedRow.role,
    outcomeType: normalizedOutcomeKey,
    canonicalState: outcomeConfig.state,
    stage: flags.stage,
    feedback: flags.feedback,
    note: noteToAppend,
    outcomeDir,
  };
  if (flags.json) {
    console.log(JSON.stringify(dryRunResult, null, 2));
  } else {
    console.log(`🔍 Dry-run: would record outcome "${normalizedOutcomeKey}" for #${matchedRow.num} ${matchedRow.company} (${outcomeConfig.state}) in ${outcomeDir}`);
  }
  process.exit(EXIT_OK);
}

mkdirSync(outcomeDir, { recursive: true });

// 1. Snapshot submitted CV
// Try to locate a tailored generated PDF CV first, to ensure we capture the EXACT submitted CV.
let cvResolvedPath = null;
let isPdf = false;

// Case A: A custom CV path is explicitly passed via CLI options.
if (flags.cv) {
  cvResolvedPath = flags.cv;
  isPdf = flags.cv.toLowerCase().endsWith('.pdf');
} else {
  // Case B: Read tracker's PDF column cell and resolve its path.
  if (matchedRow.pdf && matchedRow.pdf !== '—' && matchedRow.pdf !== '-') {
    const rawPdfPath = matchedRow.pdf.replace(/^local:/, '');
    const fullPdfPath = join(repoRoot, rawPdfPath);
    if (existsSync(fullPdfPath)) {
      cvResolvedPath = fullPdfPath;
      isPdf = true;
    }
  }

  // Case C: Lookup data/pdf-index.tsv to find PDF mapping for the linked report number.
  if (!cvResolvedPath) {
    const manifestPath = join(repoRoot, 'data', 'pdf-index.tsv');
    if (existsSync(manifestPath)) {
      try {
        const manifestText = readFileSync(manifestPath, 'utf-8');
        const pdfMap = parsePdfIndex(manifestText);
        const reportNums = extractTrackerReportNumbers(matchedRow.report);
        for (const num of reportNums) {
          const mappedPdf = pdfMap.get(String(num).padStart(3, '0')) || pdfMap.get(String(num));
          if (mappedPdf) {
            const fullPdfPath = join(repoRoot, mappedPdf.replace(/^local:/, ''));
            if (existsSync(fullPdfPath)) {
              cvResolvedPath = fullPdfPath;
              isPdf = true;
              break;
            }
          }
        }
      } catch (err) {
        // Fallback gracefully on parsing issues
      }
    }
  }
}

// Write or copy resolved CV artifact to outcomeDir.
if (cvResolvedPath && existsSync(cvResolvedPath)) {
  const destName = isPdf ? 'submitted_cv.pdf' : 'submitted_cv.md';
  copyFileSync(cvResolvedPath, join(outcomeDir, destName));
} else {
  // Case D: Fallback to the master root cv.md.
  const masterCv = join(repoRoot, 'cv.md');
  if (existsSync(masterCv)) {
    copyFileSync(masterCv, join(outcomeDir, 'submitted_cv.md'));
  } else {
    writeFileSync(join(outcomeDir, 'submitted_cv.md'), `# Submitted CV — #${matchedRow.num} ${matchedRow.company}\n\nNo CV source file found at ${masterCv} on ${today()}.\n`);
  }
}

// 2. Snapshot submitted cover letter if provided
if (flags.cover && existsSync(flags.cover)) {
  copyFileSync(flags.cover, join(outcomeDir, 'submitted_cover_letter.md'));
}

// 3. Archive job posting or write explicit stub
let postingArchived = false;
const targetUrl = flags.url || (matchedRow.notes && matchedRow.notes.match(/https?:\/\/[^\s|)]+/)?.[0]);

if (targetUrl) {
  try {
    execFileSync(NODE, [ARCHIVE_POSTING_SCRIPT, targetUrl, `--company=${matchedRow.company}`, `--role=${matchedRow.role}`], {
      cwd: CAREER_OPS,
      env: process.env,
      stdio: 'ignore',
      timeout: 45000,
    });
    postingArchived = true;
  } catch {
    postingArchived = false;
  }
}

if (!postingArchived) {
  const stubContent = `# Job Posting Snapshot — Unavailable

- **Date**: ${today()}
- **Company**: ${matchedRow.company}
- **Role**: ${matchedRow.role}
- **Tracker #**: #${matchedRow.num}
- **URL**: ${targetUrl || 'None provided'}
- **Reason**: Live posting URL could not be reached or archived.
`;
  writeFileSync(join(outcomeDir, 'posting_missing.md'), stubContent);
}

// 4. Append entry to outcome.md
const outcomeLogPath = join(outcomeDir, 'outcome.md');
const entryHeader = `## Entry: ${today()}`;
const newEntry = `${entryHeader}
- **Outcome Type**: ${normalizedOutcomeKey}
- **Canonical State**: ${outcomeConfig.state}
- **Stage Reached**: ${flags.stage || 'N/A'}
- **Verbatim Feedback**:
> ${flags.feedback ? flags.feedback.replace(/\r?\n/g, '\n> ') : 'None recorded'}
- **Notes**: ${noteToAppend}
`;

if (existsSync(outcomeLogPath)) {
  const existingLog = readFileSync(outcomeLogPath, 'utf-8');
  if (!existingLog.includes(newEntry.trim())) {
    writeFileSync(outcomeLogPath, existingLog.endsWith('\n') ? existingLog + '\n' + newEntry : existingLog + '\n\n' + newEntry);
  }
} else {
  const initialLog = `# Application Outcome Log — ${matchedRow.company} — ${matchedRow.role} (#${matchedRow.num})

${newEntry}`;
  writeFileSync(outcomeLogPath, initialLog);
}

// 5. Update tracker via set-status.mjs
const setStatusArgs = [
  SET_STATUS_SCRIPT,
  String(matchedRow.num),
  outcomeConfig.state,
  '--note', noteToAppend,
  '--force',
  '--json',
];

if (matchedRow.role) {
  setStatusArgs.push('--role', matchedRow.role);
}

let setStatusResult = null;
try {
  const statusOutput = execFileSync(NODE, setStatusArgs, { cwd: CAREER_OPS, env: process.env, encoding: 'utf-8' });
  setStatusResult = JSON.parse(statusOutput);
} catch (err) {
  console.error(`⚠️ Tracker update via set-status.mjs warning: ${err.message}`);
}

const result = {
  success: true,
  num: matchedRow.num,
  company: matchedRow.company,
  role: matchedRow.role,
  outcomeType: normalizedOutcomeKey,
  canonicalState: outcomeConfig.state,
  stage: flags.stage,
  feedback: flags.feedback,
  note: noteToAppend,
  outcomeDir,
  postingArchived,
  setStatusResult,
};

if (flags.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`✅ Recorded outcome "${normalizedOutcomeKey}" for #${matchedRow.num} ${matchedRow.company} (${outcomeConfig.state}) in ${outcomeDir}`);
}

process.exit(EXIT_OK);
