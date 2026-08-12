export interface AtsAnalysis {
  score: number;
  sections: Record<"summary" | "experience" | "skills" | "education", boolean>;
  signals: { bullets: number; quantified: number; actionVerbs: boolean; contact: boolean };
  keywordMatch: { score: number; matched: string[]; missing: string[] };
  recommendations: string[];
}

export function analyzeAtsReadiness(
  cvText: string,
  options?: { jobDescription?: string },
): AtsAnalysis;
