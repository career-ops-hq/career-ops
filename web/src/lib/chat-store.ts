import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";
import { sanitizeChat, CHAT_ID_RE } from "@/lib/chats.mjs";

// Filesystem side of assistant conversations: .career-ops-web/chats/<id>.json —
// the same web-managed, gitignored dir as the worker logs, so the CLI can read
// past conversations the way it reads runs/. Kept out of the route files
// because a Next route module may only export HTTP handlers.

export type StoredChat = NonNullable<ReturnType<typeof sanitizeChat>>;

export function chatsDir() {
  return path.join(careerOpsRoot(), ".career-ops-web", "chats");
}

/** Absolute path for an id, or null when the id is not one we would ever have minted (also rules out traversal). */
export function chatPath(id: string): string | null {
  if (!CHAT_ID_RE.test(id)) return null;
  return path.join(chatsDir(), `${id}.json`);
}

export function readChat(id: string): StoredChat | null {
  const p = chatPath(id);
  if (!p || !fs.existsSync(p)) return null;
  try {
    return sanitizeChat(JSON.parse(fs.readFileSync(p, "utf8")));
  } catch {
    return null; // unreadable file: absent, not a crash for the whole list
  }
}

/** Atomic write; a kill mid-write can never truncate a conversation. */
export function writeChat(chat: StoredChat): void {
  const p = chatPath(chat.id);
  if (!p) throw new Error("invalid chat id");
  fs.mkdirSync(chatsDir(), { recursive: true });
  atomicWrite(p, JSON.stringify(chat));
}

export function deleteChat(id: string): boolean {
  const p = chatPath(id);
  if (!p || !fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}

export function listChatIds(): string[] {
  const dir = chatsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5));
}
