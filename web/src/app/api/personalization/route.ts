import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { coercePersonalization, mergeSections, renderSection, sectionState, SECTIONS } from "@/lib/personalization.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Section-safe writer for modes/_profile.md (a USER-LAYER file — DATA_CONTRACT:
// this file is theirs and is never auto-updated). The web already owns a merge-
// safe writer for config/profile.yml (/api/profile) and portals.yml (/api/portals);
// this is the same idea for the fourth prerequisite: replace ONLY the bodies of
// the sections the confirm-gated setPersonalization action proposed, keep every
// other byte (other sections, the assistant's notes block, hand edits), write
// atomically with a .bak. Seeds from modes/_profile.template.md on first create.
// GET reports which sections are still the shipped template — the panel and the
// assistant's SETUP STATE both read that, so neither re-asks for filled ones.

// Reads are spelled inline with literal path segments (the same shape
// /api/profile uses) rather than through a helper taking a path parameter:
// Turbopack statically traces fs calls, and a non-literal argument makes it
// trace the whole project and warn at build time.
function readUserProfile(): string {
  try {
    return fs.readFileSync(path.join(careerOpsRoot(), "modes", "_profile.md"), "utf8");
  } catch {
    return "";
  }
}
function readTemplate(): string {
  try {
    return fs.readFileSync(path.join(careerOpsRoot(), "modes", "_profile.template.md"), "utf8");
  } catch {
    return "";
  }
}
function userProfileExists(): boolean {
  return fs.existsSync(path.join(careerOpsRoot(), "modes", "_profile.md"));
}

export async function GET() {
  const exists = userProfileExists();
  const sections = sectionState(exists ? readUserProfile() : "", readTemplate());
  return Response.json({ exists, sections });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const patch = coercePersonalization(body) as Record<string, unknown>;
  const ids = Object.keys(patch);
  if (ids.length === 0) return Response.json({ error: "nothing to write" }, { status: 400 });

  const file = path.join(careerOpsRoot(), "modes", "_profile.md");
  // DATA-LOSS GUARD (same class as /api/profile, #649/#704/#920/#958): a missing
  // file is seeded from the template; an existing one is merged, never replaced.
  const base = userProfileExists() ? readUserProfile() : readTemplate();
  const rendered: Record<string, string> = {};
  for (const id of ids) rendered[id] = renderSection(id, patch[id]);
  const merged = mergeSections(base, rendered);

  // dryRun: the panel/assistant can preview the exact bytes before the confirm
  // card is accepted — nothing touches disk.
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1" || body.dryRun === true;
  if (dryRun) return Response.json({ ok: true, dryRun: true, sections: ids, preview: merged });

  try {
    atomicWriteWithBackup(file, merged);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  const labels = SECTIONS.filter((s) => ids.includes(s.id)).map((s) => s.heading.replace(/^## Your /, ""));
  return Response.json({ ok: true, sections: ids, labels });
}
