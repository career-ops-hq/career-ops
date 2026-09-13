import type { ContactInfo } from './types';

// Lightweight geographic reference data
const COMMON_CITIES = new Set([
  'kolkata', 'bengaluru', 'bangalore', 'mumbai', 'delhi', 'new delhi', 'hyderabad', 'pune', 'chennai',
  'gurgaon', 'gurugram', 'noida', 'ahmedabad', 'jaipur', 'chandigarh',
  'new york', 'san francisco', 'los angeles', 'chicago', 'seattle', 'austin', 'boston', 'san jose',
  'san diego', 'dallas', 'houston', 'atlanta', 'denver', 'portland', 'miami', 'washington',
  'london', 'toronto', 'vancouver', 'sydney', 'melbourne', 'berlin', 'paris', 'amsterdam',
  'singapore', 'tokyo', 'dubai', 'dublin', 'zurich', 'stockholm', 'remote'
]);

const COMMON_COUNTRIES_REGIONS = new Set([
  'india', 'usa', 'us', 'united states', 'uk', 'united kingdom', 'canada', 'australia',
  'germany', 'france', 'singapore', 'japan', 'netherlands', 'spain', 'italy', 'brazil',
  'mexico', 'sweden', 'switzerland', 'ireland', 'uae', 'remote'
]);

const US_CA_STATES = new Set([
  'ny', 'ca', 'tx', 'wa', 'fl', 'il', 'ma', 'pa', 'ga', 'nc', 'co', 'nj', 'va', 'or', 'mi', 'oh',
  'on', 'bc', 'qc', 'ab',
  'new york', 'california', 'texas', 'washington', 'florida', 'illinois', 'massachusetts',
  'pennsylvania', 'georgia', 'colorado', 'maharashtra', 'karnataka', 'tamil nadu', 'ontario'
]);

// Tech blocklist to prevent false-positive locations & names
const TECH_BLOCKLIST = new Set([
  'github', 'vs', 'vs code', 'vscode', 'react', 'react.js', 'reactjs', 'node', 'node.js', 'nodejs',
  'javascript', 'typescript', 'js', 'ts', 'python', 'java', 'c++', 'c#', 'html', 'css', 'html5', 'css3',
  'aws', 'docker', 'kubernetes', 'git', 'sql', 'mysql', 'postgresql', 'mongodb', 'rest', 'rest api',
  'graphql', 'express', 'express.js', 'vue', 'vue.js', 'angular', 'svelte', 'next.js', 'nextjs',
  'astro', 'tailwind', 'bootstrap', 'figma', 'jira', 'agile', 'scrum', 'redux', 'webpack', 'vite',
  'ci/cd', 'linux', 'bash', 'shell', 'developer', 'engineer', 'architect'
]);

const RESUME_HEADINGS = new Set([
  'resume', 'cv', 'curriculum vitae', 'profile', 'professional resume', 'contact', 'contact info',
  'about me', 'work experience', 'experience', 'professional experience', 'employment history',
  'career history', 'work history', 'education', 'academic background', 'skills', 'technical skills',
  'core skills', 'key skills', 'competencies', 'technologies', 'summary', 'professional summary',
  'career summary', 'objective', 'career objective', 'projects', 'personal projects',
  'certifications', 'achievements', 'awards', 'publications', 'references'
]);

const JOB_TITLE_WORDS = new Set([
  'engineer', 'developer', 'architect', 'manager', 'specialist', 'analyst', 'consultant',
  'designer', 'intern', 'lead', 'head', 'director', 'administrator', 'programmer', 'tester'
]);

/**
 * Handle spaced characters artifact from PDF text extraction
 * e.g. "S u j o y   M o u l i c k" -> "Sujoy Moulick"
 */
function fixSpacedTextArtifacts(line: string): string {
  if (!line) return line;
  // Match single characters separated by spaces: "S u j o y"
  if (/^([A-Za-z0-9]\s+){2,}[A-Za-z0-9]$/.test(line.trim())) {
    return line.replace(/\s+/g, '');
  }
  // Replace spaced words: "S u j o y   M o u l i c k"
  return line.replace(/\b([A-Za-z])\s+([A-Za-z])(?:\s+([A-Za-z]))*(?=\s{2,}|\b)/g, (match) => {
    return match.replace(/\s+/g, '');
  });
}

/**
 * Extract normalized contact information from resume lines and text.
 */
export function extractContactInfo(lines: string[], rawText: string): ContactInfo {
  // Pre-process lines
  const cleanedLines = lines
    .map(l => fixSpacedTextArtifacts(l.trim()))
    .filter(l => l.length > 0);

  // Define Header Region (first 25 meaningful lines or up to first standard section header)
  const headerLines: string[] = [];
  for (const line of cleanedLines) {
    const lower = line.toLowerCase().replace(/[:\-_#]/g, '').trim();
    if (RESUME_HEADINGS.has(lower) && headerLines.length >= 2) {
      // Reached a major section heading after header region
      break;
    }
    headerLines.push(line);
    if (headerLines.length >= 25) break;
  }

  const headerText = headerLines.join('\n');
  const fullText = cleanedLines.join('\n');

  // 1. Email Extraction
  let email: string | null = null;
  let emailDomain: string | null = null;
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
  const emailMatches = headerText.match(emailRegex) || fullText.match(emailRegex);
  if (emailMatches && emailMatches.length > 0) {
    email = emailMatches[0].trim();
    const parts = email.split('@');
    if (parts.length > 1) {
      emailDomain = parts[1].toLowerCase().trim();
    }
  }

  // 2. Phone Extraction
  let phone: string | null = null;
  // Phone regex supporting +91 9876543210, +1 555 123 4567, (555) 123-4567, 9876543210, +44 20 1234 5678
  const phoneRegex = /(?:\+\d{1,4}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g;
  const phoneCandidates = headerText.match(phoneRegex) || fullText.match(phoneRegex) || [];
  for (const candidate of phoneCandidates) {
    const digitsOnly = candidate.replace(/\D/g, '');
    // Ignore standalone 4-digit years (e.g. 2024, 2023) or short numbers
    if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
      // Check it's not a year like 2020-2024
      if (/^(19|20)\d{2}$/.test(digitsOnly)) continue;
      phone = candidate.trim();
      break;
    }
  }

  // 3. LinkedIn Extraction
  let linkedIn: string | null = null;
  const linkedInRegex = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9_\-\.]+)\/?/gi;
  const linkedInMatch = linkedInRegex.exec(headerText) || linkedInRegex.exec(fullText);
  if (linkedInMatch) {
    const handle = linkedInMatch[1].replace(/\/$/, '');
    linkedIn = `linkedin.com/in/${handle}`;
  }

  // 4. GitHub Extraction
  let github: string | null = null;
  const githubRegex = /(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_\-\.]+)\/?/gi;
  const githubMatch = githubRegex.exec(headerText) || githubRegex.exec(fullText);
  if (githubMatch) {
    const handle = githubMatch[1].replace(/\/$/, '');
    // Ignore common non-user github paths if any
    if (!['features', 'topics', 'trending', 'pricing', 'about'].includes(handle.toLowerCase())) {
      github = `github.com/${handle}`;
    }
  }

  // 5. Portfolio / Website Extraction
  let website: string | null = null;
  // Crucial: remove all email addresses from text before searching for URLs to avoid email domain false positives
  const textWithoutEmails = (headerText + '\n' + fullText).replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi, ' ');
  
  const urlRegex = /(?:https?:\/\/|www\.)[a-zA-Z0-9.\-]+(?:\.[a-zA-Z]{2,})(?:\/[^\s]*)?|\b[a-zA-Z0-9.\-]+\.(?:dev|io|me|app|portfolio|tech|design|com|org|net|co|xyz)(?:\/[^\s]*)?\b/gi;
  const urlMatches = textWithoutEmails.match(urlRegex) || [];

  // Common public email host domains that should never be classified as portfolio websites
  const genericEmailDomains = new Set([
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
    'email.com', 'mail.com', 'proton.me', 'protonmail.com', 'aol.com',
    'zoho.com', 'gmx.com', 'yandex.com', 'rediffmail.com', 'live.com'
  ]);

  const socialDomains = [
    'linkedin.com', 'github.com', 'twitter.com', 'x.com', 'facebook.com',
    'instagram.com', 'youtube.com', 'medium.com', 'gitlab.com', 'bitbucket.org',
    'dribbble.com', 'behance.net'
  ];

  for (let match of urlMatches) {
    // Clean trailing punctuation
    let urlCandidate = match.trim().replace(/[\.,\);:]+$/, '');
    const lowerUrl = urlCandidate.toLowerCase();

    // Skip social domains
    if (socialDomains.some(sd => lowerUrl.includes(sd))) continue;

    // Skip generic email host domains
    if (genericEmailDomains.has(lowerUrl) || genericEmailDomains.has(lowerUrl.replace(/^www\./, ''))) continue;

    // Normalize URL format
    urlCandidate = urlCandidate.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    if (urlCandidate.length > 3) {
      website = urlCandidate;
      break;
    }
  }

  // 6. Name Detection & Confidence Scoring
  let bestName: string | null = null;
  let highestNameScore = 0;

  // We analyze the first 15 lines of the header region
  const nameSearchLines = headerLines.slice(0, 15);

  // We also split lines by '|' or '•' or '·' in case header is "Sujoy Moulick | Software Engineer | email"
  const candidatePhrases: { text: string; lineIndex: number; posInLine: number }[] = [];

  nameSearchLines.forEach((line, idx) => {
    const parts = line.split(/[|•·]/).map(p => p.trim()).filter(p => p.length > 0);
    parts.forEach((part, pIdx) => {
      candidatePhrases.push({ text: part, lineIndex: idx, posInLine: pIdx });
    });
  });

  // Calculate email / phone / url line positions
  let firstContactLineIndex = 999;
  candidatePhrases.forEach(item => {
    if (
      (email && item.text.includes(email)) ||
      (phone && item.text.includes(phone)) ||
      (linkedIn && item.text.includes('linkedin.com')) ||
      (github && item.text.includes('github.com'))
    ) {
      if (item.lineIndex < firstContactLineIndex) {
        firstContactLineIndex = item.lineIndex;
      }
    }
  });

  for (const { text: candidate, lineIndex, posInLine } of candidatePhrases) {
    const lower = candidate.toLowerCase();

    // Strict disqualifiers
    if (candidate.includes('@')) continue;
    if (/https?:\/\/|www\./i.test(candidate)) continue;
    if (/\d/.test(candidate)) continue;
    if (RESUME_HEADINGS.has(lower.replace(/[:\-_#]/g, ''))) continue;

    const words = candidate.split(/\s+/).filter(w => w.length > 0);
    if (words.length < 2 || words.length > 5) continue;

    // Check tech blocklist
    const hasTechKeyword = words.some(w => TECH_BLOCKLIST.has(w.toLowerCase()));
    if (hasTechKeyword) continue;

    let score = 0;

    // Scoring signals
    // +40 -> candidate appears in first 5 lines
    if (lineIndex < 5) score += 40;

    // +25 -> 2-4 alphabetic words
    if (words.length >= 2 && words.length <= 4) score += 25;

    // +15 -> title-case/name-like capitalization
    const isTitleCase = words.every(w => /^[A-Z][a-zA-Z'\-]*$/ .test(w) || /^[A-Z]\.$/.test(w));
    if (isTitleCase) score += 15;

    // +10 -> no punctuation (allow single initial dot)
    if (/^[A-Za-z\s]+$/.test(candidate) || /^[A-Z][a-z]+\s+[A-Z]\.\s+[A-Z][a-z]+$/.test(candidate)) {
      score += 10;
    }

    // +10 -> appears before contact details
    if (lineIndex < firstContactLineIndex) score += 10;

    // Penalties
    if (words.some(w => JOB_TITLE_WORDS.has(w.toLowerCase()))) score -= 30;
    if (posInLine > 0) score -= 15;

    if (score > highestNameScore) {
      highestNameScore = score;
      bestName = candidate;
    }
  }

  // Require minimum confidence score of 50 for name
  if (highestNameScore >= 50 && bestName) {
    bestName = bestName.trim();
  } else {
    bestName = null;
  }

  // 7. Location Detection
  let location: string | null = null;

  // Signal A: Explicit prefix label in header
  for (const line of headerLines) {
    const labelMatch = line.match(/^(?:location|address|city|based in|residence)\s*:\s*(.+)$/i);
    if (labelMatch) {
      const locVal = labelMatch[1].trim();
      if (!locVal.includes('@') && !/\d{5,}/.test(locVal)) {
        // Ensure no tech blocklist
        const lowerLoc = locVal.toLowerCase();
        if (!Array.from(TECH_BLOCKLIST).some(tb => lowerLoc.includes(tb))) {
          location = locVal;
          break;
        }
      }
    }
  }

  // Signal B: Pattern match in header lines (e.g. "Kolkata, India" or "New York, NY")
  if (!location) {
    for (const line of headerLines) {
      // Split line into phrases by pipe / bullet
      const parts = line.split(/[|•·]/).map(p => p.trim());
      for (const part of parts) {
        if (!part || part.includes('@') || /https?:\/\//i.test(part)) continue;

        const lowerPart = part.toLowerCase();

        // Prevent false positives like "GitHub, VS" or "React, Node.js"
        const hasTechBlock = Array.from(TECH_BLOCKLIST).some(tb => lowerPart.includes(tb));
        if (hasTechBlock) continue;

        // Check if line contains a comma or geographic match
        const commaParts = part.split(',').map(cp => cp.trim().toLowerCase());
        if (commaParts.length >= 2) {
          const first = commaParts[0];
          const second = commaParts[1];
          const third = commaParts[2];

          const firstIsCity = COMMON_CITIES.has(first);
          const secondIsStateOrCountry = COMMON_COUNTRIES_REGIONS.has(second) || US_CA_STATES.has(second);
          const thirdIsCountry = third ? COMMON_COUNTRIES_REGIONS.has(third) : false;

          if (firstIsCity || secondIsStateOrCountry || thirdIsCountry) {
            location = part;
            break;
          }
        }
      }
      if (location) break;
    }
  }

  return {
    name: bestName,
    email,
    phone,
    location,
    linkedIn,
    github,
    website,
    portfolio: website
  };
}
