import { NextRequest } from "next/server";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { payload, options } = body || {};

    if (!payload) {
      return new Response(JSON.stringify({ error: "payload required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const root = careerOpsRoot();
    const tempDir = path.join(os.tmpdir(), `rendercv-web-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const tempJson = path.join(tempDir, "profile.json");
    fs.writeFileSync(tempJson, JSON.stringify(payload, null, 2), "utf8");

    const outPdf = path.join(tempDir, "resume.pdf");
    const builderScript = path.join(root, "build-cv-rendercv.mjs");

    const nodeBin = process.execPath;
    const themeArg = `--theme=${options?.theme || "classic"}`;
    const colorArg = options?.color ? `--color=${options.color}` : "";

    const args = [builderScript, tempJson, outPdf, themeArg];
    if (colorArg) args.push(colorArg);

    execFileSync(nodeBin, args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env }
    });

    let pdfFile: string | null = null;
    const files = fs.readdirSync(tempDir);
    for (const f of files) {
      if (f.endsWith(".pdf")) {
        pdfFile = path.join(tempDir, f);
        break;
      }
    }

    if (!pdfFile || !fs.existsSync(pdfFile)) {
      return new Response(JSON.stringify({ error: "RenderCV failed to generate PDF" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const pdfBuffer = fs.readFileSync(pdfFile);
    fs.rmSync(tempDir, { recursive: true, force: true });

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="rendered-resume.pdf"',
        "Cache-Control": "no-store"
      }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
