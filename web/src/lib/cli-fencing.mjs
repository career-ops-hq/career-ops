/**
 * cli-fencing.mjs — translate a worker's capabilities into ONE CLI's permission
 * vocabulary, at the single spawn boundary (#2507).
 *
 * Before this, only Claude was fenced: /api/run spelled its tool flags via
 * claudeCliArgs and every other CLI got a bare `spec.args(prompt)`. That is not a
 * CLI breaking a rule — it is a CLI entering where the rule does not exist, which
 * is why clis.ts's header calls a blanket auto-approve flag "entering where the
 * rule does not exist" rather than a violation. This module is that rule, applied
 * to whichever runtime the user picked.
 *
 * It is invoked from spawnHeadlessCli, not from the routes, for the reason that
 * file already states about closing stdin: it is the only spawn path, "so the fix
 * can't drift". A per-route fix has drifted here once already.
 *
 * FENCERS is the ONE table. Membership in it is the whole answer to "can this
 * runtime be restricted" — there is no second list to keep in step, and an
 * unlisted CLI fails closed (unfenced, reported as such) without anyone having to
 * remember to declare it.
 *
 * Reporting is deliberately honest rather than optimistic. fencingReport() grades
 * a run full / partial / none so it can say what actually applied, instead of a
 * boolean that reads the same whether a runtime is sandboxed, only half-sandboxed,
 * or not sandboxed at all.
 */

import { verifyClaudeArgs } from "./claude-invocation.mjs";

/** Codex sandbox policies, in the spelling `sandbox_mode` accepts. */
const CODEX_READ_ONLY = "read-only";
const CODEX_WORKSPACE_WRITE = "workspace-write";

/**
 * Pick the Codex sandbox policy for a capability record.
 *
 * Note network forces workspace-write. Verified against codex-cli 0.146.0: under
 * `read-only` the sandbox blocks DNS outright, and the escape hatch is
 * `sandbox_workspace_write.network_access`, which — as its name says — only
 * applies to workspace-write. There is no read-only-plus-network policy to ask
 * for; `sandbox_workspace_write.writable_roots=[]` was also tried and does NOT
 * remove write access (the probe still wrote successfully). So a fetching worker
 * (research, and the assistant/explore advisors) gets a writable workspace it
 * never uses, because the alternative is a worker whose every fetch fails. Do NOT
 * "tighten" these to read-only without re-testing: nothing in the type system
 * will tell you their WebFetch stopped working.
 *
 * @param {import("./worker-capabilities.mjs").Capabilities} capabilities
 * @returns {string}
 */
function codexSandboxMode({ writes, network }) {
  return writes || network ? CODEX_WORKSPACE_WRITE : CODEX_READ_ONLY;
}

/**
 * Build the Codex sandbox flags for a capability record.
 *
 * `-c key=value` rather than `-s <mode>`: verified 2026-08-15 that `-c
 * sandbox_mode=…` overrides a config.toml setting `sandbox_mode =
 * "danger-full-access"` (codex doctor then reports the filesystem and network
 * sandboxes as restricted). `-s`'s precedence over user config could not be
 * verified the same way, and career-ops does not pass --ignore-user-config, so an
 * unproven override would leave the fence defeatable by any user who had set that
 * key for other work. Using `-c` for the mode also matches the network key, so
 * the fencing speaks one language.
 *
 * @param {import("./worker-capabilities.mjs").Capabilities} capabilities
 * @returns {string[]}
 */
function codexFencingFlags(capabilities) {
  const mode = codexSandboxMode(capabilities);
  const flags = ["-c", `sandbox_mode=${mode}`];
  if (mode === CODEX_WORKSPACE_WRITE && capabilities.network) {
    flags.push("-c", "sandbox_workspace_write.network_access=true");
  }
  return flags;
}

/**
 * Insert Codex's fencing flags into an already-built argv.
 *
 * Both Codex argv builders start with the `exec` subcommand and keep the prompt
 * last and positional (`["exec", prompt]` and codexStreamArgs's `["exec",
 * "--json", "--color", "never", prompt]`), so index 1 is the only correct
 * insertion point: after the subcommand, before anything that could be read as
 * the prompt.
 *
 * Throws rather than guesses if the argv is not that shape. Splicing flags into a
 * command line this function does not recognize could silently produce a run that
 * looks fenced and is not — the exact failure `enforced` exists to prevent.
 *
 * @param {string[]} args
 * @param {import("./worker-capabilities.mjs").Capabilities} capabilities
 * @returns {string[]}
 */
function fenceCodexArgs(args, capabilities) {
  if (args[0] !== "exec") {
    throw new Error(
      `cli-fencing: codex argv must start with "exec" to be fenced, got ${JSON.stringify(args[0])}. ` +
        "Sandbox flags have no known-safe insertion point in this argv shape.",
    );
  }
  return [args[0], ...codexFencingFlags(capabilities), ...args.slice(1)];
}

/**
 * Per-CLI fencing. The single table: a CLI is fenceable iff it appears here.
 *
 * The runtimes absent from this table are absent because nobody has verified a
 * mechanism on a machine that has them, not because none exists. Grok postdates
 * #2507 and has not been looked at at all — which is why no count is written here,
 * the previous version of this comment having said "five" while six runtimes were
 * unfenced. #2507 records the leads for whoever picks this up: gemini and qwen
 * appear to expose
 * `--approval-mode` plus a container `--sandbox` (needs Docker/Podman), copilot
 * `--allow-tool`/`--deny-tool`, opencode a config-file `permission` block, and
 * antigravity has no public documentation found. Each needs probing on a box that
 * has it — the issue is explicit that an unverifiable claim must warn rather than
 * assert enforcement.
 *
 * @type {Record<string, (args: string[], capabilities: import("./worker-capabilities.mjs").Capabilities) => string[]>}
 */
const FENCERS = Object.freeze({
  claude: verifyClaudeArgs,
  codex: fenceCodexArgs,
});

/**
 * @typedef {Object} FencingReport
 * @property {"full"|"partial"|"none"} level - How much of the declared record actually applies.
 * @property {string|null} notice - User-facing sentence, or null when there is nothing to say.
 */

/**
 * Grade what fencing actually achieves for this worker on this runtime.
 *
 * Three levels, because a boolean could not tell the truth about the middle one.
 * Codex has no read-only-plus-network policy, so a worker that must fetch but is
 * not asked to write still receives a writable workspace — the run is fenced on
 * one axis and not the other. Reporting that as simply "enforced" is exactly what
 * #2507 asks us not to do: *"rather than letting a run look fenced when it isn't."*
 *
 * This is also the ONE source of the notice text. It used to be a separate builder
 * that two routes then spelled into byte-identical hunks; now a route emits
 * `report.notice` and there is nothing to keep in step.
 *
 * @param {{cliId: string, cliName: string, capabilities: import("./worker-capabilities.mjs").Capabilities}} run
 * @returns {FencingReport}
 */
export function fencingReport({ cliId, cliName, capabilities }) {
  if (!Object.hasOwn(FENCERS, cliId)) {
    return {
      level: "none",
      notice: `${cliName} ${UNFENCED_MARKER} — this agent runs with its default access`,
    };
  }
  // Codex only. Claude expresses both axes as tool flags, so it is never partial:
  // verifyClaudeArgs refuses any argv that does not deny what the record forbids.
  if (cliId === "codex" && !capabilities.writes && capabilities.network) {
    return {
      level: "partial",
      notice: `${cliName} ${PARTIAL_MARKER}: this worker needs network access, which its sandbox ` +
        "only grants alongside write access — its writes are confined to the project folder, not blocked",
    };
  }
  return { level: "full", notice: null };
}

/** Stable fragments of the two notices, so the UI can spot either without re-deriving a sentence. */
const UNFENCED_MARKER = "cannot be permission-restricted";
const PARTIAL_MARKER = "is only partly restricted";

/**
 * Does this run-step label carry a fencing notice?
 *
 * Exported for the worker card, which renders a sticky warning rather than letting
 * the notice scroll out of its single latest-step slot. A predicate rather than a
 * marker constant because there are now two notice shapes, and a detector that
 * knows only one goes quietly stale the day the second is added.
 *
 * @param {string|undefined} label
 * @returns {boolean}
 */
export function isFencingNotice(label) {
  return typeof label === "string" && (label.includes(UNFENCED_MARKER) || label.includes(PARTIAL_MARKER));
}

/**
 * Apply this CLI's permission mechanism to an argv.
 *
 * A fenceable CLI's entry either rewrites the argv (codex: sandbox flags) or
 * verifies it (claude: its restriction is already in the flags the caller
 * spelled). Anything absent from FENCERS is passed through untouched — we have no
 * verified mechanism for those runtimes, and inventing one would be worse than
 * reporting the gap, which fencingReport does.
 *
 * @param {{cliId: string, args: string[], capabilities: import("./worker-capabilities.mjs").Capabilities}} invocation
 * @returns {{args: string[]}}
 */
export function fenceArgs({ cliId, args, capabilities }) {
  const fence = FENCERS[cliId];
  return { args: fence ? fence(args, capabilities) : args };
}
