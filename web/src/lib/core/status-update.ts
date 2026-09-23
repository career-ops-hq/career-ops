import { runCoreScript } from "@/lib/core/run-core-script";
import { outcomeTypeForStatus, usesOutcomePipeline } from "@/lib/outcome-status";

export { OUTCOME_STATUSES, type OutcomeStatus, outcomeTypeForStatus, usesOutcomePipeline } from "@/lib/outcome-status";

export type StatusUpdateInput = {
  n: string;
  status: string;
  feedback?: string;
  stage?: string;
  note?: string;
  on?: string;
};

export type StatusUpdateResult = {
  ok: true;
  status: string;
  via: "outcome" | "set-status";
  outcomeDir?: string;
  statusLogged?: boolean;
  changed?: boolean;
};

function parseJsonOutput(output: string): Record<string, unknown> | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.startsWith("{")) return JSON.parse(trimmed) as Record<string, unknown>;
    const start = trimmed.lastIndexOf("{");
    if (start >= 0) return JSON.parse(trimmed.slice(start)) as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  return null;
}

function scriptError(output: string, fallback: string): string {
  const parsed = parseJsonOutput(output);
  if (parsed && typeof parsed.error === "string") return parsed.error;
  const line = output
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("❌") || l.toLowerCase().includes("error"));
  return line?.replace(/^❌\s*/, "") || fallback;
}

/** Canonical write path: outcome.mjs for terminal outcomes, set-status.mjs otherwise. */
export function runStatusUpdate(input: StatusUpdateInput): { result?: StatusUpdateResult; error?: string; status?: number } {
  const { n, status, feedback, stage, note, on } = input;
  const outcomeType = outcomeTypeForStatus(status);

  if (outcomeType) {
    const args = [n, outcomeType, "--json"];
    if (feedback?.trim()) args.push("--feedback", feedback.trim());
    if (stage?.trim()) args.push("--stage", stage.trim());
    if (note?.trim()) args.push("--note", note.trim());

    const run = runCoreScript("outcome", args, 180_000);
    const parsed = parseJsonOutput(run.output);
    if (run.exitCode !== 0 || parsed?.error) {
      return { error: scriptError(run.output, run.error || "outcome recording failed"), status: 400 };
    }
    const setStatusResult = (parsed?.setStatusResult ?? {}) as Record<string, unknown>;
    return {
      result: {
        ok: true,
        status,
        via: "outcome",
        outcomeDir: typeof parsed?.outcomeDir === "string" ? parsed.outcomeDir : undefined,
        statusLogged: setStatusResult.statusLogged === true,
        changed: setStatusResult.changed !== false,
      },
    };
  }

  // Tracker row # and report # diverge after re-evals/backfills; bare numeric
  // selectors trip set-status.mjs's report-number-mismatch guard (e.g. row #121
  // linking report #125). --row names the tracker # explicitly.
  const args = ["--row", n, status, "--source", "web", "--json"];
  if (note?.trim()) args.push("--note", note.trim());
  if (on?.trim()) args.push("--on", on.trim());

  const run = runCoreScript("set-status", args, 60_000);
  const parsed = parseJsonOutput(run.output);
  if (run.exitCode !== 0 || parsed?.error) {
    const code = parsed?.code;
    const http = code === "not-found" ? 404 : code === "ambiguous" ? 409 : 400;
    return { error: scriptError(run.output, run.error || "status update failed"), status: http };
  }

  return {
    result: {
      ok: true,
      status: typeof parsed?.newStatus === "string" ? parsed.newStatus : status,
      via: "set-status",
      statusLogged: parsed?.statusLogged === true,
      changed: parsed?.changed !== false,
    },
  };
}
