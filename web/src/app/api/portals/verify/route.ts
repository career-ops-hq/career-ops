import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { cliChildEnv } from "@/lib/cli-spawn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// verify-portals.mjs probes every entry sequentially (gentle on rate limits), so
// a large portals.yml easily outlasts an HTTP budget. We therefore stream its
// stdout as rows land, kill it once the budget expires, and mark the response
// `partial` — a truncated sweep must still report what DID finish, never "0".
const RUN_TIMEOUT_MS = 100_000;

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

// Count the enabled entries verify-portals.mjs will actually check — mirrors its
// own sweep of tracked_companies + job_boards with `enabled === false` dropped.
function countConfigured(portalsPath: string): number {
  try {
    const config = yaml.load(fs.readFileSync(portalsPath, "utf-8")) as
      | { tracked_companies?: { enabled?: boolean }[]; job_boards?: { enabled?: boolean }[] }
      | null
      | undefined;
    const lists = [config?.tracked_companies ?? [], config?.job_boards ?? []];
    return lists.reduce((n, list) => n + (Array.isArray(list) ? list.filter((c: { enabled?: boolean }) => c?.enabled !== false).length : 0), 0);
  } catch {
    return 0;
  }
}

// Orchestrates the core's verify-portals.mjs (#1016) — the SAME ATS-slug
// validator the CLI uses. Catches the silent 404s that quietly drop a company
// from every future scan (= lost offers).
export async function GET() {
  const root = careerOpsRoot();
  const verifyPortals = rootScript("verify-portals");
  if (!fs.existsSync(verifyPortals)) {
    return Response.json({ available: false, configured: false, companies: [], partial: false, checked: 0, total: 0 });
  }
  const portalsPath = path.join(root, "portals.yml");
  if (!fs.existsSync(portalsPath)) {
    return Response.json({ available: true, configured: false, companies: [], partial: false, checked: 0, total: 0 });
  }
  const total = countConfigured(portalsPath);

  const { stdout, timedOut, exitCode } = await new Promise<{ stdout: string; timedOut: boolean; exitCode: number | null }>((resolve) => {
    let outBuf = "";
    let timedOut = false;
    const child = spawn("node", [verifyPortals], {
      cwd: root,
      env: cliChildEnv("node", root),
    });

    const kill = () => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    };
    const timer = setTimeout(kill, RUN_TIMEOUT_MS);

    child.stdout.on("data", (d: Buffer) => {
      outBuf += d.toString();
    });
    child.stderr.on("data", (_d: Buffer) => {
      /* progress noise: keep it out of the parse */
    });
    child.on("error", () => {
      clearTimeout(timer);
      kill();
      resolve({ stdout: outBuf, timedOut, exitCode: null });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout: outBuf, timedOut, exitCode: code });
    });
  });

  const companies: { id: string; name: string; status: string; detail: string }[] = [];
  for (const line of stdout.split("\n")) {
    const row = parseVerifyLine(line);
    if (!row) continue;
    companies.push({ id: `${row.name}::${row.detail}`, ...row });
  }
  const partial = timedOut || exitCode !== 0 || companies.length < total;
  return Response.json({
    available: true,
    configured: true,
    companies,
    partial,
    checked: companies.length,
    total,
  });
}