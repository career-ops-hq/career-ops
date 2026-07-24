import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

/**
 * Locate the tailored CV PDF the real `pdf` mode wrote to output/ for a given
 * company (newest match wins). STRICT company match — never returns a CV tailored
 * for a different company (we'd rather attach nothing than the wrong CV). Mirrors
 * the matching in /api/cv-pdf so the "View tailored CV" link and the apply
 * file-upload always resolve to the SAME file. Returns an absolute path or null.
 */
export function resolveTailoredCv(company?: string): string | null {
  const c = (company ?? "").trim();
  if (!c) return null;
  const dir = path.join(careerOpsRoot(), "output");
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
  } catch {
    return null;
  }
  // Token-extract instead of replace-then-trim: same slug, and no `-+$`-style
  // pattern that backtracks polynomially on adversarial input (CodeQL).
  const slug = (c.toLowerCase().match(/[a-z0-9]+/g) ?? []).join("-");
  const first = slug.split("-")[0];
  // Match the slug at a token boundary (delimited by non-alphanumerics) so "Meta"
  // doesn't resolve "Metabase"'s CV — same guard cv-pdf/route.ts uses.
  const boundary = (needle: string) =>
    new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
  const reSlug = boundary(slug);
  const reFirst = first.length > 2 ? boundary(first) : null;
  const matches = files.filter((f) => {
    const l = f.toLowerCase();
    // Only the CV: `cover-…-{slug}-….pdf` matches the slug too, and the sort below
    // is newest-first, so a cover regenerated after its CV would be attached to a
    // real application in the CV slot.
    if (!l.startsWith("cv-")) return false;
    return reSlug.test(l) || (reFirst !== null && reFirst.test(l));
  });
  if (!matches.length) return null;
  matches.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
  return path.join(dir, matches[0]);
}

/**
 * Best-effort company name from an application form/page title. ATS titles look
 * like "Role - Region @ Company" (Ashby) or "Company — Role" / "Role at Company".
 * Used as a fallback when the apply flow was started by pasting a URL (no offer
 * context) rather than from a report's Apply button.
 */
export function companyFromTitle(title?: string): string {
  const t = (title ?? "").trim();
  if (!t) return "";
  const at = t.match(/@\s*([^|@]+?)\s*$/);
  if (at) return at[1].trim();
  const atWord = t.match(/\bat\s+([A-Z][\w&.\- ]+?)\s*$/);
  if (atWord) return atWord[1].trim();
  return "";
}
