import { Suspense } from "react";
import { pdfReadyForReport, pipelineSummary } from "@/lib/career-ops";
import { PipelineView } from "@/components/pipeline-view";

export const dynamic = "force-dynamic"; // always read fresh local files

export default async function PipelinePage() {
  const { inbox, applications } = pipelineSummary();
  // Tracker row numbers whose tailored CV is indexed (data/pdf-index.tsv) AND on
  // disk — the tracker's own PDF emoji can drift from what output/ really holds.
  const cvRows = (
    await Promise.all(
      applications.map(async (a) => {
        const report = a.report.match(/\[(\d+)\]/)?.[1] ?? a.n;
        return (await pdfReadyForReport(report)) ? a.n : null;
      }),
    )
  ).filter((n): n is string => n !== null);
  return (
    <Suspense>
      <PipelineView applications={applications} inbox={inbox} cvRows={cvRows} />
    </Suspense>
  );
}
