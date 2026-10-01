// gate3-artifacts.ts — resolve WHAT Gate 3 is supposed to audit, for a finished
// pdf-lane run.
//
// WHY THIS FILE EXISTS
//   The first implementation picked the audit subject by globbing
//   `output/cv-*.payload.json` for the newest match. Nothing in the pdf lane
//   ever writes that name: modes/pdf.md Step 18 writes the render payload to
//   `/tmp/cv-{candidate}-{company}.json`. The only file that glob matched was
//   `output/cv-candidate-rhia-ai.payload.json`, written by openai-tailor.mjs — a
//   DIFFERENT tool. So Gate 3 linted a weeks-old CV against the current posting's
//   JD and reported it as this run's verdict. It never once produced a real one.
//
//   Worse, the manifest could not rescue it: generate-pdf.mjs records the JSON
//   pointer in data/pdf-index.tsv via workspaceRelativeManifestPath(), which
//   returns "" for any path outside the workspace — and /tmp is outside it. 47 of
//   51 rows carry an empty JSON column for exactly that reason. Both root-side
//   causes are separate work (they change DATA_CONTRACT.md files); this module
//   fixes the route's half without guessing.
//
// THE RULE HERE: IDENTITY BY OBSERVATION, NEVER BY MTIME
//   The route already snapshots output/ before a run (artifactsBefore) to decide
//   whether a run "wrote an artifact". Gate 3 reuses that same observation: the
//   payload to audit is the one that appeared or changed DURING this run. A
//   newest-by-mtime guess cannot distinguish "this run's CV" from "a CV another
//   concurrent lane wrote 4 seconds ago" — and the pdf lane runs concurrently by
//   design (run-registry.ts gives evaluate and pdf independent gates). Diffing
//   against the pre-run snapshot is the only answer that is correct by
//   construction rather than by luck.
//
// Deliberately import-free of the `@/` alias so node:test can load it directly,
// and every function takes explicit paths — mirrors eval-dedupe.ts.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** file → mtimeMs, as captured before a run started. */
export type PayloadSnapshot = Map<string, number>;

/**
 * The render payload a pdf run writes. modes/pdf.md Step 18:
 *   "write it to `/tmp/cv-{candidate}-{company}.json`"
 * so the basename shape is `cv-*.json` in the OS temp dir — deliberately loose,
 * because the candidate/company slugs are the agent's to choose and the only
 * stable part of the name is the `cv-` prefix.
 */
function isTempPayloadName(name: string): boolean {
  return name.startsWith("cv-") && name.endsWith(".json") && !name.endsWith(".payload.json");
}

/**
 * Snapshot every candidate payload in `tmpDir` (default: OS temp).
 *
 * Called BEFORE the CLI spawns, so the returned map is the "before" side of the
 * diff. An unreadable dir yields an empty map, which degrades to "everything
 * looks new" — acceptable, because the alternative (throwing) would take down a
 * run whose CV is already written.
 */
export function snapshotTempPayloads(tmpDir: string = os.tmpdir()): PayloadSnapshot {
  const snap: PayloadSnapshot = new Map();
  let names: string[];
  try {
    names = fs.readdirSync(tmpDir);
  } catch {
    return snap;
  }
  for (const name of names) {
    if (!isTempPayloadName(name)) continue;
    const full = path.join(tmpDir, name);
    try {
      snap.set(full, fs.statSync(full).mtimeMs);
    } catch {
      /* vanished between readdir and stat — treat as absent */
    }
  }
  return snap;
}

/**
 * The payload this run created or rewrote, or null if it wrote none.
 *
 * "New" means either absent from the snapshot or strictly newer by mtime. Ties
 * (same mtime) are treated as untouched: mtime granularity can make a genuine
 * rewrite look unchanged, and in that case the honest answer is `unavailable`
 * rather than auditing a payload we cannot prove belongs to this run.
 *
 * When several payloads qualify, the newest wins — a single pdf run writes one
 * payload, so multiple hits mean a bundle or a stray; newest is the defensible
 * tie-break and the caller still reports what it audited via `source`.
 */
export function resolveFreshTempPayload(
  before: PayloadSnapshot | null,
  tmpDir: string = os.tmpdir(),
): string | null {
  // No snapshot means no observation was taken. Returning null keeps Gate 3
  // fail-open with NO_TAILORED_PAYLOAD rather than auditing an arbitrary file.
  if (!before) return null;

  let best: string | null = null;
  let bestMtime = -Infinity;
  let names: string[];
  try {
    names = fs.readdirSync(tmpDir);
  } catch {
    return null;
  }

  for (const name of names) {
    if (!isTempPayloadName(name)) continue;
    const full = path.join(tmpDir, name);
    let mtime: number;
    try {
      mtime = fs.statSync(full).mtimeMs;
    } catch {
      continue;
    }
    const prev = before.get(full);
    if (prev !== undefined && mtime <= prev) continue; // pre-existing, untouched
    if (mtime > bestMtime) {
      bestMtime = mtime;
      best = full;
    }
  }
  return best;
}

/**
 * Last-resort fallback: the JSON pointer data/pdf-index.tsv recorded for
 * `report`, when that file still exists.
 *
 * This is a genuine fallback, not the primary path, because the column is empty
 * for every /tmp-written payload (see the header). It earns its place for the
 * bundle flow (`cv/tailored/vNNN/cv.json`), which IS workspace-relative and so
 * does get recorded. Returns null on a missing/blank/unreadable row — never a
 * guess.
 */
export function manifestPayloadForReport(root: string, report: string): string | null {
  const num = String(report ?? "").trim();
  if (!num) return null;
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, "data", "pdf-index.tsv"), "utf8");
  } catch {
    return null;
  }
  // Newest row wins for a report: generate-pdf.mjs drops superseded rows when
  // re-run with --report, but a pre-regeneration checkout may hold several.
  let found: string | null = null;
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [rowReport, , jsonPath] = line.split("\t");
    if (String(rowReport ?? "").trim() !== num) continue;
    const rel = String(jsonPath ?? "").trim();
    if (rel) found = rel;
  }
  if (!found) return null;
  const abs = path.isAbsolute(found) ? found : path.join(root, found);
  return fs.existsSync(abs) ? abs : null;
}