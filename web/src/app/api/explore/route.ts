import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { employerRequest, CHINA_PRESET } from "@/lib/employer-preset.mjs";
import { runEmployerDiscovery } from "@/lib/core/employer-discovery.mjs";
import { runDiscovery } from "@/lib/core/scan";
import { rootScript } from "@/lib/career-ops";
import { parseExplorePatch, DEFAULT_FILTERS, ATS_SOURCES, type DiscoveredOffer, type ScanEvent } from "@/lib/explore";
import { scannerMissingBody, SCANNER_MISSING_STATUS } from "@/lib/explore-error.mjs";
import { readJsonObject } from "@/lib/json-body";
import { careerOpsRoot } from "@/lib/career-ops";
import { runWebsiteDiscovery } from "@/lib/core/website-discovery.mjs";
import { normalizeUrl } from "@/lib/core/url-key.mjs";

// Discovery is HTTP-bound across many ATS boards; give it room. It is FREE —
// zero LLM tokens (the scanner only does HTTP + JSON, and --dry-run writes nothing).
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await readJsonObject(req)) ?? {};

  const employer = body.preset === CHINA_PRESET;
  // Validate the raw source selection before the forgiving legacy filter codec.
  if (body.preset && !employer) return Response.json({ error: "Unknown discovery preset." }, { status: 400 });
  if (employer) {
    try { employerRequest(body); }
    catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Invalid sources" }, { status: 400 }); }
  }
  if (body.websiteIds !== undefined && (!Array.isArray(body.websiteIds) || body.websiteIds.length > 20 ||
    body.websiteIds.some(id => typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)))) {
    return Response.json({ error: "Select up to 20 saved websites." }, { status: 400 });
  }
  if (!employer && body.ats !== undefined && (!Array.isArray(body.ats) || body.ats.some(id => typeof id !== "string" || !(ATS_SOURCES as string[]).includes(id)))) {
    return Response.json({ error: "Choose only supported ATS sources." }, { status: 400 });
  }
  const filters = parseExplorePatch(body, DEFAULT_FILTERS);
  if (!employer && !filters.ats.length && !filters.websiteIds.length) {
    return Response.json({ error: "Select at least one discovery source." }, { status: 400 });
  }

  // Guard: a data-only checkout (or pre-onboarding) has no scanner. Fail soft.
  // The body carries an explicit code because 400 is a shared channel: the
  // client cannot tell this apart from a malformed request by status alone.
  if ((employer || filters.ats.length > 0) && !fs.existsSync(rootScript(employer ? "scan" : "scan-ats-full"))) {
    return Response.json(scannerMissingBody(), { status: SCANNER_MISSING_STATUS });
  }
  if (!employer && filters.websiteIds.length && !fs.existsSync(rootScript("portal-monitor"))) {
    return Response.json({ error: "The saved website reader is unavailable." }, { status: 503 });
  }

  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });
  if (req.signal.aborted) abort.abort();
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
      send({ kind: "start", ats: employer ? filters.employers ?? [] : filters.ats, sinceDays: employer ? 0 : filters.sinceDays, limit: employer ? 0 : filters.limitPerAts, free: true } satisfies ScanEvent);
      let offers: DiscoveredOffer[] = [];
      try {
        if (employer) {
          offers = await runEmployerDiscovery(body, { codeRoot: path.dirname(rootScript("scan")), signal: abort.signal, onEvent: (e: ScanEvent) => send(e) });
        } else {
          const seen = new Set<string>();
          let summary: Extract<ScanEvent, { kind: "summary" }> | null = null;
          const problems: string[] = [];
          const addOffer = (offer: DiscoveredOffer) => {
            const key = normalizeUrl(offer.url);
            if (!key || seen.has(key)) return;
            seen.add(key);
            offers.push(offer);
            send({ kind: "offer", offer } satisfies ScanEvent);
          };
          const onAtsEvent = (event: ScanEvent) => {
            if (event.kind === "offer") addOffer(event.offer);
            else if (event.kind === "summary") summary = event;
            else if (event.kind === "error") problems.push(event.message);
            else send(event);
          };
          let websitesSearched = 0, unknownDates = 0;
          const websiteFailures: string[] = [];
          const atsTask = filters.ats.length ? runDiscovery(filters, onAtsEvent).then(
            found => found.forEach(addOffer),
            error => { problems.push(error instanceof Error ? error.message : "ATS search failed."); },
          ) : Promise.resolve();
          // Bound concurrency but report each source as it completes, so one
          // slow website or ATS sweep never hides already-discovered results.
          const remaining = [...filters.websiteIds];
          const websiteWorker = async () => {
            for (;;) {
              const id = remaining.shift();
              if (!id || abort.signal.aborted) return;
              send({ kind: "websiteStart", id } satisfies ScanEvent);
              try {
                const result = await runWebsiteDiscovery(rootScript("portal-monitor"), careerOpsRoot(),
                  { ...filters, websiteIds: [id] }, { signal: abort.signal }) as {
                    offers: Array<{ url: string; title: string; company: string; location: string; postedAt?: number; sourceId: string; sourceName: string; source: string }>;
                    failures: Array<{ id: string; name: string; error: string }>;
                    searched: Array<{ id: string; name: string; count: number }>;
                  };
                websitesSearched += result.searched.length;
                for (const source of result.searched) send({ kind: "websiteDone", ...source } satisfies ScanEvent);
                for (const failure of result.failures) {
                  websiteFailures.push(failure.name);
                  problems.push(`${failure.name}: ${failure.error}`);
                  send({ kind: "websiteDone", ...failure, count: 0 } satisfies ScanEvent);
                }
                for (const job of result.offers) {
                  const epoch = typeof job.postedAt === "number" ? job.postedAt : NaN;
                  const date = new Date(epoch);
                  const hasDate = Number.isFinite(date.getTime());
                  const key = normalizeUrl(job.url);
                  const wasSeen = !key || seen.has(key);
                  addOffer({ url: job.url, title: job.title, company: job.company,
                    location: job.location || "", postedAt: hasDate ? date.toISOString().slice(0, 10) : "",
                    ats: job.sourceName, source: job.source, sourceLabel: job.sourceName, ...(!hasDate ? { postedHint: "Date unknown" } : {}) });
                  if (!wasSeen && !hasDate) unknownDates++;
                }
              } catch (error) {
                const reason = error instanceof Error ? error.message : "Website search failed.";
                problems.push(reason);
                websiteFailures.push(id);
                send({ kind: "websiteDone", id, name: "Website", count: 0, error: reason } satisfies ScanEvent);
              }
            }
          };
          await Promise.all([atsTask, ...Array.from({ length: Math.min(3, remaining.length) }, websiteWorker)]);
          const atsSummary = summary as Extract<ScanEvent, { kind: "summary" }> | null;
          send({ kind: "summary", companiesScanned: atsSummary?.companiesScanned || 0,
            unreachable: (atsSummary?.unreachable || 0) + websiteFailures.length,
            matches: offers.length, websitesSearched,
            ...(atsSummary?.companiesAvailable !== undefined ? { companiesAvailable: atsSummary.companiesAvailable } : {}),
            ...(atsSummary?.capHit ? { capHit: true } : {}),
            ...(atsSummary?.datasetStatus ? { datasetStatus: atsSummary.datasetStatus } : {}),
            ...(atsSummary?.postingsDroppedNoDate ? { postingsDroppedNoDate: atsSummary.postingsDroppedNoDate } : {}),
            ...(unknownDates ? { websitesUndated: unknownDates } : {}),
            ...((atsSummary?.incomplete?.length || websiteFailures.length) ? { incomplete: [...(atsSummary?.incomplete || []), ...websiteFailures] } : {})
          } satisfies ScanEvent);
          if (problems.length) send({ kind: "error", message: problems.join(" · ") } satisfies ScanEvent);
        }
      } catch (err) {
        send({ kind: "error", message: err instanceof Error ? err.message : "discovery failed" } satisfies ScanEvent);
      }
      send({ kind: "done", count: offers.length, offers, cost: { tokens: 0, usd: 0 } } satisfies ScanEvent);
      controller.close();
    },
    cancel() { abort.abort(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
