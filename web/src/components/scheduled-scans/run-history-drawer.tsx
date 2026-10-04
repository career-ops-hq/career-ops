"use client";

import { CheckCircle2, XCircle, Clock, X, TerminalSquare, Loader2, Ban } from "lucide-react";
import { useRef } from "react";
import type { JobRun } from "@/lib/scheduled-jobs";
import { cn } from "@/lib/cn";
import { ScheduledOverlay } from "./scheduled-overlay";
import { runStatusTone } from "@/lib/scheduled-run-status.mjs";

export function RunHistoryDrawer({
  isOpen,
  onClose,
  runs,
}: {
  isOpen: boolean;
  onClose: () => void;
  runs: JobRun[];
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  if (!isOpen) return null;

  return (
    <ScheduledOverlay isOpen={isOpen} onClose={onClose} titleId="run-history-title" initialFocusRef={closeRef} overlayClassName="justify-end" panelClassName="!my-0 !mr-0 !h-full !max-h-none max-w-md rounded-none rounded-l-2xl border-y-0 border-r-0 p-0 flex flex-col">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <TerminalSquare className="size-5 text-brand" />
            <h2 id="run-history-title" className="text-base font-semibold text-foreground">Execution Run History</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-faint hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {runs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
              No scan executions recorded yet.
            </div>
          ) : (
            runs.map((run, i) => {
              const isSuccess = run.state === "success";
              const isRunning = run.state === "running";
              const isQueued = run.state === "queued";
              const isCancelled = run.state === "cancelled";
              const tone = runStatusTone(run.state);
              return (
                <div
                  key={`${run.id || "run"}-${i}`}
                  className="rounded-xl border border-border bg-surface/50 p-3.5 text-xs shadow-sm transition-colors hover:border-brand/30"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-medium">
                      {isSuccess ? (
                        <CheckCircle2 className="size-4 text-emerald-500" />
                      ) : isRunning ? (
                        <Loader2 className="size-4 animate-spin text-brand" />
                      ) : isQueued ? (
                        <Clock className="size-4 text-amber-500" />
                      ) : isCancelled ? (
                        <Ban className="size-4 text-muted" />
                      ) : (
                        <XCircle className="size-4 text-rose-500" />
                      )}
                      <span className={cn(tone === "success" ? "text-emerald-600 dark:text-emerald-400" : tone === "failed" ? "text-rose-500" : "text-muted")}>
                        {isSuccess ? "Success" : isRunning ? "Running" : isQueued ? "Queued" : isCancelled ? "Cancelled" : "Failed"}
                      </span>
                      {run.engine && (
                        <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-faint uppercase font-mono">
                          {run.engine}
                        </span>
                      )}
                    </div>
                    <span className="flex items-center gap-1 text-[11px] text-faint">
                      <Clock className="size-3" />
                      {new Date(run.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                  </div>

                  <p className="mt-2 text-muted leading-relaxed">{run.message || "Execution completed"}</p>

                  <div className="mt-2 flex items-center justify-between text-[11px] text-faint border-t border-border/40 pt-1.5">
                    <span>Date: {new Date(run.at).toLocaleDateString()}</span>
                    {typeof run.rolesFound === "number" && (
                      <span className="font-semibold text-foreground">{run.rolesFound} roles found</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
    </ScheduledOverlay>
  );
}
