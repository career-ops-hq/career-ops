"use client";

import { useState } from "react";
import { GraduationCap } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { CostBadge } from "@/components/cost/cost-badge";

// Fires the real career-ops `training` mode (worker kind "training") — scores
// a course/cert on the 6-dimension modes/training.md framework and returns a
// DO / DON'T DO / DO WITH TIMEBOX verdict. Collapsed by default: this is a
// secondary utility next to QuickEvaluate, not the primary pipeline action.
export function TrainingEvaluate() {
  const { startJob } = useJobs();
  const [open, setOpen] = useState(false);
  const [course, setCourse] = useState("");
  const [hint, setHint] = useState("");

  function run() {
    const c = course.trim();
    if (!c) {
      setHint("Name the course/cert, or paste its URL.");
      return;
    }
    startJob({ title: "Evaluate a course", subtitle: c, kind: "training", input: c, page: "/pipeline" });
    setCourse("");
    setHint("Evaluating — watch it in the Workers tray.");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-faint transition-colors hover:text-brand"
      >
        <GraduationCap className="size-3.5" /> Should I take a course or cert?
      </button>
    );
  }

  return (
    <div className="mt-2.5 max-w-xl">
      <div className="flex items-center gap-2 rounded-full border border-border bg-surface/70 py-1.5 pl-4 pr-1.5 shadow-sm focus-within:border-brand/50">
        <GraduationCap className="size-4 shrink-0 text-brand/70" />
        <input
          autoFocus
          value={course}
          onChange={(e) => {
            setCourse(e.target.value);
            if (hint) setHint("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Course/cert name or URL to evaluate…"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-faint"
        />
        <button
          onClick={run}
          className="shrink-0 rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200"
        >
          Evaluate
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <CostBadge kind="spend" size="xs" />
        <span className="text-xs text-faint">Scores DO / DON&apos;T DO / DO WITH TIMEBOX against your target roles.</span>
      </div>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}
