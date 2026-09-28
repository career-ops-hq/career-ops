import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

/** True when the resolved binary is a Free Claude Code client launcher. */
export function isFccCli(binPath: string): boolean {
  return /fcc-|free-claude-code/i.test(binPath);
}

/**
 * Env for a spawned CLI child. FCC launchers read `PORT`/`HOST` from the
 * environment to locate fcc-server — Next.js dev sets PORT=3001, which makes
 * fcc-claude probe the web UI instead of the proxy on 8082.
 *
 * Always rewrite PWD to the spawn cwd: Next runs with PWD=…/web, and children
 * (OpenCode project root, bash tools) that trust PWD over getcwd then resolve
 * `doctor.mjs` to web/doctor.mjs and crash with MODULE_NOT_FOUND.
 */
export function cliChildEnv(
  binPath: string,
  cwd: string,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, PWD: cwd };
  if (isFccCli(binPath)) {
    delete env.PORT;
    delete env.HOST;
  }
  return env;
}

export function spawnCli(
  binPath: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; detached?: boolean },
): ChildProcessByStdio<null, Readable, Readable> {
  return spawn(binPath, args, {
    cwd: opts.cwd,
    env: cliChildEnv(binPath, opts.cwd, opts.env ?? process.env),
    stdio: ["ignore", "pipe", "pipe"],
    detached: opts.detached ?? false,
  });
}

/**
 * Kill a detached CLI and (on Unix) its whole process group. A budget/cancel
 * kill of only the top-level `opencode run` leaves e.g. a `npm exec
 * @playwright/mcp` grandchild orphaned; with detached:true the child leads a
 * fresh group, so -pid reaches the tree in one signal. Windows has no negative
 * pids — the direct child.kill fallback is the best we get there.
 */
export function killCliTree(
  child: ChildProcessByStdio<null, Readable, Readable>,
  detached?: boolean,
): void {
  if (detached && child.pid != null) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* group may be gone (child already exited) — fall through */
    }
  }
  try {
    child.kill("SIGTERM");
  } catch {
    /* already dead */
  }
}
