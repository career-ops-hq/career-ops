"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Radar, Wrench } from "lucide-react";
import { CompanyLogo } from "@/components/company-logo";
import { useJobs, type Job } from "@/components/jobs/job-store";
import { cn } from "@/lib/cn";

type Company = { name: string; status: string; detail: string };
type Result = { available: boolean; configured: boolean; companies: Company[] };

const TONE: Record<string, { dot: string; label: string; chip: string }> = {
  live: { dot: "bg-emerald-500", label: "ativo", chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  empty: { dot: "bg-amber-500", label: "ativo · vazio", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  broken: { dot: "bg-red-500", label: "com erro", chip: "bg-red-500/15 text-red-700 dark:text-red-400" },
  skipped: { dot: "bg-zinc-400", label: "sem ATS", chip: "bg-surface-hover text-muted" },
};
const ORDER: Record<string, number> = { broken: 0, empty: 1, live: 2, skipped: 3 };

export function PortalsView() {
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const { jobs, startJob } = useJobs();

  // map the agentic "fix-portal" workers to the company they're repairing
  const fixByCompany = useMemo(() => {
    const m = new Map<string, (typeof jobs)[number]>();
    for (const j of jobs) {
      if (j.kind !== "fix-portal" || !j.input) continue;
      const ex = m.get(j.input);
      if (!ex || j.startedAt > ex.startedAt) m.set(j.input, j);
    }
    return m;
  }, [jobs]);

  function check() {
    setLoading(true);
    fetch("/api/portals/verify")
      .then((r) => r.json())
      .then(setRes)
      .catch(() => setRes({ available: false, configured: false, companies: [] }))
      .finally(() => setLoading(false));
  }

  const companies = res?.companies ?? [];
  const broken = companies.filter((c) => c.status === "broken");
  const liveN = companies.filter((c) => c.status === "live" || c.status === "empty").length;
  const sorted = [...companies].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          onClick={check}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50 max-sm:min-h-[44px]"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />}
          Verificar portais
        </button>
        {loading && <span className="text-xs text-faint">A verificar os portais… (cerca de 30 a 60 segundos)</span>}
      </div>

      {res && !res.available && (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
          Não foi encontrado <code className="text-foreground">verify-portals.mjs</code>. Esta função requer uma cópia
          completa do career-ops.
        </p>
      )}
      {res && res.available && !res.configured && (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
          Ainda não existe <code className="text-foreground">portals.yml</code>. Adiciona as empresas no ficheiro ou pede ao assistente.
        </p>
      )}

      {res && res.configured && (
        <div className="mt-5">
          <p className="text-sm text-muted">
            <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{liveN}</span> ativos ·{" "}
            <span className="tabular-nums text-red-600 dark:text-red-400">{broken.length}</span> com erro ·{" "}
            <span className="tabular-nums">{companies.length}</span> acompanhados
          </p>
          {broken.length > 0 && (
            <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm">
              <span className="font-medium text-red-700 dark:text-red-400">
                {broken.length === 1 ? "1 empresa fica fora das pesquisas" : `${broken.length} empresas ficam fora das pesquisas`}
              </span>{" "}
              <span className="text-muted">
                porque a ligação de carreiras deixou de funcionar. Corrige <code>careers_url</code> em <code>portals.yml</code>
                ou pede ao assistente.
              </span>
            </div>
          )}
          <ul className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface/40">
            {sorted.map((c) => {
              const t = TONE[c.status] ?? TONE.skipped;
              return (
                <li key={c.name} className="flex items-center gap-3 px-4 py-2.5">
                  <CompanyLogo name={c.name} size={20} />
                  <span className={cn("size-1.5 shrink-0 rounded-full", t.dot)} />
                  <span className="shrink-0 text-sm font-medium">{c.name}</span>
                  <span className="truncate font-mono text-xs text-faint">{c.detail}</span>
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    {c.status === "broken" && <FixAffordance company={c.name} job={fixByCompany.get(c.name)} onFix={() => startJob({ title: `Corrigir · ${c.name}`, subtitle: "corrigir o endereço do portal", kind: "fix-portal", input: c.name, page: "/portals" })} />}
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", t.chip)}>{t.label}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function FixAffordance({ company, job, onFix }: { company: string; job?: Job; onFix: () => void }) {
  if (job?.status === "running")
    return (
      <Link href={`/jobs/${job.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand">
        <Loader2 className="size-3 animate-spin" /> A corrigir…
      </Link>
    );
  if (job?.status === "done")
    return (
      <Link href={`/jobs/${job.id}`} className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
        corrigido · verificar
      </Link>
    );
  return (
    <button
      onClick={onFix}
      title={`Pedir ao agente para corrigir o portal de ${company}`}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-brand/40 hover:text-brand"
    >
      <Wrench className="size-3" /> Corrigir
    </button>
  );
}
