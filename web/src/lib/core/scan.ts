import { spawn } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { writeTempPortals, cleanupTempPortals } from "./portals";
import { ATS_SOURCES, type DiscoveredOffer, type ExploreFilters, type ScanEvent } from "@/lib/explore";

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

export function runDiscovery(filters: ExploreFilters, onEvent: (e: ScanEvent) => void): Promise<DiscoveredOffer[]> {
  return new Promise((resolve) => {
    const tempPortals = writeTempPortals(filters);
    const ats = (filters.ats.length ? filters.ats : [...ATS_SOURCES]).filter((a) => (ATS_SOURCES as readonly string[]).includes(a));
    const useJson = scannerSupportsJson();
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

    const offers: DiscoveredOffer[] = [];
    const seen = new Set<string>();
    let currentAts: string = ats[0] || "";
    let pending: Omit<DiscoveredOffer, "url"> | null = null;
    let companiesScanned = 0;
    let unreachable = 0;
    let outBuf = "";
    let errBuf = "";
    let jsonOut = ""; // --json mode: the single stdout object accumulates here

    const killer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, 230_000);

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
      clearTimeout(killer);
      cleanupTempPortals(tempPortals);
      onEvent({ kind: "error", message: e instanceof Error ? e.message : "scanner failed to start" });
      resolve(offers);
    });
    child.on("close", () => {
      clearTimeout(killer);
      cleanupTempPortals(tempPortals);
      if (useJson) {
        let j: ScanJson | null = null;
        try {
          j = JSON.parse(jsonOut.trim()) as ScanJson;
        } catch {
          j = null;
        }
        if (j && Array.isArray(j.offers)) {
          for (const o of j.offers) {
            const url = (o.url || "").trim();
            if (!url || seen.has(url) || !o.company || !o.title) continue;
            seen.add(url);
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
            };
            offers.push(offer);
            onEvent({ kind: "offer", offer });
          }
          onEvent({
            kind: "summary",
            companiesScanned: j.companiesScanned ?? 0,
            unreachable: j.unreachableBoards ?? 0,
            matches: j.postingsKept ?? offers.length,
            companiesAvailable: j.companiesAvailable,
            capHit: j.capHit,
            datasetStatus: j.datasetStatus,
            postingsDroppedNoDate: j.postingsDroppedNoDate,
          });
        } else {
          // --json requested but stdout didn't parse — surface honestly rather than
          // silently returning 0 (defensive; shouldn't happen once the probe passed).
          onEvent({ kind: "error", message: "The scanner returned no readable output." });
        }
        resolve(offers);
        return;
      }
      if (outBuf.trim()) handleLine(outBuf);
      resolve(offers);
    });
  });
}
