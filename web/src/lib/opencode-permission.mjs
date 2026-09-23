// opencode-permission.mjs — the ONLY place the web derives opencode's headless
// permission block from a run kind's tool scope.
//
// Mirror of claude-invocation.mjs (#2185) for the OpenCode CLI. Claude spells
// its scope in argv (--allowedTools/--disallowedTools); opencode spells its
// scope in config, reachable headless via OPENCODE_CONFIG_CONTENT. The web run
// route must not spell tool names or permission keys itself — it delegates to
// buildCliArgs() (argv) and buildCliEnv() (env, see cli-stream.ts), and this
// module owns the mapping between the two vocabularies.
//
// Why env and config at all: opencode's headless `run` auto-rejects any tool
// touching a path OUTSIDE its workspace (permission `external_directory`,
// ask → auto-reject with no TTY). The web workers' documented contract reads
// and writes /tmp payloads (`/tmp/cv-{candidate}-{company}.json`,
// `/tmp/cover-payload-*.json`) and the CV-ingest temp lives in `os.tmpdir()`,
// so those runs died on the FIRST /tmp touch. opencode has no per-tool argv
// flags (only the blunt --auto), so the fixed scope has to ride in config.
//
// Permission keys opencode 1.18.32 recognizes (docs): read, edit, glob, grep,
// list, bash, task, external_directory, todowrite, question, webfetch,
// websearch, lsp, doom_loop, skill. There IS no `write` key — the write tool
// gates behind `edit` (live-verified). webfetch/websearch/todowrite/question/
// doom_loop accept a flat action only, not a per-pattern object.

import { toolNames } from "./claude-invocation.mjs";

/** claude tool name → opencode permission key (write tool lives under `edit`). */
const OPENCODE_TOOL_KEY = {
  Read: "read",
  Glob: "glob",
  Grep: "grep",
  WebFetch: "webfetch",
  WebSearch: "websearch",
  Bash: "bash",
  Write: "edit",
  Edit: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Task: "task",
};

/**
 * The only external paths the web workers legitimately touch: /tmp payloads.
 * Every other path outside the opencode workspace stays denied by `*`.
 */
const EXTERNAL_DIRECTORY = { "/tmp/*": "allow", "/tmp": "allow" };

/**
 * Build the OPENCODE_CONFIG_CONTENT permission block for a run kind's scope.
 * @param {{allowed?: string, disallowed?: string}} opts — same CSV value areas
 *   as toolScopeFor(kind)'s `allowed`/`disallowed`.
 * @returns {string} JSON for OPENCODE_CONFIG_CONTENT, e.g.
 *   `{"permission":{"*":"deny","read":"allow",...,"external_directory":{"/tmp/*":"allow","/tmp":"allow"}}}`
 */
export function opencodePermissionBlock({ allowed, disallowed }) {
  const allow = new Set(toolNames(allowed));
  const deny = new Set(toolNames(disallowed));
  const permission = { "*": "deny" };
  for (const opencodeKey of new Set(Object.values(OPENCODE_TOOL_KEY))) {
    const tools = Object.entries(OPENCODE_TOOL_KEY)
      .filter(([, key]) => key === opencodeKey)
      .map(([tool]) => tool);
    // Granted iff ANY source tool is allowed and none of them is denied. Every
    // WRITE_CAPABLE_TOOLS entry is always mentioned in the source scope, so a
    // write-capable opencode key can never ride in by omission (#2172/#2185).
    permission[opencodeKey] = tools.some((t) => allow.has(t) && !deny.has(t)) ? "allow" : "deny";
  }
  permission.external_directory = EXTERNAL_DIRECTORY;
  return JSON.stringify({ permission });
}

/**
 * True when the opencode permission block grants a write-capable key (`edit`).
 * @param {ReturnType<typeof opencodePermissionBlock>} block
 * @returns {boolean}
 */
export function opencodeBlockGrantsWrite(block) {
  try {
    return JSON.parse(block).permission.edit === "allow";
  } catch {
    return true; // unparseable → assume the worst
  }
}