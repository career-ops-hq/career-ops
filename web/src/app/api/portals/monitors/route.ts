import { execFile } from "node:child_process";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { runCoreCli } from "@/lib/core-cli";
import { readJsonObject } from "@/lib/json-body";
import { schedulerStatus } from "@/lib/scheduler-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function execute(action: string, input: Record<string, unknown> = {}) {
  const result = await runCoreCli("portal-monitor", [action, JSON.stringify(input)], { timeoutMs: 280_000 });
  if (result.timedOut) return Response.json({ error: "The website check timed out. Refresh its status before retrying." }, { status: 504 });
  let body;
  try { body = JSON.parse(result.stdout.trim().split("\n").at(-1) || "{}"); }
  catch { return Response.json({ error: "Could not read the website monitor’s result." }, { status: 500 }); }
  if (result.code !== 0 || body.error) return Response.json({ error: body.error || "Could not run the website monitor." }, { status: /lock|busy/i.test(body.error || "") ? 409 : 400 });
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

export async function GET() { return execute("list"); }

export async function POST(req: Request) {
  const input = await readJsonObject<Record<string, unknown>>(req);
  if (!input || typeof input.action !== "string") return Response.json({ error: "Choose a portal action." }, { status: 400 });
  if (input.action === "install-schedule") {
    const code = resolveCodeRoot(process.cwd(), process.env);
    const windows = process.platform === "win32";
    if (!["darwin", "linux", "win32"].includes(process.platform)) return Response.json({ error: "Automatic monitoring is unavailable on this operating system." }, { status: 400 });
    const script = path.join(code, "web", "scripts", windows ? "install-scan-schedule.ps1" : "install-scan-schedule.sh");
    const error = await new Promise<string | null>(resolve => {
      execFile(windows ? "powershell.exe" : "/bin/sh", windows ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script] : [script],
        { cwd: code, timeout: 25_000, windowsHide: true, env: { ...process.env, CAREER_OPS_ROOT: careerOpsRoot() } },
        (e, _out, err) => resolve(e ? err.trim() || e.message : null));
    });
    if (error) return Response.json({ error: `Could not enable background checks: ${error}` }, { status: 500 });
    return Response.json({ ok: true, scheduler: await schedulerStatus() });
  }
  if (!["preview", "add", "update", "remove", "check", "add-jobs", "read"].includes(input.action)) return Response.json({ error: "Unknown portal action." }, { status: 400 });
  return execute(input.action, input);
}
