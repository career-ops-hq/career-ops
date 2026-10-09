"use client";

import { useMemo, useState } from "react";
import { Search, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DiscoveredOffer } from "@/lib/explore";
import { CostBadge } from "@/components/cost/cost-badge";
import { DiscoveryCard } from "./discovery-card";
import { useExplore } from "./explore-provider";
import { discoverySourceReasons, summarizeDiscoveryState, sortDiscoveryOffers, type DiscoverySort } from "@/lib/explore-state.mjs";

export type EnrichedOffer = DiscoveredOffer & { inPipeline: boolean; evaluatedN?: string };

export function ResultsList({ offers }: { offers: EnrichedOffer[] }) {
  const { companiesScanned, sources, partial, error, addToPipeline, added, mode, running, sort: directSort, setSort: setDirectSort } = useExplore();
  const isAi = mode === "ai";
  const outcome = summarizeDiscoveryState(sources, offers.length);
  const sourceReasons = discoverySourceReasons(sources);
  const [aiSort, setAiSort] = useState<"fresh" | "company">("fresh");
  const sort = isAi ? aiSort : directSort;
  const setSort = (next: DiscoverySort) => isAi ? setAiSort(next === "company" ? "company" : "fresh") : setDirectSort(next);
  const [q, setQ] = useState("");

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = offers;
    if (needle) list = list.filter((o) => o.title.toLowerCase().includes(needle) || o.company.toLowerCase().includes(needle));
    return isAi ? [...list].sort((a, b) => sort === "fresh" ? (b.postedAt || "").localeCompare(a.postedAt || "") : a.company.localeCompare(b.company)) : sortDiscoveryOffers(list, sort);
  }, [offers, q, sort, isAi]);

  const addable = offers.filter((o) => !o.inPipeline && !o.evaluatedN && !added.has(o.url));
  const freelance = offers.length > 0 && offers.every((offer) => offer.opportunityType === "freelance");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-sm text-foreground">
            <span className="font-semibold">{offers.length}</span> {offers.length === 1 ? "oferta" : "ofertas"}
            <CostBadge kind={isAi ? "spend" : "free-network"} size="xs" className="ml-2 align-middle" />
          </p>
          <p className="text-[12px] text-faint">
            {isAi
              ? "encontradas na web pública · disponibilidade por confirmar até à avaliação"
              : `${companiesScanned > 0 ? `${companiesScanned.toLocaleString("pt-PT")} empresas pesquisadas · ` : ""}0 tokens usados`}
          </p>
          {!isAi && !running && partial && <p className="text-[12px] text-amber-700 dark:text-amber-300">{outcome === "all-failed" ? "Nenhuma fonte concluiu a pesquisa" : "Resultados parciais"}</p>}
          {!isAi && !running && sourceReasons.map(reason => <p key={reason} className="text-[12px] text-amber-700 dark:text-amber-300">{reason}</p>)}
          {error && <p className="text-[12px] text-amber-700 dark:text-amber-300">{error}</p>}
        </div>

        <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border bg-surface/40 px-2.5 py-1.5 focus-within:border-brand">
            <Search className="size-3.5 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filtrar resultados…"
              aria-label="Filtrar resultados"
              className="w-32 bg-transparent text-[13px] outline-none placeholder:text-faint"
            />
          </div>
          <div className="inline-flex rounded-lg border border-border bg-surface/40 p-0.5 text-xs">
            {(isAi ? ["fresh", "company"] as const : ["match", "fresh", "company"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSort(s)}
                aria-pressed={sort === s}
                className={cn("min-h-[44px] min-w-[44px] rounded-md px-2.5 py-1 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand", sort === s ? "bg-brand-soft text-foreground underline underline-offset-4" : "text-muted hover:text-foreground")}
              >
                {s === "match" ? "Proximidade" : s === "fresh" ? "Recentes" : "Empresa"}
              </button>
            ))}
          </div>
          {addable.length > 1 && (
            <button
              type="button"
              onClick={() => addToPipeline(addable)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border bg-surface/40 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-brand-soft hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <Plus className="size-3.5" /> {freelance ? "Guardar todas" : "Adicionar todas"} ({addable.length})
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {view.map((o) => (
          <DiscoveryCard key={o.url} offer={o} inPipeline={o.inPipeline} evaluatedN={o.evaluatedN} />
        ))}
      </div>

      {view.length === 0 && (q.trim() || !running) && (
        <p className="py-10 text-center text-sm text-faint">Nenhum resultado corresponde a «{q}».</p>
      )}
    </div>
  );
}
