import { NextRequest, NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { analyzeCvForAts, scoreCv } from "@/lib/ats-analyzer";
import { CV_TEMPLATES, EXPORT_FORMATS } from "@/lib/cv-export";
import { renderCvExport, runExportQualityGate } from "@/lib/cv-export-server";
import { saveExportRecord, listExportRecords, recordExportGateResult } from "@/lib/export-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CV_BYTES = 10 * 1024 * 1024;

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

/** Skapar en CV-export: renderar filen, sparar den + metadata, kör quality gate. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Ogiltig JSON-body." }, { status: 400 });

    const cvText = typeof body.cvText === "string" ? body.cvText.trim() : "";
    if (!cvText) return NextResponse.json({ error: "cvText krävs." }, { status: 400 });
    if (Buffer.byteLength(cvText, "utf8") > MAX_CV_BYTES) {
      return NextResponse.json({ error: "CV:t är för stort (max 10 MB)." }, { status: 413 });
    }

    const templateId = CV_TEMPLATES.some((t) => t.id === body.templateId) ? body.templateId : "ats-standard";
    const format = EXPORT_FORMATS.includes(body.format) ? body.format : "pdf";
    const role = typeof body.role === "string" ? body.role.trim() || undefined : undefined;
    const company = typeof body.company === "string" ? body.company.trim() || undefined : undefined;
    const fileName = typeof body.fileName === "string" ? body.fileName.trim() || undefined : undefined;
    const jobText = typeof body.jobText === "string" ? body.jobText.slice(0, 100_000) : undefined;
    const versionId = typeof body.versionId === "string" ? body.versionId : undefined;
    const jobId = typeof body.jobId === "string" ? body.jobId : undefined;

    const root = careerOpsRoot();

    // Original-CV (cv.md) — vi rör den aldrig, men verifierar oförändrad i gaten.
    const originalCvPath = `${root}/cv.md`;
    const { readFileSync, existsSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    let originalSha256 = "";
    try {
      if (existsSync(originalCvPath)) {
        originalSha256 = createHash("sha256").update(readFileSync(originalCvPath)).digest("hex");
      }
    } catch {
      originalSha256 = "";
    }

    // ATS-analys + scorecard för metadata + rekommendationer.
    const ats = analyzeCvForAts(cvText, jobText ? { jobText } : {});
    const scoreCard = scoreCv({ cvText, options: jobText ? { jobText } : {} });

    // Rendera export.
    const rendered = renderCvExport({ cvText, templateId, format, fileName, role, company });
    const buffer = rendered.buffer;

    // Spara fil + metadata.
    const record = await saveExportRecord(root, {
      fileName: rendered.fileName,
      format,
      templateId,
      cvText,
      versionId,
      jobId,
      role,
      company,
      ats: { ...ats, scoreCard },
      buffer,
    });

    // Quality gate mot den sparade filen.
    const gate = await runExportQualityGate({
      filePath: record.filePath,
      fileName: rendered.fileName,
      format,
      sourceText: cvText,
      originalCvPath: originalSha256 ? originalCvPath : undefined,
      originalSha256: originalSha256 || undefined,
    });

    // Uppdatera metadata med gate-resultat.
    const finalRecord = (await recordExportGateResult(root, record.id, gate)) ?? record;

    return NextResponse.json({
      ok: gate.passed,
      export: {
        id: finalRecord.id,
        fileName: finalRecord.fileName,
        format,
        templateId,
        mime: MIME[format] || "application/octet-stream",
        base64: buffer.toString("base64"),
        size: buffer.length,
        createdAt: finalRecord.createdAt,
        qualityGate: { passed: gate.passed, checks: gate.checks },
        ats: {
          summary: ats.summary,
          scoreCard,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Okänt fel";
    return NextResponse.json({ error: `Exporten misslyckades: ${message}` }, { status: 500 });
  }
}

/** Listar sparad exportmetadata. */
export async function GET() {
  try {
    const root = careerOpsRoot();
    const records = await listExportRecords(root);
    return NextResponse.json({ exports: records });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Okänt fel";
    return NextResponse.json({ error: `Kunde inte lista exporter: ${message}` }, { status: 500 });
  }
}
