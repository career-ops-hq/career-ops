export type RequirementClassification = "Required" | "Preferred" | "Optional" | "Unclear";
export type MatchStatus = "verified" | "potential" | "transferable" | "missing-evidence";
export type VerdictLabel = "Excellent Match" | "Strong Match" | "Partial Match" | "Weak Match";

export interface JobMetadata {
  jobTitle: string | null;
  company: string | null;
  location: string | null;
  country: string | null;
  workMode: string;
  employmentType: string | null;
  seniority: { level: string; label: string } | null;
}

export interface Requirement {
  id: string;
  text: string;
  category: string;
  classification: RequirementClassification;
  reason: string;
}

export interface JobResponsibility {
  id: string;
  text: string;
  category: string;
}

export interface SalaryInfo {
  currency: string;
  min: number;
  max: number;
  period: string;
  raw: string;
}

export interface JobAnalysis {
  metadata: JobMetadata;
  requirements: Requirement[];
  responsibilities: JobResponsibility[];
  salary: SalaryInfo | null;
  keywords: string[];
  sourceTextLength: number;
  analyzedAt: string | null;
}

export interface ProfileEvidence {
  profile: Record<string, unknown>;
  cv: string;
  cvLower: string;
  profileText: string;
  answerText: string;
  location: string;
  workModes: string[];
  skills: string[];
  targetRoles: string[];
  headline: string;
  summary: string;
}

export interface RequirementMatch {
  id: string;
  text: string;
  category: string;
  classification: RequirementClassification;
  status: MatchStatus;
  confidence: "high" | "medium" | "low";
  explanation: string;
  evidence: Array<{ term: string; status: MatchStatus; source: string; snippet: string; matchedTerm?: string }>;
  terms: string[];
}

export interface Verdict {
  label: VerdictLabel;
  score: number;
  coverage: number;
  seniority: { score: number; reason: string };
  location: { score: number; reason: string };
  workMode: { score: number; reason: string };
  riskFactors: string[];
  reasons: string[];
}

export interface GapQuestion {
  id: string;
  requirementId: string | null;
  question: string;
  reason: string;
}

export interface GapAnalysis {
  verified: RequirementMatch[];
  potential: RequirementMatch[];
  transferable: RequirementMatch[];
  missingEvidence: RequirementMatch[];
  gaps: Array<RequirementMatch & { recommendedAction: string }>;
  questions: GapQuestion[];
}

export interface MatchReport {
  verdict: Verdict;
  requirementMatches: RequirementMatch[];
  gaps: GapAnalysis;
  recommendedActions: string[];
  generatedAt: string | null;
}

export interface JobAnalysisSummary {
  id: string;
  jobTitle: string;
  company: string | null;
  location: string | null;
  country: string | null;
  workMode: string;
  employmentType: string | null;
  seniority: string | null;
  salary: string | null;
  requirementCount: number;
  verdict: VerdictLabel | null;
  score: number | null;
  analyzedAt: string | null;
}

export function classifyRequirementText(text: string, heading?: string): { classification: RequirementClassification; reason: string };
export function extractMetadata(text: string): JobMetadata;
export function extractSalary(text: string): SalaryInfo | null;
export function extractRequirements(text: string): Requirement[];
export function extractKeywords(text: string, analysis?: JobAnalysis | null): string[];
export function analyzeJobText(text: string): JobAnalysis;
export function buildProfileEvidence(profile: object, cvText: string, answers?: Record<string, string>): ProfileEvidence;
export function matchRequirement(requirement: Requirement, evidence: ProfileEvidence): RequirementMatch;
export function overallVerdict(requirementMatches: RequirementMatch[], job: JobMetadata, evidence: ProfileEvidence): Verdict;
export function buildGapAnalysis(requirementMatches: RequirementMatch[], verdict: Verdict): GapAnalysis;
export function recommendedActions(gapAnalysis: GapAnalysis, verdict: Verdict): string[];
export function matchAnalysis(analysis: JobAnalysis, evidence: ProfileEvidence): MatchReport;
export function summarizeAnalysis(analysis: JobAnalysis, report: MatchReport | null, id: string): JobAnalysisSummary;
