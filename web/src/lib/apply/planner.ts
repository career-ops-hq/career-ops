import { spawnHeadlessCli } from "@/lib/spawn-cli.mjs";
import type { CliSpec } from "@/lib/clis";

/**
 * planner.ts - spawn the read-only planner CLI and collect what it wrote.
 *
 * Moved out of api/apply/prefill/route.ts unchanged. The route is a streaming
 * NDJSON handler wrapped around ~50 lines that are not about streaming at all:
 * choosing the CLI's argv, scaling the kill timer to the form size, and draining
 * stdout/stderr with a heartbeat. Those are planner concerns, and a second
 * caller cannot reuse them while they sit inside a ReadableStream's start().
 *
 * Everything here is a relocation. The argv, the Claude carve-out and its
 * reasoning, the timeout formula, the heartbeat interval, and the resolve-on-
 * error behaviour are byte-for-byte what the route did.
 */

/**
 * One form control, as much of it as the planner needs. Structurally satisfied
 * by ApplyField; kept separate so this module does not import extract.ts and
 * with it playwright-core.
 */
export type PlannerField = {
  id: string;
  type: string;
  label: string;
  required?: boolean;
  options?: string[];
};

/**
 * A finished planner run. `code: null` with `signal: null` means the spawn
 * itself failed; the caller decides whether that is fatal, which is why this
 * resolves rather than rejecting.
 */
export type PlannerRun = { buf: string; code: number | null; signal: NodeJS.Signals | null };

export function runPlanner(opts: {
  /** Undefined is not an error here: only the Claude carve-out below reads it. */
  cliId: string | undefined;
  spec: CliSpec;
  binPath: string;
  prompt: string;
  fieldCount: number;
  cwd: string;
  /** Request start, so elapsed times in the log stay relative to the same t0 the caller reports. */
  t0: number;
  log: (m: string) => void;
}): Promise<PlannerRun> {
  const { cliId, spec, binPath, prompt, fieldCount, cwd, t0, log } = opts;

  const isClaude = cliId === "claude";
  // --strict-mcp-config with no --mcp-config = load ZERO MCP servers → much
  // faster startup (skips the user's global playwright/gmail/linear/… servers
  // the planner doesn't need; it only reads local files).
  const args = isClaude
    ? ["-p", prompt, "--permission-mode", "acceptEdits", "--strict-mcp-config", "--allowedTools", "Read,Glob,Grep", "--disallowedTools", "Bash,Write,Edit,NotebookEdit,Task,WebFetch,WebSearch"]
    : spec.args(prompt);
  // Scale the timeout with form size (big forms = more drafting). Cap < maxDuration.
  const killMs = Math.min(300_000, 150_000 + fieldCount * 6_000);
  log(`Spawning planner (timeout ${Math.round(killMs / 1000)}s)…`);

  return new Promise<PlannerRun>((resolve) => {
    // spawnHeadlessCli closes stdin right after spawning, so the CLI doesn't
    // wait on piped input that will never arrive.
    const child = spawnHeadlessCli(binPath, args, { cwd, env: process.env });
    let buf = "";
    let firstByteAt = 0;
    const hb = setInterval(() => {
      log(`…running ${Math.round((Date.now() - t0) / 1000)}s · ${buf.length} chars received`);
    }, 4000);
    child.stdout.on("data", (d: Buffer) => {
      if (!firstByteAt) {
        firstByteAt = Date.now();
        log(`first output byte at ${Math.round((firstByteAt - t0) / 1000)}s`);
      }
      buf += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      const e = d.toString().trim();
      if (e) log(`stderr: ${e.slice(0, 160).replace(/\s+/g, " ")}`);
    });
    const killer = setTimeout(() => {
      log("TIMEOUT reached → SIGTERM");
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, killMs);
    child.on("close", (code, signal) => {
      clearTimeout(killer);
      clearInterval(hb);
      resolve({ buf, code, signal });
    });
    child.on("error", (e) => {
      clearTimeout(killer);
      clearInterval(hb);
      log(`spawn error: ${e.message}`);
      resolve({ buf, code: null, signal: null });
    });
  });
}
