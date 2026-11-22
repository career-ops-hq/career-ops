import { spawn } from "node:child_process";
import { rootScript } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILED = {
  added: 0,
  already: 0,
  found: 0,
  message: "Could not add those jobs. Nothing was saved.",
};

const UNCERTAIN = {
  added: 0,
  already: 0,
  found: 0,
  uncertain: true,
  message: "The import did not finish. Check Pipeline before pasting again.",
};

type ImportPayload = {
  added: number;
  already: number;
  found: number;
  message: string;
  error?: string;
  uncertain?: boolean;
};

function runImport(text: string): Promise<ImportPayload> {
  const script = rootScript("linkedin-import");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, "--json"], {
      cwd: resolveCodeRoot(process.cwd(), process.env),
      env: process.env,
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    // A child that ignores SIGTERM used to leave this promise open, so the
    // paste button never came back. The give-up timer id is not proof we
    // timed out: a script can still exit 0 in the grace window.
    const requested = Number(process.env.CAREER_OPS_CHILD_TIMEOUT_MS);
    const timeout = Number.isFinite(requested) && requested > 0 ? requested : 30_000;
    const grace = 2_000;
    let killer: ReturnType<typeof setTimeout> | undefined;
    let hardKill: ReturnType<typeof setTimeout> | undefined;
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    let stopping = false;
    let gaveUp = false;
    let settled = false;
    const finish = (value: ImportPayload) => {
      if (settled) return;
      settled = true;
      if (killer) clearTimeout(killer);
      if (hardKill) clearTimeout(hardKill);
      if (giveUp) clearTimeout(giveUp);
      resolve(value);
    };
    const timedOut = (): ImportPayload => ({
      ...UNCERTAIN,
      message: "The import timed out after 30 seconds and was stopped. Check Pipeline before pasting again.",
      error: "timeout",
    });
    killer = setTimeout(() => {
      stopping = true;
      try { child.kill("SIGTERM"); } catch { /* already gone */ }
      hardKill = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
      }, grace);
      giveUp = setTimeout(() => {
        gaveUp = true;
        finish(timedOut());
      }, grace + 1_000);
    }, timeout);
    child.on("error", () => finish({ ...FAILED, error: "spawn" }));
    child.stdin.on("error", () => finish({ ...FAILED, error: "stdin" }));
    child.on("close", (code) => {
      if (gaveUp) return;
      if (stopping && code == null) {
        finish(timedOut());
        return;
      }
      try {
        const parsed = JSON.parse(out.trim().split("\n").pop() || "") as ImportPayload;
        if (code !== 0 && !parsed.message) finish({ ...FAILED, error: err || `exit ${code}` });
        else finish(parsed);
      } catch {
        // A crash after the pipeline write has no JSON. "Nothing was saved" is
        // only true when the script itself said so, before it wrote anything.
        const detail = err.trim();
        if (/Nothing was saved/i.test(detail)) finish({ ...FAILED, error: detail || `exit ${code}` });
        else finish({ ...UNCERTAIN, error: detail || `exit ${code}` });
      }
    });
    child.stdin.write(text);
    child.stdin.end();
  });
}

export async function POST(req: Request) {
  const body = await readJsonObject<{ text?: unknown }>(req);
  if (!body) {
    return Response.json({ ...FAILED, message: "No LinkedIn jobs found. Open a job alert email, select all, copy, and paste it here." }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text : "";
  const result = await runImport(text);
  const status = result.error === "too-large" ? 413 : result.error ? 500 : 200;
  return Response.json(result, { status });
}
