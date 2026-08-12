/** Type declarations for export-store.mjs (FAS 4). */

export interface ExportRecord {
  id: string;
  fileName: string;
  format: "pdf" | "docx" | "txt" | "md";
  templateId: string;
  filePath: string;
  storedFile: string;
  buffer?: Buffer;
  cvText?: string;
  versionId?: string | null;
  jobId?: string | null;
  jobTitle?: string;
  role?: string;
  company?: string;
  language?: string;
  createdAt: string;
  ats?: unknown;
  qualityGate?: {
    passed: boolean;
    checks: Array<{ id: string; label: string; ok: boolean; message: string }>;
    reason: string | null;
    checkedAt: string;
  };
}

export function exportRecordId(jobId: string | undefined, stamp?: number): string;
export function secureBinaryWrite(root: string, target: string, buffer: Buffer): Promise<string>;
export function listExportRecords(root: string): Promise<ExportRecord[]>;
export function readExportRecord(root: string, id: string): Promise<ExportRecord | null>;
export type ExportRecordInput = Omit<ExportRecord, "id" | "filePath" | "storedFile" | "createdAt"> & { id?: string };
export function saveExportRecord(root: string, record: ExportRecordInput): Promise<ExportRecord>;
export function recordExportGateResult(root: string, id: string, gate: {
  passed: boolean;
  checks: Array<{ id: string; label: string; ok: boolean; message: string }>;
  reason?: string | null;
}): Promise<ExportRecord | null>;
