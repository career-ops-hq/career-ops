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
 * BOTH stores are read, and the non-empty ones are joined. An earlier draft
 * returned the profile as soon as it had content, which made the legacy read
 * below unreachable in exactly the case where it matters: an install that has
 * old notes AND a hand-written profile silently lost the old notes. That is the
 * same failure this file was written to fix, one store further along, and it is
 * invisible for the same reason: buildPrompt() omits the notes section rather
 * than emitting an empty one, so guardrails going missing looks identical to
 * guardrails never existing.
 *
 * Joined with a blank line and nothing else. No synthetic heading marks the
 * boundary: the two files hold the same kind of content, durable notes about the
 * user, and the consumer is a prompt, so a line this function invented would
 * read there as something the user wrote.
 *
 * @param {string} root career-ops home, i.e. careerOpsRoot()
 * @returns {string}
 */
export function readProfileMemory(root) {
  const read = (file) => {
    try {
      return fs.readFileSync(file, "utf8").trim();
    } catch (err) {
      /* ENOENT and ENOTDIR are the two shapes of "nobody ever wrote one": the
         file is missing, or a directory above it is. Anything else (EISDIR,
         EACCES, EIO) means the file IS there and could not be read, which is
         this file's own bug one layer down — buildPrompt() omits the notes
         section for an empty memory, so guardrails that exist and failed to
         read would look exactly like guardrails nobody ever wrote. Those
         surface. analyze-patterns.mjs and upskill.mjs draw the same line. */
      if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return "";
      throw err;
    }
  };
  const profile = read(profilePath(root));
  const legacy = read(path.join(root, ".career-ops-web", "memory.md"));
  return [profile, legacy].filter(Boolean).join("\n\n");
}
