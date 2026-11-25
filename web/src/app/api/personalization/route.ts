import { pathToFileURL } from "node:url";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { coercePersonalization, SECTIONS } from "@/lib/personalization.mjs";
import { readPersonalizationState, savePersonalization, UnsureProfileParseError } from "@/lib/personalization-file.mjs";
import { readJsonObject } from "@/lib/json-body";

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

// The template is a SYSTEM file and comes from the engine checkout
// (resolveCodeRoot), not from careerOpsRoot(): with the data in another folder
// there is no template there, and every section would compare as "filled".
// A file that cannot be read, or cannot be spliced with certainty, is an error
// here — never an empty string to merge onto.
const codeRoot = () => resolveCodeRoot(process.cwd(), process.env);

function failure(e: unknown): Response {
  if (e instanceof UnsureProfileParseError) return Response.json({ error: e.message, code: e.code }, { status: 409 });
  return Response.json({ error: e instanceof Error ? e.message : "personalization unavailable" }, { status: 500 });
}

async function corePersonalization() {
  return import(/* webpackIgnore: true */ pathToFileURL(rootScript("lib/personalization")).href);
}

export async function GET() {
  try {
    const core = await corePersonalization();
    return Response.json(readPersonalizationState(careerOpsRoot(), codeRoot(), core));
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  const body = await readJsonObject<Record<string, unknown>>(req);
  if (!body) return Response.json({ error: "bad json" }, { status: 400 });
  const patch = coercePersonalization(body) as Record<string, unknown>;
  if (Object.keys(patch).length === 0) return Response.json({ error: "nothing to write" }, { status: 400 });

  // dryRun: the panel/assistant can preview the exact bytes before the confirm
  // card is accepted — nothing touches disk.
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1" || body.dryRun === true;
  // DATA-LOSS GUARD (same class as /api/profile, #649/#704/#920/#958): a missing
  // file is seeded from the template; an existing one is merged, never replaced.
  try {
    const core = await corePersonalization();
    const { ids, merged } = savePersonalization({ dataRoot: careerOpsRoot(), codeRoot: codeRoot(), patch, dryRun, write: atomicWriteWithBackup, core });
    if (dryRun) return Response.json({ ok: true, dryRun: true, sections: ids, preview: merged });
    const labels = SECTIONS.filter((s) => ids.includes(s.id)).map((s) => s.heading.replace(/^## Your /, ""));
    return Response.json({ ok: true, sections: ids, labels });
  } catch (e) {
    return failure(e);
  }
}
