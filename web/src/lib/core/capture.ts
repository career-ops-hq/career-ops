import { coreProfileEnv } from "@/lib/core/profile-path.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { captureWriterResult } from "./capture-request.mjs";

/**
 * "Add to pipeline" for a pasted URL — records the posting in data/pipeline.md
 * (and, with JD text, archives it under jds/) WITHOUT evaluating it. The write
 * is the core's own captureJd() from capture-jd.mjs (#7272), run in a
 * short-lived node child with cwd = the code checkout, exactly as pipeline.ts
 * runs scan.mjs's writers: the web keeps no parallel copy of the row format,
 * the URL validation, the dedup or the pipeline lock. No tokens are spent.
 *
 * Only url/text/company/role reach captureJd(): never commit, push or a data
 * root of the caller's choosing (see capture-request.mjs).
 */
export type CaptureInput = { url: string; text?: string; company?: string; role?: string };
export type CaptureResult =
  | { ok: true; appended: boolean; duplicate: boolean; hasText: boolean; company?: string; role?: string }
  | { ok: false; error: string; invalid?: boolean };

export function capturePosting(input: CaptureInput): Promise<CaptureResult> {
  // A data-only or pre-#7272 checkout has no capture writer → say so instead of
  // failing on an import the user cannot read.
  if (!fs.existsSync(rootScript("capture-jd"))) {
    return Promise.resolve({ ok: false, error: "This checkout has no capture writer (capture-jd.mjs). Update career-ops to add postings without evaluating them." });
  }

  const captureUrl = pathToFileURL(rootScript("capture-jd")).href;
  const code = `
import { captureJd } from ${JSON.stringify(captureUrl)};
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", async () => {
  try {
    const { url, text, company, role } = JSON.parse(input);
    const result = await captureJd({ url, text, company, role });
    // captureJd() answers ok:false only for input it refused (bad URL, unsafe name).
    process.stdout.write(JSON.stringify(result.ok ? result : { ...result, invalid: true }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
  }
});
`;

  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      cwd: resolveCodeRoot(process.cwd(), process.env),
      env: coreProfileEnv(careerOpsRoot()),
      // windowsHide: see api/doctor/route.ts — a stale inherited console kills
      // every child with 0xC0000142 on Windows; never inherit one.
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => resolve({ ok: false, error: e instanceof Error ? e.message : "spawn failed" }));
    child.on("close", (code, signal) => resolve(captureWriterResult(out, err, { code, signal }) as CaptureResult));
    // A child that dies before reading stdin (a failed import, say) makes a
    // large write fail with EPIPE on the pipe, not on `child`. Unhandled, that
    // stream error would take the whole web server down. The failure itself is
    // still reported: `close` follows with an empty stdout, which
    // captureWriterResult() reads as a failed capture.
    child.stdin.on("error", () => {});
    child.stdin.write(JSON.stringify({ url: input.url, text: input.text, company: input.company, role: input.role }));
    child.stdin.end();
  });
}
