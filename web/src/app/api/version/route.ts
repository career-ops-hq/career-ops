import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// The WEB build's own version + channel (NOT the user's data checkout) — read from
// the repo's VERSION (parent of the web/ cwd). The channel is derived from a
// pre-release suffix (`-rc`/`-beta`) so the UI can show a beta banner + the bug
// reporter can tag the right release. Invisible to stable installs (the updater
// reads VERSION from `main`, which stays stable while the bundle lives on a branch).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readVersion(): string {
  const candidates = [path.join(process.cwd(), "..", "VERSION"), path.join(process.cwd(), "VERSION")];
  for (const p of candidates) {
    try {
      const v = fs.readFileSync(p, "utf8").split(/\s+/)[0].trim();
      if (v) return v;
    } catch {
      /* next candidate */
    }
  }
  return "";
}

function shortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: process.cwd(), stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

function webVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "";
  } catch {
    return "";
  }
}

export async function GET() {
  const coreVersion = readVersion();
  const web = webVersion();
  const m = coreVersion.match(/-(rc|beta|alpha|next)\b/i);
  // Channel precedence: an explicit core pre-release suffix wins (RC installs);
  // otherwise the web component's own maturity decides — pre-1.0 on main IS the
  // alpha (release-please versions web/ independently), and the banner/bug-report
  // stay visible until the web graduates to 1.0.
  const channel = m ? m[1].toLowerCase() : web && /^0\./.test(web) ? "alpha" : "stable";
  const version = web ? `web ${web}` : coreVersion;
  return Response.json({ version, coreVersion, channel, sha: shortSha() });
}
