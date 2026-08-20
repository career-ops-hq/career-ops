import { normalizePipelineTab } from "@/lib/pipeline-tabs.mjs";
import { readDefaultPipelineTab, writeDefaultPipelineTab } from "@/lib/web-prefs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Pipeline page's default tab → config/profile.yml (`web.default_pipeline_tab`).
// GET  → the current default (INBOX when unset)
// POST {tab} → set it. Validated against the canonical tab list, so only a tab
// that actually exists can ever be written.

export async function GET() {
  return Response.json({ tab: readDefaultPipelineTab() });
}

export async function POST(req: Request) {
  let body: { tab?: unknown };
  try {
    body = (await req.json()) as { tab?: unknown };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const tab = normalizePipelineTab(body.tab);
  if (!tab) return Response.json({ error: "unknown tab" }, { status: 400 });
  try {
    writeDefaultPipelineTab(tab);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, tab });
}
