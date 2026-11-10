import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Prep checklist progress lives in the user's data folder, separate from the
// generated prep guides (those are never rewritten by ticking a box).
const file = () => path.join(careerOpsRoot(), "data", "prep-progress.json");

export async function GET() {
  try {
    return Response.json(JSON.parse(fs.readFileSync(file(), "utf8")));
  } catch {
    return Response.json({ ticks: {}, tasks: {} });
  }
}

export async function PUT(req: Request) {
  const body = await req.json();
  if (!body || typeof body !== "object") return new Response("bad body", { status: 400 });
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(body, null, 2));
  return Response.json({ ok: true });
}
