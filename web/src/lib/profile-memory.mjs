/**
 * profile-memory.mjs: how modes/_profile.md is read back into a prompt.
 *
 * Lives in a plain .mjs, taking the root as a parameter, for the same reason
 * pdf-paths.mjs does. web/tests runs bare `node --test`, which cannot resolve
 * career-ops.ts through the `@/` alias, and this is logic that has to be
 * asserted on as a VALUE. career-ops.ts keeps readMemory() as its entry point
 * and calls in here with careerOpsRoot().
 *
 * The marker constants are exported rather than duplicated. rememberFact() in
 * career-ops.ts is the only WRITER of the managed block and needs them to know
 * where to append and how to dedupe: one definition, two consumers.
 */
import fs from "node:fs";
import path from "node:path";

export const NOTES_START = "<!-- co-web-notes:start -->";
export const NOTES_END = "<!-- co-web-notes:end -->";

/** The CANONICAL user-customization file the CLI/TUI reads. */
export function profilePath(root) {
  return path.join(root, "modes", "_profile.md");
}

/**
 * Everything modes/_profile.md says about the user, for injection into a prompt.
 *
 * The whole file, NOT the co-web-notes block. That block is a write-time
 * construct: rememberFact() needs it to know where to append and how to dedupe.
 * It used to double as the read filter, so the reader returned only the bullets
 * the assistant had written about the user and discarded everything the user
 * had written themselves. With no block present, which is the state every
 * install starts in (_profile.template.md ships without one, and rememberFact()
 * is the only thing that ever creates it), the read returned the empty string,
 * and buildPrompt() omits the notes section entirely for an empty memory. A run
 * with no guardrails was byte-indistinguishable from a run that never needed
 * any (#4003).
 *
 * The legacy .career-ops-web/memory.md still answers when modes/_profile.md is
 * missing or empty, so installs predating the move keep working.
 *
 * @param {string} root career-ops home, i.e. careerOpsRoot()
 * @returns {string}
 */
export function readProfileMemory(root) {
  try {
    const md = fs.readFileSync(profilePath(root), "utf8").trim();
    if (md) return md;
  } catch {
    /* no _profile.md yet */
  }
  try {
    return fs.readFileSync(path.join(root, ".career-ops-web", "memory.md"), "utf8").trim();
  } catch {
    return "";
  }
}
