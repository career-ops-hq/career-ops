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
import { isMainModule } from './lib/is-main-module.mjs';

const USAGE = 'Usage: node sync-pdf-flags.mjs [--dry-run] [--json]\n       node sync-pdf-flags.mjs --prune [--write] [--json]';

/**
 * Reconcile one tracker's PDF column against one PDF manifest, or prune that
 * manifest (`flags.prune`), against the paths given.
 *
 * The paths used to be module-scope constants resolved from the environment,
 * so the only way to run a sync was a fresh node process. merge-tracker.mjs
 * did exactly that after every real merge — one more cold start per merge,
 * and in an importer (a test merging a sandbox) a child that resolved its
 * tracker from the ambient env rather than the one just merged (#4758). The
 * CLI branch at the bottom is now the only place that reads the environment.
 *
 * @param {object} options
 * @param {string} options.appsFile - Tracker to reconcile (canonical path).
 * @param {string} options.pdfManifest - PDF manifest (data/pdf-index.tsv).
 * @param {{dryRun?: boolean, json?: boolean, prune?: boolean, write?: boolean}} [options.flags]
 * @param {string} [options.lockDir] - Tracker lock; defaults to the one derived from appsFile.
 * @param {{timeoutMs?: number, retryMs?: number, staleMs?: number}} [options.lock] - Lock timing.
 * @param {{log: Function, error: Function}} [options.logger=console]
 * @returns {Promise<number>} The exit code the CLI exits with.
 */
export async function syncTrackerPdfFlags(options = {}) {
  const { appsFile, pdfManifest, logger = globalThis.console } = options;
  if (!appsFile || !pdfManifest) throw new TypeError('syncTrackerPdfFlags: options.appsFile and options.pdfManifest are required');
  // Shadows the global for the rest of this function, so every message reaches
  // the caller's logger unchanged.
  const console = logger;
  const APPS_FILE = appsFile;
  const PDF_MANIFEST = pdfManifest;
  const flags = { dryRun: false, json: false, prune: false, write: false, ...options.flags };
  // Only the lock settings the caller actually gave: an explicit `undefined`
  // would override openTrackerTransaction's own env-derived defaults.
  const transactionOptions = Object.fromEntries(
    Object.entries({ lockDir: options.lockDir, ...options.lock }).filter(([, v]) => v !== undefined),
  );

  if (!existsSync(APPS_FILE)) {
    if (flags.json) console.log(JSON.stringify({ error: `No tracker found at ${APPS_FILE}`, code: 'no-tracker' }));
    else console.error(`❌ No tracker found at ${APPS_FILE}`);
    return 2;
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
      return 0;
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
      return 2;
    }

    // The workspace root is needed to resolve the workspace-relative pdf paths
    // stored in the manifest (e.g. "output/042-acme-cv.pdf").
    const workspaceRoot = resolveWorkspaceRoot(APPS_FILE);
    const outputDir = resolve(workspaceRoot, 'output');

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
      if (!pathIsInsideCanonical(absPath, outputDir)) {
        prunedRows.push({ line, relPdf, report: parts[0]?.trim() || '' });
        if (!flags.json) {
          const marker = flags.write ? '🗑️ ' : '🔎';
          const action = flags.write ? 'pruned' : 'would prune';
          console.log(`${marker} ${action}: ${relPdf} (report ${parts[0]?.trim() || '?'}) — outside output directory`);
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
        return 1;
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
    return 0;
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
      return 2;
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
    transaction = await openTrackerTransaction(APPS_FILE, transactionOptions);
  } catch (err) {
    if (err?.code === 'LOCK_TIMEOUT') {
      if (flags.json) console.log(JSON.stringify({ error: err.message, code: 'lock-timeout' }));
      else console.error(`❌ ${err.message}`);
      return 4;
    }
    if (flags.json) console.log(JSON.stringify({ error: `Cannot acquire tracker lock: ${err.message}`, code: 'lock-error' }));
    else console.error(`❌ Cannot acquire tracker lock: ${err.message}`);
    return 1;
  }

  let content;
  try {
    content = transaction.read();
  } catch (err) {
    transaction.close();
    if (flags.json) console.log(JSON.stringify({ error: `Cannot read tracker: ${err.message}`, code: 'read-failure' }));
    else console.error(`❌ Cannot read tracker: ${err.message}`);
    return 2;
  }

  let updated = 0;
  let unchanged = 0;
  // Closed on every way out, a throw included: run inside merge-tracker's
  // process, a transaction left open holds the tracker lock until it goes stale.
  // close() is idempotent, so the early close on a write failure stays.
  try {
    const lines = content.split('\n');
    const colmap = resolveColumns(lines);

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
        return 1;
      }
    }
  } finally {
    transaction.close();
  }

  const result = { updated, unchanged, dryRun: flags.dryRun };
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n📊 Summary: ${updated} PDF flags synced, ${unchanged} unchanged`);
    if (flags.dryRun) console.log('(dry-run — no changes written)');
  }

  return 0;
}

if (isMainModule(import.meta.url)) {
  const flags = { dryRun: false, json: false, prune: false, write: false };
  const unknownOptions = [];
  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--prune') flags.prune = true;
    else if (arg === '--write') flags.write = true;
    else unknownOptions.push(arg);
  }

  // --prune is dry-run by default; --write opts in to committing changes.
  // Outside prune mode, --write has no meaning — surface it as an unknown option
  // to avoid silent surprises.
  if (!flags.prune && flags.write) {
    unknownOptions.push('--write');
  }

  // --dry-run must win over --write
  if (flags.dryRun) flags.write = false;

  if (unknownOptions.length > 0) {
    const error = `unknown option(s): ${unknownOptions.join(', ')}`;
    if (flags.json) console.error(JSON.stringify({ error, code: 'unknown-option' }));
    else console.error(`Error: ${error}\n${USAGE}`);
    process.exitCode = 1;
  } else {
    const DATA_ROOT = getCareerOpsRoot();
    const appsFile = resolveTrackerPath(DATA_ROOT);
    // exitCode, not exit(): the transaction is closed on every path inside, and
    // a natural exit lets piped output (--json) flush.
    process.exitCode = await syncTrackerPdfFlags({
      appsFile,
      // Derived from the TRACKER, not from this script's location, so a redirected
      // CAREER_OPS_TRACKER moves the whole workspace together (#2471).
      pdfManifest: resolvePdfIndexPath(appsFile),
      flags,
    });
  }
}
