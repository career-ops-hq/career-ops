import fs from "node:fs";
import path from "node:path";
import { planRoleResume } from "./role-resumes.mjs";

const wordTokens = (value) => String(value || "").toLowerCase().match(/[a-z0-9+#.]{3,}/g) || [];

export function relevantProfileUpdates(updates, context) {
  const haystack = new Set(wordTokens(context));
  return updates.filter((item) => {
    if (["certification", "education", "work"].includes(item.updateType)) return true;
    const tokens = wordTokens(item.description).filter((token) => !["skill", "project", "approved", "entry"].includes(token));
    return tokens.length > 0 && tokens.some((token) => haystack.has(token));
  });
}

export function readProfileUpdatesSince(root, createdAt) {
  let updates = [];
  try { const parsed = JSON.parse(fs.readFileSync(path.join(root, "data", "profile-updates.json"), "utf8")); if (Array.isArray(parsed)) updates = parsed; } catch { return []; }
  const since = typeof createdAt === "string" ? Date.parse(createdAt) : Number.NaN;
  return updates.filter((item) => typeof item?.timestamp === "string" && (Number.isNaN(since) || Date.parse(item.timestamp) > since));
}

export function buildResumeUpdatePreview({ root, family, identifier, applications, roles, profileState }) {
  if (family === "general-role") {
    const role = roles.find((item) => item.slug === identifier);
    if (!role || role.freshness !== "stale") throw new Error("That General Role resume does not have a profile update available.");
    const meta = role.latest.metadata || {};
    const targetRole = role.targetRole;
    const focusAreas = Array.isArray(meta.supportedFocusAreas) ? meta.supportedFocusAreas : [];
    const canonical = planRoleResume(root, { targetRole, focusAreas });
    const updates = relevantProfileUpdates(readProfileUpdatesSince(root, meta.createdAt), `${targetRole} ${meta.positioning || ""} ${focusAreas.join(" ")}`);
    const nextVersion = canonical.version;
    return {
      family, identifier: role.slug, name: targetRole, currentVersion: role.latest.version, nextVersion,
      generatedAt: meta.createdAt || null, resumeProfileVersion: meta.profileVersion ?? null, currentProfileVersion: profileState.version,
      changes: updates.map((item) => ({ section: item.section || "Career Profile", description: item.description || `${item.updateType} update` })),
      unchangedSections: ["Education", "Certifications"].filter((section) => !updates.some((item) => item.section === section)),
      meaningful: updates.length > 0 || canonical.supportedFocusAreas.length !== focusAreas.length,
      run: { kind: "role-resume", input: JSON.stringify({ targetRole: canonical.targetRole, roleSlug: canonical.roleSlug, positioning: canonical.positioning, supportedFocusAreas: canonical.supportedFocusAreas, unsupportedFocusAreas: canonical.unsupportedFocusAreas, version: canonical.version, approved: true }) },
    };
  }
  if (family === "application") {
    const app = applications.find((item) => item.number === String(identifier).padStart(3, "0"));
    const resume = app?.documents.find((document) => document.kind === "resume");
    if (!app || !resume?.versions[0] || resume.freshness !== "stale") throw new Error("That application resume does not have a profile update available.");
    const meta = resume.versions[0].metadata || {};
    const reports = fs.readdirSync(path.join(root, "reports")).filter((name) => name.startsWith(`${app.number}-`) || name.startsWith(`${Number(app.number)}-`));
    const reportText = reports.length ? fs.readFileSync(path.join(root, "reports", reports.sort().at(-1)), "utf8") : "";
    const updates = relevantProfileUpdates(readProfileUpdatesSince(root, meta.createdAt), `${app.company} ${app.role} ${reportText}`);
    const max = Math.max(...resume.versions.map((item) => Number(item.version.slice(1))));
    const nextVersion = `v${String(max + 1).padStart(3, "0")}`;
    return {
      family, identifier: app.number, name: `${app.company} — ${app.role}`, currentVersion: resume.versions[0].version, nextVersion,
      generatedAt: meta.createdAt || null, resumeProfileVersion: meta.profileVersion ?? null, currentProfileVersion: profileState.version,
      changes: updates.map((item) => ({ section: item.section || "Career Profile", description: item.description || `${item.updateType} update` })),
      unchangedSections: [], meaningful: updates.length > 0 || !meta.createdAt,
      run: { kind: "pdf", input: String(Number(app.number)) },
    };
  }
  throw new Error("Invalid resume family.");
}
