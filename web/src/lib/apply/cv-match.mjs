/**
 * cv-match.mjs — the ONE matching contract shared by every resolver that has
 * to decide which file in output/ is "the" tailored artifact for an offer:
 * `web/src/lib/apply/cv.ts` (resolveTailoredCv, used by the apply flow),
 * `web/src/app/api/cv-pdf/route.ts` (the "View tailored CV" link), and
 * `web/src/lib/apply/cover.ts` (resolveTailoredCover, behind "View cover" and
 * /api/cover-pdf).
 *
 * Plain .mjs (same pattern as tracker-table.mjs) so it has zero TS/`@/`-alias
 * baggage: every TS call site imports it directly, and the resolver tests
 * under `web/tests/lib/` can `await import()` it with no build step.
 *
 * Before this module existed, cv.ts and route.ts each hand-rolled their own
 * copy of this logic and drifted — cv.ts grew a loose "first token" fallback
 * that route.ts never had, so the two flows could disagree on which file was
 * "the" tailored CV for a company (CodeRabbit, PR #2156). Import from here
 * instead of re-deriving the regex so that can't happen again.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * True when `token` appears in `filenameLower` delimited by non-alphanumerics,
 * so "acme" does not match "acmecorp". This is the ONE boundary test in the
 * module: the matchers below compose it, and so does any caller that needs a
 * second token (cover.ts narrows a company's covers by the tracker row's role
 * slug). An empty token matches nothing — an empty needle is contained in
 * every filename, and the result gets attached to a real application.
 */
export function hasToken(filenameLower, token) {
  if (!token) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
  return re.test(filenameLower);
}

export function matchesTailoredCv(filenameLower, slug) {
  if (!filenameLower.startsWith('cv-')) return false;
  return hasToken(filenameLower, slug);
}

/**
 * Cover letters are matched on a `cover` TOKEN, not a `cover-` prefix: the
 * writers name them by suffix — `{company}-{role}-cover.pdf` is
 * generate-cover-letter.mjs's default output path, and modes/cover.md's
 * payload is `output/{company-slug}-{role-slug}-cover.pdf`. Nothing in the
 * repo emits `cover-*.pdf`, so a prefix filter matches no real cover at all.
 *
 * The `cv-` prefix is excluded explicitly — the mirror of matchesTailoredCv's
 * own guard — so a tailored CV can never be served as this offer's cover
 * letter. Attaching nothing beats attaching the wrong document.
 */
export function matchesTailoredCover(filenameLower, slug) {
  if (filenameLower.startsWith('cv-')) return false;
  if (!hasToken(filenameLower, 'cover')) return false;
  return hasToken(filenameLower, slug);
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
