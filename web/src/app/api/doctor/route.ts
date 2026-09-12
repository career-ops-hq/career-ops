import { execFile } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Orchestrates the core's own cold-start check (doctor.mjs --json) — the SAME
// source of truth the CLI uses to decide onboarding. We never reimplement the
// prerequisite list; we read the core's verdict.
export async function GET() {
  const root = careerOpsRoot();
  const doctor = rootScript("doctor");
  if (!fs.existsSync(doctor)) {
    return Response.json({ available: false, onboardingNeeded: false, missing: [], warnings: [] });
  }
  // process.execPath, not "node": run the core with the very binary serving this
  // page, so PATH order can never pick a different Node. windowsHide: a child
  // that inherits a stale console dies at DLL init with 0xC0000142 on Windows
  // and produces no stdout at all — which the old `out || ""` + `"{}"` fallback
  // then reported as "fully set up" (onboardingNeeded:false, missing:[]), hiding
  // the onboarding banner for a user with no cv.md. "Doctor didn't answer" must
  // surface as available:false, never as a clean bill of health.
  const { failed, stdout } = await new Promise<{ failed: boolean; stdout: string }>((resolve) => {
    execFile(process.execPath, [doctor, "--json"], { cwd: root, timeout: 10_000, windowsHide: true }, (err, out) =>
      resolve({ failed: !!err || !(out ?? "").trim(), stdout: out || "" }),
    );
  });
  if (failed) return Response.json({ available: false, onboardingNeeded: false, missing: [], warnings: [] });
  try {
    const last = stdout.trim().split("\n").pop() || "";
    const j = JSON.parse(last);
    if (typeof j.onboardingNeeded !== "boolean") throw new Error("doctor --json without onboardingNeeded");
    return Response.json({ available: true, onboardingNeeded: j.onboardingNeeded, missing: j.missing ?? [], warnings: j.warnings ?? [] });
  } catch {
    return Response.json({ available: false, onboardingNeeded: false, missing: [], warnings: [] });
  }
}
