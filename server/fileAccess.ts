import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveMasterPdfPath } from "./profile.ts";

export const WORKSPACE_ROOT = path.resolve(process.cwd());

/**
 * Validate that candidate path resolves strictly within WORKSPACE_ROOT
 */
export function assertSafePath(targetPath: string): string {
  const abs = path.isAbsolute(targetPath) ? targetPath : path.resolve(WORKSPACE_ROOT, targetPath);
  const rel = path.relative(WORKSPACE_ROOT, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Security violation: path escapes workspace root: ${targetPath}`);
  }
  return abs;
}

export interface PipelineJob {
  id: string;
  url: string;
  company: string;
  title: string;
  location: string;
  workModel: string;
  date: string;
  status: "pending" | "reviewed" | "applied" | "skipped";
  extra: string;
  fitScore?: number;
  recommendation?: "APPLY" | "REVIEW" | "SKIP";
  strengths?: string[];
  gaps?: string[];
  missingMandatorySkills?: string[];
  compatibilityPercent?: number;
  matchClassification?: "BEST MATCH" | "STRONG MATCH" | "POSSIBLE MATCH" | "LOW MATCH" | "SKIP";
  compatibilityTier?: "A" | "B" | "C" | "D";
  reason?: string;
  primaryStack?: string[];
  responsibilitySplit?: { frontend: string; backend: string; platform: string };
  evaluatedFrom?: "full-jd" | "pipeline-summary";
  salary?: string;
  hasTailoredCv?: boolean;
  tailoredPdfPath?: string;
}

export function parsePipeline(): { pending: PipelineJob[]; processed: PipelineJob[] } {
  const pipelinePath = path.join(WORKSPACE_ROOT, "data", "pipeline.md");
  if (!fs.existsSync(pipelinePath)) {
    return { pending: [], processed: [] };
  }

  const content = fs.readFileSync(pipelinePath, "utf8");
  const lines = content.split("\n");

  const pending: PipelineJob[] = [];
  const processed: PipelineJob[] = [];
  let currentSection: "pending" | "processed" | "" = "";

  // Check which tailored PDFs exist in output/
  const outputFiles = getTailoredCvs();
  const pdfNameMap = new Map<string, string>();
  for (const f of outputFiles) {
    pdfNameMap.set(f.filename.toLowerCase(), f.filePath);
  }

  let index = 0;
  for (const line of lines) {
    if (line.startsWith("## Pending")) {
      currentSection = "pending";
      continue;
    } else if (line.startsWith("## Processed")) {
      currentSection = "processed";
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith("- [ ]") || trimmed.startsWith("- [x]")) {
      const raw = trimmed.substring(5).trim();
      const parts = raw.split(" | ").map(p => p.trim());
      if (parts.length >= 3) {
        const url = parts[0];
        const company = parts[1];
        const title = parts[2];
        const location = parts[3] || "";
        const extra = parts.slice(4).join(" | ");

        let workModel = "Office";
        const locLower = (location + " " + extra).toLowerCase();
        if (locLower.includes("remote") || locLower.includes("zdalnie")) {
          workModel = "Remote";
        } else if (locLower.includes("hybrid") || locLower.includes("hybryd")) {
          workModel = "Hybrid";
        }

        let date = "";
        const dateMatch = extra.match(/posted:\s*(\d{4}-\d{2}-\d{2})/i) || extra.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) date = dateMatch[1];

        let status: "pending" | "reviewed" | "applied" | "skipped" = currentSection === "pending" ? "pending" : "reviewed";
        if (extra.includes("applied")) status = "applied";
        if (extra.includes("skipped")) status = "skipped";

        // Check if there is a tailored PDF matching company
        const compClean = company.toLowerCase().replace(/[^a-z0-9]/g, "");
        let hasTailoredCv = false;
        let tailoredPdfPath: string | undefined;

        for (const [fname, fpath] of pdfNameMap.entries()) {
          if (fname.includes(compClean)) {
            hasTailoredCv = true;
            tailoredPdfPath = fpath;
            break;
          }
        }

        const job: PipelineJob = {
          id: `job-${index++}`,
          url,
          company,
          title,
          location,
          workModel,
          date,
          status,
          extra,
          hasTailoredCv,
          tailoredPdfPath
        };

        if (currentSection === "pending") {
          pending.push(job);
        } else {
          processed.push(job);
        }
      }
    }
  }

  return { pending, processed };
}

export function updatePipelineStatus(targetUrl: string, newStatus: "reviewed" | "applied" | "skipped"): boolean {
  const pipelinePath = path.join(WORKSPACE_ROOT, "data", "pipeline.md");
  if (!fs.existsSync(pipelinePath)) return false;

  const content = fs.readFileSync(pipelinePath, "utf8");
  const lines = content.split("\n");
  let found = false;
  let inPending = false;
  let inProcessed = false;

  const newPendingLines: string[] = [];
  const processedLinesToAdd: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## Pending")) {
      inPending = true;
      inProcessed = false;
      newPendingLines.push(line);
      continue;
    }
    if (line.startsWith("## Processed")) {
      inPending = false;
      inProcessed = true;
      newPendingLines.push(line);
      continue;
    }

    if (inPending && (line.trim().startsWith("- [ ]") || line.trim().startsWith("- [x]"))) {
      if (line.includes(targetUrl)) {
        found = true;
        // Transform line to processed entry
        const raw = line.trim().substring(5).trim();
        const updated = `- [x] ${raw} | status: ${newStatus}`;
        processedLinesToAdd.push(updated);
        continue;
      }
    }
    newPendingLines.push(line);
  }

  if (found) {
    // Insert into processed section
    const procIdx = newPendingLines.findIndex(l => l.startsWith("## Processed"));
    if (procIdx !== -1) {
      newPendingLines.splice(procIdx + 1, 0, ...processedLinesToAdd);
    }
    fs.writeFileSync(pipelinePath, newPendingLines.join("\n"), "utf8");
    return true;
  }

  return false;
}

export function getMasterCvStatus() {
  const mdPath = path.join(WORKSPACE_ROOT, "cv.md");
  const pdfPath = resolveMasterPdfPath();

  const mdExists = fs.existsSync(mdPath);
  const pdfExists = fs.existsSync(pdfPath);

  let mdModified = null;
  let mdSize = 0;
  if (mdExists) {
    const stat = fs.statSync(mdPath);
    mdModified = stat.mtime.toISOString();
    mdSize = stat.size;
  }

  let pdfModified = null;
  let pdfSize = 0;
  if (pdfExists) {
    const stat = fs.statSync(pdfPath);
    pdfModified = stat.mtime.toISOString();
    pdfSize = stat.size;
  }

  return {
    mdExists,
    mdPath,
    mdModified,
    mdSize,
    pdfExists,
    pdfPath,
    pdfModified,
    pdfSize,
    pdfFilename: path.basename(pdfPath)
  };
}

export interface TailoredCvFile {
  filename: string;
  filePath: string;
  sizeBytes: number;
  modified: string;
  isPdf: boolean;
}

export function getTailoredCvs(): TailoredCvFile[] {
  const outDir = path.join(WORKSPACE_ROOT, "output");
  if (!fs.existsSync(outDir)) return [];

  const files = fs.readdirSync(outDir);
  const cvs: TailoredCvFile[] = [];

  for (const file of files) {
    if (file.endsWith(".pdf") && file.startsWith("cv-")) {
      const full = path.join(outDir, file);
      const stat = fs.statSync(full);
      cvs.push({
        filename: file,
        filePath: full,
        sizeBytes: stat.size,
        modified: stat.mtime.toISOString(),
        isPdf: true
      });
    }
  }

  cvs.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  return cvs;
}

export function getLastScanInfo() {
  const runsPath = path.join(WORKSPACE_ROOT, "data", "scan-runs.tsv");
  if (!fs.existsSync(runsPath)) {
    return { lastRun: null, totalAdded: 0, totalDiscovered: 0, totalFiltered: 0, totalDuplicates: 0 };
  }

  const lines = fs.readFileSync(runsPath, "utf8").trim().split("\n");
  if (lines.length <= 1) return { lastRun: null, totalAdded: 0, totalDiscovered: 0, totalFiltered: 0, totalDuplicates: 0 };

  const lastLine = lines[lines.length - 1];
  const parts = lastLine.split("\t");
  const found = parseInt(parts[4] || "0", 10);
  const dupes = parseInt(parts[12] || "0", 10);
  const added = parseInt(parts[13] || "0", 10);
  const filtered = found > 0 ? (found - dupes - added) : 0;

  return {
    lastRun: parts[0] || null,
    totalDiscovered: found,
    totalFiltered: filtered,
    totalDuplicates: dupes,
    totalAdded: added
  };
}

export function openLocalTarget(type: "master-cv" | "master-pdf" | "master-folder" | "cv-folder" | "tailored-cv" | "url", payload?: string): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    let target = "";

    switch (type) {
      case "master-cv":
        target = assertSafePath("cv.md");
        break;
      case "master-pdf":
        target = assertSafePath(resolveMasterPdfPath());
        break;
      case "master-folder":
        target = WORKSPACE_ROOT;
        break;
      case "cv-folder":
        target = assertSafePath("output");
        break;
      case "tailored-cv": {
        if (!payload) {
          return resolve({ success: false, message: "Missing CV path parameter" });
        }
        // Must be inside output/
        const safe = assertSafePath(payload);
        if (!safe.startsWith(path.join(WORKSPACE_ROOT, "output"))) {
          return resolve({ success: false, message: "Can only open files in output directory" });
        }
        target = safe;
        break;
      }
      case "url": {
        if (!payload || (!payload.startsWith("http://") && !payload.startsWith("https://"))) {
          return resolve({ success: false, message: "Invalid URL" });
        }
        target = payload;
        break;
      }
      default:
        return resolve({ success: false, message: "Unknown open type" });
    }

    if (type !== "url" && !fs.existsSync(target)) {
      return resolve({ success: false, message: `File not found: ${target}` });
    }

    try {
      const child = spawn("xdg-open", [target], { detached: true, stdio: "ignore" });
      child.unref();
      resolve({ success: true, message: `Opened ${target}` });
    } catch (err: any) {
      resolve({ success: false, message: `Failed to open ${target}: ${err.message}` });
    }
  });
}

export function getTailoringDiff(company: string, title?: string): any {
  const outputsDir = path.join(WORKSPACE_ROOT, "outputs");
  if (!fs.existsSync(outputsDir)) return null;

  const compClean = company.toLowerCase().replace(/[^a-z0-9]/g, "");
  const dirs = fs.readdirSync(outputsDir);
  for (const d of dirs) {
    const dPath = path.join(outputsDir, d);
    if (fs.statSync(dPath).isDirectory() && d.toLowerCase().replace(/[^a-z0-9]/g, "").includes(compClean)) {
      const metaPath = path.join(dPath, "metadata.json");
      if (fs.existsSync(metaPath)) {
        try {
          return JSON.parse(fs.readFileSync(metaPath, "utf8"));
        } catch {
          // ignore
        }
      }
    }
  }
  return null;
}
