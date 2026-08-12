/** Type declarations for cv-export.mjs (FAS 4). */

export interface StructuredCvSection {
  type: string;
  title: string;
  lines: string[];
}

export interface StructuredCv {
  name: string;
  headerLines: string[];
  sections: StructuredCvSection[];
}

export interface CvTemplate {
  id: "ats-standard" | "professional" | "executive";
  name: string;
  description: string;
  tags: string[];
}

export type CvExportFormat = "pdf" | "docx" | "txt" | "md";

export const CV_TEMPLATES: readonly CvTemplate[];
export const EXPORT_FORMATS: readonly CvExportFormat[];

export function structuredCv(cvText: string): StructuredCv;
export function detectLanguage(text: string): string;
export function renderHtml(structured: StructuredCv, templateId?: string): string;
export function renderPdf(structured: StructuredCv, templateId?: string): Buffer;
export function buildPdf(pageStreams: string[][]): Buffer;
export function storeZip(files: Array<{ name: string; data: Buffer }>): Buffer;
export function renderDocx(structured: StructuredCv, templateId?: string): Buffer;
export function renderTxt(structured: StructuredCv): string;
export function renderMarkdown(cvText: string): string;
export function extractDocxText(buf: Buffer): string;

export interface RenderCvExportOptions {
  cvText: string;
  templateId?: string;
  format?: CvExportFormat;
  fileName?: string;
  role?: string;
  company?: string;
  kind?: "cv" | "coverletter";
}

export interface RenderCvExportResult {
  fileName: string;
  format: CvExportFormat;
  buffer: Buffer;
  text: string;
  structured: StructuredCv;
}

export function renderCvExport(options: RenderCvExportOptions): RenderCvExportResult;

export interface QualityGateCheck {
  id: string;
  label: string;
  ok: boolean;
  message: string;
}

export interface QualityGateResult {
  passed: boolean;
  checks: QualityGateCheck[];
  reason: string | null;
}

export interface QualityGateOptions {
  filePath: string;
  fileName: string;
  format: CvExportFormat;
  sourceText: string;
  originalCvPath?: string;
  originalSha256?: string;
}

export function runExportQualityGate(options: QualityGateOptions): QualityGateResult;

export { buildExportFileName, validateExportFileName, analyzeCvForAts } from "./ats-analyzer.mjs";
