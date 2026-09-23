import { runCoreScript } from "@/lib/core/run-core-script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Runs `node plugins.mjs run linkedin-alerts` — reads Gmail (read-only OAuth
// scope) for LinkedIn job-alert emails and appends any new ones to the
// pipeline. Zero AI tokens; the only cost is a Gmail API read call.
export async function POST() {
  const result = runCoreScript("plugins", ["run", "linkedin-alerts"], 150_000);
  return Response.json(result, { status: result.error ? 400 : 200 });
}
