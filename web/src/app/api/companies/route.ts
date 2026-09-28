import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, readApplications, readInbox } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";

export type CompanyData = {
  name: string;
  slug: string;
  website?: string;
  stage?: string;
  totalFunding?: string;
  lastRound?: string;
  investors?: string[];
  openRolesCount: number;
  applicationCount: number;
  isBlacklisted: boolean;
  notes?: string;
  frictionScore?: number;
};

export async function GET() {
  const root = careerOpsRoot();
  const apps = readApplications();
  const inbox = readInbox();

  // Load funding.json
  let fundingMap: Record<string, any> = {};
  const fundingPath = path.join(root, "funding.json");
  if (fs.existsSync(fundingPath)) {
    try {
      fundingMap = JSON.parse(fs.readFileSync(fundingPath, "utf8"));
    } catch {}
  }

  // Load blacklist.md
  const blacklistPath = path.join(root, "data", "blacklist.md");
  const blacklisted = new Set<string>();
  if (fs.existsSync(blacklistPath)) {
    try {
      const blContent = fs.readFileSync(blacklistPath, "utf8");
      blContent.split("\n").forEach((l) => {
        const line = l.trim();
        if (line && !line.startsWith("#")) {
          blacklisted.add(line.toLowerCase());
        }
      });
    } catch {}
  }

  const companiesMap = new Map<string, CompanyData>();

  // Aggregate from applications
  for (const app of apps) {
    if (!app.company) continue;
    const name = app.company.trim();
    const key = name.toLowerCase();
    if (!companiesMap.has(key)) {
      companiesMap.set(key, {
        name,
        slug: key.replace(/[^a-z0-9]+/g, "-"),
        openRolesCount: 0,
        applicationCount: 1,
        isBlacklisted: blacklisted.has(key),
      });
    } else {
      const c = companiesMap.get(key)!;
      c.applicationCount += 1;
    }
  }

  // Aggregate from inbox
  for (const item of inbox) {
    if (!item.company) continue;
    const name = item.company.trim();
    const key = name.toLowerCase();
    if (!companiesMap.has(key)) {
      companiesMap.set(key, {
        name,
        slug: key.replace(/[^a-z0-9]+/g, "-"),
        openRolesCount: 1,
        applicationCount: 0,
        isBlacklisted: blacklisted.has(key),
      });
    } else {
      const c = companiesMap.get(key)!;
      c.openRolesCount += 1;
    }
  }

  // Enrich with funding data
  for (const [key, comp] of companiesMap.entries()) {
    const f = fundingMap[key] || fundingMap[comp.name];
    if (f) {
      comp.stage = f.stage;
      comp.totalFunding = f.total_funding || f.funding;
      comp.lastRound = f.last_round;
      comp.investors = f.investors;
      comp.website = f.website;
    }
  }

  return NextResponse.json({
    companies: Array.from(companiesMap.values()),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, company } = body;

    if (!company || typeof company !== "string" || !company.trim() || /[\r\n]/.test(company)) {
      return NextResponse.json({ error: "Company must be a non-empty single-line string" }, { status: 400 });
    }

    if (action !== "blacklist" && action !== "unblacklist") {
      return NextResponse.json({ error: "Action must be 'blacklist' or 'unblacklist'" }, { status: 400 });
    }

    const root = careerOpsRoot();
    const blacklistPath = path.join(root, "data", "blacklist.md");

    let current = "";
    if (fs.existsSync(blacklistPath)) {
      current = fs.readFileSync(blacklistPath, "utf8");
    } else {
      current = "# Do-not-apply company blacklist\n\n";
    }

    const lines = current.split("\n");
    const normalized = company.trim().toLowerCase();

    if (action === "blacklist") {
      if (!lines.some((l) => l.trim().toLowerCase() === normalized)) {
        current = current.trim() + `\n${company.trim()}\n`;
        atomicWrite(blacklistPath, current);
      }
    } else if (action === "unblacklist") {
      const filtered = lines.filter((l) => l.trim().toLowerCase() !== normalized);
      atomicWrite(blacklistPath, filtered.join("\n"));
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
