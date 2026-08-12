import { careerOpsRoot } from "@/lib/career-ops";
import { getPackage, updatePackage } from "@/lib/application-studio-store.mjs";
import type { StudioMessage, StudioPackage } from "@/lib/application-studio.mjs";
import { regenerateMessage, verifyMessageFacts } from "@/lib/application-studio.mjs";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * POST /api/application-studio/[packageId]/regenerate
 * Body: { messageId, settings?: { length?, style?, language? } }
 * Regenerates one message (new version) using the package's verified facts.
 */
export async function POST(req: Request, { params }: { params: Promise<{ packageId: string }> }) {
  try {
    const { packageId } = await params;
    const input = (await req.json()) as Record<string, unknown>;
    const root = careerOpsRoot();
    const pkg = await getPackage(root, packageId);
    if (!pkg) return NextResponse.json({ ok: false, error: "package-not-found" }, { status: 404 });

    const messageId = str(input.messageId);
    const message = pkg.messages.find((m: StudioMessage) => m.id === messageId);
    if (!message) return NextResponse.json({ ok: false, error: "message-not-found" }, { status: 404 });

    const settingsOverride = (input.settings as Record<string, unknown>) || {};
    const settings = {
      length: typeof settingsOverride.length === "string" ? settingsOverride.length : pkg.settings.length,
      style: typeof settingsOverride.style === "string" ? settingsOverride.style : pkg.settings.style,
      language: typeof settingsOverride.language === "string" ? settingsOverride.language : pkg.settings.language,
    } as typeof pkg.settings;

    const regenSettings = { ...pkg.settings, ...settings };
    const regenerated = regenerateMessage(message, {
      profile: pkg.profile,
      job: pkg.job,
      match: pkg.match,
      cvVersion: pkg.cvVersion,
      settings: regenSettings,
    });

    const now = new Date().toISOString();
    await updatePackage(root, packageId, (p: StudioPackage) => {
      p.messages = p.messages.map((m: StudioMessage) => (m.id === messageId ? regenerated : m));
      p.history.push({ at: now, event: "message-regenerated", status: p.status, messageId });
      p.updatedAt = now;
      return p;
    });

    const factCheck = verifyMessageFacts(regenerated, pkg.factBase || []);
    return NextResponse.json({ ok: true, message: regenerated, factCheck });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
