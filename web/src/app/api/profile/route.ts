import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { isMapping } from "@/lib/portals-config.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Merge-safe writer for config/profile.yml (a USER-LAYER file — DATA_CONTRACT:
// never clobber the user's archetypes/narrative/proof-points). On first create we
// seed from config/profile.example.yml; on an existing file we deep-merge ONLY the
// proposed keys, write atomically (temp + rename), and only ever via the confirm-
// gated setProfile action. The web orchestrates the real file — no parallel store.

type ProfilePatch = {
  name?: string;
  email?: string;
  location?: string;
  roles?: string[];
  compMin?: number;
  compMax?: number;
  currency?: string;
  remote?: string;
};

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Deep-merge src onto dst (objects recurse; arrays/scalars replace). Non-mutating. */
function deepMerge(dst: unknown, src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = isObj(dst) ? { ...dst } : {};
  for (const [k, v] of Object.entries(src)) {
    out[k] = isObj(v) ? deepMerge(out[k], v) : v;
  }
  return out;
}

function patchToProfile(p: ProfilePatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const candidate: Record<string, unknown> = {};
  if (p.name) candidate.full_name = p.name;
  if (p.email) candidate.email = p.email;
  if (p.location) candidate.location = p.location;
  if (Object.keys(candidate).length) out.candidate = candidate;
  if (p.roles?.length) out.target_roles = { primary: p.roles.slice(0, 6) };
  const comp: Record<string, unknown> = {};
  if (p.compMin && p.compMax) comp.target_range = `${p.compMin}-${p.compMax}`;
  if (p.currency) comp.currency = p.currency;
  if (p.remote) comp.location_flexibility = p.remote;
  if (Object.keys(comp).length) out.compensation = comp;
  // seniority intentionally not written (no canonical home in profile.yml);
  // archetypes/narrative live in modes/_profile.md — this writer never touches them.
  return out;
}

export async function GET() {
  const root = careerOpsRoot();
  const file = path.join(root, "config", "profile.yml");
  if (!fs.existsSync(file)) {
    return Response.json({ exists: false, profile: null });
  }
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = yaml.load(raw);
    return Response.json({ exists: true, profile: parsed });
  } catch (e) {
    return Response.json({ exists: true, error: "Failed to parse YAML" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const root = careerOpsRoot();
  const configDir = path.join(root, "config");
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  const file = path.join(configDir, "profile.yml");

  let base: Record<string, unknown> = {};
  if (!fs.existsSync(file)) {
    // First create: seed from the example so we never leave an empty profile.
    try {
      const seeded = yaml.load(fs.readFileSync(path.join(root, "config", "profile.example.yml"), "utf8"));
      base = isObj(seeded) ? (seeded as Record<string, unknown>) : {};
    } catch {
      base = {};
    }
  } else {
    // DATA-LOSS GUARD: a profile that EXISTS but cannot be
    // read/parsed must never be overwritten.
    let parsed: unknown;
    try {
      parsed = yaml.load(fs.readFileSync(file, "utf8"));
    } catch {
      return Response.json({ error: "config/profile.yml exists but could not be read as YAML — refusing to overwrite it." }, { status: 409 });
    }
    // A parseable list/scalar is still an invalid profile. Never replace its
    // contents with a document containing only the patch.
    if (!isMapping(parsed)) {
      return Response.json({ error: "config/profile.yml must contain named settings, not a list or single value. Refusing to overwrite it." }, { status: 409 });
    }
    base = parsed as Record<string, unknown>;
  }

  // Handle both raw full profile structure or flat ProfilePatch
  let proposed: Record<string, unknown> = {};
  if (body.candidate || body.target_roles || body.compensation || body.location || body.narrative) {
    proposed = body;
  } else {
    proposed = patchToProfile(body);
  }

  if (Object.keys(proposed).length === 0) return Response.json({ error: "nothing to write" }, { status: 400 });

  const merged = deepMerge(base, proposed);
  try {
    atomicWriteWithBackup(file, yaml.dump(merged, { lineWidth: 100, noRefs: true }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, profile: merged });
}
