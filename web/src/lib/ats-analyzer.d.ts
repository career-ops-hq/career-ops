/** Type declarations for ats-analyzer.mjs (FAS 4). */

export type Severity = "PASS" | "WARNING" | "CRITICAL";

export interface AtsCheck {
  id: string;
  label: string;
  severity: Severity;
  message: string;
  fix: string;
}

export interface AtsSummary {
  pass: number;
  warning: number;
  critical: number;
  worst: Severity;
}

export interface KeywordMatch {
  matched: string[];
  missing: string[];
  coverage: number;
}

export interface AtsEnvironment {
  id: string;
  name: string;
  parseStyle: "html" | "structured" | "cloud";
  riskLevel: "låg" | "medel" | "hög";
  knownRisks: string[];
  guidance: string[];
  issues: Array<{ checkId: string; label: string; severity: Severity }>;
}

export interface AtsAnalyzeOptions {
  jobText?: string;
  fileName?: string;
  sourceKind?: "markdown" | "pdf" | "docx" | "txt";
  profile?: { fullName?: string } | null;
}

export interface AtsReport {
  analyzedAt: string;
  sourceKind: string;
  detectedLanguage: string;
  wordCount: number;
  checks: AtsCheck[];
  summary: AtsSummary;
  keywords: KeywordMatch;
  sections: Array<{ id: string; type: string; title: string; level: number }>;
  environments: AtsEnvironment[];
  fileName?: { name: string; valid: boolean; reason?: string };
}

export interface ScoreBand {
  key: string;
  label: string;
  score: number;
  band: "Excellent" | "Strong" | "Good" | "Needs Improvement" | "Critical";
  explanation: string;
  problems: string[];
  fix: string;
}

export interface ScorecardResult {
  overallReadiness: ScoreBand;
  categories: Record<string, ScoreBand>;
}

export interface SafeFixChange {
  id: number;
  kind: string;
  description: string;
  safe: boolean;
}

export interface SafeFixResult {
  correctedText: string;
  changes: SafeFixChange[];
  digitsPreserved: boolean;
  originalDigits: string[];
  correctedDigits: string[];
}

export interface ExportFileNameOptions {
  firstName?: string;
  lastName?: string;
  role?: string;
  company?: string;
  kind?: string;
  ext?: string;
}

export declare const SEVERITY: Readonly<{ PASS: Severity; WARNING: Severity; CRITICAL: Severity }>;
export declare const BANDS: ReadonlyArray<"Excellent" | "Strong" | "Good" | "Needs Improvement" | "Critical">;

export declare function analyzeCvForAts(
  cvText: string,
  options?: AtsAnalyzeOptions,
): AtsReport;

export declare const ATS_ENVIRONMENTS: ReadonlyArray<{
  id: string;
  name: string;
  parseStyle: AtsEnvironment["parseStyle"];
  knownRisks: string[];
  guidance: string[];
}>;

export declare function analyzeEnvironments(
  checks: AtsCheck[],
  jobText?: string,
): AtsEnvironment[];

export declare function scoreCv(params?: {
  cvText?: string;
  sections?: unknown[];
  checks?: AtsCheck[];
  options?: AtsAnalyzeOptions;
}): ScorecardResult;

export declare function improveSafePoints(cvText: string): SafeFixResult;

export declare function buildExportFileName(
  options: ExportFileNameOptions,
): string;

export declare function validateExportFileName(
  fileName: string,
): { valid: boolean; ext: string; base: string; reason?: string };
