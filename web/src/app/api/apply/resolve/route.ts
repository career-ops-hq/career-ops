import { execFile } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript, findReportFile } from "@/lib/career-ops";
import { parseReport } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Resolve a report's APPLY target before the apply session opens.
//
// A LinkedIn posting URL is not applyable: openSession() browses in a fresh,
// cookie-less context, so linkedin.com/jobs/view/<id> serves the authwall and the
// flow dead-ends. The core's linkedin-apply.mjs reconstructs the employer's real
// ATS URL from the guest page (company + title) and records it on the report as
// **Apply URL:**, which is what the Apply button then opens.
//
// Everything expensive is skipped when it can be: a report that already carries
// **Apply URL:** answers from disk, and a non-LinkedIn posting is returned as-is
// without spawning anything.

type Resolution = {
  status: "resolved" | "ambiguous" | "unresolved";
  applyUrl: string | null;
  /** Where the answer came from, so the UI can explain itself. */
  source: "recorded" | "direct" | "resolved" | "manual";
  reason?: string;
  candidates?: { title: string; url: string; location: string; score: number }[];
  posting?: { title?: string; company?: string; location?: string; offsiteApply?: boolean };
  board?: { vendor?: string; slug?: string; jobCount?: number };
};

function isLinkedIn(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "linkedin.com" || h.endsWith(".linkedin.com");
  } catch {
    return false;
  }
}

function reportField(file: string, label: string): string {
  try {
    const meta = parseReport(fs.readFileSync(file, "utf8"));
    return meta.fields.find((f) => f.label === label)?.value ?? "";
  } catch {
    return "";
  }
}

/** The resolver's JSON answer, or null when it did not produce a readable one.
 *  Parsed rather than string-matched: `"ok": true` only appears verbatim under
 *  the current 2-space pretty-print, so a formatting change on the resolver side
 *  would silently turn every successful write into a 500. */
function resolverJson(stdout: string): Record<string, unknown> | null {
  const start = stdout.indexOf("{");
  if (start === -1) return null;
  try {
    const parsed: unknown = JSON.parse(stdout.slice(start));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Run the core resolver. Never rejects: a failure becomes an unresolved answer. */
function runResolver(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const script = rootScript("linkedin-apply");
  return new Promise((resolve) => {
    execFile(
      "node",
      [script, ...args],
      { cwd: careerOpsRoot(), timeout: 110_000, maxBuffer: 4_000_000 },
      (_err, stdout, stderr) => resolve({ stdout: stdout || "", stderr: stderr || "" }),
    );
  });
}

export async function POST(req: Request) {
  let body: { n?: string; pick?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const n = String(body.n ?? "").trim();
  if (!n) return Response.json({ error: "a report number is required" }, { status: 400 });

  // findReportFile enforces containment under the project root, so `n` can never
  // walk the caller out of the reports directory.
  const file = findReportFile(n);
  if (!file) return Response.json({ error: `no report found for #${n}` }, { status: 404 });

  // A URL the user chose themselves (an ambiguous pick, or one they pasted).
  // Recorded verbatim, never re-resolved.
  const pick = String(body.pick ?? "").trim();
  if (pick) {
    if (!/^https?:\/\//i.test(pick)) {
      return Response.json({ error: "an http(s) application URL is required" }, { status: 400 });
    }
    // A URL is ONE line. `pick` is written into the report's line-oriented header,
    // where an embedded newline emits a second line and can forge a `**URL:**`,
    // the one field this feature promises never to overwrite. upsertApplyUrl
    // refuses it too; rejecting here makes it a 400 the UI can show rather than a
    // 500 raised from inside the resolver.
    if (/[\s\u0000-\u001f\u007f]/.test(pick)) {
      return Response.json({ error: "an application URL must be a single line with no whitespace" }, { status: 400 });
    }
    const { stdout, stderr } = await runResolver(["--report", file, "--set", pick]);
    if (resolverJson(stdout)?.ok !== true) {
      return Response.json({ error: `could not record that URL: ${(stderr || stdout).slice(0, 200)}` }, { status: 500 });
    }
    return Response.json({ status: "resolved", applyUrl: pick, source: "manual" } satisfies Resolution);
  }

  // Already recorded: answer from disk, no network, no spawn.
  const recorded = reportField(file, "Apply URL");
  if (recorded && /^https?:\/\//i.test(recorded)) {
    return Response.json({ status: "resolved", applyUrl: recorded, source: "recorded" } satisfies Resolution);
  }

  const url = reportField(file, "URL");
  if (!url || !/^https?:\/\//i.test(url)) {
    return Response.json({
      status: "unresolved",
      applyUrl: null,
      source: "direct",
      reason: "this report has no posting URL to apply through",
    } satisfies Resolution);
  }

  // Not LinkedIn: the posting URL IS the apply target, which is the common case.
  if (!isLinkedIn(url)) {
    return Response.json({ status: "resolved", applyUrl: url, source: "direct" } satisfies Resolution);
  }

  const { stdout, stderr } = await runResolver([url, "--report", file]);
  const start = stdout.indexOf("{");
  if (start === -1) {
    return Response.json({
      status: "unresolved",
      applyUrl: null,
      source: "resolved",
      reason: `the resolver produced no result: ${(stderr || "no output").slice(0, 200)}`,
    } satisfies Resolution);
  }
  try {
    const parsed = JSON.parse(stdout.slice(start)) as {
      status: Resolution["status"];
      applyUrl: string | null;
      reason?: string;
      candidates?: Resolution["candidates"];
      posting?: Resolution["posting"];
      board?: Resolution["board"];
    };
    return Response.json({
      status: parsed.status,
      applyUrl: parsed.applyUrl,
      source: "resolved",
      reason: parsed.reason,
      candidates: parsed.candidates ?? [],
      posting: parsed.posting,
      board: parsed.board,
    } satisfies Resolution);
  } catch {
    return Response.json({
      status: "unresolved",
      applyUrl: null,
      source: "resolved",
      reason: "the resolver's answer could not be read",
    } satisfies Resolution);
  }
}
