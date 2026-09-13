import type { KeywordMatchResult } from './types.ts';
import type { ClassifiedKeyword, KeywordCategory } from './data/ats-scoring-rules.ts';
import { COMMON_SKILLS, STOP_WORDS } from './data/commonSkills.ts';

const SKILL_CANONICAL_MAP: Record<string, string> = {
  'react.js': 'react',
  'reactjs': 'react',
  'node.js': 'nodejs',
  'nodejs': 'nodejs',
  'vue.js': 'vue',
  'vuejs': 'vue',
  'express.js': 'express',
  'expressjs': 'express',
  'next.js': 'nextjs',
  'nextjs': 'nextjs',
  'rest api': 'restapi',
  'restful apis': 'restapi',
  'rest apis': 'restapi',
  'restful api': 'restapi',
  'amazon web services': 'aws',
  'google cloud': 'gcp',
  'google cloud platform': 'gcp',
  'kubernetes': 'kubernetes',
  'k8s': 'kubernetes',
  'ci/cd': 'cicd',
  'cicd': 'cicd',
  'postgres': 'postgresql',
  'postgresql': 'postgresql',
  'user experience': 'ux',
  'ux design': 'ux',
  'ux research': 'ux',
  'user interface': 'ui',
  'ui design': 'ui',
  'search engine optimization': 'seo',
  'search engine marketing': 'sem'
};

function cleanTerm(term: string): string {
  const rawClean = term.toLowerCase().replace(/[^a-z0-9+#.-]/g, '').trim();
  return SKILL_CANONICAL_MAP[rawClean] || rawClean;
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capitalizeWord(word: string): string {
  if (word.toUpperCase() === word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function classifyTerm(term: string): KeywordCategory {
  const clean = cleanTerm(term);

  const tools = new Set(['git', 'docker', 'kubernetes', 'jira', 'confluence', 'tableau', 'power bi', 'figma', 'sap', 'salesforce', 'postman', 'aws', 'gcp', 'azure', 'snowflake', 'hubspot', 'mailchimp', 'semrush', 'amplitude', 'mixpanel']);
  if (tools.has(clean)) return 'tool';

  const certs = new Set(['ckad', 'aws certified', 'pmp', 'six sigma', 'scrum master', 'cissp', 'cpa', 'lssbb', 'cpim']);
  if (certs.has(clean) || clean.includes('certified') || clean.includes('certification')) return 'certification';

  const methodologies = new Set(['agile', 'scrum', 'lean', 'six sigma', 'tdd', 'waterfall', 'kanban', 'devops', 'cro', 'seo', 'sem', 'fp&a']);
  if (methodologies.has(clean)) return 'methodology';

  const softSkills = new Set(['leadership', 'mentoring', 'communication', 'collaboration', 'stakeholder management', 'negotiation', 'problem solving', 'teamwork']);
  if (softSkills.has(clean)) return 'soft_skill';

  const domains = new Set(['finance', 'marketing', 'sales', 'operations', 'design', 'security', 'logistics', 'supply chain', 'b2b sales', 'enterprise sales']);
  if (domains.has(clean)) return 'domain';

  return 'technical';
}

export function extractKeywords(text: string): { keywords: Set<string>; displayMap: Map<string, string>; frequency: Map<string, number>; dictionarySkills: Set<string> } {
  const displayMap = new Map<string, string>();
  const frequency = new Map<string, number>();
  const keywords = new Set<string>();
  const dictionarySkills = new Set<string>();

  for (const skill of COMMON_SKILLS) {
    const regex = new RegExp(`\\b${escapeRegExp(skill)}(?:s|es)?\\b`, 'gi');
    const matches = text.match(regex);
    if (matches && matches.length > 0) {
      const clean = cleanTerm(skill);
      keywords.add(clean);
      dictionarySkills.add(clean);
      displayMap.set(clean, skill);
      frequency.set(clean, matches.length);
    }
  }

  const words = text
    .split(/\s+/)
    .map(w => w.replace(/^[^\w+#]+|[^\w+#]+$/g, ''))
    .filter(Boolean);

  for (let i = 0; i < words.length; i++) {
    const w1 = words[i];
    const clean1 = cleanTerm(w1);

    if (clean1.length > 2 && !STOP_WORDS.has(clean1) && !/^\d+$/.test(clean1)) {
      if (!keywords.has(clean1)) {
        keywords.add(clean1);
        displayMap.set(clean1, capitalizeWord(w1));
      }
      frequency.set(clean1, (frequency.get(clean1) || 0) + 1);
    }

    if (i < words.length - 1) {
      const w2 = words[i + 1];
      const clean2 = cleanTerm(w2);
      if (!STOP_WORDS.has(clean1) && !STOP_WORDS.has(clean2)) {
        const biGram = `${clean1} ${clean2}`;
        const cleanBiGram = cleanTerm(biGram);
        if (cleanBiGram.length > 5) {
          keywords.add(cleanBiGram);
          displayMap.set(cleanBiGram, `${capitalizeWord(w1)} ${capitalizeWord(w2)}`);
          frequency.set(cleanBiGram, (frequency.get(cleanBiGram) || 0) + 1);
        }
      }
    }
  }

  return { keywords, displayMap, frequency, dictionarySkills };
}

export function detectTargetRole(jobDescription: string): string | null {
  const lines = jobDescription.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines.slice(0, 10)) {
    const titleMatch = line.match(/(?:job title|role|position):\s*([a-zA-Z0-9\s/-]+)/i);
    if (titleMatch && titleMatch[1]) {
      return titleMatch[1].trim();
    }
  }

  const commonRoles = [
    'Senior Software Engineer', 'Software Engineer', 'Graduate Software Engineer',
    'Frontend Developer', 'Backend Developer', 'Full Stack Engineer',
    'Data Scientist', 'Data Analyst', 'Data Engineer',
    'Digital Marketing Manager', 'Marketing Manager',
    'Financial Analyst', 'Senior Product Manager', 'Product Manager',
    'Engineering Manager', 'B2B Sales Manager', 'Sales Manager',
    'Enterprise Account Executive', 'Senior UX/UI Designer', 'UX/UI Designer',
    'Operations Manager', 'DevOps Engineer', 'Solutions Architect'
  ];

  for (const role of commonRoles) {
    if (new RegExp(`\\b${escapeRegExp(role)}\\b`, 'i').test(jobDescription)) {
      return role;
    }
  }

  if (lines.length > 0 && lines[0].length < 40 && !lines[0].includes('.')) {
    return lines[0];
  }

  return null;
}

export function analyzeKeywords(resumeText: string, jobDescriptionText?: string): KeywordMatchResult {
  const resumeExtracted = extractKeywords(resumeText);

  if (!jobDescriptionText || jobDescriptionText.trim().length < 20) {
    const resumeSkillsDisplay: string[] = [];
    const classifiedKeywords: ClassifiedKeyword[] = [];
    const seenClean = new Set<string>();

    for (const skill of COMMON_SKILLS) {
      const clean = cleanTerm(skill);
      if (resumeExtracted.keywords.has(clean) && !seenClean.has(clean)) {
        seenClean.add(clean);
        resumeSkillsDisplay.push(skill);
        const count = resumeExtracted.frequency.get(clean) || 1;
        const category = classifyTerm(skill);
        classifiedKeywords.push({
          keyword: skill,
          category,
          importance: 'medium',
          matched: true,
          occurrences: count,
          contextualMatch: count <= 8 && count >= 1
        });
      }
    }

    const overusedKeywords: string[] = [];
    for (const [cleanKey, count] of resumeExtracted.frequency.entries()) {
      if (count > 10 && !STOP_WORDS.has(cleanKey)) {
        overusedKeywords.push(resumeExtracted.displayMap.get(cleanKey) || cleanKey);
      }
    }

    const rawScore = Math.min(100, Math.round((resumeSkillsDisplay.length / 8) * 100));
    const stuffingPenalty = Math.min(15, overusedKeywords.length * 5);
    const finalScore = Math.max(40, Math.min(100, rawScore - stuffingPenalty));

    return {
      score: finalScore,
      matchedKeywords: resumeSkillsDisplay.slice(0, 30),
      missingKeywords: [],
      overusedKeywords: overusedKeywords.slice(0, 5),
      targetRole: null,
      roleAlignment: 'Good',
      classifiedKeywords: classifiedKeywords.slice(0, 30)
    };
  }

  const jdExtracted = extractKeywords(jobDescriptionText);
  const targetRole = detectTargetRole(jobDescriptionText);

  const matchedKeywords: string[] = [];
  const missingKeywords: string[] = [];
  const overusedKeywords: string[] = [];
  const classifiedKeywords: ClassifiedKeyword[] = [];

  const jdPriorityKeywords = new Set<string>();

  // Only add recognized dictionary skills explicitly matched in JD
  for (const cleanSkill of jdExtracted.dictionarySkills) {
    jdPriorityKeywords.add(cleanSkill);
  }

  for (const cleanKey of jdPriorityKeywords) {
    const displayLabel = jdExtracted.displayMap.get(cleanKey) || resumeExtracted.displayMap.get(cleanKey) || cleanKey;
    const isMatched = resumeExtracted.keywords.has(cleanKey);
    const resumeOccurrences = resumeExtracted.frequency.get(cleanKey) || 0;
    const category = classifyTerm(displayLabel);
    const importance = jdExtracted.frequency.get(cleanKey) && (jdExtracted.frequency.get(cleanKey)! > 2) ? 'high' : 'medium';

    classifiedKeywords.push({
      keyword: displayLabel,
      category,
      importance,
      matched: isMatched,
      occurrences: resumeOccurrences,
      contextualMatch: isMatched && resumeOccurrences <= 8
    });

    if (isMatched) {
      if (!matchedKeywords.includes(displayLabel)) {
        matchedKeywords.push(displayLabel);
      }
    } else {
      if (!missingKeywords.includes(displayLabel)) {
        missingKeywords.push(displayLabel);
      }
    }
  }

  for (const [cleanKey, count] of resumeExtracted.frequency.entries()) {
    if (count > 10 && !STOP_WORDS.has(cleanKey)) {
      const displayLabel = resumeExtracted.displayMap.get(cleanKey) || cleanKey;
      if (!overusedKeywords.includes(displayLabel)) {
        overusedKeywords.push(displayLabel);
      }
    }
  }

  const totalPriority = jdPriorityKeywords.size || 1;
  const matchRatio = matchedKeywords.length / totalPriority;
  let score = Math.min(100, Math.round(matchRatio * 100));

  if (overusedKeywords.length > 0) {
    score = Math.max(20, score - (overusedKeywords.length * 5));
  }

  let roleAlignment: 'Strong' | 'Good' | 'Fair' | 'Weak' | 'None' = 'Fair';
  if (targetRole) {
    if (new RegExp(`\\b${escapeRegExp(targetRole)}\\b`, 'i').test(resumeText)) {
      roleAlignment = 'Strong';
    } else if (score >= 75) {
      roleAlignment = 'Good';
    } else if (score >= 50) {
      roleAlignment = 'Fair';
    } else if (score >= 25) {
      roleAlignment = 'Weak';
    } else {
      roleAlignment = 'None';
    }
  } else {
    roleAlignment = score >= 75 ? 'Good' : score >= 50 ? 'Fair' : 'Weak';
  }

  return {
    score,
    matchedKeywords: matchedKeywords.slice(0, 30),
    missingKeywords: missingKeywords.slice(0, 15),
    overusedKeywords: overusedKeywords.slice(0, 5),
    targetRole,
    roleAlignment,
    classifiedKeywords: classifiedKeywords.slice(0, 30)
  };
}
