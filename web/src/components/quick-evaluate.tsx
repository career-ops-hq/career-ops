"use client";

import { useState } from "react";
import { useJobs } from "@/components/jobs/job-store";
import { CostBadge } from "@/components/cost/cost-badge";

// Auto-pipeline, one click: paste a job URL → fire a real evaluation worker
// (the same kind:"evaluate" that runs modes/oferta.md + writes the A–F report +
// tracker row). The worker pills + assistant cards show progress.
export function QuickEvaluate() {
  const { startJob } = useJobs();
  const [url, setUrl] = useState("");
  const [hint, setHint] = useState("");

  function run() {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) {
      setHint("Cola o endereço completo da oferta (https://…).");
      return;
    }
    startJob({ title: "Avaliar · endereço colado", subtitle: u, kind: "evaluate", input: u, page: "/" });
    setUrl("");
    setHint("Avaliação em curso. Podes acompanhar o progresso no painel de tarefas.");
  }

  return (
    <div className="mt-7">
      <div className="flex max-w-xl items-center gap-2 rounded-full border border-border bg-surface/70 py-1.5 pl-4 pr-1.5 shadow-sm focus-within:border-brand/50">
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (hint) setHint("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
          }}
          placeholder="Cola o endereço de uma oferta…"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-faint"
        />
        <button
          onClick={run}
          className="shrink-0 rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200"
        >
          Avaliar
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <CostBadge kind="spend" size="xs" />
        <span className="text-xs text-faint">A avaliação usa o agente escolhido e corre neste computador.</span>
      </div>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}
