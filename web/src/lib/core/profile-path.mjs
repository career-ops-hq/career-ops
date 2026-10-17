/**
 * profile-path.mjs — where the web finds the user's `config/profile.yml`.
 *
 * A deliberate mirror of the core's `getProfilePath()` (path-resolver.mjs), not
 * a second design: Turbopack's root is pinned to `web/` and refuses modules
 * outside it (see next.config.mjs and profile-keywords.mjs's header), so the
 * core helper cannot be imported here. tests/web-profile-path-parity.test.mjs in
 * the root suite pins the contract below.
 *
 * Coverage: the readers and writers under web/src that route through this
 * helper (and cv-template.mjs, which reads the variable itself) follow
 * CAREER_OPS_PROFILE; a scan guard in the root suite fails when a tracked file
 * under web/src builds the path by hand. Outside this change: batch/batch-runner.sh,
 * the prompts under modes/ and batch/, and four prompts in three web files that
 * name config/profile.yml in text sent to a model (web/src/lib/apply/answer-prompt.mjs,
 * web/src/lib/run-prompts.mjs, web/src/app/api/assistant/route.ts).
 *
 * `CAREER_OPS_PROFILE` names the profile file directly. Unlike core's
 * getProfilePath(rootDir), where an explicit rootDir beats the env, this
 * signature's first argument is the data root and the env DOES win unless
 * `explicitRoot: true`, because every web call site passes careerOpsRoot().
 * A caller that states the tree it means passes `explicitRoot: true` and gets
 * `<root>/config/profile.yml`.
 *
 * A blank or whitespace-only value counts as unset. A relative value resolves
 * like the sibling lane variables (CAREER_OPS_PORTALS, CAREER_OPS_PIPELINE,
 * CAREER_OPS_SCAN_HISTORY) do in core, against the cwd the core CLI runs in. The
 * web's own cwd is <checkout>/web, one directory too deep, while the core scripts
 * it spawns run with cwd = the root it passes, so the base is `root`, never
 * process.cwd(). That mirrors core's cwd rule for the CLI, anchored to the root
 * the web passes (cv-template.mjs does the same). An absolute value is returned
 * unchanged. That rule lives in resolveOverride() alone.
 */
import path from "node:path";

function resolveOverride(value, root) {
  return path.resolve(root, value);
}

/**
 * @param {string} root Absolute data root (careerOpsRoot()).
 * @param {{ explicitRoot?: boolean, env?: Record<string, string | undefined> }} [opts]
 * @returns {string} Absolute path to the profile file.
 */
export function getProfilePath(root, { explicitRoot = false, env = process.env } = {}) {
  const override = explicitRoot ? undefined : env.CAREER_OPS_PROFILE?.trim();
  return override ? resolveOverride(override, root) : path.join(root, "config", "profile.yml");
}
