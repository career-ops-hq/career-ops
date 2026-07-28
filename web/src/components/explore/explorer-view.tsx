"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Compass, ChevronDown, RotateCcw, AlertTriangle, Sparkles, Settings } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { instrumentSerif } from "@/lib/fonts";
import type { Application, InboxJob } from "@/lib/career-ops";
import { paramsToFilters, paramsToAi, type ExploreFilters } from "@/lib/explore";
import { FilterBuilder } from "./filter-builder";
import { DiscoveringState } from "./discovering-state";
import { AiHuntView } from "./ai-hunt-view";
import { ExploreModeToggle } from "./explore-mode-toggle";
import { AiSearchBox } from "./ai-search-box";
import { ResultsList, type EnrichedOffer } from "./results-list";
import { useExplore } from "./explore-provider";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const CLI_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  copilot: "Copilot CLI",
  qwen: "Qwen CLI",
  antigravity: "Antigravity CLI",
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
  const { filters, setFilters, initFilters, phase, running, offers, discover, status, error, mode, setMode, aiIntent, setAiIntent, discoverAI, companiesScanned, companiesAvailable, capHit, droppedNoDate, partial } = useExplore();
  const scanNote =
    companiesScanned > 0
      ? `Scanned ${companiesScanned.toLocaleString()}${companiesAvailable > companiesScanned ? ` of ${companiesAvailable.toLocaleString()}` : ""} compan${companiesScanned === 1 ? "y" : "ies"}${partial ? " · some sources were unreachable" : ""}.`
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
      setMode("ai");
      setAiIntent(ai);
    } else {
      initFilters(sp.toString() ? paramsToFilters(sp) : seed.filters);
      // Onboarding hand-off: ?run=1 auto-fires the free scan + flags the first-run
      // banner (the "matches found from your CV, free" reveal).
      if (sp.get("run") === "1") {
        setFirstRun(true);
        void discover();
      }
    }
  }, [seed.filters, initFilters, setMode, setAiIntent, discover]);

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
  if (running) return isAi ? <AiHuntView cliName={cli.name} /> : <DiscoveringState />;

  const canDiscover = filters.ats.length > 0;
  const isResults = phase === "results";

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <Compass className="size-6 text-brand" />
            <h1 className={`${instrumentSerif.className} text-3xl text-foreground`}>Explore</h1>
            <span className="rounded-full border border-brand/30 bg-brand-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-text">New</span>
          </div>
          <div className="w-full sm:ml-auto sm:w-auto">
            <ExploreModeToggle mode={mode} onChange={setMode} cliConfigured={!!cli.id} />
          </div>
        </div>
        {!isResults && (
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">
            {isAi
              ? "Describe the role in plain language — an AI hunts the open web for it, on your own AI. Candidates are unverified until you evaluate."
              : "Scan the public ATS network — Greenhouse, Lever, Ashby, Workday. Fresh postings matched to you, zero tokens. You only spend when you choose to evaluate one."}
          </p>
        )}
      </header>

      {!rootExists && (
        <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          Your career-ops home isn’t set up yet — discovery needs a checkout with a profile to seed from.
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
                title="No public matches — yet."
                body="AI search reads what's public. Try broader intent, or run the free Scan over the ATS network."
                onRerun={() => setMode("scan")}
                rerunLabel="Run the free Scan"
              />
            )}
            {phase === "failed" && <FailedCard msg={error || status} onRetry={() => void discoverAI()} />}
          </div>
        )
      ) : (
        <>
          {isResults ? (
            <div className="mb-6 rounded-xl border border-border bg-surface/30">
              <button type="button" onClick={() => setRefineOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-foreground">
                <Compass className="size-4 text-brand" /> Refine search
                <ChevronDown className={cn("ml-auto size-4 text-muted transition-transform", refineOpen && "rotate-180")} />
              </button>
              {refineOpen && (
                <div className="space-y-4 border-t border-border p-4">
                  <FilterBuilder filters={filters} onChange={setFilters} seededFrom={seed.seededFrom} />
                  <DiscoverBar canDiscover={canDiscover} onDiscover={discover} label="Re-cast (free)" />
                </div>
              )}
            </div>
          ) : (
            <div className="mb-6 rounded-2xl border border-border bg-surface/30 p-5">
              <FilterBuilder filters={filters} onChange={setFilters} seededFrom={seed.seededFrom} />
              <div className="mt-5">
                <DiscoverBar canDiscover={canDiscover} onDiscover={discover} label="Discover (free)" />
              </div>
            </div>
          )}

          {isResults && firstRun && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              <p className="text-[13px] leading-relaxed text-foreground">
                These are live roles that match your CV. <span className="text-emerald-600 dark:text-emerald-400">Nothing here cost you a token.</span> Pick the one you&apos;re most curious about — Evaluate it and I&apos;ll tell you exactly how you score, and why.
              </p>
            </div>
          )}

          {isResults && capHit && (
            <CappedBanner companiesScanned={companiesScanned} companiesAvailable={companiesAvailable} onRefine={() => setRefineOpen(true)} />
          )}
          {isResults && <ResultsList offers={enriched} />}

          {phase === "empty-current" && (
            <EmptyState
              tone="good"
              title="You're all caught up."
              body="Nothing new since your last scan. Your pipeline is current — that's the goal."
              note={scanNote}
              onRerun={() => {
                setFilters({ ...filters, sinceDays: Math.max(filters.sinceDays, 30) });
                void discover();
              }}
              rerunLabel="Look back 30 days"
            />
          )}
          {phase === "empty-loose" && (
            <EmptyState
              tone="loose"
              title="No fresh matches — yet."
              body="Discovery is free — loosen and re-cast as often as you want."
              note={scanNote}
              onRerun={() => {
                setFilters({ ...filters, sinceDays: 30, block: [], allow: [] });
                void discover();
              }}
              rerunLabel="Widen to 30 days · clear location"
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
            />
          )}
          {phase === "failed" && <FailedCard msg={error || status} onRetry={() => void discover()} />}
        </>
      )}
    </div>
  );
}

function DiscoverBar({ canDiscover, onDiscover, label }: { canDiscover: boolean; onDiscover: () => void; label: string }) {
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
      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        Evaluating a role later costs tokens. Discovering never does.
      </span>
    </div>
  );
}

function EmptyState({ tone, title, body, note, onRerun, rerunLabel }: { tone: "good" | "loose"; title: string; body: string; note?: string; onRerun: () => void; rerunLabel: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface/30 px-6 py-12 text-center">
      <div className={cn("mx-auto grid size-12 place-items-center rounded-full", tone === "good" ? "bg-emerald-500/12 text-emerald-500" : "bg-brand-soft text-brand")}>
        <Sparkles className="size-6" />
      </div>
      <h2 className={`${instrumentSerif.className} mt-4 text-2xl text-foreground`}>{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">{body}</p>
      {note && <p className="mx-auto mt-1 max-w-md text-[12px] text-faint">{note}</p>}
      <button onClick={onRerun} className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface/50 px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:border-brand/40 hover:text-brand">
        <RotateCcw className="size-4" /> {rerunLabel}
      </button>
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
}: {
  onRetry: () => void;
  companiesScanned: number;
  companiesAvailable: number;
  capHit: boolean;
  droppedNoDate: number;
  partial: boolean;
}) {
  // 0 results, but the scan was NOT a clean full search → never "all caught up".
  // Pick the most informative reason (authoritative when the scanner's --json mode
  // is available; otherwise the 0-companies fallback).
  let title = "The scan ran, but couldn’t reach any sources.";
  let body =
    "The public ATS directories didn’t respond — usually a transient network hiccup or rate-limit, so nothing could be searched. This isn’t “all caught up”; a retry in a moment usually clears it.";
  if (companiesScanned > 0 && capHit) {
    title = "No matches in the slice we searched.";
    body = `The scan is capped, so it only searched ${companiesScanned.toLocaleString()}${companiesAvailable > companiesScanned ? ` of ${companiesAvailable.toLocaleString()}` : ""} companies — not the whole network. Raise scan depth (Refine search) or narrow your roles, then re-cast to look deeper.`;
  } else if (companiesScanned > 0 && droppedNoDate > 0) {
    title = "Fresh-looking roles were skipped for missing dates.";
    body = `${droppedNoDate.toLocaleString()} posting${droppedNoDate === 1 ? "" : "s"} matched but had no clear publish date, so the freshness filter dropped them. Widening the time window often brings dated equivalents back.`;
  } else if (companiesScanned > 0 && partial) {
    title = "Some job boards were unreachable.";
    body = `The scan searched ${companiesScanned.toLocaleString()} companies, but one or more sources didn’t respond — so this is a partial result, not “all caught up”. A retry usually clears it.`;
  }
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-center">
      <AlertTriangle className="mx-auto size-6 text-amber-500" />
      <p className="mt-2 text-sm font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">{body}</p>
      <button onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-brand-soft px-3 py-1.5 text-sm font-medium text-brand">
        <RotateCcw className="size-4" /> Retry the scan
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
        Showing a capped slice — searched {companiesScanned.toLocaleString()}
        {companiesAvailable > companiesScanned ? ` of ${companiesAvailable.toLocaleString()}` : ""} companies.
      </span>
      <button onClick={onRefine} className="font-medium text-brand hover:underline">
        Raise scan depth to search deeper
      </button>
    </div>
  );
}

function FailedCard({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  // The scanner-missing 400 (data-only / pre-scan-ats-full checkout) must NOT
  // offer a "Try again" that re-fails forever — give a real next step instead.
  const scannerMissing = /isn'?t available|data only|complete career-ops checkout|scanner/i.test(msg);
  if (scannerMissing) {
    return (
      <div className="rounded-2xl border border-border bg-surface/30 px-6 py-10 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-brand-soft text-brand">
          <Compass className="size-6" />
        </div>
        <h2 className={`${instrumentSerif.className} mt-4 text-2xl text-foreground`}>Discovery needs the full toolkit</h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
          Your career-ops home looks data-only or is on an older version. The free scanner ships with a complete checkout —
          update career-ops, or paste a job URL on the pipeline to evaluate it directly.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href="/pipeline" className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-brand-foreground transition hover:brightness-110">
            Open pipeline
          </Link>
          <Link href="/config" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground transition hover:border-brand/40 hover:text-brand">
            Open Config
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-center">
      <AlertTriangle className="mx-auto size-6 text-amber-500" />
      <p className="mt-2 text-sm font-medium text-foreground">Couldn’t finish the search.</p>
      <p className="mt-1 text-[13px] text-muted">{msg}</p>
      <button onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-brand-soft px-3 py-1.5 text-sm font-medium text-brand">
        <RotateCcw className="size-4" /> Try again
      </button>
    </div>
  );
}

function BlockedCard() {
  return (
    <div className="rounded-2xl border border-border bg-surface/30 px-6 py-12 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-brand-soft text-brand">
        <Sparkles className="size-6" />
      </div>
      <h2 className={`${instrumentSerif.className} mt-4 text-2xl text-foreground`}>AI search needs a CLI</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
        Connect Claude Code, Gemini, or any agent CLI — your key, your tokens, your machine. The free Scan stays available without one.
      </p>
      <Link href="/config" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-brand-foreground transition hover:brightness-110">
        <Settings className="size-4" /> Open Config
      </Link>
    </div>
  );
}
