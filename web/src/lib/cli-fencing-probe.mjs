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
 * @property {Promise<{globalHelp: string, execHelp: string}>} help
 */

/** @type {Map<string, ProbeCacheEntry>} */
const probeCache = new Map();

const HELP_TIMEOUT_MS = 5_000;
const HELP_CAPTURE_BYTES = 64_000;
const SIGKILL_GRACE_MS = 1_000;

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
        // Escalate, because finish() below stops anyone watching this child. A
        // binary that ignores SIGTERM would otherwise outlive every probe of it
        // and accumulate one orphan per request for the life of the server.
        const kill = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* best-effort capability-probe cleanup */
          }
        }, SIGKILL_GRACE_MS);
        kill.unref?.();
      } catch {
        /* best-effort capability-probe cleanup */
      }
      finish("");
    }, HELP_TIMEOUT_MS);
  });
}

/**
 * Is `flag` DECLARED in this help text, rather than merely contained in it?
 *
 * `help.includes("--sandbox")` is also satisfied by `--sandbox-mode`, and
 * `includes("workspace-write")` by `workspace-write-plus` — a binary whose flags
 * have been renamed would be reported as supported, which is the one direction
 * this gate must never fail in.
 *
 * The bounding characters are what codex's own help puts around these tokens:
 * whitespace and line ends for a flag on its own, `,` for the `-c, --config`
 * short/long pair, `=` and `(` for inline forms, and `[`/`]`/`,` for the bare
 * values inside `[possible values: read-only, workspace-write, …]`.
 *
 * It does NOT exclude prose — a sentence reading "removed --search support" has
 * spaces on both sides and still matches. Anchoring to a declaration's leading
 * indentation would fix that and buy a dependency on clap's help LAYOUT instead:
 * a reflow would then report every codex as unsupported and disable AI search
 * outright. A renamed flag is the failure worth catching; a help text that
 * discusses its own removed flags is not one codex writes.
 *
 * @param {string} help
 * @param {string} flag
 * @returns {boolean}
 */
function declaresFlag(help, flag) {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s,=[(])${escaped}($|[\\s,\\])])`, "m").test(help);
}

/**
 * Read both help texts for a binary, sharing and caching the process spawns.
 *
 * The SPAWNS are what cost anything here, so they are what is cached — not a
 * verdict about a particular requirement list. #2361's version cached the
 * verdict, which meant the answer for one caller's requirements could be handed
 * to a caller asking for more; keying that correctly is possible, but there is
 * nothing to key once the cache holds the evidence instead of the conclusion.
 *
 * What survives from #2361 is the distinction it was drawing, sharpened: a probe
 * that could not READ the help (spawn error, timeout, empty output) is transient
 * and is not cached, so the next request retries it. A help text that reads fine
 * but lacks a flag is a fact about that binary, and is cached — mtime+size evict
 * it the moment the user upgrades codex, which is the case the retry existed for.
 * Re-spawning two processes on every AI-search request for the life of an old
 * install was never the point.
 *
 * @param {string} binPath
 * @param {number} mtimeMs
 * @param {number} size
 * @returns {Promise<{globalHelp: string, execHelp: string}>}
 */
function readBothHelps(binPath, mtimeMs, size) {
  const cached = probeCache.get(binPath);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
    return cached.help;
  }

  /** @type {ProbeCacheEntry} */
  let entry;
  const help = Promise.all([readCliHelp(binPath, ["--help"]), readCliHelp(binPath, ["exec", "--help"])])
    .then(([globalHelp, execHelp]) => {
      // Either half empty means the binary never told us anything — evict, so
      // this is retried rather than remembered as a verdict. Guarded on identity
      // so a newer entry installed after the binary changed is not deleted.
      if ((!globalHelp.trim() || !execHelp.trim()) && probeCache.get(binPath) === entry) {
        probeCache.delete(binPath);
      }
      return { globalHelp, execHelp };
    })
    .catch(() => {
      if (probeCache.get(binPath) === entry) probeCache.delete(binPath);
      return { globalHelp: "", execHelp: "" };
    });

  // Concurrent cold requests share the same in-flight read. mtime+size makes a
  // Codex upgrade at the same path invalidate a previously cached help text.
  entry = { mtimeMs, size, help };
  probeCache.set(binPath, entry);
  return help;
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

  // Deliberately fail closed: help/flag drift means "unsupported", never a
  // weaker Codex invocation that could bypass the required safety contract.
  return readBothHelps(binPath, mtimeMs, size).then(
    ({ globalHelp, execHelp }) =>
      CODEX_REQUIRED_GLOBAL_FLAGS.every((flag) => declaresFlag(globalHelp, flag)) &&
      [...CODEX_REQUIRED_EXEC_FLAGS, ...alsoRequiresInExec].every((flag) => declaresFlag(execHelp, flag)),
  );
}
