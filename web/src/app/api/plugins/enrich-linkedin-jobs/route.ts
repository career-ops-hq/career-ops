import { NextRequest } from "next/server";
import { runCoreScript } from "@/lib/core/run-core-script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Zero-LLM: fetch LinkedIn job pages and fix pipeline titles that don't match the URL.
export async function POST(req: NextRequest) {
  const applyOnly = req.nextUrl.searchParams.get("agent") === "false";
  const args = applyOnly ? ["--apply-only"] : [];
  const result = runCoreScript("linkedin-job-enrich-cli", args, 900_000);
  return Response.json(result, { status: result.error ? 400 : 200 });
}
