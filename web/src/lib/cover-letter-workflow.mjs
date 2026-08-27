import fs from "node:fs";
import path from "node:path";

export const AUTO_COVER_MARKER = "<!-- co-web:auto-cover-letter: on -->";

function versionNumber(name) {
  const match = String(name).match(/^v(\d+)$/i);
  return match ? Number(match[1]) : -1;
}

function versionDirs(dir, filename) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && versionNumber(entry.name) >= 0 && fs.existsSync(path.join(dir, entry.name, filename)))
      .map((entry) => entry.name.toLowerCase())
      .sort((a, b) => versionNumber(b) - versionNumber(a));
  } catch { return []; }
}

export function autoCoverEnabled(customContent) {
  return String(customContent || "").includes(AUTO_COVER_MARKER);
}

export function nextCoverVersion(versions) {
  const max = versions.reduce((value, version) => Math.max(value, versionNumber(version)), 0);
  return `v${String(max + 1).padStart(3, "0")}`;
}

export function canGenerateCoverLetter(state) {
  return state?.status === "Approved" && typeof state?.payloadPath === "string" && state.payloadPath.length > 0;
}

export function findApplicationDirectory(root, applicationId) {
  const target = Number(applicationId);
  if (!Number.isInteger(target) || target < 1) return null;
  try {
    return fs.readdirSync(path.join(root, "output"), { withFileTypes: true })
      .find((entry) => entry.isDirectory() && Number(entry.name.match(/^(\d+)-/)?.[1]) === target)?.name ?? null;
  } catch { return null; }
}

export function initializeCoverLetterDraft(root, applicationId, enabled = true, now = new Date().toISOString()) {
  if (!enabled) return { kind: "disabled" };
  const appDir = findApplicationDirectory(root, applicationId);
  if (!appDir) return { kind: "missing-application" };
  const appRoot = path.join(root, "output", appDir);
  const resumes = versionDirs(path.join(appRoot, "cv", "tailored"), "cv.pdf");
  if (!resumes.length) return { kind: "missing-resume" };
  const coverRoot = path.join(appRoot, "cover-letter");
  const covers = versionDirs(coverRoot, "cover-letter.pdf");
  const statePath = path.join(coverRoot, "draft.json");
  let current = null;
  try { current = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch { /* first draft */ }
  if (current?.resumeVersion === resumes[0] && ["Draft - Review Required", "Approved", "Review recommended - newer resume exists"].includes(current.status)) {
    return { kind: "unchanged", state: current, statePath };
  }
  const status = covers.length ? "Review recommended - newer resume exists" : "Draft - Review Required";
  const state = {
    applicationId: String(applicationId).padStart(3, "0"),
    applicationDirectory: appDir,
    resumeVersion: resumes[0],
    existingCoverVersion: covers[0] ?? null,
    targetVersion: nextCoverVersion(covers),
    status,
    createdAt: now,
    reportSelector: String(applicationId),
    approvalRequired: true,
  };
  fs.mkdirSync(coverRoot, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
  return { kind: "created", state, statePath };
}
