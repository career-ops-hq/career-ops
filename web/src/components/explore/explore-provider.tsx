"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_FILTERS,
  ATS_LABEL,
  filtersToParams,
  isBroadSearch,
  createOpportunitySnapshots,
  updateOpportunitySnapshot,
  switchOpportunitySnapshot,
  applyOpportunityPatch,
  type AtsSource,
  type DiscoveredOffer,
  type ExploreFilters,
  type ExploreMode,
  type OpportunitySnapshots,
  type OpportunityType,
  type ScanEvent,
  type SearchPhase,
  type SearchExpansion,
} from "@/lib/explore";
import { makeAiStreamParser, type AiTraceChunk } from "@/lib/explore-ai";
import { MAX_OFFER_LIMIT } from "@/lib/whats-new.mjs";
import { isScannerMissing } from "@/lib/explore-error.mjs";
import { applyDiscoveryOfferEvent, updateDiscoverySources, summarizeDiscoveryState, sourceLabel, type DiscoverySourceState, type DiscoverySort } from "@/lib/explore-state.mjs";

export type Phase =
  | "idle"
  | "casting"
  | "scanning"
  | "revealing"
  | "results"
  | "empty-current"
  | "empty-loose"
  | "failed"
  | "degraded" // scan completed but searched nothing (transient fetch/rate-limit) — not "all caught up"
  | "hunting" // AI search streaming
  | "blocked"; // AI search needs a CLI
export type AiCost = { searches: number; candidates: number; fetches: number };
export type SourceState = DiscoverySourceState;

type ExploreCtx = {
  filters: ExploreFilters;
  setFilters: (f: ExploreFilters) => void;
  /** Set filters from a seed/URL only if the user/assistant hasn't touched them
   *  yet — so a fresh page mount can't clobber assistant-set filters. */
  initFilters: (f: ExploreFilters, employmentSeed?: ExploreFilters) => void;
  phase: Phase;
  running: boolean;
  offers: DiscoveredOffer[];
  sources: Record<string, SourceState>;
  sort: DiscoverySort;
  setSort: (sort: DiscoverySort) => void;
  searchPhase: SearchPhase;
  expansion: SearchExpansion | null;
  matchCount: number;
  companiesScanned: number;
  companiesAvailable: number;
  capHit: boolean;
  droppedNoDate: number;
  status: string;
  partial: boolean;
  error: string;
  /** The failure was the structured "scanner absent from this checkout" 400,
   *  not a runtime scan error, so it drives the "full toolkit" panel over a retry. */
  scannerMissing: boolean;
  added: Set<string>;
  adding: Set<string>;
  discover: () => Promise<void>;
  /** Load the SUPPLY-loop offers Today's "Fresh matches this week" already
   *  fetched from /api/whats-new, straight into the results phase — no scan. */
  loadFresh: () => Promise<void>;
  addToPipeline: (offers: DiscoveredOffer[]) => Promise<number>;
  applyPatch: (raw: Record<string, unknown>, opts?: { merge?: boolean; run?: boolean }) => void;
  reset: () => void;
  // ── AI search (modes/web-search.md) ──
  mode: ExploreMode;
  setMode: (m: ExploreMode) => void;
  aiIntent: string;
  setAiIntent: (s: string) => void;
  discoverAI: () => Promise<void>;
  aiTrace: AiTraceChunk[];
  aiCost: AiCost;
};

const Ctx = createContext<ExploreCtx | null>(null);
export function useExplore(): ExploreCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useExplore must be used within <ExploreProvider>");
  return c;
}

// Explore results are expensive (a scan walks the ATS network; an AI search spends
// tokens). Persist the SETTLED result set per-tab so a reload or a mode toggle never
// throws the work away (disc#5 — "came back to explore, work is lost").
const RESULTS_KEY = "career-ops:explore-results";
const resultKey = (type: OpportunityType) => `${RESULTS_KEY}:${type}`;
type ResultSnapshot = {
  v: number;
  mode: ExploreMode;
  phase: Phase;
  offers: DiscoveredOffer[];
  matchCount: number;
  companiesScanned: number;
  companiesAvailable: number;
  capHit: boolean;
  droppedNoDate: number;
  sources: Record<string, SourceState>;
  filters: ExploreFilters;
  sort: DiscoverySort;
  searchPhase: SearchPhase;
  expansion: SearchExpansion | null;
  partial: boolean;
  status: string;
  error: string;
  scannerMissing: boolean;
  added: string[];
  aiTrace: AiTraceChunk[];
  aiCost: AiCost;
  aiIntent: string;
};

export function ExploreProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [filters, setFiltersState] = useState<ExploreFilters>(() => structuredClone(DEFAULT_FILTERS));
  const snapshotsRef = useRef<OpportunitySnapshots>(createOpportunitySnapshots(DEFAULT_FILTERS));
  const touched = useRef(false);
  const resultsRestored = useRef(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [offers, setOffers] = useState<DiscoveredOffer[]>([]);
  const [sources, setSources] = useState<Record<string, SourceState>>({});
  const [sort, setSort] = useState<DiscoverySort>("match");
  const [searchPhase, setSearchPhase] = useState<SearchPhase>("precise");
  const [expansion, setExpansion] = useState<SearchExpansion | null>(null);
  const [matchCount, setMatchCount] = useState(0);
  const [companiesScanned, setCompaniesScanned] = useState(0);
  // Authoritative scan-health signals (scanner --json mode, #1199): tell a capped /
  // degraded scan from a genuinely empty one, and power a "scanned X of Y" banner.
  const [companiesAvailable, setCompaniesAvailable] = useState(0);
  const [capHit, setCapHit] = useState(false);
  const [droppedNoDate, setDroppedNoDate] = useState(0);
  const [status, setStatus] = useState("");
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState("");
  const [scannerMissing, setScannerMissing] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [mode, setModeState] = useState<ExploreMode>("scan");
  const [aiIntent, setAiIntent] = useState("");
  const [aiTrace, setAiTrace] = useState<AiTraceChunk[]>([]);
  const [aiCost, setAiCost] = useState<AiCost>({ searches: 0, candidates: 0, fetches: 0 });
  const runningRef = useRef(false);
  const aiIntentRef = useRef(aiIntent);
  aiIntentRef.current = aiIntent;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const restoreResults = useCallback((snap: ResultSnapshot | null) => {
    const valid = snap?.v === 1 && Array.isArray(snap.offers) ? snap : null;
    setModeState(valid?.mode === "ai" ? "ai" : "scan");
    setOffers(valid?.offers ?? []);
    setMatchCount(valid ? (typeof valid.matchCount === "number" ? valid.matchCount : valid.offers.length) : 0);
    setCompaniesScanned(valid?.companiesScanned ?? 0);
    setCompaniesAvailable(valid?.companiesAvailable ?? 0);
    setCapHit(!!valid?.capHit);
    setDroppedNoDate(valid?.droppedNoDate ?? 0);
    setSources(valid?.sources ?? {});
    setSort(valid?.sort === "fresh" || valid?.sort === "company" ? valid.sort : "match");
    setSearchPhase(valid?.searchPhase === "broad" ? "broad" : "precise");
    setExpansion(valid?.expansion ?? null);
    setPartial(!!valid?.partial);
    setStatus(typeof valid?.status === "string" ? valid.status : "");
    setError(typeof valid?.error === "string" ? valid.error : "");
    setScannerMissing(!!valid?.scannerMissing);
    setAdded(new Set(Array.isArray(valid?.added) ? valid.added : []));
    setAiTrace(Array.isArray(valid?.aiTrace) ? valid.aiTrace : []);
    setAiCost(valid?.aiCost ?? { searches: 0, candidates: 0, fetches: 0 });
    setAiIntent(typeof valid?.aiIntent === "string" ? valid.aiIntent : "");
    const running = new Set<Phase>(["casting", "scanning", "revealing", "hunting"]);
    setPhase(valid ? (running.has(valid.phase) ? (valid.offers.length ? "results" : "idle") : valid.phase) : "idle");
  }, []);

  const restoreResultsFor = useCallback((type: OpportunityType) => {
    let snap: ResultSnapshot | null = null;
    try {
      snap = JSON.parse(sessionStorage.getItem(resultKey(type)) || "null") as ResultSnapshot | null;
    } catch {
      snap = null;
    }
    restoreResults(snap);
    resultsRestored.current = true;
    return snap;
  }, [restoreResults]);

  const rewriteUrl = useCallback((active: ExploreFilters, snap?: Pick<ResultSnapshot, "mode" | "aiIntent"> | null) => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(filtersToParams(active));
    sp.set("opportunity", active.opportunityType);
    if (snap?.mode === "ai") {
      sp.set("mode", "ai");
      if (snap.aiIntent) sp.set("intent", snap.aiIntent);
    }
    window.history.replaceState(null, "", `/explore?${sp}`);
  }, []);

  const setFilters = useCallback((f: ExploreFilters) => {
    touched.current = true;
    const changedType = f.opportunityType !== filtersRef.current.opportunityType;
    const state = changedType
      ? switchOpportunitySnapshot(snapshotsRef.current, filtersRef.current, f.opportunityType)
      : { snapshots: updateOpportunitySnapshot(snapshotsRef.current, f), filters: structuredClone(f) };
    snapshotsRef.current = state.snapshots;
    filtersRef.current = state.filters;
    setFiltersState(state.filters);
    if (changedType) rewriteUrl(state.filters, restoreResultsFor(state.filters.opportunityType));
  }, [restoreResultsFor, rewriteUrl]);
  const initFilters = useCallback((f: ExploreFilters, employmentSeed?: ExploreFilters) => {
    if (touched.current) return;
    snapshotsRef.current = createOpportunitySnapshots(f, employmentSeed);
    for (const type of ["employment", "freelance"] as const) {
      if (type === f.opportunityType) continue;
      try {
        const saved = JSON.parse(sessionStorage.getItem(resultKey(type)) || "null") as ResultSnapshot | null;
        if (saved?.v === 1 && saved.filters?.opportunityType === type) snapshotsRef.current = updateOpportunitySnapshot(snapshotsRef.current, saved.filters);
      } catch { /* unavailable session storage */ }
    }
    const active = structuredClone(snapshotsRef.current[f.opportunityType]);
    filtersRef.current = active;
    setFiltersState(active);
    restoreResultsFor(active.opportunityType);
  }, [restoreResultsFor]);

  const discover = useCallback(async () => {
    if (runningRef.current) return;
    const f = filtersRef.current;
    runningRef.current = true;
    setPhase("casting");
    setOffers([]);
    setMatchCount(0);
    setCompaniesScanned(0);
    setCompaniesAvailable(0);
    setCapHit(false);
    setDroppedNoDate(0);
    setPartial(false);
    setError("");
    setScannerMissing(false);
    setSort("match");
    setSearchPhase("precise");
    setExpansion(null);
    setStatus("A iniciar a pesquisa nas fontes selecionadas…");
    const init: Record<string, SourceState> = {};
    if (f.opportunityType === "employment") for (const a of f.ats) init[a] = { state: "queued" };
    setSources(init);
    if (typeof window !== "undefined") {
      const qs = filtersToParams(f);
      window.history.replaceState(null, "", `/explore${qs ? `?${qs}` : ""}`);
    }

    let acc: DiscoveredOffer[] = [];
    let sourceStates = init;
    let sawDone = false;
    let sawError = "";
    let sawScannerMissing = false; // the structured 400 (data-only checkout), not a runtime scan error
    let companiesScannedAcc = 0; // 0 at the end = the directories never downloaded → degraded, not empty
    let capHitAcc = false; // scan was capped (only a slice of the universe searched)
    let datasetIssueAcc = false; // some ATS dataset was stale/empty/unreachable
    let droppedNoDateAcc = 0; // postings dropped for lacking a publish date
    let hasSourceSummary = false;
    try {
      const r = await fetch("/api/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      // Every non-OK response is decided from the parsed body, not the status.
      // A failed response never carries a scan stream, so reading one would
      // parse a JSON error object as scan events and report "no readable
      // output" instead of the server's actual message.
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        sawScannerMissing = isScannerMissing(d);
        sawError = d.error || (sawScannerMissing ? "O módulo de pesquisa não está disponível." : `A pesquisa falhou (${r.status}).`);
      } else if (!r.body) {
        sawError = "A pesquisa não devolveu dados.";
      } else {
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let ev: ScanEvent;
            try {
              ev = JSON.parse(line) as ScanEvent;
            } catch {
              continue;
            }
            sourceStates = updateDiscoverySources(sourceStates, ev);
            setSources(sourceStates);
            switch (ev.kind) {
              case "phaseStart":
                setSearchPhase(ev.phase);
                setPhase("scanning");
                setStatus(ev.phase === "broad" ? "Pesquisa alargada · a consultar as fontes…" : "Pesquisa precisa · a consultar as fontes…");
                break;
              case "expansion": {
                const { kind: _kind, ...receipt } = ev;
                setExpansion(receipt);
                break;
              }
              case "sourceStart":
                setPhase("scanning");
                setStatus(`A consultar ${sourceLabel(ev.source)}`);
                break;
              case "atsStart":
                setPhase("scanning");
                setStatus(`A consultar ${ATS_LABEL[ev.ats as AtsSource] ?? ev.ats} · ${ev.companies.toLocaleString("pt-PT")} empresas`);
                break;
              case "progress":
                // `matches` is the engine's running total. Live `offer` events
                // (stderr JSON in --json mode) populate the card list; this
                // number still drives the hero counter.
                setMatchCount((m) => Math.max(m, ev.matches));
                break;
              case "offer":
                acc = applyDiscoveryOfferEvent(acc, ev);
                setOffers(acc);
                setMatchCount((m) => Math.max(m, acc.length));
                break;
              case "done":
                sawDone = true;
                acc = applyDiscoveryOfferEvent(acc, ev);
                setOffers(acc);
                setMatchCount(acc.length);
                break;
              case "summary": {
                hasSourceSummary = !!ev.sources;
                companiesScannedAcc = ev.companiesScanned;
                setCompaniesScanned(ev.companiesScanned);
                if (typeof ev.companiesAvailable === "number") setCompaniesAvailable(ev.companiesAvailable);
                if (ev.capHit) {
                  capHitAcc = true;
                  setCapHit(true);
                }
                const datasetIssue =
                  (ev.datasetStatus ? Object.values(ev.datasetStatus).some((s) => s !== "ok") : false) ||
                  (ev.incomplete?.length ?? 0) > 0;
                if (datasetIssue) datasetIssueAcc = true;
                if (typeof ev.postingsDroppedNoDate === "number" && ev.postingsDroppedNoDate > 0) {
                  droppedNoDateAcc = ev.postingsDroppedNoDate;
                  setDroppedNoDate(ev.postingsDroppedNoDate);
                }
                if (ev.status === "partial") setPartial(true);
                if (ev.unreachable > 0 || datasetIssue) setPartial(true);
                break;
              }
              case "error":
                sawError = ev.message;
                break;
              default:
                break;
            }
          }
        }
      }
    } catch (e) {
      sawError = e instanceof Error ? e.message : "Erro durante a receção dos resultados.";
    }

    if (!sawDone && !sawError) sawError = "A pesquisa terminou sem confirmar os resultados.";
    if (sawError) sourceStates = updateDiscoverySources(sourceStates, { kind: "error", message: sawError });
    setSources(sourceStates);
    const outcome = summarizeDiscoveryState(sourceStates, acc.length);
    const incomplete = outcome === "partial" || outcome === "all-failed" || !!sawError || capHitAcc || datasetIssueAcc || droppedNoDateAcc > 0;
    setPartial(incomplete);

    runningRef.current = false;
    if (acc.length > 0) {
      // A scan that ended in an error still keeps what it found (a legacy scan
      // stopped at the deadline, or every --json source stopped): mark it partial
      // and keep the reason, which ResultsList shows beside the results.
      if (sawError) {
        setPartial(true);
        setError(sawError);
      }
      else if (outcome === "all-failed") setError("Nenhuma fonte confirmou a conclusão da pesquisa. As ofertas recebidas podem estar incompletas.");
      setMatchCount(acc.length);
      setPhase("revealing");
      setStatus(`${incomplete ? "Resultados parciais · " : ""}${acc.length} ${acc.length === 1 ? "oferta encontrada" : "ofertas encontradas"}`);
      window.setTimeout(() => setPhase("results"), 850);
    } else if (sawError || outcome === "all-failed") {
      setError(sawError || "Nenhuma fonte selecionada devolveu um resultado válido.");
      setScannerMissing(sawScannerMissing);
      setPhase("failed");
    } else if (incomplete || (!hasSourceSummary && companiesScannedAcc === 0)) {
      // Maintainer's RULE (#1199): it is NOT "all caught up" if the scan was capped,
      // a dataset was stale/unreachable, postings were dropped for missing a date, OR
      // nothing was searched at all (legacy 0-companies fallback when --json is absent).
      // Truly-empty is only when live datasets were fully searched and found nothing.
      setPhase("degraded");
    } else {
      setPhase(isBroadSearch(f) ? "empty-current" : "empty-loose");
    }
  }, []);

  // Today's "See all N" link (#84) routes here with ?view=fresh instead of leaving
  // the user on a bare config form. Re-fetch the same free, zero-token /api/whats-new
  // history the dashboard already reads and drop it straight into the results phase
  // — no scan, so it never touches sources/companiesScanned like discover() does.
  const loadFresh = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setPhase("casting");
    setStatus("A carregar ofertas recentes…");
    setOffers([]);
    setMatchCount(0);
    setCompaniesScanned(0);
    setCompaniesAvailable(0);
    setCapHit(false);
    setDroppedNoDate(0);
    setPartial(false);
    setSources({});
    setSort("fresh");
    setSearchPhase("precise");
    setExpansion(null);
    setError("");
    try {
      // A finite ceiling, not `all`: explorer-view renders every offer it gets,
      // so an unbounded list would be an unbounded DOM. `count` below stays the
      // complete total, which is what the header actually reports.
      const r = await fetch(`/api/whats-new?limit=${MAX_OFFER_LIMIT}`);
      if (!r.ok) {
        setError(`Não foi possível carregar as ofertas recentes (${r.status}).`);
        setPhase("failed");
        return;
      }
      const d = await r.json().catch(() => null);
      if (!d || !Array.isArray(d.offers)) {
        setError("Não foi possível carregar as ofertas recentes: resposta inesperada.");
        setPhase("failed");
        return;
      }
      const list: DiscoveredOffer[] = d.offers;
      setOffers(list);
      const count = Number(d.count);
      setMatchCount(Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : list.length);
      setPhase(list.length > 0 ? "results" : "empty-current");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar as ofertas recentes.");
      setPhase("failed");
    } finally {
      runningRef.current = false;
    }
  }, []);

  const addToPipeline = useCallback(async (list: DiscoveredOffer[]) => {
    const fresh = list.filter((o) => !added.has(o.url));
    if (fresh.length === 0) return 0;
    setAdding((s) => new Set([...s, ...fresh.map((o) => o.url)]));
    try {
      const r = await fetch("/api/explore/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offers: fresh }),
      });
      const d = (await r.json().catch(() => ({}))) as { added?: number; error?: string };
      if (!r.ok || d.error) {
        setError(`Não foi possível adicionar à pipeline${d.error ? `: ${d.error}` : ` (${r.status})`}.`);
        return 0;
      }
      if (d.added && d.added > 0) {
        setAdded((s) => new Set([...s, ...fresh.map((o) => o.url)]));
        // The new inbox rows were written server-side. Invalidate the Next router
        // cache so the (server-rendered) Pipeline view shows them instead of a stale
        // snapshot, and ping live listeners (today's dashboard, pipeline provider) —
        // otherwise the user adds a job, opens Pipeline, and sees it empty (disc#5).
        router.refresh();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("co-job-done", { detail: { kind: "explore-add" } }));
        }
      }
      return d.added ?? 0;
    } catch (e) {
      setError(`Não foi possível adicionar à pipeline${e instanceof Error && e.message ? `: ${e.message}` : ""}.`);
      return 0;
    } finally {
      setAdding((s) => {
        const next = new Set(s);
        for (const o of fresh) next.delete(o.url);
        return next;
      });
    }
  }, [added, router]);

  const applyPatch = useCallback((raw: Record<string, unknown>, opts?: { merge?: boolean; run?: boolean }) => {
    const previousType = filtersRef.current.opportunityType;
    const state = applyOpportunityPatch(snapshotsRef.current, filtersRef.current, raw, opts?.merge ?? false);
    touched.current = true;
    snapshotsRef.current = state.snapshots;
    filtersRef.current = state.filters;
    setFiltersState(state.filters);
    if (state.filters.opportunityType !== previousType) rewriteUrl(state.filters, restoreResultsFor(state.filters.opportunityType));
    if (opts?.run) void discover();
  }, [discover, restoreResultsFor, rewriteUrl]);

  const reset = useCallback(() => {
    runningRef.current = false;
    restoreResults(null);
    try {
      sessionStorage.removeItem(RESULTS_KEY);
      sessionStorage.removeItem(resultKey(filtersRef.current.opportunityType));
    } catch {
      /* ignore */
    }
  }, [restoreResults]);

  // AI search — orchestrate modes/web-search.md via the user's CLI, streamed.
  const discoverAI = useCallback(async () => {
    if (runningRef.current) return;
    const opportunityType = filtersRef.current.opportunityType;
    const intent = aiIntentRef.current.trim();
    if (!intent) return;
    let cliId: string | null = null;
    try {
      cliId = JSON.parse(localStorage.getItem("career-ops:config") || "{}").cliId || null;
    } catch {
      cliId = null;
    }
    if (!cliId) {
      setPhase("blocked");
      return;
    }
    runningRef.current = true;
    setPhase("casting");
    setOffers([]);
    setMatchCount(0);
    setAiTrace([]);
    setAiCost({ searches: 0, candidates: 0, fetches: 0 });
    setError("");
    setPartial(false);
    setScannerMissing(false);
    setStatus("A iniciar a pesquisa na web pública…");
    rewriteUrl(filtersRef.current, { mode: "ai", aiIntent: intent });

    let knownUrls = new Set<string>();
    try {
      const k = await fetch("/api/explore/ai/known").then((r) => r.json());
      knownUrls = new Set<string>(Array.isArray(k.urls) ? k.urls : []);
    } catch {
      /* best-effort dedup */
    }
    const parser = makeAiStreamParser({ knownUrls });

    const acc: DiscoveredOffer[] = [];
    let sawError = "";
    let terminalSeen = false;
    let sawScannerMissing = false; // the structured 400 (capability absent from this checkout), not a runtime error
    const handle = (chunks: AiTraceChunk[]) => {
      for (const ch of chunks) {
        if (ch.kind === "offer") {
          const offer = { ...ch.offer, opportunityType };
          acc.push(offer);
          setOffers((o) => [...o, offer]);
          setMatchCount(acc.length);
          setAiCost((c) => ({ ...c, candidates: acc.length }));
          setPhase("hunting");
        } else if (ch.kind === "terminal") {
          terminalSeen = true;
          sawError = ch.status === "success" ? "" : ch.message || "A pesquisa assistida não terminou normalmente.";
        } else {
          setAiTrace((t) => [...t, ch]);
          if (ch.kind === "narration") {
            const s = (ch.text.match(/\bsearch(ing|ed)?\b/gi) || []).length;
            const f = (ch.text.match(/\bfetch(ing|ed)?\b/gi) || []).length;
            if (s || f) setAiCost((c) => ({ ...c, searches: c.searches + s, fetches: c.fetches + f }));
            setPhase((p) => (p === "casting" ? "hunting" : p));
          }
        }
      }
    };

    try {
      const r = await fetch("/api/explore/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: intent, cliId }),
      });
      if (r.status === 404) {
        runningRef.current = false;
        setPhase("blocked");
        return;
      }
      // Same rule as the scan path, and this is the call site the status-based
      // check actually broke: /api/explore/ai returns three different 400s
      // (malformed JSON, missing parameters, MODE_MISSING), and all three were
      // reported as "this checkout has no scanner". MODE_MISSING carries its own
      // copy about AI search, which the scanner panel overwrote.
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        sawScannerMissing = isScannerMissing(d);
        sawError = d.error || (sawScannerMissing ? "A pesquisa assistida não está disponível." : `A pesquisa assistida falhou (${r.status}).`);
      } else if (!r.body) {
        sawError = "A pesquisa não devolveu dados.";
      } else {
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          handle(parser.feed(dec.decode(value, { stream: true })));
        }
        handle(parser.flush());
        if (!terminalSeen) sawError = "A pesquisa assistida terminou sem confirmar os resultados.";
      }
    } catch (e) {
      sawError = e instanceof Error ? e.message : "Erro durante a receção dos resultados.";
    }

    runningRef.current = false;
    if (sawError) {
      setError(sawError);
      setPartial(acc.length > 0);
    }
    if (acc.length > 0) {
      setMatchCount(acc.length);
      setPhase("revealing");
      setStatus(`${acc.length} ${acc.length === 1 ? "oferta encontrada" : "ofertas encontradas"}.`);
      window.setTimeout(() => setPhase("results"), 850);
    } else if (sawError) {
      setError(sawError);
      setScannerMissing(sawScannerMissing);
      setPhase("failed");
    } else {
      setPhase("empty-loose");
    }
  }, [rewriteUrl]);

  // Switch surface but PRESERVE the current results + filters — toggling scan↔AI must
  // not throw away a completed search (disc#5). A new search (discover/discoverAI)
  // clears + repopulates; an explicit reset() clears. Just stop any half-run.
  const setMode = useCallback((m: ExploreMode) => {
    runningRef.current = false;
    setModeState(m);
  }, []);

  // Rehydrate the last settled result set on mount (per-tab sessionStorage), unless a
  // search is already running. Done in an effect (not a useState initializer) to avoid
  // an SSR hydration mismatch.
  useEffect(() => {
    // The child's initFilters can restore first; its explicit URL mode/intent win.
    if (runningRef.current || resultsRestored.current) return;
    restoreResultsFor(filtersRef.current.opportunityType);
  }, [restoreResultsFor]);

  // Persist only SETTLED states (never mid-stream) so a reload restores a complete set.
  useEffect(() => {
    const SETTLED = new Set<Phase>(["results", "empty-current", "empty-loose", "failed", "degraded", "blocked"]);
    if (!SETTLED.has(phase)) return;
    try {
      const snap: ResultSnapshot = {
        v: 1, mode, phase, offers, matchCount, companiesScanned, companiesAvailable, capHit, droppedNoDate, sources,
        filters, sort, searchPhase, expansion,
        partial, status, error, scannerMissing, added: [...added], aiTrace, aiCost, aiIntent,
      };
      sessionStorage.setItem(resultKey(filters.opportunityType), JSON.stringify(snap));
    } catch {
      /* sessionStorage full/unavailable — non-fatal */
    }
  }, [filters, sort, searchPhase, expansion, phase, mode, offers, matchCount, companiesScanned, companiesAvailable, capHit, droppedNoDate, sources, partial, status, error, scannerMissing, added, aiTrace, aiCost, aiIntent]);

  const value = useMemo(
    () => ({
      filters, setFilters, initFilters, phase,
      running: phase === "casting" || phase === "scanning" || phase === "revealing" || phase === "hunting",
      offers, sources, sort, setSort, searchPhase, expansion, matchCount, companiesScanned, companiesAvailable, capHit, droppedNoDate, status, partial, error, scannerMissing, added, adding,
      discover, loadFresh, addToPipeline, applyPatch, reset,
      mode, setMode, aiIntent, setAiIntent, discoverAI, aiTrace, aiCost,
    }),
    [filters, setFilters, initFilters, phase, offers, sources, sort, searchPhase, expansion, matchCount, companiesScanned, companiesAvailable, capHit, droppedNoDate, status, partial, error, scannerMissing, added, adding, discover, loadFresh, addToPipeline, applyPatch, reset, mode, setMode, aiIntent, setAiIntent, discoverAI, aiTrace, aiCost],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
