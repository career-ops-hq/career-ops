import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";
import { readJsonObject } from "@/lib/json-body";
import { normalizeAppearance } from "@/lib/appearance-schema.mjs";
import { readJsonFile } from "@/lib/json-file.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// UI appearance settings live in the user's data root (config/), so they follow
// the user across browsers instead of being tied to one browser's localStorage.
const file = () => path.join(careerOpsRoot(), "config", "ui-appearance.json");

// Missing file -> null (defaults). A damaged file is an error the user can act
// on, never an empty default that the next save would overwrite.
export async function GET() {
  try {
    const raw = readJsonFile(file(), null);
    return Response.json(raw === null ? null : normalizeAppearance(raw));
  } catch {
    return Response.json(
      { error: "config/ui-appearance.json could not be read. Fix or delete it, then reload." },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  const body = await readJsonObject(req);
  if (!body) return Response.json({ error: "Expected a JSON object." }, { status: 400 });
  try {
    atomicWrite(file(), JSON.stringify(normalizeAppearance(body), null, 2));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Could not write config/ui-appearance.json." }, { status: 500 });
  }
}
