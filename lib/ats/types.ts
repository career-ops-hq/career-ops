import type { ClassifiedKeyword, FormattingRiskLevel } from './data/ats-scoring-rules.ts';

export interface ResumeParseResult {
  text: string;
  pageCount: number;
  isImageBased: boolean;
  fileType: 'pdf' | 'docx' | 'txt';
  fileName: string;
  fileSize: number;
  lines: string[];
  words: string[];
}

export interface ContactInfo {
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedIn: string | null;
  github: string | null;
  website: string | null;
  portfolio: string | null;
}

export interface DetectedSection {
  name: string;
  key: string;
  found: boolean;
  isOptional: boolean;
  detectedHeading?: string;
  normalizedHeading?: string;
  standard?: boolean;
  confidence?: number;
  lineIndex?: number;
}

export interface FormattingIssue {
  type: 'warning' | 'error' | 'info';
  title: string;
  description: string;
  impact: string;
  riskLevel?: FormattingRiskLevel;
}

export interface KeywordMatchResult {
  score: number; // 0 - 100
  matchedKeywords: string[];
  missingKeywords: string[];
  overusedKeywords: string[];
  targetRole: string | null;
  roleAlignment: 'Strong' | 'Good' | 'Fair' | 'Weak' | 'None';
  classifiedKeywords?: ClassifiedKeyword[];
}

export interface ExperienceAnalysis {
  actionVerbScore: number;
  quantifiableScore: number;
  bulletCount: number;
  quantifiableCount: number;
  actionVerbCount: number;
  hasWeakBullets: boolean;
  weakBullets: string[];
  achievementScore: number; // 0 - 100
}

export interface ReadabilityAnalysis {
  wordCount: number;
  sentenceCount: number;
  avgSentenceLength: number;
  excessiveUppercase: boolean;
  excessiveSpecialChars: boolean;
  lengthStatus: 'optimal' | 'too_short' | 'too_long';
  lengthFeedback: string;
}

export interface ScoreBreakdownItem {
  category: string;
  score: number;
  maxScore: number;
  status: 'Excellent' | 'Good' | 'Needs Improvement' | 'Poor';
  explanation: string;
}

export interface Recommendation {
  id: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  category: string;
}

export interface ATSAnalysisResult {
  totalScore: number;
  confidence: number; // 0.0 - 1.0
  scoreCategory: 'Excellent ATS Compatibility' | 'Good ATS Compatibility' | 'Needs Improvement' | 'Several ATS Issues' | 'Major ATS Problems';
  scoreExplanation: string;
  breakdown: ScoreBreakdownItem[];
  contactInfo: ContactInfo;
  sections: DetectedSection[];
  keywords: KeywordMatchResult;
  formatting: FormattingIssue[];
  formattingRiskLevel: FormattingRiskLevel;
  experience: ExperienceAnalysis;
  readability: ReadabilityAnalysis;
  recommendations: Recommendation[];
  isImageBased: boolean;
  extractedText: string;
  fileName: string;
  fileType: 'pdf' | 'docx' | 'txt';
  fileSize: number;
  hasJobDescription: boolean;
  parsingWarning?: string | null;
}
