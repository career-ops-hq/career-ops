import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { CADENCE_DEFAULTS, PROFILE_CADENCE_KEYS, type ProfileCadenceKey } from "@/lib/followups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The follow-up cadence knobs live in config/profile.yml → followup_cadence
// (a USER-LAYER file) — the SAME keys the core followup-cadence.mjs reads, so
// tuning them here changes the CLI's verdict too. Reads are live; writes are
// merge-safe + atomic and never clobber the rest of the profile (mirrors the
// /api/profile guards for the malformed-YAML and first-create cases).

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export async function GET() {
  const file = path.join(careerOpsRoot(), "config", "profile.yml");
  const overrides: Partial<Record<ProfileCadenceKey, number>> = {};
  if (fs.existsSync(file)) {
    let profile: Record<string, unknown> = {};
    try {
      const parsed = yaml.load(fs.readFileSync(file, "utf8"));
      profile = isObj(parsed) ? parsed : {};
    } catch {
      /* unreadable/malformed → show defaults (read is best-effort) */
    }
    const source = isObj(profile.followup_cadence) ? profile.followup_cadence : {};
    for (const key of PROFILE_CADENCE_KEYS) {
      const n = Number.parseInt(String(source[key]), 10);
      if (Number.isFinite(n) && n >= 0) overrides[key] = n;
    }
  }
  const effective = { ...CADENCE_DEFAULTS, ...overrides };
  return Response.json({ defaults: CADENCE_DEFAULTS, overrides, effective });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const cadence: Record<string, number> = {};
  for (const key of PROFILE_CADENCE_KEYS) {
    if (body[key] == null) continue;
    const n = Number.parseInt(String(body[key]), 10);
    if (!Number.isInteger(n) || n < 0) {
      return Response.json({ error: `${key} must be a non-negative integer` }, { status: 400 });
    }
    cadence[key] = n;
  }
  if (Object.keys(cadence).length === 0) return Response.json({ error: "nothing to write" }, { status: 400 });

  const root = careerOpsRoot();
  const file = path.join(root, "config", "profile.yml");
  let base: Record<string, unknown> = {};
  if (!fs.existsSync(file)) {
    // First create: seed from the example so we never leave a cadence-only profile.
    try {
      const seeded = yaml.load(fs.readFileSync(path.join(root, "config", "profile.example.yml"), "utf8"));
      base = isObj(seeded) ? seeded : {};
    } catch {
      base = {};
    }
  } else {
    // DATA-LOSS GUARD (mirrors /api/profile): a profile that EXISTS but cannot be
    // read/parsed must never be overwritten with a cadence-only file.
    let parsed: unknown;
    try {
      parsed = yaml.load(fs.readFileSync(file, "utf8"));
    } catch {
      return Response.json({ error: "config/profile.yml exists but could not be read as YAML — refusing to overwrite it." }, { status: 409 });
    }
    base = isObj(parsed) ? parsed : {};
  }

  const merged = {
    ...base,
    followup_cadence: { ...(isObj(base.followup_cadence) ? base.followup_cadence : {}), ...cadence },
  };
  try {
    atomicWriteWithBackup(file, yaml.dump(merged, { lineWidth: 100, noRefs: true }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, followup_cadence: merged.followup_cadence });
}
