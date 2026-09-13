export const ATS_SCORING_WEIGHTS = {
  keywordRelevance: 25,     // 25%
  skillsMatch: 15,          // 15%
  experienceRelevance: 15,  // 15%
  achievementQuality: 10,   // 10%
  resumeStructure: 10,      // 10%
  atsFormatting: 10,        // 10%
  jobMatch: 5,              // 5%
  sectionCompleteness: 5,   // 5%
  readability: 3,           // 3%
  contactInfo: 2            // 2%
};

export type KeywordCategory =
  | 'required'
  | 'preferred'
  | 'technical'
  | 'soft_skill'
  | 'industry'
  | 'role_specific'
  | 'tool'
  | 'certification'
  | 'methodology'
  | 'domain';

export interface ClassifiedKeyword {
  keyword: string;
  category: KeywordCategory;
  importance: 'high' | 'medium' | 'low';
  matched: boolean;
  occurrences: number;
  contextualMatch: boolean;
}

export const SECTION_ALIASES: Record<string, string[]> = {
  experience: [
    'experience',
    'work experience',
    'professional experience',
    'employment experience',
    'employment history',
    'career history',
    'work history',
    'career experience',
    'relevant experience',
    'professional background',
    'practical experience'
  ],
  education: [
    'education',
    'academic background',
    'academic qualifications',
    'educational background',
    'educational qualifications',
    'academic history',
    'studies',
    'academic credentials'
  ],
  skills: [
    'skills',
    'technical skills',
    'core skills',
    'core competencies',
    'technical competencies',
    'professional skills',
    'key skills',
    'competencies',
    'technologies',
    'proficiencies',
    'technical expertise',
    'skills and competencies',
    'skills & competencies',
    'technical skills and tools',
    'technical skills & tools',
    'skills and tools',
    'skills & tools'
  ],
  projects: [
    'projects',
    'personal projects',
    'academic projects',
    'selected projects',
    'technical projects',
    'key projects',
    'featured projects'
  ],
  certifications: [
    'certifications',
    'certificates',
    'professional certifications',
    'licenses and certifications',
    'licenses & certifications',
    'licenses',
    'certifications and skills',
    'certifications & skills',
    'credentials'
  ],
  summary: [
    'summary',
    'professional summary',
    'career summary',
    'profile',
    'professional profile',
    'career profile',
    'about me',
    'executive summary',
    'summary of qualifications'
  ],
  objective: [
    'objective',
    'career objective',
    'professional objective'
  ],
  achievements: [
    'achievements',
    'key achievements',
    'accomplishments',
    'awards and achievements',
    'awards & achievements'
  ],
  publications: [
    'publications',
    'research publications',
    'patents and publications',
    'patents & publications'
  ],
  awards: [
    'awards',
    'honors',
    'honours',
    'awards and honors',
    'awards & honors'
  ],
  interests: [
    'interests',
    'hobbies',
    'activities',
    'extracurricular activities'
  ],
  references: [
    'references',
    'professional references'
  ]
};

export type FormattingRiskLevel = 'safe' | 'low risk' | 'medium risk' | 'high risk';
