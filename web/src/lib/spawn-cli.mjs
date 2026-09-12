import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Plain .mjs (same pattern as tracker-table.mjs/clean-chips.mjs) so
// tests/lib/spawn-cli.test.mjs can import it directly under Node. Import it with the
// .mjs extension included (e.g. "@/lib/spawn-cli.mjs") — unlike .ts files,
// which TypeScript resolves without an extension, ESM specifiers for plain
// JS modules must be fully specified.

/**
 * On Windows, npm global CLIs install as .cmd shims wrapping a target .js file.
 * Spawning .cmd via `shell: true` causes cmd.exe to strip quotes and mangle
 * multi-line prompts (%* parameter corruption). Resolving the target .js file
 * allows spawning `node target.js` directly via CreateProcessW with pristine arguments.
 */
function resolveNodeShim(binPath) {
  if (process.platform !== "win32" || !binPath) return null;
  try {
    const content = fs.readFileSync(binPath, "utf8");
    const m = content.match(/%dp0%\\([^\s"]+\.js)/i);
    if (m) {
      const targetJs = path.join(path.dirname(binPath), m[1]);
      if (fs.existsSync(targetJs)) return targetJs;
    }
  } catch {
    /* not readable or binary */
  }
  return null;
}

/**
 * Spawn a headless agent CLI with stdin closed.
 *
 * CLIs such as `codex exec` read additional prompt text from stdin when a pipe
 * is left open. A web request never supplies that extra input, so leaving the
 * default pipe open makes Codex wait forever without producing stdout. This is
 * the ONLY spawn path for CLI-invoking routes — every call site should use it
 * instead of `node:child_process`'s `spawn` directly, so the fix can't drift.
 *
 * It also replaces the `stdio: ["ignore", ...]` the apply planners used to spell
 * for the same reason — one mechanism means one place for this to be right.
 * The options type omits `stdio` on purpose: stdout/stderr must stay pipes for
 * every caller's stream handlers, and TypeScript keeps `child.stdout` non-null
 * only under that contract. `stdin` is still optional-chained so an untyped
 * caller passing `stdio` anyway degrades safely (null stdin) instead of throwing.
 *
 * @param {string} binPath
 * @param {string[]} args
 * @param {import("node:child_process").SpawnOptionsWithoutStdio} options
 */
export function spawnHeadlessCli(binPath, args, options = {}) {
  const nodeTarget = resolveNodeShim(binPath);
  if (nodeTarget) {
    const child = spawn(process.execPath, [nodeTarget, ...args], options);
    child.stdin?.end();
    return child;
  }

  const isCmdOrBat = process.platform === "win32" && /\.(cmd|bat)$/i.test(binPath);
  const opts = isCmdOrBat && options?.shell === undefined ? { ...options, shell: true } : options;
  const child = spawn(binPath, args, opts);
  child.stdin?.end();
  return child;
}

