import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { cliChildEnv } from "@/lib/cli-spawn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const STATUS: Record<string, "live" | "empty" | "broken" | "skipped"> = {
  "✅": "live",
  "🟡": "empty",
  "❌": "broken",
  "➖": "skipped",
};

/**
 * Parse one verify-portals.mjs result line. Company names may contain " — "
 * (e.g. "Apify — LinkedIn …"), so we cannot split on the first em-dash.
 */
function parseVerifyLine(line: string): { name: string; status: string; detail: string } | null {
  const m = line.match(/^\s*(✅|🟡|❌|➖)\s+(.*)$/);
  if (!m) return null;
  const status = STATUS[m[1]] ?? "unknown";
  const parts = m[2].split(" — ");
  if (parts.length < 2) return null;

  const last = parts[parts.length - 1]!;
  const looksLikeDetail =
    last.startsWith("no provider") ||
    /^\w[\w-]*\//.test(last) ||
    last.startsWith("?/") ||
    /\([^)]*live/i.test(last);

  let name: string;
  let detail: string;
  if (looksLikeDetail) {
    name = parts.slice(0, -1).join(" — ");
    detail = last;
  } else if (parts.length >= 3) {
    name = parts[0]!;
    detail = parts.slice(1).join(" — ");
  } else {
    name = parts[0]!;
    detail = parts.slice(1).join(" — ");
  }
  return { name, status, detail };
}

// Orchestrates the core's verify-portals.mjs (#1016) — the SAME ATS-slug
// validator the CLI uses. Catches the silent 404s that quietly drop a company
// from every future scan (= lost offers).
export async function GET() {
  const root = careerOpsRoot();
  const verifyPortals = rootScript("verify-portals");
  if (!fs.existsSync(verifyPortals)) {
    return Response.json({ available: false, configured: false, companies: [] });
  }
  if (!fs.existsSync(path.join(root, "portals.yml"))) {
    return Response.json({ available: true, configured: false, companies: [] });
  }

  const stdout = await new Promise<string>((resolve) => {
    execFile(
      "node",
      [verifyPortals],
      { cwd: root, env: cliChildEnv("node", root), timeout: 110_000, maxBuffer: 4 * 1024 * 1024 },
      (_e, out, err) => resolve((out || "") + (err || "")),
    );
  });

  const companies: { id: string; name: string; status: string; detail: string }[] = [];
  for (const line of stdout.split("\n")) {
    const row = parseVerifyLine(line);
    if (!row) continue;
    companies.push({ id: `${row.name}::${row.detail}`, ...row });
  }
  return Response.json({ available: true, configured: true, companies });
}
