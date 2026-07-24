import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

/**
 * Locate the tailored COVER LETTER PDF the real `pdf` mode wrote to output/ for a
 * given company (newest match wins). STRICT company match at a token boundary AND
 * a `cover-` filename prefix — never returns a CV (or anyone else's cover) as this
 * offer's cover letter (we'd rather attach nothing than the wrong file). Mirrors
 * the matching in /api/cover-pdf so the "View cover" link always resolves to the
 * SAME file. Returns an absolute path or null.
 */
export function resolveTailoredCover(company?: string): string | null {
  const c = (company ?? "").trim();
  if (!c) return null;
  const dir = path.join(careerOpsRoot(), "output");
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf") && f.toLowerCase().startsWith("cover-"));
  } catch {
    return null;
  }
  // Token-extract instead of replace-then-trim: same slug, and no `-+$`-style
  // pattern that backtracks polynomially on adversarial input (CodeQL).
  const slug = (c.toLowerCase().match(/[a-z0-9]+/g) ?? []).join("-");
  if (!slug) return null;
  // Match the slug at a token boundary (delimited by non-alphanumerics) so "Meta"
  // doesn't match "Metabase"'s cover letter.
  const re = new RegExp(`(^|[^a-z0-9])${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
  const matches = files.filter((f) => re.test(f.toLowerCase()));
  if (!matches.length) return null;
  matches.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
  return path.join(dir, matches[0]);
}
