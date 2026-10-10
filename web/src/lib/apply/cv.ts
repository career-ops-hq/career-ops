import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, pdfPathStatusForReport, readApplications } from "@/lib/career-ops";
import { companySlug } from "@/lib/company-slug.mjs";
import { matchesTailoredCv, sortNewestFirst } from "./cv-match.mjs";
import { reportNumberFromCell } from "./cv-selection.mjs";

/**
 * Locate the tailored CV PDF for an application. When the tracker application
 * number is known, the report -> PDF manifest (via pdfPathStatusForReport, the
 * same resolver /api/cv-pdf uses for its own "n" lookups) is authoritative, so
 * an older role cannot accidentally receive the company's newest CV. Company
 * matching remains as a fallback for manually pasted URLs. Returns an absolute
 * path or null.
 */
export async function resolveTailoredCv(company?: string, applicationNumber?: string): Promise<string | null> {
  const root = careerOpsRoot();
  if (applicationNumber?.trim()) {
    const app = readApplications().find((candidate) => candidate.n === applicationNumber.trim());
    const reportNumber = reportNumberFromCell(app?.report);
    if (!reportNumber) return null;
    const result = await pdfPathStatusForReport(String(reportNumber));
    return result.status === "found" ? result.path : null;
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
  // No usable key means this company cannot be identified from a filename, so
  // find nothing. The old empty-string slug was a substring of every name in
  // output/, which resolved the newest unrelated CV instead (#2352).
  const key = companySlug(c);
  if (!key) return null;
  const { slug } = key;
  // `key.first` is deliberately NOT used as a fallback: matching a company by
  // its first token alone made "Acme" resolve an unrelated "Acme Bank" file,
  // and matchesTailoredCv already requires the cv- prefix AND a token boundary.
  const matches = files.filter((f) => matchesTailoredCv(f.toLowerCase(), slug));
  if (!matches.length) return null;
  const sorted = sortNewestFirst(dir, matches);
  if (!sorted.length) return null;
  return path.join(dir, sorted[0]);
}

/**
 * The tailored CV for one apply session, resolved once for both halves of it.
 *
 * /api/apply/fill uploads this PDF and /api/apply/prefill drafts the answers
 * typed into the same form, so the two must agree on which document this
 * application is. They disagreed while prefill resolved nothing at all and sent
 * the planner to master cv.md: bullets are reselected per offer, role framing is
 * rewritten toward the employer's domain, and engagements are regrouped, so the
 * reviewer read a resume and a set of answers describing different careers.
 *
 * Both routes call this. Two copies of the same three-way expression, one per
 * route, is how they drift apart again.
 */
export async function resolveSessionCv(opts: { company?: string; application?: string; title?: string }): Promise<string | null> {
  const direct = await resolveTailoredCv(opts.company, opts.application);
  if (direct) return direct;
  // An application number that resolved nothing means THIS role has no tailored
  // CV. Guessing a company off the page title would attach a sibling role's.
  if (opts.application) return null;
  return resolveTailoredCv(companyFromTitle(opts.title));
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
