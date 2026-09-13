import type { FormattingIssue, ResumeParseResult } from './types.ts';
import type { FormattingRiskLevel } from './data/ats-scoring-rules.ts';

export function analyzeFormatting(parsed: ResumeParseResult): FormattingIssue[] {
  const issues: FormattingIssue[] = [];
  const { text, lines, isImageBased, fileType } = parsed;

  if (isImageBased && fileType === 'pdf') {
    issues.push({
      type: 'error',
      title: 'Image-Based / Scanned PDF Detected',
      description: 'We extracted very little text from this PDF file. It may be a scanned image or non-selectable graphic.',
      impact: 'ATS parsers usually cannot read image-based resumes. Switch to a text-based PDF or DOCX file.',
      riskLevel: 'high risk'
    });
  }

  if (text.length < 150) {
    issues.push({
      type: 'error',
      title: 'Very Short Resume Content',
      description: 'The file contains very little readable text content.',
      impact: 'Ensure your resume contains complete work history, education, and skills.',
      riskLevel: 'high risk'
    });
  }

  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/gu;
  const emojiMatches = text.match(emojiRegex);
  if (emojiMatches && emojiMatches.length > 2) {
    issues.push({
      type: 'warning',
      title: 'Unusual Symbols or Emojis Detected',
      description: `Found ${emojiMatches.length} emojis or special graphic characters in the resume text.`,
      impact: 'Some legacy ATS systems misinterpret emojis as garbled text symbols.',
      riskLevel: 'medium risk'
    });
  }

  const separatorRegex = /(?:-{5,}|\*{5,}|_{5,}|={5,}|\|{3,})/g;
  if (separatorRegex.test(text)) {
    issues.push({
      type: 'warning',
      title: 'Potential ATS Risk: Heavy Symbol Separators',
      description: 'Contains long horizontal lines of symbols (such as ----- or =====).',
      impact: 'Complex symbol dividers can disrupt bullet point parsing in older ATS systems.',
      riskLevel: 'low risk'
    });
  }

  const longLines = lines.filter(l => l.length > 250);
  if (longLines.length > 3) {
    issues.push({
      type: 'warning',
      title: 'Potential ATS Risk: Unbroken Long Paragraphs',
      description: 'Multiple lines contain over 250 characters without natural line breaks.',
      impact: 'Consider breaking long blocks of text into concise bullet points for better readability.',
      riskLevel: 'low risk'
    });
  }

  const capsLines = lines.filter(l => l.length > 15 && l.toUpperCase() === l && /[A-Z]/.test(l));
  if (capsLines.length > 6) {
    issues.push({
      type: 'info',
      title: 'Excessive All-Caps Text',
      description: 'Multiple lines are fully capitalized.',
      impact: 'Use standard Title Case or Sentence case for headings and text.',
      riskLevel: 'low risk'
    });
  }

  const tabOrSpaceClusters = lines.filter(l => /\t|\s{6,}/.test(l));
  if (tabOrSpaceClusters.length > 5) {
    issues.push({
      type: 'warning',
      title: 'Potential ATS Risk: Tab or Multi-Column Layout Spacing',
      description: 'Detected wide spacing clusters or tab characters across multiple lines.',
      impact: 'Multi-column tables or manual space alignment can cause text from different columns to merge out of sequence in ATS software.',
      riskLevel: 'medium risk'
    });
  }

  if (issues.length === 0) {
    issues.push({
      type: 'info',
      title: 'Clean Text Layout',
      description: 'No major visual or text formatting red flags detected.',
      impact: 'Your resume text layout appears clean and accessible for standard ATS parsers.',
      riskLevel: 'safe'
    });
  }

  return issues;
}

export function determineFormattingRiskLevel(issues: FormattingIssue[]): FormattingRiskLevel {
  if (issues.some(i => i.riskLevel === 'high risk' || i.type === 'error')) {
    return 'high risk';
  }
  if (issues.some(i => i.riskLevel === 'medium risk')) {
    return 'medium risk';
  }
  if (issues.some(i => i.riskLevel === 'low risk' || i.type === 'warning')) {
    return 'low risk';
  }
  return 'safe';
}
