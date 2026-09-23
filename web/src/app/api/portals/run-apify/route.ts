import { runCoreScript } from "@/lib/core/run-core-script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Runs the user's Apify-provider portals.yml entries (currently named "Apify — …")
// via a scoped `node scan.mjs --company "Apify"` — the SAME zero-token path
// `node scan.mjs` always used, just triggered from a click instead of a terminal.
// This spends real Apify credits (not AI tokens) and needs APIFY_TOKEN in .env —
// scan.mjs's own error message surfaces that clearly if it's missing.
export async function POST() {
  const result = runCoreScript("scan", ["--company", "Apify"], 120_000);
  return Response.json(result, { status: result.error ? 400 : 200 });
}
