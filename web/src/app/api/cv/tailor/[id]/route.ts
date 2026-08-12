import { careerOpsRoot } from "@/lib/career-ops";
import {
  readTailorSession,
  saveTailorSession,
  deleteTailorSession,
} from "@/lib/cv-tailoring-store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await readTailorSession(careerOpsRoot(), id);
    if (!session) return Response.json({ error: "session not found" }, { status: 404 });
    return Response.json({ session });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "session read failed" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let body: {
    approvedIds?: string[];
    rejectedIds?: string[];
    edits?: Record<string, string>;
    status?: "draft" | "review" | "applied";
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  try {
    const { id } = await params;
    const session = await readTailorSession(careerOpsRoot(), id);
    if (!session) return Response.json({ error: "session not found" }, { status: 404 });

    if (Array.isArray(body.approvedIds)) session.approvedIds = body.approvedIds;
    if (Array.isArray(body.rejectedIds)) session.rejectedIds = body.rejectedIds;
    if (body.edits && typeof body.edits === "object") session.edits = { ...session.edits, ...body.edits };
    if (body.status && ["draft", "review", "applied"].includes(body.status)) session.status = body.status;

    session.updatedAt = new Date().toISOString();
    await saveTailorSession(careerOpsRoot(), session);
    return Response.json({ ok: true, session });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "session update failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await readTailorSession(careerOpsRoot(), id);
    if (!session) return Response.json({ error: "session not found" }, { status: 404 });
    await deleteTailorSession(careerOpsRoot(), id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "session delete failed" },
      { status: 500 },
    );
  }
}
