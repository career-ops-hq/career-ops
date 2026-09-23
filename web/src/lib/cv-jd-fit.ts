import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export type CvJdFitResult = {
  fitScore: number | null;
  coveragePct: number;
  total: number;
  gapCount?: number;
  gaps: string[];
  hasCv: boolean;
  hasJd: boolean;
  cached?: boolean;
  jdPath?: string | null;
  cvPdfPath?: string | null;
};

function scriptPath(): string {
  return path.join(careerOpsRoot(), "cv-jd-fit.mjs");
}

/** Read cached fit from data/cv-fit-index.tsv (fast path). */
export function readCachedCvFit(report: string): CvJdFitResult | null {
  const indexPath = path.join(careerOpsRoot(), "data", "cv-fit-index.tsv");
  const n = String(report).trim().replace(/^0+(?=\d)/, "");
  if (!n) return null;
  try {
    const text = fs.readFileSync(indexPath, "utf-8");
    for (const line of text.split("\n")) {
      if (!line.trim() || line.startsWith("#")) continue;
      const [reportCol, fitScore, coveragePct, gapCount, gapsJson] = line.split("\t");
      if (String(reportCol).trim().replace(/^0+(?=\d)/, "") !== n) continue;
      let gaps: string[] = [];
      try {
        gaps = gapsJson ? JSON.parse(gapsJson) : [];
      } catch {
        gaps = [];
      }
      const score = fitScore ? parseFloat(fitScore) : null;
      const cov = coveragePct ? parseInt(coveragePct, 10) : 0;
      const gapsN = gapCount ? parseInt(gapCount, 10) : gaps.length;
      const addressed = Math.round((cov / 100) * Math.max(gapsN, 1));
      return {
        fitScore: score,
        coveragePct: cov,
        total: addressed + gapsN,
        gapCount: gapsN,
        gaps,
        hasCv: true,
        hasJd: true,
        cached: true,
      };
    }
  } catch {
    /* no index */
  }
  return null;
}

/** Compute tailored-CV ↔ JD fit (zero-LLM). Uses cache unless force=true. */
export function computeCvJdFit(report: string, company: string, opts?: { force?: boolean }): CvJdFitResult | null {
  if (!opts?.force) {
    const cached = readCachedCvFit(report);
    if (cached) return cached;
  }
  const script = scriptPath();
  if (!fs.existsSync(script)) return null;
  const result = spawnSync(
    process.execPath,
    [script, "--report", report, "--company", company, "--json", "--root", careerOpsRoot(), ...(opts?.force ? ["--force"] : [])],
    { encoding: "utf-8", timeout: 60_000 },
  );
  if (result.status !== 0) return null;
  const line = (result.stdout || "").trim();
  if (!line) return null;
  try {
    return JSON.parse(line) as CvJdFitResult;
  } catch {
    return null;
  }
}

export function pdfReadyFlag(pdf: string): boolean {
  return (pdf ?? "").includes("✅");
}
