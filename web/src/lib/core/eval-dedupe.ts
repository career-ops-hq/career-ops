// eval-dedupe.ts — two halves of the "the posting never leaves the pipeline"
// fix (2026-09-28): (a) markInboxDone() flips a finished posting's pipeline row
// to [x] so it drops out of pendingInbox and cannot re-fire a worker; (b)
// findExistingEvaluation() answers "has this input already produced a report?"
// so /api/run can resolve a duplicate evaluate to the existing report instead
// of burning tokens and orphaning report numbers.
//
// Deliberately import-free of the `@/` alias so node:test can load it directly
// (mirrors run-registry.ts). Every function takes the career-ops root as a
// parameter — no hidden global state, easy fixtures.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

/** Purge a posting URL of the noise that makes `same posting` look different:
 *  tracking params, fragment, and trailing slash. Meaningful query params are
 *  KEPT (ATS postings carry the id in the query — e.g. greenhouse `?gh_jid=`),
 *  sorted by key so param order can't split a match. Bare paths / local:jds
 *  references pass through as-is. */
export function normalizePostingUrl(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!/^https?:\/\//i.test(s)) return s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return s;
  }
  const TRACKING = new Set([
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
    "fbclid", "gclid", "gclsrc", "dclid", "igshid", "msclkid", "twclid",
    "mc_cid", "mc_eid", "li_fat_id", "ref", "ref_src",
  ]);
  const keep = new URLSearchParams();
  for (const [k, v] of [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!TRACKING.has(k.toLowerCase())) keep.append(k, v);
  }
  const q = keep.toString();
  return `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${q ? `?${q}` : ""}`;
}

/** Normalized identity hash of a JD text — whitespace/case-insensitive so a
 *  repaste that only differs in formatting still matches. */
export function jdTextHash(raw: string): string {
  const norm = String(raw ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256").update(norm).digest("hex");
}

/** The archived JD body of a report: everything under `## Job Description`
 *  until the next `#` heading (reports #2789 embed the verbatim JD here). */
export function extractJdSection(md: string): string {
  const lines = String(md ?? "").split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Job Description\b/i.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return "";
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    // Report sections are `## `+; a level-1 `# ` heading is the JD's own title
    // (archives are usually headed `# <Company> …`), so it stays part of the JD.
    if (/^#{2,6}\s/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

function reportNumberFromFilename(filename: string): number {
  const m = filename.match(/^(\d+)-/);
  return m ? parseInt(m[1], 10) : NaN;
}

/** Does a pipeline-row URL cell denote the same posting as `input`? Path-ish
 *  cells (local:jds/…) compare on the stripped path; real URLs through
 *  normalizePostingUrl so tracking params don't split a match. */
function cellsMatch(rowCell: string, input: string): boolean {
  const a = (rowCell ?? "").trim();
  const b = (input ?? "").trim();
  if (!a || !b) return false;
  if (/^https?:\/\//i.test(a) && /^https?:\/\//i.test(b)) {
    return normalizePostingUrl(a) === normalizePostingUrl(b);
  }
  return a === b || a.replace(/^local:/i, "").trim() === b.replace(/^local:/i, "").trim();
}

function listReports(root: string): string[] {
  try {
    return fs
      .readdirSync(path.join(root, "reports"))
      .filter((f) => f.endsWith(".md") && !/-RESERVED\.md$/i.test(f));
  } catch {
    return [];
  }
}

/**
 * Find the report number an existing evaluation produced for this input.
 * Returns the EARLIEST match, null if nothing evaluated it yet.
 *
 *  - URL input → matched against every report's `**URL:**` header (normalized).
 *  - local:jds/… or a root-relative/absolute file path → matched against
 *    report URL headers that reference the same file (the Airtel/Nians
 *    re-eval shape — the run's input IS the header cell) AND, when the input
 *    file exists, against each report's archived JD section by content hash
 *    (catches a repaste that landed under a fresh timestamped filename).
 */
export function findExistingEvaluation(root: string, input: string): number | null {
  const files = listReports(root);
  if (files.length === 0) return null;
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  const wantUrl = normalizePostingUrl(raw);
  const isPendingFile = !/^https?:\/\//i.test(raw);
  const relPath = raw.replace(/^local:/i, "").trim();
  const resolvedPath = /^([/.]|\.\.)/.test(relPath) ? relPath : path.join(root, relPath);
  let wantHash = "";
  if (isPendingFile) {
    try {
      wantHash = jdTextHash(fs.readFileSync(resolvedPath, "utf8"));
    } catch {
      wantHash = ""; // file missing → no content match, header match may still fire
    }
  }

  let best: number | null = null;
  for (const f of files) {
    const num = reportNumberFromFilename(f);
    if (num == null || Number.isNaN(num)) continue;
    let content: string;
    try {
      content = fs.readFileSync(path.join(root, "reports", f), "utf8");
    } catch {
      continue;
    }
    const h = content.match(/^\*\*URL:\*\*\s*(\S+)/m);
    if (h && cellsMatch(h[1], raw)) {
      if (best === null || num < best) best = num;
      continue;
    }
    if (isPendingFile && wantHash) {
      const jd = extractJdSection(content);
      if (jd && jdTextHash(jd) === wantHash) {
        if (best === null || num < best) best = num;
      }
    }
  }
  return best;
}

function writeAtomic(p: string, s: string): void {
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, s);
  fs.renameSync(tmp, p);
}

/**
 * Flip a pending pipeline row to done: `- [ ] URL | …` → `- [x] URL | …`.
 * Matches by the row's URL cell (normalized for real URLs, path-exact for
 * local:jds/…); idempotent; a no-op for rows with no match. Returns how many
 * rows actually flipped. Saved only when something changed. User-layer write —
 * the source of truth for "the inbox has dealt with this posting".
 */
export function markInboxDone(root: string, input: string): number {
  const file = path.join(root, "data", "pipeline.md");
  let md: string;
  try {
    md = fs.readFileSync(file, "utf8");
  } catch {
    return 0;
  }
  const lines = md.split("\n");
  let flipped = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*-\s*)\[([ xX])\]\s*(.+)$/);
    if (!m) continue;
    const cell = m[3].split("|")[0]?.trim() ?? "";
    if (!cellsMatch(cell, input)) continue;
    if (m[2] !== " ") continue; // already done
    lines[i] = lines[i].replace(/^(\s*-\s*)\[ \]/, "$1[x]");
    flipped++;
  }
  if (flipped === 0) return 0;
  writeAtomic(file, lines.join("\n"));
  return flipped;
}