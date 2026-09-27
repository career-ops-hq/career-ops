import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot, readApplications } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";

export async function GET() {
  const root = careerOpsRoot();
  const apps = readApplications();

  const offers = apps.filter((a) => {
    const s = (a.status || "").toLowerCase();
    return s.includes("offer") || s.includes("accepted") || s.includes("negotiat") || s.includes("counter");
  });

  // Read salary observations
  const obsPath = path.join(root, "data", "salary-observations.tsv");
  const observations: Array<{ id: number; company: string; role: string; comp: string; date: string; notes: string }> = [];
  if (fs.existsSync(obsPath)) {
    try {
      const content = fs.readFileSync(obsPath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split("\t");
        if (parts.length >= 2) {
          observations.push({
            id: i,
            date: parts[0]?.trim() || "",
            company: parts[1]?.trim() || "",
            role: parts[2]?.trim() || "",
            comp: parts[3]?.trim() || "",
            notes: parts[4]?.trim() || "",
          });
        }
      }
    } catch {}
  }

  // Read target compensation from profile.yml
  let targetComp = "$160,000 - $200,000";
  let currency = "USD";
  let minComp = 160000;
  let maxComp = 200000;

  const profileYmlPath = path.join(root, "config", "profile.yml");
  if (fs.existsSync(profileYmlPath)) {
    try {
      const parsed = yaml.load(fs.readFileSync(profileYmlPath, "utf8")) as any;
      const comp = parsed?.compensation || parsed?.targeting?.compensation;
      if (comp) {
        if (comp.target_range) targetComp = String(comp.target_range);
        else if (comp.target) targetComp = String(comp.target);
        if (comp.currency) currency = String(comp.currency);

        const nums = String(targetComp).match(/\d[\d,.]*/g);
        if (nums && nums.length >= 2) {
          const clean1 = Number(nums[0].replace(/,/g, ""));
          const clean2 = Number(nums[1].replace(/,/g, ""));
          if (!isNaN(clean1)) minComp = clean1 < 1000 ? clean1 * 1000 : clean1;
          if (!isNaN(clean2)) maxComp = clean2 < 1000 ? clean2 * 1000 : clean2;
        } else if (nums && nums.length === 1) {
          const clean = Number(nums[0].replace(/,/g, ""));
          if (!isNaN(clean)) {
            minComp = clean < 1000 ? clean * 1000 : clean;
            maxComp = minComp * 1.2;
          }
        }
      }
    } catch {}
  }

  return NextResponse.json({
    offers,
    allApps: apps,
    observations,
    targetComp,
    currency,
    minComp,
    maxComp,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, company, role, baseComp, bonus, equity, signing, notes, id } = body;

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
      const total = [
        baseComp ? `Base: ${baseComp}` : "",
        bonus ? `Bonus: ${bonus}` : "",
        equity ? `Equity: ${equity}` : "",
        signing ? `Signing: ${signing}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      const row = `${today}\t${company}\t${role || ""}\t${total}\t${notes || ""}\n`;
      current += row;

      atomicWrite(obsPath, current);
      return NextResponse.json({ success: true });
    }

    if (action === "delete" && typeof id === "number") {
      if (fs.existsSync(obsPath)) {
        const content = fs.readFileSync(obsPath, "utf8");
        const lines = content.split("\n").filter((l) => l.trim().length > 0);
        if (id >= 1 && id < lines.length) {
          lines.splice(id, 1);
          const newContent = lines.join("\n") + "\n";
          atomicWrite(obsPath, newContent);
          return NextResponse.json({ success: true });
        }
      }
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

