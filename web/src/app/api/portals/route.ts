import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Merge-safe writer for portals.yml's title_filter (a USER-LAYER file). Replaces
// ONLY title_filter.positive (the role keywords the free scanner matches), seeding
// from templates/portals.example.yml on first create, and PRESERVING tracked_companies
// + every other block. Atomic write, confirm-gated (setProfile/setPortals). This is
// what loads the very first home scan once the user confirms their target roles.
//
// location_filter mirrors the same merge-only discipline: `allow` replaces the
// scanner's default US/Europe search terms, `block`/`always_allow` are read by
// the CLI's own location-filtering logic (always_allow overrides a block, e.g.
// "block US but always allow my specific city"). None of the three is required —
// a Settings save can touch just roles, just location, or both.

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function loadDoc(root: string): Record<string, unknown> {
  const file = path.join(root, "portals.yml");
  try {
    return (yaml.load(fs.readFileSync(file, "utf8")) as Record<string, unknown>) || {};
  } catch {
    try {
      return (yaml.load(fs.readFileSync(path.join(root, "templates", "portals.example.yml"), "utf8")) as Record<string, unknown>) || {};
    } catch {
      return {};
    }
  }
}

// GET is read-only, for Settings' Location & Region section to show back
// whatever's currently saved (LocationSettings has nowhere else to read it from).
export async function GET() {
  const doc = loadDoc(careerOpsRoot());
  const lf = isObj(doc.location_filter) ? doc.location_filter : {};
  const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  return Response.json({
    location: asStrings(lf.allow),
    block: asStrings(lf.block),
    always_allow: asStrings(lf.always_allow),
  });
}

export async function POST(req: Request) {
  let body: { roles?: string[]; location?: string[]; block?: string[]; always_allow?: string[] };
  try {
    body = (await req.json()) as { roles?: string[]; location?: string[]; block?: string[]; always_allow?: string[] };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const roles = (Array.isArray(body.roles) ? body.roles : []).map((r) => String(r).trim()).filter(Boolean).slice(0, 24);
  const clean = (arr?: string[]) => (Array.isArray(arr) ? arr : []).map((v) => String(v).trim()).filter(Boolean);
  const location = clean(body.location);
  const block = clean(body.block);
  const alwaysAllow = clean(body.always_allow);
  // At least ONE of roles/location/block/always_allow must be present — an
  // empty body is the only thing rejected, not "roles specifically".
  if (roles.length === 0 && location.length === 0 && block.length === 0 && alwaysAllow.length === 0) {
    return Response.json({ error: "nothing to save" }, { status: 400 });
  }

  const root = careerOpsRoot();
  const file = path.join(root, "portals.yml");
  const doc = loadDoc(root);

  if (roles.length > 0) {
    const tf = isObj(doc.title_filter) ? { ...doc.title_filter } : {};
    tf.positive = roles; // replace ONLY the positive keywords; keep negative/etc.
    doc.title_filter = tf;
  }
  if (Array.isArray(body.location) || Array.isArray(body.block) || Array.isArray(body.always_allow)) {
    const lf = isObj(doc.location_filter) ? { ...doc.location_filter } : {};
    // Each field replaces independently — a save that only touches `block`
    // (array present, even if now empty) must not silently wipe `allow`.
    if (Array.isArray(body.location)) lf.allow = location;
    if (Array.isArray(body.block)) lf.block = block;
    if (Array.isArray(body.always_allow)) lf.always_allow = alwaysAllow;
    doc.location_filter = lf;
  }

  try {
    atomicWriteWithBackup(file, yaml.dump(doc, { lineWidth: 100, noRefs: true }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, roles: roles.length });
}
