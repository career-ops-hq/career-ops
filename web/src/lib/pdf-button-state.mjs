import { cvDiskState } from "./cv-disk-state.mjs";

/**
 * @typedef {{ id: string, status: "running" | "done" | "error", steps: { kind: string, label: string }[] }} PdfJob
 * @typedef {{ jobId: string, reason: string } | null} PdfFailure
 * @typedef {{ kind: "running", jobId: string } | { kind: "ready" | "idle", failure: PdfFailure }} PdfButtonState
 */

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

/** @param {PdfJob} job */
function failureReason(job) {
  const last = job.steps.findLast((s) => s.kind === "status");
  return last?.label || "The run stopped before it finished.";
}
