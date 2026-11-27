import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { normalizeChosenPageFormat, readPageFormatSetting } from "@/lib/core/page-format.mjs";
import { getProfilePath } from "@/lib/core/profile-path.mjs";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { readJsonObject } from "@/lib/json-body";
import { DEFAULT_PAGE_FORMAT, PAGE_FORMATS } from "@/lib/page-formats.mjs";
import { isMapping } from "@/lib/portals-config.mjs";
import { firstProfileText, patchTopLevelKey } from "@/lib/profile-yaml-edit.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The paper size lives in config/profile.yml → page_format (a USER-LAYER file),
// the SAME key the core's lib/page-format.mjs reads, so setting it here changes
// what the CLI renders too. The core owns what counts as a size: reads and the
// validation of a write both go through core/page-format.mjs, never a copy of
// its rules. A write sets or removes only this key, line-edits the file so its
// comments survive, is atomic, and follows the /api/profile guards for a
// malformed or non-mapping profile.
const KEY = "page_format";

export async function GET() {
  const codeRoot = resolveCodeRoot(process.cwd(), process.env);
  // `auto` is the profile's own stance, not a size: it is reported as such so the
  // control can show it instead of presenting it as no preference.
  const { setting } = await readPageFormatSetting(codeRoot, getProfilePath(careerOpsRoot()));
  return Response.json({
    formats: [...PAGE_FORMATS],
    default: DEFAULT_PAGE_FORMAT,
    override: setting,
  });
}

export async function POST(req: Request) {
  const body = await readJsonObject(req);
  if (!body) return Response.json({ error: "bad json" }, { status: 400 });
  if (!(KEY in body)) return Response.json({ error: `${KEY} is required` }, { status: 400 });

  // `null` removes the key, so the renderers fall back to the project default.
  const codeRoot = resolveCodeRoot(process.cwd(), process.env);
  const raw = body[KEY];
  let chosen: "a4" | "letter" | null = null;
  if (raw !== null) {
    try {
      chosen = await normalizeChosenPageFormat(codeRoot, raw);
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "page format rules unavailable" }, { status: 500 });
    }
    if (!chosen) {
      return Response.json({ error: `${KEY} must be one of: ${[...PAGE_FORMATS].join(", ")}` }, { status: 400 });
    }
  }

  const root = careerOpsRoot();
  const file = getProfilePath(root);
  let base: Record<string, unknown> = {};
  let source = "";
  // No preference and no profile: nothing to remove, so no template is needed.
  if (!chosen && !fs.existsSync(file)) return Response.json({ ok: true, override: null });
  if (!fs.existsSync(file)) {
    // First create: seed from the example so we never leave a one-key profile.
    // Without a usable template there is nothing to seed from, so write nothing.
    let seeded: unknown;
    try {
      source = firstProfileText(fs.readFileSync(path.join(codeRoot, "config", "profile.example.yml"), "utf8"));
      seeded = yaml.load(source);
    } catch {
      seeded = undefined;
    }
    if (!isMapping(seeded)) {
      return Response.json({ error: "config/profile.example.yml could not be read as a profile, so no profile was created." }, { status: 500 });
    }
    base = seeded as Record<string, unknown>;
  } else {
    // DATA-LOSS GUARD (mirrors /api/profile): a profile that EXISTS but cannot be
    // read or parsed must never be overwritten with a one-key file.
    let parsed: unknown;
    try {
      source = fs.readFileSync(file, "utf8");
      parsed = yaml.load(source);
    } catch {
      return Response.json({ error: "config/profile.yml exists but is not valid YAML. Refusing to overwrite it." }, { status: 409 });
    }
    if (!isMapping(parsed)) {
      return Response.json({ error: "config/profile.yml must contain named settings, not a list or single value. Refusing to overwrite it." }, { status: 409 });
    }
    base = parsed as Record<string, unknown>;
  }

  // No preference, and none stated: nothing to remove, so nothing to write.
  if (!chosen && !(KEY in base)) return Response.json({ ok: true, override: null });

  const merged: Record<string, unknown> = { ...base };
  if (chosen) merged[KEY] = chosen;
  else delete merged[KEY];

  try {
    // Edit only the page_format line so the profile keeps its comments (#5662).
    // A shape the line edit cannot place falls back to yaml.dump; the backup
    // holds the prior bytes either way.
    const text = patchTopLevelKey(source, KEY, chosen ?? undefined, merged) ?? yaml.dump(merged, { lineWidth: 100, noRefs: true });
    atomicWriteWithBackup(file, text);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, override: chosen });
}
