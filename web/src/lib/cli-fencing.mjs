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
 * That is also why #2361's inline Codex sandbox — approval policy, `--sandbox
 * read-only` and `--search`, spelled in the AI-search route — lives here now
 * rather than there. Two paths that sandbox the same runtime cannot be kept in
 * agreement by review; fenceCodexArgs REFUSES an argv that spells its own, so a
 * second path is a failure rather than a divergence. What that route keeps is
 * everything that is not permission: its temp workspace, `--ephemeral`, and
 * reading the answer from `--output-last-message` instead of a stdout that
 * echoes the whole prompt.
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
 * Refuse Hermes for workers that write. This is a check by name, outside FENCERS,
 * and it covers Hermes alone: every other runtime passes, including the ones
 * absent from FENCERS, which still run write-capable workers with their default
 * access (fencingReport reports them as unfenced). Hermes is limited to workers
 * whose capability record has `writes: false` because career-ops has no verified
 * way to translate that record into Hermes's own approval/sandbox controls.
 *
 * @param {string} cliId
 * @param {import("./worker-capabilities.mjs").Capabilities} capabilities
 * @returns {boolean}
 */
export function isCliAllowedForCapabilities(cliId, { writes }) {
  return cliId !== "hermes" || !writes;
}


/**
 * Pick the Codex sandbox policy for a capability record.
 *
 * Note it is `network: "fetch"` — not web access as such — that forces
 * workspace-write. Measured on codex-cli 0.146.0 (macOS, 2026-08-20) under this
 * module's own read-only argv: a model-run `curl https://example.com` returned
 * "could not resolve host", and `echo hi > ./probe.txt` returned "operation not
 * permitted" — the sandbox governs the commands the MODEL runs, and blocks them
 * at DNS. The escape hatch is `sandbox_workspace_write.network_access`, which —
 * as its name says — only applies to workspace-write. There is no
 * read-only-plus-network policy to ask for;
 * `sandbox_workspace_write.writable_roots=[]` was also tried and does NOT remove
 * write access (the probe still wrote successfully). So a worker that must be
 * able to retrieve ANY url it is handed gets a writable workspace it never uses,
 * because the alternative is a worker whose fallback fetch cannot run at all.
 *
 * A `"search"` worker does not pay that price. Its web access comes from
 * `--search` (below), which the model calls server-side: in the same probe it
 * opened https://example.com and quoted the page while the sandbox stayed
 * read-only. That is the configuration #2361 shipped for AI search, and this must
 * keep producing it. Do NOT collapse the two back into one boolean: one direction
 * silently un-sandboxes AI search, the other silently strands every worker whose
 * posting the native tool cannot reach, and nothing in the type system will tell
 * you either happened.
 *
 * @param {import("./worker-capabilities.mjs").Capabilities} capabilities
 * @returns {string}
 */
function codexSandboxMode({ writes, network }) {
  return writes || network === "fetch" ? CODEX_WORKSPACE_WRITE : CODEX_READ_ONLY;
}

/**
 * Codex fencing flags that must precede the `exec` subcommand.
 *
 * `--ask-for-approval` and `--search` are global options on codex-cli 0.146.0 —
 * neither appears in `codex exec --help` — so they are not interchangeable with
 * the exec-scoped flags below and cannot share an insertion point.
 *
 * `never` is what makes the sandbox a fence rather than a prompt: without it a
 * blocked command can be escalated by approval, which a headless run has nobody
 * to give. `--search` is the web access itself, granted to any record that
 * declares web at all — it is the model's own tool, executed server-side, and is
 * the only web mechanism a `read-only` worker has.
 *
 * @param {import("./worker-capabilities.mjs").Capabilities} capabilities
 * @returns {string[]}
 */
function codexGlobalFencingFlags({ network }) {
  return ["--ask-for-approval", "never", ...(network ? ["--search"] : [])];
}

/**
 * Codex fencing flags that belong after the `exec` subcommand.
 *
 * `-c key=value` rather than `-s <mode>`: verified 2026-08-15 that `-c
 * sandbox_mode=…` overrides a config.toml setting `sandbox_mode =
 * "danger-full-access"` (codex doctor then reports the filesystem and network
 * sandboxes as restricted). `-s`'s precedence over user config could not be
 * verified the same way, and most of career-ops' Codex call sites do not pass
 * --ignore-user-config (AI search is the one that does), so an unproven override
 * would leave the fence defeatable by any user who had set that key for other
 * work. Using `-c` for the mode also matches the network key, so the fencing
 * speaks one language.
 *
 * @param {import("./worker-capabilities.mjs").Capabilities} capabilities
 * @returns {string[]}
 */
function codexExecFencingFlags(capabilities) {
  const mode = codexSandboxMode(capabilities);
  const flags = ["-c", `sandbox_mode=${mode}`];
  if (mode === CODEX_WORKSPACE_WRITE && capabilities.network === "fetch") {
    flags.push("-c", "sandbox_workspace_write.network_access=true");
  }
  return flags;
}

/**
 * Argv tokens that mean "somebody already decided this run's permissions".
 *
 * Not a style rule. #2361 landed an inline sandbox in the AI-search route while
 * this module was being written, and for two days the repo had two Codex
 * sandboxing paths that no test could see disagreeing. Refusing an argv that
 * already spells one of these makes "there is exactly one path" a failure a
 * caller hits immediately, instead of a claim in a comment.
 */
const CODEX_PERMISSION_TOKENS = Object.freeze([
  "-s",
  "--sandbox",
  "--ask-for-approval",
  "--search",
  "--dangerously-bypass-approvals-and-sandbox",
  "--yolo",
  "--approve-for-me",
  "--not-so-yolo",
  "--full-auto",
]);

/**
 * `-c` keys that change sandbox, approval, or web-access policy.
 *
 * Written as bare keys. The comparison below splits the payload on its first
 * `=` and trims, so the boundary a trailing `=` used to stand in for is now
 * supplied by the split — and matching survives the spacing codex tolerates.
 * A key ending in `.` is a dotted PREFIX: every setting under it is policy.
 */
const CODEX_PERMISSION_CONFIG_KEYS = Object.freeze([
  "sandbox_mode",
  "sandbox_workspace_write.",
  "approval_policy",
  "web_search",
  "features.web_search_request",
]);

/**
 * Does this `-c` payload set one of the policy keys above?
 *
 * Codex trims a config key before applying it, so `sandbox_mode =
 * danger-full-access` is the same override as `sandbox_mode=danger-full-access`
 * — and a `startsWith("sandbox_mode=")` check saw neither the space nor the
 * override. That is not a parsing nicety: verified on codex-cli 0.146.0 that
 * the spaced form is APPLIED, by running a fenced-looking exec that carried it
 * and watching the model's `echo hi > ./probe.txt` succeed. The sandbox was
 * off, and this guard had waved the argv through.
 *
 * @param {string} payload - A `key=value` config override, flag already stripped.
 * @returns {boolean}
 */
function setsCodexPermissionKey(payload) {
  const key = payload.split("=")[0].trim();
  return CODEX_PERMISSION_CONFIG_KEYS.some((policyKey) =>
    policyKey.endsWith(".") ? key.startsWith(policyKey) : key === policyKey,
  );
}

/**
 * Strip a config option's own flag from a token, leaving the `key=value` payload.
 *
 * A `-c` payload usually arrives as its own argv element (`["-c",
 * "sandbox_mode=…"]`), but codex also accepts it attached — `-csandbox_mode=…`
 * and `--config=sandbox_mode=…`, both verified to exit 0 on 0.146.0. Those forms
 * put the key somewhere the payload check would never look, which is the same
 * miss the equals form was for option names.
 *
 * Returns the token unchanged when it is not a config option, so an unrelated
 * key (`-cmodel=o3`) is examined and then found harmless by the key list rather
 * than being refused for using `-c` at all.
 *
 * @param {string} arg
 * @returns {string}
 */
function codexConfigPayload(arg) {
  if (arg.startsWith("--config=")) return arg.slice("--config=".length);
  if (arg.startsWith("-c") && arg.length > 2) return arg.slice(2);
  return arg;
}

/**
 * Refuse an argv whose caller already fenced it.
 *
 * Scans everything but the LAST element: both Codex argv builders keep the prompt
 * last and positional, and the prompt is user/mode text that may legitimately
 * contain any of these strings. That is the same assumption the insertion below
 * makes, stated once here.
 *
 * Matches on the option NAME, before any `=`. Codex takes both spellings —
 * verified on 0.146.0 that `--sandbox=read-only` and `--ask-for-approval=never`
 * are accepted exactly as their space-separated forms are — so a whole-token
 * comparison would wave the equals form straight through and then splice a
 * second, contradicting sandbox policy in beside it.
 *
 * The split is applied to every token rather than only to the options that take
 * a value. `--search=true` is malformed (codex exits 2 on it) and gets refused
 * here with a message naming `--search`, which is close enough to the truth for
 * an argv that could not have run; knowing which flags accept values would mean
 * keeping a second table in step with codex's own, and a second table is the
 * failure mode this module exists to remove.
 *
 * @param {string[]} args
 */
function assertCodexArgvUnfenced(args) {
  const spelled = args
    .slice(0, -1)
    .find(
      (arg) =>
        CODEX_PERMISSION_TOKENS.includes(arg.split("=")[0]) ||
        (arg.startsWith("-s") && arg.length > 2) ||
        // The payload, not the split option name: a `-c` value IS `key=value`,
        // so its key is what precedes the `=` that the check above strips.
        setsCodexPermissionKey(codexConfigPayload(arg)),
    );
  if (spelled !== undefined) {
    throw new Error(
      `cli-fencing: codex argv already spells ${JSON.stringify(spelled)}. ` +
        "Permission belongs to the capability record, not the call site — declare it in worker-capabilities.mjs.",
    );
  }
}

/**
 * Insert Codex's fencing flags into an already-built argv.
 *
 * The subcommand, not index 0, is the anchor. Callers legitimately put global
 * options before `exec` (AI search does, because `--output-last-message` needs
 * `--ephemeral` and a temp workspace around it), so the earlier
 * `args[0] === "exec"` rule described no real argv once #2361 landed. Global
 * flags go immediately before the subcommand, exec-scoped ones immediately
 * after: both then sit ahead of anything that could be read as the prompt, which
 * the builders keep last and positional.
 *
 * Throws rather than guesses if there is no subcommand to anchor to, or if
 * nothing follows it. Splicing flags into a command line this function does not
 * recognize could silently produce a run that looks fenced and is not — the exact
 * failure `enforced` exists to prevent.
 *
 * @param {string[]} args
 * @param {import("./worker-capabilities.mjs").Capabilities} capabilities
 * @returns {string[]}
 */
function fenceCodexArgs(args, capabilities) {
  assertCodexArgvUnfenced(args);
  const exec = args.indexOf("exec");
  if (exec === -1 || exec === args.length - 1) {
    throw new Error(
      `cli-fencing: codex argv must contain an "exec" subcommand followed by a prompt, got ${JSON.stringify(args)}. ` +
        "Sandbox flags have no known-safe insertion point in this argv shape.",
    );
  }
  return [
    ...args.slice(0, exec),
    ...codexGlobalFencingFlags(capabilities),
    "exec",
    ...codexExecFencingFlags(capabilities),
    ...args.slice(exec + 1),
  ];
}

/**
 * What a `codex` binary must document for the flags above to mean anything.
 *
 * Exported as DATA so the capability probe (cli-fencing-probe.mjs) asserts the
 * flags this module actually emits. #2361's probe lived in the route and checked
 * `--sandbox`, while the fencer had already moved to `-c sandbox_mode=`; a probe
 * that verifies a different command line than the one that ships is a fail-closed
 * gate guarding the wrong door.
 *
 * `read-only`/`workspace-write` are the values `-s` lists, and are checked as
 * evidence that this build has the sandbox policies `sandbox_mode` selects —
 * `--config` alone proves only that overrides are accepted, not that these modes
 * exist.
 */
export const CODEX_REQUIRED_GLOBAL_FLAGS = Object.freeze(["--ask-for-approval", "--search", "--config"]);

/** @see CODEX_REQUIRED_GLOBAL_FLAGS */
export const CODEX_REQUIRED_EXEC_FLAGS = Object.freeze([
  "--config",
  "--sandbox",
  CODEX_READ_ONLY,
  CODEX_WORKSPACE_WRITE,
]);

/**
 * Pi's built-in tools that only read. Pi has no sandbox; its permission
 * mechanism is which tools the model is given, the same axis Claude's allow/deny
 * lists use. `--tools` with plain names REPLACES the default selection (read,
 * bash, edit, write), and Pi filters built-in, extension and custom tools against
 * it when it registers them, so an extension cannot activate one the list drops.
 * Read from earendil-works/pi `agent-session.ts` (`_isAllowedTool`) at v1.5.2.
 */
const PI_READ_TOOLS = Object.freeze(["read", "grep", "find", "ls"]);

/**
 * Pi has no web tool of its own: a worker that has to reach the web does it with
 * `curl` through `bash`. Granting bash is what makes the run partial (see
 * fencingReport), because the same shell can write anywhere the user can.
 */
const PI_SHELL_READ_TOOLS = Object.freeze(["read", "bash", "grep", "find", "ls"]);

/**
 * `--tools` does NOT remove MCP tools on Pi 1.0.4+. It keeps them registered for
 * codemode and tool_search unless an allowlist entry starts with `mcp__`, and an
 * MCP server can supply a write tool. Pi's own docs name `--exclude-tools
 * 'mcp__*'` (or `--no-mcp`) as the way to remove them. The exclusion is used
 * rather than `--no-mcp` because it parses on every Pi the web runs (PI_MIN_VERSION
 * and later): from 0.99.0 to 1.0.3 `--tools` already removed MCP
 * tools, and before 0.99.0 Pi had no built-in MCP, so the pattern matches nothing
 * there. `--no-mcp` exists only from 1.0.4, and an older Pi exits on it with
 * "Unknown option".
 */
const PI_MCP_EXCLUSION = "mcp__*";

/**
 * Keep the folder untrusted for this run, even when the user saved a `/trust`
 * for it or set `defaultProjectTrust: always`. A trusted folder loads its
 * project-local extensions, packages and settings, and an extension's own code
 * runs with the user's full access, outside any tool allowlist. Matches the
 * headless Pi command docs/SUPPORTED_CLIS.md gives after #7169. Pi added the
 * flag in 0.79.0; see PI_MIN_VERSION for why the web needs 0.79.1.
 */
const PI_NO_PROJECT_TRUST = "--no-approve";

/**
 * The oldest Pi the web runs. spawnHeadlessCli refuses an older binary before it
 * starts a worker, using `pi --version` (cli-fencing-probe.mjs), which exits
 * before Pi loads any project files.
 *
 * - Before 0.79.0, Pi has no project trust and no `--no-approve`. It loads the
 *   folder's `.pi/extensions` on every run, and it rejects the unknown flag only
 *   after loading them (checked at v0.78.0: `resourceLoader.reload()` runs
 *   before the unknown-flag check), so a project extension's code would run
 *   before the run failed.
 * - 0.79.0 skips AGENTS.md in an untrusted folder (`loadProjectContextFiles`
 *   has a trust gate there and not at 0.79.1), so a `--no-approve` worker would
 *   lose the project's instructions.
 *
 * Exported as DATA, like the Codex flag lists, so the probe checks the version
 * this module's flags need.
 */
export const PI_MIN_VERSION = "0.79.1";

/**
 * Pi options that select tools or trust project files, i.e. options that decide
 * this run's permissions. Short and long spellings both, from Pi's `args.ts`.
 * The trust options are here because trusting the project loads project-local
 * extensions and settings (see PI_NO_PROJECT_TRUST).
 */
const PI_PERMISSION_TOKENS = Object.freeze([
  "--tools",
  "-t",
  "--exclude-tools",
  "-xt",
  "--no-tools",
  "-nt",
  "--no-builtin-tools",
  "-nbt",
  "--no-mcp",
  "--approve",
  "-a",
  "--no-approve",
  "-na",
]);

/**
 * Refuse a Pi argv whose caller already chose its tools.
 *
 * Same contract as assertCodexArgvUnfenced: the prompt is the last element and
 * is not scanned, and an option is matched by its name before any `=`.
 *
 * @param {string[]} args
 */
function assertPiArgvUnfenced(args) {
  const spelled = args.slice(0, -1).find((arg) => PI_PERMISSION_TOKENS.includes(arg.split("=")[0]));
  if (spelled !== undefined) {
    throw new Error(
      `cli-fencing: pi argv already spells ${JSON.stringify(spelled)}. ` +
        "Permission belongs to the capability record, not the call site — declare it in worker-capabilities.mjs.",
    );
  }
}

/**
 * Restrict Pi to the tools a capability record allows.
 *
 * A worker that does not write gets a `--tools` allowlist without `edit` or
 * `write`, plus `--exclude-tools 'mcp__*'` and `--no-approve`. It gets `bash` only when it needs
 * the web, since `bash` is Pi's only way there. So `pdf` (#2172) runs on read,
 * grep, find and ls alone. A writing worker keeps Pi's default tools: its record
 * grants writes and fetches, which is what those tools give.
 *
 * Global extensions (`~/.pi/agent/extensions`) still load, and their tools are
 * filtered by the same allowlist. One that registers its own tool under an
 * allowed name, such as `read`, is code the user installed for every Pi run, as
 * Claude's fenced runs still load the user's own settings and hooks. The fence
 * restricts what the model is handed, not the user's own setup.
 *
 * The flags go first. Pi's `-p` takes the element after it as the prompt, so
 * nothing may be spliced between `-p` and the prompt.
 *
 * @param {string[]} args
 * @param {import("./worker-capabilities.mjs").Capabilities} capabilities
 * @returns {string[]}
 */
function fencePiArgs(args, { writes, network }) {
  assertPiArgvUnfenced(args);
  if (writes) return args;
  const tools = network ? PI_SHELL_READ_TOOLS : PI_READ_TOOLS;
  return ["--tools", tools.join(","), "--exclude-tools", PI_MCP_EXCLUSION, PI_NO_PROJECT_TRUST, ...args];
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
  pi: fencePiArgs,
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
  // Codex and Pi only. Claude expresses both axes as tool flags, so it is never
  // partial: verifyClaudeArgs refuses any argv that does not deny what the record
  // forbids.
  //
  // "fetch", not any web access: a search-only worker reaches the web through the
  // model's own tool and keeps a genuine read-only sandbox, so grading it partial
  // would be the same dishonesty in the opposite direction.
  if (cliId === "codex" && !capabilities.writes && capabilities.network === "fetch") {
    return {
      level: "partial",
      notice: `${cliName} ${PARTIAL_MARKER}: this worker has to open urls it is handed, which its sandbox ` +
        "only allows alongside write access — its writes are confined to the project folder, not blocked",
    };
  }
  // Pi has no web tool, so any web access, "search" included, comes through
  // bash (fencePiArgs). Its shell is not sandboxed, so unlike Codex's writes they
  // are not confined to the project folder.
  if (cliId === "pi" && !capabilities.writes && capabilities.network) {
    return {
      level: "partial",
      notice: `${cliName} ${PARTIAL_MARKER}: it has no web tool of its own, so this worker reaches the web ` +
        "through its shell, which can also change files",
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
 * A fenceable CLI's entry either rewrites the argv (codex: sandbox flags; pi: a tool allowlist) or
 * verifies it (claude: its restriction is already in the flags the caller
 * spelled). Anything absent from FENCERS is passed through untouched — we have no
 * verified mechanism for those runtimes, and inventing one would be worse than
 * reporting the gap, which fencingReport does.
 *
 * @param {{cliId: string, args: string[], capabilities: import("./worker-capabilities.mjs").Capabilities}} invocation
 * @returns {{args: string[]}}
 */
export function fenceArgs({ cliId, args, capabilities }) {
  // Object.hasOwn, exactly as fencingReport does. A bare `FENCERS[cliId]` also
  // resolves inherited Object.prototype members, so a cliId of "toString" or
  // "constructor" yields a truthy function that would then be CALLED as a fencer
  // — returning a string or the argv untouched, either way silently unfenced.
  // Not reachable while routes resolve through resolveCli, but this module's
  // claim is that membership in FENCERS is the whole answer, so both entry
  // points have to agree on what membership means.
  if (!Object.hasOwn(FENCERS, cliId)) return { args };
  return { args: FENCERS[cliId](args, capabilities) };
}
