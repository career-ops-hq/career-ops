import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { cliChildEnv } from "@/lib/cli-spawn";

export type RunScriptResult = { output: string; exitCode: number | null; error?: string };

/**
 * Run one of the core's own .mjs scripts as a plain, bounded subprocess — NO AI
 * CLI involved (unlike the Portals/AI-search hunts, which need an agent to do
 * WebSearch). This is for actions that are already zero-LLM-token at the CLI —
 * a scoped scan.mjs run, a plugins.mjs ingest run — so the web UI can trigger
 * them with a click instead of a terminal command.
 */
export function runCoreScript(scriptName: string, args: string[], timeoutMs = 120_000): RunScriptResult {
  const script = rootScript(scriptName);
  if (!fs.existsSync(script)) {
    return { output: "", exitCode: null, error: `${scriptName}.mjs isn't available in this checkout.` };
  }
  const cwd = careerOpsRoot();
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: cliChildEnv(process.execPath, cwd, process.env),
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = (result.stdout || "") + (result.stderr || "");
  if (result.error) return { output, exitCode: null, error: result.error.message };
  return { output, exitCode: result.status };
}
