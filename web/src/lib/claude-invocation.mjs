// claude-invocation.mjs — the ONLY place the web builds Claude argv tool scope.
//
// Five source-text versions of the pdf write-scope guard were defeated by
// rewriting route.ts around them (see test-all.mjs #2185). Value assertions
// below run against THIS module's output; route.ts may not spell --allowedTools,
// --disallowedTools, --permission-mode, or sandbox flags itself — it must call
// claudeCliArgs({ kind, prompt }) exactly once with `kind` as a shorthand prop.
//
// Policy: pdf/cover file writes go through Bash + generate-*.mjs; Write/Edit
// are denied by name for pdf so acceptEdits cannot auto-approve them. Every
// WRITE_CAPABLE_TOOLS entry must appear in allowed OR disallowed for EVERY kind.

import { needsShell } from "./worker-capabilities.mjs";

/** Tools --permission-mode acceptEdits can auto-approve as file writers. */
export const WRITE_CAPABLE_TOOLS = Object.freeze(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

const READ_ONLY = "Read,WebFetch,WebSearch,Glob,Grep";
const SHELL = "Bash";
const WRITE_ALLOW = "Write,Edit";
const WRITE_DENY = "NotebookEdit,MultiEdit";
const TASK_DENY = "Task";

/**
 * Tool scope for a run kind.
 * @param {string} kind
 * @returns {{allowed: string, disallowed: string, needsShell: boolean}}
 */
export function toolScopeFor(kind) {
  const shell = needsShell(kind);
  if (kind === "research") {
    return {
      allowed: READ_ONLY,
      disallowed: [SHELL, "Write", "Edit", ...WRITE_DENY.split(","), TASK_DENY].join(","),
      needsShell: false,
    };
  }
  if (kind === "pdf") {
    // No write-capable tool granted; every WRITE_CAPABLE_TOOLS entry denied
    // by name (#2172/#2185). Bash stays allowed for generate-pdf.mjs.
    return {
      allowed: [READ_ONLY, SHELL].join(","),
      disallowed: ["Write", "Edit", ...WRITE_DENY.split(","), TASK_DENY].join(","),
      needsShell: true,
    };
  }
  // evaluate / fix-portal / cover: persist canonical artifacts → Write+Edit+Bash.
  return {
    allowed: [READ_ONLY, WRITE_ALLOW, SHELL].join(","),
    disallowed: [WRITE_DENY, TASK_DENY].join(","),
    needsShell: true,
  };
}

/**
 * Build Claude headless argv (stream-json path). `kind` selects the tool scope;
 * never remap kind at the call site (a remapped kind hands pdf another scope).
 * @param {{kind: string, prompt: string, permissionMode?: string}} opts
 * @returns {string[]}
 */
export function claudeCliArgs({ kind, prompt, permissionMode }) {
  const scope = toolScopeFor(kind);
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
  if (permissionMode) args.push("--permission-mode", permissionMode);
  args.push("--allowedTools", scope.allowed);
  args.push("--disallowedTools", scope.disallowed);
  return args;
}

/**
 * Value of a single-value flag in an argv array.
 * @param {string[]} argv
 * @param {string} flag
 * @returns {string|undefined}
 */
export function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

/**
 * Split a comma-separated tool list into names.
 * @param {string|undefined} csv
 * @returns {string[]}
 */
export function toolNames(csv) {
  if (!csv) return [];
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * True when the argv grants a write-capable tool (in allowed and not denied).
 * @param {{allowed?: string, disallowed?: string}} opts
 * @returns {boolean}
 */
export function grantsWriteCapability({ allowed, disallowed }) {
  const allow = new Set(toolNames(allowed));
  const deny = new Set(toolNames(disallowed));
  return WRITE_CAPABLE_TOOLS.some((t) => allow.has(t) && !deny.has(t));
}
