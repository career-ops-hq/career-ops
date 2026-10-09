import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getScheduledJob } from "@/lib/scheduled-jobs";
import { isSafeScheduledId } from "@/lib/scheduled-jobs-store.mjs";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";

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
        cwd: resolveCodeRoot(process.cwd(), process.env),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      finish({ code: 1, stdout, stderr: error instanceof Error ? error.message : "Não foi possível iniciar a pesquisa agendada.", timedOut });
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
  if (!isSafeScheduledId(id)) return NextResponse.json({ error: "Identificador de pesquisa inválido." }, { status: 400 });
  let job;
  try {
    job = getScheduledJob(id);
    if (!job || job.status === "deleted") return NextResponse.json({ error: "Pesquisa agendada não encontrada." }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Não foi possível ler as pesquisas agendadas." }, { status: 500 });
  }

  const runner = path.join(resolveCodeRoot(process.cwd(), process.env), "web", "scripts", "scheduled-jobs-runner.mjs");
  if (!fs.existsSync(runner)) {
    return NextResponse.json({ error: "O executor de pesquisas agendadas não está instalado." }, { status: 404 });
  }

  const result = await runJob(runner, id);
  if (result.timedOut) {
    return NextResponse.json({ error: "A pesquisa agendada excedeu o tempo limite." }, { status: 504 });
  }
  if (result.code !== 0) {
    const message = result.stderr.split(/\r?\n/).find(Boolean)?.slice(0, 300) || "A pesquisa falhou.";
    const status = /lock timeout/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  try {
    const summary = JSON.parse(result.stdout.trim()) as { rolesFound?: unknown };
    const rolesFound = Number.isFinite(Number(summary.rolesFound)) ? Number(summary.rolesFound) : 0;
    return NextResponse.json({ success: true, rolesFound, summary });
  } catch {
    return NextResponse.json({ error: "A pesquisa agendada devolveu um resultado inválido." }, { status: 500 });
  }
}
