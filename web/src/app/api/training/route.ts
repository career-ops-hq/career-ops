import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";

export type AssessmentItem = {
  id: string;
  date: string;
  platform: string;
  subject: string;
  score: string;
  status: "Passed" | "Completed" | "In Progress";
  notes?: string;
};

export async function GET() {
  const root = careerOpsRoot();
  const assessPath = path.join(root, "data", "assessments.tsv");

  const assessments: AssessmentItem[] = [];

  if (fs.existsSync(assessPath)) {
    try {
      const content = fs.readFileSync(assessPath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split("\t");
        if (parts.length >= 3) {
          assessments.push({
            id: `ass-${i}`,
            date: parts[0]?.trim() || "",
            platform: parts[1]?.trim() || "",
            subject: parts[2]?.trim() || "",
            score: parts[3]?.trim() || "N/A",
            status: (parts[4]?.trim() as AssessmentItem["status"]) || "Completed",
            notes: parts[5]?.trim() || "",
          });
        }
      }
    } catch {}
  }

  return NextResponse.json({ assessments });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { platform, subject, score, status, notes } = body || {};
    const sanitize = (val: unknown, def = ""): string => {
      if (typeof val !== "string") return def;
      return val.replace(/[\t\r\n]+/g, " ").trim();
    };

    const sPlatform = sanitize(platform);
    const sSubject = sanitize(subject);
    const sScore = sanitize(score, "N/A");
    const sStatus = sanitize(status, "Completed");
    const sNotes = sanitize(notes);

    if (!sPlatform || !sSubject) {
      return NextResponse.json({ error: "Platform and Subject are required" }, { status: 400 });
    }

    const root = careerOpsRoot();
    const assessPath = path.join(root, "data", "assessments.tsv");

    let current = "";
    if (fs.existsSync(assessPath)) {
      current = fs.readFileSync(assessPath, "utf8");
    } else {
      current = "Date\tPlatform\tSubject\tScore\tStatus\tNotes\n";
    }

    if (current.length > 0 && !current.endsWith("\n")) {
      current += "\n";
    }

    const today = new Date().toISOString().slice(0, 10);
    const row = `${today}\t${sPlatform}\t${sSubject}\t${sScore}\t${sStatus}\t${sNotes}\n`;
    current += row;

    atomicWrite(assessPath, current);

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
