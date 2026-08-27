import crypto from "node:crypto";

export const UPDATE_TYPES = ["certification", "skill", "project", "work", "education"];
const fields = {
  certification: ["name", "organization", "dateEarned", "expirationDate", "credentialId", "credentialUrl", "relatedSkills", "notes"],
  skill: ["name", "category", "experienceSource", "professionalUse", "whereUsed", "years", "notes", "experienceIndex"],
  project: ["name", "projectType", "organization", "role", "startDate", "endDate", "present", "description", "technologies", "responsibilities", "achievements", "metrics", "url"],
  work: ["experienceIndex", "changeType", "value"],
  education: ["entryType", "degree", "school", "graduationYear", "coursework", "program"],
};
const required = {
  certification: ["name", "organization"], skill: ["name", "category", "experienceSource", "professionalUse"],
  project: ["name", "projectType", "role", "description"], work: ["experienceIndex", "changeType", "value"], education: ["entryType"],
};
const arr = (value) => Array.isArray(value) ? value.map(String).map((v) => v.trim()).filter(Boolean) : [];
const clean = (value) => typeof value === "string" ? value.trim() : value;
const esc = (value) => String(value ?? "").replace(/[\r\n]+/g, " ").trim();
const norm = (value) => esc(value).toLocaleLowerCase();

export function validateProfileUpdateRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Profile update request must be an object.");
  const allowedTop = new Set(["updateType", "data"]);
  const unknownTop = Object.keys(value).filter((key) => !allowedTop.has(key));
  if (unknownTop.length) throw new Error(`Unexpected request field "${unknownTop[0]}".`);
  if (!UPDATE_TYPES.includes(value.updateType)) throw new Error("Invalid profile update type.");
  if (!value.data || typeof value.data !== "object" || Array.isArray(value.data)) throw new Error("Update data must be an object.");
  const allowed = new Set(fields[value.updateType]);
  const unknown = Object.keys(value.data).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`Unexpected ${value.updateType} field "${unknown[0]}".`);
  for (const key of required[value.updateType]) {
    if (!(key in value.data) || value.data[key] === "" || value.data[key] === null || value.data[key] === undefined) throw new Error(`${key} is required.`);
  }
  if (value.updateType === "skill") {
    if (!["Professional work", "Project experience", "Certification/training", "Self-study"].includes(value.data.experienceSource)) throw new Error("Invalid skill experience source.");
    if (typeof value.data.professionalUse !== "boolean") throw new Error("professionalUse must be Yes or No.");
    if (value.data.professionalUse && value.data.experienceIndex !== undefined && !Number.isInteger(value.data.experienceIndex)) throw new Error("Invalid work-experience selection.");
  }
  if (value.updateType === "work" && !Number.isInteger(value.data.experienceIndex)) throw new Error("Invalid work-experience selection.");
  if (value.updateType === "work" && !["responsibility", "technology", "project", "achievement", "quantified-result", "role-correction", "date-correction"].includes(value.data.changeType)) throw new Error("Invalid work-experience change type.");
  if (value.updateType === "education") {
    if (!['degree', 'training'].includes(value.data.entryType)) throw new Error("Invalid education update type.");
    if (value.data.entryType === "degree" && (!clean(value.data.degree) || !clean(value.data.school))) throw new Error("degree and school are required.");
    if (value.data.entryType === "training" && !clean(value.data.program)) throw new Error("program is required.");
  }
  const data = Object.fromEntries(Object.entries(value.data).map(([key, item]) => [key, Array.isArray(item) ? arr(item) : clean(item)]));
  return { updateType: value.updateType, data };
}

export function listWorkExperience(cv) {
  const source = String(cv ?? "").replace(/\r\n/g, "\n");
  const section = /^##\s+Professional Experience\s*$/im.exec(source);
  if (!section) return [];
  const start = section.index + section[0].length;
  const endRel = source.slice(start).search(/^##\s+/m);
  const end = endRel < 0 ? source.length : start + endRel;
  const body = source.slice(start, end);
  const headings = [...body.matchAll(/^###\s+(.+)$/gm)];
  return headings.map((match, index) => {
    const entryStart = start + match.index;
    const entryEnd = index + 1 < headings.length ? start + headings[index + 1].index : end;
    const entry = source.slice(entryStart, entryEnd);
    const role = /^\*\*(.+)\*\*$/m.exec(entry)?.[1] || "";
    return { index, label: `${match[1]}${role ? ` — ${role}` : ""}`, start: entryStart, end: entryEnd };
  });
}

function appendSection(cv, headingPattern, heading, block) {
  const match = new RegExp(`^##\\s+${headingPattern}\\s*$`, "im").exec(cv);
  if (!match) return `${cv.trimEnd()}\n\n---\n\n## ${heading}\n\n${block}\n`;
  const after = match.index + match[0].length;
  const nextRel = cv.slice(after).search(/^##\s+/m);
  const at = nextRel < 0 ? cv.length : after + nextRel;
  const before = cv.slice(0, at).replace(/\s*$/, "");
  return `${before}\n\n${block}\n\n${cv.slice(at).replace(/^\s*/, "")}`;
}

const bulletLines = (items) => arr(items).map((item) => `- ${esc(item)}`).join("\n");
function certificationBlock(d) {
  const details = [d.dateEarned && `Earned: ${esc(d.dateEarned)}`, d.expirationDate && `Expires: ${esc(d.expirationDate)}`, d.credentialId && `Credential ID: ${esc(d.credentialId)}`, d.credentialUrl && `Credential: ${esc(d.credentialUrl)}`, arr(d.relatedSkills).length && `Related skills: ${arr(d.relatedSkills).join(", ")}`, d.notes && esc(d.notes)].filter(Boolean);
  return `**${esc(d.name)} — ${esc(d.organization)}**${details.length ? `\n${details.join("  \n")}` : ""}`;
}
function skillBlock(d) {
  const context = [`Source: ${d.experienceSource}`, `Professional use: ${d.professionalUse ? "Yes" : "No"}`, d.whereUsed && `Where used: ${esc(d.whereUsed)}`, d.years && `Approximate experience: ${esc(d.years)} years`, d.notes && esc(d.notes)].filter(Boolean).join("; ");
  return `- **${esc(d.category)} — ${esc(d.name)}:** ${context}`;
}
function projectBlock(d) {
  const period = [d.startDate, d.present ? "Present" : d.endDate].filter(Boolean).map(esc).join(" – ");
  return [`### ${esc(d.name)}`, `**${esc(d.role)}**${d.organization ? ` — ${esc(d.organization)}` : ""}`, [d.projectType, period].filter(Boolean).map(esc).join(" | "), "", esc(d.description), arr(d.technologies).length ? `**Technologies:** ${arr(d.technologies).join(", ")}` : "", bulletLines(d.responsibilities), bulletLines(d.achievements), d.metrics ? `- **Results:** ${esc(d.metrics)}` : "", d.url ? `**URL:** ${esc(d.url)}` : ""].filter((v) => v !== "").join("\n");
}
function educationBlock(d) {
  if (d.entryType === "training") return `**${esc(d.program)}**${d.school ? `\n${esc(d.school)}` : ""}${d.graduationYear ? `\n${esc(d.graduationYear)}` : ""}`;
  return `**${esc(d.degree)}**${d.school ? `\n${esc(d.school)}` : ""}${d.graduationYear ? `\n${esc(d.graduationYear)}` : ""}${arr(d.coursework).length ? `\nRelevant coursework: ${arr(d.coursework).join(", ")}` : ""}`;
}

export function buildProfileUpdatePreview(cvValue, requestValue) {
  const cv = String(cvValue ?? "");
  const request = validateProfileUpdateRequest(requestValue);
  const { updateType, data: d } = request;
  const workEntries = listWorkExperience(cv);
  let block = "", section = "", proposedCv = cv, duplicate = false;
  if (updateType === "certification") { section = "Certifications"; block = certificationBlock(d); duplicate = norm(cv).includes(norm(d.name)) && norm(cv).includes(norm(d.organization)); proposedCv = appendSection(cv, "Certifications?", section, block); }
  if (updateType === "skill") {
    section = "Technical Expertise"; block = skillBlock(d); duplicate = norm(cv).includes(norm(d.name)); proposedCv = appendSection(cv, "Technical Expertise|Technical Skills|Skills", section, block);
    if (d.professionalUse && Number.isInteger(d.experienceIndex)) proposedCv = addWorkBullet(proposedCv, d.experienceIndex, `Used ${esc(d.name)} professionally${d.whereUsed ? ` in ${esc(d.whereUsed)}` : ""}.`).cv;
  }
  if (updateType === "project") { section = "Selected Projects"; block = projectBlock(d); duplicate = new RegExp(`^###\\s+${escapeRegExp(esc(d.name))}\\s*$`, "im").test(cv); proposedCv = appendSection(cv, "(?:Selected\\s+)?(?:Infrastructure\\s+)?Projects?", section, block); }
  if (updateType === "education") { section = "Education"; block = educationBlock(d); duplicate = d.entryType === "training" ? norm(cv).includes(norm(d.program)) : norm(cv).includes(norm(d.degree)) && norm(cv).includes(norm(d.school)); proposedCv = appendSection(cv, "Education", section, block); }
  if (updateType === "work") { section = "Professional Experience"; const result = addWorkBullet(cv, d.experienceIndex, d.value, d.changeType); proposedCv = result.cv; block = result.preview; duplicate = result.duplicate; }
  const description = `${updateType} update in ${section}`;
  const previewHash = crypto.createHash("sha256").update(cv).update("\0").update(JSON.stringify(request)).digest("hex");
  return { request, proposedCv, preview: { section, markdown: block }, duplicate, warning: duplicate ? `A matching ${updateType} entry already exists.` : "", previewHash, description, workEntries: workEntries.map(({ index, label }) => ({ index, label })) };
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function addWorkBullet(cv, index, value, changeType = "technology") {
  const entries = listWorkExperience(cv); const entry = entries[index];
  if (!entry) throw new Error("Selected work-experience entry was not found.");
  const text = esc(value); const current = cv.slice(entry.start, entry.end);
  const duplicate = current.split(/\r?\n/).some((line) => norm(line.replace(/^[-*]\s*/, "").replace(/^\*\*|\*\*$/g, "")) === norm(text));
  if (changeType === "role-correction") {
    const changed = current.replace(/^\*\*(.+)\*\*$/m, `**${text}**`);
    if (changed === current) throw new Error("The selected work entry has no recognizable role line.");
    return { cv: cv.slice(0, entry.start) + changed + cv.slice(entry.end), preview: `### ${entry.label}\n\n**${text}**`, duplicate };
  }
  if (changeType === "date-correction") {
    const changed = current.replace(/^(?=.*\b(?:19|20)\d{2}\b)(?!###|\*\*|- ).+$/m, text);
    if (changed === current) throw new Error("The selected work entry has no recognizable date line.");
    return { cv: cv.slice(0, entry.start) + changed + cv.slice(entry.end), preview: `### ${entry.label}\n\n${text}`, duplicate };
  }
  const insertion = `\n- ${text}\n`;
  return { cv: cv.slice(0, entry.end).replace(/\s*$/, "") + insertion + cv.slice(entry.end), preview: `### ${entry.label}\n\n- ${text}`, duplicate };
}

export function verifyApprovedProfileUpdate(cv, body) {
  if (!body || body.approved !== true || typeof body.previewHash !== "string") throw new Error("Explicit preview approval is required.");
  const preview = buildProfileUpdatePreview(cv, { updateType: body.updateType, data: body.data });
  if (preview.previewHash !== body.previewHash) throw new Error("The preview is stale; review the update again.");
  if (preview.duplicate && body.confirmDuplicate !== true) throw new Error("Duplicate confirmation is required.");
  return preview;
}
