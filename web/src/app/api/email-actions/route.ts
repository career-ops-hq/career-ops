import { careerOpsRoot } from "@/lib/career-ops";
import { defaultEmailRegistry } from "@/lib/email-connectors.mjs";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/email-actions
 * Body: { action: "create-response" | "save-draft" | "open-in-email" | "send",
 *         connectorId?, subject?, body?, to? }
 *
 * FAS 5: "send" is HARD-BLOCKED. No real email is ever sent. The other
 * actions are mock-only: drafts are simulated, "open in email" returns a
 * mailto link for the user's own mail client.
 */
export async function POST(req: Request) {
  try {
    const input = (await req.json()) as Record<string, unknown>;
    const root = careerOpsRoot();
    const action = typeof input.action === "string" ? input.action : "";
    const connectorId = typeof input.connectorId === "string" ? input.connectorId : "gmail";
    const subject = typeof input.subject === "string" ? input.subject : "";
    const body = typeof input.body === "string" ? input.body : "";
    const to = typeof input.to === "string" ? input.to : "";

    if (action === "send") {
      return NextResponse.json(
        { ok: false, error: "send-blocked", message: "Skicka INGEN riktig e-post under FAS 5 — kräver uttryckligt godkännande." },
        { status: 403 }
      );
    }

    const registry = defaultEmailRegistry();
    let connector;
    try {
      connector = registry.get(connectorId);
    } catch {
      connector = null;
    }

    if (action === "create-response") {
      // Mock reply draft built from the user's own message text.
      return NextResponse.json({
        ok: true,
        mock: true,
        draft: { to, subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`, body },
        note: "MOCK draft created — nothing saved to a real mailbox.",
      });
    }

    if (action === "save-draft") {
      if (!connector || typeof connector.saveDraft !== "function") {
        return NextResponse.json({ ok: false, error: "connector-not-ready" }, { status: 400 });
      }
      const result = await connector.saveDraft({ id: "draft-" + Date.now(), subject, body });
      return NextResponse.json({ ok: true, ...result, note: "MOCK draft — no real mailbox touched." });
    }

    if (action === "open-in-email") {
      const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      return NextResponse.json({ ok: true, mock: true, mailto, note: "Open in the user's own email client — nothing sent." });
    }

    return NextResponse.json({ ok: false, error: "unknown-action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
