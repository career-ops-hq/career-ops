import path from "node:path";
import { pathToFileURL } from "node:url";

export async function validateRoleResumeHtml(html, root) {
  try {
    // The fact gate belongs to the Career-Ops root, outside Next's web package.
    // Load it at runtime so Turbopack does not attempt to bundle the entire root.
    const factGateUrl = pathToFileURL(path.join(root, "verify-cv-facts.mjs")).href;
    const { assertFacts } = await import(/* webpackIgnore: true */ factGateUrl);
    const result = assertFacts(html, { label: "general role resume", cwd: root });
    return { ok: true, warnings: result.warnings || [] };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "General role resume fact validation failed." };
  }
}
