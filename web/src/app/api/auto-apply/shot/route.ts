import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, isRegularContainedFile } from "@/lib/career-ops";

export const dynamic = "force-dynamic";

export async function GET() {
  const root = careerOpsRoot();
  const dir = path.join(root, "output/auto-apply");
  const file = path.join(dir, "live/latest.png");
  if (!isRegularContainedFile(file, dir)) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(fs.readFileSync(file), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
}
