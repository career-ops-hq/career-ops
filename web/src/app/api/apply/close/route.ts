import { closeSession } from "@/lib/apply/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Explicitly close an apply session (the user hit "new" or left the page) so we
// free the off-screen browser tab promptly instead of waiting for the prune.
export async function POST(req: Request) {
  let body: { sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (body.sessionId) await closeSession(body.sessionId).catch(() => {});
  return Response.json({ ok: true });
}
