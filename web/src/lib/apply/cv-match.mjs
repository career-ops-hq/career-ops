/**
 * cv-match.mjs — the ONE matching contract shared by both tailored-CV
 * resolvers: `web/src/lib/apply/cv.ts` (resolveTailoredCv, used by the apply
 * flow) and `web/src/app/api/cv-pdf/route.ts` (the "View tailored CV" link).
 *
 * Plain .mjs (same pattern as tracker-table.mjs) so it has zero TS/`@/`-alias
 * baggage: both TS call sites import it directly, and `test/apply-cv-resolver
 * .test.mjs` at the repo root can `await import()` it with no build step.
 *
 * Before this module existed, cv.ts and route.ts each hand-rolled their own
 * copy of this logic and drifted — cv.ts grew a loose "first token" fallback
 * that route.ts never had, so the two flows could disagree on which file was
 * "the" tailored CV for a company (CodeRabbit, PR #2156). Import from here
 * instead of re-deriving the regex so that can't happen again.
 */

import fs from 'node:fs';
import path from 'node:path';

export function matchesTailoredCv(filenameLower, slug) {
  if (!filenameLower.startsWith('cv-')) return false;
  if (!slug) return false;
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
  return re.test(filenameLower);
}

/**
 * Newest-first by mtime. A file can be deleted between the caller's
 * `readdirSync` and this stat (TOCTOU) — e.g. a concurrent regeneration
 * replacing it — so a vanished file is dropped rather than throwing ENOENT
 * and 500ing the request.
 */
export function sortNewestFirst(dir, files) {
  return files
    .map((f) => {
      try {
        return { f, mtime: statMtime(dir, f) };
      } catch {
        return null;
      }
    })
    .filter((entry) => entry !== null)
    .sort((a, b) => b.mtime - a.mtime)
    .map((entry) => entry.f);
}

function statMtime(dir, f) {
  const stat = fs.statSync(path.join(dir, f));
  // readdirSync can list a directory that happens to match the cv-*.pdf
  // pattern; treat it the same as a vanished file (caught by the caller's
  // try/catch) rather than returning a path whose later readFileSync 500s.
  if (!stat.isFile()) throw new Error(`${f} is not a file`);
  return stat.mtimeMs;
}
