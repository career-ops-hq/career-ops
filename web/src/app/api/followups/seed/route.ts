import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/json-body";
import { digitArg, postCoreScript } from "@/lib/run-core-script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Seed the first follow-up pin through followup-seed.mjs. The argument is the
// tracker row number. A row that is not Applied fails in the CLI. This route
// does not pass --force.
export async function POST(req: Request) {
  const body = await readJsonObject<{ n?: unknown }>(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const n = digitArg(body.n);
  if (!n) {
    return NextResponse.json({ error: "n must be a tracker row number" }, { status: 400 });
  }
  return postCoreScript({
    script: "followup-seed",
    args: [n, "--json"],
    logLabel: "api/followups/seed",
    fallback: "could not seed the follow-up",
  });
}
