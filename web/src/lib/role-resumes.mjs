import fs from "node:fs";
import path from "node:path";

export const ROLE_FOCUS_AREAS = [
  "Java", "Backend Development", "REST APIs", "Full-Stack Development", "React",
  "JavaScript / TypeScript", "Enterprise Applications", "Application Modernization",
  "System Design", "Distributed Systems", "SQL", "Docker", "Kubernetes",
  "Red Hat OpenShift", "CI/CD", "Production Reliability", "Performance Engineering",
  "Integration Services",
];

const EVIDENCE = {
  "Java": [/\bjava\b/i],
  "Backend Development": [/\bbackend\b/i, /server-side/i],
  "REST APIs": [/\brest(?:ful)?\b/i, /\bapi(?:s)?\b/i],
  "Full-Stack Development": [/full[- ]stack/i, /\breact\b/i],
  "React": [/\breact(?:\.js|js)?\b/i],
  "JavaScript / TypeScript": [/\bjavascript\b/i, /\btypescript\b/i],
  "Enterprise Applications": [/enterprise application/i, /enterprise software/i],
  "Application Modernization": [/moderniz/i],
  "System Design": [/system design/i, /architect(?:ure|ed|ing)/i],
  "Distributed Systems": [/distributed system/i, /distributed workflow/i],
  "SQL": [/\bsql\b/i],
  "Docker": [/\bdocker\b/i],
  "Kubernetes": [/\bkubernetes\b/i],
  "Red Hat OpenShift": [/\bopenshift\b/i],
  "CI/CD": [/\bci\s*\/\s*cd\b/i, /continuous integration/i],
  "Production Reliability": [/production reliability/i, /production troubleshooting/i, /root[- ]cause/i],
  "Performance Engineering": [/performance optimi[sz]/i, /performance analysis/i, /bottleneck/i],
  "Integration Services": [/integration service/i, /enterprise integration/i],
};

export function slugifyRole(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function isSafeRoleSlug(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 80;
}

export function classifyFocusAreas(cvText, requested = []) {
  const unique = [...new Set(requested.map((v) => String(v).trim()).filter(Boolean))].slice(0, 30);
  const supported = [];
  const unsupported = [];
  for (const area of unique) {
    const patterns = EVIDENCE[area];
    const customTokens = area.toLowerCase().match(/[a-z0-9+#.]+/g) || [];
    const ok = patterns
      ? patterns.some((pattern) => pattern.test(cvText))
      : customTokens.length > 0 && customTokens.every((token) => new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(cvText));
    (ok ? supported : unsupported).push(area);
  }
  return { supported, unsupported };
}

export function validateRoleResumePlanShape(value, { requireApproval = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("General Role Resume plan must be an object.");
  if (requireApproval && value.approved !== true) throw new Error("Preview approval is required before generation.");
  for (const key of ["targetRole", "roleSlug", "positioning", "version"]) {
    if (typeof value[key] !== "string" || !value[key].trim()) throw new Error(`General Role Resume plan field "${key}" must be a non-empty string.`);
  }
  for (const key of ["supportedFocusAreas", "unsupportedFocusAreas"]) {
    if (!Array.isArray(value[key]) || value[key].some((item) => typeof item !== "string")) throw new Error(`General Role Resume plan field "${key}" must be an array of strings.`);
  }
  if (!isSafeRoleSlug(value.roleSlug)) throw new Error("General Role Resume plan contains an invalid roleSlug.");
  if (!/^v\d{3,}$/.test(value.version)) throw new Error("General Role Resume plan contains an invalid version.");
  return { targetRole: value.targetRole.trim(), roleSlug: value.roleSlug, positioning: value.positioning.trim(), supportedFocusAreas: [...value.supportedFocusAreas], unsupportedFocusAreas: [...value.unsupportedFocusAreas], version: value.version };
}

export function nextRoleVersion(root, slug) {
  if (!isSafeRoleSlug(slug)) throw new Error("Invalid role slug.");
  const base = path.join(root, "output", "role-resumes", slug);
  let names = [];
  try { names = fs.readdirSync(base); } catch { /* first version */ }
  const max = names.reduce((n, name) => /^v(\d+)$/.test(name) ? Math.max(n, Number(name.slice(1))) : n, 0);
  return `v${String(max + 1).padStart(3, "0")}`;
}

export function planRoleResume(root, { targetRole, focusAreas = [] }) {
  const cleanRole = String(targetRole || "").trim();
  const slug = slugifyRole(cleanRole);
  if (!cleanRole || cleanRole.length > 100 || !isSafeRoleSlug(slug)) throw new Error("Enter a valid target role.");
  const cvText = fs.readFileSync(path.join(root, "cv.md"), "utf8");
  const focus = classifyFocusAreas(cvText, focusAreas);
  return {
    targetRole: cleanRole, roleSlug: slug,
    positioning: `${/^senior\b/i.test(cleanRole) ? cleanRole : `Senior ${cleanRole}`} / Software Engineer`,
    supportedFocusAreas: focus.supported,
    unsupportedFocusAreas: focus.unsupported,
    sections: ["Professional Summary", "Core Competencies", "Professional Experience", "Technical Skills", "Selected Projects", "Education", "Certifications"],
    version: nextRoleVersion(root, slug),
  };
}

export function roleResumePaths(root, plan) {
  if (!plan || !isSafeRoleSlug(plan.roleSlug) || !/^v\d{3,}$/.test(plan.version)) throw new Error("Invalid role-resume path.");
  const directory = path.join(root, "output", "role-resumes", plan.roleSlug, plan.version);
  return { directory, html: path.join(directory, "cv.html"), finalPdf: path.join(directory, "cv.pdf"), changes: path.join(directory, "changes.md"), metadata: path.join(directory, "metadata.json") };
}

export function validateApprovedRoleResumePlan(root, value) {
  const submitted = validateRoleResumePlanShape(value, { requireApproval: true });
  const canonical = planRoleResume(root, { targetRole: submitted.targetRole, focusAreas: [...submitted.supportedFocusAreas, ...submitted.unsupportedFocusAreas] });
  for (const key of ["roleSlug", "positioning", "version"]) if (submitted[key] !== canonical[key]) throw new Error(`General Role Resume plan is stale or inconsistent (${key}). Review it again.`);
  if (JSON.stringify(submitted.supportedFocusAreas) !== JSON.stringify(canonical.supportedFocusAreas) || JSON.stringify(submitted.unsupportedFocusAreas) !== JSON.stringify(canonical.unsupportedFocusAreas)) throw new Error("General Role Resume focus-area validation changed. Review the plan again.");
  return canonical;
}

export function parseApprovedRoleResumeInput(root, input) {
  let value;
  try { value = JSON.parse(input); } catch { throw new Error("General Role Resume plan must be valid JSON."); }
  return validateApprovedRoleResumePlan(root, value);
}

export function discoverRoleResumes(root) {
  const base = path.join(root, "output", "role-resumes");
  let roles = [];
  try { roles = fs.readdirSync(base, { withFileTypes: true }); } catch { return []; }
  return roles.filter((e) => e.isDirectory() && isSafeRoleSlug(e.name)).map((entry) => {
    const roleDir = path.join(base, entry.name);
    const versions = fs.readdirSync(roleDir, { withFileTypes: true })
      .filter((v) => v.isDirectory() && /^v\d+$/.test(v.name) && fs.existsSync(path.join(roleDir, v.name, "cv.pdf")))
      .map((v) => {
        let metadata = {};
        try { metadata = JSON.parse(fs.readFileSync(path.join(roleDir, v.name, "metadata.json"), "utf8")); } catch { /* optional */ }
        return { version: v.name, path: path.posix.join("output", "role-resumes", entry.name, v.name, "cv.pdf"), metadata };
      }).sort((a, b) => Number(b.version.slice(1)) - Number(a.version.slice(1)));
    if (!versions.length) return null;
    return { slug: entry.name, targetRole: versions[0].metadata.targetRole || entry.name.split("-").map((p) => p[0].toUpperCase() + p.slice(1)).join(" "), versions, latest: versions[0] };
  }).filter(Boolean).sort((a, b) => a.targetRole.localeCompare(b.targetRole));
}

export function reserveRoleResumeDirectory(paths) {
  fs.mkdirSync(path.dirname(paths.directory), { recursive: true });
  fs.mkdirSync(paths.directory, { recursive: false });
}
