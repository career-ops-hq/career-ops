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

/**
 * True for the sibling draft generate-pdf.mjs writes when a render runs over
 * its page budget: `{name}.overflow.pdf`, then `.overflow-2.pdf` and so on
 * when that name is taken. The draft is the version the budget rejected, kept
 * for inspection only, and it is written after the deliverable, so newest-first
 * resolution would otherwise serve it as the tailored artifact. The suffix is
 * reserved for drafts: a deliverable deliberately named that way is not found.
 */
export function isOverflowDraft(filenameLower) {
  return /\.overflow(-\d+)?\.pdf$/.test(filenameLower);
}

const STANDARD_NAME = /^\d{3,}-(.+)-\d{4}-\d{2}-\d{2}(?:-(?:ats|canva))?\.[a-z0-9]+$/;

/**
 * The `cv`/`cover` words of a name's head (`{company}-{kind}-{candidate}`) that
 * sit between two dashes. That is what parseOutputName() counts (`-cv-`,
 * `-cover-`): a company that starts with "Cover" or a candidate that ends with
 * "Cover" never carries one, because the company and the candidate each come
 * with the dash that joins them to the kind.
 */
export function interiorKinds(head) {
  return String(head).split('-').slice(1, -1).filter((part) => part === 'cv' || part === 'cover');
}

/**
 * The kind (`cv` or `cover`) of a name in the standard layout
 * `{NNN}-{company-slug}-{kind}-{candidate-slug}-{date}[-{variant}].{ext}`
 * (lib/output-names.mjs, #6667), or null when the name is not in that layout.
 *
 * A standard name has exactly one kind word between two dashes (see
 * interiorKinds): that is the rule buildOutputName() enforces by reading its own
 * output back with parseOutputName(), so a name with two is not one this repo
 * wrote and gets null, since attaching nothing beats attaching the wrong
 * document. A company that starts with "Cover" or a candidate that ends with it
 * still has just one. The parity test in apply-cover-resolver.test.mjs runs
 * the builder and this reader over the same inputs.
 *
 * With the caller's company `slug` the match is exact, as cv.ts requires
 * (#2352: Acme must not resolve an Acme Bank file): the name must start
 * `{NNN}-{slug}-` and the kind token must come right after it. A candidate
 * called `Zep` is therefore not the company `zep`, and `acme` does not claim
 * `024-acme-bank-cv-...`.
 */
export function standardKind(filenameLower, slug) {
  const m = STANDARD_NAME.exec(filenameLower);
  if (!m) return null;
  const head = m[1];
  const kinds = interiorKinds(head);
  if (kinds.length !== 1) return null;
  if (slug) {
    const prefix = `${slug}-`;
    if (!head.startsWith(prefix)) return null;
    if (head.slice(prefix.length).split('-')[0] !== kinds[0]) return null;
  }
  return kinds[0];
}

/** True when the name is in the standard layout, whatever its kind. */
export function isStandardName(filenameLower) {
  return STANDARD_NAME.test(filenameLower);
}

/**
 * Match a file against every slug a company can carry (companySlug().keys): the
 * first is the folded slug and the rest are legacy slugs that dropped accented
 * letters. A standard-layout name folds accents, so only the folded slug
 * identifies it; matching it against a legacy slug ("caf" for Café) could claim
 * another company's file ("031-caf-cv-..." belongs to CAF). Legacy slugs apply
 * to non-standard names only.
 *
 * @param {(filenameLower: string, slug: string) => boolean} matcher
 * @param {string} filenameLower
 * @param {string[]} keys
 */
export function matchesCompanyKeys(matcher, filenameLower, keys) {
  const [folded, ...legacy] = keys;
  if (matcher(filenameLower, folded)) return true;
  if (isStandardName(filenameLower)) return false;
  return legacy.some((key) => matcher(filenameLower, key));
}

export function matchesTailoredCv(filenameLower, slug) {
  if (isOverflowDraft(filenameLower)) return false;
  if (isStandardName(filenameLower)) return standardKind(filenameLower, slug) === 'cv';
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
  if (isOverflowDraft(filenameLower)) return false;
  // The ATS copy of a CV (`{stem}.ats.pdf`) is never a cover, whatever tokens
  // its candidate slug happens to carry.
  if (/\.ats\.pdf$/.test(filenameLower)) return false;
  if (isStandardName(filenameLower)) return standardKind(filenameLower, slug) === 'cover';
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
