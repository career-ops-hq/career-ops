import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot, readApplications } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";

export async function GET() {
  const root = careerOpsRoot();
  const apps = readApplications();

  const offers = apps.filter((a) =>
    a.status.toLowerCase().includes("offer") || a.status.toLowerCase().includes("accepted")
  );

  // Read salary observations
  const obsPath = path.join(root, "data", "salary-observations.tsv");
  const observations: Array<{ company: string; role: string; comp: string; date: string }> = [];
  if (fs.existsSync(obsPath)) {
    try {
      const content = fs.readFileSync(obsPath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split("\t");
        if (parts.length >= 3) {
          observations.push({
            date: parts[0]?.trim() || "",
            company: parts[1]?.trim() || "",
            role: parts[2]?.trim() || "",
            comp: parts[3]?.trim() || "",
          });
        }
      }
    } catch {}
  }

  // Read target compensation from profile.yml
  let targetComp = "$160,000 - $200,000";
  const profileYmlPath = path.join(root, "config", "profile.yml");
  if (fs.existsSync(profileYmlPath)) {
    try {
      const parsed = yaml.load(fs.readFileSync(profileYmlPath, "utf8")) as any;
      if (parsed?.targeting?.compensation?.target || parsed?.compensation?.target) {
        targetComp = String(parsed?.targeting?.compensation?.target || parsed?.compensation?.target);
      }
    } catch {}
  }

  return NextResponse.json({
    offers,
    observations,
    targetComp,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, company, role, baseComp, bonus, equity, notes } = body;

    const root = careerOpsRoot();
    const obsPath = path.join(root, "data", "salary-observations.tsv");

    if (action === "record") {
      let current = "";
      if (fs.existsSync(obsPath)) {
        current = fs.readFileSync(obsPath, "utf8");
      } else {
        current = "Date\tCompany\tRole\tCompensation\tNotes\n";
      }

      const today = new Date().toISOString().slice(0, 10);
      const total = [baseComp ? `Base: ${baseComp}` : "", bonus ? `Bonus: ${bonus}` : "", equity ? `Equity: ${equity}` : ""].filter(Boolean).join(", ");
      const row = `${today}\t${company}\t${role || ""}\t${total}\t${notes || ""}\n`;
      current += row;

      atomicWrite(obsPath, current);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
