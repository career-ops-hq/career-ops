import { NextResponse } from "next/server";
import { readApplications } from "@/lib/career-ops";
import { demoteStatus, promoteStatus } from "@/lib/tracker-funnel";
import { runStatusUpdate } from "@/lib/core/status-update";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BulkBody = {
  ids?: (string | number)[];
  action?: "promote" | "demote";
};

// Bulk promote/demote: reads current tracker rows, advances or retreats each
// selected application one funnel step via set-status / outcome scripts.
export async function POST(req: Request) {
  let body: BulkBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const action = body.action;
  if (action !== "promote" && action !== "demote") {
    return NextResponse.json({ error: "action must be promote or demote" }, { status: 400 });
  }

  const ids = (body.ids ?? []).map((id) => String(id).trim()).filter((id) => /^\d+$/.test(id));
  if (!ids.length) return NextResponse.json({ error: "ids required" }, { status: 400 });

  const apps = readApplications();
  const byNum = new Map(apps.map((a) => [a.n, a]));
  const results: { n: string; from: string; to: string; ok: boolean; error?: string }[] = [];

  for (const n of ids) {
    const row = byNum.get(n);
    if (!row) {
      results.push({ n, from: "?", to: "?", ok: false, error: "not found" });
      continue;
    }
    const next = action === "promote" ? promoteStatus(row.status) : demoteStatus(row.status);
    if (!next) {
      results.push({ n, from: row.status, to: "—", ok: false, error: "no transition" });
      continue;
    }
    if (next === row.status) {
      results.push({ n, from: row.status, to: next, ok: true });
      continue;
    }
    const { result, error } = runStatusUpdate({ n, status: next });
    if (result) {
      results.push({ n, from: row.status, to: result.status, ok: true });
    } else {
      results.push({ n, from: row.status, to: next, ok: false, error: error || "update failed" });
    }
  }

  const changed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  return NextResponse.json({ ok: failed === 0, action, changed, failed, results });
}
