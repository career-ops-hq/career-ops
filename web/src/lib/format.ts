// Pure, node-free helpers shared by server and client components (no fs/path
// imports here — career-ops.ts holds the filesystem reads). Aligned with the
// core: normalize-statuses.mjs (aliases) + the Go TUI dashboard (score/status
// colours = the current state-of-the-art).

// Alias → canonical stage. Lives in status-alias.mjs so a `node --test` unit
// test can load it and assert it still covers templates/states.yml (#2917);
// a hand-maintained copy is what drifted in #2249 and again after #2705.
import { canonStatus } from "@/lib/status-alias.mjs";

export { canonStatus };

export const CANONICAL_STATES = [
  "Evaluated",
  "Applied",
  "Responded",
  "Interview",
  "Offer",
  "Hired",
  "Rejected",
  "Discarded",
  "SKIP",
] as const;

/** Status dot colour, mirroring the Go TUI: green hired/interview/offer, sky
 *  applied/responded, red skip/rejected, gray discarded, neutral evaluated. */
export function statusDot(status: string): string {
  const c = canonStatus(status);
  // Hired is the terminal win — the best outcome, never a neutral gray dot.
  if (c.includes("HIRED") || c.includes("INTERVIEW") || c.includes("OFFER")) return "bg-emerald-400";
  if (c.includes("APPLIED") || c.includes("RESPONDED")) return "bg-sky-400";
  if (c.includes("REJECTED") || c.includes("SKIP")) return "bg-red-400";
  if (c.includes("DISCARDED")) return "bg-zinc-600";
  return "bg-zinc-500"; // Evaluated / unknown
}

/** First number in a score string ("4.1/5", "B+", "3.0") → numeric, or NaN. */
export function scoreNum(s: string): number {
  const m = s.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : NaN;
}

/** Score → tone, mirroring the Go TUI thresholds (>=4.2 green, >=3.8 yellow,
 *  >=3.0 normal, <3.0 red). */
export function scoreTone(score: string): "good" | "warn" | "bad" | "muted" {
  const num = scoreNum(score);
  if (!Number.isNaN(num)) {
    if (num >= 4.2) return "good";
    if (num >= 3.8) return "warn";
    if (num >= 3.0) return "muted";
    return "bad";
  }
  const g = score.trim().toUpperCase()[0];
  if (g === "A") return "good";
  if (g === "B") return "warn";
  if (g === "C") return "muted";
  if (g === "D" || g === "E" || g === "F") return "bad";
  return "muted";
}

/** Block-G legitimacy tier → tone. */
export function legitimacyTone(l: string): "good" | "warn" | "bad" | "muted" {
  const s = l.toLowerCase();
  if (s.includes("high") || s.includes("confian") || s.includes("legit")) return "good";
  if (s.includes("caution") || s.includes("precau") || s.includes("caut")) return "warn";
  if (s.includes("suspic") || s.includes("sospech") || s.includes("scam") || s.includes("fake")) return "bad";
  return "muted";
}

// Parsing lives in report-header.mjs so `node --test` can reach it without the
// `@/` alias; the TYPE lives here, at the TS boundary, the same way career-ops.ts
// declares Application over tracker-table.mjs's untyped parseApplications.
import { parseReport as parseReportUntyped } from "./report-header.mjs";

export type ReportMeta = {
  title: string | null;
  fields: { label: string; value: string }[];
  legitimacy: string | null;
  body: string;
};

export const parseReport = parseReportUntyped as (md: string) => ReportMeta;
