import { NextResponse } from "next/server";
import os from "node:os";
import path from "node:path";
import { createUsageScanner } from "@/lib/claude-usage-scan.mjs";
import { desktopBinaries, readPlanUsage } from "@/lib/claude-plan-usage.mjs";
import { findBin } from "@/lib/clis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Two sources. Plan limits come from `claude -p "/usage"` (real percentages
// and reset times; lib/claude-plan-usage.mjs). When no Claude binary answers,
// the estimate below is used: Claude Code's per-message usage across ALL
// projects (~/.claude/projects/**/*.jsonl) summed over the rolling 5h and 7d
// windows. The estimate is cached 60s and scans incrementally with async fs
// (lib/claude-usage-scan.mjs); plan limits are cached 5 minutes, and a failed
// lookup is retried after 30s (keeping the last good plan) so a missing binary
// is not retried every poll.

type Usage = { window5h: { tokens: number; messages: number }; window7d: { tokens: number; messages: number }; computedAt: number };
type Plan = { rows: { label: string; percent: number; resets: string | null }[] } | null;
let cache: { at: number; data: Usage } | null = null;
// `ok` records whether the last refresh succeeded, apart from the retained plan:
// a failed refresh keeps the last good plan but must retry after PLAN_RETRY_MS.
let planCache: { at: number; plan: Plan; ok: boolean } | null = null;
let planInFlight: Promise<Plan> | null = null;

const PLAN_TTL_MS = 5 * 60_000;
// A failed lookup is retried sooner: a transient miss (slow start, timeout) must
// not pin the meter to the token estimate for the full TTL.
const PLAN_RETRY_MS = 30_000;
const scanner = createUsageScanner({ root: path.join(os.homedir(), ".claude", "projects") });

// Wait this long for a fresh plan lookup before answering with what is cached.
// A normal lookup takes under a second; a slow or hung one (each candidate binary
// can take up to its timeout) must not hold up the estimate or hide the meter.
const PLAN_GRACE_MS = 1500;

async function plan(): Promise<Plan> {
  if (planCache && Date.now() - planCache.at < (planCache.ok ? PLAN_TTL_MS : PLAN_RETRY_MS)) return planCache.plan;
  if (!planInFlight) {
    // `claude` via the same lookup the run routes use (PATH plus the usual install
    // dirs, PATHEXT on Windows), then the binary the Claude desktop app bundles.
    planInFlight = desktopBinaries()
      .then((desktop: string[]) => readPlanUsage({ candidates: [findBin("claude"), ...desktop].filter((b): b is string => !!b) }))
      .then((p: Plan) => {
        // Keep the last good answer through a failed refresh: slightly old real
        // percentages beat a token estimate that is on a different scale.
        planCache = { at: Date.now(), plan: p ?? planCache?.plan ?? null, ok: p !== null };
        return planCache.plan;
      })
      .finally(() => {
        planInFlight = null;
      });
  }
  // The lookup keeps running and fills the cache for later polls; if it is slow
  // the response carries the last known plan (or none, so the estimate shows).
  const stale = planCache?.plan ?? null;
  let timer: ReturnType<typeof setTimeout>;
  const grace = new Promise<Plan>((resolve) => {
    timer = setTimeout(() => resolve(stale), PLAN_GRACE_MS);
  });
  return Promise.race([planInFlight, grace]).finally(() => clearTimeout(timer));
}

export async function GET() {
  if (!cache || Date.now() - cache.at >= 60_000) {
    cache = { at: Date.now(), data: await scanner.compute() };
  }
  return NextResponse.json({ ...cache.data, plan: await plan() });
}
