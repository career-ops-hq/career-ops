import { notFound } from "next/navigation";
import { readReport, findApplication, trackerCanDelete } from "@/lib/career-ops";
import { resolveTailoredCover } from "@/lib/apply/cover";
import { ReportView } from "@/components/report-view";
import { pipelineQuery } from "@/lib/pipeline-navigation.mjs";
import { reportNumberFor } from "@/lib/apply-checklist.mjs";
import { readCvDiskState } from "@/lib/read-cv-disk";
import { parseReport } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = pipelineQuery(await searchParams);
  const app = findApplication(id);
  const report = readReport(id);
  if (!app && !report) notFound();
  // Resolved here rather than in the component so the link is only rendered when
  // THIS application's cover is actually on disk. `id` is passed as the
  // application number, never as a company: a report with no tracker row has no
  // identity to match on, and guessing one from the id would surface another
  // offer's cover.
  const coverReady = (await resolveTailoredCover(app?.company, id)) !== null;
  // Same name the View link puts in ?company=, so a slug match here is the file that link would open.
  const companyName = app?.company || parseReport(report?.content ?? "").title || "";
  const reportNum = reportNumberFor(id, app, report?.file ?? null);
  const disk = await readCvDiskState(id, companyName, (app?.pdf ?? "").includes("✅"), reportNum);
  const pdfFileReady = disk.exists;
  return (
    <ReportView
      id={id}
      app={app}
      report={report?.content ?? null}
      file={report?.file ?? null}
      canDelete={trackerCanDelete()}
      pdfFileReady={pdfFileReady}
      trackerMarkedPdf={(app?.pdf ?? "").includes("✅")}
      coverReady={coverReady}
      backHref={`/pipeline${query ? `?${query}` : ""}`}
      applyHref={`/pipeline/${encodeURIComponent(id)}/apply${query ? `?${query}` : ""}`}
      reportNum={reportNum}
    />
  );
}
