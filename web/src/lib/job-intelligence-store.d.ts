export interface JobIntelligenceRecord {
  id: string;
  meta: { source: string; url: string | null; fileName: string | null; savedRole?: string; savedCompany?: string };
  analysis: import("./job-intelligence").JobAnalysis;
  report: import("./job-intelligence").MatchReport;
  summary: import("./job-intelligence").JobAnalysisSummary;
  answers: Record<string, string>;
  updatedAt: string;
}

export function jobIntelligenceId(title: string | null | undefined, url: string | null | undefined, text: string): string;
export function listJobAnalyses(root: string): Promise<import("./job-intelligence").JobAnalysisSummary[]>;
export function readJobAnalysis(root: string, id: string): Promise<JobIntelligenceRecord | null>;
export function saveJobAnalysis(root: string, record: JobIntelligenceRecord): Promise<JobIntelligenceRecord>;
export function deleteJobAnalysis(root: string, id: string): Promise<{ ok: boolean }>;
