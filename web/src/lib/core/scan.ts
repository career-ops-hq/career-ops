import { spawn } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { writeTempPortals, cleanupTempPortals } from "./portals";
import { ATS_LABEL, ATS_SOURCES, type AtsSource, type DiscoveredOffer, type ExploreFilters, type ScanEvent } from "@/lib/explore";
import { mergeScanResults, timedOutMessage } from "./scan-merge.mjs";

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
  const lower = title.toLowerCase();
  for (const k of positives) if (k && lower.includes(k.toLowerCase())) return k;
  return undefined;
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

type JsonOffer = { company?: string; title?: string; url?: string; location?: string | null; postedAt?: string | null; source?: string };
type ScanJson = {
  companiesAvailable?: number;
  companiesScanned?: number;
  capHit?: boolean;
  datasetStatus?: Record<string, "ok" | "stale" | "empty">;
  postingsKept?: number;
  postingsDroppedNoDate?: number;
  unreachableBoards?: number;
  offers?: JsonOffer[];
};

/** The whole discovery run must fit inside the route's maxDuration (300s). */
const DISCOVERY_DEADLINE_MS = 230_000;

type ScannerRun = {
  /** --json mode: the parsed result object, or null if the child produced none. */
  json: ScanJson | null;
  /** Killed at the deadline. */
  timedOut: boolean;
  /** Spawn/runtime failure message, when the child never produced a result. */
  failed?: string;
};

/**
 * Run ONE scan-ats-full.mjs child over `ats`. Live progress is forwarded as it
 * arrives. In --json mode the parsed result is returned for the caller to merge;
 * in legacy mode the human stdout is parsed here and offers/summary are emitted
 * directly into `legacy`.
 */
function runScanner(
  ats: string[],
  useJson: boolean,
  filters: ExploreFilters,
  tempPortals: string,
  onEvent: (e: ScanEvent) => void,
  legacy: { offers: DiscoveredOffer[]; seen: Set<string> },
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

    const { offers, seen } = legacy;
    let currentAts: string = ats[0] || "";
    let pending: Omit<DiscoveredOffer, "url"> | null = null;
    let companiesScanned = 0;
    let unreachable = 0;
    let outBuf = "";
    let errBuf = "";
    let jsonOut = ""; // --json mode: the single stdout object accumulates here
    let timedOut = false;
    let settled = false;
    const settle = (run: ScannerRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      resolve(run);
    };

    const killer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, DISCOVERY_DEADLINE_MS);

    // Live progress (atsStart / progress / atsDone) — in --json mode these human
    // lines arrive on STDERR; in legacy mode on STDOUT (handled inside handleLine).
    const handleProgressLine = (line: string) => {
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
      }
    };

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (pending && /^https?:\/\//i.test(trimmed)) {
        const url = trimmed.split(/\s+/)[0];
        if (!seen.has(url)) {
          seen.add(url);
          const offer: DiscoveredOffer = { ...pending, url, matchedKeyword: firstMatch(pending.title, filters.positive) };
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
        if (useJson) handleProgressLine(p); // human progress lives on stderr in --json mode
        onEvent({ kind: "log", line: p.trim() });
      }
    });

    child.on("error", (e) => {
      settle({ json: null, timedOut, failed: e instanceof Error ? e.message : "scanner failed to start" });
    });
    child.on("close", () => {
      if (useJson) {
        let j: ScanJson | null = null;
        try {
          j = JSON.parse(jsonOut.trim()) as ScanJson;
        } catch {
          j = null;
        }
        settle({ json: j && Array.isArray(j.offers) ? j : null, timedOut });
        return;
      }
      if (outBuf.trim()) handleLine(outBuf);
      settle({ json: null, timedOut });
    });
  });
}

function toOffer(o: JsonOffer, fallbackSource: string, filters: ExploreFilters): DiscoveredOffer | null {
  const url = (o.url || "").trim();
  if (!url || !o.company || !o.title) return null;
  const source = o.source || fallbackSource;
  return {
    company: o.company,
    title: o.title,
    location: o.location || "",
    postedAt: o.postedAt || "",
    ats: source.replace(/-full$/, ""),
    source,
    url,
    matchedKeyword: firstMatch(o.title, filters.positive),
  };
}

const NO_OUTPUT = "The scanner returned no readable output.";

export async function runDiscovery(filters: ExploreFilters, onEvent: (e: ScanEvent) => void): Promise<DiscoveredOffer[]> {
  const tempPortals = writeTempPortals(filters);
  const ats = (filters.ats.length ? filters.ats : [...ATS_SOURCES]).filter((a) => (ATS_SOURCES as readonly string[]).includes(a));
  const useJson = scannerSupportsJson();
  const deadlineSec = Math.round(DISCOVERY_DEADLINE_MS / 1000);
  const label = (a: string) => ATS_LABEL[a as AtsSource] ?? a;
  const legacy = { offers: [] as DiscoveredOffer[], seen: new Set<string>() };

  try {
    if (!useJson) {
      // Older checkouts: one child, human-stdout parse — unchanged except that a
      // deadline kill now says so instead of ending silently.
      const run = await runScanner(ats, false, filters, tempPortals, onEvent, legacy);
      if (run.failed) onEvent({ kind: "error", message: run.failed });
      else if (run.timedOut) onEvent({ kind: "error", message: timedOutMessage(ats.map(label), deadlineSec) });
      return legacy.offers;
    }

    // --json: one child per source, in parallel (see scan-merge.mjs for why).
    // Dry runs write no scanner state and each source caches its own dataset
    // file, so the children don't contend.
    const runs = await Promise.all(
      ats.map((a) => runScanner([a], true, filters, tempPortals, onEvent, { offers: [], seen: new Set() })),
    );

    const offers: DiscoveredOffer[] = [];
    const seen = new Set<string>();
    const finished: ScanJson[] = [];
    runs.forEach((run, i) => {
      if (!run.json) return;
      finished.push(run.json);
      for (const o of run.json.offers ?? []) {
        const offer = toOffer(o, `${ats[i]}-full`, filters);
        if (!offer || seen.has(offer.url)) continue;
        seen.add(offer.url);
        offers.push(offer);
        onEvent({ kind: "offer", offer });
      }
    });

    const timedOut = ats.filter((_, i) => !runs[i].json && runs[i].timedOut);
    const incomplete = ats.filter((_, i) => !runs[i].json);

    if (finished.length === 0) {
      const failed = runs.find((r) => r.failed)?.failed;
      onEvent({
        kind: "error",
        message: timedOut.length ? timedOutMessage(timedOut.map(label), deadlineSec) : failed || NO_OUTPUT,
      });
      return offers;
    }

    if (timedOut.length) onEvent({ kind: "log", line: timedOutMessage(timedOut.map(label), deadlineSec) });
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
