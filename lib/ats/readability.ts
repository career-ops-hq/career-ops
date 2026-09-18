import type { ReadabilityAnalysis } from './types';

export function analyzeReadability(text: string, words: string[]): ReadabilityAnalysis {
  const wordCount = words.length;

  // Estimate sentence count
  const sentences = text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 5);

  const sentenceCount = Math.max(sentences.length, 1);
  const avgSentenceLength = Math.round(wordCount / sentenceCount);

  // Check uppercase text proportion
  const letters = text.replace(/[^a-zA-Z]/g, '');
  const upperLetters = text.replace(/[^A-Z]/g, '');
  const uppercaseRatio = letters.length > 0 ? upperLetters.length / letters.length : 0;
  const excessiveUppercase = uppercaseRatio > 0.35 && text.length > 300;

  // Check special characters ratio
  const specialChars = text.replace(/[a-zA-Z0-9\s.,;:'"()\-]/g, '');
  const excessiveSpecialChars = text.length > 0 && (specialChars.length / text.length) > 0.08;

  // Length status (400 - 1200 words is typically optimal for 1-2 pages)
  let lengthStatus: 'optimal' | 'too_short' | 'too_long' = 'optimal';
  let lengthFeedback = 'Resume length looks reasonable and appropriate.';

  if (wordCount < 200) {
    lengthStatus = 'too_short';
    lengthFeedback = 'Your resume contains very little content. Consider adding relevant experience, skills, or projects.';
  } else if (wordCount > 1500) {
    lengthStatus = 'too_long';
    lengthFeedback = 'Your resume is quite long (>1500 words). Ensure every line adds value and keep formatting crisp.';
  }

  return {
    wordCount,
    sentenceCount,
    avgSentenceLength,
    excessiveUppercase,
    excessiveSpecialChars,
    lengthStatus,
    lengthFeedback
  };
}
