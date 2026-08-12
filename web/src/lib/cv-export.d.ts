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

export { buildExportFileName, validateExportFileName, analyzeCvForAts } from "./ats-analyzer.mjs";

export { buildExportFileName, validateExportFileName, analyzeCvForAts } from "./ats-analyzer.mjs";
