import type { ExperienceAnalysis } from './types.ts';
import { ACTION_VERBS, WEAK_PHRASES } from './data/actionVerbs.ts';

export function analyzeExperience(lines: string[], text: string): ExperienceAnalysis {
  const isSeparator = (line: string) => /^(?:-{3,}|\*{3,}|_{3,}|={3,}|\|{3,})$/.test(line.trim());
  const actionVerbSet = new Set(ACTION_VERBS.map(v => v.toLowerCase()));

  const bulletLines = lines.filter(l => {
    const trimmed = l.trim();
    if (isSeparator(trimmed) || trimmed.length < 10) return false;
    
    // Ignore skill list lines like "- Languages: ..." or "- Tools: ..."
    const cleanLine = trimmed.replace(/^[•\-\*\–\—\d.\)]+\s*/, '').trim();
    if (cleanLine.includes(':') && cleanLine.indexOf(':') < 25) {
      return false;
    }

    if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.startsWith('–') || trimmed.startsWith('—') || /^\d+[\.\)]/.test(trimmed)) {
      return true;
    }

    const firstWord = cleanLine.split(/\s+/)[0]?.toLowerCase() || '';
    if (actionVerbSet.has(firstWord) && !trimmed.includes('|')) {
      return true;
    }

    return false;
  });

  const totalBullets = Math.max(bulletLines.length, 1);
  let actionVerbCount = 0;
  let quantifiableCount = 0;
  const weakBullets: string[] = [];

  const metricRegex = /(?:\d+(?:\.\d+)?%(?!\w)|\$\d+(?:\.\d+)?[kKmMbB]?\b|\b\d+(?:\.\d+)?[kKmMbB]\b|\b\d+\+\b|\b\d+\s*(?:users|clients|customers|projects|team|members|engineers|developers|features|tickets|hours|percent|hrs|dau|mau|arr|roas|staff|quarters|years|transactions|retention)\b)/i;

  for (const line of bulletLines) {
    const cleanLine = line.replace(/^[•\-\*\–\—\d.\)]+\s*/, '').trim();
    const firstWord = cleanLine.split(/\s+/)[0]?.toLowerCase() || '';

    if (actionVerbSet.has(firstWord)) {
      actionVerbCount++;
    }

    if (metricRegex.test(line)) {
      quantifiableCount++;
    }

    const lowerLine = line.toLowerCase();
    for (const weakPhrase of WEAK_PHRASES) {
      if (lowerLine.includes(weakPhrase)) {
        if (weakBullets.length < 4 && !weakBullets.includes(line)) {
          weakBullets.push(line.trim());
        }
        break;
      }
    }
  }

  if (quantifiableCount === 0) {
    const matches = text.match(/(?:\d+(?:\.\d+)?%(?!\w)|\$\d+(?:\.\d+)?[kKmMbB]?\b|\b\d+(?:\.\d+)?[kKmMbB]\b)/gi);
    if (matches) {
      quantifiableCount = matches.length;
    }
  }

  const actionVerbScore = Math.min(100, Math.round((actionVerbCount / totalBullets) * 100));
  const quantifiableScore = Math.min(100, Math.round((quantifiableCount / Math.max(1, Math.ceil(totalBullets * 0.5))) * 100));

  let achievementScore = Math.round((actionVerbScore * 0.4) + (quantifiableScore * 0.6));
  if (weakBullets.length > 0) {
    achievementScore = Math.max(0, achievementScore - (weakBullets.length * 5));
  }
  achievementScore = Math.min(100, Math.max(0, achievementScore));

  return {
    actionVerbScore,
    quantifiableScore,
    bulletCount: bulletLines.length,
    quantifiableCount,
    actionVerbCount,
    hasWeakBullets: weakBullets.length > 0,
    weakBullets,
    achievementScore
  };
}
