import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { parsePdfBuffer, parseCvTextToMarkdown } from "@/lib/cv/pdf-parser";
import { isMapping } from "@/lib/portals-config.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name.toLowerCase();

    let parsed;
    if (fileName.endsWith(".pdf")) {
      parsed = await parsePdfBuffer(buffer);
    } else {
      const text = buffer.toString("utf8");
      parsed = parseCvTextToMarkdown(text);
    }

    const root = careerOpsRoot();
    const cvFilePath = path.join(root, "cv.md");
    const profileFilePath = path.join(root, "config", "profile.yml");

    // 1. Write cv.md atomically
    atomicWriteWithBackup(cvFilePath, parsed.markdown);

    // 2. Update config/profile.yml atomically
    let baseProfile: Record<string, any> = {};
    if (fs.existsSync(profileFilePath)) {
      try {
        const loaded = yaml.load(fs.readFileSync(profileFilePath, "utf8"));
        if (isMapping(loaded)) {
          baseProfile = loaded as Record<string, any>;
        }
      } catch {}
    }

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

    if (!baseProfile.compensation) {
      baseProfile.compensation = {
        target_range: "$150K-$190K",
        currency: "USD",
        minimum: "$130K",
        location_flexibility: "Remote preferred",
      };
    }

    // Ensure config directory exists
    const configDir = path.join(root, "config");
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    atomicWriteWithBackup(profileFilePath, yaml.dump(baseProfile, { lineWidth: 100, noRefs: true }));

    return NextResponse.json({
      ok: true,
      markdown: parsed.markdown,
      candidate: parsed.candidate,
      targetRoles: parsed.targetRoles,
      seed: {
        title: parsed.candidate.title,
        roles: parsed.targetRoles,
        location: parsed.candidate.location,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to process CV upload" },
      { status: 500 }
    );
  }
}
