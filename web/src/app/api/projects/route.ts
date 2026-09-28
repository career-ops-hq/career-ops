import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";

export type ProjectItem = {
  id: string;
  name: string;
  description: string;
  skills: string[];
  metrics: string;
  link?: string;
};

export async function GET() {
  const root = careerOpsRoot();
  const projectsPath = path.join(root, "data", "projects.json");
  const digestPath = path.join(root, "article-digest.md");

  let projects: ProjectItem[] = [];

  if (fs.existsSync(projectsPath)) {
    try {
      projects = JSON.parse(fs.readFileSync(projectsPath, "utf8"));
    } catch {}
  } else {
    // Check if article-digest.md exists for initial seed
    if (fs.existsSync(digestPath)) {
      projects.push({
        id: "proj-1",
        name: "AI Job Search Pipeline",
        description: "Open-source automated pipeline for high-volume job discovery and AI evaluation",
        skills: ["TypeScript", "Node.js", "AI/LLM", "Playwright"],
        metrics: "Evaluated 700+ offers with A-H structured report generation",
        link: "https://github.com/career-ops-hq/career-ops",
      });
    }
  }

  return NextResponse.json({ projects });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, description, skills, metrics, link } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    }

    let validatedLink = "";
    if (link && typeof link === "string" && link.trim()) {
      try {
        const u = new URL(link.trim());
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          return NextResponse.json({ error: "Link must use http: or https: protocol" }, { status: 400 });
        }
        validatedLink = u.href;
      } catch {
        return NextResponse.json({ error: "Invalid URL format for project link" }, { status: 400 });
      }
    }

    const root = careerOpsRoot();
    const projectsPath = path.join(root, "data", "projects.json");

    let current: ProjectItem[] = [];
    if (fs.existsSync(projectsPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(projectsPath, "utf8"));
        if (Array.isArray(parsed)) {
          current = parsed;
        } else {
          return NextResponse.json({ error: "projects.json format is invalid (not an array)" }, { status: 500 });
        }
      } catch {
        return NextResponse.json({ error: "Failed to read projects.json" }, { status: 500 });
      }
    }

    const newProject: ProjectItem = {
      id: `proj-${Date.now()}`,
      name: name.trim(),
      description: description || "",
      skills: Array.isArray(skills) ? skills : (skills || "").split(",").map((s: string) => s.trim()).filter(Boolean),
      metrics: metrics || "",
      link: validatedLink,
    };

    current.unshift(newProject);
    atomicWrite(projectsPath, JSON.stringify(current, null, 2));

    return NextResponse.json({ success: true, project: newProject });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
