import path from "node:path";
import { pathToFileURL } from "node:url";
import { careerOpsRoot } from "@/lib/career-ops";
import { BASE_CV_TEMPLATE } from "@/lib/run-prompts.mjs";

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
 * Resolution stays the core's. We call resolveTemplate with no dir or profile
 * override, so it uses cv-templates.mjs's own defaults relative to the user's
 * checkout — the same paths, the same CAREER_OPS_PROFILE handling, and template
 * packs (#3202) resolve here exactly as they do on the CLI. Reimplementing the
 * lookup in the web app would be a second source of truth that drifts.
 *
 * Never throws: a template that cannot be resolved yields the base template, and
 * the run still produces a CV. `fallback: true` already covers a name that does
 * not exist; the catch is for a checkout too old to export resolveTemplate, and
 * for a template whose placeholders fail validation.
 */
export async function resolveCvTemplate(): Promise<string> {
  const root = careerOpsRoot();
  const file = path.join(root, "cv-templates.mjs");
  try {
    const mod = await import(/* webpackIgnore: true */ pathToFileURL(file).href);
    if (typeof mod?.resolveTemplate !== "function") return BASE_CV_TEMPLATE;
    const abs = mod.resolveTemplate("cv", null, { fallback: true });
    if (typeof abs !== "string" || !abs) return BASE_CV_TEMPLATE;
    // The prompt names a repo-relative path, and always with forward slashes:
    // path.relative gives backslashes on Windows, which is not how any of the
    // agent-facing paths in this prompt are written.
    const rel = path.relative(root, abs).split(path.sep).join("/");
    return rel || BASE_CV_TEMPLATE;
  } catch {
    return BASE_CV_TEMPLATE;
  }
}
