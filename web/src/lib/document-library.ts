import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot, readApplications } from "@/lib/career-ops";
import { discoverApplications, discoverReadyToApply } from "@/lib/documents.mjs";
import { discoverRoleResumes } from "@/lib/role-resumes.mjs";
import { classifyResumeFreshness, readProfileState } from "@/lib/profile-state.mjs";

export type Freshness = "current" | "stale" | "unknown";
export type DocumentVersion = { version: string; path: string; metadata?: { createdAt?: string; profileVersion?: number; profileUpdatedAt?: string } };
export type CoverWorkflow = { status: "Draft - Review Required" | "Review recommended - newer resume exists" | "Approved"; resumeVersion: string; targetVersion: string; existingCoverVersion?: string | null };
export type ApplicationDocument = { kind: "resume" | "cover-letter"; versions: DocumentVersion[]; selectedVersion: string; status: "Approved" | "Latest"; workflow?: CoverWorkflow | null; freshness?: Freshness };
export type DocumentApplication = { directory: string; number: string; company: string; role: string; documents: ApplicationDocument[] };
export type ReadyDocument = { name: string; path: string };
export type RoleResume = { slug: string; targetRole: string; versions: Array<DocumentVersion & { metadata: { createdAt?: string; factGate?: string; profileVersion?: number; profileUpdatedAt?: string; positioning?: string; supportedFocusAreas?: string[] } }>; latest: DocumentVersion & { metadata: { createdAt?: string; factGate?: string; profileVersion?: number; profileUpdatedAt?: string; positioning?: string; supportedFocusAreas?: string[] } }; freshness?: Freshness };
export type ProfileState = { version: number; updatedAt: string | null };

function approvedPdfPaths(): Set<string> {
  const approved = new Set<string>();
  for (const app of readApplications()) {
    const linked = app.report.match(/\]\(([^)]+)\)/)?.[1];
    if (!linked) continue;
    const report = path.resolve(careerOpsRoot(), "data", linked);
    try {
      const content = fs.readFileSync(report, "utf8");
      const pdf = content.match(/^\*\*PDF:\*\*\s+(.+\.pdf)\s*$/im)?.[1]?.trim().replace(/\\/g, "/");
      if (pdf?.startsWith("output/")) approved.add(pdf);
    } catch {
      // A missing report only means there is no explicit approved-version signal.
    }
  }
  return approved;
}

export function applicantName(): string {
  try {
    const parsed = yaml.load(fs.readFileSync(path.join(careerOpsRoot(), "config", "profile.yml"), "utf8")) as { candidate?: { full_name?: unknown } };
    if (typeof parsed?.candidate?.full_name === "string" && parsed.candidate.full_name.trim()) return parsed.candidate.full_name.trim();
  } catch {
    // Keep the document browser usable during incomplete onboarding.
  }
  return "Candidate";
}

export function readDocumentLibrary(): { applications: DocumentApplication[]; roleResumes: RoleResume[]; ready: ReadyDocument[]; applicantName: string; profileState: ProfileState; staleCount: number } {
  const root = careerOpsRoot();
  const metadata = readApplications().map((app) => ({ number: app.n, company: app.company, role: app.role }));
  const profileState = readProfileState(root) as ProfileState;
  const applications = discoverApplications(root, metadata, approvedPdfPaths()) as DocumentApplication[];
  const roleResumes = discoverRoleResumes(root) as RoleResume[];
  for (const app of applications) {
    const resume = app.documents.find((document) => document.kind === "resume");
    if (resume?.versions[0]) resume.freshness = classifyResumeFreshness(resume.versions[0].metadata || {}, profileState) as Freshness;
  }
  for (const role of roleResumes) role.freshness = classifyResumeFreshness(role.latest.metadata || {}, profileState) as Freshness;
  const staleCount = roleResumes.filter((role) => role.freshness === "stale").length + applications.filter((app) => app.documents.some((document) => document.kind === "resume" && document.freshness === "stale")).length;
  return {
    applications,
    roleResumes,
    ready: discoverReadyToApply(root) as ReadyDocument[],
    applicantName: applicantName(),
    profileState,
    staleCount,
  };
}
