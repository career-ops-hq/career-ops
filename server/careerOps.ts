import fs from "node:fs";
import path from "node:path";
import { exec, spawn } from "node:child_process";
import { WORKSPACE_ROOT, assertSafePath, type PipelineJob } from "./fileAccess.ts";
import {
  getFullJobDescription,
  runAiTailoring,
  renderAndValidateTailoredCv,
  type TailoringDiff,
  type TailorJobMetadata
} from "./aiTailor.ts";
import { analyzeJobMatch } from "./jobMatch.mjs";

const JOB_MATCH_VERSION = 2;

export interface ActivityEntry {
  id: string;
  name: string;
  status: "running" | "success" | "failed";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  stdout: string;
  stderr: string;
  summary: string;
}

class CareerOpsManager {
  private currentOp: ActivityEntry | null = null;
  private recentOps: ActivityEntry[] = [];
  private evalCache = new Map<string, any>();

  constructor() {
    this.loadEvalCache();
  }

  private loadEvalCache() {
    const cachePath = path.join(WORKSPACE_ROOT, "scratch", "dashboard_eval_cache.json");
    if (fs.existsSync(cachePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(cachePath, "utf8"));
        for (const [k, v] of Object.entries(data)) {
          this.evalCache.set(k, v);
        }
      } catch (e) {
        // ignore
      }
    }
  }

  private saveEvalCache() {
    try {
      const scratchDir = path.join(WORKSPACE_ROOT, "scratch");
      if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
      const obj: Record<string, any> = {};
      for (const [k, v] of this.evalCache.entries()) obj[k] = v;
      fs.writeFileSync(path.join(scratchDir, "dashboard_eval_cache.json"), JSON.stringify(obj, null, 2), "utf8");
    } catch (e) {
      // ignore
    }
  }

  public getEvaluationForDisplay(job: { url: string; company: string; title: string; location: string; extra?: string }) {
    const cached = this.evalCache.get(job.url);
    if (cached?.matchVersion === JOB_MATCH_VERSION) return cached;
    return { ...analyzeJobMatch(job), matchVersion: JOB_MATCH_VERSION };
  }

  public getActivity() {
    return {
      currentOp: this.currentOp,
      lastOp: this.recentOps.length > 0 ? this.recentOps[0] : null,
      history: this.recentOps.slice(0, 10)
    };
  }

  private recordOpStart(name: string, summary: string): ActivityEntry {
    const op: ActivityEntry = {
      id: `op-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name,
      status: "running",
      startedAt: new Date().toISOString(),
      stdout: "",
      stderr: "",
      summary
    };
    this.currentOp = op;
    return op;
  }

  private recordOpEnd(op: ActivityEntry, status: "success" | "failed", stdout: string, stderr: string, summary?: string) {
    op.status = status;
    op.completedAt = new Date().toISOString();
    op.durationMs = new Date(op.completedAt).getTime() - new Date(op.startedAt).getTime();
    op.stdout = stdout.trim();
    op.stderr = stderr.trim();
    if (summary) op.summary = summary;
    this.currentOp = null;
    this.recentOps.unshift(op);
    if (this.recentOps.length > 20) this.recentOps.pop();
  }

  /**
   * Run real scan via allowlisted script scan.mjs
   */
  public async runScan(): Promise<{ success: boolean; data?: any; error?: string }> {
    if (this.currentOp) {
      throw new Error(`Another operation is currently running: ${this.currentOp.name}`);
    }

    const op = this.recordOpStart("Job Search Scan", "Running standard Career-Ops zero-token scanner");

    return new Promise((resolve) => {
      const startTime = Date.now();
      exec("node scan.mjs --json", { cwd: WORKSPACE_ROOT, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          this.recordOpEnd(op, "failed", stdout, stderr, `Scan failed: ${err.message}`);
          return resolve({ success: false, error: err.message });
        }

        try {
          const receipt = JSON.parse(stdout);
          const summary = `Scan completed: ${receipt.found} found, ${receipt.added} new eligible added, ${receipt.filtered} filtered, ${receipt.duplicates} duplicates`;
          this.recordOpEnd(op, "success", stdout, stderr, summary);
          resolve({ success: true, data: receipt });
        } catch (parseErr) {
          this.recordOpEnd(op, "success", stdout, stderr, "Scan finished");
          resolve({ success: true, data: { raw: stdout } });
        }
      });
    });
  }

  /**
   * Run bulk action: deep sweep across all portals to find and filter new offers
   */
  public async runBulkScan(): Promise<{ success: boolean; data?: any; error?: string }> {
    if (this.currentOp) {
      throw new Error(`Another operation is currently running: ${this.currentOp.name}`);
    }

    const op = this.recordOpStart("Bulk Job Discovery Sweep", "Sweeping all portals and ATS sources for new offers");

    return new Promise((resolve) => {
      exec("node scan.mjs --json", { cwd: WORKSPACE_ROOT, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          this.recordOpEnd(op, "failed", stdout, stderr, `Bulk sweep failed: ${err.message}`);
          return resolve({ success: false, error: err.message });
        }

        try {
          const receipt = JSON.parse(stdout);
          const summary = `Bulk sweep finished: ${receipt.found} offers scanned across all portals, ${receipt.added} new eligible added to pipeline`;
          this.recordOpEnd(op, "success", stdout, stderr, summary);
          resolve({ success: true, data: receipt });
        } catch (parseErr) {
          this.recordOpEnd(op, "success", stdout, stderr, "Bulk sweep finished");
          resolve({ success: true, data: { raw: stdout } });
        }
      });
    });
  }

  /**
   * Evaluate a job against cv.md rules
   */
  public async evaluateJob(job: { url: string; company: string; title: string; location: string; extra?: string }, force = false) {
    const cached = this.evalCache.get(job.url);
    if (!force && cached?.matchVersion === JOB_MATCH_VERSION && cached?.evaluatedFrom === "full-jd") return cached;

    const fallback = `${job.title} at ${job.company}. Location: ${job.location || "Unknown"}. ${job.extra || ""}`;
    const { text: fullJd, source: jdSource } = await getFullJobDescription(job.url, fallback);
    const result = {
      ...analyzeJobMatch(job, jdSource === "browser-extract" ? fullJd : ""),
      jdSource,
      matchVersion: JOB_MATCH_VERSION
    };

    this.evalCache.set(job.url, result);
    this.saveEvalCache();
    return result;
  }

  public async rerankJobs(jobs: Array<{ url: string; company: string; title: string; location: string; extra?: string }>, fullJdLimit = 60) {
    const preliminary = jobs.map((job) => ({ job, evaluation: analyzeJobMatch(job) }));
    for (const { job, evaluation } of preliminary) {
      this.evalCache.set(job.url, { ...evaluation, matchVersion: JOB_MATCH_VERSION });
    }

    const candidates = preliminary
      .filter(({ evaluation }) => evaluation.matchClassification !== "SKIP")
      .sort((a, b) => b.evaluation.compatibilityPercent - a.evaluation.compatibilityPercent)
      .slice(0, Math.max(0, Math.min(100, fullJdLimit)));

    let cursor = 0;
    const workers = Array.from({ length: Math.min(4, candidates.length) }, async () => {
      while (cursor < candidates.length) {
        const current = candidates[cursor++];
        await this.evaluateJob(current.job, true);
      }
    });
    await Promise.all(workers);
    this.saveEvalCache();

    const ranked = jobs.map((job) => ({ job, evaluation: this.getEvaluationForDisplay(job) }))
      .sort((a, b) => b.evaluation.compatibilityPercent - a.evaluation.compatibilityPercent);
    return { total: jobs.length, fullJdEvaluated: candidates.length, ranked };
  }

  /**
   * Generate tailored CV using Career-Ops standard pipeline
   */
  public async generateTailoredCv(job: PipelineJob, options: { providerId?: string; model?: string } = {}): Promise<{
    success: boolean;
    htmlPath: string;
    pdfPath: string;
    filename: string;
    factPass: boolean;
    pages: number;
    tailoredWithAi: boolean;
    aiProvider: string;
    aiModel: string;
    tailoringDiff?: TailoringDiff;
    jobDir?: string;
    error?: string;
  }> {
    if (this.currentOp) {
      throw new Error(`Another operation is currently running: ${this.currentOp.name}`);
    }

    const op = this.recordOpStart("Generate Tailored CV", `Starting AI tailoring for ${job.company} (${job.title})`);
    const providerEvents: string[] = [];

    try {
      // 1. Stage 1/5: Loading Job Description
      op.summary = `[1/5] Loading Full Job Description for ${job.company}...`;
      const fallbackText = `${job.title} at ${job.company}. Location: ${job.location || "Remote"}. ${job.extra || ""}`;
      const { text: fullJd, source: jdSource } = await getFullJobDescription(job.url, fallbackText);

      // 2. Stage 2/5: Loading Candidate Knowledge
      op.summary = `[2/5] Loading Candidate Ground Truth & Projects...`;

      // 3. Stage 3/5: AI Tailoring
      const selectedProvider = options.providerId || "configured provider";
      op.summary = `[3/5] AI Tailoring with ${selectedProvider}...`;
      const aiResult = await runAiTailoring(
        job,
        fullJd,
        options,
        (stage) => {
          op.summary = `[3/5] ${stage}`;
        },
        (event) => {
          const line = `[AI ${event.type.toUpperCase()}] ${event.message}`;
          providerEvents.push(line);
          op.stdout = providerEvents.join("\n");
        }
      );

      // 4 & 5. Stages 4/5 & 5/5: Fact Validation & PDF Generation
      op.summary = `[4/5] Running Fact Validation (verify-cv-facts.mjs)...`;
      const renderResult = await renderAndValidateTailoredCv(
        job,
        fullJd,
        aiResult,
        (stage) => {
          op.summary = stage;
        }
      );

      const combinedLogs = `--- PROVIDER EVENTS ---\n${providerEvents.join("\n")}\n--- JD SOURCE ---\n${jdSource} (${fullJd.length} chars)\n--- AI PROVIDER ---\n${renderResult.metadata.provider}\n--- AI MODEL ---\n${renderResult.metadata.aiModel} (${aiResult._durationMs}ms)\n--- FACT CHECK ---\n${renderResult.metadata.factValidation}\n--- METADATA ---\n${JSON.stringify(renderResult.metadata.tailoringDiff, null, 2)}`;
      this.recordOpEnd(op, "success", combinedLogs, "", `Tailored CV generated with ${renderResult.metadata.aiProvider} for ${job.company} (${renderResult.metadata.pages} pages)`);

      return {
        success: true,
        htmlPath: renderResult.htmlPath,
        pdfPath: renderResult.pdfPath,
        filename: path.basename(renderResult.pdfPath),
        factPass: true,
        pages: renderResult.metadata.pages,
        tailoredWithAi: true,
        aiProvider: renderResult.metadata.aiProvider,
        aiModel: renderResult.metadata.aiModel,
        tailoringDiff: renderResult.metadata.tailoringDiff,
        jobDir: renderResult.jobDir
      };
    } catch (err: any) {
      const msg = err.stdout ? err.stdout.toString() : err.message;
      this.recordOpEnd(op, "failed", "", String(msg), `CV generation failed: ${err.message}`);
      return {
        success: false,
        htmlPath: "",
        pdfPath: "",
        filename: "",
        factPass: false,
        pages: 0,
        tailoredWithAi: false,
        aiProvider: options.providerId || "configured provider",
        aiModel: options.model || "default",
        error: String(msg)
      };
    }
  }
}

export const careerOps = new CareerOpsManager();
