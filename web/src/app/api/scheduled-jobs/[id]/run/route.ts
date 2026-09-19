import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getScheduledJob } from "@/lib/scheduled-jobs";
import { isSafeScheduledId } from "@/lib/scheduled-jobs-store.mjs";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 76 * 60 * 1_000;
const KILL_GRACE_MS = 5_000;
const MAX_OUTPUT = 512 * 1024;

type RouteContext = { params: Promise<{ id: string }> };

function runJob(runner: string, id: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: { code: number | null; stdout: string; stderr: string; timedOut: boolean }) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };

    let child;
    try {
      child = spawn(process.execPath, [runner, "--job", id], {
        cwd: careerOpsRoot(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      finish({ code: 1, stdout, stderr: error instanceof Error ? error.message : "Could not start scheduled scan.", timedOut });
      return;
    }

    const append = (current: string, chunk: Buffer) => (current + chunk.toString()).slice(-MAX_OUTPUT);
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });

    timeoutTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* close/error settles the promise */ }
      killTimer = setTimeout(() => {
        if (settled) return;
        try { child.kill("SIGKILL"); } catch { /* close/error settles the promise */ }
      }, KILL_GRACE_MS);
    }, TIMEOUT_MS);

    child.once("error", (error) => {
      finish({ code: 1, stdout, stderr: error.message, timedOut });
    });
    child.once("close", (code) => {
      finish({ code, stdout, stderr, timedOut });
    });
  });
}

export async function POST(_req: Request, { params }: RouteContext) {
  const { id } = await params;
  if (!isSafeScheduledId(id)) return NextResponse.json({ error: "Invalid scheduled job identifier." }, { status: 400 });
  let job;
  try {
    job = getScheduledJob(id);
    if (!job || job.status === "deleted") return NextResponse.json({ error: "Scheduled job not found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Could not read scheduled jobs." }, { status: 500 });
  }

  const runner = path.join(careerOpsRoot(), "scripts", "scheduled-jobs-runner.mjs");
  if (!fs.existsSync(runner)) {
    return NextResponse.json({ error: "Scheduled job runner is not installed." }, { status: 404 });
  }

  const result = await runJob(runner, id);
  if (result.timedOut) {
    return NextResponse.json({ error: "Scheduled scan timed out." }, { status: 504 });
  }
  if (result.code !== 0) {
    const message = result.stderr.split(/\r?\n/).find(Boolean)?.slice(0, 300) || "Scan failed.";
    const status = /lock timeout/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  try {
    const summary = JSON.parse(result.stdout.trim()) as { rolesFound?: unknown };
    const rolesFound = Number.isFinite(Number(summary.rolesFound)) ? Number(summary.rolesFound) : 0;
    return NextResponse.json({ success: true, rolesFound, summary });
  } catch {
    return NextResponse.json({ error: "Scheduled scan returned an invalid result." }, { status: 500 });
  }
}
