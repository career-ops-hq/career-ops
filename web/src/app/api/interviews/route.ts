import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, readApplications } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";

export async function GET() {
  const root = careerOpsRoot();
  const apps = readApplications();

  const interviewStatuses = ["screen", "interview", "technical", "onsite", "final", "round 1", "round 2"];
  const interviews = apps.filter((a) =>
    interviewStatuses.some((s) => a.status.toLowerCase().includes(s))
  );

  // Read story bank
  let storyBank = "";
  const storyBankPath = path.join(root, "interview-prep", "story-bank.md");
  if (fs.existsSync(storyBankPath)) {
    try {
      storyBank = fs.readFileSync(storyBankPath, "utf8");
    } catch {}
  }

  // List existing prep files
  const prepDir = path.join(root, "interview-prep");
  let prepFiles: string[] = [];
  if (fs.existsSync(prepDir)) {
    try {
      prepFiles = fs.readdirSync(prepDir).filter((f) => f.endsWith(".md") && f !== "story-bank.md");
    } catch {}
  }

  return NextResponse.json({
    interviews,
    storyBank,
    prepFiles,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, company, role, question, answer, confidence, notes, date, round } = body;

    const root = careerOpsRoot();
    const prepDir = path.join(root, "interview-prep");
    if (!fs.existsSync(prepDir)) {
      fs.mkdirSync(prepDir, { recursive: true });
    }

    if (action === "debrief") {
      const cleanSlug = (company || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const slug = cleanSlug || "general";
      const debriefPath = path.join(prepDir, `${slug}-debrief.md`);

      const entry = `\n### Debrief: ${round || "Interview"} (${date || new Date().toISOString().slice(0, 10)})\n- **Role:** ${role || "N/A"}\n- **Confidence:** ${confidence || 3}/5\n- **Questions Asked:**\n${question ? `  - ${question}\n` : ""}- **My Response Summary:** ${answer || "N/A"}\n- **Notes & Next Steps:** ${notes || "None"}\n`;

      let current = "";
      if (fs.existsSync(debriefPath)) {
        current = fs.readFileSync(debriefPath, "utf8");
      } else {
        current = `# Interview Debrief: ${company}\n`;
      }
      current += entry;
      atomicWrite(debriefPath, current);

      return NextResponse.json({ success: true, file: `${slug}-debrief.md` });
    }

    if (action === "practice-feedback") {
      // Return structured STAR+R critique
      const answerLength = (answer || "").length;
      let starScore = "Strong";
      let suggestions = [
        "Ensure the Situation sets up clear business stakes (e.g. users, revenue, latency).",
        "Detail your specific Task vs the team's responsibility.",
        "Emphasize the Action choices and architectural trade-offs you evaluated.",
        "Quantify the Result (e.g., % improvement, dollar impact, time saved).",
      ];

      if (answerLength < 150) {
        starScore = "Needs Detail";
        suggestions.unshift("Your response is very concise. Add more concrete specifics on the actions you personally took.");
      }

      return NextResponse.json({
        feedback: {
          score: starScore,
          strengths: ["Clear core narrative", "Directly addresses prompt"],
          improvements: suggestions,
          followUpQuestion: `What would you do differently if you had to re-architect that solution today under 10x scale?`,
        },
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
