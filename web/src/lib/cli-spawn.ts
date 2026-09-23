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
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
): ChildProcessByStdio<null, Readable, Readable> {
  return spawn(binPath, args, {
    cwd: opts.cwd,
    env: cliChildEnv(binPath, opts.cwd, opts.env ?? process.env),
    stdio: ["ignore", "pipe", "pipe"],
  });
}
