import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { getProfilePath } from "@/lib/core/profile-path.mjs";
import { isMapping } from "@/lib/portals-config.mjs";
import { patchProfileText } from "@/lib/profile-yaml-edit.mjs";
import { PROFILE_CADENCE_KEYS, type ProfileCadenceKey } from "@/lib/followups";
import { readJsonObject } from "@/lib/json-body";
import { followupsEnabledFromProfile } from "@/lib/followups-setting.mjs";

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

/** Short id of the profile bytes the form loaded. A later save sends it back
 *  so a second tab cannot write a stale snapshot over a save that already landed. */
function textRevision(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Revision for "config/profile.yml does not exist yet". Two tabs that both
 *  load before the first save get this value, so the second save is refused
 *  once the first one creates the file. A hash is hex, so it never equals this. */
const ABSENT_REVISION = "absent";

/**
 * PURE defaults, read from the core rather than copied (#2369).
 *
 * `followup-cadence.mjs --json` emits `cadenceDefaults` (DEFAULT_CADENCE) next
 * to `cadenceConfig` (defaults + the user's profile overrides). The form needs
 * the PURE defaults for its placeholders: sourcing them from `cadenceConfig`
 * would render a user's own override as the default they'd be reverting to.
 *
 * Core keys carry no `_days` suffix (`applied_first`); the profile/web keys do
 * (`applied_first_days`), except `applied_max_followups`. That mapping is the
 * only translation here — no values are restated.
 *
 * Returns null when the core is missing or unparseable. Deliberately NOT a
 * hardcoded fallback table: a fallback copy is the same copy in disguise, and
 * that is exactly how states.ts's FALLBACK drifted (#2282).
 */
async function readCoreDefaults(): Promise<Partial<Record<ProfileCadenceKey, number>> | null> {
  const script = rootScript("followup-cadence");
  if (!fs.existsSync(script)) return null;
  const stdout = await new Promise<string>((resolve) => {
    // process.execPath + windowsHide: see api/doctor/route.ts — a stale inherited
    // console kills every child with 0xC0000142 on Windows; never inherit one.
    execFile(process.execPath, [script, "--json"], { cwd: careerOpsRoot(), timeout: 12_000, windowsHide: true }, (_e, out) =>
      resolve(out || ""),
    );
  });
  try {
    const start = stdout.indexOf("{");
    if (start === -1) return null;
    const parsed = JSON.parse(stdout.slice(start)) as { cadenceDefaults?: unknown };
    if (!isObj(parsed.cadenceDefaults)) return null;
    const core = parsed.cadenceDefaults;
    // ALL-OR-NOTHING, and no coercion. Number.parseInt would accept "3.5" as 3
    // and "7days" as 7, and a per-key filter would report defaultsAvailable:
    // true off a single valid key — either way the form would show a baseline
    // the core never emitted. A partial or coerced contract is exactly the
    // silent-wrong-value this whole derivation exists to remove, so a
    // malformed payload degrades to "no defaults" instead.
    const out: Partial<Record<ProfileCadenceKey, number>> = {};
    for (const key of PROFILE_CADENCE_KEYS) {
      const coreKey = key === "applied_max_followups" ? key : key.replace(/_days$/, "");
      const raw = core[coreKey];
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) return null;
      out[key] = raw;
    }
    return out;
  } catch {
    return null;
  }
}

export async function GET() {
  const file = getProfilePath(careerOpsRoot());
  const overrides: Partial<Record<ProfileCadenceKey, number>> = {};
  let enabled = true;
  let revision: string | null = ABSENT_REVISION;
  let raw: string | undefined;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
    // A missing profile is the first-run case. Any other read error must not
    // look like defaults, or the form saves those defaults with no revision
    // once the file can be read again.
    if (code !== "ENOENT") {
      return Response.json({ error: "config/profile.yml could not be read." }, { status: 500 });
    }
  }
  if (raw !== undefined) {
    revision = textRevision(raw);
    let profile: Record<string, unknown> = {};
    try {
      const parsed = yaml.load(raw);
      profile = isObj(parsed) ? parsed : {};
    } catch {
      profile = {};
    }
    enabled = followupsEnabledFromProfile(profile);
    const source = isObj(profile.followup_cadence) ? profile.followup_cadence : {};
    for (const key of PROFILE_CADENCE_KEYS) {
      const n = Number.parseInt(String(source[key]), 10);
      if (Number.isFinite(n) && n >= 0) overrides[key] = n;
    }
  }
  const defaults = await readCoreDefaults();
  // `defaultsAvailable: false` tells the form to render its placeholders as
  // unknown rather than inventing a number — an honest gap beats a stale copy.
  const effective = { ...(defaults ?? {}), ...overrides };
  return Response.json({ defaults: defaults ?? {}, defaultsAvailable: defaults !== null, overrides, effective, enabled, revision });
}

export async function POST(req: Request) {
  const body = await readJsonObject<Record<string, unknown>>(req);
  if (!body) return Response.json({ error: "bad json" }, { status: 400 });

  const cadence: Record<string, number> = {};
  for (const key of PROFILE_CADENCE_KEYS) {
    if (body[key] == null) continue;
    const n = Number.parseInt(String(body[key]), 10);
    if (!Number.isInteger(n) || n < 0) {
      return Response.json({ error: `${key} must be a non-negative integer` }, { status: 400 });
    }
    cadence[key] = n;
  }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    return Response.json({ error: "enabled must be true or false" }, { status: 400 });
  }
  const enabled = body.enabled as boolean | undefined;
  if (Object.keys(cadence).length === 0 && enabled === undefined) {
    return Response.json({ error: "nothing to write" }, { status: 400 });
  }

  const root = careerOpsRoot();
  const file = getProfilePath(root);
  let base: Record<string, unknown> = {};
  let source = "";
  let currentRevision: string | null = null;
  if (!fs.existsSync(file)) {
    currentRevision = ABSENT_REVISION;
    // First create: seed from the example so we never leave a cadence-only profile.
    try {
      source = fs.readFileSync(path.join(root, "config", "profile.example.yml"), "utf8");
      const seeded = yaml.load(source);
      base = isObj(seeded) ? seeded : {};
    } catch {
      source = "";
      base = {};
    }
  } else {
    // DATA-LOSS GUARD (mirrors /api/profile): a profile that EXISTS but cannot be
    // read/parsed must never be overwritten with a cadence-only file.
    let parsed: unknown;
    try {
      source = fs.readFileSync(file, "utf8");
      currentRevision = textRevision(source);
      parsed = yaml.load(source);
    } catch {
      return Response.json({ error: "config/profile.yml exists but could not be read as YAML — refusing to overwrite it." }, { status: 409 });
    }
    // A parseable list/scalar is still an invalid profile. Never replace its
    // contents with a document containing only the cadence patch.
    if (!isMapping(parsed)) {
      return Response.json({ error: "config/profile.yml must contain named settings, not a list or single value. Refusing to overwrite it." }, { status: 409 });
    }
    base = parsed as Record<string, unknown>;
  }

  // Optional. Clients that omit it keep the old merge. Clients that send the
  // revision from GET are refused when another save changed the file first.
  if (typeof body.revision === "string" && body.revision !== currentRevision) {
    return Response.json({
      error: "These cadence settings changed in another tab. The saved values were kept.",
      revision: currentRevision,
    }, { status: 409 });
  }

  const merged: Record<string, unknown> = { ...base };
  const patch: Parameters<typeof patchProfileText>[1] = {};
  if (Object.keys(cadence).length > 0) {
    merged.followup_cadence = { ...(isObj(base.followup_cadence) ? base.followup_cadence : {}), ...cadence };
    patch.followup_cadence = cadence;
  }
  if (enabled !== undefined) {
    merged.follow_ups = { ...(isObj(base.follow_ups) ? base.follow_ups : {}), enabled };
    patch.follow_ups = { enabled };
  }
  let text: string;
  try {
    // Edit only the cadence lines so the rest of the profile, comments
    // included, stays as the user wrote it (#5662). A shape the line edit
    // cannot place falls back to yaml.dump; the backup holds the prior bytes.
    text = patchProfileText(source, patch, merged) ?? yaml.dump(merged, { lineWidth: 100, noRefs: true });
    atomicWriteWithBackup(file, text);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({
    ok: true,
    revision: textRevision(text),
    followup_cadence: merged.followup_cadence,
    follow_ups: merged.follow_ups,
  });
}
