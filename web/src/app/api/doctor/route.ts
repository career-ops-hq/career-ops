import { execFile } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAVAILABLE = { available: false, onboardingNeeded: false, missing: [], warnings: [] };

// Orchestrates the core's own cold-start check (doctor.mjs --json) — the SAME
// source of truth the CLI uses to decide onboarding. We never reimplement the
// prerequisite list; we read the core's verdict.
export async function GET() {
  const root = careerOpsRoot();
  const doctor = rootScript("doctor");
  if (!fs.existsSync(doctor)) {
    return Response.json(UNAVAILABLE);
  }
  // process.execPath, not "node": run the core with the very binary serving this
  // page, so PATH order can never pick a different Node. windowsHide: a child
  // that inherits a stale console dies at DLL init with 0xC0000142 on Windows
  // and prints nothing at all (#3809). The old `(_err, out) => out || ""` then
  // parsed that silence as `{}` (onboardingNeeded:false, missing:[]) and told a
  // user with no cv.md they were fully set up, hiding the onboarding banner.
  // "Doctor didn't answer" must surface as available:false, never as a clean
  // bill of health.
  const { failed, stdout } = await new Promise<{ failed: boolean; stdout: string }>((resolve) => {
    execFile(process.execPath, [doctor, "--json"], { cwd: root, timeout: 10_000, windowsHide: true }, (err, out) =>
      resolve({ failed: !!err || !(out ?? "").trim(), stdout: out || "" }),
    );
  });
  if (failed) return Response.json(UNAVAILABLE);
  try {
    const j = JSON.parse(stdout.trim().split("\n").pop() || "");
    // A payload without the verdict is not a verdict: `!!undefined` would read
    // it as "no onboarding needed", the same false all-clear by another road.
    if (typeof j?.onboardingNeeded !== "boolean") throw new Error("doctor --json without onboardingNeeded");
    return Response.json({ available: true, onboardingNeeded: j.onboardingNeeded, missing: j.missing ?? [], warnings: j.warnings ?? [] });
  } catch {
    return Response.json(UNAVAILABLE);
  }
}
