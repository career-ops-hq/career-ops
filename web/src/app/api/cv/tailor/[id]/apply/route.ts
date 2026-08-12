import { careerOpsRoot } from "@/lib/career-ops";
import { readTailorSession, saveTailorSession } from "@/lib/cv-tailoring-store.mjs";
import { saveCvVersion } from "@/lib/cv-version-store.mjs";
import { applyTailorChanges } from "@/lib/cv-tailoring.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cv/tailor/[id]/apply
 * Applies the approved tailoring changes as a NEW CV version (Fas 1 store).
 * The original CV file is never overwritten.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let body: { approvedIds?: string[]; edits?: Record<string, string> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  try {
    const { id } = await params;
    const session = await readTailorSession(careerOpsRoot(), id);
    if (!session) return Response.json({ error: "session not found" }, { status: 404 });

    const approvedIds = Array.isArray(body.approvedIds) ? body.approvedIds : session.approvedIds || [];
    const edits = body.edits && typeof body.edits === "object" ? body.edits : session.edits || {};

    const result = applyTailorChanges({
      cvText: session.originalCv,
      sections: session.sections,
      approvedIds,
      edits,
    });

    const label = `Anpassat CV — ${session.level} — ${session.jobTitle || "Jobb"}`;
    const version = await saveCvVersion(careerOpsRoot(), {
      content: result.cvText,
      label,
      source: "tailor",
    });

    session.status = "applied";
    session.approvedIds = approvedIds;
    session.rejectedIds = session.rejectedIds || [];
    session.edits = edits;
    session.version = { id: version.id, label: version.label, createdAt: version.createdAt };
    session.appliedAt = new Date().toISOString();
    session.updatedAt = session.appliedAt;
    session.changelog = [...(session.changelog || []), { type: "applied", at: session.appliedAt, detail: label }];
    await saveTailorSession(careerOpsRoot(), session);

    return Response.json({ ok: true, cvText: result.cvText, appliedCount: result.appliedCount, version, session });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "apply failed" },
      { status: 500 },
    );
  }
}
