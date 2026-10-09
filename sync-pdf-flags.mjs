#!/usr/bin/env node

/**
 * sync-pdf-flags.mjs — Reconciles the tracker PDF column against data/pdf-index.tsv.
 *
 * When a PDF is generated AFTER the initial evaluation, the tracker's PDF column
 * might still show ❌ (or '—'). This script reads the canonical pdf manifest and
 * upgrades matching tracker rows to ✅ using reportNum as the join key.
 *
 * Normal sync runs under the shared tracker lock and replaces the file atomically.
 *
 * Prune mode (--prune) drops manifest rows whose PDF file is no longer on disk.
 * A deleted artifact otherwise keeps the manifest row alive, which causes the next
 * normal sync to re-assert ✅ on the tracker even though no file backs it. Prune
 * is kind-agnostic: it drops any row (CV or cover letter) whose pdf column points
 * at a missing file. It is a dry run by default — add --write to commit changes.
 * Prune never opens the tracker, so it takes no tracker lock: it rewrites only the
 * manifest (atomically), and the manifest has no lock of its own.
 *
 * Prune fails closed, because a dropped row is the only record of that PDF: a row
 * goes only when its file is provably gone (ENOENT/ENOTDIR) or outside output/.
 * A row it cannot check is kept with a warning, a missing or unreadable output/
 * stops the run (exit 2), and a --write that would empty the manifest is refused
 * (exit 3) unless --allow-empty says every PDF really was deleted.
 *
 * Usage:
 *   node sync-pdf-flags.mjs [--dry-run] [--json]
 *   node sync-pdf-flags.mjs --prune [--write] [--allow-empty] [--json]
 */

import { readFileSync, existsSync, statSync, realpathSync, accessSync, constants } from 'fs';
import { resolve } from 'path';
import { extractTrackerReportNumbers, resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { rebuildRow, resolveTrackerPath, resolvePdfIndexPath, openTrackerTransaction, writeFileAtomic, resolveWorkspaceRoot, pathIsInside } from './tracker-utils.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const DATA_ROOT = getCareerOpsRoot();
const APPS_FILE = resolveTrackerPath(DATA_ROOT);
// Derived from the TRACKER, not from this script's location, so a redirected
// CAREER_OPS_TRACKER moves the whole workspace together (#2471).
const PDF_MANIFEST = resolvePdfIndexPath(APPS_FILE);

const flags = { dryRun: false, json: false, prune: false, write: false, allowEmpty: false };
const unknownOptions = [];
for (const arg of process.argv.slice(2)) {
  if (arg === '--dry-run') flags.dryRun = true;
  else if (arg === '--json') flags.json = true;
  else if (arg === '--prune') flags.prune = true;
  else if (arg === '--write') flags.write = true;
  else if (arg === '--allow-empty') flags.allowEmpty = true;
  else unknownOptions.push(arg);
}

// --prune is dry-run by default; --write opts in to committing changes.
// Outside prune mode, --write and --allow-empty have no meaning — surface them
// as unknown options to avoid silent surprises.
if (!flags.prune && flags.write) {
  unknownOptions.push('--write');
}
if (!flags.prune && flags.allowEmpty) {
  unknownOptions.push('--allow-empty');
}

// --dry-run must win over --write
if (flags.dryRun) flags.write = false;

if (unknownOptions.length > 0) {
  const error = `unknown option(s): ${unknownOptions.join(', ')}`;
  if (flags.json) console.error(JSON.stringify({ error, code: 'unknown-option' }));
  else console.error(`Error: ${error}\nUsage: node sync-pdf-flags.mjs [--dry-run] [--json]\n       node sync-pdf-flags.mjs --prune [--write] [--allow-empty] [--json]`);
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
    const result = { pruned: 0, kept: 0, dryRun: !flags.write, warnings: [] };
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
  const outputDir = resolve(workspaceRoot, 'output');

  const inputLines = rawContent.split('\n');
  const dataRows = inputLines.filter(l => l.trim() && !l.startsWith('#')).length;

  // "The PDF is gone" can only be proven against an output/ we can see. When it
  // is missing (fresh clone, another machine, a symlink to an unmounted volume)
  // or unreadable, every row stats as absent at once, so stop before judging
  // any of them. An empty manifest has nothing to judge and needs no output/.
  let canonicalOutputDir = '';
  if (dataRows > 0) {
    try {
      if (!statSync(outputDir).isDirectory()) {
        throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' });
      }
      accessSync(outputDir, constants.R_OK | constants.X_OK);
      canonicalOutputDir = realpathSync(outputDir);
    } catch (err) {
      const missing = err?.code === 'ENOENT';
      const error = missing
        ? `Output directory not found: ${outputDir}. Refusing to prune: without it every PDF looks deleted (fresh clone, another machine, moved workspace, unmounted volume). Nothing was changed.`
        : `Cannot read output directory ${outputDir} (${err?.code || err?.message}). Refusing to prune: no row can be checked against it. Nothing was changed.`;
      const code = missing ? 'no-output-dir' : 'output-dir-unreadable';
      if (flags.json) console.log(JSON.stringify({ error, code }));
      else console.error(`❌ ${error}`);
      process.exit(2);
    }
  }

  const keptLines = [];
  const prunedRows = [];
  const warnings = [];
  // A row we could not check stays, and says so: "could not look" is not proof
  // of deletion.
  const keepUnchecked = (line, relPdf, report, err) => {
    keptLines.push(line);
    const reason = err?.code || err?.message || 'unknown error';
    warnings.push({
      code: 'cannot-check', report, pdf: relPdf, reason,
      message: `kept ${relPdf} (report ${report || '?'}): cannot check it (${reason}), so it is not pruned`,
    });
  };

  for (const line of inputLines) {
    // Preserve comment lines and blank lines verbatim.
    if (!line.trim() || line.startsWith('#')) {
      keptLines.push(line);
      continue;
    }

    const parts = line.split('\t');
    const relPdf = parts[1]?.trim();
    const report = parts[0]?.trim() || '';

    if (!relPdf) {
      // Malformed row (no pdf column) — keep it; not our business to remove it.
      keptLines.push(line);
      continue;
    }

    // A path that spells its way out of output/ ("../x.pdf", an absolute path
    // elsewhere) is outside whatever the disk says, so no stat is needed.
    const absPath = resolve(workspaceRoot, relPdf);
    if (!pathIsInside(absPath, outputDir)) {
      prunedRows.push({ relPdf, report, reason: 'outside output directory' });
      continue;
    }

    // Not existsSync(): it answers false for ANY stat failure, which made a
    // permission or I/O error look like a deletion. Only ENOENT says the file is
    // not there, and ENOTDIR (a path component is a file, so nothing can exist
    // below it).
    try {
      statSync(absPath);
    } catch (err) {
      if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') {
        prunedRows.push({ relPdf, report, reason: 'file not found' });
      } else {
        keepUnchecked(line, relPdf, report, err);
      }
      continue;
    }

    // The file exists, but a symlink inside output/ can still lead outside it.
    // A path that cannot be canonicalized is reported and kept, never treated
    // as "outside" (pathIsInsideCanonical returns false for both, which suits
    // a guard that refuses an action, not one that deletes a record).
    let canonicalPdf;
    try {
      canonicalPdf = realpathSync(absPath);
    } catch (err) {
      keepUnchecked(line, relPdf, report, err);
      continue;
    }
    if (pathIsInside(canonicalPdf, canonicalOutputDir)) {
      keptLines.push(line);
    } else {
      prunedRows.push({ relPdf, report, reason: 'resolves outside output directory' });
    }
  }

  const pruned = prunedRows.length;
  const kept = dataRows - pruned;

  // Blast-radius cap. Every row going at once is the one outcome no single row
  // can vouch for, and it is far more often the environment (a manifest from
  // another machine, a moved workspace, PDFs kept somewhere else) than a user
  // who deleted every PDF. Deleting the only PDF is ordinary, hence two or more.
  const wouldEmpty = pruned >= 2 && kept === 0;
  if (wouldEmpty && flags.write && !flags.allowEmpty) {
    const error = `Refusing to prune all ${pruned} rows of ${PDF_MANIFEST}: not one of them points at a PDF under ${outputDir}. That is usually the environment, not real deletions (a manifest from another machine, a moved workspace, PDFs kept elsewhere). Nothing was written. Run --prune without --write to see the list; if you really deleted every PDF, re-run with --allow-empty.`;
    if (flags.json) console.log(JSON.stringify({ error, code: 'would-empty-manifest', wouldPrune: pruned }));
    else console.error(`❌ ${error}`);
    process.exit(3);
  }
  const refusesOnWrite = wouldEmpty && !flags.write && !flags.allowEmpty;
  if (refusesOnWrite) {
    warnings.push({
      code: 'would-empty-manifest',
      message: 'Every row would be pruned. That is usually the environment (another machine, a moved workspace), not real deletions; --write will refuse unless you add --allow-empty.',
    });
  }

  if (!flags.json) {
    const marker = flags.write ? '🗑️ ' : '🔎';
    const action = flags.write ? 'pruned' : 'would prune';
    for (const row of prunedRows) {
      console.log(`${marker} ${action}: ${row.relPdf} (report ${row.report || '?'}) — ${row.reason}`);
    }
    for (const warning of warnings) console.error(`⚠️  ${warning.message}`);
  }

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

  const result = { pruned, kept, dryRun: !flags.write, warnings };
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const verb = flags.write ? 'pruned' : 'would prune (dry run — pass --write to commit)';
    const unchecked = warnings.filter(w => w.code === 'cannot-check').length;
    const note = unchecked > 0 ? ` (${unchecked} of them could not be checked — see the warnings)` : '';
    console.log(`\n📊 Summary: ${pruned} row(s) ${verb}, ${kept} kept${note}`);
    if (pruned > 0 && !flags.write && !refusesOnWrite) {
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
