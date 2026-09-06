#!/usr/bin/env node

/**
 * sync-pdf-flags.mjs — Reconciles the tracker PDF column against data/pdf-index.tsv.
 *
 * When a PDF is generated AFTER the initial evaluation, the tracker's PDF column
 * might still show ❌ (or '—'). This script reads the canonical pdf manifest and
 * upgrades matching tracker rows to ✅ using reportNum as the join key.
 *
 * Runs under the shared tracker lock and replaces the file atomically.
 *
 * Usage:
 *   node sync-pdf-flags.mjs [--dry-run] [--json]
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { extractTrackerReportNumbers, resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { rebuildRow, resolveTrackerPath, resolvePdfIndexPath, openTrackerTransaction } from './tracker-utils.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const DATA_ROOT = getCareerOpsRoot();
const APPS_FILE = resolveTrackerPath(DATA_ROOT);
// Derived from the TRACKER, not from this script's location, so a redirected
// CAREER_OPS_TRACKER moves the whole workspace together (#2471).
const PDF_MANIFEST = resolvePdfIndexPath(APPS_FILE);

const flags = { dryRun: false, json: false };
const unknownOptions = [];
for (const arg of process.argv.slice(2)) {
  if (arg === '--dry-run') flags.dryRun = true;
  else if (arg === '--json') flags.json = true;
  else unknownOptions.push(arg);
}

if (unknownOptions.length > 0) {
  const error = `unknown option(s): ${unknownOptions.join(', ')}`;
  if (flags.json) console.error(JSON.stringify({ error, code: 'unknown-option' }));
  else console.error(`Error: ${error}\nUsage: node sync-pdf-flags.mjs [--dry-run] [--json]`);
  process.exit(1);
}

if (!existsSync(APPS_FILE)) {
  if (flags.json) console.log(JSON.stringify({ error: `No tracker found at ${APPS_FILE}`, code: 'no-tracker' }));
  else console.error(`❌ No tracker found at ${APPS_FILE}`);
  process.exit(2);
}

const manifestReports = new Set();
if (existsSync(PDF_MANIFEST)) {
  let content;
  try {
    content = readFileSync(PDF_MANIFEST, 'utf-8');
  } catch (err) {
    if (flags.json) {
      console.log(JSON.stringify({ error: `Cannot read PDF manifest: ${err.message}`, code: 'manifest-read-error' }));
    } else {
      console.error(`❌ Cannot read PDF manifest: ${err.message}`);
    }
    process.exit(2);
  }
  for (const line of content.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const parts = line.split('\t');
    const reportVal = parts[0]?.trim();
    if (reportVal && /^\d+$/.test(reportVal)) {
      const norm = parseInt(reportVal, 10);
      if (norm > 0) manifestReports.add(norm);
    }
  }
}

let transaction;
try {
  transaction = await openTrackerTransaction(APPS_FILE);
} catch (err) {
  if (err?.code === 'LOCK_TIMEOUT') {
    if (flags.json) console.log(JSON.stringify({ error: err.message, code: 'lock-timeout' }));
    else console.error(`❌ ${err.message}`);
    process.exit(4);
  }
  if (flags.json) console.log(JSON.stringify({ error: `Cannot acquire tracker lock: ${err.message}`, code: 'lock-error' }));
  else console.error(`❌ Cannot acquire tracker lock: ${err.message}`);
  process.exit(1);
}

let content;
try {
  content = transaction.read();
} catch (err) {
  transaction.close();
  if (flags.json) console.log(JSON.stringify({ error: `Cannot read tracker: ${err.message}`, code: 'read-failure' }));
  else console.error(`❌ Cannot read tracker: ${err.message}`);
  process.exit(2);
}

const lines = content.split('\n');
const colmap = resolveColumns(lines);

let updated = 0;
let unchanged = 0;

for (let i = 0; i < lines.length; i++) {
  const row = parseTrackerRow(lines[i], colmap);
  if (!row) continue;
  
  const reportNums = extractTrackerReportNumbers(row.report);
  const hasPdf = reportNums.some(num => manifestReports.has(num));
  
  if (hasPdf) {
    if (row.pdf !== '✅') {
      const parts = lines[i].split('|').map(s => s.trim());
      // parts includes leading empty string, so its length is at least colmap max + 1
      while (parts.length <= colmap.pdf) parts.push('');
      parts[colmap.pdf] = '✅';
      lines[i] = rebuildRow(parts);
      updated++;
      if (!flags.json && !flags.dryRun) {
        console.log(`✅ #${row.num} ${row.company} — ${row.role}: PDF flag updated to ✅`);
      } else if (!flags.json && flags.dryRun) {
        console.log(`🔎 #${row.num} ${row.company} — ${row.role}: would update PDF flag to ✅`);
      }
    } else {
      unchanged++;
    }
  }
}

if (updated > 0 && !flags.dryRun) {
  try {
    transaction.replace(lines.join('\n'));
  } catch (err) {
    transaction.close();
    if (flags.json) console.log(JSON.stringify({ error: `Cannot write tracker: ${err.message}`, code: 'write-failure' }));
    else console.error(`❌ Cannot write tracker: ${err.message}`);
    process.exit(1);
  }
}

transaction.close();

const result = { updated, unchanged, dryRun: flags.dryRun };
if (flags.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`\n📊 Summary: ${updated} PDF flags synced, ${unchanged} unchanged`);
  if (flags.dryRun) console.log('(dry-run — no changes written)');
}

process.exit(0);
