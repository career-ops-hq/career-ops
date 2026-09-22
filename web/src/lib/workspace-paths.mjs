import fs from "node:fs";
import path from "node:path";
import { resolveDataRoot } from "./core/data-root.mjs";

/** Resolve runtime code separately from the core-compatible user Data Root.
 * User configuration is read on every call so marker changes remain visible.
 * @param {{ cwd?: string, env?: Record<string, string | undefined> }} [options]
 * @returns {{ codeRoot: string, dataRoot: string }}
 */
export function resolveWorkspacePaths({ cwd = process.cwd(), env = process.env } = {}) {
  const codeRoot = path.resolve(cwd, "..");
  const dataRoot = resolveDataRoot(codeRoot, (marker) => {
    try {
      return fs.readFileSync(/* turbopackIgnore: true */ marker, "utf8");
    } catch (error) {
      // A broken marker must not silently redirect writes to the checkout.
      if (error === null || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
      return null;
    }
  }, env, path.resolve, path.join);
  return { codeRoot, dataRoot };
}

/** Preserve an existing tracker in either core-supported layout; a new tracker
 * starts at the canonical location. Explicit overrides are handled by callers.
 * @param {string} dataRoot
 * @returns {string}
 */
export function defaultWorkspaceTrackerPath(dataRoot) {
  const canonical = path.join(dataRoot, "data", "applications.md");
  const legacy = path.join(dataRoot, "applications.md");
  return fs.existsSync(canonical) || !fs.existsSync(legacy) ? canonical : legacy;
}

/** Pin relative tracker overrides to the selected Data Root before a child
 * changes cwd. Absolute overrides retain their meaning.
 * @param {string} dataRoot
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveWorkspaceTrackerPath(dataRoot, env = process.env) {
  const override = env.CAREER_OPS_TRACKER?.trim();
  return override ? path.resolve(dataRoot, override) : defaultWorkspaceTrackerPath(dataRoot);
}
