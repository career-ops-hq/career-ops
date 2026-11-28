import Link from "next/link";
import os from "node:os";
import path from "node:path";
import { Clock, Coins, Gauge, Layers, Lightbulb, Target } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { PlanLimits } from "@/components/usage/plan-limits";
import { buildReport, createSessionStore, resolveRange } from "@/lib/usage-report.mjs";

export const dynamic = "force-dynamic";

// Kept across requests: unchanged session logs are not re-read.
const sessions = createSessionStore({ root: path.join(os.homedir(), ".claude", "projects") });

type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number; total: number; usd: number };
type Run = Tokens & { id: string; kind: string; label: string; start: number; ms: number; family: string | null; failed: boolean };
type Report = {
  totals: Tokens;
  prevUsd: number | null;
  cachedPct: number;
  runCount: number;
  failed: number;
  totalMs: number;
  avgMs: number;
  scored: number;
  usdPerScored: number | null;
  series: { day: string; ts: number; usd: number }[];
  tips: string[];
  runs: Run[];
  byKind: (Tokens & { kind: string; label: string; runs: number; failed: number; ms: number })[];
  byFamily: (Tokens & { family: string; label: string })[];
};

const RANGES = [
  { id: "24h", label: "24 hours" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
];
const KIND_TONE: Record<string, string> = {
  batch: "bg-emerald-400",
  evaluation: "bg-sky-400",
  documents: "bg-yellow-300",
  assistant: "bg-pink-400",
  chat: "bg-brand",
  other: "bg-orange-300",
};
const FAMILY_TONE: Record<string, string> = { opus: "bg-brand", sonnet: "bg-sky-400", haiku: "bg-emerald-400" };
const KIND_SHORT: Record<string, string> = {
  batch: "Batch score",
  evaluation: "Evaluation",
  documents: "Documents",
  assistant: "Assistant",
  chat: "Chat session",
  other: "App run",
};

function usd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return n < 10 ? `$${n.toFixed(2)}` : `$${n.toFixed(0)}`;
}
function tokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return `${n}`;
}
function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
function when(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return time;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${time}`;
}

export default async function UsagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const range = resolveRange(params.range);
  const showAll = params.runs === "all";
  const report = buildReport(await sessions(), { range }) as unknown as Report;
  const { totals } = report;
  const change = report.prevUsd ? ((totals.usd - report.prevUsd) / report.prevUsd) * 100 : null;
  const maxKind = Math.max(0.0001, ...report.byKind.map((k) => k.usd));
  const maxFamily = Math.max(0.0001, ...report.byFamily.map((k) => k.usd));
  const maxDay = Math.max(0.0001, ...report.series.map((d) => d.usd));
  const rangeLabel = RANGES.find((r) => r.id === range)?.label.toLowerCase();
  const runs = showAll ? report.runs : report.runs.slice(0, 15);

  return (
    <PageFrame width="wide">
      <header className="flex flex-col gap-5 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-text">Operations / Usage</p>
          <h1 className="mt-2 font-display text-3xl tracking-tight text-landing sm:text-4xl">Where your Claude usage goes</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Tokens, time and cost for every career-ops run, read from Claude Code&apos;s session logs. Dollar amounts are what the same usage would cost at API prices; on a subscription it counts against your plan limits instead.
          </p>
        </div>
        <nav aria-label="Time range" className="flex gap-1 rounded-xl border border-border bg-surface/45 p-1">
          {RANGES.map((r) => (
            <Link
              key={r.id}
              href={r.id === "7d" ? "/usage" : `/usage?range=${r.id}`}
              aria-current={r.id === range ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${r.id === range ? "bg-surface-hover text-foreground" : "text-muted hover:text-foreground"}`}
            >
              {r.label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="mt-6 space-y-5">
        <Panel eyebrow="Plan" title="Subscription limits" icon={<Gauge className="size-4" />}>
          <PlanLimits />
        </Panel>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            label="API-price equivalent"
            value={usd(totals.usd)}
            icon={<Coins className="size-4" />}
            detail={change === null ? `last ${rangeLabel}` : `${change >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(change))}% vs previous ${rangeLabel} (${usd(report.prevUsd ?? 0)})`}
          />
          <MetricCard label="Tokens" value={tokens(totals.total)} icon={<Layers className="size-4" />} detail={`${Math.round(report.cachedPct)}% of input read from cache`} />
          <MetricCard label="Agent time" value={duration(report.totalMs)} icon={<Clock className="size-4" />} detail={report.runCount ? `${report.runCount} runs · avg ${duration(report.avgMs)}` : "no runs"} />
          <MetricCard label="Jobs scored" value={report.scored} icon={<Target className="size-4" />} detail={report.usdPerScored === null ? "batch + evaluations" : `${usd(report.usdPerScored)} per job`} />
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)]">
          <Panel eyebrow="Activity" title="Spend by activity" description="Each run is sorted by how it started: batch scoring, a dashboard button, the assistant, or you chatting in Claude Code.">
            {report.byKind.length ? (
              <div className="mt-5 space-y-3.5">
                {report.byKind.map((k) => (
                  <div key={k.kind} className="grid grid-cols-[minmax(120px,0.6fr)_minmax(80px,1fr)_auto] items-center gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-foreground">{k.label}</div>
                      <div className="text-[11px] text-faint">
                        {k.runs} run{k.runs === 1 ? "" : "s"}{k.failed ? ` (${k.failed} failed)` : ""} · {duration(k.ms)} · {tokens(k.total)} tok
                      </div>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-hover" aria-hidden="true">
                      <div className={`h-full rounded-full ${KIND_TONE[k.kind] ?? "bg-sky-400"}`} style={{ width: `${Math.max(1.5, (k.usd / maxKind) * 100)}%` }} />
                    </div>
                    <span className="min-w-24 text-right font-mono text-xs tabular-nums text-foreground">
                      {usd(k.usd)} <span className="text-faint">{totals.usd ? `${Math.round((k.usd / totals.usd) * 100)}%` : ""}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyData label="No runs in this range" detail="Pick a longer range, or run a scan or evaluation." />
            )}
          </Panel>

          <Panel eyebrow="Models" title="Spend by model" description="Opus costs about 40× Haiku per token.">
            {report.byFamily.length ? (
              <div className="mt-5 space-y-3.5">
                {report.byFamily.map((f) => (
                  <div key={f.family} className="grid grid-cols-[70px_minmax(80px,1fr)_auto] items-center gap-3">
                    <span className="text-xs text-foreground">{f.label}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-hover" aria-hidden="true">
                      <div className={`h-full rounded-full ${FAMILY_TONE[f.family] ?? "bg-sky-400"}`} style={{ width: `${Math.max(1.5, (f.usd / maxFamily) * 100)}%` }} />
                    </div>
                    <span className="min-w-28 text-right font-mono text-xs tabular-nums text-foreground">
                      {usd(f.usd)} <span className="text-faint">{tokens(f.total)}</span>
                    </span>
                  </div>
                ))}
                <TokenSplit t={totals} />
              </div>
            ) : (
              <EmptyData label="No model calls" detail="Nothing ran in this range." />
            )}
          </Panel>
        </div>

        <Panel eyebrow="Trend" title="Daily spend" description="API-price equivalent per day.">
          <div className="mt-5 flex h-36 items-end gap-1" role="img" aria-label="Daily spend chart">
            {report.series.map((d) => (
              <div key={d.day} className="group flex h-full min-w-0 flex-1 flex-col justify-end" title={`${d.day}: ${usd(d.usd)}`}>
                <div className="rounded-t bg-sky-400/80 transition-colors group-hover:bg-sky-300" style={{ height: d.usd ? `${Math.max(2, (d.usd / maxDay) * 100)}%` : "1px" }} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[10px] text-faint">
            <span>{report.series[0]?.day.slice(5)}</span>
            <span>max {usd(maxDay < 0.001 ? 0 : maxDay)}</span>
            <span>{report.series.at(-1)?.day.slice(5)}</span>
          </div>
        </Panel>

        <Panel eyebrow="Runs" title="Recent runs">
          {runs.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3 font-semibold">When</th>
                    <th className="py-2 pr-3 font-semibold">What</th>
                    <th className="py-2 pr-3 font-semibold">Job / prompt</th>
                    <th className="py-2 pr-3 font-semibold">Model</th>
                    <th className="py-2 pr-3 text-right font-semibold">Time</th>
                    <th className="py-2 pr-3 text-right font-semibold">Tokens</th>
                    <th className="py-2 text-right font-semibold">$</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-border/60 last:border-0">
                      <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-muted">{when(r.start)}</td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        <span className={`mr-2 inline-block size-1.5 rounded-full ${KIND_TONE[r.kind] ?? "bg-sky-400"}`} aria-hidden="true" />
                        {KIND_SHORT[r.kind] ?? r.kind}
                      </td>
                      <td className="max-w-[340px] truncate py-2 pr-3 text-muted" title={r.label}>
                        {r.failed ? <span className="text-red-300">failed, no model answer</span> : r.label || "—"}
                      </td>
                      <td className="py-2 pr-3 capitalize text-muted">{r.family ?? "—"}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{duration(r.ms)}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums" title={`in ${r.input} · out ${r.output} · cache read ${r.cacheRead} · cache write ${r.cacheWrite}`}>
                        {tokens(r.total)}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums text-foreground">{usd(r.usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {report.runs.length > 15 ? (
                <Link
                  href={`/usage?${new URLSearchParams({ ...(range !== "7d" ? { range } : {}), ...(showAll ? {} : { runs: "all" }) })}`}
                  className="mt-3 inline-block text-xs font-semibold text-brand-text hover:underline"
                >
                  {showAll ? "Show fewer" : `Show all ${report.runs.length} runs`}
                </Link>
              ) : null}
            </div>
          ) : (
            <EmptyData label="No runs in this range" detail="Pick a longer range." />
          )}
        </Panel>

        {report.tips.length ? (
          <Panel eyebrow="Tips" title="From your data" icon={<Lightbulb className="size-4" />}>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-muted">
              {report.tips.map((tip) => (
                <li key={tip} className="flex gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
                  {tip}
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </PageFrame>
  );
}

function TokenSplit({ t }: { t: Tokens }) {
  const parts = [
    { label: "Cache read", value: t.cacheRead, tone: "bg-emerald-400" },
    { label: "Cache write", value: t.cacheWrite, tone: "bg-yellow-300" },
    { label: "Input", value: t.input, tone: "bg-sky-400" },
    { label: "Output", value: t.output, tone: "bg-brand" },
  ];
  const total = Math.max(1, t.total);
  return (
    <div className="border-t border-border pt-4">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-hover" aria-hidden="true">
        {parts.map((p) => (
          <div key={p.label} className={p.tone} style={{ width: `${(p.value / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center gap-2 text-xs">
            <span className={`size-2 rounded-full ${p.tone}`} aria-hidden="true" />
            <span className="flex-1 text-muted">{p.label}</span>
            <span className="font-mono tabular-nums text-foreground">{tokens(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Panel({ eyebrow, title, description, icon, children }: { eyebrow: string; title: string; description?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface/55 p-4 sm:p-5">
      <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.17em] text-brand-text">
        {icon}
        {eyebrow}
      </p>
      <h2 className="mt-2 font-display text-xl tracking-tight text-landing">{title}</h2>
      {description && <p className="mt-1 max-w-xl text-xs leading-5 text-muted">{description}</p>}
      {children}
    </section>
  );
}

function MetricCard({ label, value, icon, detail }: { label: string; value: string | number; icon: React.ReactNode; detail: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface/45 p-4">
      <div className="flex items-center justify-between text-brand-text">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">{label}</span>
        {icon}
      </div>
      <div className="mt-3 font-display text-3xl tracking-tight text-landing tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] leading-4 text-faint">{detail}</div>
    </div>
  );
}

function EmptyData({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="mt-4 rounded-xl border border-dashed border-border bg-surface/30 px-4 py-6 text-center">
      <p className="font-display text-lg text-landing">{label}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted">{detail}</p>
    </div>
  );
}
