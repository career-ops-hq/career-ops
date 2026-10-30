import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { readReport, findApplication, pdfPathStatusForReport, trackerCanDelete, careerOpsRoot, isRegularContainedFile } from "@/lib/career-ops";
import { resolveTailoredCover } from "@/lib/apply/cover";
import { ReportView } from "@/components/report-view";
import { pipelineQuery } from "@/lib/pipeline-navigation.mjs";
import { reportNumberFor } from "@/lib/apply-checklist.mjs";
import { tailoredCvOnDisk } from "@/lib/tailored-cv-ready.mjs";
import { parseReport } from "@/lib/format";

// Same filter /api/cv-pdf applies, so a directory or a symlink out of output/
// never marks a CV ready that the View link would refuse.
function outputPdfNames(): string[] {
  const dir = path.join(careerOpsRoot(), "output");
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith(".pdf"))
      .filter((name) => isRegularContainedFile(path.join(dir, name), dir));
  } catch {
    return [];
  }
}

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
  const indexStatus = (await pdfPathStatusForReport(id)).status;
  // Same name the View link puts in ?company=, so a slug match here is the file that link would open.
  const companyName = app?.company || parseReport(report?.content ?? "").title || "";
  const pdfFileReady = tailoredCvOnDisk({
    indexStatus,
    filenames: outputPdfNames(),
    company: companyName,
  });
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
      reportNum={reportNumberFor(id, app, report?.file ?? null)}
    />
  );
}
