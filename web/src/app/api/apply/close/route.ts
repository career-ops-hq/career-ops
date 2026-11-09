import { closeSession } from "@/lib/apply/session";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Explicitly close an apply session (the user hit "new" or left the page) so we
// free the off-screen browser tab promptly instead of waiting for the prune.
export async function POST(req: Request) {
  const body = await readJsonObject<{ sessionId?: string }>(req);
  if (!body) return Response.json({ ok: false }, { status: 400 });
  if (body.sessionId) await closeSession(body.sessionId).catch(() => {});
  return Response.json({ ok: true });
}
