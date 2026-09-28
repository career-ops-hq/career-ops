import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export type DocumentItem = {
  id: string;
  name: string;
  category: "cv" | "tailored-cv" | "cover-letter" | "interview-prep" | "report";
  path: string;
  sizeBytes: number;
  updatedAt: string;
  company?: string;
  role?: string;
};

export async function GET() {
  const root = careerOpsRoot();
  const docs: DocumentItem[] = [];

  // Master CV
  const cvPath = path.join(root, "cv.md");
  if (fs.existsSync(cvPath)) {
    try {
      const stat = fs.statSync(cvPath);
      docs.push({
        id: "doc-cv-master",
        name: "cv.md (Master CV)",
        category: "cv",
        path: "cv.md",
        sizeBytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
      });
    } catch {}
  }

  // Output documents (Tailored CVs, Cover Letters)
  const outputDir = path.join(root, "output");
  if (fs.existsSync(outputDir)) {
    try {
      const files = fs.readdirSync(outputDir);
      for (const file of files) {
        try {
          const filePath = path.join(outputDir, file);
          const stat = fs.statSync(filePath);
          if (stat.isFile()) {
            const isCover = file.includes("cover") || file.includes("letter");
            docs.push({
              id: `doc-out-${file}`,
              name: file,
              category: isCover ? "cover-letter" : "tailored-cv",
              path: `output/${file}`,
              sizeBytes: stat.size,
              updatedAt: stat.mtime.toISOString(),
            });
          }
        } catch {}
      }
    } catch {}
  }

  // Interview Prep
  const prepDir = path.join(root, "interview-prep");
  if (fs.existsSync(prepDir)) {
    try {
      const files = fs.readdirSync(prepDir);
      for (const file of files) {
        if (file.endsWith(".md")) {
          try {
            const filePath = path.join(prepDir, file);
            const stat = fs.statSync(filePath);
            docs.push({
              id: `doc-prep-${file}`,
              name: file,
              category: "interview-prep",
              path: `interview-prep/${file}`,
              sizeBytes: stat.size,
              updatedAt: stat.mtime.toISOString(),
            });
          } catch {}
        }
      }
    } catch {}
  }

  // Reports
  const reportsDir = path.join(root, "reports");
  if (fs.existsSync(reportsDir)) {
    try {
      const files = fs.readdirSync(reportsDir);
      for (const file of files) {
        if (file.endsWith(".md") && !file.includes("RESERVED")) {
          try {
            const filePath = path.join(reportsDir, file);
            const stat = fs.statSync(filePath);
            docs.push({
              id: `doc-rep-${file}`,
              name: file,
              category: "report",
              path: `reports/${file}`,
              sizeBytes: stat.size,
              updatedAt: stat.mtime.toISOString(),
            });
          } catch {}
        }
      }
    } catch {}
  }

  docs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return NextResponse.json({ documents: docs });
}
