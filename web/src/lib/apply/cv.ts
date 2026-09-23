import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

const OUTPUT_DIR = () => path.join(careerOpsRoot(), "output");
const PDF_INDEX = () => path.join(careerOpsRoot(), "data", "pdf-index.tsv");

/** cv-shivanand-shah-acme-2026-01-01.pdf — not *-cover.pdf */
function isTailoredCvFilename(name: string): boolean {
  const l = name.toLowerCase();
  return l.startsWith("cv-") && l.endsWith(".pdf") && !l.endsWith("-cover.pdf");
}

/** acme-senior-pm-cover.pdf */
function isCoverLetterFilename(name: string): boolean {
  return name.toLowerCase().endsWith("-cover.pdf");
}

/** Token slug from a company name (CodeQL-safe: extract tokens, no replace-then-trim). */
export function companySlug(company: string): string {
  return (company.toLowerCase().match(/[a-z0-9]+/g) ?? []).join("-");
}

/** Match company slug at a token boundary inside a filename. */
function filenameMatchesCompany(filename: string, slug: string): boolean {
  if (!slug) return false;
  const re = new RegExp(`(^|[^a-z0-9])${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
  return re.test(filename.toLowerCase());
}

function normReportNum(s: string): string {
  return String(s ?? "").trim().replace(/^0+(?=\d)/, "");
}

/** Lookup tailored CV path from data/pdf-index.tsv by report number. */
export function resolveTailoredCvByReport(report?: string): string | null {
  const n = normReportNum(report ?? "");
  if (!n) return null;
  let text: string;
  try {
    text = fs.readFileSync(PDF_INDEX(), "utf-8");
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [reportCol, pdfCol] = line.split("\t");
    if (!reportCol?.trim() || !pdfCol?.trim()) continue;
    if (normReportNum(reportCol) !== n) continue;
    const rel = pdfCol.trim();
    const abs = path.isAbsolute(rel) ? rel : path.join(careerOpsRoot(), rel);
    if (fs.existsSync(abs) && isTailoredCvFilename(path.basename(abs))) return abs;
  }
  return null;
}

function newestMatchingPdf(dir: string, filter: (name: string) => boolean, slug: string): string | null {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => filter(f) && filenameMatchesCompany(f, slug));
  } catch {
    return null;
  }
  if (!files.length) return null;
  files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
  return path.join(dir, files[0]);
}

/**
 * Locate the tailored CV PDF the real `pdf` mode wrote to output/ for a given
 * company (newest match wins). Only considers `cv-*.pdf` files — never cover
 * letters. When report is provided, pdf-index.tsv is checked first.
 */
export function resolveTailoredCv(company?: string, report?: string): string | null {
  const fromIndex = resolveTailoredCvByReport(report);
  if (fromIndex) return fromIndex;

  const c = (company ?? "").trim();
  if (!c) return null;
  return newestMatchingPdf(OUTPUT_DIR(), isTailoredCvFilename, companySlug(c));
}

/**
 * Locate the cover letter PDF for a company (newest `*-cover.pdf` match).
 */
export function resolveCoverLetter(company?: string): string | null {
  const c = (company ?? "").trim();
  if (!c) return null;
  return newestMatchingPdf(OUTPUT_DIR(), isCoverLetterFilename, companySlug(c));
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
