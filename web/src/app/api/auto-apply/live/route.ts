import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, isRegularContainedFile } from "@/lib/career-ops";
import { deriveStatus, parseLiveLog } from "@/lib/auto-apply-live.mjs";
import { loadDecisionStore } from "@/lib/auto-apply-decisions.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const root = careerOpsRoot();
  const log = path.join(root, "output/auto-apply/live.jsonl");
  let events: ReturnType<typeof parseLiveLog> = [];
  try { events = parseLiveLog(fs.readFileSync(log, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let latestSummary: { name: string; text: string } | null = null;
  try {
    const dir = path.join(root, "output");
    const files = fs.readdirSync(dir).filter(name => /^auto-apply-.*\.md$/.test(name)).sort().reverse();
    const file = files.map(name => path.join(dir, name)).find(file => isRegularContainedFile(file, dir));
    if (file) latestSummary = { name: path.basename(file), text: fs.readFileSync(file, "utf8") };
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const shot = path.join(root, "output/auto-apply/live/latest.png");
  const latestScreenshot = isRegularContainedFile(shot, path.join(root, "output/auto-apply")) ? "/api/auto-apply/shot" : null;
  let decisions: ReturnType<typeof loadDecisionStore> = [];
  try { decisions = loadDecisionStore(root); } catch { /* malformed state is surfaced by the decision API on write */ }
  return Response.json({ status: deriveStatus(events), events: events.slice(-200).reverse(), latestScreenshot, latestSummary, decisions }, { headers: { "Cache-Control": "no-store" } });
}
