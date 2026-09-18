import type {
  ContactInfo,
  DetectedSection,
  FormattingIssue,
  KeywordMatchResult,
  ExperienceAnalysis,
  ReadabilityAnalysis,
  ScoreBreakdownItem,
  Recommendation
} from './types.ts';
import { ATS_SCORING_WEIGHTS } from './data/ats-scoring-rules.ts';
import { determineFormattingRiskLevel } from './formatting.ts';

export function calculateATSScore(
  contactInfo: ContactInfo,
  sections: DetectedSection[],
  keywords: KeywordMatchResult,
  formatting: FormattingIssue[],
  experience: ExperienceAnalysis,
  readability: ReadabilityAnalysis,
  hasJobDescription: boolean,
  isImageBased: boolean,
  extractedTextLength: number
): {
  totalScore: number;
  confidence: number;
  scoreCategory: 'Excellent ATS Compatibility' | 'Good ATS Compatibility' | 'Needs Improvement' | 'Several ATS Issues' | 'Major ATS Problems';
  scoreExplanation: string;
  breakdown: ScoreBreakdownItem[];
  recommendations: Recommendation[];
  formattingRiskLevel: 'safe' | 'low risk' | 'medium risk' | 'high risk';
  parsingWarning?: string | null;
} {
  let contactScore = 0;
  if (contactInfo.name) contactScore += 0.6;
  if (contactInfo.email) contactScore += 0.6;
  if (contactInfo.phone) contactScore += 0.4;
  if (contactInfo.linkedIn || contactInfo.github || contactInfo.website || contactInfo.portfolio) contactScore += 0.4;
  contactScore = Math.min(ATS_SCORING_WEIGHTS.contactInfo, Number(contactScore.toFixed(1)));

  const foundSectionKeys = new Set(sections.filter(s => s.found).map(s => s.key || s.name.toLowerCase()));
  let completenessScore = 5;
  if (!foundSectionKeys.has('experience')) completenessScore -= 2;
  if (!foundSectionKeys.has('education')) completenessScore -= 1;
  if (!foundSectionKeys.has('skills')) completenessScore -= 1;
  if (readability.wordCount < 150) completenessScore -= 1;
  completenessScore = Math.max(0, completenessScore);

  let sectionScore = 0;
  if (foundSectionKeys.has('experience')) sectionScore += 3.5;
  if (foundSectionKeys.has('education')) sectionScore += 2.5;
  if (foundSectionKeys.has('skills')) sectionScore += 2.5;
  if (foundSectionKeys.has('summary') || foundSectionKeys.has('projects') || foundSectionKeys.has('certifications')) sectionScore += 1.5;
  sectionScore = Math.min(ATS_SCORING_WEIGHTS.resumeStructure, Number(sectionScore.toFixed(1)));

  const keywordOptScore = Math.round((keywords.score / 100) * ATS_SCORING_WEIGHTS.keywordRelevance);

  let skillsMatchScore = 0;
  if (hasJobDescription) {
    const totalJdKeywords = keywords.matchedKeywords.length + keywords.missingKeywords.length;
    const ratio = totalJdKeywords > 0 ? keywords.matchedKeywords.length / totalJdKeywords : keywords.score / 100;
    skillsMatchScore = Math.round(ratio * ATS_SCORING_WEIGHTS.skillsMatch);
  } else {
    skillsMatchScore = Math.min(ATS_SCORING_WEIGHTS.skillsMatch, Math.round((keywords.matchedKeywords.length / 8) * ATS_SCORING_WEIGHTS.skillsMatch));
  }

  let expRelevanceScore = 0;
  const verbComponent = (experience.actionVerbScore / 100) * 10;
  const alignmentBonus = keywords.roleAlignment === 'Strong' ? 5 : keywords.roleAlignment === 'Good' ? 4 : keywords.roleAlignment === 'Fair' ? 3 : 2;
  expRelevanceScore = Math.min(ATS_SCORING_WEIGHTS.experienceRelevance, Math.round(verbComponent + alignmentBonus));

  const achievementScore = Math.round((experience.achievementScore / 100) * ATS_SCORING_WEIGHTS.achievementQuality);

  let formatScore = ATS_SCORING_WEIGHTS.atsFormatting;
  if (isImageBased || extractedTextLength < 100) {
    formatScore -= 8;
  }
  const errorCount = formatting.filter(f => f.type === 'error').length;
  const warningCount = formatting.filter(f => f.type === 'warning').length;
  formatScore -= (errorCount * 4 + warningCount * 1.5);
  formatScore = Math.max(0, Math.round(formatScore));

  let roleMatchScore = 3;
  if (keywords.roleAlignment === 'Strong') roleMatchScore = 5;
  else if (keywords.roleAlignment === 'Good') roleMatchScore = 4;
  else if (keywords.roleAlignment === 'Fair') roleMatchScore = 3;
  else if (keywords.roleAlignment === 'Weak') roleMatchScore = 2;
  else roleMatchScore = 1;

  let readabilityScore = ATS_SCORING_WEIGHTS.readability;
  if (readability.lengthStatus !== 'optimal') readabilityScore -= 1;
  if (readability.excessiveUppercase) readabilityScore -= 1;
  if (readability.excessiveSpecialChars) readabilityScore -= 1;
  readabilityScore = Math.max(0, readabilityScore);

  const totalScore = Math.min(100, Math.max(0, Math.round(
    contactScore +
    completenessScore +
    sectionScore +
    keywordOptScore +
    skillsMatchScore +
    expRelevanceScore +
    achievementScore +
    formatScore +
    roleMatchScore +
    readabilityScore
  )));

  let confidence = 1.0;
  if (isImageBased || extractedTextLength < 150) confidence -= 0.4;
  if (!foundSectionKeys.has('experience') || !foundSectionKeys.has('education')) confidence -= 0.2;
  if (formatting.some(f => f.type === 'error')) confidence -= 0.15;
  if (readability.wordCount < 200) confidence -= 0.1;
  if (!hasJobDescription) confidence -= 0.05;
  confidence = Math.max(0.2, Number(confidence.toFixed(2)));

  const formattingRiskLevel = determineFormattingRiskLevel(formatting);
  let parsingWarning: string | null = null;
  if (isImageBased || extractedTextLength < 150) {
    parsingWarning = 'We could not reliably read the text in this PDF. Your ATS score may be inaccurate.';
  }

  let scoreCategory: 'Excellent ATS Compatibility' | 'Good ATS Compatibility' | 'Needs Improvement' | 'Several ATS Issues' | 'Major ATS Problems';
  let scoreExplanation: string;

  if (totalScore >= 90) {
    scoreCategory = 'Excellent ATS Compatibility';
    scoreExplanation = 'Your resume shows outstanding ATS compatibility, clear section structure, and strong keyword alignment.';
  } else if (totalScore >= 75) {
    scoreCategory = 'Good ATS Compatibility';
    scoreExplanation = 'Your resume is generally ATS-friendly, but improving keyword alignment and simplifying formatting could increase compatibility.';
  } else if (totalScore >= 60) {
    scoreCategory = 'Needs Improvement';
    scoreExplanation = 'Your resume has moderate ATS compatibility. Addressing missing sections, keywords, or formatting risks will help avoid parsing issues.';
  } else if (totalScore >= 40) {
    scoreCategory = 'Several ATS Issues';
    scoreExplanation = 'Multiple parsing risks detected, including missing sections, weak keyword matching, or layout risks.';
  } else {
    scoreCategory = 'Major ATS Problems';
    scoreExplanation = 'Major ATS compatibility issues detected. Your resume may be image-based or missing critical sections and keywords.';
  }

  const getStatus = (score: number, max: number): 'Excellent' | 'Good' | 'Needs Improvement' | 'Poor' => {
    const ratio = score / max;
    if (ratio >= 0.85) return 'Excellent';
    if (ratio >= 0.70) return 'Good';
    if (ratio >= 0.50) return 'Needs Improvement';
    return 'Poor';
  };

  const breakdown: ScoreBreakdownItem[] = [
    {
      category: 'Keyword Relevance',
      score: keywordOptScore,
      maxScore: ATS_SCORING_WEIGHTS.keywordRelevance,
      status: getStatus(keywordOptScore, ATS_SCORING_WEIGHTS.keywordRelevance),
      explanation: 'Evaluates the presence of relevant industry skills, tools, and technical terms.'
    },
    {
      category: 'Skills Match',
      score: skillsMatchScore,
      maxScore: ATS_SCORING_WEIGHTS.skillsMatch,
      status: getStatus(skillsMatchScore, ATS_SCORING_WEIGHTS.skillsMatch),
      explanation: hasJobDescription
        ? `Matched ${keywords.matchedKeywords.length} key terms from the target job description.`
        : 'General keyword coverage score. Paste a job description for targeted matching.'
    },
    {
      category: 'Experience Relevance',
      score: expRelevanceScore,
      maxScore: ATS_SCORING_WEIGHTS.experienceRelevance,
      status: getStatus(expRelevanceScore, ATS_SCORING_WEIGHTS.experienceRelevance),
      explanation: `Action verb score (${experience.actionVerbScore}%) and role alignment (${keywords.roleAlignment}).`
    },
    {
      category: 'Achievement Quality',
      score: achievementScore,
      maxScore: ATS_SCORING_WEIGHTS.achievementQuality,
      status: getStatus(achievementScore, ATS_SCORING_WEIGHTS.achievementQuality),
      explanation: `${experience.quantifiableCount} quantifiable metric bullet points detected.`
    },
    {
      category: 'Resume Structure',
      score: sectionScore,
      maxScore: ATS_SCORING_WEIGHTS.resumeStructure,
      status: getStatus(sectionScore, ATS_SCORING_WEIGHTS.resumeStructure),
      explanation: `Detected ${sections.filter(s => s.found).length} of ${sections.length} common standard resume sections.`
    },
    {
      category: 'ATS Formatting',
      score: formatScore,
      maxScore: ATS_SCORING_WEIGHTS.atsFormatting,
      status: getStatus(formatScore, ATS_SCORING_WEIGHTS.atsFormatting),
      explanation: isImageBased ? 'Image-based PDF layout detected.' : `Layout risk level: ${formattingRiskLevel}.`
    },
    {
      category: 'Job Title / Role Match',
      score: roleMatchScore,
      maxScore: ATS_SCORING_WEIGHTS.jobMatch,
      status: getStatus(roleMatchScore, ATS_SCORING_WEIGHTS.jobMatch),
      explanation: keywords.targetRole ? `Target role detected: "${keywords.targetRole}".` : 'General role match.'
    },
    {
      category: 'Section Completeness',
      score: completenessScore,
      maxScore: ATS_SCORING_WEIGHTS.sectionCompleteness,
      status: getStatus(completenessScore, ATS_SCORING_WEIGHTS.sectionCompleteness),
      explanation: 'Evaluates overall document completeness and core section presence.'
    },
    {
      category: 'Readability',
      score: readabilityScore,
      maxScore: ATS_SCORING_WEIGHTS.readability,
      status: getStatus(readabilityScore, ATS_SCORING_WEIGHTS.readability),
      explanation: `Analyzes word count (${readability.wordCount} words) and sentence flow.`
    },
    {
      category: 'Contact Information',
      score: Math.round(contactScore),
      maxScore: ATS_SCORING_WEIGHTS.contactInfo,
      status: getStatus(contactScore, ATS_SCORING_WEIGHTS.contactInfo),
      explanation: contactInfo.name && contactInfo.email ? 'Name and primary contact details successfully detected.' : 'Missing key contact details like email or phone.'
    }
  ];

  const recommendations: Recommendation[] = [];

  if (isImageBased || extractedTextLength < 150) {
    recommendations.push({
      id: 'rec-image-pdf',
      priority: 'high',
      title: 'Convert Image-Based PDF to Text-Based Document',
      description: 'Your PDF appears to be a scanned image or contains non-selectable text. Re-export your resume from Word, Google Docs, or LaTeX as a text PDF so ATS systems can parse your content.',
      category: 'Formatting'
    });
  }

  if (!contactInfo.email) {
    recommendations.push({
      id: 'rec-email',
      priority: 'high',
      title: 'Add a Clear Email Address',
      description: 'No valid email address was detected near the top of your resume. Ensure your email is written in plain text.',
      category: 'Contact Info'
    });
  }

  if (!contactInfo.phone) {
    recommendations.push({
      id: 'rec-phone',
      priority: 'medium',
      title: 'Include Phone Number',
      description: 'Adding a phone number helps recruiters contact you quickly for phone screens.',
      category: 'Contact Info'
    });
  }

  if (!contactInfo.linkedIn && !contactInfo.github && !contactInfo.website && !contactInfo.portfolio) {
    recommendations.push({
      id: 'rec-linkedin',
      priority: 'low',
      title: 'Add LinkedIn Profile URL',
      description: 'Include your LinkedIn profile link (e.g. linkedin.com/in/yourname) in the header section.',
      category: 'Contact Info'
    });
  }

  if (hasJobDescription && keywords.missingKeywords.length > 0) {
    const topMissing = keywords.missingKeywords.slice(0, 4).join(', ');
    recommendations.push({
      id: 'rec-keywords',
      priority: 'high',
      title: 'Add Relevant Missing Job Keywords',
      description: `Target keywords such as [${topMissing}] were found in the job description but not in your resume. Add relevant skills where truthful.`,
      category: 'Keywords'
    });
  }

  const missingCoreSections = sections.filter(s => !s.found && !s.isOptional);
  if (missingCoreSections.length > 0) {
    recommendations.push({
      id: 'rec-sections',
      priority: 'high',
      title: 'Add Standard Section Headings',
      description: `Missing standard headings: ${missingCoreSections.map(s => s.name).join(', ')}. Use standard section headers like "Work Experience" or "Education".`,
      category: 'Structure'
    });
  }

  if (experience.quantifiableCount === 0) {
    recommendations.push({
      id: 'rec-metrics',
      priority: 'medium',
      title: 'Add Measurable Achievements & Metrics',
      description: 'Where possible, quantify your impact using numbers, percentages, dollar amounts, time saved, or user growth (e.g., "Increased performance by 35%").',
      category: 'Experience'
    });
  }

  if (experience.hasWeakBullets) {
    recommendations.push({
      id: 'rec-action-verbs',
      priority: 'medium',
      title: 'Strengthen Passive Wording with Action Verbs',
      description: 'Replace passive phrases like "responsible for" or "worked on" with strong action verbs like "Spearheaded", "Architected", or "Optimized".',
      category: 'Experience'
    });
  }

  if (formatting.some(f => f.type === 'warning' || f.type === 'error')) {
    recommendations.push({
      id: 'rec-formatting',
      priority: 'medium',
      title: 'Simplify Resume Layout & Remove Complex Formatting',
      description: 'Avoid multi-column tables, long symbol dividers, or embedded text boxes that can confuse ATS parsers.',
      category: 'Formatting'
    });
  }

  return {
    totalScore,
    confidence,
    scoreCategory,
    scoreExplanation,
    breakdown,
    recommendations,
    formattingRiskLevel,
    parsingWarning
  };
}
