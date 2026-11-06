// Real plan limits for the web usage meter, from `claude -p "/usage"`.
//
// `/usage` is answered locally by the Claude CLI (no model call, no tokens),
// using the CLI's own login, so the web app never touches a credential. The
// answer is human-readable text inside the JSON `result` field, so it is parsed
// with a few patterns; anything unrecognised returns null and the caller falls
// back to the local-log estimate.

import { execFile } from "node:child_process";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareCliLaunch } from "./cli-launch.mjs";

const TIMEOUT_MS = 15_000;

/**
 * Parse the text `/usage` prints. Returns null unless a session or week line
 * is found.
 * @param {string} text
 * @returns {{ rows: { label: string, percent: number, resets: string | null }[] } | null}
 */
export function parsePlanUsage(text) {
  if (typeof text !== "string") return null;
  const rows = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(Current (?:session|week)[^:]*):\s*(\d+(?:\.\d+)?)%\s*used(?:\s*·\s*resets\s+(.+?))?\s*$/i);
    if (m) rows.push({ label: m[1].trim(), percent: Number(m[2]), resets: m[3] ?? null });
  }
  return rows.length ? { rows } : null;
}

/**
 * The binaries the Claude desktop app bundles, newest version first (macOS
 * layout: ~/Library/Application Support/Claude/claude-code/<version>/<hash>/claude.app/Contents/MacOS/claude).
 * Finding `claude` itself is the caller's job: findBin() in clis.ts.
 */
export async function desktopBinaries({ fs = fsPromises, home = os.homedir() } = {}) {
  const out = [];
  const base = path.join(home, "Library", "Application Support", "Claude", "claude-code");
  try {
    const versions = (await fs.readdir(base)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) {
      let hashes = [];
      try {
        hashes = await fs.readdir(path.join(base, v));
      } catch {
        continue;
      }
      for (const h of hashes) {
        const bin = path.join(base, v, h, "claude.app", "Contents", "MacOS", "claude");
        try {
          await fs.access(bin);
          out.push(bin);
        } catch {
          /* not a binary dir */
        }
      }
    }
  } catch {
    /* no desktop app */
  }
  return out;
}

// This spawns directly rather than through spawnHeadlessCli, like
// cli-fencing-probe.mjs (see the note in spawn-cli.mjs): `/usage` is answered
// locally by the CLI and runs no prompt, no model and no tools, so there is
// nothing to fence. Routing it through the fenced spawn path would add
// permission flags to a command that has no permissions to restrict.
//
// On Windows an npm-installed CLI is a script shim execFile cannot run without
// a shell, so launch the .js/.exe it wraps (a no-op elsewhere; cli-launch.mjs).
async function run(bin, { exec = execFile } = {}) {
  // A private (0700) directory, not the shared tmpdir: the CLI reads project
  // settings from its working directory, and another local user must not be
  // able to plant them there. It also keeps the run out of any real project's
  // context and transcripts.
  const cwd = await fsPromises.mkdtemp(path.join(os.tmpdir(), "career-ops-usage-"));
  try {
    return await new Promise((resolve, reject) => {
      const launch = prepareCliLaunch(bin, [
        "-p", "/usage", "--output-format", "json",
        // user settings only, and no user hooks: a SessionStart hook would
        // otherwise fire on every cache refresh for a command that makes no model turn.
        "--setting-sources", "user", "--settings", '{"disableAllHooks":true}',
      ]);
      exec(
        launch.command,
        launch.args,
        { timeout: TIMEOUT_MS, maxBuffer: 1 << 20, cwd, windowsHide: true, env: { ...process.env, NO_COLOR: "1" } },
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      );
    });
  } finally {
    await fsPromises.rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Ask the Claude CLI for plan usage, trying each candidate path in order.
 * Resolves to the parsed rows, or null when no binary answers or the output is not recognised (API-key users, for one).
 */
export async function readPlanUsage({ candidates, exec } = {}) {
  for (const bin of candidates ?? (await desktopBinaries())) {
    try {
      const stdout = await run(bin, { exec });
      const parsed = parsePlanUsage(JSON.parse(stdout)?.result);
      if (parsed) return parsed;
    } catch {
      /* try the next binary */
    }
  }
  return null;
}
