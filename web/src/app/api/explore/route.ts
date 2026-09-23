import { NextRequest } from "next/server";
import fs from "node:fs";
import { runDiscovery } from "@/lib/core/scan";
import { rootScript } from "@/lib/career-ops";
import { parseExplorePatch, DEFAULT_FILTERS, type DiscoveredOffer, type ScanEvent } from "@/lib/explore";

// Discovery is HTTP-bound across many ATS boards; give it room. FREE — zero LLM
// tokens (the scanner only does HTTP + JSON, and --dry-run writes nothing). 900s
// matches the scan.ts workload-scaled budget cap (~14 min) so a legal full scan
// is never cut by the platform before its own kill boundary.
export const runtime = "nodejs";
export const maxDuration = 900;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* empty body → defaults */
  }

  const filters = parseExplorePatch(body, DEFAULT_FILTERS);

  // Guard: a data-only checkout (or pre-onboarding) has no scanner. Fail soft.
  if (!fs.existsSync(rootScript("scan-ats-full"))) {
    return Response.json(
      { error: "The discovery scanner isn't available in this checkout yet." },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* stream closed */
        }
      };
      send({ kind: "start", ats: filters.ats, sinceDays: filters.sinceDays, limit: filters.limitPerAts, free: true } satisfies ScanEvent);
      let offers: DiscoveredOffer[] = [];
      try {
        offers = await runDiscovery(filters, (e: ScanEvent) => send(e));
      } catch (err) {
        send({ kind: "error", message: err instanceof Error ? err.message : "discovery failed" } satisfies ScanEvent);
      }
      send({ kind: "done", count: offers.length, offers, cost: { tokens: 0, usd: 0 } } satisfies ScanEvent);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
