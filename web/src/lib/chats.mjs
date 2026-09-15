// Conversation persistence + model-context logic for the assistant — the pure
// half behind /api/chats and the console's history list.
//
// Why: the assistant kept ONE conversation in localStorage (last 30 messages,
// wiped by "New chat") and sent the model only the last 8 turns of it. That is
// fine for a question and wrong for the onboarding conversations the assistant
// now drives. Chats therefore become files under .career-ops-web/chats/ —
// local-first like the worker logs next to them, survive a cleared browser, and
// can be listed, renamed and switched — and the context the model sees is built
// here, in one place, for both the fresh-turn prompt and the non-Claude CLIs.
//
// Plain .mjs (no node/next imports) so the console, the routes and the tests
// all import the same functions.

/** Chat ids are time-sortable and filesystem-safe; the route validates against this. */
export const CHAT_ID_RE = /^[a-z0-9][a-z0-9_-]{5,39}$/;

/** Hard caps so a runaway conversation can never grow a file without bound. */
export const MAX_MESSAGES = 400;
export const MAX_TEXT = 20_000;
export const MAX_TITLE = 80;

/** `<<session:ID>>` — the server tells the client which Claude session to resume next turn. */
export const SESSION_RE = /<<\s*session:\s*([A-Za-z0-9._-]{4,128})\s*>>/g;

export function newChatId(now = Date.now()) {
  // base36 timestamp keeps directory listings in creation order; the suffix
  // prevents two tabs creating a chat in the same millisecond from colliding.
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  return `c${now.toString(36)}${rand}`;
}

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

/** Keep only serializable, well-formed message parts (pending confirms are transient UI). */
function sanitizeParts(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    switch (p.type) {
      case "text":
      case "note":
        if (typeof p.text === "string") out.push({ type: p.type, text: p.text.slice(0, MAX_TEXT) });
        break;
      case "card":
        if (typeof p.jobId === "string") out.push({ type: "card", jobId: p.jobId.slice(0, 128) });
        break;
      case "batch":
        if (typeof p.batchId === "string" && Array.isArray(p.jobIds)) {
          out.push({ type: "batch", batchId: p.batchId.slice(0, 128), jobIds: p.jobIds.filter((j) => typeof j === "string").slice(0, 64) });
        }
        break;
      case "confirm":
        if (p.state === "pending") break; // never persist a pending confirm
        if (typeof p.summary === "string") out.push({ type: "confirm", cid: str(p.cid, 64), summary: p.summary.slice(0, 500), state: p.state === "done" ? "done" : "cancelled" });
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * Validate a chat coming from the wire or from disk; also migrates the old
 * `{role, content}` shape. Returns null when there is nothing usable.
 */
export function sanitizeChat(raw, { now = Date.now() } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && CHAT_ID_RE.test(raw.id) ? raw.id : null;
  if (!id) return null;
  const rawMsgs = Array.isArray(raw.messages) ? raw.messages : [];
  const messages = [];
  for (const m of rawMsgs) {
    if (!m || typeof m !== "object") continue;
    const role = m.role === "user" ? "user" : "assistant";
    let parts = sanitizeParts(m.parts);
    if (!parts.length && typeof m.content === "string") parts = [{ type: "text", text: m.content.slice(0, MAX_TEXT) }];
    if (!parts.length) continue;
    messages.push({ role, parts });
  }
  const trimmed = messages.slice(-MAX_MESSAGES);
  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : now;
  const updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : now;
  return {
    id,
    title: str(raw.title, MAX_TITLE).trim() || deriveTitle(trimmed),
    createdAt,
    updatedAt,
    cliId: str(raw.cliId, 32) || null,
    // Claude's own session, for --resume. Null for other CLIs or before the first turn.
    claudeSessionId: typeof raw.claudeSessionId === "string" && /^[A-Za-z0-9._-]{4,128}$/.test(raw.claudeSessionId) ? raw.claudeSessionId : null,
    messages: trimmed,
  };
}

/** Text of a message's text parts, joined. */
export function messageText(m) {
  if (!m || !Array.isArray(m.parts)) return "";
  return m.parts.filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text).join(" ").replace(/\s+/g, " ").trim();
}

/** First user line, shortened, as the list title; "New conversation" before that. */
export function deriveTitle(messages) {
  const first = (messages ?? []).find((m) => m.role === "user" && messageText(m));
  if (!first) return "New conversation";
  const t = messageText(first);
  return t.length > 48 ? `${t.slice(0, 47).trimEnd()}…` : t;
}

/** Metadata row for the history list — never the messages themselves. */
export function chatSummary(chat) {
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    cliId: chat.cliId ?? null,
    count: chat.messages.filter((m) => m.role === "user").length,
  };
}

/**
 * What the model gets to see of a conversation when it has no session of its
 * own (a fresh Claude turn, or a CLI without --resume): the last `verbatim`
 * turns in full, preceded by a one-line-per-turn digest of the older USER
 * messages. Deterministic and token-cheap — no extra model call to summarize —
 * and it keeps the thread of a long conversation instead of cutting it at 8.
 *
 * @param {{role:string, content:string}[]} history  Oldest first.
 */
export function buildConversationContext(history, { verbatim = 12, digestMax = 20, digestChars = 160 } = {}) {
  const h = (history ?? []).filter((m) => m && typeof m.content === "string" && m.content.trim());
  const recent = h.slice(-verbatim);
  const older = h.slice(0, Math.max(0, h.length - verbatim));
  const digestLines = older
    .filter((m) => m.role === "user")
    .slice(-digestMax)
    .map((m) => `- ${m.content.replace(/\s+/g, " ").trim().slice(0, digestChars)}`);
  const digest = digestLines.length
    ? `Earlier in this conversation the user also asked/said (oldest first, abbreviated):\n${digestLines.join("\n")}\n\n`
    : "";
  const convo = recent.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  return { digest, convo, droppedTurns: older.length };
}

/** Pull `<<session:ID>>` markers out of streamed text; returns the cleaned text and the last id seen. */
export function stripSessionMarkers(text) {
  let sessionId = null;
  const cleaned = String(text ?? "").replace(SESSION_RE, (_, id) => {
    sessionId = id;
    return "";
  });
  return { text: cleaned, sessionId };
}
