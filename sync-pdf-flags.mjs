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
 * Prune mode (--prune) drops manifest rows whose PDF file is no longer on disk.
 * A deleted artifact otherwise keeps the manifest row alive, which causes the next
 * normal sync to re-assert ✅ on the tracker even though no file backs it. Prune
 * is kind-agnostic: it drops any row (CV or cover letter) whose pdf column points
 * at a missing file. It is a dry run by default — add --write to commit changes.
 *
 * Usage:
 *   node sync-pdf-flags.mjs [--dry-run] [--json]
 *   node sync-pdf-flags.mjs --prune [--write] [--json]
 */

import { readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { extractTrackerReportNumbers, resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { rebuildRow, resolveTrackerPath, resolvePdfIndexPath, openTrackerTransaction, writeFileAtomic, resolveWorkspaceRoot, pathIsInsideCanonical } from './tracker-utils.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const DATA_ROOT = getCareerOpsRoot();
const APPS_FILE = resolveTrackerPath(DATA_ROOT);
// Derived from the TRACKER, not from this script's location, so a redirected
// CAREER_OPS_TRACKER moves the whole workspace together (#2471).
const PDF_MANIFEST = resolvePdfIndexPath(APPS_FILE);

const flags = { dryRun: false, json: false, prune: false, write: false };
const unknownOptions = [];
for (const arg of process.argv.slice(2)) {
  if (arg === '--dry-run') flags.dryRun = true;
  else if (arg === '--json') flags.json = true;
  else if (arg === '--prune') flags.prune = true;
  else if (arg === '--write') flags.write = true;
  else unknownOptions.push(arg);
}

// --dry-run must win over --write
if (flags.dryRun) flags.write = false;

// --prune is dry-run by default; --write opts in to committing changes.
// Outside prune mode, --write has no meaning — surface it as an unknown option
// to avoid silent surprises.
if (!flags.prune && flags.write) {
  unknownOptions.push('--write');
}

if (unknownOptions.length > 0) {
  const error = `unknown option(s): ${unknownOptions.join(', ')}`;
  if (flags.json) console.error(JSON.stringify({ error, code: 'unknown-option' }));
  else console.error(`Error: ${error}\nUsage: node sync-pdf-flags.mjs [--dry-run] [--json]\n       node sync-pdf-flags.mjs --prune [--write] [--json]`);
  process.exit(1);
}

if (!existsSync(APPS_FILE)) {
  if (flags.json) console.log(JSON.stringify({ error: `No tracker found at ${APPS_FILE}`, code: 'no-tracker' }));
  else console.error(`❌ No tracker found at ${APPS_FILE}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Prune mode: drop manifest rows whose PDF is gone from disk.
// Kind-agnostic — a cover letter whose file was deleted is just as stale as a
// CV's. Flag-clearing (resetting ✅ on the tracker) is the follow-on half once
// #3887 introduces kind-awareness; this half is scoped to the manifest only.
// ---------------------------------------------------------------------------
if (flags.prune) {
  if (!existsSync(PDF_MANIFEST)) {
    const result = { pruned: 0, kept: 0, dryRun: !flags.write };
    if (flags.json) console.log(JSON.stringify(result));
    else console.log('\n📊 Summary: manifest does not exist — nothing to prune');
    process.exit(0);
  }

  let rawContent;
  try {
    rawContent = readFileSync(PDF_MANIFEST, 'utf-8');
  } catch (err) {
    if (flags.json) {
      console.log(JSON.stringify({ error: `Cannot read PDF manifest: ${err.message}`, code: 'manifest-read-error' }));
    } else {
      console.error(`❌ Cannot read PDF manifest: ${err.message}`);
    }
    process.exit(2);
  }

  // The workspace root is needed to resolve the workspace-relative pdf paths
  // stored in the manifest (e.g. "output/042-acme-cv.pdf").
  const workspaceRoot = resolveWorkspaceRoot(APPS_FILE);

  const inputLines = rawContent.split('\n');
  const keptLines = [];
  const prunedRows = [];

  for (const line of inputLines) {
    // Preserve comment lines and blank lines verbatim.
    if (!line.trim() || line.startsWith('#')) {
      keptLines.push(line);
      continue;
    }

    const parts = line.split('\t');
    const relPdf = parts[1]?.trim();

    if (!relPdf) {
      // Malformed row (no pdf column) — keep it; not our business to remove it.
      keptLines.push(line);
      continue;
    }

    const absPath = resolve(workspaceRoot, relPdf);
    if (!pathIsInsideCanonical(absPath, workspaceRoot)) {
      prunedRows.push({ line, relPdf, report: parts[0]?.trim() || '' });
      if (!flags.json) {
        const marker = flags.write ? '🗑️ ' : '🔎';
        const action = flags.write ? 'pruned' : 'would prune';
        console.log(`${marker} ${action}: ${relPdf} (report ${parts[0]?.trim() || '?'}) — outside workspace`);
      }
      continue;
    }

    if (existsSync(absPath)) {
      keptLines.push(line);
    } else {
      prunedRows.push({ line, relPdf, report: parts[0]?.trim() || '' });
      if (!flags.json) {
        const marker = flags.write ? '🗑️ ' : '🔎';
        const action = flags.write ? 'pruned' : 'would prune';
        console.log(`${marker} ${action}: ${relPdf} (report ${parts[0]?.trim() || '?'}) — file not found`);
      }
    }
  }

  const pruned = prunedRows.length;
  const kept = inputLines.filter(l => l.trim() && !l.startsWith('#')).length - pruned;

  if (pruned > 0 && flags.write) {
    // Trim trailing blank lines added during the split, then restore exactly one.
    const content = keptLines.join('\n').replace(/\n+$/, '') + '\n';
    try {
      writeFileAtomic(PDF_MANIFEST, content);
    } catch (err) {
      if (flags.json) {
        console.log(JSON.stringify({ error: `Cannot write manifest: ${err.message}`, code: 'write-failure' }));
      } else {
        console.error(`❌ Cannot write manifest: ${err.message}`);
      }
      process.exit(1);
    }
  }

  const result = { pruned, kept, dryRun: !flags.write };
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const verb = flags.write ? 'pruned' : 'would prune (dry run — pass --write to commit)';
    console.log(`\n📊 Summary: ${pruned} row(s) ${verb}, ${kept} kept`);
    if (pruned > 0 && !flags.write) {
      console.log('ℹ️  Re-run with --write to remove stale rows, then run sync-pdf-flags.mjs to reconcile tracker flags.');
    }
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Normal sync mode: set tracker PDF cell to ✅ for rows present in the manifest.
// ---------------------------------------------------------------------------

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
