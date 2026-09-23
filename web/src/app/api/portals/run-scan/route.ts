import { runCoreScript } from "@/lib/core/run-core-script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Full `node scan.mjs` — tracked_companies + job_boards (board-browser,
// weworkremotely, RSS/API providers). Zero AI tokens; browser boards may take
// a few minutes on first run while Playwright loads each listing page.
export async function POST() {
  const result = runCoreScript("scan", [], 600_000);
  return Response.json(result, { status: result.error ? 400 : 200 });
}
