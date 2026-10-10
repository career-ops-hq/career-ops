import { pipelineSummary, readApplicationStatusLog, readStatusLog } from "@/lib/career-ops";
import { PipelineSankey } from "@/components/analytics/pipeline-sankey";
import { canonStatus } from "@/lib/format";
import { cumulativeProgressWithHistory } from "@/lib/funnel-tiles.mjs";
import { analyticsApplications } from "@/lib/analytics-data";
import { computeProgressMetrics, computeStatsMetrics, generateInsights, resolveAnalyticsTab } from "@/lib/analytics-metrics.mjs";
import { AnalyticsShell, AnalyticsView } from "@/components/analytics-view";
import { FunnelRates } from "@/components/analytics/funnel-rates";
import { SearchInsights } from "@/components/analytics/search-insights";

export const dynamic = "force-dynamic";

export default async function Analytics({ searchParams }: { searchParams: Promise<{ tab?: string | string[]; view?: string | string[] }> }) {
  const params = await searchParams;
  const { applications } = pipelineSummary();
  const view = Array.isArray(params.view) ? params.view[0] : params.view;
  // Keep main's linkable Insights view independent of Progress-only core reads.
  if (view === "insights") {
    return (
      <AnalyticsShell total={applications.length} tab="insights">
        <SearchInsights />
      </AnalyticsShell>
    );
  }
  const tab = resolveAnalyticsTab(params.tab);
  const enriched = analyticsApplications(applications);
  const achievements = tab === "progress" ? await cumulativeProgressWithHistory(
    applications.map((app) => ({ n: app.n, status: canonStatus(app.status) })),
    readApplicationStatusLog(),
  ) : undefined;
  const progress = computeProgressMetrics(enriched, achievements);
  const stats = computeStatsMetrics(enriched);
  const statusLog = readStatusLog();

  return (
    <AnalyticsView
      applications={enriched}
      progress={progress}
      stats={stats}
      insights={generateInsights(stats)}
      tab={tab}
      sankey={<PipelineSankey applications={applications} statusLog={statusLog} />}
      coreFunnel={tab === "progress" ? <FunnelRates /> : undefined}
    />
  );
}
