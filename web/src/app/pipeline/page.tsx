import { Suspense } from "react";
import { pdfReadyForReport, pipelineSummary, readTrackerShape } from "@/lib/career-ops";
import { reportNumberFromCell } from "@/lib/apply/cv-selection.mjs";
import { pendingInbox } from "@/lib/inbox-pending.mjs";
import { PipelineView } from "@/components/pipeline-view";
import { pipelineTab } from "@/lib/pipeline-navigation.mjs";

export const dynamic = "force-dynamic"; // always read fresh local files

// Tracker tabs show the inbox only as a count, so they get the count and not
// the postings. The inbox is most of the page payload on a large pipeline.
export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { tab } = await searchParams;
  const onInbox = pipelineTab(tab) === "INBOX";
  const { inbox, applications } = pipelineSummary();
  const pending = pendingInbox(inbox);
  const trackerShape = readTrackerShape();
  // Tracker row numbers whose tailored CV is indexed (data/pdf-index.tsv) AND on
  // disk; the tracker's own PDF emoji can drift from what output/ really holds.
  // Rows are keyed the way /api/cv-pdf?application= resolves them: through the
  // report cell, so a row with no resolvable report never gets a dead link.
  // Skipped on the inbox tab, which has no table.
  const cvRows = onInbox
    ? []
    : (
        await Promise.all(
          applications.map(async (a) => {
            const report = reportNumberFromCell(a.report);
            return report && (await pdfReadyForReport(String(report))) ? a.n : null;
          }),
        )
      ).filter((n): n is string => n !== null);
  return (
    <Suspense>
      <PipelineView applications={applications} inbox={onInbox ? pending : null} inboxCount={pending.length} trackerShape={trackerShape} cvRows={cvRows} />
    </Suspense>
  );
}
