// Plain .mjs so tests/lib/run-env.test.mjs can import it directly under Node
// (route.ts imports via the `@/` alias, which plain `node --test` cannot resolve).

/**
 * Kinds whose run does not need the project instructions auto-loaded.
 *
 * Claude Code loads CLAUDE.md (which is `@AGENTS.md`, ~75 KB) into the context
 * of every turn. An evaluate run is told to read its mode file and follow it,
 * and that file states the rules the run needs (untrusted input, the closed-
 * posting stop) and points at the AGENTS.md sections it relies on by name, so
 * the agent reads them when it gets there. Paying for the whole file on every
 * turn roughly doubles the run's input tokens for nothing.
 *
 * The other kinds keep it. pdf in particular leans on AGENTS.md's CV rules
 * (never invent a skill or a metric) without its prompt naming them.
 */
const SKIP_PROJECT_INSTRUCTIONS = new Set(["evaluate"]);

/**
 * The environment a headless run-route worker is spawned with.
 *
 * `CLAUDE_CODE_DISABLE_CLAUDE_MDS` is read only by Claude Code; other CLIs
 * ignore it, so setting it does not change their runs.
 *
 * @param {string} kind - Worker kind ("pdf", "evaluate", …).
 * @param {NodeJS.ProcessEnv} baseEnv
 * @returns {NodeJS.ProcessEnv}
 */
export function runEnvFor(kind, baseEnv) {
  return SKIP_PROJECT_INSTRUCTIONS.has(kind) ? { ...baseEnv, CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" } : baseEnv;
}
