/**
 * pdf-paths.mjs — deterministic scratch + final paths for a web "pdf" run (#2172).
 *
 * Plain .mjs (same pattern as clean-chips.mjs / tracker-table.mjs) so this can
 * be unit-tested with `node --test`, no TypeScript build step. `careerOpsRoot`
 * and `findReportFile` are passed in rather than imported from career-ops.ts,
 * keeping this module free of TypeScript dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";

/**
 * Lowercase, non-alphanumeric runs -> single hyphen, trimmed.
 * @param {string} s
 * @returns {string}
 */
export function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * @typedef {Object} PdfPaths
 * @property {string} html - Where the backend writes the tailored HTML it parsed out of the agent's envelope (#2185).
 * @property {string} finalPdf - Where the backend renders the final PDF (output/cv-{candidate}-{company}-{date}.pdf).
 */

/**
 * Precompute the scratch HTML and final PDF paths for a
 * "pdf" run, so the agent never chooses its own filenames — the backend owns
 * naming, writing (#2185) and rendering. Resolves the report (for the company slug)
 * and config/profile.yml (for the candidate slug) — same naming convention
 * modes/pdf.md documents, so web and CLI output stay byte-identical.
 *
 * Framework-agnostic: returns a result instead of constructing a Response, so
 * the caller (a Next.js route today) decides how to surface `ok: false`.
 *
 * Side effect: creates `.career-ops-web/pdf-tmp/` under `root` if it doesn't
 * exist yet (the backend writes the parsed envelope there, #2185) — this is
 * NOT a pure path computation, despite the name.
 *
 * @param {string} input - The report number (e.g. "018").
 * @param {string} today - YYYY-MM-DD.
 * @param {string} root - careerOpsRoot().
 * @param {(input: string) => string | null} findReportFile - career-ops.ts's findReportFile.
 * @returns {{ok: true, paths: PdfPaths} | {ok: false, error: string}}
 */
export function resolvePdfPaths(input, today, root, findReportFile) {
  // Reject anything but a bare report number before it ever reaches a path.
  // findReportFile()'s parseInt-based matching can still resolve a crafted
  // selector like "123/../../etc/passwd" to a legitimate report file, but the
  // raw string is also used verbatim below to build cv-web-${input}.html —
  // path.join would then honor those ".." segments and escape scratchDir.
  if (!/^\d+$/.test(input)) {
    return { ok: false, error: `Invalid report selector: "${input}"` };
  }
  const reportFile = findReportFile(input);
  if (!reportFile) {
    return { ok: false, error: `No report #${input} found — evaluate this posting first.` };
  }
  const companyMatch = path.basename(reportFile).match(/^\d+-(.+)-\d{4}-\d{2}-\d{2}\.md$/);
  const companySlug = companyMatch ? companyMatch[1] : "company";
  let candidateSlug = "candidate";
  try {
    // js-yaml v4's load() uses the safe default schema (no arbitrary type
    // construction, unlike Python's PyYAML) — same pattern already used in
    // web/src/app/api/profile/route.ts and portals/route.ts.
    const profile = yaml.load(fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8"));
    if (profile?.candidate?.full_name) candidateSlug = slugify(profile.candidate.full_name);
  } catch (err) {
    // A missing profile.yml is expected (not every checkout has one yet) and
    // falls back silently. Anything else — a real YAML syntax error in the
    // user's own file — should not fail silently forever; it would otherwise
    // produce a wrong-but-plausible-looking filename with zero signal.
    if (err?.code !== "ENOENT") {
      console.warn(`resolvePdfPaths: could not read/parse config/profile.yml, defaulting candidate slug: ${err.message}`);
    }
  }
  const scratchDir = path.join(root, ".career-ops-web", "pdf-tmp");
  fs.mkdirSync(scratchDir, { recursive: true });
  return {
    ok: true,
    paths: {
      html: path.join(scratchDir, `cv-web-${input}.html`),
      finalPdf: path.join(root, "output", `cv-${candidateSlug}-${companySlug}-${today}.pdf`),
    },
  };
}
