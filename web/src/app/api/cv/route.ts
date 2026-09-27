import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";

function cvPath() {
  return path.join(careerOpsRoot(), "cv.md");
}

const MAX_CV_BYTES = 200_000;

export async function GET() {
  try {
    return NextResponse.json({ content: fs.readFileSync(cvPath(), "utf8"), exists: true });
  } catch {
    return NextResponse.json({ content: "", exists: false });
  }
}

import * as yaml from "js-yaml";
import { parseCvTextToMarkdown } from "@/lib/cv/pdf-parser";
import { isMapping } from "@/lib/portals-config.mjs";

export async function POST(req: Request) {
  let body: { content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }
  if (Buffer.byteLength(body.content, "utf8") > MAX_CV_BYTES) {
    return NextResponse.json({ error: "CV is too large (over 200KB)" }, { status: 413 });
  }
  // DATA_CONTRACT: cv.md is user-layer and gitignored (no git recovery). Never
  // blind-overwrite — snapshot the prior CV to a .bak first, write atomically.
  try {
    const root = careerOpsRoot();
    const bak = atomicWriteWithBackup(cvPath(), body.content);

    // Sync parsed info into config/profile.yml
    const profileFilePath = path.join(root, "config", "profile.yml");
    let baseProfile: Record<string, any> = {};
    if (fs.existsSync(profileFilePath)) {
      try {
        const loaded = yaml.load(fs.readFileSync(profileFilePath, "utf8"));
        if (isMapping(loaded)) baseProfile = loaded as Record<string, any>;
      } catch {}
    }

    const parsed = parseCvTextToMarkdown(body.content);
    const candidate = baseProfile.candidate || {};
    if (parsed.candidate.fullName) candidate.full_name = parsed.candidate.fullName;
    if (parsed.candidate.title) candidate.title = parsed.candidate.title;
    if (parsed.candidate.email) candidate.email = parsed.candidate.email;
    if (parsed.candidate.phone) candidate.phone = parsed.candidate.phone;
    if (parsed.candidate.location) candidate.location = parsed.candidate.location;
    if (parsed.candidate.linkedin) candidate.linkedin = parsed.candidate.linkedin;
    if (parsed.candidate.github) candidate.github = parsed.candidate.github;
    if (parsed.candidate.portfolio) candidate.portfolio_url = parsed.candidate.portfolio;
    baseProfile.candidate = candidate;

    if (parsed.targetRoles.length > 0) {
      baseProfile.target_roles = {
        primary: parsed.targetRoles,
        archetypes: parsed.targetRoles.map((r) => ({
          name: r,
          level: "Senior",
          fit: "primary",
        })),
      };
    }

    const configDir = path.join(root, "config");
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    atomicWriteWithBackup(profileFilePath, yaml.dump(baseProfile, { lineWidth: 100, noRefs: true }));

    return NextResponse.json({ ok: true, backedUp: !!bak, profileUpdated: true });
  } catch {
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }
}
