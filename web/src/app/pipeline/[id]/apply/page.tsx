import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { notFound } from "next/navigation";
import { careerOpsRoot, findApplication, isRegularContainedFile, readReport, rootScript } from "@/lib/career-ops";
import { resolvePdfIndexPath } from "@/lib/core/pdf-index";
import { parseReport } from "@/lib/format";
import { pipelineQuery } from "@/lib/pipeline-navigation.mjs";
import { applyPostingUrl } from "@/lib/posting-url.mjs";
import { answerCopyItems, indexedPdf, pasteCopyFields, PORTAL_TIPS, reportNumberFor, tailoredResumeText } from "@/lib/apply-checklist.mjs";
import { unsupportedAtsMessage, unsupportedInAppAts } from "@/lib/apply/unsupported-ats.mjs";
import { readCvDiskState } from "@/lib/read-cv-disk";
import { ApplyChecklist } from "@/components/apply-checklist";

export const dynamic = "force-dynamic";

function fileUnderOutput(root: string, abs: string): boolean {
  return isRegularContainedFile(abs, path.join(root, "output"));
}

export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = pipelineQuery(await searchParams);
  const app = findApplication(id);
  const report = readReport(id);
  if (!app && !report) notFound();

  const reportNum = reportNumberFor(id, app, report?.file ?? null);
  const reportUrl = report ? parseReport(report.content).fields.find((field) => field.label === "URL")?.value : "";
  const postingUrl = applyPostingUrl(reportUrl, app?.url, app?.applyLink);

  let answers: { label: string; text: string }[] = [];
  if (report?.content) {
    const mod = await import(/* webpackIgnore: true */ pathToFileURL(rootScript("application-answers")).href);
    const snapshot = mod.parseApplicationAnswersSection(report.content, { strict: true });
    answers = answerCopyItems(snapshot);
  }

  const root = careerOpsRoot();
  const cvPath = path.join(root, "cv.md");
  let cvText: string | null = null;
  try {
    cvText = fs.readFileSync(cvPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    cvText = null;
  }

  let indexText = "";
  const indexPath = await resolvePdfIndexPath();
  if (indexPath) {
    try {
      indexText = fs.readFileSync(indexPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      indexText = "";
    }
  }
  const resumeHit = reportNum == null ? null : indexedPdf(indexText, reportNum, "cv", root, (abs) => fileUnderOutput(root, abs));
  const coverHit = reportNum == null ? null : indexedPdf(indexText, reportNum, "cover", root, (abs) => fileUnderOutput(root, abs));
  const resume = resumeHit
    ? { relativePath: resumeHit.relativePath, downloadHref: `/api/cv-pdf?n=${reportNum}` }
    : null;
  const fields = pasteCopyFields(
    resumeHit ? tailoredResumeText(indexText, resumeHit.relativePath, root, (abs: string) => fs.readFileSync(abs, "utf8")) : null,
    cvText,
  );
  const cover = coverHit
    ? { relativePath: coverHit.relativePath, downloadHref: `/api/cv-pdf?n=${reportNum}&kind=cover` }
    : null;

  const suffix = query ? `?${query}` : "";
  const company = app?.company || parseReport(report?.content ?? "").title || `Report #${id}`;
  const trackerMarked = (app?.pdf ?? "").includes("✅");
  const disk = await readCvDiskState(id, company, trackerMarked, reportNum);
  const blockedAts = await unsupportedInAppAts(postingUrl);
  const blockedTip = blockedAts ? PORTAL_TIPS.find((tip) => tip.portal === blockedAts.label)?.tip ?? "" : "";
  const blocked = blockedAts
    ? { label: blockedAts.label, message: unsupportedAtsMessage(blockedAts.label), tip: blockedTip }
    : null;
  return (
    <ApplyChecklist
      company={company}
      role={app?.role ?? ""}
      backHref={`/pipeline${suffix}`}
      reportHref={`/pipeline/${encodeURIComponent(id)}${suffix}`}
      postingUrl={postingUrl}
      blocked={blocked}
      resume={resume}
      cover={cover}
      answers={answers}
      work={fields.work}
      education={fields.education}
      workEmpty={fields.workEmpty}
      educationEmpty={fields.educationEmpty}
      tips={PORTAL_TIPS}
      trackerNum={app?.n ?? null}
      reportNum={reportNum}
      status={app?.status ?? ""}
      pdfReady={resume !== null}
      trackerMarked={trackerMarked}
      pdfNote={reportNum != null && trackerMarked && resume === null ? null : disk.note}
    />
  );
}
