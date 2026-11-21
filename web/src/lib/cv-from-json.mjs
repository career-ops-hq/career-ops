import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cvTemplateAbsolute } from "./run-prompts.mjs";
import { atsPdfPath } from "./apply/ats-pdf.mjs";
import { PAGE_FORMATS } from "./page-formats.mjs";

async function loadCore(coreRoot, fileName) {
  const href = pathToFileURL(path.join(coreRoot, fileName)).href;
  return import(/* webpackIgnore: true */ href);
}

const sharedPdfPaths = new Map();

/**
 * Runs that publish the same HTML path take turns. The next run waits until
 * the earlier one has finished writing that path and the PDF beside it.
 *
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withSharedPdfPath(key, fn) {
  const previous = sharedPdfPaths.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const settled = run.then(() => {}, () => {});
  sharedPdfPaths.set(key, settled);
  settled.then(() => {
    if (sharedPdfPaths.get(key) === settled) sharedPdfPaths.delete(key);
  });
  return run;
}

/**
 * @param {string} htmlPath
 */
function runScratch(htmlPath) {
  const dir = path.join(path.dirname(htmlPath), `run-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, "cv");
  return {
    dir,
    json: `${base}.payload.json`,
    html: `${base}.html`,
    atsJson: `${base}.ats.json`,
    atsHtml: `${base}.ats.html`,
  };
}

function runNode(dataRoot, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: dataRoot,
      windowsHide: true,
      env: { ...process.env, CAREER_OPS_ROOT: dataRoot },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 20_000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr: stderr.trim() });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: err.message });
    });
  });
}

/**
 * @param {unknown} experience
 * @param {(period: string) => {year: number, month: number|null}|null} parseExperienceStart
 */
export function restoreNewestFirst(experience, parseExperienceStart) {
  if (!Array.isArray(experience)) return { experience, reordered: false };
  const starts = experience.map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    return parseExperienceStart(String(entry.dates ?? ""));
  });
  const indexes = [];
  for (let i = 0; i < experience.length; i++) {
    if (starts[i]?.year) indexes.push(i);
  }
  let inverted = false;
  for (let i = 1; i < indexes.length; i++) {
    if (compareStart(starts[indexes[i - 1]], starts[indexes[i]]) < 0) inverted = true;
  }
  if (!inverted) return { experience, reordered: false };
  const sorted = indexes
    .map((index) => ({ entry: experience[index], start: starts[index] }))
    .sort((a, b) => compareStart(b.start, a.start));
  const next = experience.slice();
  indexes.forEach((slot, i) => { next[slot] = sorted[i].entry; });
  return { experience: next, reordered: true };
}

function compareStart(a, b) {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month == null || b.month == null) return 0;
  return a.month - b.month;
}

function titleWarnings(check, payload, cvMd) {
  const cvEntries = check.parseCvExperience(cvMd);
  let tailored;
  try {
    tailored = check.parseTailoredExperience(payload);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const result = check.checkTitles(cvEntries, tailored);
  const warnings = [];
  const unverified = check.diagnoseUnverified(cvEntries, tailored, result);
  if (unverified?.message) warnings.push(unverified.message);
  for (const mismatch of result.mismatches) {
    warnings.push(`Title mismatch for ${mismatch.company} (${mismatch.dates}): cv.md says "${mismatch.cvTitle}", tailored CV says "${mismatch.tailoredTitle}".`);
  }
  for (const group of result.ambiguous) {
    warnings.push(`Title check could not pair ${group.company} (${group.dates}) because more than one title shares that company and those dates.`);
  }
  for (const entry of result.unmatchedTailored) {
    warnings.push(`Unmatched entry: ${entry.company} (${entry.dates}) could not be paired to a cv.md entry, so its title was not checked.`);
  }
  return { ok: true, warnings };
}

function structureWarnings(structure) {
  if (structure.verdict === "warn") {
    return [...structure.orderViolations, ...structure.descriptorViolations].map(String);
  }
  if (structure.verdict === "unverified") {
    return [structure.reason === "no-match"
      ? "Structure check did not run. No experience entry matched cv.md."
      : "Structure check did not run. cv.md experience could not be compared."];
  }
  return [];
}

/**
 * @param {object} args
 * @param {object} args.envelope
 * @param {string} args.coreRoot
 * @param {string} args.dataRoot
 * @param {string} [args.cvTemplate]
 * @param {string|null} [args.userTemplatesDir]
 * @param {string} [args.reportFile]
 * @param {string} args.htmlPath
 * @param {string} args.finalPdf
 * @param {boolean} [args.ats]
 * @returns {Promise<{ok: true, html: string, warnings: string[], ats: {html: string, finalPdf: string}|null, scratchDir?: string} | {ok: false, error: string}>}
 */
export async function materializeTailoredCv({
  envelope,
  coreRoot,
  dataRoot,
  cvTemplate,
  userTemplatesDir,
  reportFile,
  htmlPath,
  finalPdf,
  ats = false,
}) {
  if (envelope?.kind === "html" && typeof envelope.html === "string") {
    return { ok: true, html: envelope.html, warnings: [], ats: null };
  }
  if (envelope?.kind !== "json" || envelope.payload === null || typeof envelope.payload !== "object" || Array.isArray(envelope.payload)) {
    return { ok: false, error: "The CV envelope had no JSON payload to build from." };
  }

  const cvPath = path.join(dataRoot, "cv.md");
  let cvMd;
  try {
    cvMd = fs.readFileSync(cvPath, "utf8");
  } catch (err) {
    return { ok: false, error: `cv.md could not be read, so the title check did not run: ${err.message}` };
  }

  const warnings = [];
  const payload = {
    ...envelope.payload,
    experience: Array.isArray(envelope.payload.experience)
      ? envelope.payload.experience.map((entry) => (entry && typeof entry === "object" ? { ...entry } : entry))
      : envelope.payload.experience,
  };
  // The sheet is envelope.format. The body width is payload.page_format.
  // One value here, or a letter body can be printed on an A4 sheet.
  if (PAGE_FORMATS.has(envelope.format)) payload.page_format = envelope.format;

  const titleCheck = await loadCore(coreRoot, "cv-title-check.mjs");
  const titles = titleWarnings(titleCheck, payload, cvMd);
  if (!titles.ok) return titles;
  warnings.push(...titles.warnings);

  const orderMod = await loadCore(coreRoot, "cv-experience-order.mjs");
  const restored = restoreNewestFirst(payload.experience, orderMod.parseExperienceStart);
  if (restored.reordered) {
    payload.experience = restored.experience;
    warnings.push("Experience roles were put back into newest-first order. Bullets can move inside a role. Roles stay in date order.");
  }

  const structureMod = await loadCore(coreRoot, "verify-cv-structure.mjs");
  warnings.push(...structureWarnings(structureMod.verifyStructure(payload, cvMd)));

  const scratch = runScratch(htmlPath);
  let keepScratch = false;
  try {
    fs.writeFileSync(scratch.json, JSON.stringify(payload));
    const template = cvTemplateAbsolute({ cvTemplate, codeRoot: coreRoot, userTemplatesDir, dataRoot });
    const built = await runNode(dataRoot, [
      path.join(coreRoot, "build-cv-html.mjs"),
      scratch.json,
      scratch.html,
      template,
    ]);
    if (!built.ok) {
      const detail = built.stderr || "build-cv-html.mjs failed.";
      return { ok: false, error: `Could not build the tailored CV. ${detail}` };
    }

    let html;
    try {
      html = fs.readFileSync(scratch.html, "utf8");
    } catch (err) {
      return { ok: false, error: `The tailored CV HTML was not written: ${err.message}` };
    }

    const report = reportPath(dataRoot, reportFile);
    if (report && fs.existsSync(/* turbopackIgnore: true */ report)) {
      warnings.push(...await keywordWarnings(coreRoot, dataRoot, report, scratch.html));
    }

    const atsVariant = ats === true
      ? await buildAtsVariant({ coreRoot, dataRoot, payload, scratch, finalPdf, warnings })
      : null;
    // The route saves htmlPath once the client is still connected. Writing it
    // here would publish a CV the route then drops on disconnect.
    fs.rmSync(scratch.json, { force: true });
    fs.rmSync(scratch.atsJson, { force: true });
    keepScratch = Boolean(atsVariant);
    return { ok: true, html, warnings, ats: atsVariant, scratchDir: keepScratch ? scratch.dir : undefined };
  } finally {
    if (!keepScratch) fs.rmSync(scratch.dir, { recursive: true, force: true });
  }
}

function reportPath(dataRoot, reportFile) {
  if (typeof reportFile !== "string" || !reportFile.trim()) return null;
  return path.isAbsolute(reportFile) ? reportFile : path.join(dataRoot, reportFile);
}

async function keywordWarnings(coreRoot, dataRoot, report, htmlPath) {
  const result = await runNode(dataRoot, [
    path.join(coreRoot, "keyword-match.mjs"),
    report,
    "--cv",
    htmlPath,
    "--json",
  ]);
  if (!result.ok) {
    return [`Keyword check did not run. ${result.stderr}`.trim()];
  }
  try {
    const start = result.stdout.indexOf("{");
    if (start < 0) throw new Error("no JSON");
    const coverage = JSON.parse(result.stdout.slice(start));
    const warnings = [];
    if (Array.isArray(coverage.missing) && coverage.missing.length) {
      warnings.push(`Keywords missing from the tailored CV: ${coverage.missing.join(", ")}.`);
    }
    if (Array.isArray(coverage.thin) && coverage.thin.length) {
      warnings.push(`Keywords used only once: ${coverage.thin.join(", ")}.`);
    }
    return warnings;
  } catch {
    return ["Keyword check did not return a coverage report."];
  }
}

async function buildAtsVariant({ coreRoot, dataRoot, payload, scratch, finalPdf, warnings }) {
  let atsTemplate;
  try {
    const templates = await loadCore(coreRoot, "cv-templates.mjs");
    atsTemplate = templates.resolveTemplate("cv", "ats", { dir: path.join(coreRoot, "templates") });
  } catch (err) {
    warnings.push(`ATS PDF was not created: ${err.message}. Apply will use the styled PDF.`);
    return null;
  }
  let folded;
  try {
    const atsPayload = await loadCore(coreRoot, "ats-payload.mjs");
    folded = atsPayload.transformPayload(payload);
  } catch (err) {
    warnings.push(`ATS PDF was not created: ${err.message}. Apply will use the styled PDF.`);
    return null;
  }
  for (const finding of folded.findings ?? []) {
    const message = String(finding.message ?? "").slice(0, 180);
    warnings.push(`ATS lint ${finding.code}: ${message}`);
  }
  try {
    const body = JSON.stringify(folded.payload);
    if (typeof body !== "string") {
      warnings.push("ATS PDF was not created: the ATS payload was empty. Apply will use the styled PDF.");
      return null;
    }
    fs.writeFileSync(scratch.atsJson, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`ATS PDF was not created: ${message}. Apply will use the styled PDF.`);
    return null;
  }
  const built = await runNode(dataRoot, [
    path.join(coreRoot, "build-cv-html.mjs"),
    scratch.atsJson,
    scratch.atsHtml,
    atsTemplate,
  ]);
  if (!built.ok) {
    warnings.push(`ATS PDF was not created: ${built.stderr || "the ATS HTML build failed"}. Apply will use the styled PDF.`);
    return null;
  }
  return { html: scratch.atsHtml, finalPdf: atsPdfPath(finalPdf) };
}
