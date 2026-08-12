export interface CvVersion {
  id: string;
  createdAt: string;
  label: string;
  source: string;
  bytes: number;
  sha256: string;
  restoredFrom: string | null;
}

export function validateCvImport(file: { name: string; size: number }): { extension: string; kind: "text" | "document" };
export function readActiveCv(root: string): Promise<string>;
export function saveCvVersion(root: string, input: { content: string; label?: string; source?: string; restoredFrom?: string }): Promise<CvVersion>;
export function listCvVersions(root: string): Promise<CvVersion[]>;
export function restoreCvVersion(root: string, id: string): Promise<CvVersion>;
