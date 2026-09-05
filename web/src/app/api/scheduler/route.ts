import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { schedulerStatus } from "@/lib/scheduler-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function runnerScript() {
  return path.join(careerOpsRoot(), "scripts", "scheduled-jobs-runner.mjs");
}

export async function GET() {
  return NextResponse.json(await schedulerStatus(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  const script = runnerScript();
  if (!fs.existsSync(script)) {
    return NextResponse.json({ error: "Scheduled job runner is not installed." }, { status: 404 });
  }

  try {
    const child = spawn(process.execPath, [script], {
      cwd: careerOpsRoot(),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      child.once("spawn", () => {
        settled = true;
        resolve();
      });
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
    });
    child.unref();
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch {
    return NextResponse.json({ error: "Could not start the local scheduled-job runner." }, { status: 500 });
  }
}
