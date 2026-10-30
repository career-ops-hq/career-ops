import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, portalsConfigPath, rootScript } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Orchestrates the core's verify-portals.mjs (#1016) — the SAME ATS-slug
// validator the CLI uses. Catches the silent 404s that quietly drop a company
// from every future scan (= lost offers). We parse its console output; we do NOT
// reimplement the validation.
const STATUS: Record<string, "live" | "empty" | "broken" | "skipped"> = {
  "✅": "live",
  "🟡": "empty",
  "❌": "broken",
  "➖": "skipped",
};

export async function GET() {
  const root = careerOpsRoot();
  const verifyPortals = rootScript("verify-portals");
  if (!fs.existsSync(verifyPortals)) {
    return Response.json({ available: false, configured: false, companies: [] });
  }
  if (!fs.existsSync(portalsConfigPath(root))) {
    return Response.json({ available: true, configured: false, companies: [] });
  }

  // process.execPath + windowsHide: see api/doctor/route.ts. And a run that did
  // not finish is reported as a failure, never parsed: the old callback dropped
  // the error and an empty stdout became `{ configured: true, companies: [] }`,
  // i.e. "nothing broken" from the one check that exists to catch silently
  // broken portals. Partial output is no better: the companies the sweep never
  // reached would be missing from the list rather than flagged (#3809).
  const { stdout, error } = await new Promise<{ stdout: string; error: string | null }>((resolve) => {
    execFile(
      process.execPath,
      [verifyPortals],
      { cwd: root, timeout: 110_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (e, out, err) => {
        const stdout = out || "";
        if (!e && stdout.trim()) return resolve({ stdout, error: null });
        // How the run ended (the Windows console failure prints nothing and
        // exits 3221225794).
        const how = !e
          ? "no output"
          : typeof e.code === "string"
            ? e.code
            : e.killed
              ? "timed out"
              : e.signal
                ? `killed by ${e.signal}`
                : `exit code ${e.code}`;
        // Killed, or never started: whatever stderr last held is some
        // provider's routine warning, not why the sweep stopped.
        if (e && (e.killed || e.signal || typeof e.code === "string")) return resolve({ stdout, error: how });
        // Otherwise the core's own failure line, or the error an uncaught crash
        // printed. Node ends a crash with its version banner, which says
        // nothing about the failure, so that line never counts.
        const lines = (err || "").split("\n").filter((l) => l.trim() && !/^Node\.js v\d/.test(l));
        const why =
          lines.findLast((l) => l.startsWith("verify-portals failed:")) ?? lines.find((l) => /^\w*Error\b/.test(l));
        const said = lines.pop()?.trim();
        resolve({ stdout, error: why?.trim() || (said ? `${how}: ${said}` : how) });
      },
    );
  });
  if (error) {
    return Response.json({ available: false, configured: false, companies: [], error });
  }

  const companies: { name: string; status: string; detail: string }[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^\s*(✅|🟡|❌|➖)\s+(.+?)\s+—\s+(.*)$/);
    if (m) companies.push({ name: m[2].trim(), status: STATUS[m[1]] ?? "unknown", detail: m[3].trim() });
  }
  return Response.json({ available: true, configured: true, companies });
}
