import type { DetectedSection } from './types.ts';
import { extractContactInfo } from './contactExtractor.ts';
import { SECTION_ALIASES } from './data/ats-scoring-rules.ts';

export { extractContactInfo };

/**
 * Normalizes any section heading text by removing LaTeX markup,
 * stripping punctuation, handling spaced-out characters, and converting to clean lower-case.
 */
export function normalizeSectionHeading(text: string): string {
  if (!text) return '';

  let str = text;

  // 1. Remove LaTeX section syntax & formatting commands
  str = str
    .replace(/\\section\*?\{([^}]+)\}/gi, '$1')
    .replace(/\\subsection\*?\{([^}]+)\}/gi, '$1')
    .replace(/\\scshape\b/gi, '')
    .replace(/\\textbf\{([^}]+)\}/gi, '$1')
    .replace(/\\textit\{([^}]+)\}/gi, '$1')
    .replace(/\\underline\{([^}]+)\}/gi, '$1')
    .replace(/\\Huge\b|\\huge\b|\\Large\b|\\large\b|\\small\b/gi, '')
    .replace(/\\[a-zA-Z]+/g, ' ');

  // 2. Convert to lower case
  str = str.toLowerCase();

  // 3. Handle spaced-out characters (e.g. "E D U C A T I O N" -> "education")
  if (/^(?:[a-z]\s+){3,}[a-z]$/i.test(str.trim())) {
    str = str.replace(/\s+/g, '');
  }

  // 4. Remove leading numbers/bullets/dashes (e.g. "1. Education" -> "education")
  str = str.replace(/^[•\-\*\–\—\d.\)\s]+/, '');

  // 5. Normalize ampersands & common separators
  str = str.replace(/\s*&\s*/g, ' and ');

  // 6. Remove unnecessary punctuation (colons, pipes, dashes, hashes, underscores, dots, quotes)
  str = str.replace(/[:\|\-\—\–#_\*~"'\.]/g, ' ');

  // 7. Normalize multiple spaces and trim
  str = str.replace(/\s+/g, ' ').trim();

  return str;
}

const CANONICAL_NAMES: Record<string, string> = {
  experience: 'Work Experience',
  education: 'Education',
  skills: 'Skills',
  summary: 'Summary',
  projects: 'Projects',
  certifications: 'Certifications',
  achievements: 'Achievements',
  objective: 'Objective',
  publications: 'Publications',
  awards: 'Awards',
  interests: 'Interests',
  references: 'References'
};

export interface SectionMatchResult {
  sectionKey: string;
  canonicalName: string;
  detectedHeading: string;
  normalizedHeading: string;
  standard: boolean;
  confidence: number;
}

/**
 * Matches a raw heading text against standard ATS section aliases.
 */
export function matchSectionHeading(rawHeading: string): SectionMatchResult | null {
  const normalized = normalizeSectionHeading(rawHeading);
  if (!normalized) return null;

  for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
    for (const alias of aliases) {
      const normalizedAlias = normalizeSectionHeading(alias);
      if (normalized === normalizedAlias) {
        return {
          sectionKey: key,
          canonicalName: CANONICAL_NAMES[key] || key.charAt(0).toUpperCase() + key.slice(1),
          detectedHeading: rawHeading.trim(),
          normalizedHeading: normalized,
          standard: true,
          confidence: 1.0
        };
      }
    }
  }

  // Secondary partial phrase check
  for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
    for (const alias of aliases) {
      const normalizedAlias = normalizeSectionHeading(alias);
      if (normalized.startsWith(normalizedAlias + ' ') || normalized.endsWith(' ' + normalizedAlias)) {
        return {
          sectionKey: key,
          canonicalName: CANONICAL_NAMES[key] || key.charAt(0).toUpperCase() + key.slice(1),
          detectedHeading: rawHeading.trim(),
          normalizedHeading: normalized,
          standard: true,
          confidence: 0.9
        };
      }
    }
  }

  return null;
}

export function detectResumeSections(lines: string[], text: string): DetectedSection[] {
  const sectionDefs = [
    { name: 'Work Experience', key: 'experience', isOptional: false },
    { name: 'Education', key: 'education', isOptional: false },
    { name: 'Skills', key: 'skills', isOptional: false },
    { name: 'Summary', key: 'summary', isOptional: true },
    { name: 'Projects', key: 'projects', isOptional: true },
    { name: 'Certifications', key: 'certifications', isOptional: true },
    { name: 'Achievements', key: 'achievements', isOptional: true }
  ];

  // Map to store match info per section key
  const detectedMap = new Map<string, {
    detectedHeading: string;
    normalizedHeading: string;
    standard: boolean;
    confidence: number;
    lineIndex: number;
  }>();

  // 1. Scan explicit lines (including LaTeX \section{...} calls)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check if line is a potential heading (short or LaTeX \section)
    const isLatexSec = line.includes('\\section') || line.includes('\\subsection');
    const isShortLine = line.length <= 60 && !/[.?;]$/.test(line);

    if (isLatexSec || isShortLine) {
      const match = matchSectionHeading(line);
      if (match && !detectedMap.has(match.sectionKey)) {
        detectedMap.set(match.sectionKey, {
          detectedHeading: match.detectedHeading,
          normalizedHeading: match.normalizedHeading,
          standard: match.standard,
          confidence: match.confidence,
          lineIndex: i
        });
      }
    }
  }

  // 2. Fallback scan in full text if line scanning missed standard headings
  if (text) {
    const textLines = text.split('\n');
    for (let i = 0; i < textLines.length; i++) {
      const line = textLines[i].trim();
      if (!line || line.length > 60 || /[.?;]$/.test(line)) continue;
      const match = matchSectionHeading(line);
      if (match && !detectedMap.has(match.sectionKey)) {
        detectedMap.set(match.sectionKey, {
          detectedHeading: match.detectedHeading,
          normalizedHeading: match.normalizedHeading,
          standard: match.standard,
          confidence: match.confidence,
          lineIndex: i
        });
      }
    }
  }

  // 3. Build final DetectedSection array
  return sectionDefs.map(def => {
    const matchInfo = detectedMap.get(def.key);
    return {
      name: def.name,
      key: def.key,
      found: !!matchInfo,
      isOptional: def.isOptional,
      detectedHeading: matchInfo?.detectedHeading,
      normalizedHeading: matchInfo?.normalizedHeading,
      standard: matchInfo ? matchInfo.standard : false,
      confidence: matchInfo ? matchInfo.confidence : 0,
      lineIndex: matchInfo?.lineIndex
    };
  });
}
