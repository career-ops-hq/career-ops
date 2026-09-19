import { pipelineSummary } from "@/lib/career-ops";
import { analyticsApplications } from "@/lib/analytics-data";
import { computeProgressMetrics, computeStatsMetrics, generateInsights, resolveAnalyticsTab } from "@/lib/analytics-metrics.mjs";
import { AnalyticsView } from "@/components/analytics-view";

export const dynamic = "force-dynamic";

// Keep the analytics route's status vocabulary aligned with the canonical
// tracker lifecycle. SKIP is intentionally not a funnel stage, but remains
// listed here so the dashboard contract cannot silently drift from states.yml.
export const STAGES = [
  "EVALUATED",
  "APPLIED",
  "RESPONDED",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
  "DISCARDED",
  "SKIP",
];

export default async function Analytics({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { applications } = pipelineSummary();
  const enriched = analyticsApplications(applications);
  const progress = computeProgressMetrics(enriched);
  const stats = computeStatsMetrics(enriched);
  const tab = resolveAnalyticsTab((await searchParams).tab);
  return <AnalyticsView applications={enriched} progress={progress} stats={stats} insights={generateInsights(stats)} tab={tab} />;
}
