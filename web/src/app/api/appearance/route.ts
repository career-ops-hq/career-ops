import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// UI appearance settings live in the user's data root (config/), so they follow
// the user across browsers instead of being tied to one browser's localStorage.
const file = () => path.join(careerOpsRoot(), "config", "ui-appearance.json");

export async function GET() {
  try {
    return Response.json(JSON.parse(fs.readFileSync(file(), "utf8")));
  } catch {
    return Response.json(null);
  }
}

export async function PUT(req: Request) {
  const body = await req.json();
  if (!body || typeof body !== "object") return new Response("bad body", { status: 400 });
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(body));
  return Response.json({ ok: true });
}
