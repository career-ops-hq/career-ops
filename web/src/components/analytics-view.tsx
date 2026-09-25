import Link from "next/link";
import { ArrowUpRight, BarChart3, BriefcaseBusiness, CircleDollarSign, MapPin, Sparkles, Target } from "lucide-react";
import type { AnalyticsApplication } from "@/lib/analytics-data";
import { PageFrame } from "@/components/page-frame";

type ProgressMetrics = {
  tracked: number;
  avgScore: number;
  activeApps: number;
  totalOffers: number;
  responseRate: number;
  interviewRate: number;
  offerRate: number;
  funnel: { label: string; count: number; pct: number }[];
  scoreDistribution: { label: string; count: number; pct: number }[];
  weeklyActivity: { week: string; shortWeek: string; count: number }[];
};

type StatsMetrics = {
  archetypes: { label: string; count: number; pct: number; avgScore: number }[];
  workModes: { label: string; count: number; pct: number }[];
  locations: { label: string; count: number; pct: number }[];
  qualityTiers: { label: string; count: number; pct: number }[];
  qualityBarPct: number;
  seniorityMix: { label: string; count: number; pct: number }[];
  pay: { count: number; postedCount: number; estimatedCount: number; avgPayMax: number; medianPayMax: number; maxPayMax: number };
  payHistogram: { label: string; count: number; pct: number }[];
};

const BAR_TONES = ["bg-brand", "bg-sky-400", "bg-emerald-400", "bg-yellow-300", "bg-orange-300", "bg-pink-400"];

export function AnalyticsView({
  applications,
  progress,
  stats,
  insights,
  tab,
}: {
  applications: AnalyticsApplication[];
  progress: ProgressMetrics;
  stats: StatsMetrics;
  insights: string[];
  tab: "progress" | "search-stats";
}) {
  return (
    <PageFrame>
      <header className="flex flex-col gap-5 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-brand">Operations / Analytics</p>
          <h1 className="mt-2 font-display text-3xl tracking-tight text-landing sm:text-4xl">Search intelligence</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            A read on the roles you are pursuing, the funnel they move through, and the patterns worth acting on.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-faint">
          <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
          <span className="tabular-nums">{applications.length}</span> tracked evaluations
        </div>
      </header>

      <nav aria-label="Analytics views" className="mt-5 -mb-px flex gap-1 overflow-x-auto border-b border-border">
        <AnalyticsTab href="/analytics?tab=progress" active={tab === "progress"} icon={<BarChart3 className="size-3.5" />}>
          Search progress
        </AnalyticsTab>
        <AnalyticsTab href="/analytics?tab=search-stats" active={tab === "search-stats"} icon={<Target className="size-3.5" />}>
          Search stats
        </AnalyticsTab>
      </nav>

      {tab === "progress" ? <ProgressPanel metrics={progress} /> : <StatsPanel metrics={stats} insights={insights} />}
    </PageFrame>
  );
}

function AnalyticsTab({ href, active, icon, children }: { href: string; active: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-xs font-semibold transition-colors ${
        active ? "border-brand text-foreground" : "border-transparent text-muted hover:border-border hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </Link>
  );
}

function ProgressPanel({ metrics }: { metrics: ProgressMetrics }) {
  const maxWeeklyActivity = Math.max(1, ...metrics.weeklyActivity.map((row) => row.count));
  return (
    <div className="mt-6 space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Tracked" value={metrics.tracked} icon={<BarChart3 className="size-4" />} />
        <MetricCard label="Average score" value={metrics.avgScore ? `${metrics.avgScore.toFixed(2)}/5` : "—"} icon={<Sparkles className="size-4" />} />
        <MetricCard label="Active applications" value={metrics.activeApps} icon={<BriefcaseBusiness className="size-4" />} />
        <MetricCard label="Offers" value={metrics.totalOffers} icon={<ArrowUpRight className="size-4" />} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.85fr)]">
        <Panel eyebrow="Funnel" title="Pipeline progress" description="Cumulative roles that reached each stage.">
          <div className="mt-5 space-y-3.5">
            {metrics.funnel.map((stage, index) => (
              <BarRow key={stage.label} label={stage.label} count={stage.count} pct={stage.pct} widthPct={metrics.tracked ? (stage.count / metrics.tracked) * 100 : 0} tone={index === metrics.funnel.length - 1 ? "bg-brand" : "bg-sky-400"} />
            ))}
          </div>
        </Panel>

        <Panel eyebrow="Conversion" title="Rates that matter" description="Response, interview and offer rates use Applied as the denominator.">
          <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3 xl:grid-cols-1 xl:gap-0">
            <RateRow label="Response" value={metrics.responseRate} />
            <RateRow label="Interview" value={metrics.interviewRate} />
            <RateRow label="Offer" value={metrics.offerRate} />
          </div>
          <div className="mt-5 border-t border-border pt-4 text-xs text-muted">
            <span className="tabular-nums text-foreground">{metrics.activeApps}</span> active applications · <span className="tabular-nums text-foreground">{metrics.totalOffers}</span> total offers
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel eyebrow="Fit quality" title="Score distribution" description="Only scored evaluations are included.">
          <div className="mt-5 space-y-3">
            {metrics.scoreDistribution.map((bucket, index) => <BarRow key={bucket.label} label={bucket.label} count={bucket.count} pct={bucket.pct} widthPct={bucket.pct} tone={BAR_TONES[index]} />)}
          </div>
        </Panel>
        <Panel eyebrow="Cadence" title="Weekly activity" description="The latest eight populated ISO weeks.">
          {metrics.weeklyActivity.length ? (
            <div className="mt-5 space-y-3">
              {metrics.weeklyActivity.map((week) => {
                return <BarRow key={week.week} label={week.shortWeek} count={week.count} widthPct={(week.count / maxWeeklyActivity) * 100} tone="bg-sky-400" />;
              })}
            </div>
          ) : <EmptyData label="No dated activity yet" detail="Weekly activity will appear once evaluations have valid dates." />}
        </Panel>
      </div>
    </div>
  );
}

function StatsPanel({ metrics, insights }: { metrics: StatsMetrics; insights: string[] }) {
  const scoredRoleCount = metrics.qualityTiers.reduce((sum, row) => sum + row.count, 0);
  return (
    <div className="mt-6 space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Panel eyebrow="Signal" title="Strategic insights" icon={<Sparkles className="size-4" />}>
          {insights.length ? <ul className="mt-4 space-y-3 text-sm leading-6 text-muted">{insights.map((insight) => <li key={insight} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />{insight}</li>)}</ul> : <EmptyData label="Not enough signal yet" detail="Insights appear as archetype, work-mode and pay data accumulate." />}
        </Panel>
        <Panel eyebrow="Fit quality" title="How many roles clear the bar" description="Scored roles grouped by the evaluation threshold.">
          <div className="mt-4 flex items-end justify-between gap-4">
            <div className="font-display text-4xl tracking-tight text-landing">{scoredRoleCount ? `${Math.round(metrics.qualityBarPct)}%` : "—"}</div>
            <div className="text-right text-xs text-muted">meet ≥4.0<br /><span className="tabular-nums">{scoredRoleCount}</span> scored roles</div>
          </div>
          <Distribution rows={metrics.qualityTiers} />
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
        <Panel eyebrow="Archetypes" title="Where the search is pointed" description="Canonical role families, ranked by volume and annotated with fit.">
          {metrics.archetypes.length ? <div className="mt-4 space-y-3">{metrics.archetypes.map((row, index) => <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_minmax(100px,0.8fr)_auto] items-center gap-3 text-sm"><div className="min-w-0"><div className="break-words text-foreground">{row.label}</div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-hover"><div className={`h-full rounded-full ${BAR_TONES[index % BAR_TONES.length]}`} style={{ width: `${Math.max(row.pct, row.count ? 3 : 0)}%` }} /></div></div><div className="text-right text-xs text-muted tabular-nums">{row.count} <span className="text-faint">({Math.round(row.pct)}%)</span></div><div className="min-w-14 text-right text-xs font-semibold tabular-nums text-brand">{row.avgScore ? `★ ${row.avgScore.toFixed(1)}` : "—"}</div></div>)}</div> : <EmptyData label="No archetype data" detail="Reports with archetype metadata will populate this view." />}
        </Panel>
        <Panel eyebrow="Seniority" title="Role mix" icon={<BriefcaseBusiness className="size-4" />}>
          <Distribution rows={metrics.seniorityMix} emptyLabel="No role seniority data" />
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel eyebrow="Work mode" title="How roles are structured"><BreakdownList rows={metrics.workModes} icon={<BriefcaseBusiness className="size-3.5" />} emptyLabel="No work-mode data" /></Panel>
        <Panel eyebrow="Location" title="Where roles are based"><BreakdownList rows={metrics.locations} icon={<MapPin className="size-3.5" />} emptyLabel="No location data" /></Panel>
      </div>

      <Panel eyebrow="Compensation" title="USD pay range and salary bands" icon={<CircleDollarSign className="size-4" />}>
        {metrics.pay.count ? <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <PayStat label="Average" value={money(metrics.pay.avgPayMax)} />
            <PayStat label="Median" value={money(metrics.pay.medianPayMax)} />
            <PayStat label="Peak" value={money(metrics.pay.maxPayMax)} />
            <PayStat label="Data points" value={metrics.pay.count} />
            <PayStat label="Posted / est." value={`${metrics.pay.postedCount} / ${metrics.pay.estimatedCount}`} />
          </div>
          <div className="mt-6 border-t border-border pt-5"><p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Salary band distribution</p><div className="mt-4 space-y-3">{metrics.payHistogram.map((row, index) => <BarRow key={row.label} label={row.label} count={row.count} pct={row.pct} widthPct={row.pct} tone={BAR_TONES[index]} />)}</div></div>
        </> : <EmptyData label="No USD compensation data" detail="Pay appears when tracker notes contain a USD-denominated posted or estimated range." />}
      </Panel>
    </div>
  );
}

function Panel({ eyebrow, title, description, icon, children }: { eyebrow: string; title: string; description?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-border bg-surface/55 p-4 sm:p-5"><div className="flex items-start justify-between gap-4"><div><p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.17em] text-brand">{icon}{eyebrow}</p><h2 className="mt-2 font-display text-xl tracking-tight text-landing">{title}</h2>{description && <p className="mt-1 max-w-xl text-xs leading-5 text-muted">{description}</p>}</div></div>{children}</section>;
}

function MetricCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-surface/45 p-4"><div className="flex items-center justify-between text-brand"><span className="font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">{label}</span>{icon}</div><div className="mt-3 font-display text-3xl tracking-tight text-landing tabular-nums">{value}</div></div>;
}

function RateRow({ label, value }: { label: string; value: number }) {
  return <div className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-0 xl:first:pt-0"><span className="text-sm text-muted">{label} rate</span><span className="font-mono text-lg font-semibold tabular-nums text-foreground">{value.toFixed(1)}%</span></div>;
}

function BarRow({ label, count, pct, widthPct, tone }: { label: string; count: number; pct?: number; widthPct: number; tone: string }) {
  const accessibleValue = pct === undefined ? `${label}: ${count}` : `${label}: ${count}, ${Math.round(pct)} percent`;
  return <div className="grid grid-cols-[minmax(94px,0.45fr)_minmax(80px,1fr)_auto] items-center gap-3"><span className="break-words text-xs text-muted" title={label}>{label}</span><div className="h-2 overflow-hidden rounded-full bg-surface-hover" role="img" aria-label={accessibleValue}><div className={`h-full rounded-full ${tone} transition-[width] duration-500`} style={{ width: `${Math.min(100, Math.max(0, widthPct))}%` }} /></div><span className="min-w-16 text-right font-mono text-xs tabular-nums text-foreground">{count}{pct === undefined ? null : <> <span className="text-faint">({Math.round(pct)}%)</span></>}</span></div>;
}

function Distribution({ rows, emptyLabel = "No distribution data" }: { rows: { label: string; count: number; pct: number }[]; emptyLabel?: string }) {
  if (!rows.length) return <EmptyData label={emptyLabel} detail="More evaluated roles are needed to show this breakdown." />;
  return <div className="mt-5"><div className="flex h-3 overflow-hidden rounded-full bg-surface-hover" aria-hidden="true">{rows.map((row, index) => <div key={row.label} className={BAR_TONES[index % BAR_TONES.length]} style={{ width: `${row.pct}%` }} />)}</div><div className="mt-4 grid gap-2 sm:grid-cols-2">{rows.map((row, index) => <div key={row.label} className="flex items-center gap-2 text-xs"><span className={`size-2 rounded-full ${BAR_TONES[index % BAR_TONES.length]}`} aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-muted">{row.label}</span><span className="font-mono tabular-nums text-foreground">{row.count} <span className="text-faint">({Math.round(row.pct)}%)</span></span></div>)}</div></div>;
}

function BreakdownList({ rows, icon, emptyLabel }: { rows: { label: string; count: number; pct: number }[]; icon: React.ReactNode; emptyLabel: string }) {
  if (!rows.length) return <EmptyData label={emptyLabel} detail="This dimension is not present in the available reports." />;
  return <div className="mt-4 space-y-3">{rows.map((row, index) => <div key={row.label} className="flex items-center gap-2 text-sm"><span className="text-brand">{icon}</span><span className="min-w-0 flex-1 break-words text-muted">{row.label}</span><span className="font-mono text-xs tabular-nums text-foreground">{row.count}</span><span className="w-12 text-right font-mono text-[11px] tabular-nums text-faint">{Math.round(row.pct)}%</span></div>)}</div>;
}

function PayStat({ label, value }: { label: string; value: string | number }) { return <div><p className="text-[11px] text-faint">{label}</p><p className="mt-1 font-mono text-sm font-semibold tabular-nums text-foreground">{value}</p></div>; }
function EmptyData({ label, detail }: { label: string; detail: string }) { return <div className="mt-4 rounded-xl border border-dashed border-border bg-surface/30 px-4 py-6 text-center"><p className="font-display text-lg text-landing">{label}</p><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted">{detail}</p></div>; }
function money(value: number) { return value ? `$${Math.round(value / 1000)}K` : "—"; }
