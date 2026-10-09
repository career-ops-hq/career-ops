import { careerOpsRoot } from "@/lib/career-ops";
import { ChatError, listChats, readChat, saveChat, deleteChat } from "@/lib/assistant-chat-store.mjs";
import { MAX_CHAT_BYTES } from "@/lib/assistant-history.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAT_ERROR_COPY: Record<string, string> = {
  "invalid-request": "O pedido não é válido.",
  "invalid-id": "A conversa indicada não é válida.",
  "revision-required": "Falta a versão da conversa. Recarrega-a e tenta novamente.",
  "invalid-messages": "A conversa contém mensagens inválidas e não foi guardada.",
  empty: "As conversas vazias não são guardadas.",
  "invalid-title": "O nome da conversa deve ter entre 1 e 100 caracteres.",
  "too-large": "A conversa é demasiado grande para ser guardada.",
  changed: "A conversa foi alterada noutro separador. Recarrega-a antes de continuar; o texto por guardar continua visível.",
  busy: "Esta conversa está a ser alterada noutro processo. Tenta novamente dentro de instantes.",
  damaged: "Não foi possível ler esta conversa porque o ficheiro está danificado. O ficheiro não foi alterado.",
};

function publicMessage(code: string) {
  return CHAT_ERROR_COPY[code] ?? "Não foi possível aceder ao histórico de conversas.";
}

function failure(error: unknown) {
  return error instanceof ChatError
    ? Response.json({ error: publicMessage(error.code), code: error.code }, { status: error.status })
    : Response.json({ error: "Não foi possível aceder ao histórico de conversas." }, { status: 500 });
}
export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      const result = listChats(careerOpsRoot());
      return Response.json({
        ...result,
        errors: result.errors.map(({ id, code }) => ({ id, code, error: publicMessage(code) })),
      });
    }
    const chat = readChat(careerOpsRoot(), id);
    return chat ? Response.json(chat) : Response.json({ error: "Conversa não encontrada." }, { status: 404 });
  } catch (error) { return failure(error); }
}
export async function PUT(req: Request) {
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw) > MAX_CHAT_BYTES + 1000) throw new ChatError("too-large", "Conversation is too large to save", 413);
    let body;
    try { body = JSON.parse(raw); } catch { throw new ChatError("invalid-request", "Invalid JSON request"); }
    return Response.json(saveChat(careerOpsRoot(), body?.id, body));
  } catch (error) { return failure(error); }
}
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    deleteChat(careerOpsRoot(), url.searchParams.get("id"), Number(url.searchParams.get("revision")));
    return Response.json({ ok: true });
  } catch (error) { return failure(error); }
}
