import { NextResponse } from "next/server";
import os from "node:os";
import path from "node:path";
import { createUsageScanner } from "@/lib/claude-usage-scan.mjs";
import { readPlanUsage } from "@/lib/claude-plan-usage.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Two sources. Plan limits come from `claude -p "/usage"` (real percentages
// and reset times; lib/claude-plan-usage.mjs). When no Claude binary answers,
// the estimate below is used: Claude Code's per-message usage across ALL
// projects (~/.claude/projects/**/*.jsonl) summed over the rolling 5h and 7d
// windows. The estimate is cached 60s and scans incrementally with async fs
// (lib/claude-usage-scan.mjs); plan limits are cached 5 minutes, and a failed
// lookup is cached too so a missing binary is not retried every poll.

type Usage = { window5h: { tokens: number; messages: number }; window7d: { tokens: number; messages: number }; computedAt: number };
type Plan = { rows: { label: string; percent: number; resets: string | null }[] } | null;
let cache: { at: number; data: Usage } | null = null;
let planCache: { at: number; plan: Plan } | null = null;
let planInFlight: Promise<Plan> | null = null;

const PLAN_TTL_MS = 5 * 60_000;
const scanner = createUsageScanner({ root: path.join(os.homedir(), ".claude", "projects") });

async function plan(): Promise<Plan> {
  if (planCache && Date.now() - planCache.at < PLAN_TTL_MS) return planCache.plan;
  if (!planInFlight) {
    planInFlight = readPlanUsage()
      .then((p: Plan) => {
        planCache = { at: Date.now(), plan: p };
        return p;
      })
      .finally(() => {
        planInFlight = null;
      });
  }
  return planInFlight;
}

export async function GET() {
  if (!cache || Date.now() - cache.at >= 60_000) {
    cache = { at: Date.now(), data: await scanner.compute() };
  }
  return NextResponse.json({ ...cache.data, plan: await plan() });
}
