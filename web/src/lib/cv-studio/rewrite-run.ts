import { spawnHeadlessCli } from "@/lib/spawn-cli.mjs";
import { fencingReport } from "@/lib/cli-fencing.mjs";
import { CAPS } from "@/lib/worker-capabilities.mjs";
import { scopeFrom } from "@/lib/claude-invocation.mjs";
import { resolveCliOrFallback } from "@/lib/clis";
import { careerOpsRoot } from "@/lib/career-ops";
import { rewriteGate } from "@/lib/cv-studio/rewrite.mjs";

// Deny list derived, never hand-written (#2185, #2507). The rewrite needs no
// tools at all; Read is the narrowest scope the Claude argv accepts.
const REWRITE_SCOPE = scopeFrom("Read");
const KILL_MS = 120_000;

export type RewriteRun = { ok: true; reply: string; warning: string | null } | { ok: false; reason: "no-cli" | "unfenced" | "refused" | "failed"; detail?: string };

export function runRewrite(cliId: string, prompt: string): Promise<RewriteRun> {
  const resolved = resolveCliOrFallback(cliId);
  if (!resolved) return Promise.resolve({ ok: false, reason: "no-cli" });
  const { spec, binPath } = resolved;
  const fencing = fencingReport({ cliId: spec.id, cliName: spec.name, capabilities: CAPS.localReadOnly });
  const gate = rewriteGate(spec.id, fencing);
  if (!gate.run) return Promise.resolve({ ok: false, reason: "unfenced", detail: fencing.notice ?? undefined });
  const args =
    spec.id === "claude"
      ? ["-p", prompt, "--permission-mode", "acceptEdits", "--strict-mcp-config", "--allowedTools", REWRITE_SCOPE.allowed, "--disallowedTools", REWRITE_SCOPE.disallowed]
      : spec.args(prompt);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnHeadlessCli(binPath, args, { cwd: careerOpsRoot(), env: process.env }, { cliId: spec.id, capabilities: CAPS.localReadOnly });
    } catch (e) {
      return resolve({ ok: false, reason: "refused", detail: e instanceof Error ? e.message : undefined });
    }
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    const killer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      resolve({ ok: false, reason: "failed", detail: `no reply after ${KILL_MS / 1000}s` });
    }, KILL_MS);
    child.on("close", (code: number | null) => {
      clearTimeout(killer);
      resolve(code === 0 ? { ok: true, reply: out, warning: gate.warning } : { ok: false, reason: "failed", detail: err.trim().split("\n").filter(Boolean).at(-1)?.slice(0, 300) });
    });
    child.on("error", (e: Error) => {
      clearTimeout(killer);
      resolve({ ok: false, reason: "failed", detail: e.message });
    });
  });
}
