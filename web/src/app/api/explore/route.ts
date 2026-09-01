import { after } from "next/server";
import { NextRequest } from "next/server";
import fs from "node:fs";
import { runDiscovery } from "@/lib/core/scan";
import { addOffersToPipeline } from "@/lib/core/pipeline";
import { rootScript } from "@/lib/career-ops";
import { parseExplorePatch, DEFAULT_FILTERS, type DiscoveredOffer, type ScanEvent } from "@/lib/explore";
import { scannerMissingBody, SCANNER_MISSING_STATUS } from "@/lib/explore-error.mjs";

// Discovery is HTTP-bound across many ATS boards; give it room. It is FREE —
// zero LLM tokens. The scanner child is --dry-run; this route persists matches
// so a Next.js abort of the HTTP stream cannot drop them.
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

  if (!fs.existsSync(rootScript("scan-ats-full"))) {
    return Response.json(scannerMissingBody(), { status: SCANNER_MISSING_STATUS });
  }

  const encoder = new TextEncoder();
  const queued: unknown[] = [];
  let sink: ((obj: unknown) => void) | null = null;
  const send = (obj: unknown) => {
    if (sink) sink(obj);
    else queued.push(obj);
  };

  let persisted = false;
  const persist = async (offers: DiscoveredOffer[]) => {
    if (persisted || offers.length === 0) return 0;
    persisted = true;
    const result = await addOffersToPipeline(offers);
    return result.added ?? 0;
  };

  // Start the scanner when the POST arrives, not when the stream is pulled.
  // Next.js aborts the HTTP stream in ~100ms if Explore remounts; the child
  // must already be running so `after()` can await it and write pipeline.md.
  send({ kind: "start", ats: filters.ats, sinceDays: filters.sinceDays, limit: filters.limitPerAts, free: true } satisfies ScanEvent);
  const offersPromise = runDiscovery(filters, (e: ScanEvent) => send(e));

  const stream = new ReadableStream({
    start(controller) {
      sink = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          sink = null;
        }
      };
      for (const obj of queued) sink(obj);
      queued.length = 0;
      void offersPromise
        .then(async (offers) => {
          let saved = 0;
          try {
            saved = await persist(offers);
          } catch (err) {
            send({ kind: "error", message: err instanceof Error ? err.message : "could not save matches" } satisfies ScanEvent);
          }
          send({ kind: "done", count: offers.length, offers, saved, cost: { tokens: 0, usd: 0 } } satisfies ScanEvent);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        })
        .catch((err) => {
          send({ kind: "error", message: err instanceof Error ? err.message : "discovery failed" } satisfies ScanEvent);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
    },
  });

  after(async () => {
    try {
      const offers = await offersPromise;
      await persist(offers);
    } catch {
      /* best-effort */
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
