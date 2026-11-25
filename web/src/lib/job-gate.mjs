import { classifyEvaluationGate, EVALUATION_GATE_REASONS, stripEvaluationGate } from "./evaluation-gate.mjs";

/** @typedef {{ reason: (typeof EVALUATION_GATE_REASONS)[number], message: string, confirmationRequired: boolean, legacy?: boolean }} JobGate */

const MISSING_REPORT = /^This evaluation didn't produce a report to save, so it isn't in your tracker — re-run it to verify\.\s*\(The agent emitted no <<report-md>> envelope, so there is no report to save\.\)$/;
const OTHER_FAILURE = /connection (?:error|ended)|interrupted|timed? out|timeout|selected model is at capacity|no cli configured|(?:cli|worker|process) (?:failed|exited)|^codex:\s|^error:/i;

/** The old error is deliberately retained in storage; this only identifies its exact wording. */
export function isLegacyMissingReportMessage(message) {
  return typeof message === "string" && MISSING_REPORT.test(message);
}

/**
 * A current server-confirmed stop, or conservative review context for an old
 * missing-report error. Legacy history cannot establish the CLI exit status:
 * never turn it into completed work or fabricate a score/report number.
 * @param {object} job
 * @returns {JobGate | null}
 */
export function evaluationGateForJob(job) {
  if (!job || job.kind !== "evaluate" || job.reportN != null || job.result?.score != null) return null;
  if (job.status === "gated") {
    const gate = job.gate;
    if (!gate || !EVALUATION_GATE_REASONS.includes(gate.reason)
        || typeof gate.message !== "string" || !gate.message.trim()
        || typeof gate.confirmationRequired !== "boolean") return null;
    return { reason: gate.reason, message: gate.message, confirmationRequired: gate.confirmationRequired };
  }
  if (job.status !== "error" || !Array.isArray(job.steps)) return null;
  const last = job.steps.at(-1);
  if (last?.kind !== "status" || !isLegacyMissingReportMessage(last.label)) return null;
  if (job.steps.slice(0, -1).some(step => step?.kind === "status" && OTHER_FAILURE.test(String(step.label || "")))) return null;
  const gate = classifyEvaluationGate(job.text);
  return gate ? { ...gate, legacy: true } : null;
}

/** The presentation label never asserts that an unscored gate saved a report. */
export function jobStateLabel(job) {
  if (job?.status === "gated" || evaluationGateForJob(job)) return "Needs review";
  return job?.status === "done" ? "Completed" : job?.status === "error" ? "Failed" : "Running";
}

/** Retain the exact stored output; hide only a validated machine status block in the primary view. */
export function jobOutputForDisplay(job) {
  const text = typeof job?.text === "string" ? job.text : "";
  return stripEvaluationGate(text);
}
