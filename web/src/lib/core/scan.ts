import { spawn } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { writeTempPortals, cleanupTempPortals, loadProfileTargets, readScanTimeoutMs } from "@/lib/core/portals";
import { titleFit } from "@/lib/title-fit.mjs";
import { scanTimeoutMessage } from "./scan-timeout.mjs";
import { ATS_LABEL, ATS_SOURCES, type AtsSource, type DiscoveredOffer, type ExploreFilters, type FitBand, type ScanEvent, type SearchPlan } from "@/lib/explore";
import { mergeScanResults, timedOutMessage } from "./scan-merge.mjs";
import { runMarketDiscovery } from "@/lib/core/market-scan";
import { mergeDiscoveredOffers, sourceBackedFields } from "./market-merge.mjs";
import { buildMarketPlan, classifyMarketLocation } from "@/lib/market-presets.mjs";
import { buildSearchPlan } from "@/lib/search-plan.mjs";
import { rankOpportunities } from "@/lib/opportunity-rank.mjs";
import { matchesOccupationTerms } from "@/lib/occupation-match.mjs";

export type { DiscoveredOffer, ScanEvent, AtsSource } from "@/lib/explore";
export { ATS_SOURCES } from "@/lib/explore";

/**
 * ACL for the discovery engine — orchestrates the REAL core scanner
 * `scan-ats-full.mjs` (reverse ATS discovery, a contract entry-point). We run it
 * with `--dry-run` so it writes NOTHING (the user reviews + chooses), point it at
 * an EPHEMERAL filter file (never the user's portals.yml), and surface its results.
 *
 * DISCOVERY IS FREE — zero LLM tokens (pure HTTP + JSON). Only evaluation costs
 * tokens, and that is triggered explicitly elsewhere.
 *
 * Two parse paths, chosen by probing the local scanner's source:
 *  • `--json` (#1199): stdout = ONE authoritative object (human progress → stderr),
 *    carrying capHit / datasetStatus / postingsDroppedNoDate so we can tell a
 *    DEGRADED scan (capped, stale/unreachable dataset, postings dropped for no date)
 *    from a genuinely EMPTY one. Preferred.
 *  • legacy: older local checkouts lack `--json`; we parse the human stdout text
 *    (convenient but not formally stable) and infer a looser summary.
 */

const OFFER_RE = /^\s*\+\s+\[([^\]]+)\]\s+(\S+)\s+\|\s+(.+)$/;
const ATS_START_RE = /⚙\s+(\S+)\s+—\s+(\d+)\s+companies/;
const PROGRESS_RE = /(\d+)\/(\d+)\s+scanned,\s+(\d+)\s+total matches/;
const ATS_DONE_RE = /done \((\d+) unreachable boards skipped\)/;
const COMPANIES_RE = /Companies scanned:\s+(\d+)/;
const UNREACHABLE_RE = /Unreachable boards:\s+(\d+)/;
const SUMMARY_RE = /New matches:\s+(\d+)/;

function firstMatch(title: string, positives: string[]): string | undefined {
  return positives.find(term => term && matchesOccupationTerms(title, [term]));
}

/** Spread-in helper: {} when there is no band (keeps `fit` truly absent rather
 *  than explicitly undefined, so the offer objects stay JSON-clean). titleFit
 *  is plain JS, so its band arrives typed as string — narrowed here to the
 *  FitBand union the offer type promises. */
function fitField(title: string, targets: string[]): { fit: { band: FitBand; score: number } } | Record<string, never> {
  const f = titleFit(title, targets);
  return f ? { fit: { band: f.band as FitBand, score: f.score } } : {};
}

function ingestJsonOffer(
  o: JsonOffer,
  currentAts: string,
  filters: ExploreFilters,
  seen: Set<string>,
  offers: DiscoveredOffer[],
  onEvent: (e: ScanEvent) => void,
  roleTargets: string[] = [],
): void {
  const url = (o.url || "").trim();
  if (!url || !o.company || !o.title) return;
  const source = o.source || `${currentAts}-full`;
  const offer: DiscoveredOffer = {
    company: o.company,
    title: o.title,
    location: o.location || "",
    postedAt: o.postedAt || "",
    ats: source.replace(/-full$/, ""),
    source,
    url,
    matchedKeyword: firstMatch(o.title, filters.positive),
    ...fitField(o.title, roleTargets),
    ...sourceBackedFields(o),
  };
  // A final JSON record can enrich an earlier sparse live event.
  const index = seen.has(url) ? offers.findIndex(previous => previous.url === url) : -1;
  seen.add(url);
  if (index < 0) offers.push(offer);
  else offers[index] = mergeDiscoveredOffers([offers[index]], [offer])[0];
  if (index < 0) onEvent({ kind: "offer", offer });
}

/** Mirrors `parseLiveOfferLine` in scan-ats-full.mjs — keep the two in sync. */
function parseLiveOfferLine(line: string): JsonOffer | null {
  const raw = line.trim();
  const start = raw.indexOf("{");
  if (start < 0) return null;
  try {
    const ev = JSON.parse(raw.slice(start)) as JsonOffer & { kind?: string };
    if (ev?.kind !== "offer") return null;
    const url = (ev.url || "").trim();
    if (!url || !ev.company || !ev.title) return null;
    return ev;
  } catch {
    return null;
  }
}

function parseOfferLine(source: string, date: string, rest: string): Omit<DiscoveredOffer, "url"> | null {
  const fields = rest.split(" | ");
  if (fields.length < 2) return null;
  const company = fields[0].trim();
  const title = fields[1].trim();
  const location = fields.slice(2).join(" | ").trim();
  if (!company || !title) return null;
  return {
    company,
    title,
    location: location === "N/A" ? "" : location,
    postedAt: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
    ats: source.replace(/-full$/, ""),
    source,
  };
}

// Does the user's LOCAL scanner support the --json contract (#1199)? Probe the
// source (cheap, no spawn) so older checkouts fall back instead of breaking on an
// unknown flag — the web is local-first, so the version is whatever they installed.
export function scannerSupportsJson(): boolean {
  try {
    const src = fs.readFileSync(rootScript("scan-ats-full"), "utf8");
    return src.includes("--json") && src.includes("capHit");
  } catch {
    return false;
  }
}

type JsonOffer = { company?: string; title?: string; url?: string; location?: string | null; postedAt?: string | null; source?: string } & Partial<Pick<DiscoveredOffer, "salary" | "contractType" | "hours" | "applicationDeadline" | "vacancyCount" | "observedAt" | "availabilityEvidence" | "sources">>;
type ScanJson = {
  companiesAvailable?: number;
  companiesScanned?: number;
  capHit?: boolean;
  datasetStatus?: Record<string, "ok" | "stale" | "empty">;
  postingsKept?: number;
  postingsDroppedNoDate?: number;
  unreachableBoards?: number;
  stoppedEarly?: boolean;
  offers?: JsonOffer[];
};

type ScannerRun = {
  /** --json mode: the parsed result object, or null if the child produced none. */
  json: ScanJson | null;
  /** Killed at the deadline. */
  timedOut: boolean;
  /** Spawn/runtime failure message, when the child never produced a result. */
  failed?: string;
};

/**
 * Run ONE scan-ats-full.mjs child over `ats`, stopped after `timeoutMs`. Live
 * progress is forwarded as it arrives. Offers the child surfaces while it runs
 * (live stderr lines in --json mode, the human stdout in legacy mode) go into
 * `sink`, which every child of one run shares so no offer is emitted twice. In
 * --json mode the parsed result is returned for the caller to merge.
 */
function runScanner(
  ats: string[],
  useJson: boolean,
  filters: ExploreFilters,
  tempPortals: string,
  onEvent: (e: ScanEvent) => void,
  sink: { offers: DiscoveredOffer[]; seen: Set<string> },
  timeoutMs: number,
  roleTargets: string[],
): Promise<ScannerRun> {
  return new Promise((resolve) => {
    const args = [
      rootScript("scan-ats-full"),
      "--dry-run",
      "--since",
      String(Math.max(1, filters.sinceDays || 7)),
      "--ats",
      ats.join(","),
      "--limit",
      String(Math.max(1, filters.limitPerAts || 150)),
    ];
    if (useJson) args.push("--json");

    const child = spawn(process.execPath, args, {
      cwd: careerOpsRoot(),
      env: { ...process.env, CAREER_OPS_PORTALS: tempPortals },
    });

    const { offers, seen } = sink;
    let currentAts: string = ats[0] || "";
    let pending: Omit<DiscoveredOffer, "url"> | null = null;
    let companiesScanned = 0;
    let unreachable = 0;
    let outBuf = "";
    let errBuf = "";
    let jsonOut = ""; // --json mode: the single stdout object accumulates here

    // A broad ATS sweep can legitimately outlast the default budget (the scanner
    // probes every company in a source, not just --limit of them). Extend it in
    // config/profile.yml via scan.timeout_seconds. If our own timer fires, remember
    // it so the caller can say so honestly (and the scanner flushes the
    // matches found so far as a partial --json result on SIGTERM).
    let timedOut = false;
    let hardKiller: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const settle = (run: ScannerRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      if (hardKiller) clearTimeout(hardKiller);
      resolve(run);
    };

    const killer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      // Grace period: if the child can't flush its partial JSON and exit, force it
      // so a wedged scan can't hold the request open to the route's maxDuration.
      hardKiller = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 5_000);
    }, timeoutMs);

    // Live progress (atsStart / progress / atsDone) — in --json mode these human
    // lines arrive on STDERR; in legacy mode on STDOUT (handled inside handleLine).
    const handleProgressLine = (line: string) => {
      const live = parseLiveOfferLine(line);
      if (live) {
        ingestJsonOffer(live, currentAts, filters, seen, offers, onEvent, roleTargets);
        return true;
      }
      const atsM = line.match(ATS_START_RE);
      if (atsM) {
        currentAts = atsM[1];
        onEvent({ kind: "atsStart", ats: atsM[1], companies: Number(atsM[2]) });
        return false;
      }
      const progM = line.match(PROGRESS_RE);
      if (progM) {
        onEvent({ kind: "progress", ats: currentAts, scanned: Number(progM[1]), total: Number(progM[2]), matches: Number(progM[3]) });
        return false;
      }
      const doneAtsM = line.match(ATS_DONE_RE);
      if (doneAtsM) {
        onEvent({ kind: "atsDone", ats: currentAts, unreachable: Number(doneAtsM[1]) });
      }
      return false;
    };

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (pending && /^https?:\/\//i.test(trimmed)) {
        const url = trimmed.split(/\s+/)[0];
        if (!seen.has(url)) {
          seen.add(url);
          const offer: DiscoveredOffer = { ...pending, url, matchedKeyword: firstMatch(pending.title, filters.positive), ...fitField(pending.title, roleTargets) };
          offers.push(offer);
          onEvent({ kind: "offer", offer });
        }
        pending = null;
        return;
      }
      if (pending) pending = null;

      const offerM = line.match(OFFER_RE);
      if (offerM) {
        pending = parseOfferLine(offerM[1], offerM[2], offerM[3]);
        return;
      }
      const atsM = line.match(ATS_START_RE);
      if (atsM) {
        currentAts = atsM[1];
        onEvent({ kind: "atsStart", ats: atsM[1], companies: Number(atsM[2]) });
        return;
      }
      const progM = line.match(PROGRESS_RE);
      if (progM) {
        onEvent({ kind: "progress", ats: currentAts, scanned: Number(progM[1]), total: Number(progM[2]), matches: Number(progM[3]) });
        return;
      }
      const doneAtsM = line.match(ATS_DONE_RE);
      if (doneAtsM) {
        onEvent({ kind: "atsDone", ats: currentAts, unreachable: Number(doneAtsM[1]) });
        return;
      }
      const compM = line.match(COMPANIES_RE);
      if (compM) {
        companiesScanned = Number(compM[1]);
        return;
      }
      const unreachM = line.match(UNREACHABLE_RE);
      if (unreachM) {
        unreachable = Number(unreachM[1]);
        return;
      }
      const sumM = line.match(SUMMARY_RE);
      if (sumM) {
        onEvent({ kind: "summary", companiesScanned, unreachable, matches: Number(sumM[1]) });
        return;
      }
    };

    child.stdout.on("data", (d: Buffer) => {
      if (useJson) {
        jsonOut += d.toString(); // one JSON object — parsed at close
        return;
      }
      outBuf += d.toString();
      const parts = outBuf.split(/\r\n|\r|\n/);
      outBuf = parts.pop() ?? "";
      for (const p of parts) handleLine(p);
    });
    child.stderr.on("data", (d: Buffer) => {
      errBuf += d.toString();
      const parts = errBuf.split(/\r?\n/);
      errBuf = parts.pop() ?? "";
      for (const p of parts) {
        if (!p.trim()) continue;
        if (useJson) {
          // human progress + live offer JSON live on stderr in --json mode
          if (handleProgressLine(p)) continue;
        }
        onEvent({ kind: "log", line: p.trim() });
      }
    });

    child.on("error", (e) => {
      settle({ json: null, timedOut, failed: e instanceof Error ? e.message : "scanner failed to start" });
    });
    child.on("close", (code) => {
      const failure = code !== 0 && !timedOut ? { failed: `O scanner terminou com código ${code ?? "desconhecido"}.` } : {};
      if (useJson) {
        let j: ScanJson | null = null;
        try {
          j = JSON.parse(jsonOut.trim()) as ScanJson;
        } catch {
          j = null;
        }
        settle({ json: j && Array.isArray(j.offers) ? j : null, timedOut, ...failure });
        return;
      }
      if (outBuf.trim()) handleLine(outBuf);
      settle({ json: null, timedOut, ...failure });
    });
  });
}

const NO_OUTPUT = "The scanner returned no readable output.";

async function runAtsDiscovery(filters: ExploreFilters, onEvent: (e: ScanEvent) => void): Promise<DiscoveredOffer[]> {
  const tempPortals = writeTempPortals(filters);
  const ats = (filters.ats.length ? filters.ats : [...ATS_SOURCES]).filter((a) => (ATS_SOURCES as readonly string[]).includes(a));
  const useJson = scannerSupportsJson();
  // Read once per run: every child gets the same budget, and the copy quotes it
  // exactly (a 1.5s budget must not read as 2s).
  const timeoutMs = readScanTimeoutMs();
  const deadlineSec = timeoutMs / 1000;
  const roleTargets = loadProfileTargets();
  const label = (a: string) => ATS_LABEL[a as AtsSource] ?? a;
  // One sink for the whole run: offers streamed live by any child land here
  // deduped by URL, and the final --json results below go through the same set.
  const sink = { offers: [] as DiscoveredOffer[], seen: new Set<string>() };

  try {
    if (!useJson) {
      // Older checkouts: one child, human-stdout parse. It streams offers as they
      // arrive, so the ones collected so far are returned; a deadline kill still
      // says so instead of ending silently.
      const run = await runScanner(ats, false, filters, tempPortals, onEvent, sink, timeoutMs, roleTargets);
      if (run.failed) onEvent({ kind: "error", message: run.failed });
      else if (run.timedOut) onEvent({ kind: "error", message: scanTimeoutMessage(timeoutMs) });
      return sink.offers;
    }

    // --json: one child per source, in parallel (see scan-merge.mjs for why).
    // Dry runs write no scanner state and each source caches its own dataset
    // file, so the children don't contend.
    const runs = await Promise.all(
      ats.map((a) => runScanner([a], true, filters, tempPortals, onEvent, sink, timeoutMs, roleTargets)),
    );

    const { offers, seen } = sink;
    const finished: ScanJson[] = [];
    runs.forEach((run, i) => {
      if (!run.json) return;
      finished.push(run.json);
      for (const o of run.json.offers ?? []) ingestJsonOffer(o, ats[i], filters, seen, offers, onEvent, roleTargets);
    });

    // A child stopped at the deadline flushes what it found so far as a partial
    // result (`stoppedEarly`), so having a result no longer means the source
    // finished: its offers and counts are kept, and it is still named as incomplete.
    const stopped = runs.map((r) => r.timedOut || r.json?.stoppedEarly === true);
    const timedOut = ats.filter((_, i) => stopped[i]);
    const incomplete = ats.filter((source, i) => {
      const result = runs[i].json;
      const hasHealthProof = result && typeof result.capHit === "boolean" &&
        Number.isFinite(result.companiesAvailable) && Number.isFinite(result.companiesScanned) &&
        Number.isFinite(result.unreachableBoards) && Number.isFinite(result.postingsDroppedNoDate) &&
        ["ok", "stale", "empty"].includes(result.datasetStatus?.[source] ?? "");
      return !hasHealthProof || stopped[i] || runs[i].failed;
    });

    if (finished.length === 0) {
      const failed = runs.find((r) => r.failed)?.failed;
      onEvent({
        kind: "error",
        message: timedOut.length ? timedOutMessage(timedOut.map(label), deadlineSec) : failed || NO_OUTPUT,
      });
      return offers;
    }

    if (timedOut.length) {
      const message = timedOutMessage(timedOut.map(label), deadlineSec);
      // No source finished: the timeout is the outcome, as when a stopped child
      // printed nothing. Otherwise it is a note beside the sources that finished.
      onEvent(incomplete.length === ats.length ? { kind: "error", message } : { kind: "log", line: message });
    }
    onEvent({
      kind: "summary",
      ...mergeScanResults(finished, offers.length),
      ...(incomplete.length ? { incomplete } : {}),
    });
    return offers;
  } finally {
    cleanupTempPortals(tempPortals);
  }
}

async function runDiscoveryPass(searchPlan: SearchPlan, onEvent: (e: ScanEvent) => void): Promise<DiscoveredOffer[]> {
  const observedAt = new Date().toISOString();
  const filters = searchPlan.effectiveFilters;
  const ats = filters.opportunityType === "freelance" ? [] : filters.ats.filter(a => ATS_SOURCES.includes(a));
  const plan = buildMarketPlan(filters.markets, filters.positive, filters.opportunityType, searchPlan);
  type Summary = Extract<ScanEvent, { kind: "summary" }>;
  let atsSummary: Summary | undefined;
  const atsErrors: string[] = [];
  const discoverAts = async () => {
    for (const source of ats) onEvent({ kind: "sourceStart", source });
    if (!fs.existsSync(rootScript("scan-ats-full"))) {
      atsErrors.push("O scanner ATS não está disponível nesta instalação.");
      return [] as DiscoveredOffer[];
    }
    try {
      return await runAtsDiscovery({ ...filters, ats }, event => {
        if (event.kind === "summary") atsSummary = event;
        else if (event.kind === "error") atsErrors.push(event.message);
        else if (event.kind !== "offer" || (classifyMarketLocation(event.offer, plan).accepted && matchesOccupationTerms(event.offer.title, filters.positive))) onEvent(event);
      });
    } catch (error) {
      atsErrors.push(error instanceof Error ? error.message : NO_OUTPUT);
      return [] as DiscoveredOffer[];
    }
  };
  // Both selected paths start before either is awaited. A single selected path
  // runs alone, so an unavailable sibling scanner cannot affect that search.
  const atsPromise = ats.length ? discoverAts() : null;
  const marketPromise = (filters.opportunityType === "freelance" || filters.markets.length) ? runMarketDiscovery(filters, event => {
    if (event.kind !== "offer" || matchesOccupationTerms(event.offer.title, filters.positive)) onEvent(event);
  }, searchPlan).catch(error => ({
    offers: [] as DiscoveredOffer[], valid: false, status: "failed" as const, missingLocation: 0, scanned: 0,
    sources: plan.jobBoards.map(board => ({ source: board.name, state: "error" as const, message: error instanceof Error ? error.message : NO_OUTPUT })),
  })) : null;
  const atsOffers = atsPromise ? await atsPromise : [];
  const marketRun = marketPromise ? await marketPromise : null;
  let missingLocation = marketRun?.missingLocation ?? 0;
  const eligible = mergeDiscoveredOffers(atsOffers, marketRun?.offers ?? []).filter(offer => {
    const classification = classifyMarketLocation(offer, plan);
    if (classification.reason === "missing-location") missingLocation++;
    return classification.accepted && matchesOccupationTerms(offer.title, filters.positive);
  });
  const offers = rankOpportunities(eligible.map(offer => ({ ...offer, observedAt })), searchPlan, observedAt);
  const atsValid = Boolean(atsSummary) || atsOffers.length > 0;
  const sources: NonNullable<Summary["sources"]> = ats.map(source => {
    const failed = !atsValid || atsSummary?.incomplete?.includes(source);
    return { source, state: failed ? "error" : "ok", ...(failed ? { message: atsErrors[0] ?? "A fonte não terminou." } : {}) };
  });
  sources.push(...(marketRun?.sources ?? []));
  for (const source of sources.slice(0, ats.length)) {
    onEvent(source.state === "ok" ? { kind: "sourceDone", source: source.source, count: offers.filter(o => o.ats === source.source).length } :
      { kind: "sourceError", source: source.source, message: source.message ?? NO_OUTPUT });
  }
  const valid = (ats.length > 0 && atsValid) || marketRun?.valid === true;
  const status = !valid ? "failed" : sources.some(s => s.state !== "ok") || atsErrors.length > 0 || marketRun?.status === "partial" ? "partial" : "ok";
  if (!valid) onEvent({ kind: "error", message: atsErrors[0] ?? "Nenhuma fonte selecionada devolveu um resultado válido." });
  onEvent({
    ...(atsSummary ?? { kind: "summary", companiesScanned: 0, unreachable: 0, matches: 0 }),
    companiesScanned: (atsSummary?.companiesScanned ?? 0) + (marketRun?.scanned ?? 0),
    matches: offers.length, status, sources, missingLocation,
    ...(sources.some(s => s.state !== "ok") ? { incomplete: sources.filter(s => s.state !== "ok").map(s => s.source) } : {}),
  });
  return offers;
}

type Summary = Extract<ScanEvent, { kind: "summary" }>;

function healthyZero(summary: Summary | undefined, filters: ExploreFilters): boolean {
  if (!summary || summary.status !== "ok" || summary.matches !== 0 ||
      !summary.sources?.length || summary.sources.some(source => source.state !== "ok") ||
      summary.incomplete?.length || summary.unreachable !== 0 || (summary.missingLocation ?? 0) > 0 ||
      !Number.isFinite(summary.companiesScanned) || summary.companiesScanned <= 0 ||
      summary.capHit === true || (summary.postingsDroppedNoDate ?? 0) > 0 ||
      Object.values(summary.datasetStatus ?? {}).some(state => state !== "ok")) return false;
  const ats = filters.opportunityType === "freelance" ? [] : filters.ats.filter(source => ATS_SOURCES.includes(source));
  // Legacy stdout and incomplete JSON cannot certify an empty ATS universe.
  return !ats.length || (summary.capHit === false && summary.postingsDroppedNoDate === 0 &&
    Number.isFinite(summary.companiesAvailable) &&
    ats.every(source => summary.datasetStatus?.[source] === "ok" && summary.sources?.some(state => state.source === source && state.state === "ok")));
}

export async function runDiscovery(
  filters: ExploreFilters,
  onEvent: (e: ScanEvent) => void,
  runPass: typeof runDiscoveryPass = runDiscoveryPass,
): Promise<DiscoveredOffer[]> {
  let summary: Summary | undefined;
  let sawError = false;
  const emit = (event: ScanEvent) => {
    if (event.kind === "summary") summary = event;
    else {
      if (event.kind === "error" || event.kind === "sourceError") sawError = true;
      onEvent(event);
    }
  };
  const precise = buildSearchPlan(filters, "precise");
  onEvent({ kind: "phaseStart", phase: "precise", sinceDays: precise.effectiveFilters.sinceDays, free: true });
  let offers = await runPass(precise, emit);
  if (!offers.length && !sawError && healthyZero(summary, precise.effectiveFilters)) {
    const broad = buildSearchPlan(filters, "broad");
    onEvent({ kind: "expansion", ...broad.expansion });
    onEvent({ kind: "phaseStart", phase: "broad", sinceDays: broad.effectiveFilters.sinceDays, free: true });
    summary = undefined;
    offers = await runPass(broad, emit);
  }
  if (summary) onEvent(summary);
  return offers;
}
