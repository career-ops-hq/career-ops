"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { CostBadge } from "@/components/cost/cost-badge";
import { EvaluationOptions, useEvaluationOptions } from "@/components/evaluation-options";
import { FULL_EVALUATION } from "@/lib/evaluation-options.mjs";

// Auto-pipeline, one click: paste a job URL → fire a real evaluation worker
// (the same kind:"evaluate" that runs modes/oferta.md + writes the A–F report +
// tracker row). The worker pills + assistant cards show progress.
export function QuickEvaluate() {
  const { startJob } = useJobs();
  const [url, setUrl] = useState("");
  const [hint, setHint] = useState("");
  const { sections, setSections } = useEvaluationOptions();

  function run() {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) {
      setHint("Paste a full job-posting URL (https://…).");
      return;
    }
    startJob({ title: "Evaluate · pasted URL", subtitle: u, kind: "evaluate", input: u, page: "/", evaluationSections: sections });
    setUrl("");
    setHint("Evaluating — watch it in the Workers tray.");
  }

  return (
    <div className="mt-7">
      <div className="flex max-w-xl items-center gap-2 rounded-full border border-border bg-surface/70 py-1.5 pl-4 pr-1.5 shadow-sm focus-within:border-brand/50">
        <Sparkles className="size-4 shrink-0 text-brand-text/70" />
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (hint) setHint("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
          }}
          placeholder="Paste a job URL to evaluate…"
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
        <span className="text-xs text-faint">Evaluation runs on your own AI — your key, your machine.</span>
      </div>
      <details className="mt-3 max-w-xl">
        <summary className="cursor-pointer text-xs text-brand-text">Evaluation options · {sections.length === FULL_EVALUATION.length ? "full evaluation" : `${sections.length} optional sections`}</summary>
        <div className="mt-3"><EvaluationOptions sections={sections} onChange={setSections} /></div>
      </details>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}
