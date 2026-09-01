/**
 * career-ops-root.mjs — resolve the career-ops "home" (cv.md, data/, reports/).
 *
 * Plain .mjs so web/tests can import it with `node --test` and no TypeScript
 * build step (same pattern as pdf-paths.mjs / report-files.mjs).
 *
 * Env pair matches core's getCareerOpsRoot(): CAREER_OPS_ROOT ||
 * CAREER_OPS_DATA_DIR. The no-env default stays cwd/.. because Next runs from
 * web/; core's default is path-resolver's __dirname (the repo root). Do not
 * call getCareerOpsRoot() here — that would change the web default.
 */
import path from "node:path";

/**
 * Absolute path to the career-ops data root the web app should read.
 *
 * @returns {string}
 */
export function careerOpsRoot() {
  const env = process.env.CAREER_OPS_ROOT?.trim() || process.env.CAREER_OPS_DATA_DIR?.trim();
  if (env) return path.resolve(env);
  return path.resolve(process.cwd(), "..");
}
