import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, readApplications } from "@/lib/career-ops";
import { pdfPathForReport, reportNumberFromCell } from "./cv-selection.mjs";

function containedRealpath(file: string, root: string): boolean {
  try {
    return fs.realpathSync(file).startsWith(fs.realpathSync(root) + path.sep);
  } catch {
    return false;
  }
}

function isRegularContainedFile(file: string, root: string): boolean {
  try {
    return fs.statSync(file).isFile() && containedRealpath(file, root);
  } catch {
    return false;
  }
}

/**
 * Locate the tailored CV PDF for an application. When the tracker application
 * number is known, the report -> PDF manifest is authoritative, so an older
 * role cannot accidentally receive the company's newest CV. Company matching
 * remains as a fallback for manually pasted URLs.
 */
export function resolveTailoredCv(company?: string, applicationNumber?: string): string | null {
  const root = careerOpsRoot();
  if (applicationNumber?.trim()) {
    const app = readApplications().find((candidate) => candidate.n === applicationNumber.trim());
    const reportNumber = reportNumberFromCell(app?.report);
    if (!reportNumber) return null;
    let indexText: string;
    try {
      indexText = fs.readFileSync(path.join(root, "data", "pdf-index.tsv"), "utf8");
    } catch {
      return null;
    }
    const relativePdf = pdfPathForReport(indexText, reportNumber);
    if (!relativePdf) return null;
    const file = path.resolve(root, relativePdf);
    const outputDir = path.resolve(root, "output");
    if (!file.startsWith(outputDir + path.sep) || !isRegularContainedFile(file, outputDir)) return null;
    return file;
  }

  const c = (company ?? "").trim();
  if (!c) return null;
  const dir = path.join(root, "output");
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
    if (!(l.includes(slug) || (first.length > 2 && l.includes(first)))) return false;
    return isRegularContainedFile(path.join(dir, f), dir);
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
