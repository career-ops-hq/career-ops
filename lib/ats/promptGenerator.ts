import type { ATSAnalysisResult } from './types.ts';

export type PromptMode = 'full' | 'keywords' | 'bullets' | 'summary';

export function generateAIPrompt(
  result: ATSAnalysisResult,
  mode: PromptMode = 'full'
): string {
  const targetRole = result.keywords.targetRole || 'Target Role Professional';
  const missingKeywords = result.keywords.missingKeywords || [];
  const formattingIssues = (result.formatting || []).map(f => f.title);
  const missingSections = (result.sections || []).filter(s => !s.found && !s.isOptional).map(s => s.name);
  
  const missingContact: string[] = [];
  if (!result.contactInfo.email) missingContact.push('Email');
  if (!result.contactInfo.phone) missingContact.push('Phone Number');
  if (!result.contactInfo.linkedIn) missingContact.push('LinkedIn Profile');
  if (!result.contactInfo.location) missingContact.push('Location');
  
  const recommendations = (result.recommendations || []).map(r => r.title);

  if (mode === 'keywords') {
    return `Act as an expert ATS Resume Specialist.

I ran an ATS audit on my resume for a "${targetRole}" role, and the following critical keywords/skills are missing:
${missingKeywords.length > 0 ? missingKeywords.map(k => `- ${k}`).join('\n') : '- High-impact industry standard technical skills'}

Please review my resume text below and:
1. Naturally integrate these missing keywords into my Skills section and Work Experience bullet points where accurate.
2. Ensure keywords are used in proper context without keyword stuffing.
3. Keep the overall ATS formatting clean and text-based.

=== ORIGINAL RESUME TEXT ===
${result.extractedText || ''}

Provide the updated resume text with integrated keywords.`;
  }

  if (mode === 'bullets') {
    return `Act as a Senior Resume Writer and Career Coach.

I need to strengthen the Work Experience bullet points in my resume for a "${targetRole}" role to make them high-impact and ATS-optimized.

Audit Findings:
- Achievement / Metric Score: ${result.experience?.achievementScore ?? 50}/100
- Weak bullets or bullets lacking quantifiable results detected.

Instructions:
1. Rewrite all Work Experience bullet points using strong action verbs (e.g., Engineered, Spearheaded, Accelerated, Optimized, Delivered).
2. Add realistic, quantifiable metrics (percentages, dollar amounts, time saved, efficiency gains) using the STAR method (Situation, Task, Action, Result).
3. Ensure bullet points highlight achievements rather than just job responsibilities.

=== ORIGINAL RESUME TEXT ===
${result.extractedText || ''}

Please provide the revised work experience section with high-impact, quantified bullet points.`;
  }

  if (mode === 'summary') {
    return `Act as an Executive Resume Writer.

Generate a compelling 3-4 sentence ATS-optimized Professional Summary for my resume targeted at a "${targetRole}" position.

Context & Keywords to incorporate:
${missingKeywords.length > 0 ? `- Key Skills to include: ${missingKeywords.slice(0, 6).join(', ')}` : ''}
- Target Role: ${targetRole}

=== ORIGINAL RESUME TEXT ===
${result.extractedText || ''}

Write 3 tailored options for the Professional Summary:
Option 1: Results-Focused & Metric-Driven
Option 2: Technical Expertise & Leadership
Option 3: Concise & Impact-First`;
  }

  // Default: Full Resume Fix
  let prompt = `Act as an expert ATS Resume Optimizer and Senior Hiring Manager.

I ran an automated ATS audit on my resume for a "${targetRole}" role, which received a score of ${result.totalScore}/100 (${result.scoreCategory}).

I need you to completely rewrite and optimize my resume to fix all identified ATS compatibility issues, improve keyword alignment, and maximize interview callbacks.

=== DETECTED ATS ISSUES & GAPS ===
`;

  if (missingKeywords.length > 0) {
    prompt += `• Missing Critical Keywords: ${missingKeywords.join(', ')}\n`;
  }
  if (result.keywords.overusedKeywords && result.keywords.overusedKeywords.length > 0) {
    prompt += `• Overused / Passive Keywords to replace: ${result.keywords.overusedKeywords.join(', ')}\n`;
  }
  if (formattingIssues.length > 0) {
    prompt += `• Formatting Risks: ${formattingIssues.join('; ')}\n`;
  }
  if (missingSections.length > 0) {
    prompt += `• Missing Standard Sections: ${missingSections.join(', ')}\n`;
  }
  if (missingContact.length > 0) {
    prompt += `• Missing Contact Info Placeholders: ${missingContact.join(', ')}\n`;
  }
  if (recommendations.length > 0) {
    prompt += `• Top Recommendations: ${recommendations.slice(0, 4).join('; ')}\n`;
  }

  prompt += `\n=== REWRITE INSTRUCTIONS ===
1. KEYWORD OPTIMIZATION: Seamlessly integrate the missing keywords (${missingKeywords.slice(0, 8).join(', ')}) into the Skills section and Work Experience bullet points.
2. ACTION & METRICS: Transform passive bullet points into achievement-focused statements with strong action verbs and quantifiable results (%, $, time saved).
3. ATS-FRIENDLY STRUCTURE: Organize into clean, standard sections: Contact Info, Professional Summary, Technical/Core Skills, Work Experience, Education, Projects (if applicable).
4. FORMATTING RULES: Use plain text, bullet points (•), clean spacing, and avoid tables, columns, or special non-standard characters.

=== ORIGINAL RESUME TEXT ===
${result.extractedText || ''}

Please output:
1. The complete rewritten ATS-optimized resume.
2. A bulleted summary of key improvements made to boost the ATS score.`;

  return prompt;
}
