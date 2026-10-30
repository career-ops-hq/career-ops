import { readApplications, readApplicationStatusLog, readStatusLog, type Application } from "@/lib/career-ops";
import { PipelineSankey } from "@/components/analytics/pipeline-sankey";
import { canonStatus } from "@/lib/format";
import { cumulativeProgressWithHistory } from "@/lib/funnel-tiles.mjs";
import { analyticsApplications } from "@/lib/analytics-data";
import { computeProgressMetrics, computeStatsMetrics, generateInsights, resolveAnalyticsView } from "@/lib/analytics-metrics.mjs";
import { AnalyticsShell, ProgressPanel, StatsPanel } from "@/components/analytics-view";
import { FunnelRates } from "@/components/analytics/funnel-rates";
import { SearchInsights } from "@/components/analytics/search-insights";

export const dynamic = "force-dynamic";

export default async function Analytics({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // Not pipelineSummary: besides the tracker it parses all of
  // data/scan-history.tsv (append-only, one row per posting ever seen) to date
  // the inbox, and no analytics view reads the inbox.
  const applications = readApplications();
  // One URL contract for all three views. Each view owns its reads, as on main:
  // an incomplete Progress core install must not take Insights/Search stats down.
  const view = resolveAnalyticsView(params.view);
  return (
    <AnalyticsShell total={applications.length} view={view}>
      {view === "insights" ? <SearchInsights /> : view === "search-stats" ? <SearchStatsView applications={applications} /> : <ProgressView applications={applications} />}
    </AnalyticsShell>
  );
}

async function ProgressView({ applications }: { applications: Application[] }) {
  const achievements = await cumulativeProgressWithHistory(
    applications.map((app) => ({ n: app.n, status: canonStatus(app.status) })),
    readApplicationStatusLog(),
  );
  return (
    <>
      <ProgressPanel metrics={computeProgressMetrics(applications, achievements)} />
      <PipelineSankey applications={applications} statusLog={readStatusLog()} />
      <FunnelRates />
    </>
  );
}

function SearchStatsView({ applications }: { applications: Application[] }) {
  const stats = computeStatsMetrics(analyticsApplications(applications));
  return <StatsPanel metrics={stats} insights={generateInsights(stats)} />;
}
