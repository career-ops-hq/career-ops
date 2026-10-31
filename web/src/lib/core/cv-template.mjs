import path from "node:path";
import { pathToFileURL } from "node:url";
import { BASE_CV_TEMPLATE } from "../run-prompts.mjs";

/**
 * ACL for the core's CV-template resolver (cv-templates.mjs), so a dashboard pdf
 * run fills the same template the CLI fills (#4034).
 *
 * The worker cannot resolve this itself. pdf lost Bash in #2172 and must never
 * regain it, so it can neither run cv-templates.mjs nor list templates/, and the
 * prompt named the base template outright as a result. That silently overrode
 * cv.template for anyone who had set one: same report, two different CVs,
 * depending only on where the run was started.
 *
 * Resolution stays the core's. We call resolveTemplate with no `dir` override, so
 * it uses cv-templates.mjs's own default relative to the user's checkout and
 * template packs (#3202) resolve here exactly as they do on the CLI.
 * Reimplementing the lookup in the web app would be a second source of truth that
 * drifts.
 *
 * `coreRoot` is an ARGUMENT, not a value this module reaches for, for the reason
 * data-root.mjs spells out at length: `process.cwd()` is `<core>/web` here and
 * `<core>` on the CLI, so anything resolved against the cwd points one directory
 * too deep on exactly one of the two. Passing the root in also makes this testable
 * against a real checkout — `careerOpsRoot()` lives in a `@/`-aliased TS module
 * that `node --test` cannot resolve (#3879).
 *
 * CAREER_OPS_PROFILE is the case that made it matter. cv-templates.mjs resolves a
 * RELATIVE value against the cwd, so `CAREER_OPS_PROFILE=config/profile.yml` means
 * `<core>/config/profile.yml` to the CLI and `<core>/web/config/profile.yml` here
 * — the dashboard finds no profile, falls back to the base template, and the two
 * disagree with nothing reporting it. Resolving it against `coreRoot` first is the same
 * fix, and the same reasoning, as resolveDataRoot()'s `resolve(coreRoot, fromEnv)`.
 * An absolute override is returned unchanged by path.resolve, so it is unaffected.
 *
 * Never throws: a template that cannot be resolved yields the base template, and
 * the run still produces a CV. `fallback: true` already covers a name that does
 * not exist; the catch is for a checkout too old to export resolveTemplate, and
 * for a template whose placeholders fail validation.
 *
 * A template from the core's user layer (#5777) lives under the DATA root, which is
 * the worker's cwd and, on a split-layout install, not inside the checkout at all.
 * Such a path is returned relative to `dataRoot` instead, so the worker reads it
 * where it is; the prompt checks it against resolveUserTemplatesDir(). Without
 * `dataRoot` the user layer is not recognized and the path is checkout-relative,
 * as before.
 *
 * @param {string} coreRoot Absolute path to the career-ops code checkout (resolveCodeRoot()), not the data root.
 * @param {string} [dataRoot] Absolute path to the data root (careerOpsRoot()), the worker's cwd.
 * @returns {Promise<string>} Template path, forward-slashed: checkout-relative for a
 *   system template, data-root-relative for one in the user layer.
 */
export async function resolveCvTemplate(coreRoot, dataRoot) {
  const file = path.join(coreRoot, "cv-templates.mjs");
  try {
    const mod = await import(/* webpackIgnore: true */ pathToFileURL(file).href);
    if (typeof mod?.resolveTemplate !== "function") return BASE_CV_TEMPLATE;
    const profile = process.env.CAREER_OPS_PROFILE?.trim();
    const abs = mod.resolveTemplate("cv", null, {
      fallback: true,
      // undefined keeps cv-templates.mjs's own default, rather than restating it
      // here where it would drift.
      profilePath: profile ? path.resolve(coreRoot, profile) : undefined,
    });
    if (typeof abs !== "string" || !abs) return BASE_CV_TEMPLATE;
    // Whether the file is in the user layer is the core's call: its own directory,
    // not a second copy of where that directory is.
    const userDir = dataRoot ? coreUserTemplatesDir(mod) : null;
    const base = userDir && isInside(userDir, abs) ? dataRoot : coreRoot;
    // The prompt names a relative path, and always with forward slashes:
    // path.relative gives backslashes on Windows, which is not how any of the
    // agent-facing paths in this prompt are written.
    const rel = posixRelative(base, abs);
    return rel || BASE_CV_TEMPLATE;
  } catch {
    return BASE_CV_TEMPLATE;
  }
}

/**
 * The core's user-template directory, relative to the data root, as the prompt's
 * guard needs it to accept a path resolveCvTemplate() returned from that layer.
 * Null when the core does not report one (a checkout older than #5777) or reports
 * one outside the data root: either way no user-layer path is accepted, and the run
 * fills the base template exactly as it did before.
 *
 * @param {string} coreRoot Absolute path to the career-ops code checkout.
 * @param {string} dataRoot Absolute path to the data root, the worker's cwd.
 * @returns {Promise<string | null>}
 */
export async function resolveUserTemplatesDir(coreRoot, dataRoot) {
  if (!dataRoot) return null;
  try {
    const mod = await import(/* webpackIgnore: true */ pathToFileURL(path.join(coreRoot, "cv-templates.mjs")).href);
    const userDir = coreUserTemplatesDir(mod);
    if (!userDir || !isInside(dataRoot, userDir)) return null;
    return posixRelative(dataRoot, userDir) || null;
  } catch {
    return null;
  }
}

function coreUserTemplatesDir(mod) {
  if (typeof mod?.DEFAULT_USER_TEMPLATES_DIR !== "function") return null;
  const dir = mod.DEFAULT_USER_TEMPLATES_DIR();
  return typeof dir === "string" && dir ? dir : null;
}

function isInside(dir, file) {
  const rel = path.relative(dir, file);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function posixRelative(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}
