/**
 * lib/github-evidence-paths.mjs — where github-evidence scan files live (#6667, #7006).
 *
 * New scans are written to `output/diagnostics/`: they are run output, not a
 * deliverable, and carry no report number. Scans written before this change sit
 * in `output/`, so every reader looks in both places. One definition here keeps
 * github-evidence.mjs (write, `--since` baseline) and evidence-freshness.mjs
 * (stale-evidence notice) from drifting apart.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Subdirectory of `output/` that new scans are written to. */
export const EVIDENCE_SUBDIR = 'diagnostics';

/** `github-evidence-{YYYY-MM-DD}.json`; groups 1-3 are year, month, day. */
export const SCAN_JSON_RE = /^github-evidence-(\d{4})-(\d{2})-(\d{2})\.json$/;

/** Directory new scans are written to, under the data root's `output/`. */
export function evidenceWriteDir(outputDir) {
  return join(outputDir, EVIDENCE_SUBDIR);
}

/**
 * Every scan JSON in `output/diagnostics/` and in the legacy `output/`, newest
 * date first. When the same date exists in both places the `diagnostics/` copy
 * comes first, so it wins.
 *
 * @param {string} outputDir Absolute path to `output/`.
 * @returns {{name: string, date: string, path: string, rel: string, legacy: boolean}[]}
 */
export function listScanFiles(outputDir) {
  const places = [
    { dir: evidenceWriteDir(outputDir), rel: `output/${EVIDENCE_SUBDIR}`, legacy: false },
    { dir: outputDir, rel: 'output', legacy: true },
  ];
  const found = [];
  for (const { dir, rel, legacy } of places) {
    if (!existsSync(dir)) continue;
    let names = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const name of names) {
      const m = SCAN_JSON_RE.exec(name);
      if (m) found.push({ name, date: `${m[1]}-${m[2]}-${m[3]}`, path: join(dir, name), rel: `${rel}/${name}`, legacy });
    }
  }
  // Newest date first; on a tie the diagnostics/ copy (legacy: false) sorts first.
  return found.sort((a, b) => b.date.localeCompare(a.date) || Number(a.legacy) - Number(b.legacy));
}
