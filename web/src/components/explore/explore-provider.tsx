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
  type DiscoverySource,
  type EmployerScanOutcome,
  type DiscoveredOffer,
  type ExploreFilters,
  type ExploreMode,
  type ScanEvent,
} from "@/lib/explore";
import { CHINA_PRESET, EMPLOYER_LABEL, employerRequest } from "@/lib/employer-preset.mjs";
import { makeAiStreamParser, type AiTraceChunk } from "@/lib/explore-ai";
import { MAX_OFFER_LIMIT } from "@/lib/whats-new.mjs";
import { isAbortError, isScannerMissing } from "@/lib/explore-error.mjs";
import { postNdjsonXhr } from "@/lib/post-ndjson-xhr.mjs";
import { settledExploreUrl } from "@/lib/explore-url.mjs";
import { createRunOwner } from "@/lib/explore-run.mjs";

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
  sources: Partial<Record<DiscoverySource, SourceState>>;
  matchCount: number;
  companiesScanned: number;
  companiesAvailable: number;
  capHit: boolean;
  droppedNoDate: number;
  status: string;
  employerOutcome: EmployerScanOutcome | null;
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
  sources: Partial<Record<DiscoverySource, SourceState>>;
  partial: boolean;
  status: string;
  error: string;
  scannerMissing: boolean;
  added: string[];
  aiTrace: AiTraceChunk[];
  aiCost: AiCost;
  aiIntent: string;
};

// The shareable search URL. Only ever called after a run has settled: writing
// it mid-run is what cut Discover short. A long scan can outlive the visit to
// /explore (the provider lives in the app shell), so it is skipped elsewhere.
function writeSearchUrl(qs: string) {
  if (typeof window === "undefined") return;
  const url = settledExploreUrl(window.location.pathname, qs);
  if (url) window.history.replaceState(null, "", url);
}

export function ExploreProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [employerOutcome, setEmployerOutcome] = useState<EmployerScanOutcome | null>(null);
  const [filters, setFiltersState] = useState<ExploreFilters>({ ...DEFAULT_FILTERS, ats: [...DEFAULT_FILTERS.ats] });
  const touched = useRef(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [offers, setOffers] = useState<DiscoveredOffer[]>([]);
  const [sources, setSources] = useState<Partial<Record<DiscoverySource, SourceState>>>({});
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
  const runs = useRef(createRunOwner());
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
    if (f.preset === CHINA_PRESET && !f.employers?.length) return;
    const employer = f.preset === CHINA_PRESET;
    if (employer) {
      try { sessionStorage.removeItem(RESULTS_KEY); } catch { /* unavailable */ }
    }
    const run = runs.current.start();
    runningRef.current = true;
    setPhase("casting");
    setEmployerOutcome(null);
    setOffers([]);
    setMatchCount(0);
    setCompaniesScanned(0);
    setCompaniesAvailable(0);
    setCapHit(false);
    setDroppedNoDate(0);
    setPartial(false);
    setError("");
    setScannerMissing(false);
    setStatus("Casting the net across the ATS network…");
    const init: Partial<Record<DiscoverySource, SourceState>> = {};
    for (const a of employer ? f.employers ?? [] : f.ats) init[a] = { state: "queued" };
    setSources(init);
    // Do not write the filter URL here. Next.js patches history.replaceState and
    // treats it as a navigation, which aborts this fetch — Discover flashed
    // empty and returned to the form. It is written once the run has settled.

    const acc: DiscoveredOffer[] = [];
    let sawError = "";
    let aborted = false;
    let sawScannerMissing = false; // the structured 400 (data-only checkout), not a runtime scan error
    let companiesScannedAcc = 0; // 0 at the end = the directories never downloaded → degraded, not empty
    let capHitAcc = false; // scan was capped (only a slice of the universe searched)
    let datasetIssueAcc = false; // some ATS dataset was stale/empty/unreachable
    let employerResult: EmployerScanOutcome | null = null;
    let droppedNoDateAcc = 0; // postings dropped for lacking a publish date
    const handleEvent = (raw: object) => {
      if (!runs.current.owns(run)) return;
      const ev = raw as ScanEvent;
      switch (ev.kind) {
        case "atsStart":
          setPhase("scanning");
          setStatus(`Walking ${ATS_LABEL[ev.ats as AtsSource] ?? ev.ats} — ${ev.companies.toLocaleString()} companies`);
          setSources((s) => ({ ...s, [ev.ats]: { ...s[ev.ats as AtsSource], state: "active", companies: ev.companies } }));
          break;
        case "progress":
          setMatchCount((m) => Math.max(m, ev.matches));
          setSources((s) => ({ ...s, [ev.ats]: { ...s[ev.ats as AtsSource], state: "active", done: ev.scanned, total: ev.total } }));
          break;
        case "atsDone":
          setSources((s) => ({ ...s, [ev.ats]: { ...s[ev.ats as AtsSource], state: ev.unreachable > 0 ? "noisy" : "swept", unreachable: ev.unreachable } }));
          break;
        case "offer":
          acc.push(ev.offer);
          setOffers((o) => [...o, ev.offer]);
          setMatchCount((m) => Math.max(m, acc.length));
          break;
        case "done":
          if (Array.isArray(ev.offers)) {
            for (const o of ev.offers) {
              if (!o?.url || acc.some((a) => a.url === o.url)) continue;
              acc.push(o);
            }
            setOffers([...acc]);
          }
          break;
        case "summary": {
          if (ev.employerOutcome) { employerResult = ev.employerOutcome; setEmployerOutcome(ev.employerOutcome); }
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
          if (ev.unreachable > 0 || datasetIssue) setPartial(true);
          break;
        }
        case "error":
          sawError = ev.message;
          break;
        default:
          break;
      }
    };

    try {
      // Next.js patches window.fetch and aborts it on any router/history update.
      // Discover died in ~100ms with a silent AbortError. XMLHttpRequest is not patched.
      const { status, errorBody } = await postNdjsonXhr("/api/explore", employer ? employerRequest(f) : f, handleEvent);
      if (status >= 400) {
        sawScannerMissing = isScannerMissing(errorBody);
        const msg =
          errorBody && typeof errorBody === "object" && "error" in errorBody ? errorBody.error : null;
        sawError =
          typeof msg === "string" && msg
            ? msg
            : sawScannerMissing
              ? "The scanner isn't available."
              : `Discovery failed (${status}).`;
      }
    } catch (e) {
      aborted = isAbortError(e);
      sawError = aborted
        ? "Discover was interrupted before it finished. Run it again."
        : e instanceof Error
          ? e.message
          : "stream error";
    }

    // The run has settled, so the URL can carry the search again (shareable, and
    // a reload no longer replays an onboarding ?run=1).
    if (!runs.current.owns(run)) return;
    writeSearchUrl(filtersToParams(f));

    if (employer) {
      runningRef.current = false;
      // A missing terminal summary is interruption, even with zero results.
      const outcome: EmployerScanOutcome = employerResult ?? { state: acc.length ? "partial" : "failed", message: `Incomplete scan — ${(f.employers ?? []).map(id => EMPLOYER_LABEL[id]).join(", ")}: ${sawError || "source stream ended before completion"}.` };
      setEmployerOutcome(outcome);
      setStatus("");
      setPartial(outcome.state !== "complete");
      setMatchCount(acc.length);
      setError("");
      setPhase(acc.length ? "results" : outcome.state === "failed" ? "failed" : outcome.state === "partial" ? "degraded" : "empty-loose");
      return;
    }

    // Mark any still-active sources as swept (stream ended).
    setSources((s) => {
      const next = { ...s };
      for (const k of Object.keys(next) as AtsSource[]) if (next[k]?.state === "active" || next[k]?.state === "queued") next[k] = { ...next[k]!, state: "swept" };
      return next;
    });

    runningRef.current = false;
    if (acc.length > 0) {
      // A scan that ended in an error still keeps what it found (a legacy scan
      // stopped at the deadline, or every --json source stopped): mark it partial
      // and keep the reason, which ResultsList shows beside the results.
      if (sawError) {
        setPartial(true);
        setError(sawError);
      }
      setMatchCount(acc.length);
      setPhase("revealing");
      setStatus(`${acc.length} fresh role${acc.length === 1 ? "" : "s"} found — free.`);
      window.setTimeout(() => {
        if (runs.current.owns(run)) setPhase("results");
      }, 850);
    } else if (sawError) {
      setError(sawError);
      setScannerMissing(sawScannerMissing);
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

  // Today's "See all N" link (#84) routes here with ?view=fresh instead of leaving
  // the user on a bare config form. Re-fetch the same free, zero-token /api/whats-new
  // history the dashboard already reads and drop it straight into the results phase
  // — no scan, so it never touches sources/companiesScanned like discover() does.
  const loadFresh = useCallback(async () => {
    if (runningRef.current) return;
    const run = runs.current.start();
    runningRef.current = true;
    setPhase("casting");
    setStatus("Loading fresh matches…");
    setEmployerOutcome(null);
    setOffers([]);
    setMatchCount(0);
    setCompaniesScanned(0);
    setCompaniesAvailable(0);
    setCapHit(false);
    setDroppedNoDate(0);
    setPartial(false);
    setSources({});
    setError("");
    try {
      // A finite ceiling, not `all`: explorer-view renders every offer it gets,
      // so an unbounded list would be an unbounded DOM. `count` below stays the
      // complete total, which is what the header actually reports.
      const r = await fetch(`/api/whats-new?limit=${MAX_OFFER_LIMIT}`);
      if (!runs.current.owns(run)) return;
      if (!r.ok) {
        setError(`Couldn't load fresh matches (${r.status}).`);
        setPhase("failed");
        return;
      }
      const d = await r.json().catch(() => null);
      if (!runs.current.owns(run)) return;
      if (!d || !Array.isArray(d.offers)) {
        setError("Couldn't load fresh matches — unexpected response.");
        setPhase("failed");
        return;
      }
      const list: DiscoveredOffer[] = d.offers;
      setOffers(list);
      const count = Number(d.count);
      setMatchCount(Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : list.length);
      setPhase(list.length > 0 ? "results" : "empty-current");
    } catch (e) {
      if (!runs.current.owns(run)) return;
      setError(e instanceof Error ? e.message : "Couldn't load fresh matches.");
      setPhase("failed");
    } finally {
      if (runs.current.owns(run)) runningRef.current = false;
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
    runs.current.invalidate();
    runningRef.current = false;
    setPhase("idle");
    setEmployerOutcome(null);
    setOffers([]);
    setSources({});
    setMatchCount(0);
    setCompaniesScanned(0);
    setStatus("");
    setPartial(false);
    setError("");
    setScannerMissing(false);
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
    const run = runs.current.start();
    runningRef.current = true;
    setPhase("casting");
    setEmployerOutcome(null);
    setOffers([]);
    setMatchCount(0);
    setAiTrace([]);
    setAiCost({ searches: 0, candidates: 0, fetches: 0 });
    setError("");
    setScannerMissing(false);
    setStatus("Casting across the open web…");
    // Same as the scan path: do not replaceState while /api/explore/ai is in
    // flight. The URL is written once the hunt has settled.

    // Offers the user already has (scan history, inbox) are dropped by
    // /api/explore/ai itself, so the parser only dedups within this run.
    const parser = makeAiStreamParser();

    const acc: DiscoveredOffer[] = [];
    let sawError = "";
    let aborted = false;
    let sawScannerMissing = false; // the structured 400 (capability absent from this checkout), not a runtime error
    const handle = (chunks: AiTraceChunk[]) => {
      if (!runs.current.owns(run)) return;
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
        if (!runs.current.owns(run)) return;
        writeSearchUrl(aiToParams(intent));
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
        sawError = d.error || (sawScannerMissing ? "AI search isn't available." : `AI search failed (${r.status}).`);
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
      aborted = isAbortError(e);
      if (!aborted) sawError = e instanceof Error ? e.message : "stream error";
    }

    if (!runs.current.owns(run)) return;
    writeSearchUrl(aiToParams(intent));
    runningRef.current = false;
    if (acc.length > 0) {
      setMatchCount(acc.length);
      setPhase("revealing");
      setStatus(`${acc.length} candidate${acc.length === 1 ? "" : "s"} found.`);
      window.setTimeout(() => {
        if (runs.current.owns(run)) setPhase("results");
      }, 850);
    } else if (aborted) {
      setPhase("idle");
      setStatus("");
    } else if (sawError) {
      setError(sawError);
      setScannerMissing(sawScannerMissing);
      setPhase("failed");
    } else {
      setPhase("empty-loose");
    }
  }, []);

  // Switch surface but PRESERVE the current results + filters — toggling scan↔AI must
  // not throw away a completed search (disc#5). A new search (discover/discoverAI)
  // clears + repopulates; an explicit reset() clears. Just stop any half-run.
  const setMode = useCallback((m: ExploreMode) => {
    runs.current.invalidate();
    runningRef.current = false;
    // The retired run will not publish, so a running phase would spin forever.
    setPhase((p) => {
      if (p === "revealing") return "results";
      if (p === "casting" || p === "scanning" || p === "hunting") return "idle";
      return p;
    });
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
    // Retire any employer snapshot created by the earlier implementation.
    if ("employerOutcome" in snap && snap.employerOutcome) {
      try { sessionStorage.removeItem(RESULTS_KEY); } catch { /* unavailable */ }
      return;
    }
    setModeState(snap.mode === "ai" ? "ai" : "scan");
    setEmployerOutcome(null);
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
    setScannerMissing(!!snap.scannerMissing);
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
    // Employer coverage messages and results stay in memory. Do not serialize
    // them into the legacy browser snapshot, or restore an older search instead.
    if (employerOutcome) {
      try { sessionStorage.removeItem(RESULTS_KEY); } catch { /* unavailable */ }
      return;
    }
    try {
      const snap: ResultSnapshot = {
        v: 1, mode, phase, offers, matchCount, companiesScanned, companiesAvailable, capHit, droppedNoDate, sources,
        partial, status, error, scannerMissing, added: [...added], aiTrace, aiCost, aiIntent,
      };
      sessionStorage.setItem(RESULTS_KEY, JSON.stringify(snap));
    } catch {
      /* sessionStorage full/unavailable — non-fatal */
    }
  }, [phase, mode, offers, matchCount, companiesScanned, companiesAvailable, capHit, droppedNoDate, sources, partial, status, employerOutcome, error, scannerMissing, added, aiTrace, aiCost, aiIntent]);

  const value = useMemo(
    () => ({
      filters, setFilters, initFilters, phase,
      running: phase === "casting" || phase === "scanning" || phase === "revealing" || phase === "hunting",
      offers, sources, matchCount, companiesScanned, companiesAvailable, capHit, droppedNoDate, status, employerOutcome, partial, error, scannerMissing, added, adding,
      discover, loadFresh, addToPipeline, applyPatch, reset,
      mode, setMode, aiIntent, setAiIntent, discoverAI, aiTrace, aiCost,
    }),
    [filters, setFilters, initFilters, phase, offers, sources, matchCount, companiesScanned, companiesAvailable, capHit, droppedNoDate, status, employerOutcome, partial, error, scannerMissing, added, adding, discover, loadFresh, addToPipeline, applyPatch, reset, mode, setMode, aiIntent, discoverAI, aiTrace, aiCost],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
