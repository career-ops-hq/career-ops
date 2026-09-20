import { pipelineSummary, readStatusLog } from "@/lib/career-ops";
import { PipelineSankey } from "@/components/analytics/pipeline-sankey";
import { analyticsApplications } from "@/lib/analytics-data";
import { computeProgressMetrics, computeStatsMetrics, generateInsights, resolveAnalyticsTab } from "@/lib/analytics-metrics.mjs";
import { AnalyticsView } from "@/components/analytics-view";

export const dynamic = "force-dynamic";

export default async function Analytics({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { applications } = pipelineSummary();
  const enriched = analyticsApplications(applications);
  const progress = computeProgressMetrics(enriched);
  const stats = computeStatsMetrics(enriched);
  const tab = resolveAnalyticsTab((await searchParams).tab);
  const statusLog = readStatusLog();

  return (
    <AnalyticsView
      applications={enriched}
      progress={progress}
      stats={stats}
      insights={generateInsights(stats)}
      tab={tab}
      sankey={<PipelineSankey applications={applications} statusLog={statusLog} />}
    />
  );
}
