import { careerOpsRoot } from "@/lib/career-ops";
import { getPackage, updatePackage } from "@/lib/application-studio-store.mjs";
import type { StudioMessage, StudioPackage, StudioSettings } from "@/lib/application-studio.mjs";
import { editMessage, restoreMessageVersion, setMessageDraft, verifyMessageFacts, MESSAGE_TYPES } from "@/lib/application-studio.mjs";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * GET /api/application-studio/[packageId]
 * Return the full application package.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ packageId: string }> }) {
  try {
    const { packageId } = await params;
    const pkg = await getPackage(careerOpsRoot(), packageId);
    if (!pkg) return NextResponse.json({ ok: false, error: "package-not-found" }, { status: 404 });
    return NextResponse.json({ ok: true, package: pkg });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}

/**
 * PATCH /api/application-studio/[packageId]
 * Body: { action: "edit-message" | "draft" | "restore-version" | "settings", ... }
 *  - edit-message:      { messageId, body }
 *  - draft:             { messageId, draft: boolean }
 *  - restore-version:   { messageId, version }
 *  - settings:          { settings: { length?, style?, language? } }
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ packageId: string }> }) {
  try {
    const { packageId } = await params;
    const input = (await req.json()) as Record<string, unknown>;
    const root = careerOpsRoot();

    const updated = await updatePackage(root, packageId, (pkg: StudioPackage) => {
      const action = str(input.action);
      const now = new Date().toISOString();
      if (action === "edit-message") {
        const messageId = str(input.messageId);
        const message = pkg.messages.find((m) => m.id === messageId);
        if (!message) throw new Error("message-not-found");
        const body = str(input.body).trim();
        if (!body) throw new Error("empty-body");
        pkg.messages = pkg.messages.map((m) => (m.id === messageId ? editMessage(m, body, now) : m));
        pkg.history.push({ at: now, event: "message-edited", status: pkg.status, messageId });
      } else if (action === "draft") {
        const messageId = str(input.messageId);
        const message = pkg.messages.find((m) => m.id === messageId);
        if (!message) throw new Error("message-not-found");
        const draft = Boolean(input.draft);
        pkg.messages = pkg.messages.map((m) => (m.id === messageId ? setMessageDraft(m, draft, now) : m));
        pkg.history.push({ at: now, event: draft ? "saved-as-draft" : "draft-cleared", status: pkg.status, messageId });
      } else if (action === "restore-version") {
        const messageId = str(input.messageId);
        const message = pkg.messages.find((m) => m.id === messageId);
        if (!message) throw new Error("message-not-found");
        const version = Number(input.version);
        if (!Number.isFinite(version) || version < 1) throw new Error("invalid-version");
        pkg.messages = pkg.messages.map((m) => (m.id === messageId ? restoreMessageVersion(m, version, now) : m));
        pkg.history.push({ at: now, event: "version-restored", status: pkg.status, messageId, version });
      } else if (action === "settings") {
        const s = (input.settings as Record<string, unknown>) || {};
        if (typeof s.length === "string") pkg.settings.length = s.length as StudioSettings["length"];
        if (typeof s.style === "string") pkg.settings.style = s.style as StudioSettings["style"];
        if (typeof s.language === "string") pkg.settings.language = s.language as StudioSettings["language"];
        pkg.history.push({ at: now, event: "settings-updated", status: pkg.status });
      } else {
        throw new Error("unknown-action");
      }
      return pkg;
    });

    return NextResponse.json({ ok: true, package: updated });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
