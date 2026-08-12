import { careerOpsRoot } from "@/lib/career-ops";
import { readCareerMasterProfile } from "@/lib/career-profile-store.mjs";
import { readJobAnalysis } from "@/lib/job-intelligence-store.mjs";
import {
  generateMessages,
  buildFactBase,
  resolveLanguage,
  createApplicationPackage,
  MESSAGE_TYPES,
} from "@/lib/application-studio.mjs";
import { createPackage } from "@/lib/application-studio-store.mjs";
import { readActiveCv } from "@/lib/cv-version-store.mjs";
import type { MessageTypeId } from "@/lib/application-studio.d.mts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function strArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
  return [];
}

export async function POST(req: Request) {
  try {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(await req.text());
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const jobId = str(payload.jobId);
    const cvVersionId = str(payload.cvVersionId);
    const settingsRaw = (payload.settings && typeof payload.settings === "object" ? payload.settings : {}) as Record<string, unknown>;
    const typesRaw = Array.isArray(payload.types) ? payload.types.map((x) => str(x)).filter(Boolean) : [];

    if (!jobId) {
      return Response.json({ ok: false, error: "jobId is required" }, { status: 400 });
    }

    const root = careerOpsRoot();

    // 1. Verifierade fakta: Career Master Profile
    const profile = await readCareerMasterProfile(root);

    // 2. Jobb + jobbmatchning
    const jobRecord = await readJobAnalysis(root, jobId);
    if (!jobRecord) {
      return Response.json({ ok: false, error: `No job analysis found for jobId: ${jobId}` }, { status: 404 });
    }
    const job = {
      id: jobRecord.id,
      company: str(jobRecord.analysis?.metadata?.company || jobRecord.meta?.savedCompany),
      role: str(jobRecord.analysis?.metadata?.jobTitle || jobRecord.meta?.savedRole),
      location: str(jobRecord.analysis?.metadata?.location),
      url: str(jobRecord.meta?.url),
      source: str(jobRecord.meta?.source, "job"),
    };
    const match = {
      score: typeof jobRecord.report?.verdict?.score === "number" ? jobRecord.report.verdict.score : 0,
      verdictLabel: str(jobRecord.report?.verdict?.label),
      strengths: (jobRecord.report?.gaps?.verified || []).map((m: { text?: string }) => str(m.text)),
      gaps: (jobRecord.report?.gaps?.gaps || []).map((m: { text?: string }) => str(m.text)),
      matchedSkills: strArray(jobRecord.report?.verdict?.reasons),
      recommendedActions: strArray(jobRecord.report?.recommendedActions),
    };

    // 3. Anpassad CV-version (text)
    let cvText = "";
    if (cvVersionId) {
      try {
        cvText = await readActiveCv(root);
      } catch {
        cvText = "";
      }
    }
    const cvVersion = cvVersionId ? { id: cvVersionId, text: cvText } : null;

    // 4. Textinställningar
    const resolvedSettings = {
      length: ["short", "standard", "detailed"].includes(str(settingsRaw.length)) ? (str(settingsRaw.length) as "short" | "standard" | "detailed") : "standard",
      style: ["professional", "human", "technical", "leadership", "sales"].includes(str(settingsRaw.style))
        ? (str(settingsRaw.style) as "professional" | "human" | "technical" | "leadership" | "sales")
        : "professional",
      language: ["sv", "en", "auto"].includes(str(settingsRaw.language)) ? (str(settingsRaw.language) as "sv" | "en" | "auto") : "auto",
    };

    // 5. Språkval (auto → sv/en)
    const language = resolveLanguage(resolvedSettings.language, job, profile);

    // 6. Faktaunderlag — verifierade fakta
    const factBase = buildFactBase({ profile, job, match, cvVersion });

    // 7. Generera meddelanden (deterministisk motor, faktasäkrad)
    const requestedTypes = typesRaw.length ? (typesRaw as MessageTypeId[]) : MESSAGE_TYPES.map((t) => t.id);
    const messages = generateMessages({
      profile,
      job,
      match,
      cvVersion,
      settings: { ...resolvedSettings, language },
      types: requestedTypes,
    });

    // 8. Paket + persistens
    const pkg = createApplicationPackage({
      job,
      profile: {
        fullName: str(profile.fullName),
        headline: str(profile.headline),
        location: str(profile.location),
        email: str(profile.email),
        phone: str(profile.phone),
        linkedin: str(profile.linkedin),
        portfolio: str(profile.portfolio),
        summary: str(profile.summary),
        targetRoles: strArray(profile.targetRoles),
        skills: strArray(profile.skills),
        workModes: strArray(profile.workModes),
      },
      match,
      cvVersion,
      settings: { ...resolvedSettings, language },
      messages,
      facts: factBase,
    });
    const saved = await createPackage(root, pkg);

    return Response.json({ ok: true, package: saved });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
