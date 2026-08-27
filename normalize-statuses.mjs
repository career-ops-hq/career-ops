#!/usr/bin/env node
/**
 * normalize-statuses.mjs — Clean non-canonical states in applications.md
 *
 * Maps all non-canonical statuses to canonical ones per states.yml:
 *   Evaluada, Aplicado, Respondido, Entrevista, Oferta, Rechazado, Descartado, NO APLICAR
 *
 * Also strips markdown bold (**) and dates from the status field,
 * moving DUPLICADO info to the notes column.
 *
 * Run: node career-ops/normalize-statuses.mjs [--dry-run]
 */

import { readFileSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import {
  openTrackerTransaction, rebuildRow,
  loadCanonicalStates, resolveCanonicalState,
} from './tracker-utils.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const CAREER_OPS = getCareerOpsRoot();
const APPS_FILE = resolveTrackerPath(CAREER_OPS);
const DRY_RUN = process.argv.includes('--dry-run');

// Ensure required directories exist (fresh setup)
mkdirSync(join(CAREER_OPS, 'data'), { recursive: true });

// Canonical status mapping
let statesCache = null;
/** Canonical states from templates/states.yml, read once per CLI run. */
function canonicalStates() {
  if (statesCache) return statesCache;
  try {
    statesCache = loadCanonicalStates(join(CAREER_OPS, 'templates', 'states.yml'));
  } catch {
    statesCache = []; // broken install: fall through to "unknown", never a stale copy
  }
  return statesCache;
}

function normalizeStatus(raw) {
  // Strip markdown bold
  let s = raw.replace(/\*\*/g, '').trim();
  const lower = s.toLowerCase();

  // DUPLICADO variants → Discarded
  if (/^duplicado/i.test(s) || /^dup\b/i.test(s)) {
    return { status: 'Discarded', moveToNotes: raw.trim() };
  }

  // CERRADA / Cancelada / Descartada → Discarded
  if (/^cerrada$/i.test(s)) return { status: 'Discarded' };
  if (/^cancelada/i.test(s)) return { status: 'Discarded' };
  if (/^descartada$/i.test(s)) return { status: 'Discarded' };
  if (/^descartado$/i.test(s)) return { status: 'Discarded' };

  // Rechazada / Rechazado → Rejected
  // `rechazada?` reads as "rechazad" + an OPTIONAL trailing "a", so it accepted
  // "rechazada" and the bare stem "rechazad" but never "rechazado" — the masculine
  // form this comment claims to handle, that states.yml lists as an alias, and that
  // the header of this file names. A bare "Rechazado" fell through to unknown.
  if (/^rechazad[oa]$/i.test(s)) return { status: 'Rejected' };
  if (/^rechazado\s+\d{4}/i.test(s)) return { status: 'Rejected' };

  // Aplicado with date → Applied (strip date)
  if (/^aplicado\s+\d{4}/i.test(s)) return { status: 'Applied' };

  // CONDICIONAL / HOLD / EVALUAR / Verificar → Evaluated
  if (/^(condicional|hold|evaluar|verificar)$/i.test(s)) return { status: 'Evaluated' };

  // MONITOR → SKIP
  if (/^monitor$/i.test(s)) return { status: 'SKIP' };

  // GEO BLOCKER → SKIP
  if (/geo.?blocker/i.test(s)) return { status: 'SKIP' };

  // Repost #NNN → Discarded
  if (/^repost/i.test(s)) return { status: 'Discarded', moveToNotes: raw.trim() };

  // "—" (em dash, no status) → Discarded
  if (s === '—' || s === '-' || s === '') return { status: 'Discarded' };

  // Already canonical (English, per states.yml) — just fix casing/bold
  const canonical = [
    'Evaluated', 'Applied', 'Responded', 'Interview',
    'Offer', 'Hired', 'Rejected', 'Discarded', 'SKIP',
  ];
  for (const c of canonical) {
    if (lower === c.toLowerCase()) return { status: c };
  }

  // Every remaining alias comes from templates/states.yml, not a list here.
  // The hand-written list this replaces had drifted: it carried the Spanish
  // aliases and none of the Turkish ones, so a `Mülakat` row was reported as
  // an unknown status by the very tool whose job is normalizing statuses
  // (#2704). test-all already asserted states.yml ⊆ this function; deriving
  // makes that hold by construction instead of by remembering.
  const fromStates = resolveCanonicalState(lower, canonicalStates());
  if (fromStates) return { status: fromStates };

  // Unknown — flag it
  return { status: null, unknown: true };
}

export { normalizeStatus };

// Everything below is the CLI. It is guarded because importing this module used to
// run it: the import alone opened a tracker transaction and rewrote applications.md.
// That is why tests could only scrape this file's source with regexes instead of
// calling the function, and why the rechazado gap went unnoticed.
const IS_CLI = isMainModule(import.meta.url);

if (IS_CLI) {
// Read applications.md
if (!existsSync(APPS_FILE)) {
  console.log('No applications.md found. Nothing to normalize.');
  process.exit(0);
}

let trackerTransaction = null;
if (!DRY_RUN) {
  try {
    trackerTransaction = await openTrackerTransaction(APPS_FILE);
  } catch (err) {
    console.error(`Cannot acquire tracker lock: ${err.message}`);
    process.exit(1);
  }
  process.once('exit', () => {
    try { trackerTransaction.close(); } catch {}
  });
}
try {
const content = trackerTransaction ? trackerTransaction.read() : readFileSync(APPS_FILE, 'utf-8');
const lines = content.split('\n');

let changes = 0;
let unknowns = [];

// Map columns by header name (tracker-parse.mjs, #954/#1596). Fixed indices
// assumed the original 9-column layout, so a customized tracker — an inserted
// Location or Via column — shifted every field one to the left: the Score cell
// was normalized as if it were the status and overwritten, while the real
// status was left alone and reported as unknown (#1955).
const COLS = resolveColumns(lines);

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const row = parseTrackerRow(line, COLS);
  if (!row) continue; // header, separator, non-row, or a row missing cells

  const parts = line.split('|').map(s => s.trim());
  const num = row.num;
  const rawStatus = row.status;
  const result = normalizeStatus(rawStatus);

  if (result.unknown) {
    unknowns.push({ num, rawStatus, line: i + 1 });
    continue;
  }

  if (result.status === rawStatus) continue; // Already canonical

  // Apply change
  const oldStatus = rawStatus;
  parts[COLS.status] = result.status;

  // Move DUPLICADO info to notes if needed. A layout without a Notes column
  // has nowhere to put it — dropping the provenance beats appending a cell the
  // table has no header for.
  if (result.moveToNotes && COLS.notes != null) {
    const existing = parts[COLS.notes] || '';
    if (!existing.includes(result.moveToNotes)) {
      parts[COLS.notes] = result.moveToNotes + (existing ? '. ' + existing : '');
    }
  }

  // Also strip bold from score field
  if (parts[COLS.score]) {
    parts[COLS.score] = parts[COLS.score].replace(/\*\*/g, '');
  }

  // Reconstruct line
  const newLine = rebuildRow(parts);
  lines[i] = newLine;
  changes++;

  console.log(`#${num}: "${oldStatus}" → "${result.status}"`);
}

if (unknowns.length > 0) {
  console.log(`\n⚠️  ${unknowns.length} unknown statuses:`);
  for (const u of unknowns) {
    console.log(`  #${u.num} (line ${u.line}): "${u.rawStatus}"`);
  }
}

console.log(`\n📊 ${changes} statuses normalized`);

if (!DRY_RUN && changes > 0) {
  // Backup first
  const backupPath = `${APPS_FILE}.bak`;
  copyFileSync(APPS_FILE, backupPath);
  trackerTransaction.replace(lines.join('\n'));
  console.log(`✅ Written to ${APPS_FILE} (backup: ${backupPath})`);
} else if (DRY_RUN) {
  console.log('(dry-run — no changes written)');
} else {
  console.log('✅ No changes needed');
}
} finally {
  trackerTransaction?.close();
}
} // end IS_CLI
