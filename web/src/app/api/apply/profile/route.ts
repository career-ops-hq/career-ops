import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { profileConfig, profileExists, persistentContext, closePersistentContext, showProfileWindow } from "@/lib/apply/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Manage the opt-in signed-in browser profile used by the apply flow.
//
// GET   → whether it is enabled, where it lives, whether it has been set up
// POST {action:"enable"|"disable"} → flip apply.signed_in_profile in profile.yml
// POST {action:"open"}  → opens that profile in a real, on-screen window so the
//                         user can sign in to LinkedIn (or anywhere else) THEMSELVES
// POST {action:"close"} → closes it, persisting the session to disk
//
// career-ops never sees, types, or stores a password. This route only opens a
// browser window; every keystroke in it is the user's own.
//
// Enabling grants nothing on its own: the profile directory starts empty, and it
// only ever holds what the user deliberately signs into. The meaningful consent
// moment is the sign-in, not the toggle, which is why the toggle is allowed here
// rather than forced to be a hand edit.

/** Where the sign-in window lands. Fixed allowlist: an attacker-supplied URL here
 *  would be a phishing page opened in the user's genuinely-signed-in browser. */
const SIGN_IN_TARGETS: Record<string, string> = {
  linkedin: "https://www.linkedin.com/login",
};

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Flip `apply.signed_in_profile` without disturbing the rest of the profile.
 *
 * Same data-loss guard as /api/followups/cadence: a profile.yml that EXISTS but
 * cannot be parsed is never overwritten, because doing so would replace the
 * user's targeting, comp and narrative with a one-key file.
 */
function setSignedInProfile(value: boolean): void {
  const file = path.join(careerOpsRoot(), "config", "profile.yml");
  let base: Record<string, unknown> = {};
  let header = "";
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, "utf8");
    let parsed: unknown;
    try {
      parsed = yaml.load(raw);
    } catch {
      throw new Error("config/profile.yml exists but could not be read as YAML, so it was left untouched.");
    }
    base = isObj(parsed) ? parsed : {};
    // yaml.dump drops every comment. Carrying the leading comment block across
    // keeps the file's own title//explanation, which is the part a user actually
    // reads when they open it. Comments further down are still lost, so this
    // stays a targeted mitigation rather than a claim of full fidelity.
    const lead: string[] = [];
    for (const line of raw.split("\n")) {
      if (/^\s*#/.test(line) || line.trim() === "") lead.push(line);
      else break;
    }
    if (lead.some((l) => l.trim())) header = `${lead.join("\n").replace(/\s+$/, "")}\n`;
  }
  const apply = isObj(base.apply) ? base.apply : {};
  const merged = { ...base, apply: { ...apply, signed_in_profile: value } };
  atomicWriteWithBackup(file, header + yaml.dump(merged, { lineWidth: 100, noRefs: true }));
}

export async function GET() {
  const { enabled, dir, dirRejected } = profileConfig();
  return Response.json({ enabled, dir, exists: profileExists(dir), dirRejected });
}

export async function POST(req: Request) {
  let body: { action?: string; target?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const { enabled, dir, dirRejected } = profileConfig();

  if (body.action === "close") {
    await closePersistentContext();
    return Response.json({ ok: true, exists: profileExists(dir) });
  }

  if (body.action === "enable" || body.action === "disable") {
    const want = body.action === "enable";
    try {
      setSignedInProfile(want);
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
    }
    // Turning it off should not leave the profile browser running with a live
    // session attached to a feature the user just disabled.
    if (!want) await closePersistentContext();
    return Response.json({ ok: true, enabled: want, dir, exists: profileExists(dir), dirRejected });
  }

  if (body.action !== "open") {
    return Response.json({ error: "action must be 'enable', 'disable', 'open' or 'close'" }, { status: 400 });
  }

  if (!enabled) {
    return Response.json(
      {
        error:
          "The signed-in browser profile is off. Turn it on first, then try again.",
      },
      { status: 409 },
    );
  }

  const target = SIGN_IN_TARGETS[String(body.target ?? "linkedin")];
  if (!target) return Response.json({ error: "unknown sign-in target" }, { status: 400 });

  try {
    const ctx = await persistentContext(true);
    // Reuse the profile's existing tab when it has one, so repeated clicks do not
    // pile up windows the user then has to close by hand.
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    // The context may already be running off-screen from an apply session, so the
    // window has to be moved, not merely focused.
    await showProfileWindow(page);
    return Response.json({ ok: true, dir, opened: target });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message.slice(0, 200) : "could not open the profile" }, { status: 500 });
  }
}
