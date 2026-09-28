import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADER = [
  "# Agent Inbox",
  "",
  "> **Agent protocol:** at the start of a career-ops session, read this file.",
  "> Run each unchecked item top-to-bottom. After each, mark it `[x]` and append",
  "> `→ result: <one line>`. Items that need live user input (a mock, a paste, a",
  "> decision) → ask the user to start them instead of running them.",
  ">",
  "> Nothing here auto-submits — queued items are *intents* for you to action and",
  "> the user to review. Appended by hand, by a dashboard, or by agent-inbox.mjs.",
  "",
].join("\n");

function getInboxPath() {
  const root = careerOpsRoot();
  return process.env.CAREER_OPS_INBOX || path.join(root, "data", "agent-inbox.md");
}

function parseInbox(content: string) {
  const lines = content.split("\n");
  const items: Array<{
    id: number;
    done: boolean;
    timestamp: string;
    request: string;
    result?: string;
    raw: string;
  }> = [];

  let idx = 1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const match = /^- \[([ xX])\]\s*(.*)$/.exec(trimmed);
    if (match) {
      const done = match[1].toLowerCase() === "x";
      const fullText = match[2];

      let timestamp = "";
      let request = fullText;
      let result: string | undefined = undefined;

      // Extract result if completed: "... → result: ..."
      if (done) {
        const resultSplit = fullText.split(/\s*→\s*result:\s*/i);
        if (resultSplit.length > 1) {
          request = resultSplit[0];
          result = resultSplit.slice(1).join(" → result: ").trim();
        }
      }

      // Extract timestamp if present: "YYYY-MM-DD HH:mm — request"
      const stampMatch = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*—\s*(.*)$/.exec(request);
      if (stampMatch) {
        timestamp = stampMatch[1];
        request = stampMatch[2];
      }

      items.push({
        id: idx++,
        done,
        timestamp,
        request,
        result,
        raw: lines[i],
      });
    }
  }

  return items;
}

export async function GET() {
  const inboxPath = getInboxPath();
  let content = "";
  let exists = false;

  try {
    content = fs.readFileSync(inboxPath, "utf8");
    exists = true;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      exists = false;
      content = "";
    } else {
      return Response.json({ error: "Failed to read agent inbox" }, { status: 500 });
    }
  }

  const items = exists ? parseInbox(content) : [];
  const pendingCount = items.filter((i) => !i.done).length;
  const resolvedCount = items.filter((i) => i.done).length;

  return Response.json({
    exists,
    items,
    pendingCount,
    resolvedCount,
    totalCount: items.length,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, request, id, done, result } = body;
    const inboxPath = getInboxPath();
    const inboxDir = path.dirname(inboxPath);

    if (!fs.existsSync(inboxDir)) {
      fs.mkdirSync(inboxDir, { recursive: true });
    }

    let content = "";
    if (fs.existsSync(inboxPath)) {
      content = fs.readFileSync(inboxPath, "utf8");
    } else {
      content = HEADER;
    }

    if (action === "add") {
      if (!request || typeof request !== "string" || !request.trim()) {
        return Response.json({ error: "Request text is required" }, { status: 400 });
      }

      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      const singleLine = request.replace(/[\r\n\t]+/g, " ").trim();
      const newLine = `- [ ] ${stamp} — ${singleLine}\n`;

      const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
      content = content + separator + newLine;

      atomicWrite(inboxPath, content);
      return Response.json({ ok: true, items: parseInbox(content) });
    }

    if (action === "toggle" || action === "resolve") {
      if (typeof id !== "number") {
        return Response.json({ error: "id is required" }, { status: 400 });
      }

      const lines = content.split("\n");
      let itemIdx = 1;
      let found = false;

      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (/^- \[([ xX])\]\s*(.*)$/.test(trimmed)) {
          if (itemIdx === id) {
            const isDone = done !== undefined ? Boolean(done) : !trimmed.startsWith("- [x]");
            let fullText = trimmed.replace(/^- \[([ xX])\]\s*/, "");

            if (isDone) {
              if (result && !fullText.includes("→ result:")) {
                const cleanResult = String(result).replace(/[\r\n\t]+/g, " ").trim();
                fullText = `${fullText} → result: ${cleanResult}`;
              }
              lines[i] = `- [x] ${fullText}`;
            } else {
              // Revert done
              fullText = fullText.replace(/\s*→\s*result:.*$/i, "");
              lines[i] = `- [ ] ${fullText}`;
            }
            found = true;
            break;
          }
          itemIdx++;
        }
      }

      if (!found) {
        return Response.json({ error: "Item not found" }, { status: 404 });
      }

      content = lines.join("\n");
      atomicWrite(inboxPath, content);
      return Response.json({ ok: true, items: parseInbox(content) });
    }

    if (action === "delete") {
      if (typeof id !== "number") {
        return Response.json({ error: "id is required" }, { status: 400 });
      }

      const lines = content.split("\n");
      let itemIdx = 1;
      let found = false;

      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (/^- \[([ xX])\]\s*(.*)$/.test(trimmed)) {
          if (itemIdx === id) {
            lines.splice(i, 1);
            found = true;
            break;
          }
          itemIdx++;
        }
      }

      if (!found) {
        return Response.json({ error: "Item not found" }, { status: 404 });
      }

      content = lines.join("\n");
      atomicWrite(inboxPath, content);
      return Response.json({ ok: true, items: parseInbox(content) });
    }

    if (action === "clear-resolved") {
      const lines = content.split("\n");
      const filtered = lines.filter((l) => !/^- \[([xX])\]\s*/.test(l.trim()));
      content = filtered.join("\n");
      atomicWrite(inboxPath, content);
      return Response.json({ ok: true, items: parseInbox(content) });
    }

    return Response.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
