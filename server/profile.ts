import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";

const WORKSPACE_ROOT = path.resolve(process.cwd());

export interface DashboardProfile {
  name: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  portfolio: string;
  github: string;
  headline: string;
  outputLanguage: string;
}

export function loadDashboardProfile(): DashboardProfile {
  let raw: any = {};
  try {
    raw = yaml.load(fs.readFileSync(path.join(WORKSPACE_ROOT, "config", "profile.yml"), "utf8")) || {};
  } catch {
    // doctor.mjs owns missing-profile guidance; the dashboard remains readable.
  }
  const candidate = raw.candidate || {};
  return {
    name: String(candidate.full_name || "Career-Ops Candidate"),
    email: String(candidate.email || ""),
    phone: String(candidate.phone || ""),
    location: String(candidate.public_location_header || candidate.location || ""),
    linkedin: String(candidate.linkedin || ""),
    portfolio: String(candidate.portfolio_url || candidate.portfolio || ""),
    github: String(candidate.github || ""),
    headline: String(raw.narrative?.headline || raw.target_roles?.primary?.[0] || "Candidate"),
    outputLanguage: String(raw.language?.output || "en")
  };
}

function section(markdown: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown.match(new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, "mi"))?.[1] || "";
}

export function loadCvSupportingSections() {
  let markdown = "";
  try { markdown = fs.readFileSync(path.join(WORKSPACE_ROOT, "cv.md"), "utf8"); } catch { /* empty */ }
  const parseRows = (body: string) => body.split("\n").map((line) => {
    const match = line.match(/^\s*-\s+\*\*(.+?)\*\*\s*--\s*(.*?)(?:\s+\(([^)]+)\))?\s*$/);
    if (!match) return null;
    return { title: match[1].trim(), org: match[2].trim(), year: (match[3] || "").trim() };
  }).filter(Boolean);
  const education = parseRows(section(markdown, "Education"));
  const certifications = parseRows(section(markdown, "Courses & Continuous Learning"));
  const languages = section(markdown, "Languages").split("\n").map((line) => {
    const match = line.match(/^\s*-\s+\*\*(.+?):\*\*\s*(.+)$/);
    return match ? `${match[1]} (${match[2]})` : "";
  }).filter(Boolean);
  return { education, certifications, languages };
}

export function candidateFileSlug(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "candidate";
}

export function resolveMasterPdfPath() {
  let configured = "";
  try {
    const raw: any = yaml.load(fs.readFileSync(path.join(WORKSPACE_ROOT, "config", "profile.yml"), "utf8")) || {};
    configured = String(raw.cv?.master_pdf || "");
  } catch { /* fall through */ }
  if (configured) return path.resolve(WORKSPACE_ROOT, configured);
  const rootPdf = fs.readdirSync(WORKSPACE_ROOT).find((name) => name.toLowerCase().endsWith(".pdf"));
  return path.join(WORKSPACE_ROOT, rootPdf || "cv.pdf");
}
