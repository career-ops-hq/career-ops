/**
 * cli-fencing-probe.mjs — ask a CLI binary whether it supports the flags
 * cli-fencing.mjs would fence it with (#2361, #2507).
 *
 * Membership in cli-fencing's FENCERS table answers "can this RUNTIME be
 * restricted". It cannot answer "can the binary on this machine be restricted":
 * flags move between releases, and a `codex` old or new enough to have dropped
 * one would take the fencing flags, ignore them, and run wide open. This module
 * is that second question, and it fails closed — an unreadable binary, a timed
 * out probe or a missing flag all mean "unsupported", never a weaker invocation.
 *
 * Separate file rather than part of cli-fencing.mjs for one hard reason: probing
 * means spawning, and cli-fencing.mjs is imported by worker-card.tsx, a client
 * component. A `node:child_process` import there would follow it into the browser
 * bundle. The flag lists it checks are still cli-fencing's, imported below, so
 * the two cannot drift apart.
 *
 * It spawns directly rather than through spawnHeadlessCli, which requires a
 * capability record and would fence the argv: `--help` runs no prompt, no model
 * and no tools, so there is nothing to fence, and routing it through the agent
 * spawn path would also make cli-fencing ↔ spawn-cli a cycle. stdin is closed
 * here for the same reason spawnHeadlessCli closes it.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import { CODEX_REQUIRED_EXEC_FLAGS, CODEX_REQUIRED_GLOBAL_FLAGS } from "./cli-fencing.mjs";

/**
 * @typedef {Object} ProbeCacheEntry
 * @property {number} mtimeMs
 * @property {number} size
 * @property {Promise<boolean>} probe
 */

/** @type {Map<string, ProbeCacheEntry>} */
const probeCache = new Map();

const HELP_TIMEOUT_MS = 5_000;
const HELP_CAPTURE_BYTES = 64_000;

/**
 * Run one `--help` invocation and return its combined output.
 *
 * Resolves to "" on any failure, which every caller reads as "flag absent" —
 * fail closed. Output is bounded because a help text is small and an unbounded
 * read of an unknown binary's stdout is not.
 *
 * @param {string} binPath
 * @param {string[]} args
 * @returns {Promise<string>}
 */
function readCliHelp(binPath, args) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let timeout;

    const finish = (output) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(output);
    };

    const appendBounded = (current, chunk) => (current + chunk.toString()).slice(-HELP_CAPTURE_BYTES);

    // NO_COLOR so flag names are matched as written, not around ANSI escapes.
    const child = spawn(binPath, args, { env: { ...process.env, NO_COLOR: "1" } });
    child.stdin?.end();

    child.stdout.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on("error", () => finish(""));
    // Help goes to stdout on success and stderr on a usage error; read both.
    child.on("close", () => finish(`${stdout}\n${stderr}`));

    timeout = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* best-effort capability-probe cleanup */
      }
      finish("");
    }, HELP_TIMEOUT_MS);
  });
}

/**
 * Does this `codex` binary support the flags it would be fenced and run with?
 *
 * @param {string} binPath - Resolved path to the codex binary.
 * @param {{alsoRequiresInExec?: string[]}} [options] - Flags the CALLER adds to
 *   the exec argv itself (AI search's isolation and output flags). Fencing does
 *   not emit them, so it cannot know to check them, but a build missing one
 *   breaks the same run and should fail the same gate.
 * @returns {Promise<boolean>}
 */
export function codexFencingSupported(binPath, { alsoRequiresInExec = [] } = {}) {
  let mtimeMs;
  let size;

  try {
    ({ mtimeMs, size } = fs.statSync(binPath));
  } catch {
    return Promise.resolve(false);
  }

  const cached = probeCache.get(binPath);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
    return cached.probe;
  }

  /** @type {ProbeCacheEntry} */
  let entry;
  const probe = Promise.all([readCliHelp(binPath, ["--help"]), readCliHelp(binPath, ["exec", "--help"])])
    // Deliberately fail closed: help/flag drift means "unsupported", never a
    // weaker Codex invocation that could bypass the required safety contract.
    .then(
      ([globalHelp, execHelp]) =>
        CODEX_REQUIRED_GLOBAL_FLAGS.every((flag) => globalHelp.includes(flag)) &&
        [...CODEX_REQUIRED_EXEC_FLAGS, ...alsoRequiresInExec].every((flag) => execHelp.includes(flag)),
    )
    .catch(() => false)
    .then((supported) => {
      // Only successes stay cached. A transient/negative probe retries next time,
      // but must not delete a newer entry installed after the binary changed.
      if (!supported && probeCache.get(binPath) === entry) {
        probeCache.delete(binPath);
      }
      return supported;
    });

  // Concurrent cold requests share the same in-flight probe. mtime+size makes a
  // Codex upgrade at the same path invalidate a previously successful result.
  entry = { mtimeMs, size, probe };
  probeCache.set(binPath, entry);
  return probe;
}
