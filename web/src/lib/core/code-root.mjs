import path from "node:path";

/**
 * Resolve the directory holding the engine's root `*.mjs` scripts (doctor,
 * scan-ats-full, verify-portals, tracker, …).
 *
 * Scripts live in the **engine checkout** — never in the data root. Under the
 * #524 split layout (`CAREER_OPS_ROOT` pointing at a data-only directory, or a
 * `.career-ops-data` marker), the data root must NOT be consulted here, or
 * every script-driven Web UI endpoint reports the checkout as missing.
 *
 * `CAREER_OPS_CODE_ROOT` selects the checkout explicitly — needed when the web
 * runtime lives outside the engine checkout (isolated build/deploy dirs). The
 * fallback assumes the process cwd is `<checkout>/web`, the same base
 * `careerOpsRoot()` uses for its own parent walk, so standard installs keep
 * working unchanged. A relative override resolves against `cwd` too.
 *
 * Pure and dependency-injected (cwd + env passed in) so `node --test` can
 * exercise it, matching the data-root.mjs precedent.
 *
 * @param {string} cwd process working directory (expected: <checkout>/web)
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} absolute path to the engine checkout
 */
export function resolveCodeRoot(cwd, env = process.env) {
  const explicit = (env.CAREER_OPS_CODE_ROOT || "").trim();
  if (explicit) return path.resolve(cwd, explicit);
  return path.resolve(cwd, "..");
}

/**
 * Absolute path to one engine root script. The `.mjs` is assembled from the
 * bare name so the literal never appears as a direct execFile/spawn argument —
 * Next's bundler statically traces such literals and fails the build otherwise.
 *
 * @param {string} codeRoot absolute engine checkout directory
 * @param {string} nameNoExt e.g. "doctor", "scan-ats-full"
 */
export function resolveRootScript(codeRoot, nameNoExt) {
  // The checkout is chosen at runtime, so this is the dynamic path Turbopack
  // must not trace: without the ignore, `next build` warns that it traces the
  // whole project into every server bundle that reaches rootScript().
  return path.join(/* turbopackIgnore: true */ codeRoot, `${nameNoExt}.mjs`);
}
