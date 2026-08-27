import fs from "node:fs";
import path from "node:path";

const VERSION_RE = /^v(\d+)$/i;
const APP_DIR_RE = /^(\d+)(?:-(.*))?$/;
const SAFE_OUTPUT_RE = /^output\/(?:[^/]+\/(?:cv\/tailored\/v\d+\/cv\.pdf|cover-letter\/v\d+\/cover-letter\.pdf)|role-resumes\/[a-z0-9]+(?:-[a-z0-9]+)*\/v\d+\/cv\.pdf)$/i;
const SAFE_READY_RE = /^ready-to-apply\/[^/]+\.pdf$/i;

export function compareVersions(a, b) {
  return Number(b.slice(1)) - Number(a.slice(1));
}

export function readableSlug(value) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.length <= 3 && part === part.toLowerCase() ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function discoverVersions(root, appDir, kind) {
  const relBase = kind === "resume"
    ? path.join("output", appDir, "cv", "tailored")
    : path.join("output", appDir, "cover-letter");
  const filename = kind === "resume" ? "cv.pdf" : "cover-letter.pdf";
  const absBase = path.join(root, relBase);
  let entries = [];
  try {
    entries = fs.readdirSync(absBase, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && VERSION_RE.test(entry.name))
    .filter((entry) => fs.existsSync(path.join(absBase, entry.name, filename)))
    .map((entry) => ({
      version: entry.name.toLowerCase(),
      path: path.posix.join(...relBase.split(path.sep), entry.name, filename),
    }))
    .sort((a, b) => compareVersions(a.version, b.version));
}

export function discoverApplications(root, metadata = [], approvedPaths = new Set()) {
  const byNumber = new Map(metadata.map((item) => [String(Number(item.number)), item]));
  let entries = [];
  try {
    entries = fs.readdirSync(path.join(root, "output"), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && APP_DIR_RE.test(entry.name))
    .map((entry) => {
      const match = entry.name.match(APP_DIR_RE);
      const number = match[1].padStart(3, "0");
      const meta = byNumber.get(String(Number(match[1])));
      const documents = ["resume", "cover-letter"]
        .map((kind) => {
          const versions = discoverVersions(root, entry.name, kind);
          let workflow = null;
          if (kind === "cover-letter") {
            try { workflow = JSON.parse(fs.readFileSync(path.join(root, "output", entry.name, "cover-letter", "draft.json"), "utf8")); } catch { /* no initialized workflow */ }
          }
          if (!versions.length && !workflow) return null;
          if (!versions.length) return { kind, versions, selectedVersion: workflow.targetVersion, status: "Latest", workflow };
          const approved = versions.find((version) => approvedPaths.has(version.path));
          return { kind, versions, selectedVersion: approved?.version ?? versions[0].version, status: approved ? "Approved" : "Latest", workflow };
        })
        .filter(Boolean);
      if (!documents.length) return null;
      const fallback = readableSlug(match[2] || entry.name);
      return {
        directory: entry.name,
        number,
        company: meta?.company || fallback,
        role: meta?.role || "Application documents",
        documents,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(a.number) - Number(b.number));
}

export function discoverReadyToApply(root) {
  let entries = [];
  try {
    entries = fs.readdirSync(path.join(root, "ready-to-apply"), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
    .map((entry) => ({ name: entry.name, path: path.posix.join("ready-to-apply", entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function isAllowedDocumentPath(relativePath, sourceOnly = false) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\0") || relativePath.includes("\\")) return false;
  if (path.isAbsolute(relativePath) || relativePath !== path.posix.normalize(relativePath)) return false;
  if (relativePath.split("/").some((part) => part === "." || part === ".." || !part)) return false;
  return SAFE_OUTPUT_RE.test(relativePath) || (!sourceOnly && SAFE_READY_RE.test(relativePath));
}

export function resolveExistingDocument(root, relativePath, sourceOnly = false) {
  if (!isAllowedDocumentPath(relativePath, sourceOnly)) return null;
  try {
    const allowedRoot = fs.realpathSync(path.join(root, relativePath.startsWith("output/") ? "output" : "ready-to-apply"));
    const resolved = fs.realpathSync(path.join(root, ...relativePath.split("/")));
    if (resolved !== allowedRoot && !resolved.startsWith(allowedRoot + path.sep)) return null;
    if (!fs.statSync(resolved).isFile()) return null;
    return resolved;
  } catch {
    return null;
  }
}

export function generateReadyFilename(company, applicantName, kind) {
  const clean = (value, fallback) => String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim() || fallback;
  const label = kind === "cover-letter" ? "Cover Letter" : "Resume";
  return `${clean(company, "Company")} - ${clean(applicantName, "Candidate")} - ${label}.pdf`;
}
