import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export async function GET() {
  const root = careerOpsRoot();

  const checks = [
    {
      category: "System",
      name: "Node.js Runtime",
      status: parseInt(process.version.slice(1), 10) >= 18 ? "ok" : "warn",
      details: `${process.version} (${process.platform} ${process.arch})`,
    },
    {
      category: "System",
      name: "Data Root Directory",
      status: fs.existsSync(root) ? "ok" : "error",
      details: root,
    },
    {
      category: "Career Profile",
      name: "Master CV (cv.md)",
      status: fs.existsSync(path.join(root, "cv.md")) ? "ok" : "warn",
      details: fs.existsSync(path.join(root, "cv.md")) ? "Present" : "Missing (recommended to create)",
      fix: fs.existsSync(path.join(root, "cv.md")) ? undefined : "Create a cv.md file in your workspace root or use Settings > Profile",
    },
    {
      category: "Career Profile",
      name: "Targeting Profile (config/profile.yml)",
      status: fs.existsSync(path.join(root, "config", "profile.yml")) ? "ok" : "warn",
      details: fs.existsSync(path.join(root, "config", "profile.yml")) ? "Configured" : "Missing",
      fix: fs.existsSync(path.join(root, "config", "profile.yml")) ? undefined : "Configure your target roles and compensation in Settings",
    },
    {
      category: "Career Profile",
      name: "Profile Strategy (modes/_profile.md)",
      status: fs.existsSync(path.join(root, "modes", "_profile.md")) ? "ok" : "warn",
      details: fs.existsSync(path.join(root, "modes", "_profile.md")) ? "Present" : "Missing",
      fix: fs.existsSync(path.join(root, "modes", "_profile.md")) ? undefined : "Copy modes/_profile.template.md to modes/_profile.md",
    },
    {
      category: "Job Discovery",
      name: "Portals Configuration (portals.yml)",
      status: fs.existsSync(path.join(root, "portals.yml")) ? "ok" : "warn",
      details: fs.existsSync(path.join(root, "portals.yml")) ? "Present" : "Missing",
      fix: fs.existsSync(path.join(root, "portals.yml")) ? undefined : "Copy templates/portals.example.yml to portals.yml",
    },
    {
      category: "Storage",
      name: "Applications Tracker (data/applications.md)",
      status: fs.existsSync(path.join(root, "data", "applications.md")) ? "ok" : "ok",
      details: fs.existsSync(path.join(root, "data", "applications.md")) ? "Active" : "Will create on first application",
    },
    {
      category: "Storage",
      name: "Reports Directory (reports/)",
      status: fs.existsSync(path.join(root, "reports")) ? "ok" : "ok",
      details: fs.existsSync(path.join(root, "reports")) ? "Ready" : "Will create on first evaluation",
    },
    {
      category: "Storage",
      name: "Output Artifacts (output/)",
      status: fs.existsSync(path.join(root, "output")) ? "ok" : "ok",
      details: fs.existsSync(path.join(root, "output")) ? "Ready" : "Will create on first PDF generation",
    },
  ];

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    root,
    checks,
  });
}
