"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Plus, Check, Loader2, ShieldQuestion, Coins } from "lucide-react";
import { cn } from "@/lib/cn";
import { instrumentSerif } from "@/lib/fonts";
import { type DiscoveredOffer } from "@/lib/explore";
import { offerProvenance } from "@/lib/explore-state.mjs";
import { useJobs } from "@/components/jobs/job-store";
import { useExplore } from "./explore-provider";

function freshness(postedAt: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(postedAt)) return "";
  const days = Math.max(0, Math.round((Date.now() - new Date(postedAt + "T00:00:00Z").getTime()) / 86_400_000));
  return days === 0 ? "hoje" : days === 1 ? "ontem" : `há ${days} d`;
}

// Real company logo (favicon) via the localhost proxy, cached on disk FOREVER per
// company — so once it resolves it's instant for this card AND every other card,
// this search or any future one. Falls back to a monogram on miss.
function Logo({ company }: { company: string }) {
  const [failed, setFailed] = useState(false);
  const letter = (company || "?").trim().charAt(0).toUpperCase();
  if (failed || !company.trim()) {
    return <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-sm font-semibold text-brand">{letter}</div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/logo?company=${encodeURIComponent(company)}`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-9 shrink-0 rounded-lg border border-border bg-surface object-contain p-1"
    />
  );
}

// What a running worker is doing on this exact posting → the live CTA label.
const WORKER_LABEL: Record<string, string> = { evaluate: "A avaliar…", pdf: "A preparar o CV…", research: "A pesquisar…", apply: "A preencher…" };
const FIT_LABEL = { strong: "forte", related: "relacionado", weak: "baixo" } as const;

export function DiscoveryCard({ offer, inPipeline, evaluatedN }: { offer: DiscoveredOffer; inPipeline: boolean; evaluatedN?: string }) {
  const { added, adding, addToPipeline } = useExplore();
  const { jobs, startJob } = useJobs();

  // GLOBAL worker awareness: any worker acting on this URL drives the CTA, here
  // and on every other surface that renders this offer (the jobs store is global).
  const job = useMemo(
    () => jobs.filter((j) => j.input === offer.url).sort((a, b) => b.startedAt - a.startedAt)[0],
    [jobs, offer.url],
  );
  const working = job?.status === "running";
  const doneEval = job?.status === "done" && job.kind === "evaluate";
  const workerLabel = WORKER_LABEL[job?.kind ?? ""] ?? "Em curso…";

  const isAdded = added.has(offer.url) || inPipeline || working || doneEval;
  const isAdding = adding.has(offer.url);
  const unverified = offer.verification === "unconfirmed";
  const freelance = offer.opportunityType === "freelance";
  const fresh = freshness(offer.postedAt) || "Data não indicada";
  const provenance = offerProvenance(offer);
  const match = offer.match;
  const band = match ? match.total >= 85 ? "Muito próxima" : match.total >= 65 ? "Próxima" : "Possível" : "";
  const salary = [offer.salary?.min, offer.salary?.max].filter((value) => typeof value === "number").map((value) => value!.toLocaleString("pt-PT")).join("–");
  const facts = [
    salary ? `Salário: ${salary}${offer.salary?.currency ? ` ${offer.salary.currency}` : ""}${offer.salary?.period ? ` / ${offer.salary.period}` : ""}` : "",
    offer.contractType?.trim() ? `Contrato: ${offer.contractType}` : "",
    offer.hours?.trim() ? `Horário: ${offer.hours}` : "",
    offer.applicationDeadline ? `Prazo: ${offer.applicationDeadline}` : "",
    typeof offer.vacancyCount === "number" ? `Vagas: ${offer.vacancyCount}` : "",
  ].filter(Boolean);

  const evaluate = () => {
    addToPipeline([offer]); // evaluating implies it's in the pipeline — record it
    startJob({ title: `Avaliar · ${offer.company}`, subtitle: offer.title, kind: "evaluate", input: offer.url, page: "/explore" });
  };

  return (
    <div className="co-rise group flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-surface/40 p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-sm">
      <div className="flex items-start gap-3">
        <Logo company={offer.company} />
        <a href={offer.url} target="_blank" rel="noopener noreferrer" className="block min-w-0 flex-1 max-sm:min-h-[44px]">
          <h3 className={`${instrumentSerif.className} truncate text-[17px] leading-tight text-foreground transition-colors group-hover:text-brand`}>{offer.title}</h3>
          <p className="mt-0.5 truncate text-[13px] text-muted">
            {offer.company}
            {offer.location && <span className="text-faint"> · {offer.location}</span>}
          </p>
        </a>
        <a
          href={offer.url}
          target="_blank"
          rel="noopener noreferrer"
          title="Abrir a oferta"
          aria-label="Abrir a oferta"
          className="-m-1 inline-flex shrink-0 items-center justify-center rounded p-1 text-faint transition-colors hover:text-foreground max-sm:min-h-[44px] max-sm:min-w-[44px]"
        >
          <ExternalLink className="size-4" />
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-muted">{fresh}</span>
        {match && <span role="note" className="rounded border border-brand/25 bg-brand-soft px-1.5 py-0.5 font-medium text-foreground" title={`Proximidade aos critérios: ${match.total}/100`} aria-label={`${band}. Proximidade aos critérios: ${match.total}/100`}>{band}</span>}
        {freelance && (
          <span className="rounded border border-brand/25 bg-brand-soft px-1.5 py-0.5 font-medium text-brand">Freelance</span>
        )}
        {unverified && (
          <span
            className="inline-flex items-center gap-1 rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 font-medium text-foreground"
            title={freelance ? "Encontrada na web pública. Abre a página para confirmar se a oportunidade continua disponível." : "Encontrada na web pública. A avaliação abre a página para confirmar se a oferta continua disponível."}
          >
            <ShieldQuestion className="size-3" /> por confirmar
          </span>
        )}
        {offer.matchedKeyword && (
          <span className="text-faint" title={freelance ? "Correspondência por palavra-chave no título." : "Correspondência por palavra-chave. Ainda não foi avaliada de A a F."}>
            · corresponde a <span className="text-brand-text">{offer.matchedKeyword}</span>
          </span>
        )}
        {offer.fit && !match && (
          <span
            className={cn(
              "rounded border px-1 py-0.5 text-[11px] font-medium",
              offer.fit.band === "strong"
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "text-faint",
            )}
            title={freelance ? "Estimativa por palavras-chave entre o título e as funções do perfil." : "Estimativa por palavras-chave entre o título e as funções do perfil. A avaliação de A a F é feita separadamente."}
          >
            · correspondência {FIT_LABEL[offer.fit.band]}
          </span>
        )}
      </div>

      <p className="text-[12px] leading-snug text-muted">{provenance.origins.length === 1 ? "Origem" : "Origens"}: {provenance.origins.join(" · ") || "Não indicada"}</p>
      {provenance.eligibilityUnknown && <p className="text-[12px] leading-snug text-muted">Países elegíveis não indicados</p>}
      {match?.reasons.filter(reason => reason.trim()).slice(0, 2).map(reason => <p key={reason} className="text-[12px] leading-snug text-muted">{reason}</p>)}
      {facts.length > 0 && <p className="text-[12px] leading-snug text-muted">{facts.join(" · ")}</p>}

      {offer.why && (
        <p className="text-[12px] leading-snug text-brand/80">{offer.why}</p>
      )}

      <div className="mt-0.5">
        {freelance ? (
          <button
            type="button"
            disabled={isAdded || isAdding}
            onClick={() => addToPipeline([offer])}
            className={cn(
              "inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-2 text-xs font-medium transition-colors max-sm:min-h-[44px]",
              isAdded ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-surface-hover text-foreground hover:bg-brand-soft hover:text-brand",
            )}
          >
            {isAdding ? <Loader2 className="size-3.5 animate-spin" /> : isAdded ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
            {isAdded ? "Oportunidade guardada" : "Guardar oportunidade"}
          </button>
        ) : evaluatedN || doneEval ? (
          <a
            href={evaluatedN ? `/pipeline/${evaluatedN}` : job ? `/jobs/${job.id}` : "/pipeline"}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-brand-soft px-2.5 py-2 text-xs font-medium text-brand max-sm:min-h-[44px]"
          >
            <Check className="size-3.5" /> Avaliada · ver relatório
          </a>
        ) : working ? (
          <div className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-brand/30 bg-brand-soft/60 px-2.5 py-2 text-xs font-medium text-brand">
            <Loader2 className="size-3.5 animate-spin" />
            {workerLabel}
            <span className="text-brand/60">· nas candidaturas</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isAdded || isAdding}
              onClick={() => addToPipeline([offer])}
              className={cn(
                "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-2 text-xs font-medium transition-colors max-sm:min-h-[44px]",
                isAdded ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-surface-hover text-foreground hover:bg-brand-soft hover:text-brand",
              )}
            >
              {isAdding ? <Loader2 className="size-3.5 animate-spin" /> : isAdded ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
              {isAdded ? "Adicionada" : "Adicionar"}
            </button>
            <button
              type="button"
              onClick={evaluate}
              title={unverified ? "Avalia de A a F e confirma se a oferta está disponível. Usa tokens." : "Faz uma avaliação de A a F. Usa tokens."}
              className="inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-brand/30 px-2.5 py-2 text-xs font-medium text-foreground transition-colors hover:bg-brand-soft max-sm:min-h-[44px]"
            >
              Avaliar <Coins className="size-3.5 opacity-80" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
