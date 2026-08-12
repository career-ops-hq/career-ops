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
import { join, dirname, resolve, extname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { parseTrackerRow, resolveColumns, extractTrackerReportNumbers } from './tracker-parse.mjs';
import { roleFuzzyMatch } from './role-matcher.mjs';
import { resolveTrackerPath, normalizeCompany } from './tracker-utils.mjs';
import { parsePdfIndex } from './find.mjs';
import { findCaptureForReport } from './jd-capture.mjs';

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
  --url "..."        Job posting URL (overrides auto-detection from tracker notes)
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
  json: rawArgs.includes('--json'),
};

function failExit(msg, code, exitCode) {
  if (flags.json) {
    console.log(JSON.stringify({ error: msg, code }));
  } else {
    console.error(`❌ ${msg}`);
  }
  process.exit(exitCode);
}

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (['--stage', '--feedback', '--note', '--role', '--cv', '--cover', '--url'].includes(a)) {
    const val = rawArgs[i + 1];
    if (val === undefined || val.startsWith('--')) {
      failExit(`Missing value for ${a}`, 'usage', EXIT_USAGE);
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
    failExit(`Unknown flag: ${a}`, 'usage', EXIT_USAGE);
  } else {
    positional.push(a);
  }
}

if (positional.length < 2) {
  failExit(`Expected 2 positional arguments: <selector> <outcome_type>\n\n${USAGE}`, 'usage', EXIT_USAGE);
}

const [selector, rawOutcomeType] = positional;
const normalizedOutcomeKey = rawOutcomeType.toLowerCase().replace(/-/g, '_');
const outcomeConfig = OUTCOME_MAP[normalizedOutcomeKey];

if (!outcomeConfig) {
  const validTypes = Object.keys(OUTCOME_MAP).join(' · ');
  failExit(`Invalid outcome_type "${rawOutcomeType}". Valid types: ${validTypes}`, 'invalid-outcome', EXIT_USAGE);
}

const appsFile = resolveTrackerPath(CAREER_OPS);
if (!existsSync(appsFile)) {
  failExit(`Tracker not found at ${appsFile}`, 'tracker-not-found', EXIT_NOT_FOUND);
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
  failExit(`Tracker at ${appsFile} is empty`, 'tracker-empty', EXIT_NOT_FOUND);
}

let matchedRow = null;
let candidates = [];

if (/^\d+$/.test(selector)) {
  const num = parseInt(selector, 10);
  candidates = rows.filter(r => r.num === num);
  if (candidates.length === 0) {
    failExit(`No tracker row with #${num}`, 'row-not-found', EXIT_NOT_FOUND);
  }
} else {
  const key = normalizeCompany(selector);
  candidates = rows.filter(r => normalizeCompany(r.company) === key);
  if (candidates.length === 0) {
    candidates = rows.filter(r => normalizeCompany(r.company).includes(key) || key.includes(normalizeCompany(r.company)));
  }
  if (candidates.length === 0) {
    failExit(`No tracker row for company matching "${selector}"`, 'company-not-found', EXIT_NOT_FOUND);
  }
}

// Disambiguate if multiple rows are found
if (candidates.length > 1 && flags.role) {
  const narrowed = candidates.filter(r => roleFuzzyMatch(r.role, flags.role));
  if (narrowed.length === 1) {
    candidates = narrowed;
  }
}

if (candidates.length > 1) {
  const listMsg = candidates.map(c => `#${c.num}: ${c.company} (${c.role})`).join(', ');
  failExit(`Multiple tracker rows matched "${selector}" (${listMsg}) — pass --role or row #`, 'ambiguous-match', EXIT_AMBIGUOUS);
}

matchedRow = candidates[0];

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

// Write or copy resolved CV artifact to outcomeDir, preserving existing files instead of overwriting.
if (cvResolvedPath && existsSync(cvResolvedPath)) {
  const destName = isPdf ? 'submitted_cv.pdf' : 'submitted_cv.md';
  const cvDestPath = join(outcomeDir, destName);
  if (!existsSync(cvDestPath)) {
    copyFileSync(cvResolvedPath, cvDestPath);
  }
} else {
  // Case D: Fallback to the master root cv.md.
  const masterCv = resolve(repoRoot, 'cv.md');
  const cvDestPath = join(outcomeDir, 'submitted_cv.md');
  if (!existsSync(cvDestPath)) {
    if (existsSync(masterCv)) {
      copyFileSync(masterCv, cvDestPath);
    } else {
      writeFileSync(cvDestPath, `# Submitted CV — #${matchedRow.num} ${matchedRow.company}\n\nNo CV source file found at ${masterCv} on ${today()}.\n`);
    }
  }
}

// 2. Snapshot submitted cover letter if provided, preserving existing files instead of overwriting.
if (flags.cover && existsSync(flags.cover)) {
  const coverDestPath = join(outcomeDir, 'submitted_cover_letter.md');
  if (!existsSync(coverDestPath)) {
    copyFileSync(flags.cover, coverDestPath);
  }
}

// 3. Archive job posting or write explicit stub, preserving existing files instead of overwriting.
let postingArchived = false;
let resolvedPostingPath = null;
const targetUrl = flags.url || (matchedRow.notes && matchedRow.notes.match(/https?:\/\/[^\s|)]+/)?.[0]);

// Case 1: Check if there's already an archived posting link in the notes column
const notesLink = matchedRow.notes && matchedRow.notes.match(/local:(jds\/[^\s|)]+)/)?.[1];
if (notesLink) {
  const fullPath = resolve(repoRoot, notesLink);
  if (existsSync(fullPath)) {
    resolvedPostingPath = fullPath;
    postingArchived = true;
  }
}

// Case 2: Look for a capture already keyed to this report number. Covers captures
// made on any earlier day, and postings whose URL has since gone dead — the case
// the archive exists for, and the one a same-day filename rebuild cannot serve.
if (!resolvedPostingPath) {
  const found = findCaptureForReport(resolve(repoRoot, 'jds'), matchedRow.num, {
    companySlug: slugify(matchedRow.company),
  });
  if (found) {
    resolvedPostingPath = found.path;
    postingArchived = true;
  }
}

// Case 3: Archive the posting now, keyed to the report so it resolves next time.
if (!resolvedPostingPath && targetUrl) {
  try {
    execFileSync(NODE, [ARCHIVE_POSTING_SCRIPT, targetUrl, `--company=${matchedRow.company}`, `--role=${matchedRow.role}`, `--report=${matchedRow.num}`], {
      cwd: CAREER_OPS,
      env: process.env,
      stdio: 'ignore',
      timeout: 45000,
    });
    const found = findCaptureForReport(resolve(repoRoot, 'jds'), matchedRow.num, {
      companySlug: slugify(matchedRow.company),
    });
    if (found) {
      resolvedPostingPath = found.path;
      postingArchived = true;
    }
  } catch {
    postingArchived = false;
  }
}

// Copy posting snapshot to the outcomes directory, preserving the original if it exists.
// The destination keeps the capture's own extension: captures are .pdf, .txt or .md,
// and naming a text capture posting.pdf would misrepresent its contents.
if (postingArchived && resolvedPostingPath) {
  const postingDest = join(outcomeDir, `posting${extname(resolvedPostingPath) || '.pdf'}`);
  if (!existsSync(postingDest)) {
    copyFileSync(resolvedPostingPath, postingDest);
  }
} else {
  const stubContent = `# Job Posting Snapshot — Unavailable

- **Date**: ${today()}
- **Company**: ${matchedRow.company}
- **Role**: ${matchedRow.role}
- **Tracker #**: #${matchedRow.num}
- **URL**: ${targetUrl || 'None provided'}
- **Reason**: Live posting URL could not be reached or archived.
`;
  const stubDest = join(outcomeDir, 'posting_missing.md');
  if (!existsSync(stubDest)) {
    writeFileSync(stubDest, stubContent);
  }
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
  failExit(`Tracker update via set-status.mjs failed: ${err.message}`, 'tracker-update-failed', 1);
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
