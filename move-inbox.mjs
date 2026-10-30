#!/usr/bin/env node
// Manual workflow only: create an unscored tracker row through the core merger.
// Usage: node move-inbox.mjs <posting-url> <status> --json
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { getCareerOpsRoot, resolveTrackerPath, resolveTrackerPathForWrite } from './path-resolver.mjs';
import { mergeTracker } from './merge-tracker.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { loadCanonicalStates, resolveCanonicalState, writeFileAtomic } from './tracker-utils.mjs';
import { postingKey } from './url-key.mjs';
import { localToday } from './lib/local-today.mjs';
import { acquireDirLock, releaseOrWarn } from './lib/dir-lock.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { validateFlags } from './lib/cli-flags.mjs';
import { parseInbox } from './lib/pipeline-table.mjs';
import { withPipelineLock } from './pipeline-lock.mjs';
import { sectionKind } from './lib/pipeline-sections.mjs';
import { reserveReportNumbers, releaseReportNumbers } from './reserve-report-num.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));
const quiet = { log() {}, warn() {}, error() {} };

// Only Pending entries are actionable. With no section headings, preserve the
// existing flat-file convention. Return line indices so the final write changes
// checkboxes only, retaining CRLF, labels and unrelated sections verbatim.
function pendingEntries(text) {
  const lines = text.split(/(?<=\n)/);
  const hasPending = lines.some(line => sectionKind(line.trimEnd()) === 'pending');
  let pending = !hasPending;
  const entries = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].replace(/\r?\n$/, '');
    if (/^##[ \t]/.test(line)) pending = sectionKind(line) === 'pending';
    if (!pending) continue;
    const [job] = parseInbox(line);
    if (job) entries.push({ index, job });
  }
  return entries;
}

function rows(file) {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n');
  const columns = resolveColumns(lines);
  return lines.map(line => parseTrackerRow(line, columns)).filter(Boolean);
}

export async function moveInbox(url, requestedStatus, { dataRoot = getCareerOpsRoot() } = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Choose a valid job URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Choose a valid job URL.');
  const status = resolveCanonicalState(requestedStatus, loadCanonicalStates(join(CODE_ROOT, 'templates/states.yml')));
  if (!status) throw new Error('Choose a valid application status.');
  if (status === 'Evaluated') throw new Error('Score the job first to mark it Evaluated.');
  const additionsRoot = join(dataRoot, 'batch/tracker-additions');
  mkdirSync(additionsRoot, { recursive: true });
  const lock = await acquireDirLock(join(dataRoot, 'data/inbox-move.lock'), { timeoutMs: 3000, retryMs: 100, maxWaitMs: 5000, createParent: true });
  let additionsDir;
  let reserved;
  let reservationOptions;
  try {
    const pipelineFile = process.env.CAREER_OPS_PIPELINE || join(dataRoot, 'data/pipeline.md');
    const job = await withPipelineLock(pipelineFile, () => pendingEntries(readFileSync(pipelineFile, 'utf8')).find(entry => postingKey(entry.job.url) === postingKey(url))?.job);
    if (!job) throw new Error('This job is no longer in the inbox. Refresh the page.');
    const appsFile = existsSync(resolveTrackerPath(dataRoot)) ? resolveTrackerPath(dataRoot) : resolveTrackerPathForWrite(dataRoot);
    let applications = rows(appsFile);
    let application = applications.find(row => postingKey(row.url) === postingKey(job.url));
    if (!application) {
      if (!job.company || !job.role) throw new Error('This inbox entry needs a company and job title before it can be tracked.');
      additionsDir = mkdtempSync(join(additionsRoot, '.inbox-move-'));
      // The core migration preserves every existing tracker cell and enables
      // exact posting-URL dedup before this new report-less row is merged.
      const prepared = await mergeTracker({ appsFile, dataRoot, additionsDir, createIfMissing: true, flags: { backfillUrls: true }, logger: quiet });
      if (prepared !== 0) throw new Error('Could not prepare the tracker. No inbox job was removed.');
      reservationOptions = { rootDir: dataRoot, trackerPath: appsFile, reportsDir: join(dataRoot, 'reports'), batchStateFile: join(dataRoot, 'batch/batch-state.tsv') };
      reserved = await reserveReportNumbers(1, reservationOptions);
      const [number] = reserved;
      const fields = ['#', 'Date', 'Company', 'Role', 'Status', 'Score', 'PDF', 'Report', 'Notes', 'URL', 'Location'];
      const values = [number, localToday(), job.company, job.role, status, '—', '❌', '—', 'Moved from Inbox without AI scoring.', job.url, job.location || '—'];
      const tsvCell = value => String(value).replace(/[\t\r\n]/g, ' ');
      writeFileSync(join(additionsDir, 'manual.tsv'), fields.join('\t') + '\n' + values.map(tsvCell).join('\t') + '\n', { mode: 0o600 });
      const code = await mergeTracker({ appsFile, dataRoot, additionsDir, logger: quiet });
      if (code !== 0) throw new Error('Could not add this job to the tracker. The inbox entry is unchanged.');
      application = rows(appsFile).find(row => postingKey(row.url) === postingKey(job.url));
      if (!application) throw new Error('Could not verify the tracked job. The inbox entry is unchanged.');
    }
    if (application.status !== status) {
      execFileSync(process.execPath, [join(CODE_ROOT, 'set-status.mjs'), '--row', String(application.num), status, '--source', 'web', '--detach-jd-archive', '--json'], {
        env: { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_TRACKER: appsFile }, encoding: 'utf8', timeout: 20000,
      });
    }
    const saved = rows(appsFile).find(row => postingKey(row.url) === postingKey(job.url));
    if (!saved || saved.status !== status) throw new Error('Could not verify the saved status. Please refresh before retrying.');
    await withPipelineLock(pipelineFile, () => {
      const text = readFileSync(pipelineFile, 'utf8');
      const matches = pendingEntries(text).filter(entry => postingKey(entry.job.url) === postingKey(job.url));
      if (!matches.length) throw new Error('Status saved, but the inbox changed. Refresh before retrying.');
      const lines = text.split(/(?<=\n)/);
      for (const entry of matches) lines[entry.index] = lines[entry.index].replace(/^(\s*-\s*)\[[ xX]\]/, '$1[x]');
      writeFileAtomic(pipelineFile, lines.join(''));
    });
    return { ok: true, n: String(saved.num), status, url: job.url };
  } finally {
    try {
      if (reserved) await releaseReportNumbers(reserved, reservationOptions);
    } finally {
      try { if (additionsDir) rmSync(additionsDir, { recursive: true, force: true }); }
      finally { releaseOrWarn(lock); }
    }
  }
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  validateFlags(argv, ['--json', '--help', '-h'], 'Usage: node move-inbox.mjs <posting-url> <status> [--json]');
  try {
    const [url, status, ...extra] = argv.filter(arg => arg !== '--json');
    if (extra.length || !url || !status) throw new Error('Usage: node move-inbox.mjs <posting-url> <status> [--json]');
    console.log(JSON.stringify(await moveInbox(url, status)));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
