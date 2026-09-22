import { spawnHeadlessCli } from "@/lib/spawn-cli.mjs";
import { CAPS } from "@/lib/worker-capabilities.mjs";
import { scopeFrom } from "@/lib/claude-invocation.mjs";
import { fencingReport } from "@/lib/cli-fencing.mjs";
import type { CliSpec } from "@/lib/clis";
import { careerOpsEnv } from "@/lib/career-ops";

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
 *
 * The planner's permissions live here too (#2507): the capability record it
 * runs under, the derived Claude deny list, the unfenced-runtime notice and the
 * fencing refusal all moved with the spawn, so a second caller inherits the
 * same fence instead of re-spelling it.
 */

// Deny list DERIVED, never hand-written: every one of the six advisor argvs
// that spelled its own omitted MultiEdit, which --permission-mode acceptEdits
// then auto-approves (#2185, #2507).
const ADVISOR_SCOPE = scopeFrom("Read,Glob,Grep");

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
 * resolves rather than rejecting. `refused` carries the fencing refusal when
 * spawnHeadlessCli would not start the CLI at all (#2507): the argv contradicted
 * the capability record, so nothing ran and `buf` is empty by construction.
 */
export type PlannerRun = { buf: string; code: number | null; signal: NodeJS.Signals | null; refused?: string };

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
    ? ["-p", prompt, "--permission-mode", "acceptEdits", "--strict-mcp-config", "--allowedTools", ADVISOR_SCOPE.allowed, "--disallowedTools", ADVISOR_SCOPE.disallowed]
    : spec.args(prompt);
  // A runtime with no verified fencing mechanism plans with its default access.
  // log() is the caller's non-fatal channel; it surfaces in the collapsed
  // "Pre-fill diagnostics" drawer, which is where the other planner facts go
  // (#2507).
  const fencing = fencingReport({ cliId: spec.id, cliName: spec.name, capabilities: CAPS.localReadOnly });
  if (fencing.notice) log(`⚠️ ${fencing.notice}`);
  // Scale the timeout with form size (big forms = more drafting). Cap < maxDuration.
  const killMs = Math.min(300_000, 150_000 + fieldCount * 6_000);
  log(`Spawning planner (timeout ${Math.round(killMs / 1000)}s)…`);

  return new Promise<PlannerRun>((resolve) => {
    // spawnHeadlessCli closes stdin right after spawning, so the CLI doesn't
    // wait on piped input that will never arrive.
    // Drafts answers from local files only: the Claude branch allows
    // Read,Glob,Grep and denies WebFetch/WebSearch along with every write
    // tool, so Codex gets a true read-only sandbox here.
    let child;
    try {
      child = spawnHeadlessCli(
        binPath,
        args,
        { cwd, env: careerOpsEnv() },
        // spec.id, not the caller's cliId: same value once resolveCli has
        // accepted it, but typed as the canonical id rather than the caller's
        // optional string.
        { cliId: spec.id, capabilities: CAPS.localReadOnly },
      );
    } catch (e) {
      // Fencing refuses an argv that contradicts the capability record. Resolve
      // with the reason so the caller reports it and closes its stream; an
      // escaping throw inside this executor would leave the promise pending
      // and the client waiting on a stream that never ends.
      const refused = e instanceof Error ? e.message : "failed to start the planner";
      log(`spawn refused: ${refused}`);
      return resolve({ buf: "", code: null, signal: null, refused });
    }
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
