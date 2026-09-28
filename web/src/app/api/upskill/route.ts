import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export type SkillStat = {
  name: string;
  category: "Languages" | "Frameworks" | "Infrastructure & Cloud" | "Databases" | "Methodologies";
  frequency: number;
  inCv: boolean;
  priority: "High" | "Medium" | "Low";
};

export async function GET() {
  const root = careerOpsRoot();

  // Read cv.md
  let cvContent = "";
  const cvPath = path.join(root, "cv.md");
  if (fs.existsSync(cvPath)) {
    try {
      cvContent = fs.readFileSync(cvPath, "utf8").toLowerCase();
    } catch {}
  }

  // Scan reports for common tech skills
  const reportsDir = path.join(root, "reports");
  const skillCounts: Record<string, { count: number; category: SkillStat["category"] }> = {
    "TypeScript": { count: 0, category: "Languages" },
    "Python": { count: 0, category: "Languages" },
    "Go": { count: 0, category: "Languages" },
    "Rust": { count: 0, category: "Languages" },
    "React": { count: 0, category: "Frameworks" },
    "Next.js": { count: 0, category: "Frameworks" },
    "Node.js": { count: 0, category: "Frameworks" },
    "Kubernetes": { count: 0, category: "Infrastructure & Cloud" },
    "Docker": { count: 0, category: "Infrastructure & Cloud" },
    "AWS": { count: 0, category: "Infrastructure & Cloud" },
    "GCP": { count: 0, category: "Infrastructure & Cloud" },
    "PostgreSQL": { count: 0, category: "Databases" },
    "Redis": { count: 0, category: "Databases" },
    "BigQuery": { count: 0, category: "Databases" },
    "Kafka": { count: 0, category: "Infrastructure & Cloud" },
    "GraphQL": { count: 0, category: "Frameworks" },
    "System Design": { count: 0, category: "Methodologies" },
    "CI/CD": { count: 0, category: "Infrastructure & Cloud" },
  };

  if (fs.existsSync(reportsDir)) {
    try {
      const files = fs.readdirSync(reportsDir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        const text = fs.readFileSync(path.join(reportsDir, file), "utf8");
        for (const skill of Object.keys(skillCounts)) {
          const regex = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
          if (regex.test(text)) {
            skillCounts[skill].count += 1;
          }
        }
      }
    } catch {}
  }

  const skills: SkillStat[] = Object.entries(skillCounts).map(([name, data]) => {
    const wordBoundary = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const inCv = wordBoundary.test(cvContent);
    const count = data.count;
    const priority = count >= 3 && !inCv ? "High" : count >= 1 && !inCv ? "Medium" : "Low";
    return {
      name,
      category: data.category,
      frequency: count,
      inCv,
      priority,
    };
  });

  skills.sort((a, b) => b.frequency - a.frequency);

  return NextResponse.json({
    skills,
    topGaps: skills.filter((s) => !s.inCv && s.frequency > 0),
  });
}
