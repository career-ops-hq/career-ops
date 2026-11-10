import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { readJsonObject } from "@/lib/json-body";
import { normalizeProgress, readJsonFile, writeJsonAtomic } from "@/lib/ui-state.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Prep checklist progress lives in the user's data folder, separate from the
// generated prep guides (those are never rewritten by ticking a box).
const file = () => path.join(careerOpsRoot(), "data", "prep-progress.json");

// Missing file -> empty progress. A damaged file is reported, not replaced:
// the viewer stops saving until the user fixes it, so no progress is lost.
export async function GET() {
  try {
    return Response.json(normalizeProgress(readJsonFile(file(), { ticks: {}, tasks: {} })));
  } catch {
    return Response.json(
      { error: "data/prep-progress.json could not be read. Fix or delete it, then reload." },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  const body = await readJsonObject(req);
  if (!body) return Response.json({ error: "Expected a JSON object." }, { status: 400 });
  try {
    writeJsonAtomic(file(), normalizeProgress(body));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Could not write data/prep-progress.json." }, { status: 500 });
  }
}
