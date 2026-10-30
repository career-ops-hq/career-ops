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

type ImportPayload = {
  added: number;
  already: number;
  found: number;
  message: string;
  error?: string;
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
    const killer = setTimeout(() => child.kill("SIGTERM"), 30_000);
    child.on("error", () => {
      clearTimeout(killer);
      resolve({ ...FAILED, error: "spawn" });
    });
    child.stdin.on("error", () => resolve({ ...FAILED, error: "stdin" }));
    child.on("close", (code) => {
      clearTimeout(killer);
      try {
        const parsed = JSON.parse(out.trim().split("\n").pop() || "") as ImportPayload;
        if (code !== 0 && !parsed.message) resolve({ ...FAILED, error: err || `exit ${code}` });
        else resolve(parsed);
      } catch {
        resolve({ ...FAILED, error: err || `exit ${code}` });
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
