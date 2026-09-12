import { deleteChat, readChat, writeChat } from "@/lib/chat-store";
import { sanitizeChat, chatSummary, MAX_TITLE } from "@/lib/chats.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET — one full conversation. */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const chat = readChat(id);
  if (!chat) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ chat });
}

/** PUT — replace the conversation (id in the path wins over the body). */
export async function PUT(req: Request, { params }: Params) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const chat = sanitizeChat({ ...(body as object), id });
  if (!chat) return Response.json({ error: "invalid chat" }, { status: 400 });
  chat.updatedAt = Date.now();
  try {
    writeChat(chat);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, chat: chatSummary(chat) });
}

/** PATCH — rename (and only rename; messages are the client's to send via PUT). */
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const chat = readChat(id);
  if (!chat) return Response.json({ error: "not found" }, { status: 404 });
  let body: { title?: unknown };
  try {
    body = (await req.json()) as { title?: unknown };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim().slice(0, MAX_TITLE) : "";
  if (!title) return Response.json({ error: "title required" }, { status: 400 });
  chat.title = title;
  chat.updatedAt = Date.now();
  try {
    writeChat(chat);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, chat: chatSummary(chat) });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  return Response.json({ ok: deleteChat(id) });
}
