// Shared display names for scan providers and job-board hosts. Used by inbox
// source pills, Explore discovery cards, and the home "what's new" feed so
// board-browser / weworkremotely / Instahyre URLs read consistently everywhere.

import type { AtsSource } from "@/lib/explore";
import { ATS_LABEL } from "@/lib/explore";

/** Provider ids from scan-history.tsv's portal column (e.g. greenhouse-api). */
const SOURCE_LABEL_OVERRIDES: Record<string, string> = {
  solidjobs: "SolidJobs",
  apify: "Apify",
  "board-browser": "Board browser",
  weworkremotely: "We Work Remotely",
  "ai-search": "AI search",
  "manual-paste": "Pasted",
  "linkedin-alerts": "LinkedIn alerts",
  "portals-search": "Portals search",
  hackernews: "Hacker News",
  remoteok: "RemoteOK",
  remotive: "Remotive",
  jobicy: "Jobicy",
  echojobs: "EchoJobs",
};

/** Job-board hosts when scan-history has no portal column (manual paste, legacy rows). */
const HOST_LABELS: [string, string][] = [
  ["instahyre.com", "Instahyre"],
  ["wellfound.com", "Wellfound"],
  ["cutshort.io", "Cutshort"],
  ["workatastartup.com", "Work at a Startup"],
  ["weworkremotely.com", "We Work Remotely"],
  ["naukri.com", "Naukri"],
  ["hirist.tech", "Hirist"],
  ["iimjobs.com", "iimjobs"],
  ["linkedin.com", "LinkedIn"],
];

function prettyProvider(id: string): string {
  const lower = id.toLowerCase();
  if (SOURCE_LABEL_OVERRIDES[lower]) return SOURCE_LABEL_OVERRIDES[lower];
  return id.length ? id.charAt(0).toUpperCase() + id.slice(1) : id;
}

/** Parse "board-browser-api" → "board-browser". */
export function providerIdFromPortal(recorded: string): string | null {
  const m = recorded.match(/^(.+)-(api|full)$/i);
  return m ? m[1] : null;
}

/** Friendly label from a job URL host (no network). */
export function sourceFromJobUrl(url: string): string | null {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const domainIs = (base: string) => host === base || host.endsWith(`.${base}`);
  if (domainIs("greenhouse.io")) return ATS_LABEL.greenhouse;
  if (domainIs("lever.co")) return ATS_LABEL.lever;
  if (domainIs("ashbyhq.com")) return ATS_LABEL.ashby;
  if (domainIs("myworkdayjobs.com") || domainIs("workday.com")) return ATS_LABEL.workday;
  for (const [base, label] of HOST_LABELS) {
    if (domainIs(base)) return label;
  }
  return null;
}

/** Human label for a posting's recorded portal or URL. */
export function sourceLabel(url: string, recordedSource: string | undefined): string | null {
  if (recordedSource) {
    const id = providerIdFromPortal(recordedSource);
    if (id) return prettyProvider(id);
    return prettyProvider(recordedSource);
  }
  return sourceFromJobUrl(url);
}

/** Discovery-card / home badge: raw portal id (board-browser-api) or resolved label. */
export function discoverySourceLabel(url: string, atsOrPortal: string): string {
  if (!atsOrPortal || atsOrPortal === "other" || atsOrPortal === "whats-new") {
    return sourceFromJobUrl(url) || "Scan";
  }
  if (/-(api|full)$/i.test(atsOrPortal)) {
    return sourceLabel(url, atsOrPortal) || sourceFromJobUrl(url) || "Scan";
  }
  if ((ATS_LABEL as Record<string, string>)[atsOrPortal]) {
    return ATS_LABEL[atsOrPortal as AtsSource];
  }
  return atsOrPortal;
}
