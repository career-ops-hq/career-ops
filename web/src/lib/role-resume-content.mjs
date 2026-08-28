import fs from "node:fs";
import path from "node:path";

export const ROLE_JSON_OPEN_MARK = "<<role-resume-json>>";
export const ROLE_JSON_CLOSE_MARK = "<</role-resume-json>>";

const TOP_FIELDS = new Set(["format", "lang", "name", "phone", "email", "linkedin", "portfolio", "location", "professionalSummary", "coreCompetencies", "workExperience", "projects", "education", "certifications", "awards", "interests", "skills"]);
const REQUIRED_FIELDS = [...TOP_FIELDS];
export const ROLE_RESUME_TOP_LEVEL_FIELDS = [...REQUIRED_FIELDS];
const SECTION_LABELS = {
  SECTION_SUMMARY: "Professional Summary",
  SECTION_COMPETENCIES: "Core Competencies",
  SECTION_EXPERIENCE: "Professional Experience",
  SECTION_PROJECTS: "Selected Projects",
  SECTION_EDUCATION: "Education",
  SECTION_CERTIFICATIONS: "Certifications",
  SECTION_AWARDS: "Awards",
  SECTION_INTERESTS: "Interests",
  SECTION_SKILLS: "Technical Skills",
};

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, field) => {
  if (typeof value !== "string") throw new Error(`General Role content field "${field}" must be a string.`);
  return value;
};
const nullableText = (value, field) => {
  if (value !== null) text(value, field);
  return value;
};
const stringArray = (value, field) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`General Role content field "${field}" must be an array of strings.`);
  return value;
};
const exactObject = (value, field, required, optional = []) => {
  if (!isObject(value)) throw new Error(`General Role content field "${field}" must be an object.`);
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`General Role content field "${field}" contains unexpected field "${unknown[0]}".`);
  for (const key of required) if (!(key in value)) throw new Error(`General Role content field "${field}.${key}" is required.`);
  return value;
};

export function validateRoleResumeContent(value) {
  if (!isObject(value)) throw new Error("General Role content must be a JSON object.");
  const unknown = Object.keys(value).filter((key) => !TOP_FIELDS.has(key));
  if (unknown.length) throw new Error(`General Role content contains unexpected field "${unknown[0]}".`);
  for (const key of REQUIRED_FIELDS) if (!(key in value)) throw new Error(`General Role content field "${key}" is required.`);
  if (!new Set(["letter", "a4"]).has(value.format)) throw new Error('General Role content field "format" must be "letter" or "a4".');
  for (const key of ["lang", "name", "phone", "email", "location", "professionalSummary", "interests"]) text(value[key], key);
  for (const key of ["linkedin", "portfolio"]) {
    const item = exactObject(value[key], key, ["url", "display"]);
    text(item.url, `${key}.url`); text(item.display, `${key}.display`);
  }
  stringArray(value.coreCompetencies, "coreCompetencies");
  const arrays = ["workExperience", "projects", "education", "certifications", "awards", "skills"];
  for (const key of arrays) if (!Array.isArray(value[key])) throw new Error(`General Role content field "${key}" must be an array.`);
  value.workExperience.forEach((entry, i) => {
    if (!isObject(entry)) throw new Error(`General Role content field "workExperience[${i}]" must be an object.`);
    const usesGroups = "groups" in entry;
    const usesLegacyBullets = "bullets" in entry;
    if (usesGroups === usesLegacyBullets) throw new Error(`General Role content field "workExperience[${i}]" must contain exactly one of "groups" or legacy "bullets".`);
    const shape = usesGroups ? ["company", "period", "role", "location", "groups"] : ["company", "period", "role", "location", "bullets"];
    const item = exactObject(entry, `workExperience[${i}]`, shape);
    for (const key of ["company", "period", "role", "location"]) text(item[key], `workExperience[${i}].${key}`);
    if (usesGroups) {
      if (!Array.isArray(item.groups)) throw new Error(`General Role content field "workExperience[${i}].groups" must be an array.`);
      item.groups.forEach((group, groupIndex) => {
        const groupItem = exactObject(group, `workExperience[${i}].groups[${groupIndex}]`, ["heading", "bullets"]);
        text(groupItem.heading, `workExperience[${i}].groups[${groupIndex}].heading`);
        stringArray(groupItem.bullets, `workExperience[${i}].groups[${groupIndex}].bullets`);
      });
    } else stringArray(item.bullets, `workExperience[${i}].bullets`);
  });
  value.projects.forEach((entry, i) => {
    const item = exactObject(entry, `projects[${i}]`, ["title", "description", "technologies", "url", "badge"]);
    for (const key of ["title", "description"]) text(item[key], `projects[${i}].${key}`);
    stringArray(item.technologies, `projects[${i}].technologies`);
    for (const key of ["url", "badge"]) nullableText(item[key], `projects[${i}].${key}`);
  });
  value.education.forEach((entry, i) => {
    const item = exactObject(entry, `education[${i}]`, ["title", "organization", "year", "description"]);
    for (const key of ["title", "organization", "year"]) text(item[key], `education[${i}].${key}`);
    nullableText(item.description, `education[${i}].description`);
  });
  for (const group of ["certifications", "awards"]) value[group].forEach((entry, i) => {
    const item = exactObject(entry, `${group}[${i}]`, ["title", "organization", "year"]);
    for (const key of ["title", "organization", "year"]) text(item[key], `${group}[${i}].${key}`);
  });
  value.skills.forEach((entry, i) => {
    const item = exactObject(entry, `skills[${i}]`, ["category", "items"]);
    text(item.category, `skills[${i}].category`); stringArray(item.items, `skills[${i}].items`);
  });
  return value;
}

const REFUSAL_SUMMARY_RE = /please provide the job description|specify the career-ops task|\bi cannot\b|\bi need more information\b|provide more information|cannot complete|unable to complete/i;
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const experienceGroups = (entry) => Array.isArray(entry?.groups)
  ? entry.groups
  : [{ heading: "", bullets: Array.isArray(entry?.bullets) ? entry.bullets : [] }];
const experienceBullets = (entry) => experienceGroups(entry).flatMap((group) => group.bullets || []);

/** Source-presence policy derived from headings only; never exposes source text. */
export function roleResumeSourceRequirements(markdown) {
  const source = typeof markdown === "string" ? markdown.replace(/\r\n/g, "\n") : "";
  const hasSection = (heading) => {
    const match = new RegExp(`^#{1,6}\\s+${heading}\\s*$`, "im").exec(source);
    if (!match) return false;
    const body = source.slice(match.index + match[0].length).split(/^#{1,6}\s+/m, 1)[0];
    return /[\p{L}\p{N}]/u.test(body);
  };
  return {
    projects: hasSection("(?:Selected\\s+)?(?:Infrastructure\\s+)?Projects?"),
    education: hasSection("Education"),
    certifications: hasSection("Certifications?|Certificates?"),
  };
}

/**
 * Semantic gate after schema validation and before any HTML/file operation.
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateRoleResumeCompleteness(content, requirements = {}) {
  const fail = (reason) => ({ ok: false, error: `General Role resume content was structurally valid but incomplete: ${reason}` });
  if (!nonEmpty(content?.name)) return fail("name is empty.");
  const summary = typeof content?.professionalSummary === "string" ? content.professionalSummary.trim() : "";
  if (REFUSAL_SUMMARY_RE.test(summary)) return fail("professionalSummary contained a refusal instead of a professional summary.");
  if (summary.length < 80) return fail(`professionalSummary is too short (${summary.length} characters; minimum 80).`);
  const competencies = (content?.coreCompetencies || []).filter(nonEmpty);
  if (competencies.length < 6) return fail(`coreCompetencies has ${competencies.length} non-empty entries; minimum 6.`);
  if (!Array.isArray(content?.workExperience) || content.workExperience.length < 1) return fail("workExperience is empty.");
  for (let i = 0; i < content.workExperience.length; i += 1) {
    const entry = content.workExperience[i];
    for (const field of ["company", "role", "period"]) if (!nonEmpty(entry[field])) return fail(`workExperience[${i}].${field} is empty.`);
    const groups = experienceGroups(entry);
    if (Array.isArray(entry.groups)) {
      if (groups.length < 1) return fail(`workExperience[${i}].groups is empty.`);
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        if (!nonEmpty(groups[groupIndex].heading)) return fail(`workExperience[${i}].groups[${groupIndex}].heading is empty.`);
        const groupBullets = (groups[groupIndex].bullets || []).filter(nonEmpty);
        if (groupBullets.length < 1) return fail(`workExperience[${i}].groups[${groupIndex}].bullets is empty.`);
      }
    }
    const bullets = experienceBullets(entry).filter(nonEmpty);
    if (bullets.length < 2) return fail(`workExperience[${i}] has ${bullets.length} non-empty experience bullets; minimum 2.`);
    // A role with enough material for recruiter-hostile density must be split.
    // Short historical roles remain valid with one group.
    if (Array.isArray(entry.groups) && bullets.length >= 6 && groups.length < 2) return fail(`workExperience[${i}] has ${bullets.length} bullets but only ${groups.length} group; substantial roles require at least 2 groups.`);
  }
  if (requirements.projects && (!Array.isArray(content?.projects) || content.projects.length < 1)) return fail("projects is empty although cv.md contains project experience.");
  if (requirements.education && (!Array.isArray(content?.education) || content.education.length < 1)) return fail("education is empty although cv.md contains education.");
  if (requirements.certifications && (!Array.isArray(content?.certifications) || content.certifications.length < 1)) return fail("certifications is empty although cv.md contains certifications.");
  for (let i = 0; i < content.projects.length; i += 1) {
    if (!nonEmpty(content.projects[i].title)) return fail(`projects[${i}].title is empty.`);
    if (!nonEmpty(content.projects[i].description)) return fail(`projects[${i}].description is empty.`);
  }
  for (let i = 0; i < content.education.length; i += 1) {
    for (const field of ["title", "organization", "year"]) if (!nonEmpty(content.education[i][field])) return fail(`education[${i}].${field} is empty.`);
  }
  for (let i = 0; i < content.certifications.length; i += 1) {
    if (!nonEmpty(content.certifications[i].title)) return fail(`certifications[${i}].title is empty.`);
  }
  if (!Array.isArray(content?.skills) || content.skills.length < 2) return fail(`skills has ${content?.skills?.length || 0} categories; minimum 2.`);
  for (let i = 0; i < content.skills.length; i += 1) {
    const entry = content.skills[i];
    if (!nonEmpty(entry.category)) return fail(`skills[${i}].category is empty.`);
    const items = (entry.items || []).filter(nonEmpty);
    if (items.length < 2) return fail(`skills[${i}].items has ${items.length} non-empty entries; minimum 2.`);
  }
  const substantiveCount = [content.name, summary, ...competencies,
    ...content.workExperience.flatMap((entry) => [entry.company, entry.role, entry.period, ...experienceGroups(entry).flatMap((group) => [group.heading, ...(group.bullets || [])])]),
    ...content.projects.flatMap((entry) => [entry.title, entry.description, ...entry.technologies]),
    ...content.education.flatMap((entry) => [entry.title, entry.organization, entry.year]),
    ...content.certifications.flatMap((entry) => [entry.title, entry.organization, entry.year]),
    ...content.skills.flatMap((entry) => [entry.category, ...entry.items])].filter(nonEmpty).length;
  if (substantiveCount < 18) return fail(`total substantive field count is ${substantiveCount}; minimum 18.`);
  return { ok: true };
}

export function parseRoleResumeWorkerResponse(rawValue) {
  const raw = typeof rawValue === "string" ? rawValue.replace(/\r\n/g, "\n") : "";
  const openers = [...raw.matchAll(/^<<role-resume-json>>[ \t]*$/gm)];
  if (openers.length !== 1) return { ok: false, error: openers.length ? `Found ${openers.length} role-resume JSON envelopes; expected exactly one.` : "The General Role worker emitted no <<role-resume-json>> envelope." };
  const start = openers[0].index + openers[0][0].length;
  const tail = raw.slice(start);
  const closers = [...tail.matchAll(/^<<\/role-resume-json>>[ \t]*$/gm)];
  if (!closers.length) return { ok: false, error: "The <<role-resume-json>> envelope was never closed." };
  if (closers.length > 1) return { ok: false, error: "Found multiple role-resume JSON envelope closers." };
  const json = tail.slice(0, closers[0].index).trim();
  let content;
  try { content = JSON.parse(json); } catch { return { ok: false, error: "The General Role worker returned invalid JSON content." }; }
  try { validateRoleResumeContent(content); } catch (error) { return { ok: false, error: error.message }; }
  const finalLine = raw.trim().split(/\r?\n/).at(-1) || "";
  if (!/^VERDICT:\s*5\/5\s+(?:—|–|-)\s+\S/i.test(finalLine)) return { ok: false, error: "The General Role worker exited without the required final VERDICT line." };
  return { ok: true, content };
}

export function parseRawRoleResumeJson(rawValue) {
  const raw = typeof rawValue === "string" ? rawValue.trim() : "";
  let content;
  try { content = JSON.parse(raw); } catch { return { ok: false, error: "The schema-constrained General Role worker returned invalid raw JSON." }; }
  try { validateRoleResumeContent(content); } catch (error) { return { ok: false, error: error.message }; }
  return { ok: true, content };
}

export function createRawRoleResumeFilter() {
  let raw = "";
  return { push(chunk) { raw += String(chunk ?? ""); return ""; }, flush() { return ""; }, result() { return parseRawRoleResumeJson(raw); }, rawText() { return raw; } };
}

/** Key-name-only diagnostics. Never returns JSON values or resume content. */
export function inspectRoleResumeJsonShape(rawValue) {
  const raw = typeof rawValue === "string" ? rawValue.replace(/\r\n/g, "\n") : "";
  const opener = /^<<role-resume-json>>[ \t]*$/m.exec(raw);
  if (!opener) return { parsed: false, topLevelKeys: [], unexpectedKeys: [], unexpectedKeyCount: 0, requiredKeyCount: REQUIRED_FIELDS.length, presentRequiredKeyCount: 0, missingRequiredKeys: [...REQUIRED_FIELDS] };
  const start = opener.index + opener[0].length;
  const tail = raw.slice(start);
  const closer = /^<<\/role-resume-json>>[ \t]*$/m.exec(tail);
  if (!closer) return { parsed: false, topLevelKeys: [], unexpectedKeys: [], unexpectedKeyCount: 0, requiredKeyCount: REQUIRED_FIELDS.length, presentRequiredKeyCount: 0, missingRequiredKeys: [...REQUIRED_FIELDS] };
  let value;
  try { value = JSON.parse(tail.slice(0, closer.index).trim()); } catch { return { parsed: false, topLevelKeys: [], unexpectedKeys: [], unexpectedKeyCount: 0, requiredKeyCount: REQUIRED_FIELDS.length, presentRequiredKeyCount: 0, missingRequiredKeys: [...REQUIRED_FIELDS] }; }
  const keys = isObject(value) ? Object.keys(value).sort() : [];
  const unexpectedKeys = keys.filter((key) => !TOP_FIELDS.has(key));
  const missingRequiredKeys = REQUIRED_FIELDS.filter((key) => !keys.includes(key));
  return { parsed: isObject(value), topLevelKeys: keys, unexpectedKeys, unexpectedKeyCount: unexpectedKeys.length, requiredKeyCount: REQUIRED_FIELDS.length, presentRequiredKeyCount: REQUIRED_FIELDS.length - missingRequiredKeys.length, missingRequiredKeys };
}

export function inspectRawRoleResumeJsonShape(rawValue) {
  const raw = typeof rawValue === "string" ? rawValue.trim() : "";
  let value;
  try { value = JSON.parse(raw); } catch { return { parsed: false, topLevelKeys: [], unexpectedKeys: [], unexpectedKeyCount: 0, requiredKeyCount: REQUIRED_FIELDS.length, presentRequiredKeyCount: 0, missingRequiredKeys: [...REQUIRED_FIELDS] }; }
  const keys = isObject(value) ? Object.keys(value).sort() : [];
  const unexpectedKeys = keys.filter((key) => !TOP_FIELDS.has(key));
  const missingRequiredKeys = REQUIRED_FIELDS.filter((key) => !keys.includes(key));
  return { parsed: isObject(value), topLevelKeys: keys, unexpectedKeys, unexpectedKeyCount: unexpectedKeys.length, requiredKeyCount: REQUIRED_FIELDS.length, presentRequiredKeyCount: REQUIRED_FIELDS.length - missingRequiredKeys.length, missingRequiredKeys };
}

export function formatRoleResumeSchemaDiagnostics(shape) {
  const safe = shape && typeof shape === "object" ? shape : {};
  const csv = (value) => Array.isArray(value) ? value.filter((key) => typeof key === "string").join(",") : "";
  return {
    parsed: safe.parsed === true,
    topLevelKeysCsv: csv(safe.topLevelKeys),
    unexpectedKeysCsv: csv(safe.unexpectedKeys),
    unexpectedKeyCount: Number.isSafeInteger(safe.unexpectedKeyCount) ? safe.unexpectedKeyCount : 0,
    requiredKeyCount: Number.isSafeInteger(safe.requiredKeyCount) ? safe.requiredKeyCount : REQUIRED_FIELDS.length,
    presentRequiredKeyCount: Number.isSafeInteger(safe.presentRequiredKeyCount) ? safe.presentRequiredKeyCount : 0,
    missingRequiredKeysCsv: csv(safe.missingRequiredKeys),
  };
}

export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const safeUrl = (value) => {
  if (!value) return "";
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? escapeHtml(value) : ""; } catch { return ""; }
};
const div = (cls, value) => `<div class="${cls}">${escapeHtml(value)}</div>`;

export function renderRoleResumeTemplate({ root, content }) {
  validateRoleResumeContent(content);
  const template = fs.readFileSync(path.join(root, "templates", "cv-template.html"), "utf8");
  const replacements = {
    LANG: escapeHtml(content.lang), PAGE_WIDTH: content.format === "a4" ? "210mm" : "8.5in", PHOTO: "",
    NAME: escapeHtml(content.name), PHONE: escapeHtml(content.phone), EMAIL: escapeHtml(content.email),
    LINKEDIN_URL: safeUrl(content.linkedin.url), LINKEDIN_DISPLAY: escapeHtml(content.linkedin.display),
    PORTFOLIO_URL: safeUrl(content.portfolio.url), PORTFOLIO_DISPLAY: escapeHtml(content.portfolio.display), LOCATION: escapeHtml(content.location),
    SUMMARY_TEXT: escapeHtml(content.professionalSummary),
    COMPETENCIES: content.coreCompetencies.map((item) => `<span class="competency-tag">${escapeHtml(item)}</span>`).join("\n"),
    EXPERIENCE: content.workExperience.map((item) => `<div class="job-item"><div class="job-header"><span class="job-company">${escapeHtml(item.company)}</span><span class="job-period">${escapeHtml(item.period)}</span></div>${div("job-role", item.role)}${div("job-location", item.location)}${experienceGroups(item).map((group) => `<div class="experience-group">${group.heading ? div("experience-group-heading", group.heading) : ""}<ul>${group.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul></div>`).join("")}</div>`).join("\n"),
    PROJECTS: content.projects.map((item) => `<div class="project-item"><div class="project-title">${item.url && safeUrl(item.url) ? `<a href="${safeUrl(item.url)}">${escapeHtml(item.title)}</a>` : escapeHtml(item.title)}${item.badge ? ` <span class="project-badge">${escapeHtml(item.badge)}</span>` : ""}</div>${div("project-desc", item.description)}${div("project-tech", item.technologies.join(", "))}</div>`).join("\n"),
    EDUCATION: content.education.map((item) => `<div class="edu-item"><div class="edu-header"><div class="edu-title">${escapeHtml(item.title)} <span class="edu-org">${escapeHtml(item.organization)}</span></div><div class="edu-year">${escapeHtml(item.year)}</div></div>${item.description ? div("edu-desc", item.description) : ""}</div>`).join("\n"),
    CERTIFICATIONS: content.certifications.map((item) => `<div class="cert-item"><span class="cert-title">${escapeHtml(item.title)}</span><span class="cert-org">${escapeHtml(item.organization)}</span><span class="cert-year">${escapeHtml(item.year)}</span></div>`).join("\n"),
    AWARDS: content.awards.map((item) => `<div class="award-item"><span class="award-title">${escapeHtml(item.title)}</span><span class="award-org">${escapeHtml(item.organization)}</span><span class="award-year">${escapeHtml(item.year)}</span></div>`).join("\n"),
    INTERESTS: escapeHtml(content.interests),
    SKILLS: content.skills.map((item) => `<div class="skill-item"><span class="skill-category">${escapeHtml(item.category)}: </span>${escapeHtml(item.items.join(", "))}</div>`).join("\n"),
    ...SECTION_LABELS,
  };
  const html = template.replace(/{{([A-Z0-9_]+)}}/g, (match, key) => key in replacements ? replacements[key] : match);
  const unresolved = html.match(/{{[^}]+}}/);
  if (unresolved) throw new Error(`Backend template mapping left unresolved placeholder ${unresolved[0]}.`);
  return { html, format: content.format };
}

export function createRoleResumeJsonFilter() {
  let raw = "", visible = "", inside = false;
  return {
    push(chunk) {
      const value = String(chunk ?? ""); raw += value; visible += value;
      let output = "";
      for (;;) {
        if (!inside) {
          const at = visible.indexOf(ROLE_JSON_OPEN_MARK);
          if (at < 0) { const keep = Math.min(ROLE_JSON_OPEN_MARK.length - 1, visible.length); output += visible.slice(0, visible.length - keep); visible = visible.slice(-keep); return output; }
          output += visible.slice(0, at); visible = visible.slice(at + ROLE_JSON_OPEN_MARK.length); inside = true;
        } else {
          const at = visible.indexOf(ROLE_JSON_CLOSE_MARK);
          if (at < 0) { visible = visible.slice(-Math.min(ROLE_JSON_CLOSE_MARK.length - 1, visible.length)); return output; }
          visible = visible.slice(at + ROLE_JSON_CLOSE_MARK.length); inside = false;
        }
      }
    },
    flush() { const result = inside ? "" : visible; visible = ""; return result; },
    result() { return parseRoleResumeWorkerResponse(raw); },
    rawText() { return raw; },
  };
}
