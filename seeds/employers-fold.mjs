#!/usr/bin/env node
// @ts-check
/**
 * seeds/employers-fold.mjs: fold the contribution inbox of the employer
 * registry (employers/inbox/) into the registry itself. For maintainers, after
 * inbox pull requests are merged.
 *
 *   node seeds/employers-fold.mjs            dry run: print what would change, write nothing
 *   node seeds/employers-fold.mjs --apply    make the change in the working tree
 *
 * Run from the root of a checkout. What it does, in order:
 *   1. Validates the registry, inbox included. Any error stops it.
 *   2. Groups the inbox by contribution (<YYYY-MM-DD>-<login>: the boards
 *      files, their numbered parts and the optional manifest).
 *   3. Turns each line into a full row (inboxLineToRow): careers_url, and the
 *      provenance fields source, contribution and added (the contribution
 *      date). A board already in boards/, retired or not, is skipped.
 *   4. Inserts the rows into boards/<ats>/<initial>.ndjson in the order the
 *      validator requires. Lines already there keep their exact text.
 *   5. Writes each contribution's manifest to contributions/: the
 *      organization's own, with rows set to the boards it really added, or,
 *      for a contribution without one, a short manifest that credits the
 *      login in the file name. A contribution id that is already taken gets
 *      -2, -3, … A contribution whose boards were all known adds no manifest.
 *   6. Regenerates CHANGELOG.md, deletes the folded inbox files (and inbox/
 *      when it is empty), and validates again.
 *
 * Deterministic and idempotent: the output depends only on the files, never
 * on the clock or the machine, and a second run finds an empty inbox and
 * changes nothing. It does not commit, push or open anything.
 *
 * Exit codes: 0 done (or nothing to fold), 1 the registry is not valid, 2
 * usage error.
 */

import { existsSync, lstatSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isMainModule } from '../lib/is-main-module.mjs';
import { INBOX_DIR, inboxCareersUrl, inboxCoords, inboxLineToRow } from './employers-inbox.mjs';
import {
  ALSO_PERMITS,
  LICENSE_ID,
  MANIFEST_ID_RE,
  REGISTRY_DIR,
  boardIdentity,
  boardInitial,
  compareRows,
  readInbox,
  renderChangelog,
  validateRegistry,
} from './employers-validate.mjs';

/**
 * @typedef {{path: string, content: string, created: boolean, added: number}} FoldWrite
 * @typedef {{inboxId: string, id: string, login: string, source: string, added: number, skipped: number, manifest: 'organization'|'written'|'none'}} FoldContribution
 * @typedef {{contributions: FoldContribution[], added: number, skipped: number, writes: FoldWrite[], deletes: string[]}} FoldPlan
 */

/** @param {string} p */
const isDir = (p) => { try { return lstatSync(p).isDirectory(); } catch { return false; } };

/**
 * The board files under boards/, each as its raw lines (text kept exactly)
 * and parsed rows. Read after validation, so every line parses.
 * @param {string} root
 * @returns {Map<string, Array<{text: string, row: any}>>} relative path → lines
 */
function readBoardFiles(root) {
  /** @type {Map<string, Array<{text: string, row: any}>>} */
  const out = new Map();
  const bdir = join(root, REGISTRY_DIR, 'boards');
  if (!isDir(bdir)) return out;
  for (const ats of readdirSync(bdir).sort()) {
    if (!isDir(join(bdir, ats))) continue;
    for (const f of readdirSync(join(bdir, ats)).sort()) {
      if (!f.endsWith('.ndjson')) continue;
      const text = readFileSync(join(bdir, ats, f), 'utf8');
      const lines = text.split('\n').filter((l) => l !== '');
      out.set(`${REGISTRY_DIR}/boards/${ats}/${f}`, lines.map((l) => ({ text: l, row: JSON.parse(l) })));
    }
  }
  return out;
}

/**
 * A manifest as JSON text: two-space indent, short string arrays on one line
 * (the shape of the manifests already in contributions/).
 * @param {object} m
 */
export function formatManifest(m) {
  return `${JSON.stringify(m, null, 2).replace(/\[\n\s+("[^"\n]*"(?:,\n\s+"[^"\n]*")*)\n\s*\]/g,
    (_, items) => `[${items.split(/,\n\s+/).join(', ')}]`)}\n`;
}

/**
 * The manifest of a contribution that came without one: it credits the login
 * in the file name, which is the account that opened the pull request.
 * @param {{id: string, login: string, date: string, rows: number}} c
 */
export function looseManifest({ id, login, date, rows }) {
  return {
    id,
    contributor: login,
    signed_by: `@${login}`,
    rows,
    source: 'community',
    origin: `Added through the employer registry inbox in a pull request from the GitHub account @${login}, without a manifest of its own.`,
    no_conflicting_contract: true,
    personal_data: false,
    exclusive: false,
    license: LICENSE_ID,
    also_permits: [...ALSO_PERMITS],
    attribution: `Boards contributed by @${login}`,
    date,
  };
}

/**
 * Work out the fold without writing anything.
 * @param {{root?: string, today?: Date}} [opts]
 * @returns {{errors: Array<{file: string, line: number, message: string}>, plan: FoldPlan|null}}
 */
export function planFold({ root = process.cwd(), today = new Date() } = {}) {
  const { errors } = validateRegistry({ root, today });
  if (errors.length) return { errors, plan: null };

  const inbox = readInbox(root, null);
  /** @type {FoldPlan} */
  const plan = { contributions: [], added: 0, skipped: 0, writes: [], deletes: [] };
  if (inbox.files.length === 0 && inbox.sheets.size === 0) return { errors: [], plan };

  const boardFiles = readBoardFiles(root);
  /** @type {Set<string>} */
  const known = new Set();
  for (const lines of boardFiles.values()) for (const { row } of lines) known.add(boardIdentity(row));

  const cdir = join(root, REGISTRY_DIR, 'contributions');
  /** @type {Map<string, any>} */
  const manifests = new Map();
  if (isDir(cdir)) {
    for (const f of readdirSync(cdir).sort()) {
      if (f.endsWith('.json')) manifests.set(f.slice(0, -5), JSON.parse(readFileSync(join(cdir, f), 'utf8')));
    }
  }

  // Each contribution: its boards files (unnumbered first, then by part) and its manifest.
  /** @type {Map<string, {files: typeof inbox.files, login: string, date: string}>} */
  const groups = new Map();
  for (const f of inbox.files) {
    const g = groups.get(f.parsed.id) || { files: [], login: f.parsed.login, date: f.parsed.date };
    g.files.push(f);
    groups.set(f.parsed.id, g);
  }
  for (const g of groups.values()) g.files.sort((a, b) => (a.parsed.part ?? 0) - (b.parsed.part ?? 0));

  /** @type {Map<string, any[]>} board file path → new rows */
  const newRows = new Map();
  /** @type {Map<string, string>} manifest path → text */
  const newManifests = new Map();

  for (const inboxId of [...groups.keys()].sort()) {
    const g = /** @type {NonNullable<ReturnType<typeof groups.get>>} */ (groups.get(inboxId));
    const sheet = inbox.sheets.get(inboxId) || null;
    let id = inboxId;
    for (let n = 2; manifests.has(id); n++) id = `${inboxId}-${n}`;
    if (!MANIFEST_ID_RE.test(id)) throw new Error(`cannot find a free contribution id for ${inboxId}`);
    const source = sheet ? sheet.data.source : 'community';

    let added = 0;
    let skipped = 0;
    for (const f of g.files) {
      for (const { row: line } of f.lines) {
        const identity = boardIdentity({ ...inboxCoords(line), careers_url: inboxCareersUrl(line) });
        if (known.has(identity)) { skipped++; continue; }
        known.add(identity);
        const row = inboxLineToRow(line, { source, contribution: id, added: g.date });
        const path = `${REGISTRY_DIR}/boards/${row.ats}/${boardInitial(row.board)}.ndjson`;
        newRows.set(path, [...(newRows.get(path) || []), row]);
        added++;
      }
    }

    /** @type {FoldContribution['manifest']} */
    let kind = 'none';
    if (added > 0) {
      const path = `${REGISTRY_DIR}/contributions/${id}.json`;
      if (sheet) {
        kind = 'organization';
        const unchanged = id === inboxId && sheet.data.rows === added;
        newManifests.set(path, unchanged ? sheet.text : formatManifest({ ...sheet.data, id, rows: added }));
      } else {
        kind = 'written';
        newManifests.set(path, formatManifest(looseManifest({ id, login: g.login, date: g.date, rows: added })));
      }
      manifests.set(id, JSON.parse(/** @type {string} */ (newManifests.get(path))));
    }
    plan.contributions.push({ inboxId, id, login: g.login, source, added, skipped, manifest: kind });
    plan.added += added;
    plan.skipped += skipped;
  }

  for (const [path, rows] of [...newRows].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const existing = boardFiles.get(path) || [];
    const merged = [...existing, ...rows.map((row) => ({ text: JSON.stringify(row), row }))]
      .sort((a, b) => compareRows(a.row, b.row));
    plan.writes.push({ path, content: `${merged.map((l) => l.text).join('\n')}\n`, created: !boardFiles.has(path), added: rows.length });
  }
  for (const [path, content] of newManifests) plan.writes.push({ path, content, created: true, added: 0 });
  if (newManifests.size) {
    plan.writes.push({ path: `${REGISTRY_DIR}/CHANGELOG.md`, content: renderChangelog([...manifests.values()]), created: false, added: 0 });
  }
  plan.deletes = [...inbox.files.map((f) => f.file), ...[...inbox.sheets.values()].map((s) => s.file)].sort();
  return { errors: [], plan };
}

/**
 * Write a fold plan into `root`: the files, then the deletions.
 * @param {FoldPlan} plan
 * @param {string} root
 */
export function applyFold(plan, root) {
  for (const w of plan.writes) {
    mkdirSync(dirname(join(root, w.path)), { recursive: true });
    writeFileSync(join(root, w.path), w.content);
  }
  for (const d of plan.deletes) unlinkSync(join(root, d));
  const inboxDir = join(root, INBOX_DIR);
  if (existsSync(inboxDir) && readdirSync(inboxDir).filter((f) => f !== '.DS_Store').length === 0) {
    for (const f of readdirSync(inboxDir)) unlinkSync(join(inboxDir, f));
    rmdirSync(inboxDir);
  }
}

/**
 * The summary printed after a dry run or an apply.
 * @param {FoldPlan} plan
 * @param {boolean} applied
 */
export function renderFoldSummary(plan, applied) {
  if (plan.deletes.length === 0) return 'the inbox is empty: nothing to fold';
  const lines = [
    `${applied ? 'folded' : 'dry run'}: ${plan.contributions.length} contribution(s), ${plan.added} new board(s), ${plan.skipped} already in the registry skipped`,
  ];
  for (const c of plan.contributions) {
    const as = c.id === c.inboxId ? c.id : `${c.inboxId} as ${c.id} (the id was taken)`;
    const manifest = { organization: 'its own manifest', written: 'a manifest crediting @' + c.login, none: 'no manifest: every board was already known' }[c.manifest];
    lines.push(`  ${as}: ${c.added} new, ${c.skipped} skipped, source ${c.source}, ${manifest}`);
  }
  lines.push(`files${applied ? '' : ' it would touch'}:`);
  for (const w of plan.writes) {
    const mark = w.created ? '+' : '~';
    lines.push(`  ${mark} ${w.path}${w.added ? ` (+${w.added} row${w.added === 1 ? '' : 's'})` : ''}`);
  }
  for (const d of plan.deletes) lines.push(`  - ${d}`);
  if (!applied) lines.push('run with --apply to make these changes');
  return lines.join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────────

const USAGE = `Usage: node seeds/employers-fold.mjs [--apply]

  Folds employers/inbox/ into boards/ and contributions/, regenerates
  CHANGELOG.md and deletes the folded inbox files. Run it from the repository
  root. Without --apply it only prints what it would change.

  --apply   write the changes to the working tree (no commit).
  --help    show this text.`;

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); return; }
  const unknown = args.filter((a) => a !== '--apply');
  if (unknown.length) {
    console.error(`employers-fold: unknown argument: ${unknown[0]}\n\n${USAGE}`);
    process.exit(2);
  }
  const apply = args.includes('--apply');
  const root = process.cwd();
  const { errors, plan } = planFold({ root });
  if (!plan) {
    for (const e of errors.slice(0, 50)) console.error(`${e.line ? `${e.file}:${e.line}` : e.file}: ${e.message}`);
    if (errors.length > 50) console.error(`… and ${errors.length - 50} more`);
    console.error(`\nemployers-fold: the registry has ${errors.length} error(s); fix them before folding (node seeds/employers-validate.mjs)`);
    process.exit(1);
  }
  if (apply && plan.deletes.length) applyFold(plan, root);
  console.log(renderFoldSummary(plan, apply));
  if (apply && plan.deletes.length) {
    const after = validateRegistry({ root });
    if (after.errors.length) {
      for (const e of after.errors.slice(0, 50)) console.error(`${e.line ? `${e.file}:${e.line}` : e.file}: ${e.message}`);
      console.error(`\nemployers-fold: the registry is not valid after folding (${after.errors.length} error(s))`);
      process.exit(1);
    }
    console.log(`employer registry is valid: ${after.stats.rows} rows in ${after.stats.files} files, ${after.stats.contributions} contribution(s)`);
  }
}

if (isMainModule(import.meta.url)) main();
