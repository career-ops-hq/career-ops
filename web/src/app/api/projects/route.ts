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

    if (!name) {
      return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    }

    const root = careerOpsRoot();
    const projectsPath = path.join(root, "data", "projects.json");

    let current: ProjectItem[] = [];
    if (fs.existsSync(projectsPath)) {
      try {
        current = JSON.parse(fs.readFileSync(projectsPath, "utf8"));
      } catch {}
    }

    const newProject: ProjectItem = {
      id: `proj-${Date.now()}`,
      name,
      description: description || "",
      skills: Array.isArray(skills) ? skills : (skills || "").split(",").map((s: string) => s.trim()).filter(Boolean),
      metrics: metrics || "",
      link: link || "",
    };

    current.unshift(newProject);
    atomicWrite(projectsPath, JSON.stringify(current, null, 2));

    return NextResponse.json({ success: true, project: newProject });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
