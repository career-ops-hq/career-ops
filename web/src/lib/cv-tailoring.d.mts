/**
 * cv-tailoring.d.ts — Type declarations for cv-tailoring.mjs (FAS 3)
 */

export type TailorLevel = "light" | "professional" | "targeted";

export interface TailorChange {
  id: string;
  sectionId: string;
  type: "added" | "removed" | "rephrased" | "moved" | "keyword" | "needsVerification";
  original?: string;
  proposed?: string;
  reason: string;
  verified: boolean;
  keyword?: string;
}

export interface TailorSection {
  id: string;
  title: string;
  level: number;
  start: number;
  end: number;
  original: string;
  proposed: string;
  changes: TailorChange[];
}

export interface TailorProposal {
  level: TailorLevel;
  sections: TailorSection[];
  summary: {
    totalChanges: number;
    verified: number;
    needsVerification: number;
    keywords: string[];
  };
  model?: string;
  aiPolished?: number;
}

export interface TailorApplyOutcome {
  id: string;
  outcome: "unchanged" | "proposed" | "edit" | "removed" | "skipped";
}

export interface TailorApplyResult {
  cvText: string;
  appliedCount: number;
  outcomes: TailorApplyOutcome[];
}

export interface ProfileInput {
  fullName?: string;
  headline?: string;
  summary?: string;
  targetRoles?: string[];
  skills?: string[];
}

export interface AnalysisInput {
  metadata?: { jobTitle?: string | null; company?: string | null; location?: string | null };
  keywords?: string[];
}

export function parseCvSections(cvText: string): TailorSection[];
export function tokenizeTerms(text: string): string[];
export function buildVerifiedTerms(
  cvText: string,
  profile: ProfileInput | null,
  analysis: AnalysisInput | null
): Set<string>;
export function unverifiedTerms(
  text: string,
  baseline: string,
  verifiedTerms: Set<string>
): string[];
export function generateTailorProposal(options: {
  cvText: string;
  profile: ProfileInput | null;
  analysis: AnalysisInput | null;
  report?: unknown;
  level: TailorLevel;
}): TailorProposal;
export function assembleProposedCv(
  cvText: string,
  sections: TailorSection[]
): string;
export function applyTailorChanges(options: {
  cvText: string;
  sections: TailorSection[];
  approvedIds?: string[];
  edits?: Record<string, string>;
}): TailorApplyResult;
export function polishProposalWithLlm(
  proposal: TailorProposal,
  context: { analysis: AnalysisInput | null; profile: ProfileInput | null },
  chatFn: (prompt: string) => Promise<{ ok: boolean; content?: string }>,
  options?: { model?: string }
): Promise<TailorProposal>;

export const LEVELS: Record<TailorLevel, { label: string; description: string }>;
