import { careerOpsRoot } from "@/lib/career-ops";
import {
  defaultEmailRegistry,
  mockExchangeCode,
  saveConnectorCredentials,
  readConnectorCredentials,
  deleteConnectorCredentials,
} from "@/lib/email-connectors.mjs";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/email-hub/connectors
 * Lists connector definitions + whether mock credentials exist.
 */
export async function GET() {
  try {
    const root = careerOpsRoot();
    const registry = defaultEmailRegistry();
    const connectors = await Promise.all(
      registry.list().map(async (c) => {
        const cred = await readConnectorCredentials(root, c.id);
        return {
          id: c.id,
          name: c.name,
          kind: c.kind,
          capabilities: c.capabilities,
          connected: Boolean(cred),
          mock: cred ? Boolean(cred.mock) : true,
        };
      })
    );
    return NextResponse.json({ ok: true, connectors, sendBlocked: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}

/**
 * POST /api/email-hub/connectors
 * Body: { action: "connect" | "disconnect", connectorId, code? }
 * Connect performs a MOCK OAuth exchange — no real account is ever
 * connected without explicit user approval, and no password is stored.
 */
export async function POST(req: Request) {
  try {
    const input = (await req.json()) as Record<string, unknown>;
    const root = careerOpsRoot();
    const action = typeof input.action === "string" ? input.action : "";
    const connectorId = typeof input.connectorId === "string" ? input.connectorId : "";

    if (action === "connect") {
      const code = typeof input.code === "string" ? input.code : "mock-auth-code";
      const credential = mockExchangeCode(connectorId, code);
      await saveConnectorCredentials(root, credential);
      return NextResponse.json({ ok: true, connectorId, connected: true, credential, note: "MOCK connection — no real account linked" });
    }

    if (action === "disconnect") {
      await deleteConnectorCredentials(root, connectorId);
      return NextResponse.json({ ok: true, connectorId, connected: false });
    }

    return NextResponse.json({ ok: false, error: "unknown-action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
