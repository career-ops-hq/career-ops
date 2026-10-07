import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export const dynamic = "force-dynamic";

const PROFILE_FILE = () => path.join(careerOpsRoot(), "data", "resume-profile.json");
const UPLOADS_DIR = () => path.join(careerOpsRoot(), "data", "uploads", "resumes");

type ResumeProfile = {
  name: string;
  education: { school: string; degree: string; expected: string };
  certifications: string[];
  skills: Record<string, string[]>;
  skillKeywords: string[];
  experience: {
    title: string;
    company: string;
    location: string;
    dates: string;
    bullets: string[];
    tags: string[];
  }[];
  projects: {
    name: string;
    tech: string[];
    year: number;
    bullets: string[];
    tags: string[];
  }[];
  parsedFrom: string;
  parsedAt: string;
};

// Section heading patterns
const SECTION_RE = /^(EDUCATION|SKILLS|EXPERIENCE|PROJECTS|CERTIFICATIONS|AWARDS|ACTIVITIES|PUBLICATIONS|VOLUNTEER|SUMMARY|OBJECTIVE|PROFILE)\s*$/i;

function isHeading(line: string): string | null {
  const m = line.trim().match(SECTION_RE);
  return m ? m[1].toUpperCase() : null;
}

// Extract tags from bullet text by keyword matching
function extractTags(text: string): string[] {
  const tags: string[] = [];
  const lower = text.toLowerCase();
  const terms: Record<string, string> = {
    python: "python", sql: "sql", postgresql: "postgresql",
    "r,": "r", "r ": "r", javascript: "javascript", java: "java",
    html: "html", css: "css", typescript: "typescript",
    pandas: "pandas", numpy: "numpy", "scikit-learn": "scikit-learn",
    scipy: "scipy", networkx: "network analysis", plotly: "plotly",
    matplotlib: "matplotlib", seaborn: "seaborn", tidyverse: "tidyverse",
    ggplot: "ggplot2", tableau: "tableau", excel: "excel",
    jupyter: "jupyter", git: "git", github: "github",
    docker: "docker", kubernetes: "kubernetes", aws: "aws",
    spark: "spark", kafka: "kafka", snowflake: "snowflake",
    databricks: "databricks", bigquery: "bigquery",
    "machine learning": "machine learning", "deep learning": "deep learning",
    "data pipeline": "data pipeline", etl: "etl", api: "api",
    dashboard: "dashboard", visualization: "data visualization",
    "a/b test": "a/b testing", experimentation: "experimentation",
    regression: "regression", classification: "classification",
    "random forest": "random forest", "logistic regression": "logistic regression",
    "hypothesis test": "hypothesis testing", "permutation test": "permutation testing",
    "cross-validation": "cross-validation", "user testing": "user testing",
    "web develop": "web development", "data analysis": "data analysis",
    "data wrangling": "data wrangling", "data model": "data modeling",
    research: "research", "neural network": "neural network",
  };
  for (const [pattern, tag] of Object.entries(terms)) {
    if (lower.includes(pattern)) tags.push(tag);
  }
  return [...new Set(tags)];
}

// Parse a role/company header line
// Examples: "Data Analyst, StoryAI — Dr. Ariel Han Research Lab (Remote)" or "Fulfillment Expert, Target — Brea, CA"
function parseExpHeader(line: string): { title: string; company: string; location: string } {
  // Try "Title, Company — Location" pattern
  let match = line.match(/^(.+?),\s*(.+?)(?:\s*[—–-]\s*(.+))?$/);
  if (match) {
    return { title: match[1].trim(), company: match[2].trim(), location: match[3]?.trim() ?? "" };
  }
  // Try "Title — Company" or "Title at Company"
  match = line.match(/^(.+?)(?:\s*[—–-]\s*|\s+at\s+)(.+)$/i);
  if (match) {
    return { title: match[1].trim(), company: match[2].trim(), location: "" };
  }
  return { title: line.trim(), company: "", location: "" };
}

// Parse a project header line
// Example: "Floor Generals: NBA Passing Network Analysis — Python, NBA Stats API, NetworkX, Plotly"
function parseProjectHeader(line: string): { name: string; tech: string[] } {
  const match = line.match(/^(.+?)\s*[—–-]\s*(.+)$/);
  if (match) {
    return { name: match[1].trim(), tech: match[2].split(",").map((t) => t.trim()).filter(Boolean) };
  }
  return { name: line.trim(), tech: [] };
}

// Extract year from a date string
function extractYear(s: string): number {
  const m = s.match(/\b(20\d{2})\b/);
  return m ? parseInt(m[1]) : new Date().getFullYear();
}

// Parse dates from the line (right-aligned dates like "2024–2025" or "2025–Present")
function extractDates(line: string): string {
  const m = line.match(/((?:19|20)\d{2})\s*[–-]\s*((?:19|20)\d{2}|Present)/i);
  return m ? m[0] : "";
}

// Parse skills section: "Category: item1, item2, item3"
function parseSkillsLines(lines: string[]): { skills: Record<string, string[]>; keywords: string[] } {
  const skills: Record<string, string[]> = {};
  const keywords: string[] = [];
  for (const line of lines) {
    const match = line.match(/^(.+?):\s*(.+)$/);
    if (match) {
      const category = match[1].trim().toLowerCase();
      const items = match[2].split(",").map((s) => s.trim()).filter(Boolean);
      skills[category] = items;
      for (const item of items) {
        keywords.push(item.toLowerCase().replace(/[()]/g, ""));
      }
    }
  }
  return { skills, keywords };
}

function parseResumeText(text: string, filename: string): ResumeProfile {
  const lines = text.split("\n").map((l) => l.trimEnd());

  // Name is typically the first non-empty line
  const name = lines.find((l) => l.trim().length > 0)?.trim() ?? "Unknown";

  const sections: Record<string, string[]> = {};
  let currentSection = "HEADER";
  sections[currentSection] = [];

  for (const line of lines.slice(1)) {
    const heading = isHeading(line);
    if (heading) {
      currentSection = heading;
      sections[currentSection] = [];
    } else {
      sections[currentSection]?.push(line);
    }
  }

  // Parse education
  const eduLines = (sections["EDUCATION"] ?? []).filter((l) => l.trim());
  let education = { school: "", degree: "", expected: "" };
  if (eduLines.length > 0) {
    // First line is usually school + degree
    const eduText = eduLines.join(" ");
    const expectedMatch = eduText.match(/Expected\s+(.+?)(?:\s|$)/i);
    education = {
      school: eduLines[0]?.replace(/[—–-].*/, "").trim() ?? "",
      degree: eduLines[0]?.match(/[—–-]\s*(.+?)(?:\s+Expected|$)/)?.[1]?.trim() ?? "",
      expected: expectedMatch?.[1]?.trim() ?? "",
    };
  }

  // Parse skills
  const skillLines = (sections["SKILLS"] ?? []).filter((l) => l.trim());
  const { skills, keywords } = parseSkillsLines(skillLines);

  // Add common method keywords
  const methodKeywords = [
    "exploratory data analysis", "eda", "dashboard", "data visualization",
    "machine learning", "data wrangling", "data cleaning", "etl",
    "data pipeline", "statistical analysis", "a/b testing",
  ];
  for (const mk of methodKeywords) {
    if (!keywords.includes(mk)) keywords.push(mk);
  }

  // Parse experience
  const experience: ResumeProfile["experience"][number][] = [];
  const expLines = (sections["EXPERIENCE"] ?? []).filter((l) => l.trim());
  let currentExp: ResumeProfile["experience"][number] | null = null;

  for (const line of expLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("•") || trimmed.startsWith("-") || trimmed.startsWith("–")) {
      if (currentExp) {
        const bullet = trimmed.replace(/^[•\-–]\s*/, "");
        currentExp.bullets.push(bullet);
        currentExp.tags.push(...extractTags(bullet));
      }
    } else if (trimmed) {
      // This might be a role header or a date line
      const dates = extractDates(trimmed);
      if (dates && currentExp) {
        currentExp.dates = dates;
      } else if (!dates || !currentExp) {
        // New role
        if (currentExp) {
          currentExp.tags = [...new Set(currentExp.tags)];
          experience.push(currentExp);
        }
        const parsed = parseExpHeader(trimmed);
        currentExp = { ...parsed, dates: dates || "", bullets: [], tags: [] };
      }
    }
  }
  if (currentExp) {
    currentExp.tags = [...new Set(currentExp.tags)];
    experience.push(currentExp);
  }

  // Parse projects
  const projects: ResumeProfile["projects"][number][] = [];
  const projLines = (sections["PROJECTS"] ?? []).filter((l) => l.trim());
  let currentProj: ResumeProfile["projects"][number] | null = null;

  for (const line of projLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("•") || trimmed.startsWith("-") || trimmed.startsWith("–")) {
      if (currentProj) {
        const bullet = trimmed.replace(/^[•\-–]\s*/, "");
        currentProj.bullets.push(bullet);
        currentProj.tags.push(...extractTags(bullet));
      }
    } else if (trimmed) {
      const dates = extractDates(trimmed);
      if (dates && currentProj) {
        currentProj.year = extractYear(dates);
      } else {
        if (currentProj) {
          currentProj.tags = [...new Set(currentProj.tags)];
          projects.push(currentProj);
        }
        const parsed = parseProjectHeader(trimmed);
        currentProj = { ...parsed, year: extractYear(trimmed), bullets: [], tags: [] };
      }
    }
  }
  if (currentProj) {
    currentProj.tags = [...new Set(currentProj.tags)];
    projects.push(currentProj);
  }

  // Parse certifications
  const certLines = (sections["CERTIFICATIONS"] ?? []).filter((l) => l.trim());
  const certifications = certLines.length > 0
    ? certLines.flatMap((l) => l.split(/[·;]/).map((c) => c.trim()).filter(Boolean))
    : [];

  return {
    name,
    education,
    certifications,
    skills,
    skillKeywords: [...new Set(keywords)],
    experience,
    projects,
    parsedFrom: filename,
    parsedAt: new Date().toISOString(),
  };
}

// GET: return current resume profile
export async function GET() {
  const file = PROFILE_FILE();
  try {
    fs.accessSync(file);
  } catch {
    return NextResponse.json({ error: "no resume profile yet — upload a resume first" }, { status: 404 });
  }
  try {
    return NextResponse.json(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return NextResponse.json({ error: "resume profile is corrupt — re-upload your resume to regenerate" }, { status: 500 });
  }
}

// POST: parse the most recent uploaded resume and save profile
export async function POST(_req: NextRequest) {
  const uploadsDir = UPLOADS_DIR();

  // Find the most recent resume file
  let resumeFiles: { name: string; path: string; mtime: number }[] = [];
  try {
    const files = fs.readdirSync(uploadsDir);
    resumeFiles = files
      .map((f) => {
        const fp = path.join(uploadsDir, f);
        const stat = fs.statSync(fp);
        return { name: f, path: fp, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return NextResponse.json({ error: "no resumes uploaded yet" }, { status: 404 });
  }

  if (resumeFiles.length === 0) {
    return NextResponse.json({ error: "no resumes found in uploads" }, { status: 404 });
  }

  const latest = resumeFiles[0];
  const ext = path.extname(latest.name).toLowerCase();

  let text: string;

  if (ext === ".pdf") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require("pdf-parse") as { PDFParse: new (opts: { data: Buffer }) => { getText(): Promise<string>; destroy(): void } };
    const buffer = fs.readFileSync(latest.path);
    const parser = new PDFParse({ data: buffer });
    try {
      text = await parser.getText();
    } finally {
      parser.destroy();
    }
  } else if (ext === ".txt" || ext === ".md") {
    text = fs.readFileSync(latest.path, "utf8");
  } else {
    return NextResponse.json({ error: `unsupported format: ${ext}. Upload a PDF, TXT, or MD resume.` }, { status: 400 });
  }

  // Strip the UUID prefix from filename for display
  const displayName = latest.name.replace(/^[a-f0-9]{8}-/, "");
  const profile = parseResumeText(text, displayName);

  // Save parsed profile
  const profilePath = PROFILE_FILE();
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));

  return NextResponse.json({
    message: "Resume parsed and profile updated",
    parsedFrom: displayName,
    sections: {
      experience: profile.experience.length,
      projects: profile.projects.length,
      skills: Object.keys(profile.skills).length,
      certifications: profile.certifications.length,
    },
  });
}
