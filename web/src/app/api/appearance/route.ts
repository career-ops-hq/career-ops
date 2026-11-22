import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";
import { readJsonObject } from "@/lib/json-body";
import { MAX_APPEARANCE_BYTES, normalizeAppearance } from "@/lib/appearance-schema.mjs";
import { readJsonFile } from "@/lib/json-file.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// UI appearance settings live in the user's data root (config/), so they follow
// the user across browsers instead of being tied to one browser's localStorage.
const file = () => path.join(careerOpsRoot(), "config", "ui-appearance.json");

const DAMAGED = "config/ui-appearance.json could not be read. Fix or delete it, then reload.";

// "missing" (never saved, or deleted to reset) is not "damaged" (unreadable, broken JSON,
// or a root that is not an object): a damaged file is shown to the user, never replaced.
function current(): { state: "missing" } | { state: "ok"; value: Record<string, unknown> } | { state: "damaged" } {
  try {
    const raw = readJsonFile(file(), undefined);
    if (raw === undefined) return { state: "missing" };
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { state: "damaged" };
    return { state: "ok", value: raw as Record<string, unknown> };
  } catch {
    return { state: "damaged" };
  }
}

export async function GET() {
  const cur = current();
  if (cur.state === "damaged") return Response.json({ error: DAMAGED }, { status: 500 });
  return Response.json(cur.state === "missing" ? null : normalizeAppearance(cur.value));
}

export async function PUT(req: Request) {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_APPEARANCE_BYTES) {
    return Response.json({ error: "Appearance settings are too large." }, { status: 413 });
  }
  const body = await readJsonObject(req, { maxBytes: MAX_APPEARANCE_BYTES });
  if (!body) return Response.json({ error: "Expected a JSON object (and not an oversized one)." }, { status: 400 });
  // Re-check the file now: it may have become damaged since the page loaded.
  if (current().state === "damaged") return Response.json({ error: DAMAGED }, { status: 409 });
  try {
    atomicWrite(file(), JSON.stringify(normalizeAppearance(body), null, 2));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Could not write config/ui-appearance.json." }, { status: 500 });
  }
}
