import { Suspense } from "react";
import { pipelineSummary } from "@/lib/career-ops";
import { PipelineView } from "@/components/pipeline-view";
import { readDefaultPipelineTab } from "@/lib/web-prefs";

export const dynamic = "force-dynamic"; // always read fresh local files

export default function PipelinePage() {
  const { inbox, applications } = pipelineSummary();
  // Read here (not in the client) so the landing tab is right on first paint.
  return (
    <Suspense>
      <PipelineView applications={applications} inbox={inbox} defaultTab={readDefaultPipelineTab()} />
    </Suspense>
  );
}
