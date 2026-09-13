import type { ATSAnalysisResult, ResumeParseResult } from './types.ts';
import { extractContactInfo, detectResumeSections } from './sections.ts';
import { analyzeKeywords } from './keywords.ts';
import { analyzeFormatting } from './formatting.ts';
import { analyzeExperience } from './experience.ts';
import { analyzeReadability } from './readability.ts';
import { calculateATSScore } from './scoring.ts';

export function analyzeResume(parsed: ResumeParseResult, jobDescription?: string): ATSAnalysisResult {
  const hasJobDescription = Boolean(jobDescription && jobDescription.trim().length > 20);

  const contactInfo = extractContactInfo(parsed.lines, parsed.text);
  const sections = detectResumeSections(parsed.lines, parsed.text);
  const keywords = analyzeKeywords(parsed.text, jobDescription);
  const formatting = analyzeFormatting(parsed);
  const experience = analyzeExperience(parsed.lines, parsed.text);
  const readability = analyzeReadability(parsed.text, parsed.words);

  const scoreResult = calculateATSScore(
    contactInfo,
    sections,
    keywords,
    formatting,
    experience,
    readability,
    hasJobDescription,
    parsed.isImageBased,
    parsed.text.trim().length
  );

  return {
    totalScore: scoreResult.totalScore,
    confidence: scoreResult.confidence,
    scoreCategory: scoreResult.scoreCategory,
    scoreExplanation: scoreResult.scoreExplanation,
    breakdown: scoreResult.breakdown,
    contactInfo,
    sections,
    keywords,
    formatting,
    formattingRiskLevel: scoreResult.formattingRiskLevel,
    experience,
    readability,
    recommendations: scoreResult.recommendations,
    isImageBased: parsed.isImageBased,
    extractedText: parsed.text,
    fileName: parsed.fileName,
    fileType: parsed.fileType,
    fileSize: parsed.fileSize,
    hasJobDescription,
    parsingWarning: scoreResult.parsingWarning
  };
}
