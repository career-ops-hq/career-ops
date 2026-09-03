import { execFile } from "node:child_process";
import type { AiProviderStatus } from "./types.ts";

export class ProviderExecutionError extends Error {
  readonly status: AiProviderStatus;
  readonly stderr: string;

  constructor(message: string, status: AiProviderStatus = "error", stderr = "") {
    super(message);
    this.name = "ProviderExecutionError";
    this.status = status;
    this.stderr = stderr;
  }
}

export function classifyProviderError(message: string): AiProviderStatus {
  const text = message.toLowerCase();
  if (/not found|enoent|is not recognized|no such file/.test(text)) return "not_installed";
  if (/quota|resource[_ -]?exhausted|limit exhausted/.test(text)) return "quota_exhausted";
  if (/rate.?limit|too many requests|\b429\b/.test(text)) return "rate_limited";
  if (/not authenticated|authentication|unauthorized|login required|sign in|\b401\b/.test(text)) return "auth_required";
  if (/timeout|timed out|temporar|unavailable|\b502\b|\b503\b|\b504\b|econnreset|enotfound/.test(text)) {
    return "temporary_unavailable";
  }
  return "error";
}

export function usefulError(message: string, stderr = ""): string {
  const combined = [stderr.trim(), message.trim()].filter(Boolean).join("\n");
  const lines = combined.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(-8).join("\n").slice(0, 1200) || "Provider returned an unknown error";
}

export function execFileAsync(
  executable: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; maxBuffer?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      executable,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 5 * 60_000,
        maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          const summary = usefulError(error.message, stderr);
          reject(new ProviderExecutionError(summary, classifyProviderError(summary), stderr));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
    // Headless CLIs may wait for an optional stdin block unless the pipe is explicitly closed.
    child.stdin?.end();
  });
}

export async function executableAvailable(executable: string, versionArgs = ["--version"]): Promise<boolean> {
  try {
    await execFileAsync(executable, versionArgs, { timeoutMs: 10_000, maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}
