"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";

type SourceKey = "portal-scan" | "apify" | "linkedin-alerts" | "linkedin-verify";

const SOURCES: { key: SourceKey; label: string; endpoint: string; costNote: string }[] = [
  { key: "portal-scan", label: "Portal scan (job boards)", endpoint: "/api/portals/run-scan", costNote: "zero AI tokens — runs scan.mjs (RSS, APIs, Playwright boards like Instahyre / Wellfound)" },
  { key: "apify", label: "Apify (LinkedIn)", endpoint: "/api/portals/run-apify", costNote: "spends a few Apify credits, not AI tokens" },
  { key: "linkedin-alerts", label: "LinkedIn alerts (Gmail)", endpoint: "/api/plugins/run-linkedin-alerts", costNote: "reads Gmail — no cost, no AI tokens" },
  { key: "linkedin-verify", label: "Verify LinkedIn titles", endpoint: "/api/plugins/enrich-linkedin-jobs", costNote: "one-shot via Cursor CLI (cursor-agent) — fixes all LinkedIn digest title mismatches in batch/" },
];

// Zero-token scan triggers with no other UI entry point: full scan.mjs (tracked
// companies + job_boards), Apify-provider entries, and linkedin-alerts ingest.
// All are plain `node <script>.mjs` subprocess calls (run-core-script.ts) —
// no AI CLI involved, unlike the Portals/AI-search tabs on Explore.
export function SourcesPanel() {
  const router = useRouter();
  const [running, setRunning] = useState<SourceKey | null>(null);
  const [result, setResult] = useState<{ key: SourceKey; headline: string; output: string; ok: boolean } | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function run(source: (typeof SOURCES)[number]) {
    if (running) return;
    setRunning(source.key);
    setResult(null);
    setExpanded(false);
    try {
      const res = await fetch(source.endpoint, { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as { output?: string; error?: string; exitCode?: number | null };
      const output = d.output || d.error || "(no output)";
      setResult({ key: source.key, headline: summarize(output, d.error), output, ok: res.ok });
      if (res.ok) {
        router.refresh();
        window.dispatchEvent(new CustomEvent("co-job-done", { detail: { kind: "sources-run" } }));
      }
    } catch (e) {
      setResult({ key: source.key, headline: e instanceof Error ? e.message : "Request failed", output: "", ok: false });
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="mt-3 rounded-2xl border border-border bg-surface/30 p-4">
      <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-brand">
        <RefreshCw className="size-3.5" /> Check your other sources
      </div>
      <div className="flex flex-wrap gap-2">
        {SOURCES.map((s) => (
          <button
            key={s.key}
            type="button"
            disabled={!!running}
            onClick={() => run(s)}
            title={s.costNote}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-brand-soft hover:text-brand disabled:opacity-50"
          >
            {running === s.key ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Run {s.label}
          </button>
        ))}
      </div>

      {result && (
        <div className="mt-3 rounded-xl border border-border bg-surface/40">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-xs", result.ok ? "text-foreground" : "text-amber-600 dark:text-amber-300")}
          >
            <span className="flex-1">{result.headline}</span>
            <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")} />
          </button>
          {expanded && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-border p-3 text-[11px] leading-relaxed text-muted">
              {result.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// Best-effort one-line summary of scan.mjs / plugins.mjs's human-readable
// stdout — falls back to the raw text (truncated) if nothing recognizable
// matches, so an unexpected output shape never renders as an empty headline.
function summarize(output: string, error?: string): string {
  if (error) return error;
  const added = output.match(/New offers added:\s*(\d+)/) || output.match(/Appended (\d+) to data\/pipeline\.md/);
  const found = output.match(/(\d+) found,\s*(\d+) new/);
  const enriched = output.match(/Pipeline title fix:\s*(\d+)/);
  const cliEnriched = output.match(/All LinkedIn title-fix batches complete/);
  const batchUpdated = output.match(/DONE batch \d+ updated=(\d+)/g);
  if (added) return `${added[1]} new offer${added[1] === "1" ? "" : "s"} added to your pipeline.`;
  if (found) return `${found[1]} found, ${found[2]} new — added to your pipeline.`;
  if (cliEnriched && batchUpdated) {
    const total = batchUpdated.reduce((n, line) => n + parseInt(line.match(/updated=(\d+)/)?.[1] ?? "0", 10), 0);
    return `${total} LinkedIn inbox row(s) updated via Cursor CLI title verify.`;
  }
  if (enriched) return `${enriched[1]} LinkedIn inbox row(s) updated to match live job pages.`;
  if (/missing env|not set|not enabled|isn'?t available/i.test(output)) return output.trim().split("\n").pop() || output.slice(0, 140);
  const firstLine = output.trim().split("\n").find(Boolean);
  return firstLine ? firstLine.slice(0, 140) : "Done — no summary line recognized, see raw output.";
}
