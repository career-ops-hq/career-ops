#!/usr/bin/env node
/**
 * career-ops Polytoken-native batch runner.
 *
 * Unlike batch-runner.sh, this launches one worker with `polytoken exec` and
 * therefore does not require Claude Code, Codex, or an API key. The Polytoken
 * binary must be available in PATH, or set POLYTOKEN_BIN to its absolute path.
 *
 * The worker still follows batch/batch-prompt.md and writes the report, optional
 * PDF, and tracker TSV. This adapter owns batch-state.tsv and the final merge.
 * It is deliberately sequential: report allocation and state writes stay easy
 * to audit, and one Polytoken session cannot contend with parallel workers.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BATCH = path.join(ROOT, 'batch');
const INPUT = path.join(BATCH, 'batch-input.tsv');
const STATE = path.join(BATCH, 'batch-state.tsv');
const PROMPT_FILE = path.join(BATCH, 'batch-prompt.md');
const LOGS = path.join(BATCH, 'logs');
const REPORTS = path.join(ROOT, 'reports');
const TRACKER = path.join(BATCH, 'tracker-additions');
const POLYTOKEN_BIN = process.env.POLYTOKEN_BIN || 'polytoken';

const HEADER = 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries';

function usage() {
  console.log(`Usage: node batch/polytoken-runner.mjs [options]

Options:
  --dry-run                 List eligible offers without running workers
  --status                  Show state counts and eligible offers
  --resume-paused           Process only paused_rate_limit offers
  --retry-failed            Process failed offers below --max-retries
  --start-from N            Ignore offer IDs below N
  --limit N                 Process at most N offers
  --max-retries N           Maximum attempts for failed offers (default: 2)
  --skip-pdf                Ask workers not to generate PDFs
  --model MODEL             Pass --model to polytoken exec
  --facet FACET             Pass --facet to polytoken exec (default: execute)
  --max-tool-turns N        Pass --max-tool-turns to polytoken exec
  --polytoken-bin PATH      Override the Polytoken executable

Examples:
  node batch/polytoken-runner.mjs --start-from 113 --limit 1
  node batch/polytoken-runner.mjs --resume-paused
`);
}

function parseArgs(argv) {
  const opts = {
    dryRun: false, status: false, resumePaused: false, retryFailed: false,
    startFrom: 0, limit: 0, maxRetries: 2, skipPdf: false,
    model: '', facet: 'execute', maxToolTurns: '', polytokenBin: POLYTOKEN_BIN,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[++i];
    };
    switch (arg) {
      case '--dry-run': opts.dryRun = true; break;
      case '--status': opts.status = true; break;
      case '--resume-paused': opts.resumePaused = true; break;
      case '--retry-failed': opts.retryFailed = true; break;
      case '--skip-pdf': opts.skipPdf = true; break;
      case '--start-from': opts.startFrom = Number(value()); break;
      case '--limit': opts.limit = Number(value()); break;
      case '--max-retries': opts.maxRetries = Number(value()); break;
      case '--model': opts.model = value(); break;
      case '--facet': opts.facet = value(); break;
      case '--max-tool-turns': opts.maxToolTurns = value(); break;
      case '--polytoken-bin': opts.polytokenBin = value(); break;
      case '-h': case '--help': usage(); process.exit(0); break;
      default: throw new Error(`Unknown option: ${arg}`);
    }
  }
  for (const [name, number] of Object.entries({
    startFrom: opts.startFrom, limit: opts.limit, maxRetries: opts.maxRetries,
  })) {
    if (!Number.isInteger(number) || number < 0) throw new Error(`${name} must be a non-negative integer`);
  }
  return opts;
}

function now() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }
function today() { return new Date().toISOString().slice(0, 10); }
function sanitize(value) { return String(value ?? '-').replace(/[\t\r\n]+/g, ' ').trim() || '-'; }
function isScore(value) { return /^\d+(?:\.\d+)?$/.test(String(value)); }

function ensureFiles() {
  for (const dir of [LOGS, TRACKER, REPORTS]) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(INPUT)) throw new Error(`Missing ${path.relative(ROOT, INPUT)}`);
  if (!fs.existsSync(PROMPT_FILE)) throw new Error(`Missing ${path.relative(ROOT, PROMPT_FILE)}`);
  if (!fs.existsSync(STATE)) fs.writeFileSync(STATE, `${HEADER}\n`);
}

function readInput() {
  return fs.readFileSync(INPUT, 'utf8').split(/\r?\n/).filter(Boolean).slice(1).map((line) => {
    const [id, url, source = '', notes = ''] = line.split('\t');
    return { id: Number(id), url, source, notes };
  }).filter((row) => Number.isInteger(row.id) && row.id >= 0 && row.url);
}

function readState() {
  const rows = new Map();
  const lines = fs.readFileSync(STATE, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines.slice(1)) {
    const fields = line.split('\t');
    if (!fields[0]) continue;
    const [id, url, status, started, completed, report, score, error, retries] = fields;
    rows.set(Number(id), {
      id: Number(id), url, status: status || 'pending', started: started || '-',
      completed: completed || '-', report: report || '-', score: score || '-',
      error: error || '-', retries: Number(retries || 0),
    });
  }
  return rows;
}

function writeState(rows) {
  const ordered = [...rows.values()].sort((a, b) => a.id - b.id);
  const text = [HEADER, ...ordered.map((row) => [
    row.id, row.url, row.status, row.started, row.completed, row.report,
    row.score, sanitize(row.error), row.retries,
  ].join('\t'))].join('\n') + '\n';
  const temp = `${STATE}.polytoken.tmp-${process.pid}`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, STATE);
}

function setState(rows, row) { rows.set(row.id, row); writeState(rows); }

function reserveReport() {
  const output = execFileSync(process.execPath, [path.join(ROOT, 'reserve-report-num.mjs')], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!/^\d{3}$/.test(output)) throw new Error(`Invalid report reservation: ${output}`);
  return output;
}

function releaseReport(report) {
  if (report && report !== '-') {
    spawnSync(process.execPath, [path.join(ROOT, 'reserve-report-num.mjs'), '--release', report], {
      cwd: ROOT, stdio: 'ignore',
    });
  }
}

function hasReport(report) {
  return fs.readdirSync(REPORTS).some((name) => name.startsWith(`${report}-`) && name.endsWith('.md'));
}

function hasReservation(report) {
  return fs.existsSync(path.join(REPORTS, `${report}-RESERVED.md`));
}

function finalJson(output) {
  const matches = [...String(output).matchAll(/```json\s*\n?([\s\S]*?)\n?```/g)];
  if (matches.length === 0) return null;
  try { return JSON.parse(matches.at(-1)[1]); } catch { return null; }
}

function buildPrompt({ offer, report, jdFile, opts }) {
  let prompt = fs.readFileSync(PROMPT_FILE, 'utf8');
  const replacements = {
    '{{URL}}': offer.url, '{{JD_FILE}}': jdFile, '{{REPORT_NUM}}': report,
    '{{DATE}}': today(), '{{ID}}': String(offer.id),
  };
  for (const [needle, value] of Object.entries(replacements)) prompt = prompt.split(needle).join(value);
  const task = opts.skipPdf
    ? 'Process this offer using the full A-G evaluation, report, and tracker pipeline. Do not generate a PDF; use the required no-PDF output contract.'
    : 'Process this offer using the full A-G evaluation, report, optional PDF, and tracker pipeline.';
  return `${prompt}\n\n---\n\n## Worker task\n${task}\nURL: ${offer.url}\nJD file: ${jdFile}\nReport number: ${report}\nDate: ${today()}\nBatch ID: ${offer.id}\n`;
}

function eligible(offer, row, opts) {
  if (offer.id < opts.startFrom) return false;
  if (opts.resumePaused) return row?.status === 'paused_rate_limit';
  if (opts.retryFailed) return row?.status === 'failed' && (row.retries || 0) < opts.maxRetries;
  if (!row || row.status === 'pending' || row.status === 'rate_limited') return true;
  if (row.status === 'processing') return false;
  if (row.status === 'failed') return (row.retries || 0) < opts.maxRetries;
  return false;
}

function counts(rows) {
  const result = {};
  for (const row of rows.values()) result[row.status] = (result[row.status] || 0) + 1;
  return result;
}

function printStatus(rows, offers, opts) {
  const eligibleIds = offers.filter((offer) => eligible(offer, rows.get(offer.id), opts))
    .slice(0, opts.limit || offers.length)
    .map((offer) => offer.id);
  console.log(JSON.stringify({ counts: counts(rows), eligible: eligibleIds }, null, 2));
}

function assertPolytokenAvailable(binary) {
  const probe = spawnSync(binary, ['--help'], { cwd: ROOT, stdio: 'ignore' });
  if (probe.error || probe.status !== 0) {
    throw new Error(`Polytoken executable not found or unusable: ${binary}. Set POLYTOKEN_BIN or use --polytoken-bin PATH.`);
  }
}

function runWorker(prompt, opts) {
  const args = ['exec'];
  if (opts.model) args.push('--model', opts.model);
  if (opts.facet) args.push('--facet', opts.facet);
  if (opts.maxToolTurns) args.push('--max-tool-turns', opts.maxToolTurns);
  args.push(prompt);
  const result = spawnSync(opts.polytokenBin, args, {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  return { code: result.status ?? 1, output, spawnError: result.error };
}

function looksPaused(output) {
  return /(session limit|usage limit|rate limit|resets \d{1,2}:\d{2}|limit reached)/i.test(output);
}

async function processOffer(offer, rows, opts) {
  const previous = rows.get(offer.id) || {
    id: offer.id, url: offer.url, status: 'pending', started: '-', completed: '-',
    report: '-', score: '-', error: '-', retries: 0,
  };
  const canReusePausedReport = previous.status === 'paused_rate_limit'
    && /^\d{3}$/.test(previous.report)
    && hasReservation(previous.report);
  const report = canReusePausedReport ? previous.report : reserveReport();
  if (previous.status === 'paused_rate_limit' && previous.report !== report) {
    console.warn(`Offer #${offer.id}: previous reservation ${previous.report} is missing; allocated fresh report ${report}.`);
  }
  const started = now();
  const retries = previous.retries || 0;
  const jdDir = fs.mkdtempSync(path.join(os.tmpdir(), `career-ops-jd-${offer.id}-`));
  const jdFile = path.join(jdDir, 'posting.txt');
  fs.writeFileSync(jdFile, '');
  const logFile = path.join(LOGS, `polytoken-${report}-${offer.id}.log`);
  setState(rows, { ...previous, id: offer.id, url: offer.url, status: 'processing', started, completed: '-', report, score: '-', error: '-', retries });
  console.log(`Processing offer #${offer.id} (report ${report}) with ${opts.polytokenBin}`);
  try {
    const result = runWorker(buildPrompt({ offer, report, jdFile, opts }), opts);
    fs.writeFileSync(logFile, result.output);
    const finished = now();
    if (result.spawnError || result.code !== 0) {
      const error = result.spawnError?.message || `polytoken exec exited with code ${result.code}`;
      if (looksPaused(result.output)) {
        setState(rows, { ...previous, id: offer.id, url: offer.url, status: 'paused_rate_limit', started, completed: finished, report, score: '-', error, retries });
        console.log(`Paused offer #${offer.id}: ${error}`);
      } else {
        setState(rows, { ...previous, id: offer.id, url: offer.url, status: 'failed', started, completed: finished, report: '-', score: '-', error, retries: Math.min(retries + 1, opts.maxRetries) });
        releaseReport(report);
        console.log(`Failed offer #${offer.id}: ${error}`);
      }
      return;
    }
    const payload = finalJson(result.output);
    if (!payload || payload.status === 'failed' || !hasReport(report)) {
      const error = payload?.error || (!hasReport(report) ? `worker produced no report for ${report}` : 'worker returned no valid success JSON');
      setState(rows, { ...previous, id: offer.id, url: offer.url, status: 'failed', started, completed: finished, report: '-', score: '-', error, retries: Math.min(retries + 1, opts.maxRetries) });
      releaseReport(report);
      console.log(`Failed offer #${offer.id}: ${error}`);
      return;
    }
    const score = isScore(payload.score) ? String(payload.score) : '-';
    setState(rows, { ...previous, id: offer.id, url: offer.url, status: 'completed', started, completed: finished, report, score, error: '-', retries });
    releaseReport(report);
    console.log(`Completed offer #${offer.id}: report ${report}, score ${score}`);
  } finally {
    fs.rmSync(jdDir, { recursive: true, force: true });
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  ensureFiles();
  const offers = readInput();
  const rows = readState();
  const selected = offers.filter((offer) => eligible(offer, rows.get(offer.id), opts));
  if (opts.status || opts.dryRun) {
    printStatus(rows, selected, opts);
    if (opts.status || opts.dryRun) return;
  }
  if (!selected.length) { console.log('No eligible offers.'); return; }
  if (opts.dryRun) return;
  assertPolytokenAvailable(opts.polytokenBin);
  for (const offer of selected.slice(0, opts.limit || selected.length)) await processOffer(offer, rows, opts);
  for (const script of ['merge-tracker.mjs', 'reconcile-pipeline.mjs', 'verify-pipeline.mjs']) {
    const result = spawnSync(process.execPath, [path.join(ROOT, script)], { cwd: ROOT, encoding: 'utf8' });
    process.stdout.write(`\n=== ${script} ===\n${result.stdout || ''}${result.stderr || ''}`);
    if (result.status !== 0 && script === 'merge-tracker.mjs') process.exitCode = result.status;
  }
}

main().catch((error) => { console.error(`polytoken-runner: ${error.message}`); process.exitCode = 1; });
