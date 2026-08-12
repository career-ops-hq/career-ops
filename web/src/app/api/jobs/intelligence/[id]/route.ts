import { careerOpsRoot } from "@/lib/career-ops";
import { readCareerMasterProfile } from "@/lib/career-profile-store.mjs";
import { readActiveCv } from "@/lib/cv-version-store.mjs";
import { buildProfileEvidence, matchAnalysis, summarizeAnalysis } from "@/lib/job-intelligence.mjs";
import { readJobAnalysis, saveJobAnalysis, deleteJobAnalysis } from "@/lib/job-intelligence-store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function buildEvidence(root: string, answers?: Record<string, string>) {
  const profile = await readCareerMasterProfile(root);
  const cv = await readActiveCv(root);
  return buildProfileEvidence(profile || {}, cv || "", answers);
}

function reMatch(root: string, record: import("@/lib/job-intelligence-store.mjs").JobIntelligenceRecord) {
  return buildEvidence(root, record.answers || {}).then((evidence) => {
    const report = matchAnalysis(record.analysis, evidence);
    const now = new Date().toISOString();
    report.generatedAt = now;
    record.report = report;
    record.summary = summarizeAnalysis(record.analysis, record.report, record.id);
    record.updatedAt = now;
    return record;
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const record = await readJobAnalysis(careerOpsRoot(), id);
    if (!record) return Response.json({ error: "Analysen hittades inte." }, { status: 404 });
    return Response.json({ analysis: record });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Okänt fel" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const root = careerOpsRoot();
    const record = await readJobAnalysis(root, id);
    if (!record) return Response.json({ error: "Analysen hittades inte." }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) as { answers?: Record<string, string> };
    const incoming = body?.answers && typeof body.answers === "object" ? body.answers : {};
    record.answers = { ...(record.answers || {}), ...incoming };

    const updated = await reMatch(root, record);
    await saveJobAnalysis(root, updated);
    return Response.json({ analysis: updated });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Okänt fel" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const root = careerOpsRoot();
    const record = await readJobAnalysis(root, id);
    if (!record) return Response.json({ error: "Analysen hittades inte." }, { status: 404 });
    await deleteJobAnalysis(root, id);
    return Response.json({ ok: true, id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Okänt fel" }, { status: 400 });
  }
}
