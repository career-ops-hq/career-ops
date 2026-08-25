#!/usr/bin/env node

import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// CAREER_OPS_BATCH_STATE overrides the batch-state.tsv path — the same override
// merge-tracker.mjs already honours, so tests can drive this script against a
// sandbox instead of the developer's real batch run.
const batchStateFile = process.env.CAREER_OPS_BATCH_STATE
  ? resolve(process.env.CAREER_OPS_BATCH_STATE)
  : join(__dirname, 'batch', 'batch-state.tsv');
const reportsDir = join(__dirname, 'reports');

const USAGE = `career-ops batch tailor — bulk generate tailored CVs for high-scoring batch jobs

Usage:
  node batch-tailor.mjs [--min-score N]

Options:
  --min-score N   Minimum score to tailor (default: 4.0). The --min-score=N form works too.
  --help, -h      Show this help
`;

const args = process.argv.slice(2);

// Route through the shared parser instead of hand-rolling it: this script used
// to read only the `--min-score=N` form, so `--min-score 4.5` was dropped and a
// typo fell through — both silently ran at the 4.0 default and spawned worker
// runs the caller never asked for. That is the #2459 class lib/cli-flags.mjs
// exists to end.
// requireOperand: `--min-score --help` would otherwise print usage and exit 0,
// so the malformed flag is never reported and the numeric check below never
// runs. This script has nothing more specific to say about a missing operand
// than the shared message, which is exactly when opting in is right.
validateFlags(args, ['--min-score', '--help', '-h'], USAGE, { valueFlags: ['--min-score'], requireOperand: true });

let minScore = 4.0;
if (hasFlag(args, '--min-score')) {
  const raw = flagValue(args, '--min-score');
  // Number(), not parseFloat(): parseFloat stops at the first invalid character,
  // so "4.5abc" silently became 4.5 and the run proceeded on a threshold the
  // caller never wrote. The empty/whitespace guard must come FIRST — Number('')
  // is 0, which is finite, and a 0 threshold tailors every completed job.
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  minScore = trimmed === '' ? NaN : Number(trimmed);
  // A NaN threshold compares false against every score, so the old code printed
  // "no roles found with score >= NaN" and exited 0 — indistinguishable from a
  // genuinely empty batch. Fail loudly instead.
  if (!Number.isFinite(minScore)) {
    console.error(`ERROR: --min-score expects a number, got ${raw === undefined ? '(no value)' : `"${raw}"`}`);
    process.exit(1);
  }
}

if (!existsSync(batchStateFile)) {
  console.error(`ERROR: Batch state file not found at ${batchStateFile}`);
  process.exit(1);
}

// existsSync() is true for a directory and says nothing about permissions, so
// reading can still throw (EISDIR, EACCES) — an uncaught stack trace where a
// usage error belongs. Name the RESOLVED path: with CAREER_OPS_BATCH_STATE set,
// the value that failed is not the one written in the source.
let stateContent;
try {
  stateContent = readFileSync(batchStateFile, 'utf-8');
} catch (err) {
  console.error(`ERROR: cannot read batch state file at ${batchStateFile}: ${err.message}`);
  process.exit(1);
}

const lines = stateContent.split('\n');
const toProcess = [];

for (const line of lines) {
  if (!line || line.startsWith('id\t')) continue;
  const parts = line.split('\t');
  if (parts.length < 7) continue;
  
  const id = parts[0];
  const url = parts[1];
  const status = parts[2];
  const reportNum = parts[5];
  const scoreStr = parts[6];
  
  if (status === 'completed') {
    const score = parseFloat(scoreStr);
    if (!isNaN(score) && score >= minScore) {
      toProcess.push({ id, url, reportNum, score });
    }
  }
}

if (toProcess.length === 0) {
  console.log(`No completed roles found with score >= ${minScore}.`);
  process.exit(0);
}

console.log(`Found ${toProcess.length} roles scoring >= ${minScore}. Beginning bulk tailoring...`);

const reports = existsSync(reportsDir) ? readdirSync(reportsDir) : [];

for (let i = 0; i < toProcess.length; i++) {
  const job = toProcess[i];
  console.log(`\n[${i + 1}/${toProcess.length}] Tailoring CV for Report ${job.reportNum} (Score: ${job.score}) — ${job.url}`);
  
  // Try to find the local report file to pass to the agent
  const matchingReport = reports.find(f => f.startsWith(`${job.reportNum}-`) && f.endsWith('.md'));
  const reportContext = matchingReport ? `\nThe evaluation report is available at: reports/${matchingReport}` : '';
  
  const prompt = `Tailor the CV for this role and generate the HTML and PDF CVs. \nURL: ${job.url}\nReport number: ${job.reportNum}${reportContext}`;
  
  const claudeArgs = [
    '-p',
    '--dangerously-skip-permissions',
    '--append-system-prompt-file',
    // Absolute: the state file already resolves through __dirname, so passing
    // this one bare handed the worker a cwd-relative path that only exists when
    // the script happens to run from the project root. modes/pdf.md is where
    // the CV fact gate (verify-cv-facts.mjs, step 19) is instructed, so losing
    // it silently drops the anti-fabrication check from a bulk CV run.
    join(__dirname, 'modes', 'pdf.md'),
    prompt
  ];
  
  const res = spawnSync('claude', claudeArgs, { stdio: 'inherit' });
  if (res.error) {
    console.error(`Error running claude: ${res.error.message}`);
  } else if (res.status !== 0) {
    console.error(`Worker exited with status ${res.status}`);
  } else {
    console.log(`✅ Finished tailoring for Report ${job.reportNum}`);
  }
}

console.log('\nBulk tailoring complete.');
