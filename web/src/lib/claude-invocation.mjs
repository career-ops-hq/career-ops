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

/**
 * Tools that can modify the user's files. `Bash` counts: `sh -c '> cv.md'` is a
 * write, which is why pdf lost Bash in #2172 and must never regain it. Anything
 * added here is automatically denied to every read-only kind.
 */
export const WRITE_CAPABLE_TOOLS = Object.freeze(["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"]);

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
 * @param {string} allowed - Comma-separated --allowedTools value.
 * @returns {ToolScope}
 */
function scopeFrom(allowed) {
  const granted = toolNames(allowed);
  const denied = [...WRITE_CAPABLE_TOOLS.filter((t) => !granted.includes(t)), ...ALWAYS_DENIED];
  return Object.freeze({ allowed, disallowed: denied.join(",") });
}

/**
 * The two scopes that exist. `persisting` kinds run the REAL mode and write
 * canonical artifacts (`verify-portals.mjs` for fix-portal), so they need
 * Write + Bash. `readOnly` kinds produce their result through the response
 * stream and need no write tool at all — pdf emits its CV in a `<<cv-html>>`
 * envelope (#2185) and evaluate emits a `<<report-md>>` envelope; the backend
 * persists both. research only reports.
 *
 * Job postings are data, never instructions (AGENTS.md Untrusted External
 * Content). evaluate used to share the persisting scope so it could run
 * reserve-report-num.mjs / merge-tracker.mjs itself; a posting can try to aim
 * those tools at cv.md. Persistence moved to the backend so evaluate can sit
 * on the read-only arm with pdf.
 *
 * @type {{persisting: ToolScope, readOnly: ToolScope}}
 */
export const TOOL_SCOPES = Object.freeze({
  persisting: scopeFrom("Read,WebFetch,WebSearch,Write,Edit,Bash,Glob,Grep"),
  readOnly: scopeFrom("Read,WebFetch,WebSearch,Glob,Grep"),
});

/**
 * Kinds that ingest a job posting or URL. They MUST NOT receive Write/Bash:
 * the JD is untrusted input and `--permission-mode acceptEdits` would
 * auto-approve an unmentioned write tool. Includes CLI mode names (oferta,
 * auto-pipeline) so a future /api/run kind of that name cannot quietly inherit
 * the persisting scope. pdf is here because the report it reads is the same
 * untrusted posting, already locked down by #2185.
 */
export const UNTRUSTED_JD_KINDS = Object.freeze(["pdf", "evaluate", "oferta", "auto-pipeline"]);
const UNTRUSTED_JD_KIND_SET = new Set(UNTRUSTED_JD_KINDS);

/** Kinds that legitimately write files. Untrusted-JD kinds are excluded even if listed. */
const PERSISTING_KINDS = new Set(["fix-portal"]);

/**
 * Every kind /api/run dispatches. Exported so guards iterate this rather than a
 * hand-written list — a list silently stops gating whatever kind is added next.
 * Unknown kinds still resolve (read-only, see toolScopeFor); this is the set a
 * test can enumerate, not a validity check.
 */
export const KNOWN_KINDS = Object.freeze(["pdf", "research", "evaluate", "fix-portal"]);

/**
 * Resolve the tool scope for a worker kind.
 *
 * Untrusted-JD kinds are always read-only, even if someone later adds them to
 * PERSISTING_KINDS — granting Write to a kind that ingests a posting is the
 * hole this module exists to close. Unknown kinds also get read-only: granting
 * write access to a kind nobody has reviewed is the other unrecoverable default.
 *
 * @param {string} kind - Worker kind ("pdf", "research", "evaluate", …).
 * @returns {ToolScope}
 */
export function toolScopeFor(kind) {
  if (UNTRUSTED_JD_KIND_SET.has(kind)) return TOOL_SCOPES.readOnly;
  return PERSISTING_KINDS.has(kind) ? TOOL_SCOPES.persisting : TOOL_SCOPES.readOnly;
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
    // Untrusted-JD kinds only. --strict-mcp-config with no --mcp-config loads
    // ZERO MCP servers, so the tool lists below describe everything the agent
    // can reach — without it an MCP server from the user's own config could
    // supply a write tool that appears in neither list. Derived from
    // UNTRUSTED_JD_KINDS rather than `kind === "pdf"` so evaluate cannot regain
    // an MCP write path while pdf stays locked. research / fix-portal keep
    // their MCP access (optional Canva, etc.). Non-Claude CLIs still get no
    // tool flags from spec.args() — that gap is #2507.
    ...(UNTRUSTED_JD_KIND_SET.has(kind) ? ["--strict-mcp-config"] : []),
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
