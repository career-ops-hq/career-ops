import { ATS_BENCHMARKS } from './data/ats-benchmark-index.ts';
import { analyzeResume } from './analyzer.ts';
import type { ResumeParseResult } from './types.ts';

export interface BenchmarkCalibrationResult {
  id: string;
  role: string;
  category: string;
  level: string;
  expectedRange: [number, number];
  actualScore: number;
  confidence: number;
  difference: number;
  status: 'In Range' | 'Above Expected' | 'Below Expected';
  formattingRiskLevel: string;
  matchedKeywordsCount: number;
  breakdown: Array<{ category: string; score: number; maxScore: number }>;
  strengths: string[];
  potentialIssues: string[];
}

export interface BenchmarkCalibrationReport {
  timestamp: string;
  totalBenchmarks: number;
  inRangeCount: number;
  averageScore: number;
  results: BenchmarkCalibrationResult[];
}

export function runBenchmarkCalibration(): BenchmarkCalibrationReport {
  const results: BenchmarkCalibrationResult[] = [];
  let inRangeCount = 0;
  let scoreSum = 0;

  for (const benchmark of ATS_BENCHMARKS) {
    const lines = benchmark.rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const words = benchmark.rawText
      .split(/\s+/)
      .map(w => w.replace(/[^a-zA-Z0-9+#.-]/g, '').trim())
      .filter(Boolean);

    const mockParseResult: ResumeParseResult = {
      text: benchmark.rawText,
      pageCount: 1,
      isImageBased: false,
      fileType: 'txt',
      fileName: `${benchmark.id}.txt`,
      fileSize: benchmark.rawText.length,
      lines,
      words
    };

    const analysis = analyzeResume(mockParseResult, benchmark.jobDescriptionText);
    const actualScore = analysis.totalScore;
    scoreSum += actualScore;

    const [minExp, maxExp] = benchmark.expectedScore;
    let status: 'In Range' | 'Above Expected' | 'Below Expected' = 'In Range';
    let difference = 0;

    if (actualScore < minExp) {
      status = 'Below Expected';
      difference = actualScore - minExp;
    } else if (actualScore > maxExp) {
      status = 'Above Expected';
      difference = actualScore - maxExp;
    } else {
      inRangeCount++;
    }

    const strengths: string[] = [];
    if (analysis.keywords.score >= 80) strengths.push('Strong keyword alignment');
    if (analysis.experience.quantifiableCount > 0) strengths.push('Quantified achievements present');
    if (analysis.sections.filter(s => s.found).length >= 4) strengths.push('Clear section structure');
    if (analysis.formattingRiskLevel === 'safe') strengths.push('ATS-safe formatting');

    const potentialIssues: string[] = [];
    if (actualScore < minExp) {
      potentialIssues.push(`Score (${actualScore}) is below target min (${minExp}). Review keyword weights or section detection.`);
    }
    if (analysis.keywords.missingKeywords.length > 0) {
      potentialIssues.push(`Missing ${analysis.keywords.missingKeywords.length} target job keywords.`);
    }

    results.push({
      id: benchmark.id,
      role: benchmark.role,
      category: benchmark.category,
      level: benchmark.level,
      expectedRange: benchmark.expectedScore,
      actualScore,
      confidence: analysis.confidence,
      difference,
      status,
      formattingRiskLevel: analysis.formattingRiskLevel,
      matchedKeywordsCount: analysis.keywords.matchedKeywords.length,
      breakdown: analysis.breakdown.map(b => ({ category: b.category, score: b.score, maxScore: b.maxScore })),
      strengths,
      potentialIssues
    });
  }

  return {
    timestamp: new Date().toISOString(),
    totalBenchmarks: ATS_BENCHMARKS.length,
    inRangeCount,
    averageScore: Math.round(scoreSum / ATS_BENCHMARKS.length),
    results
  };
}
