import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { readJobAnalysis } from "@/lib/job-intelligence-store.mjs";
import { readCareerMasterProfile } from "@/lib/career-profile-store.mjs";
import {
  createTailorSession,
  listTailorSessions,
} from "@/lib/cv-tailoring-store.mjs";
import {
  assembleProposedCv,
  generateTailorProposal,
  polishProposalWithLlm,
  type TailorLevel,
} from "@/lib/cv-tailoring.mjs";
import { createOmniRouteClient } from "@/lib/omniroute-client.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEVELS = ["light", "professional", "targeted"];
const MAX_CV_BYTES = 10 * 1024 * 1024;

function cvPath() {
  return path.join(careerOpsRoot(), "cv.md");
}

export async function GET() {
  try {
    const sessions = await listTailorSessions(careerOpsRoot());
    return Response.json({ sessions });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "sessions read failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: { jobId?: string; level?: string; cvText?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.jobId) return Response.json({ error: "jobId required" }, { status: 400 });
  const level = (LEVELS.includes(String(body.level || "")) ? String(body.level) : "professional") as TailorLevel;

  let cvText = body.cvText;
  if (typeof cvText !== "string" || cvText.trim() === "") {
    try {
      cvText = fs.readFileSync(cvPath(), "utf8");
    } catch {
      return Response.json({ error: "CV saknas — skapa eller klistra in ditt CV först." }, { status: 400 });
    }
  }
  if (Buffer.byteLength(cvText, "utf8") > MAX_CV_BYTES) {
    return Response.json({ error: "CV-filen får vara högst 10 MB" }, { status: 413 });
  }

  try {
    const record = await readJobAnalysis(careerOpsRoot(), body.jobId);
    if (!record?.analysis) {
      return Response.json({ error: "Jobbanalys hittades inte (Fas 2)." }, { status: 404 });
    }
    const profile = await readCareerMasterProfile(careerOpsRoot());

    const proposal = generateTailorProposal({
      cvText,
      profile,
      analysis: record.analysis,
      report: record.report || null,
      level,
    });

    const client = createOmniRouteClient();
    const polished = await polishProposalWithLlm(proposal, { analysis: record.analysis, profile }, client.chat, {
      model: client.model,
    });

    const session = await createTailorSession({
      root: careerOpsRoot(),
      session: {
        jobId: body.jobId,
        jobTitle: record.analysis?.metadata?.jobTitle || record.summary?.jobTitle || "Jobb",
        company: record.analysis?.metadata?.company || record.summary?.company || "",
        level,
        model: polished.model || "deterministic",
      },
      sections: polished.sections,
      originalCv: cvText,
      proposedCv: assembleProposedCv(cvText, polished.sections),
    });
    return Response.json({ ok: true, session }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "tailor failed" },
      { status: 500 },
    );
  }
}
