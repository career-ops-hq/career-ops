import fs from "node:fs";
import path from "node:path";

import { analyzeAtsReadiness } from "@/lib/ats-foundation.mjs";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function currentCv(): string {
  try {
    return fs.readFileSync(path.join(careerOpsRoot(), "cv.md"), "utf8");
  } catch {
    return "";
  }
}

export async function GET() {
  return Response.json(analyzeAtsReadiness(currentCv()));
}

export async function POST(req: Request) {
  let body: { content?: string; jobDescription?: string };
  try {
    body = (await req.json()) as { content?: string; jobDescription?: string };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content : currentCv();
  const jobDescription = typeof body.jobDescription === "string" ? body.jobDescription : "";
  if (Buffer.byteLength(content, "utf8") > 1_000_000 || Buffer.byteLength(jobDescription, "utf8") > 200_000) {
    return Response.json({ error: "input too large" }, { status: 413 });
  }

  return Response.json(analyzeAtsReadiness(content, { jobDescription }));
}
