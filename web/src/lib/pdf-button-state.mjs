import { cvDiskState } from "./cv-disk-state.mjs";

/**
 * @typedef {{ id: string, status: "running" | "done" | "error" | "gated", steps: { kind: string, label: string }[] }} PdfJob
 * @typedef {{ jobId: string, reason: string } | null} PdfFailure
 * @typedef {{ kind: "running", jobId: string } | { kind: "ready" | "idle", failure: PdfFailure }} PdfButtonState
 */

/**
 * @param {{ kind?: string, input?: string } | null | undefined} detail
 * @param {string} n
 * @returns {boolean}
 */
export function pdfJobRefreshesReport(detail, n) {
  return Boolean(n && detail && detail.kind === "pdf" && detail.input === n);
}

/**
 * @param {PdfJob | undefined} job
 * @param {boolean} onDisk
 * @returns {PdfButtonState}
 */
export function pdfButtonState(job, onDisk) {
  if (job?.status === "running") return { kind: "running", jobId: job.id };
  const failure = job?.status === "error" ? { jobId: job.id, reason: failureReason(job) } : null;
  const disk = cvDiskState({ onDisk, jobFinished: job?.status === "done" });
  return { kind: disk.exists ? "ready" : "idle", failure };
}

/**
 * @param {(PdfJob & { result?: { score?: number | null, summary?: string } }) | undefined} job
 * @returns {PdfButtonState}
 */
export function coverDraftButtonState(job) {
  if (job?.status !== "done") return pdfButtonState(job, false);
  const score = job.result?.score;
  if (typeof score !== "number" || !Number.isFinite(score) || score < 2) {
    return {
      kind: "idle",
      failure: {
        jobId: job.id,
        reason: job.result?.summary || "The cover run finished without a usable draft.",
      },
    };
  }
  return { kind: "ready", failure: null };
}

/** @param {PdfJob} job */
function failureReason(job) {
  const last = job.steps.findLast((s) => s.kind === "status");
  return last?.label || "The run stopped before it finished.";
}
