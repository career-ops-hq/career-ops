"use client";

import { useEffect, useState } from "react";
import { Bot, Circle, Clock3 } from "lucide-react";
import { ReefScene } from "@/components/ocean/reef-scene";
import { CurrentBar } from "@/components/ocean/current-bar";
import { openQueue } from "@/lib/auto-apply-live.mjs";

type Event = { ts?: string; type: string; url?: string; company?: string; role?: string; gate?: string; detail?: string; step?: string; confirmed?: boolean };
type Decision = { url: string; decision: "approve" | "skip"; ts: string };
type Snapshot = { status: { state: "running" | "idle" | "never"; counts: { submitted: number; queued: number; skipped: number } }; events: Event[]; latestScreenshot: string | null; latestSummary: { name: string; text: string } | null; decisions: Decision[] };

const labels: Record<string, string> = { run_start: "Run started", run_end: "Run finished", evaluate: "Evaluated", queue: "Queued", submit_start: "Submission started", page_step: "Page step", confirm: "Confirmation", error: "Error", "decision-applied": "Decision applied" };

export function AutoApplyLive() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [updated, setUpdated] = useState(0);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<Record<string, string>>({});
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const poll = async () => {
      if (document.hidden) { timer = setTimeout(poll, 2000); return; }
      try { const response = await fetch("/api/auto-apply/live", { cache: "no-store" }); if (!response.ok) throw new Error(); setData(await response.json()); setUpdated(Date.now()); setError(false); }
      catch { setError(true); }
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    const visibility = () => { if (!document.hidden) { clearTimeout(timer); void poll(); } };
    document.addEventListener("visibilitychange", visibility); void poll();
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  const state = data?.status.state ?? "never";
  const queued: Event[] = openQueue(data?.events ?? [], data?.decisions ?? []);
  const decisions = new Map((data?.decisions ?? []).map((item) => [item.url, item]));
  async function decide(url: string, decision: "approve" | "skip") {
    setPending(url); setDecisionError((current) => ({ ...current, [url]: "" }));
    setData((current) => current ? { ...current, decisions: [...current.decisions.filter((item) => item.url !== url), { url, decision, ts: new Date().toISOString() }] } : current);
    try {
      const response = await fetch("/api/auto-apply/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, decision }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save decision");
      setData((current) => current ? { ...current, decisions: payload.decisions } : current);
    } catch (cause) { setDecisionError((current) => ({ ...current, [url]: cause instanceof Error ? cause.message : "Could not save decision" })); }
    finally { setPending(null); }
  }
  const tone = state === "running" ? "text-emerald-700 bg-emerald-500/10" : state === "idle" ? "text-muted bg-muted/10" : "text-faint bg-muted/10";
  return <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
    <section className="dot-bg relative overflow-hidden rounded-2xl border border-border bg-surface/40 px-4 py-6 sm:px-8 sm:py-8">
      <ReefScene /><div aria-hidden className="pointer-events-none absolute inset-0 z-[1] bg-surface/60 backdrop-blur-[2px] dark:bg-background/50" />
      <div className="relative z-10">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">// automation monitor</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><h1 className="font-display text-3xl tracking-tight text-landing">Auto-apply</h1><span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm capitalize ${tone}`}><Circle size={8} fill="currentColor" />{state}</span></div>
        <p className="mt-2 max-w-2xl text-sm text-muted">Read-only live progress from the auto-apply runner. This page cannot submit applications.</p>
      </div>
    </section>
    <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,.85fr)]">
      <section className="rounded-2xl border border-border bg-surface/50 p-4 sm:p-6 lg:col-span-2"><h2 className="mb-4 font-display text-xl">Queued postings</h2>
        {!queued.length && <p className="text-sm text-muted">No queued postings are currently shown.</p>}
        <ul className="space-y-3">{queued.map((event) => { const decision = decisions.get(event.url!); return <li key={event.url} className="rounded-xl border border-border bg-background/40 p-3 sm:flex sm:items-center sm:justify-between sm:gap-4"><div className="min-w-0"><p className="break-all text-sm font-medium text-landing">{event.company}{event.company && event.role ? " · " : ""}{event.role}</p><a href={event.url} target="_blank" rel="noreferrer" className="break-all text-xs text-muted underline">{event.url}</a><p className="mt-1 text-xs text-muted">Decision: {decision?.decision === "approve" ? "approved" : "none"}</p>{decisionError[event.url!] && <p role="alert" className="mt-1 text-xs text-red-600">{decisionError[event.url!]}</p>}</div><div className="mt-3 flex shrink-0 gap-2 sm:mt-0"><button type="button" disabled={pending !== null} onClick={() => void decide(event.url!, "approve")} className="rounded-lg border border-brand/40 px-3 py-2 text-sm text-brand-text disabled:opacity-50">Approve</button><button type="button" disabled={pending !== null} onClick={() => void decide(event.url!, "skip")} className="rounded-lg border border-border px-3 py-2 text-sm text-muted disabled:opacity-50">Skip</button></div></li>; })}</ul>
      </section>
      <section className="rounded-2xl border border-border bg-surface/50 p-4 sm:p-6"><div className="mb-4 flex items-center gap-2"><Bot size={17} className="text-brand-text"/><h2 className="font-display text-xl">Run activity</h2></div>
        {error && <p role="status" className="mb-3 text-sm text-muted">Live status is temporarily unavailable.</p>}
        {data?.status.counts && state === "idle" && <div className="mb-5 grid gap-3"><CurrentBar label="Submitted" value={data.status.counts.submitted} max={Math.max(data.status.counts.submitted, 1)} /><CurrentBar label="Queued" value={data.status.counts.queued} max={Math.max(data.status.counts.queued, 1)} tone="secondary" /></div>}
        <ol className="space-y-0">{(data?.events ?? []).map((event, index) => <li key={`${event.ts}-${event.type}-${index}`} className="relative border-l border-border pb-5 pl-5 last:border-transparent last:pb-0"><span className="absolute -left-[5px] top-1 size-2 rounded-full bg-brand"/><div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1"><strong className="text-sm">{labels[event.type] ?? event.type}</strong><time className="inline-flex items-center gap-1 text-xs text-muted"><Clock3 size={12}/>{event.ts ? new Date(event.ts).toLocaleTimeString() : ""}</time></div>{(event.company || event.role) && <p className="mt-1 text-sm text-landing">{event.company}{event.company && event.role ? " · " : ""}{event.role}</p>}{(event.gate || event.detail || event.step) && <p className="mt-1 break-words text-sm text-muted">{[event.step, event.gate, event.detail].filter(Boolean).join(" · ")}</p>}</li>)}</ol>
        {!data?.events.length && <p className="text-sm text-muted">No bot activity recorded yet.</p>}
      </section>
      <div className="space-y-5">
        <section className="overflow-hidden rounded-2xl border border-border bg-surface/50 p-4 sm:p-5"><h2 className="mb-3 font-display text-xl">Latest page capture</h2>{data?.latestScreenshot ? <img src={`${data.latestScreenshot}?v=${updated}`} alt="Latest auto-apply page screenshot" className="max-h-[32rem] w-full rounded-lg border border-border object-contain"/> : <p className="text-sm text-muted">A screenshot appears after the runner processes a page.</p>}</section>
        <section className="rounded-2xl border border-border bg-surface/50 p-4 sm:p-5"><h2 className="mb-1 font-display text-xl">Daily summary</h2>{data?.latestSummary ? <><p className="mb-3 text-xs text-muted">{data.latestSummary.name}</p><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background/60 p-3 font-mono text-xs leading-relaxed text-muted">{data.latestSummary.text}</pre></> : <p className="mt-3 text-sm text-muted">No daily summary is available yet.</p>}</section>
      </div>
    </div>
  </main>;
}
