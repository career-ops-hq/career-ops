/** Type declarations for cv-export-server.mjs (FAS 4, server-only: node:fs/node:crypto). */

import type { CvExportFormat, StructuredCv } from "./cv-export.d.ts";

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

export function extractDocxText(buf: Buffer): string;
