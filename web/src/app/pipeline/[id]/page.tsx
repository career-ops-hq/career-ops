import { notFound } from "next/navigation";
import { readReport, findApplication, pdfReadyForReport, trackerCanDelete } from "@/lib/career-ops";
import { resolveTailoredCover } from "@/lib/apply/cover";
import { ReportView } from "@/components/report-view";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = findApplication(id);
  const report = readReport(id);
  if (!app && !report) notFound();
  // Resolved here rather than in the component so the link is only rendered when
  // THIS application's cover is actually on disk. `id` is passed as the
  // application number, never as a company: a report with no tracker row has no
  // identity to match on, and guessing one from the id would surface another
  // offer's cover.
  const coverReady = (await resolveTailoredCover(app?.company, id)) !== null;
  return (
    <ReportView
      id={id}
      app={app}
      report={report?.content ?? null}
      file={report?.file ?? null}
      canDelete={trackerCanDelete()}
      pdfReadyFromIndex={await pdfReadyForReport(id)}
      coverReady={coverReady}
    />
  );
}
