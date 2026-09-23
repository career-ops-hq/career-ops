import { Suspense } from "react";
import { pipelineSummary, applicationCvReady } from "@/lib/career-ops";
import { PipelineView } from "@/components/pipeline-view";

export const dynamic = "force-dynamic"; // always read fresh local files

export default function PipelinePage() {
  const { inbox, applications } = pipelineSummary();
  return (
    <Suspense>
      <PipelineView
        applications={applications.map((a) => ({ ...a, cvReady: a.cvReady ?? applicationCvReady(a) }))}
        inbox={inbox}
      />
    </Suspense>
  );
}
