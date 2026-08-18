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
/**
 * Exact lookup by report/tracker number via data/pdf-index.tsv, which
 * generate-pdf.mjs keys per report. Company-name matching cannot separate two
 * roles at the same employer: it takes the newest match, so a second tailored CV
 * for the same company silently shadows the first (two ANYbotics roles, Zurich
 * and Barcelona, both resolved to whichever was generated last). Returns an
 * absolute path, or null when the report has no indexed PDF.
 */
export function resolveCvByReport(report?: string | number): string | null {
  const n = String(report ?? "").trim();
  if (!/^\d+$/.test(n)) return null;
  const root = careerOpsRoot();
  let rows: string[];
  try {
    rows = fs.readFileSync(path.join(root, "data", "pdf-index.tsv"), "utf8").split("\n");
  } catch {
    return null;
  }
  // Last wins: the index is append-only, so a regenerated CV is a later row.
  let rel: string | null = null;
  for (const row of rows) {
    if (row.startsWith("#") || !row.trim()) continue;
    const col = row.split("\t");
    if (col[0]?.trim() === n && col[1]?.trim()) rel = col[1].trim();
  }
  if (!rel) return null;
  const abs = path.resolve(root, rel);
  // Never let an index row escape the project root.
  if (!abs.startsWith(path.resolve(root) + path.sep)) return null;
  return fs.existsSync(abs) ? abs : null;
}

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
  const matches = files.filter((f) => {
    const l = f.toLowerCase();
    return l.includes(slug) || (first.length > 2 && l.includes(first));
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
