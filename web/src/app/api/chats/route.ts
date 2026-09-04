import { listChatIds, readChat, writeChat } from "@/lib/chat-store";
import { sanitizeChat, chatSummary } from "@/lib/chats.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Assistant conversations as files (see lib/chat-store.ts). The client owns the
// message list; these routes persist it. GET lists metadata only; POST creates
// or replaces one conversation.

export async function GET() {
  const rows = [];
  for (const id of listChatIds()) {
    const chat = readChat(id);
    if (chat) rows.push(chatSummary(chat));
  }
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  return Response.json({ chats: rows });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const chat = sanitizeChat(body);
  if (!chat) return Response.json({ error: "invalid chat (id or messages)" }, { status: 400 });
  chat.updatedAt = Date.now();
  try {
    writeChat(chat);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, chat: chatSummary(chat) });
}
