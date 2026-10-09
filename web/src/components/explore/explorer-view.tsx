"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Compass, ChevronDown, RotateCcw, AlertTriangle, Settings } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { instrumentSerif } from "@/lib/fonts";
import type { Application, InboxJob } from "@/lib/career-ops";
import { normalizeTextKey } from "@/lib/core/normalize-text-key.mjs";
import { paramsToFilters, paramsToAi, filtersToAssistedIntent, type ExploreFilters } from "@/lib/explore";
import { FilterBuilder } from "./filter-builder";
import { DiscoveringState, SearchReceipt } from "./discovering-state";
import { AiHuntView } from "./ai-hunt-view";
import { ExploreModeToggle } from "./explore-mode-toggle";
import { AiSearchBox } from "./ai-search-box";
import { ResultsList, type EnrichedOffer } from "./results-list";
import { useExplore } from "./explore-provider";
import { ScheduleJobAction } from "./schedule-job-action";
import { PT_PT_LOCALE } from "@/lib/pt-pt";
import { canDiscover as hasDiscoverySelection, discoverySourceReasons } from "@/lib/explore-state.mjs";

// Same shape as core normalizeTextKey(s, " ") — never [^a-z0-9] (#2666).
const norm = (s: string) => normalizeTextKey(s, " ");
const CLI_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  copilot: "Copilot CLI",
  qwen: "Qwen CLI",
  antigravity: "Antigravity CLI",
  cursor: "Cursor Agent",
  hermes: "Hermes Agent",
};

export function ExplorerView({
  seed,
  inboxSnapshot,
  appsSnapshot,
  rootExists,
}: {
  seed: { filters: ExploreFilters; seededFrom: string[] };
  inboxSnapshot: InboxJob[];
  appsSnapshot: Application[];
  rootExists: boolean;
}) {
  const { filters, setFilters, initFilters, phase, running, offers, sources, discover, loadFresh, status, error, scannerMissing, mode, setMode, aiIntent, setAiIntent, discoverAI, companiesScanned, companiesAvailable, capHit, droppedNoDate, partial } = useExplore();
  const scanNote =
    companiesScanned > 0
      ? `Foram pesquisadas ${companiesScanned.toLocaleString(PT_PT_LOCALE)}${companiesAvailable > companiesScanned ? ` de ${companiesAvailable.toLocaleString(PT_PT_LOCALE)}` : ""} ${companiesScanned === 1 ? "empresa" : "empresas"}${partial ? "; a cobertura ficou incompleta" : ""}.`
      : undefined;
  const inited = useRef(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [cli, setCli] = useState<{ id: string | null; name?: string }>({ id: null });
  const [firstRun, setFirstRun] = useState(false);

  useEffect(() => {
    try {
      const id = JSON.parse(localStorage.getItem("career-ops:config") || "{}").cliId || null;
      setCli({ id, name: id ? CLI_NAMES[id] || id : undefined });
    } catch {
      setCli({ id: null });
    }
  }, []);

  // Initialize once from the URL (shareable search) or the server seed — without
  // clobbering anything the assistant set before this mount.
  useEffect(() => {
    if (inited.current) return;
    inited.current = true;
    const sp = new URLSearchParams(window.location.search);
    const ai = paramsToAi(sp);
    if (ai !== null) {
      const active = paramsToFilters(sp);
      initFilters(active, active.opportunityType === "freelance" ? seed.filters : undefined);
      setMode("ai");
      setAiIntent(ai);
    } else if (sp.get("view") === "fresh") {
      // Today's "See all N" (#84) hands off here instead of a bare config form —
      // load the SAME /api/whats-new offers it already showed, through the normal
      // results-phase UI. The config form (Refine search / Re-cast) stays reachable.
      initFilters(seed.filters);
      // Apply explicit direct-search intent after restoring the type's snapshot.
      setMode("scan");
      setAiIntent("");
      void loadFresh();
    } else {
      const active = sp.toString() ? paramsToFilters(sp) : seed.filters;
      initFilters(active, active.opportunityType === "freelance" ? seed.filters : undefined);
      if (sp.get("mode") === "scan" || ["q", "not", "loc", "noloc", "hardno", "home", "since", "ats", "markets", "opportunity", "limit", "run"].some(key => sp.has(key))) {
        setMode("scan");
        setAiIntent("");
      }
      // Onboarding hand-off: ?run=1 auto-fires the free scan + flags the first-run
      // banner (the "matches found from your CV, free" reveal).
      if (sp.get("run") === "1") {
        setFirstRun(true);
        void discover();
      }
    }
  }, [seed.filters, initFilters, setMode, setAiIntent, discover, loadFresh]);

  const inboxUrls = useMemo(() => new Set(inboxSnapshot.map((j) => j.url)), [inboxSnapshot]);
  const enriched: EnrichedOffer[] = useMemo(
    () =>
      offers.map((o) => {
        const inPipeline = inboxUrls.has(o.url);
        const c = norm(o.company);
        const t = norm(o.title);
        const ev = appsSnapshot.find((a) => {
          if (norm(a.company) !== c) return false;
          const ar = norm(a.role);
          return ar.length > 3 && (t.includes(ar) || ar.includes(t.split(" ").slice(0, 3).join(" ")));
        });
        return { ...o, inPipeline, evaluatedN: ev?.n };
      }),
    [offers, inboxUrls, appsSnapshot],
  );

  const isAi = mode === "ai";
  const isResults = phase === "results";
  const canDiscover = hasDiscoverySelection(filters);
  const scanRunning = running && !isAi;
  // Keep one ResultsList mounted across scanning → revealing → results so
  // filter/sort/scroll and co-rise survive the 850ms reveal handoff.
  const showScanList = !isAi && offers.length > 0 && (scanRunning || isResults);
  const prepareAssisted = () => {
    setAiIntent(filtersToAssistedIntent(filters));
    setMode("ai");
  };

  if (running && isAi) return <AiHuntView cliName={cli.name} />;

  return (
    <div className={scanRunning ? undefined : "mx-auto max-w-5xl px-5 py-8 md:px-8"}>
      {scanRunning && <DiscoveringState />}
      {!scanRunning && (
        <>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <Compass className="size-6 text-brand" />
            <h1 className={`${instrumentSerif.className} text-3xl text-foreground`}>Procurar ofertas</h1>
          </div>
          <div className="w-full sm:ml-auto sm:w-auto">
            <ExploreModeToggle mode={mode} onChange={setMode} cliConfigured={!!cli.id} />
          </div>
        </div>
        {!isResults && (
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">
            {isAi
              ? "Descreve a função, a localização e as condições. O agente procura na web pública; a disponibilidade é confirmada durante a avaliação."
              : filters.opportunityType === "freelance"
                ? "Pesquisa oportunidades freelance públicas no Welcome to the Jungle, com os mercados selecionados. Esta pesquisa não usa tokens."
                : "Pesquisa ofertas públicas nas plataformas ATS e nos mercados selecionados. Esta pesquisa não usa tokens."}
          </p>
        )}
      </header>

      {!rootExists && (
        <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          A pasta principal do career-ops ainda não está configurada. A pesquisa precisa de um perfil para definir os critérios.
        </div>
      )}

      {isAi ? (
        phase === "blocked" ? (
          <BlockedCard />
        ) : (
          <div className="space-y-6">
            <AiSearchBox
              intent={aiIntent}
              onIntent={setAiIntent}
              onSubmit={() => void discoverAI()}
              cliConfigured={!!cli.id}
              cliName={cli.name}
              onRunScan={() => setMode("scan")}
            />
            {phase === "results" && <ResultsList offers={enriched} />}
            {phase === "empty-loose" && (
              <EmptyState
                tone="loose"
                title="Não foram encontradas ofertas públicas"
                body="Alarga os critérios ou usa a pesquisa direta nas plataformas de recrutamento."
                onRerun={() => setMode("scan")}
                rerunLabel="Usar a pesquisa direta"
              />
            )}
            {phase === "failed" && <FailedCard msg={error || status} scannerMissing={scannerMissing} onRetry={() => void discoverAI()} />}
          </div>
        )
      ) : (
        <>
          {isResults ? (
            <div className="mb-6 rounded-xl border border-border bg-surface/30">
              <button type="button" onClick={() => setRefineOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-foreground">
                <Compass className="size-4 text-brand" /> Alterar pesquisa
                <ChevronDown className={cn("ml-auto size-4 text-muted transition-transform", refineOpen && "rotate-180")} />
              </button>
              {refineOpen && (
                <div className="space-y-4 border-t border-border p-4">
                  <FilterBuilder filters={filters} onChange={setFilters} seededFrom={seed.seededFrom} />
                  <DiscoverBar canDiscover={canDiscover} onDiscover={discover} label="Pesquisar de novo" filters={filters} />
                </div>
              )}
            </div>
          ) : (
            <div className="mb-6 rounded-2xl border border-border bg-surface/30 p-5">
              <FilterBuilder filters={filters} onChange={setFilters} seededFrom={seed.seededFrom} />
              <div className="mt-5">
                <DiscoverBar canDiscover={canDiscover} onDiscover={discover} label="Pesquisar" filters={filters} />
              </div>
            </div>
          )}

          {isResults && firstRun && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              <p className="text-[13px] leading-relaxed text-foreground">
                Estas oportunidades correspondem aos critérios do teu perfil. <span className="text-emerald-700 dark:text-emerald-400">A pesquisa não usou tokens.</span>{filters.opportunityType === "employment" ? " Avalia uma oferta para veres a compatibilidade de A a F." : " Podes guardar as que quiseres acompanhar."}
              </p>
            </div>
          )}

          {isResults && capHit && (
            <CappedBanner companiesScanned={companiesScanned} companiesAvailable={companiesAvailable} onRefine={() => setRefineOpen(true)} />
          )}
        </>
      )}
      </>
      )}

      {showScanList && (
        <div className={scanRunning ? "relative z-[1] mx-auto max-w-5xl px-5 pb-10 md:px-8" : undefined}>
          <ResultsList offers={enriched} />
        </div>
      )}

      {!scanRunning && !isAi && (
        <>
          <SearchReceipt />
          {phase === "empty-current" && (
            <EmptyState
              tone="good"
              title="Não foram encontradas ofertas"
              body="As fontes consultadas não devolveram ofertas que correspondam aos filtros."
              note={scanNote}
              onRerun={() => {
                setFilters({ ...filters, sinceDays: Math.max(filters.sinceDays, 30) });
                void discover();
              }}
              rerunLabel="Pesquisar nos últimos 30 dias"
              onPrepareAssisted={prepareAssisted}
            />
          )}
          {phase === "empty-loose" && (
            <EmptyState
              tone="loose"
              title="Não foram encontradas ofertas recentes"
              body="Alarga o período e retira os filtros de localização para repetir a pesquisa."
              note={scanNote}
              onRerun={() => {
                setFilters({ ...filters, sinceDays: 30, block: [], allow: [] });
                void discover();
              }}
              rerunLabel="Pesquisar 30 dias · limpar localização"
              onPrepareAssisted={prepareAssisted}
            />
          )}
          {phase === "degraded" && (
            <DegradedCard
              onRetry={() => void discover()}
              companiesScanned={companiesScanned}
              companiesAvailable={companiesAvailable}
              capHit={capHit}
              droppedNoDate={droppedNoDate}
              partial={partial}
              sourceReasons={discoverySourceReasons(sources)}
            />
          )}
          {phase === "failed" && <FailedCard msg={error || status} scannerMissing={scannerMissing} onRetry={() => void discover()} />}
        </>
      )}
    </div>
  );
}

function DiscoverBar({ canDiscover, onDiscover, label, filters }: { canDiscover: boolean; onDiscover: () => void; label: string; filters: ExploreFilters }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={!canDiscover}
        onClick={onDiscover}
        className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground shadow-sm transition-all hover:brightness-110 disabled:opacity-50 max-sm:min-h-[44px]"
      >
        <Compass className="size-4" /> {label}
      </button>
      <ScheduleJobAction filters={filters} />
      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        {filters.opportunityType === "freelance" ? "A pesquisa e a gravação não usam tokens." : "A pesquisa não usa tokens. A avaliação de uma oferta usa o agente escolhido."}
      </span>
    </div>
  );
}

function EmptyState({ tone, title, body, note, onRerun, rerunLabel, onPrepareAssisted }: { tone: "good" | "loose"; title: string; body: string; note?: string; onRerun: () => void; rerunLabel: string; onPrepareAssisted?: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-surface/30 px-6 py-12 text-center">
      <h2 className={`${instrumentSerif.className} text-2xl text-foreground`}>{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">{body}</p>
      {note && <p className="mx-auto mt-1 max-w-md text-[12px] text-faint">{note}</p>}
      <button onClick={onRerun} className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface/50 px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:border-brand/40 hover:text-brand">
        <RotateCcw className="size-4" /> {rerunLabel}
      </button>
      {onPrepareAssisted && (
        <div className="mt-2">
          <button type="button" onClick={onPrepareAssisted} className="min-h-11 px-3.5 text-sm font-medium text-brand hover:underline">
            Preparar pesquisa assistida
          </button>
        </div>
      )}
    </div>
  );
}

function DegradedCard({
  onRetry,
  companiesScanned,
  companiesAvailable,
  capHit,
  droppedNoDate,
  partial,
  sourceReasons,
}: {
  onRetry: () => void;
  companiesScanned: number;
  companiesAvailable: number;
  capHit: boolean;
  droppedNoDate: number;
  partial: boolean;
  sourceReasons: string[];
}) {
  // 0 results, but the scan was NOT a clean full search → never "all caught up".
  // Pick the most informative reason (authoritative when the scanner's --json mode
  // is available; otherwise the 0-companies fallback).
  let title = "A pesquisa ficou incompleta";
  let body =
    "Algumas fontes ou ofertas ficaram por consultar. Revê os motivos e repete a pesquisa.";
  if (companiesScanned > 0 && capHit) {
    title = "Não houve resultados no conjunto pesquisado";
    body = `A pesquisa ficou limitada a ${companiesScanned.toLocaleString(PT_PT_LOCALE)}${companiesAvailable > companiesScanned ? ` de ${companiesAvailable.toLocaleString(PT_PT_LOCALE)}` : ""} empresas. Aumenta o alcance ou restringe as funções antes de repetir.`;
  } else if (companiesScanned > 0 && droppedNoDate > 0) {
    title = "Algumas ofertas não tinham data de publicação";
    body = `${droppedNoDate.toLocaleString(PT_PT_LOCALE)} ${droppedNoDate === 1 ? "oferta correspondia" : "ofertas correspondiam"} aos critérios, mas ${droppedNoDate === 1 ? "não tinha" : "não tinham"} uma data clara. Alarga o período para procurar alternativas com data.`;
  } else if (companiesScanned > 0 && partial) {
    body = `Foram pesquisadas ${companiesScanned.toLocaleString(PT_PT_LOCALE)} empresas. A cobertura das fontes ficou incompleta.`;
  }
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-center">
      <AlertTriangle className="mx-auto size-6 text-amber-500" />
      <p className="mt-2 text-sm font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">{body}</p>
      {sourceReasons.map(reason => <p key={reason} className="mx-auto mt-1 max-w-md text-[13px] text-amber-800 dark:text-amber-300">{reason}</p>)}
      <button onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-brand-soft px-3 py-1.5 text-sm font-medium text-foreground dark:text-brand">
        <RotateCcw className="size-4" /> Repetir pesquisa
      </button>
    </div>
  );
}

function CappedBanner({ companiesScanned, companiesAvailable, onRefine }: { companiesScanned: number; companiesAvailable: number; onRefine: () => void }) {
  // Results ARE present, but the scan was capped — tell the user there's more, so a
  // partial list never reads as "everything there is".
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-2.5 text-[13px]">
      <span className="text-foreground">
        A pesquisa foi limitada a {companiesScanned.toLocaleString(PT_PT_LOCALE)}
        {companiesAvailable > companiesScanned ? ` de ${companiesAvailable.toLocaleString(PT_PT_LOCALE)}` : ""} empresas.
      </span>
      <button onClick={onRefine} className="font-medium text-brand hover:underline">
        Aumentar o alcance
      </button>
    </div>
  );
}

function FailedCard({ msg, scannerMissing, onRetry }: { msg: string; scannerMissing: boolean; onRetry: () => void }) {
  // The scanner-missing case (data-only / pre-scan-ats-full checkout) must NOT
  // offer a "Try again" that re-fails forever — give a real next step instead.
  // The caller decides this from the response body's SCANNER_MISSING code, never
  // from the error text and never from the bare 400: a runtime scan error ("The
  // scanner returned no readable output.") mentions the scanner too, and 400 is
  // a shared channel that also carries malformed-request and MODE_MISSING
  // failures. Neither may be misreported as a broken checkout.
  if (scannerMissing) {
    return (
      <div className="rounded-2xl border border-border bg-surface/30 px-6 py-10 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-brand-soft text-brand">
          <Compass className="size-6" />
        </div>
        <h2 className={`${instrumentSerif.className} mt-4 text-2xl text-foreground`}>Falta instalar o módulo de pesquisa</h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
          Esta instalação contém apenas os dados ou usa uma versão anterior. Atualiza o career-ops ou cola o endereço de uma oferta nas candidaturas para a avaliar diretamente.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href="/pipeline" className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-brand-foreground transition hover:brightness-110">
            Ver candidaturas
          </Link>
          <Link href="/config" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground transition hover:border-brand/40 hover:text-brand">
            Abrir Definições
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-center">
      <AlertTriangle className="mx-auto size-6 text-amber-500" />
      <p className="mt-2 text-sm font-medium text-foreground">Não foi possível concluir a pesquisa</p>
      <p className="mt-1 text-[13px] text-muted">{msg}</p>
      <button onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-brand-soft px-3 py-1.5 text-sm font-medium text-brand">
        <RotateCcw className="size-4" /> Tentar de novo
      </button>
    </div>
  );
}

function BlockedCard() {
  return (
    <div className="rounded-2xl border border-border bg-surface/30 px-6 py-12 text-center">
      <h2 className={`${instrumentSerif.className} text-2xl text-foreground`}>Escolhe um agente para pesquisar na web</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
        Podes usar Claude Code, Codex, Gemini, Cursor ou outro agente instalado. A pesquisa direta continua disponível sem agente.
      </p>
      <Link href="/config" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-brand-foreground transition hover:brightness-110">
        <Settings className="size-4" /> Abrir Definições
      </Link>
    </div>
  );
}
