import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { parseLiveLog } from "@/lib/auto-apply-live.mjs";
import { loadDecisionStore, saveDecision, validateDecisionRequest } from "@/lib/auto-apply-decisions.mjs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return Response.json({ error: "Content-Type must be application/json" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const root = careerOpsRoot();
  let events;
  try { events = parseLiveLog(fs.readFileSync(path.join(root, "output/auto-apply/live.jsonl"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") events = []; else return Response.json({ error: "Could not read current queue" }, { status: 500 }); }
  let entry;
  try { entry = validateDecisionRequest(body, new Set(events.filter((event) => event.type === "queue" && typeof event.url === "string").map((event) => event.url))); }
  catch (error) { const message = String((error as Error).message); return Response.json({ error: message }, { status: message.startsWith("URL is not") ? 404 : 400 }); }
  try {
    const result = saveDecision(root, entry);
    return Response.json({ decision: result, decisions: loadDecisionStore(root) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: String((error as Error).message) }, { status: 500 }); }
}
