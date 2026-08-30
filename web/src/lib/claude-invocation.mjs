/**
 * claude-invocation.mjs — how a headless `claude` run is invoked: which tools each
 * web worker kind may use, and the argv that carries that decision (#2185).
 *
 * Everything here is asserted on as VALUES (test-all.mjs §55.6), never by matching
 * route.ts's source: five source-text versions of that guard were each defeated by
 * rewriting the route around them while pdf kept full write access. So the argv is
 * built here — `claudeCliArgs({kind:"pdf"})` IS the command line — and the only
 * rule left on the route is that it may spell no tool flag itself.
 *
 * The transport flags (`--output-format stream-json`, `--include-partial-messages`)
 * live here too, because route.ts's NDJSON parser depends on them and a guard can
 * only be honest if it inspects ONE shipped argv.
 *
 * `disallowedTools` is the hard guardrail; the allow list is the working set. Every
 * write-capable tool a kind does not need is EXPLICITLY denied, never merely
 * omitted: `--permission-mode acceptEdits` exists to auto-approve edit tools, so
 * "unmentioned" is the one status a file-writing tool must never have. The deny
 * lists are derived from the allow lists for that reason — hand-writing them once
 * left MultiEdit unmentioned for the persisting kinds.
 */

import { capabilitiesFor } from "./worker-capabilities.mjs";

/**
 * Tools that can modify the user's files. `Bash` counts: `sh -c '> cv.md'` is a
 * write, which is why pdf lost Bash in #2172 and must never regain it. Anything
 * added here is automatically denied to every read-only kind.
 */
export const WRITE_CAPABLE_TOOLS = Object.freeze(["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"]);

/**
 * Tools that reach the network. The counterpart of WRITE_CAPABLE_TOOLS for the
 * other axis the capability policy states, kept beside it so a scope can be
 * checked on both without either list being re-spelled somewhere else.
 */
export const NETWORK_TOOLS = Object.freeze(["WebFetch", "WebSearch"]);

/** Sub-agents: unbounded fan-out cost, wanted by no kind. */
const ALWAYS_DENIED = ["Task"];

/**
 * Split a comma-separated tool list into bare tool names.
 *
 * Claude Code accepts parameterized specifiers (`Bash(node x.mjs:*)`,
 * `Edit(src/**)`), so the argument is stripped before comparing — otherwise
 * `Bash(...)` reads as a tool nobody has heard of and slips past every check.
 *
 * @param {string} value - A comma-separated --allowedTools/--disallowedTools value.
 * @returns {string[]} Bare tool names, in order.
 */
export function toolNames(value) {
  return String(value ?? "")
    .split(",")
    .map((t) => t.trim().replace(/\(.*$/, "").trim())
    .filter(Boolean);
}

/**
 * @typedef {Object} ToolScope
 * @property {string} allowed - Comma-separated --allowedTools value.
 * @property {string} disallowed - Comma-separated --disallowedTools value.
 */

/**
 * Build a scope from its allow list, denying every write-capable tool it does not
 * name plus everything denied unconditionally. Derived rather than hand-listed so
 * a tool added to WRITE_CAPABLE_TOOLS cannot leave any scope silently permissive.
 *
 * Exported because the advisor routes need it too. Six of them hand-wrote the
 * pair — and every one of the six omitted MultiEdit, which acceptEdits then
 * auto-approves: the identical mistake this function was written to prevent, made
 * again in six places. Call this instead of spelling a deny list.
 *
 * @param {string} allowed - Comma-separated --allowedTools value.
 * @returns {ToolScope}
 */
export function scopeFrom(allowed) {
  const granted = toolNames(allowed);
  // Both tool families, not just the write one. A scope that grants no network
  // tool must DENY it rather than omit it, for the same reason a write tool is
  // never left unmentioned: acceptEdits auto-approves what nobody named. This is
  // what lets a local-read-only worker be verifiably local on Claude, matching
  // the read-only sandbox its Codex counterpart gets.
  const restricted = [...WRITE_CAPABLE_TOOLS, ...NETWORK_TOOLS];
  const denied = [...restricted.filter((t) => !granted.includes(t)), ...ALWAYS_DENIED];
  return Object.freeze({ allowed, disallowed: denied.join(",") });
}

/**
 * One scope per capability record, so Claude honours BOTH axes the policy states.
 *
 * `persisting` kinds run the REAL mode and write canonical artifacts
 * (reserve-report-num.mjs / merge-tracker.mjs / verify-portals.mjs), so they need
 * Write + Bash. The read-only kinds produce their result through the response
 * stream and need no write tool at all — pdf emits its CV in a `<<cv-html>>`
 * envelope the backend persists (#2185), and research only reports.
 *
 * The split between the two read-only scopes is the network axis. It used to be
 * absent: a single `readOnly` scope granted WebFetch/WebSearch to every
 * non-writing kind, so pdf declared `network: false`, was DNS-blocked under
 * Codex's sandbox, and could still fetch on Claude — the drift the shared policy
 * exists to prevent, surviving on the axis nobody had wired up. pdf reads
 * modes/pdf.md, cv.md, the profile, the report and the template; it has no reason
 * to reach the network on either runtime.
 *
 * @type {{persisting: ToolScope, networkReadOnly: ToolScope, localReadOnly: ToolScope}}
 */
export const TOOL_SCOPES = Object.freeze({
  persisting: scopeFrom("Read,WebFetch,WebSearch,Write,Edit,Bash,Glob,Grep"),
  networkReadOnly: scopeFrom("Read,WebFetch,WebSearch,Glob,Grep"),
  localReadOnly: scopeFrom("Read,Glob,Grep"),
});

/**
 * Resolve the tool scope for a worker kind.
 *
 * What a kind needs is no longer decided here — capabilitiesFor owns it, on both
 * axes, so Codex's sandbox and this allow list cannot drift into disagreeing
 * about the same kind (#2507). An unreviewed kind gets the narrowest scope:
 * granting a write tool, or the network, to a worker nobody has classified is the
 * one unrecoverable default, and capabilitiesFor makes the same choice.
 *
 * @param {string} kind - Worker kind ("pdf", "research", "evaluate", …).
 * @returns {ToolScope}
 */
export function toolScopeFor(kind) {
  const { writes, network } = capabilitiesFor(kind);
  if (writes) return TOOL_SCOPES.persisting;
  return network ? TOOL_SCOPES.networkReadOnly : TOOL_SCOPES.localReadOnly;
}

/**
 * Does this scope hand the agent any way to write?
 *
 * Compares bare tool names, so `MultiEdit` is caught (a `\bEdit\b`-style match is
 * not) and so is `Bash(node x.mjs:*)`, while a longer tool name that merely
 * contains a write tool's name is not a false positive.
 *
 * @param {ToolScope} scope
 * @returns {boolean}
 */
export function grantsWriteCapability(scope) {
  const allowed = toolNames(scope?.allowed);
  return WRITE_CAPABLE_TOOLS.some((tool) => allowed.includes(tool));
}

/**
 * The complete headless `claude` argv for a run.
 *
 * Assembled here, not in the route, so a guard can assert on the command line
 * that actually ships instead of on source text that can be rewritten around it.
 *
 * @param {{kind: string, prompt: string}} args
 * @returns {string[]}
 */
export function claudeCliArgs({ kind, prompt }) {
  const scope = toolScopeFor(kind);
  return [
    "-p", prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode", "acceptEdits",
    // Every non-writing kind, not just pdf. --strict-mcp-config with no --mcp-config loads ZERO
    // MCP servers, so the tool lists below describe everything the agent can
    // reach — without it an MCP server from the user's own config could supply a
    // write tool that appears in neither list. #2185 is about pdf, and applying
    // this to every kind would silently stop a configured MCP server (e.g. the
    // optional Canva server) from loading on evaluate/research runs. The same gap
    // for the other kinds is #2507.
    ...(capabilitiesFor(kind).writes ? [] : ["--strict-mcp-config"]),
    "--allowedTools", scope.allowed,
    "--disallowedTools", scope.disallowed,
  ];
}

/**
 * Read a flag's value back out of an argv array.
 *
 * Exists for guards: it lets a test ask "what did pdf actually get?" rather than
 * trusting that the argv was built from the scope it expected.
 *
 * @param {string[]} args
 * @param {string} flag - e.g. "--allowedTools".
 * @returns {string} The value, or "" when the flag is absent.
 */
export function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 || i + 1 >= args.length ? "" : args[i + 1];
}

/**
 * Verify Claude's already-built argv actually delivers the declared capabilities.
 *
 * Claude carries its permissions in flags the CALLER spelled, so unlike Codex's
 * sandbox there is nothing to ADD — the fencing layer's job here is to refuse an
 * argv that contradicts what the caller declared. Six of the seven call sites
 * hand-write their Claude argv next to a hand-picked capability record, and
 * nothing checked the two agreed: a route could deny Bash to Claude while handing
 * Codex a writable sandbox, and both halves would look correct in isolation.
 *
 * Lives here rather than in cli-fencing.mjs because every fact it reasons about —
 * WRITE_CAPABLE_TOOLS, NETWORK_TOOLS, the flag names, what acceptEdits does to an
 * unmentioned tool — is this module's. cli-fencing.mjs keeps the per-CLI table and
 * calls this from it.
 *
 * This is that check. It does not rewrite the argv; it refuses to certify one
 * that contradicts what the caller declared.
 *
 * @param {string[]} args
 * @param {import("./worker-capabilities.mjs").Capabilities} capabilities
 * @returns {string[]} the argv, unchanged
 */
export function verifyClaudeArgs(args, capabilities) {
  // Every tool the record forbids must be DENIED BY NAME, not merely left out.
  // "Unmentioned" is the one status a forbidden tool must never have: the argvs
  // pair --disallowedTools with --permission-mode acceptEdits, which exists to
  // auto-approve edit tools, so an omission is a grant. An earlier version of
  // this function only checked that a deny list was present and then scanned the
  // ALLOW list — which certified `--disallowedTools Task` as fenced while Write,
  // Edit and Bash were auto-approved, and passed all six advisor routes even
  // though every one of them omitted MultiEdit. It is the same hole claude-
  // invocation.mjs derives its deny lists to avoid, reproduced in the guard
  // written to catch it.
  const forbidden = [
    ...(capabilities.writes ? [] : WRITE_CAPABLE_TOOLS),
    ...(capabilities.network ? [] : NETWORK_TOOLS),
  ];
  const denied = toolNames(argValue(args, "--disallowedTools"));
  const unmentioned = forbidden.filter((tool) => !denied.includes(tool));

  // A deny list only describes NATIVE tools. Without --strict-mcp-config the run
  // also loads the user's own MCP servers, any of which may expose a write tool —
  // so a worker declared `writes: false` could still write, and this function
  // would certify it as fenced. --strict-mcp-config with no --mcp-config loads
  // ZERO servers, which is what makes the tool lists a complete description of
  // what the agent can reach (the reasoning claudeCliArgs already applies to pdf).
  if (!capabilities.writes && !args.includes("--strict-mcp-config")) {
    throw new Error(
      "cli-fencing: claude argv for a non-writing worker omits --strict-mcp-config, so a " +
        "user-configured MCP server could supply a write tool the capability record forbids. " +
        "Native tool flags alone cannot describe what this agent can reach.",
    );
  }

  if (unmentioned.length > 0) {
    throw new Error(
      `cli-fencing: claude argv does not deny ${unmentioned.join(", ")}, which the declared ` +
        `capabilities (writes=${capabilities.writes}, network=${capabilities.network}) forbid. ` +
        "Build the pair with claude-invocation.mjs's scopeFrom() rather than spelling a deny " +
        "list by hand — a forbidden tool that is merely absent is auto-approved by " +
        "--permission-mode acceptEdits.",
    );
  }
  return args;
}
