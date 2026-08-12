import { careerOpsRoot } from "@/lib/career-ops";
import { getPackage, updatePackage } from "@/lib/application-studio-store.mjs";
import type { StudioPackage } from "@/lib/application-studio.mjs";
import type { PipelineHistoryEntry } from "@/lib/application-pipeline.mjs";
import { transitionPipeline, isPipelineStatus, nextPipelineStatuses } from "@/lib/application-pipeline.mjs";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * GET /api/application-studio/[packageId]/pipeline
 * Returns current status, allowed next statuses and status history.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ packageId: string }> }) {
  try {
    const { packageId } = await params;
    const pkg = await getPackage(careerOpsRoot(), packageId);
    if (!pkg) return NextResponse.json({ ok: false, error: "package-not-found" }, { status: 404 });
    return NextResponse.json({
      ok: true,
      status: pkg.status,
      next: nextPipelineStatuses(pkg.status),
      history: pkg.history.filter((h: PipelineHistoryEntry) => h.event === "status-change"),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}

/**
 * PATCH /api/application-studio/[packageId]/pipeline
 * Body: { status: "Applied" | ... }
 * Validates the transition and records history with timestamps.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ packageId: string }> }) {
  try {
    const { packageId } = await params;
    const input = (await req.json()) as Record<string, unknown>;
    const root = careerOpsRoot();
    const pkg = await getPackage(root, packageId);
    if (!pkg) return NextResponse.json({ ok: false, error: "package-not-found" }, { status: 404 });

    const toStatus = str(input.status);
    if (!isPipelineStatus(toStatus)) {
      return NextResponse.json({ ok: false, error: "invalid-status", allowed: nextPipelineStatuses(pkg.status) }, { status: 400 });
    }

    let updated: StudioPackage;
    try {
      updated = transitionPipeline(pkg, toStatus);
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: String(err instanceof Error ? err.message : err), allowed: nextPipelineStatuses(pkg.status) },
        { status: 400 }
      );
    }

    await updatePackage(root, packageId, () => updated);
    return NextResponse.json({ ok: true, package: updated });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
