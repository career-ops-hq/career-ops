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
 *
 * Pi gets a version check instead of a help check (assertPiVersionSupported).
 * Its fence also depends on behavior, not only on flags: which files Pi loads
 * before it rejects an unknown flag, and whether it reads AGENTS.md in an
 * untrusted folder. Help text cannot show either.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { CODEX_REQUIRED_EXEC_FLAGS, CODEX_REQUIRED_GLOBAL_FLAGS, PI_MIN_VERSION } from "./cli-fencing.mjs";
import { prepareCliLaunch } from "./cli-launch.mjs";

/**
 * The stat fields that together say "this is still the same executable".
 * @see readBothHelps for why size and mtime alone are not enough.
 */
const IDENTITY_FIELDS = Object.freeze(["mtimeMs", "ctimeMs", "size", "ino", "dev"]);

/**
 * @typedef {Object} ProbeCacheEntry
 * @property {number} mtimeMs
 * @property {number} ctimeMs
 * @property {number} size
 * @property {number} ino
 * @property {number} dev
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
    let timedOut = false;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let timeout;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let killTimeout;

    const finish = (output) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (killTimeout) clearTimeout(killTimeout);
      resolve(output);
    };

    const appendBounded = (current, chunk) => (current + chunk.toString()).slice(-HELP_CAPTURE_BYTES);

    // NO_COLOR so flag names are matched as written, not around ANSI escapes.
    // windowsHide: see api/doctor/route.ts — a stale inherited console kills
    // every child with 0xC0000142 on Windows, and a probe that dies silently
    // reads as "flag unsupported".
    const child = spawn(binPath, args, { env: { ...process.env, NO_COLOR: "1" }, windowsHide: true });
    child.stdin?.end();

    child.stdout.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on("error", () => {
      if (!timedOut) finish("");
    });
    // Help goes to stdout on success and stderr on a usage error; read both.
    child.on("close", () => finish(timedOut ? "" : `${stdout}\n${stderr}`));

    timeout = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* best-effort capability-probe cleanup */
      }
      // Reaping and SETTLING are two things, and tying them together is how a
      // probe hangs. `close` waits for the stdio streams to close as well as
      // the process to exit, so a descendant holding inherited stdout keeps it
      // from ever firing — and SIGKILL goes to the direct child, not a process
      // group, so that descendant is exactly the case it does not reach. This
      // promise sits on the AI-search request path; it must not wait on a
      // grandchild nobody can signal.
      //
      // So: escalate to SIGKILL on its own timer (reap what can be reaped), and
      // separately settle at a hard deadline, releasing the captured streams so
      // this probe stops holding handles it will never read from again.
      killTimeout = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* best-effort capability-probe cleanup */
        }
        for (const stream of [child.stdout, child.stderr]) {
          try {
            stream?.destroy();
          } catch {
            /* best-effort capability-probe cleanup */
          }
        }
        finish("");
      }, SIGKILL_GRACE_MS);
      killTimeout.unref?.();
    }, HELP_TIMEOUT_MS);
  });
}

const OPTION_TOKEN = "-{1,2}[A-Za-z0-9?][A-Za-z0-9?-]*";
// clap prints an option's description on the SAME line as its flags when both
// fit the terminal width (`-s, --sandbox <SANDBOX_MODE>  Select the sandbox
// policy`), and on the next line otherwise. A declaration is recognised either
// way: an inline description is anything after two or more spaces, and a
// trailing `[possible values: …]` still belongs to the option, not the prose.
// One space is NOT a description (`--sandbox was removed in this build` stays
// prose), which is the boundary the sandbox-evidence test pins.
const OPTION_DECLARATION = new RegExp(
  `^(${OPTION_TOKEN})(?:,\\s*(${OPTION_TOKEN}))?(?:\\s+<[^>]+>(?:\\.\\.\\.)?)?(?:\\s{2,}(?!\\[possible values:)\\S.*?)?(?:\\s*\\[possible values:\\s*([^\\]]+)\\])?\\s*$`,
  "i",
);
const POSSIBLE_VALUES = /^\[possible values:\s*([^\]]+)\]\s*$/i;

/**
 * Is `flag` DECLARED in this help text, rather than merely contained in it?
 *
 * `help.includes("--sandbox")` is also satisfied by `--sandbox-mode`. Flags
 * count only in option declarations, and bare sandbox modes count only in the
 * structured possible-values list owned by `--sandbox`. Prose can discuss a
 * removed option or an unrelated option's values; neither proves support.
 *
 * @param {string} help
 * @param {string} flag
 * @returns {boolean}
 */
function declaresFlag(help, flag) {
  const declaredOptions = new Set();
  /** @type {Map<string, Set<string>>} */
  const valuesByOption = new Map();
  /** @type {string[]} */
  let currentOptions = [];

  const recordValues = (values) => {
    if (!values || currentOptions.length === 0) return;
    for (const option of currentOptions) {
      const owned = valuesByOption.get(option) ?? new Set();
      for (const value of values.split(",")) owned.add(value.trim());
      valuesByOption.set(option, owned);
    }
  };

  for (const line of help.split(/\r?\n/)) {
    const trimmed = line.trim();
    const declaration = trimmed.match(OPTION_DECLARATION);
    if (declaration) {
      currentOptions = declaration.slice(1, 3).filter(Boolean);
      for (const option of currentOptions) declaredOptions.add(option);
      recordValues(declaration[3]);
      continue;
    }

    recordValues(trimmed.match(POSSIBLE_VALUES)?.[1]);
  }

  if (flag.startsWith("-")) return declaredOptions.has(flag);
  return valuesByOption.get("--sandbox")?.has(flag) ?? false;
}

/**
 * Does this pair of help texts satisfy the fencing contract?
 *
 * The POLICY half of this module, separated from the I/O half so it can be
 * exercised without a binary. What a help text has to say is the same question
 * on every platform, while producing one from a fixture is not: a script with a
 * shebang is executable on POSIX and inert on Windows. Fusing the two made the
 * flag-matching rules — the part a review has already found bugs in twice —
 * testable only where a stub happens to run.
 *
 * @param {{globalHelp: string, execHelp: string}} help
 * @param {string[]} [alsoRequiresInExec] - See codexFencingSupported.
 * @returns {boolean}
 */
export function helpSatisfiesFencing({ globalHelp, execHelp }, alsoRequiresInExec = []) {
  // Deliberately fail closed: help/flag drift means "unsupported", never a
  // weaker Codex invocation that could bypass the required safety contract.
  return (
    CODEX_REQUIRED_GLOBAL_FLAGS.every((flag) => declaresFlag(globalHelp, flag)) &&
    [...CODEX_REQUIRED_EXEC_FLAGS, ...alsoRequiresInExec].every((flag) => declaresFlag(execHelp, flag))
  );
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
 * but lacks a flag is a fact about that binary, and is cached — the identity
 * below evicts it the moment the user upgrades codex, which is the case the
 * retry existed for. Re-spawning two processes on every AI-search request for
 * the life of an old install was never the point.
 *
 * Identity is all five stat fields, not size+mtime: an executable replaced in
 * place can preserve both — a build system writing the same-length binary, or a
 * restore that puts the timestamp back — while being a different file. ctime and
 * the inode move when it does. Cheap, and this cache decides whether an agent
 * gets sandboxed.
 *
 * @param {string} binPath
 * @param {{mtimeMs: number, ctimeMs: number, size: number, ino: number, dev: number}} identity
 * @returns {Promise<{globalHelp: string, execHelp: string}>}
 */
function readBothHelps(binPath, identity) {
  const cached = probeCache.get(binPath);
  if (cached && IDENTITY_FIELDS.every((field) => cached[field] === identity[field])) {
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

  // Concurrent cold requests share the same in-flight read. The stat identity
  // makes a Codex upgrade at the same path invalidate a cached help text.
  entry = { ...identity, help };
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
  let stats;

  try {
    stats = fs.statSync(binPath);
  } catch {
    return Promise.resolve(false);
  }

  const identity = Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, stats[field]]));
  return readBothHelps(binPath, identity).then((help) => helpSatisfiesFencing(help, alsoRequiresInExec));
}

/**
 * Read the first `major.minor.patch` out of a version string.
 *
 * @param {string} text
 * @returns {number[]|null}
 */
function parseVersion(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return match ? match.slice(1, 4).map(Number) : null;
}

/**
 * Does this `pi --version` output name a Pi the web can run?
 *
 * The POLICY half of the Pi check, kept apart from the spawn for the reason
 * helpSatisfiesFencing is: it runs everywhere, with no binary. Compares numbers,
 * not strings, so 0.100.0 is newer than 0.99.0. Output with no version number in
 * it is not supported: the check fails closed.
 *
 * @param {string} output
 * @returns {{version: string|null, supported: boolean}}
 */
export function piVersionSatisfiesFencing(output) {
  const found = parseVersion(output);
  if (!found) return { version: null, supported: false };
  const min = /** @type {number[]} */ (parseVersion(PI_MIN_VERSION));
  const index = found.findIndex((part, i) => part !== min[i]);
  return { version: found.join("."), supported: index === -1 || found[index] > min[index] };
}

/** @type {Map<string, {identity: string, version: string}>} */
const piVersionCache = new Map();

/**
 * The stat identity of every file a launch of `binPath` runs: the binary, and on
 * Windows the script an npm shim resolves to, since upgrading Pi rewrites the
 * script and can leave the shim byte-identical. stat follows symlinks, so an npm
 * bin link on POSIX is identified by the script it points at.
 *
 * @param {string} binPath
 * @param {{command: string, args: string[]}} launch
 * @returns {string|null} null when a file cannot be read.
 */
function launchIdentity(binPath, launch) {
  // prepareCliLaunch hands back the binary itself, a native .exe the shim names,
  // or node running the .js the shim names.
  const files = [binPath];
  if (launch.command !== binPath) files.push(launch.command === process.execPath ? launch.args[0] : launch.command);
  try {
    return JSON.stringify(
      files.map((file) => {
        const stats = fs.statSync(file);
        return IDENTITY_FIELDS.map((field) => stats[field]);
      }),
    );
  } catch {
    return null;
  }
}

/**
 * Ask a `pi` binary for its version, synchronously.
 *
 * Synchronous because its caller is spawnHeadlessCli, the one spawn path, which
 * every route calls without awaiting. Checking there covers every route; an
 * async check would need its own await in each route, and a route that forgot it
 * would run an old Pi. The cost is one blocked `pi --version` per binary (about
 * as long as Pi takes to start), because a version read from a binary is cached
 * until the binary changes. An unreadable result is not cached, so the next run
 * tries again.
 *
 * Runs in the OS temp folder, not the user's project: `pi --version` prints and
 * exits before Pi loads project files (main.ts at v0.79.0 and v1.5.2), and
 * starting it outside the project keeps that true for any build that does not.
 *
 * @param {string} binPath
 * @returns {string} The binary's stdout, or "" when it did not exit cleanly.
 */
function readPiVersionSync(binPath) {
  let launch;
  try {
    launch = prepareCliLaunch(binPath, ["--version"]);
  } catch {
    return "";
  }
  const identity = launchIdentity(binPath, launch);
  if (identity === null) return "";
  const cached = piVersionCache.get(binPath);
  if (cached && cached.identity === identity) return cached.version;

  const result = spawnSync(launch.command, launch.args, {
    cwd: os.tmpdir(),
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf8",
    timeout: HELP_TIMEOUT_MS,
    killSignal: "SIGKILL",
    maxBuffer: HELP_CAPTURE_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  // Only a clean exit counts, and only stdout, where `pi --version` prints. A
  // failed launch can still print a version-shaped string, such as Node's own
  // "Node.js v22.13.0" on stderr when Pi's entry script crashes, and reading that
  // as Pi's version would let any crash through the check.
  const output = !result.error && result.status === 0 ? (result.stdout ?? "") : "";
  if (parseVersion(output)) piVersionCache.set(binPath, { identity, version: output });
  return output;
}

/**
 * Refuse to run a Pi older than PI_MIN_VERSION, or one whose version cannot be
 * read. Throws, as spawnHeadlessCli does for a missing capability record, so
 * each route reports it the way it reports any failure to start.
 *
 * @param {string} binPath - Resolved path to the pi binary.
 */
export function assertPiVersionSupported(binPath) {
  const { version, supported } = piVersionSatisfiesFencing(readPiVersionSync(binPath));
  if (supported) return;
  throw new Error(
    version === null
      ? `Could not read the version of Pi at ${binPath} (\`pi --version\` printed no version number). ` +
          `career-ops needs Pi ${PI_MIN_VERSION} or later.`
      : `Pi ${version} is too old for career-ops, which needs Pi ${PI_MIN_VERSION} or later. ` +
          "Update Pi (`pi update`) and run this again.",
  );
}
