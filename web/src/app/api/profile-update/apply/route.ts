import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { verifyApprovedProfileUpdate } from "@/lib/profile-updates.mjs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const root = careerOpsRoot(); const cvPath = path.join(root, "cv.md");
    const cv = fs.readFileSync(cvPath, "utf8");
    const result = verifyApprovedProfileUpdate(cv, body);
    atomicWriteWithBackup(cvPath, result.proposedCv);
    const auditPath = path.join(root, "data", "profile-updates.json");
    let history = [];
    try { const parsed = JSON.parse(fs.readFileSync(auditPath, "utf8")); if (Array.isArray(parsed)) history = parsed; } catch { /* first update */ }
    history.push({ timestamp: new Date().toISOString(), updateType: result.request.updateType, section: result.preview.section, description: result.description });
    let auditWarning = "";
    try { fs.mkdirSync(path.dirname(auditPath), { recursive: true }); fs.writeFileSync(auditPath, JSON.stringify(history, null, 2) + "\n", "utf8"); }
    catch { auditWarning = "Profile updated, but the local audit entry could not be written."; }
    return NextResponse.json({ ok: true, backedUp: true, auditWarning });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not apply profile update." }, { status: 400 });
  }
}
