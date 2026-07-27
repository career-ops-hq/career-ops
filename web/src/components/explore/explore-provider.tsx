"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_FILTERS,
  ATS_LABEL,
  filtersToParams,
  aiToParams,
  isBroadSearch,
  parseExplorePatch,
  type AtsSource,
  type DiscoveredOffer,
  type ExploreFilters,
  type ExploreMode,
  type ScanEvent,
} from "@/lib/explore";
import { makeAiStreamParser, type AiTraceChunk } from "@/lib/explore-ai";

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
export type SourceState = {
  state: "queued" | "active" | "swept" | "noisy";
  companies?: number;
  done?: number;
  total?: number;
  matches?: number;
  unreachable?: number;
};

type ExploreCtx = {
  filters: ExploreFilters;
  setFilters: (f: ExploreFilters) => void;
  /** Set filters from a seed/URL only if the user/assistant hasn't touched them
   *  yet — so a fresh page mount can't clobber assistant-set filters. */
  initFilters: (f: ExploreFilters) => void;
  phase: Phase;
  running: boolean;
  offers: DiscoveredOffer[];
  sources: Partial<Record<AtsSource, SourceState>>;
  matchCount: number;
  companiesScanned: number;
  companiesAvailable: number;
  capHit: boolean;
  droppedNoDate: number;
  status: string;
  partial: boolean;
  error: string;
  added: Set<string>;
  adding: Set<string>;
  discover: () => Promise<void>;
  addToPipeline: (offers: DiscoveredOffer[]) => Promise<number>;
  applyPatch: (raw: Record<string, unknown>, opts?: { merge?: boolean; run?: boolean }) => void;
  reset: () => void;
  // ── AI search (modes/discover.md) ──
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
  sources: Partial<Record<AtsSource, SourceState>>;
  partial: boolean;
  status: string;
  error: string;
  added: string[];
  aiTrace: AiTraceChunk[];
  aiCost: AiCost;
  aiIntent: string;
};

export function ExploreProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [filters, setFiltersState] = useState<ExploreFilters>({ ...DEFAULT_FILTERS, ats: [...DEFAULT_FILTERS.ats] });
  const touched = useRef(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [offers, setOffers] = useState<DiscoveredOffer[]>([]);
  const [sources, setSources] = useState<Partial<Record<AtsSource, SourceState>>>({});
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

  const setFilters = useCallback((f: ExploreFilters) => {
    touched.current = true;
    filtersRef.current = f;
    setFiltersState(f);
  }, []);
  const initFilters = useCallback((f: ExploreFilters) => {
    if (touched.current) return;
    filtersRef.current = f;
    setFiltersState(f);
  }, []);

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
    setStatus("Casting the net across the ATS network…");
    const init: Partial<Record<AtsSource, SourceState>> = {};
    for (const a of f.ats) init[a] = { state: "queued" };
    setSources(init);
    if (typeof window !== "undefined") {
      const qs = filtersToParams(f);
      window.history.replaceState(null, "", `/explore${qs ? `?${qs}` : ""}`);
    }

    const acc: DiscoveredOffer[] = [];
    let sawError = "";
    let companiesScannedAcc = 0; // 0 at the end = the directories never downloaded → degraded, not empty
    let capHitAcc = false; // scan was capped (only a slice of the universe searched)
    let datasetIssueAcc = false; // some ATS dataset was stale/empty/unreachable
    let droppedNoDateAcc = 0; // postings dropped for lacking a publish date
    try {
      const r = await fetch("/api/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      if (r.status === 400) {
        const d = await r.json().catch(() => ({}));
        sawError = d.error || "The scanner isn't available.";
      } else if (!r.body) {
        sawError = "No response stream.";
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
            switch (ev.kind) {
              case "atsStart":
                setPhase("scanning");
                setStatus(`Walking ${ATS_LABEL[ev.ats as AtsSource] ?? ev.ats} — ${ev.companies.toLocaleString()} companies`);
                setSources((s) => ({ ...s, [ev.ats]: { ...s[ev.ats as AtsSource], state: "active", companies: ev.companies } }));
                break;
              case "progress":
                // `matches` is the GLOBAL running total (the engine batches the
                // offer list to the very end), so it drives the live hero counter.
                setMatchCount((m) => Math.max(m, ev.matches));
                setSources((s) => ({ ...s, [ev.ats]: { ...s[ev.ats as AtsSource], state: "active", done: ev.scanned, total: ev.total } }));
                break;
              case "atsDone":
                setSources((s) => ({ ...s, [ev.ats]: { ...s[ev.ats as AtsSource], state: ev.unreachable > 0 ? "noisy" : "swept", unreachable: ev.unreachable } }));
                break;
              case "offer":
                acc.push(ev.offer);
                setOffers((o) => [...o, ev.offer]);
                break;
              case "summary": {
                companiesScannedAcc = ev.companiesScanned;
                setCompaniesScanned(ev.companiesScanned);
                if (typeof ev.companiesAvailable === "number") setCompaniesAvailable(ev.companiesAvailable);
                if (ev.capHit) {
                  capHitAcc = true;
                  setCapHit(true);
                }
                const datasetIssue = ev.datasetStatus ? Object.values(ev.datasetStatus).some((s) => s !== "ok") : false;
                if (datasetIssue) datasetIssueAcc = true;
                if (typeof ev.postingsDroppedNoDate === "number" && ev.postingsDroppedNoDate > 0) {
                  droppedNoDateAcc = ev.postingsDroppedNoDate;
                  setDroppedNoDate(ev.postingsDroppedNoDate);
                }
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
      sawError = e instanceof Error ? e.message : "stream error";
    }

    // Mark any still-active sources as swept (stream ended).
    setSources((s) => {
      const next = { ...s };
      for (const k of Object.keys(next) as AtsSource[]) if (next[k]?.state === "active" || next[k]?.state === "queued") next[k] = { ...next[k]!, state: "swept" };
      return next;
    });

    runningRef.current = false;
    if (acc.length > 0) {
      setMatchCount(acc.length);
      setPhase("revealing");
      setStatus(`${acc.length} fresh role${acc.length === 1 ? "" : "s"} found — free.`);
      window.setTimeout(() => setPhase("results"), 850);
    } else if (sawError) {
      setError(sawError);
      setPhase("failed");
    } else if (capHitAcc || datasetIssueAcc || droppedNoDateAcc > 0 || companiesScannedAcc === 0) {
      // Maintainer's RULE (#1199): it is NOT "all caught up" if the scan was capped,
      // a dataset was stale/unreachable, postings were dropped for missing a date, OR
      // nothing was searched at all (legacy 0-companies fallback when --json is absent).
      // Truly-empty is only when live datasets were fully searched and found nothing.
      setPhase("degraded");
    } else {
      setPhase(isBroadSearch(f) ? "empty-current" : "empty-loose");
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
      const d = (await r.json()) as { added?: number };
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
    } catch {
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
    const next = parseExplorePatch(raw, filtersRef.current, opts?.merge ?? false);
    setFilters(next);
    filtersRef.current = next;
    if (opts?.run) void discover();
  }, [discover]);

  const reset = useCallback(() => {
    runningRef.current = false;
    setPhase("idle");
    setOffers([]);
    setSources({});
    setMatchCount(0);
    setCompaniesScanned(0);
    setStatus("");
    setPartial(false);
    setError("");
    setAiTrace([]);
    setAiCost({ searches: 0, candidates: 0, fetches: 0 });
    try {
      sessionStorage.removeItem(RESULTS_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // AI search — orchestrate modes/discover.md via the user's CLI, streamed.
  const discoverAI = useCallback(async () => {
    if (runningRef.current) return;
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
    setStatus("Casting across the open web…");
    if (typeof window !== "undefined") window.history.replaceState(null, "", `/explore?${aiToParams(intent)}`);

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
    const handle = (chunks: AiTraceChunk[]) => {
      for (const ch of chunks) {
        if (ch.kind === "offer") {
          acc.push(ch.offer);
          setOffers((o) => [...o, ch.offer]);
          setMatchCount(acc.length);
          setAiCost((c) => ({ ...c, candidates: acc.length }));
          setPhase("hunting");
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
      if (r.status === 400) {
        const d = await r.json().catch(() => ({}));
        sawError = d.error || "AI search isn't available.";
      } else if (!r.body) {
        sawError = "No response stream.";
      } else {
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          handle(parser.feed(dec.decode(value, { stream: true })));
        }
        handle(parser.flush());
      }
    } catch (e) {
      sawError = e instanceof Error ? e.message : "stream error";
    }

    runningRef.current = false;
    if (acc.length > 0) {
      setMatchCount(acc.length);
      setPhase("revealing");
      setStatus(`${acc.length} candidate${acc.length === 1 ? "" : "s"} found.`);
      window.setTimeout(() => setPhase("results"), 850);
    } else if (sawError) {
      setError(sawError);
      setPhase("failed");
    } else {
      setPhase("empty-loose");
    }
  }, []);

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
    if (runningRef.current) return;
    let snap: ResultSnapshot | null = null;
    try {
      snap = JSON.parse(sessionStorage.getItem(RESULTS_KEY) || "null") as ResultSnapshot | null;
    } catch {
      snap = null;
    }
    if (!snap || snap.v !== 1 || !Array.isArray(snap.offers)) return;
    setModeState(snap.mode === "ai" ? "ai" : "scan");
    setOffers(snap.offers);
    setMatchCount(typeof snap.matchCount === "number" ? snap.matchCount : snap.offers.length);
    setCompaniesScanned(snap.companiesScanned ?? 0);
    setCompaniesAvailable(snap.companiesAvailable ?? 0);
    setCapHit(!!snap.capHit);
    setDroppedNoDate(snap.droppedNoDate ?? 0);
    setSources(snap.sources ?? {});
    setPartial(!!snap.partial);
    setStatus(typeof snap.status === "string" ? snap.status : "");
    setError(typeof snap.error === "string" ? snap.error : "");
    setAdded(new Set(Array.isArray(snap.added) ? snap.added : []));
    setAiTrace(Array.isArray(snap.aiTrace) ? snap.aiTrace : []);
    setAiCost(snap.aiCost ?? { searches: 0, candidates: 0, fetches: 0 });
    if (typeof snap.aiIntent === "string") setAiIntent(snap.aiIntent);
    // Never rehydrate INTO a running phase — no live stream backs it.
    const RUNNING = new Set<Phase>(["casting", "scanning", "revealing", "hunting"]);
    setPhase(RUNNING.has(snap.phase) ? (snap.offers.length ? "results" : "idle") : snap.phase);
  }, []);

  // Persist only SETTLED states (never mid-stream) so a reload restores a complete set.
  useEffect(() => {
    const SETTLED = new Set<Phase>(["results", "empty-current", "empty-loose", "failed", "degraded", "blocked"]);
    if (!SETTLED.has(phase)) return;
    try {
      const snap: ResultSnapshot = {
        v: 1, mode, phase, offers, matchCount, companiesScanned, companiesAvailable, capHit, droppedNoDate, sources,
        partial, status, error, added: [...added], aiTrace, aiCost, aiIntent,
      };
      sessionStorage.setItem(RESULTS_KEY, JSON.stringify(snap));
    } catch {
      /* sessionStorage full/unavailable — non-fatal */
    }
  }, [phase, mode, offers, matchCount, companiesScanned, companiesAvailable, capHit, droppedNoDate, sources, partial, status, error, added, aiTrace, aiCost, aiIntent]);

  const value = useMemo(
    () => ({
      filters, setFilters, initFilters, phase,
      running: phase === "casting" || phase === "scanning" || phase === "revealing" || phase === "hunting",
      offers, sources, matchCount, companiesScanned, companiesAvailable, capHit, droppedNoDate, status, partial, error, added, adding,
      discover, addToPipeline, applyPatch, reset,
      mode, setMode, aiIntent, setAiIntent, discoverAI, aiTrace, aiCost,
    }),
    [filters, setFilters, initFilters, phase, offers, sources, matchCount, companiesScanned, companiesAvailable, capHit, droppedNoDate, status, partial, error, added, adding, discover, addToPipeline, applyPatch, reset, mode, setMode, aiIntent, discoverAI, aiTrace, aiCost],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
