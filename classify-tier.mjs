#!/usr/bin/env node

/**
 * classify-tier.mjs — Seniority-tier classifier for job titles
 *
 * Classifies a job title into one of the following tiers:
 *   - 'intern'
 *   - 'entry'
 *   - 'mid'
 *   - 'senior'
 *
 * It uses weighted keyword matching to handle conflicts (higher weight wins).
 * Default tier is 'mid' if no keywords match.
 */

import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Classifies a job title into exactly one seniority tier.
 *
 * NOTE: Unrecognized or plain titles (e.g., "Software Engineer" with no explicit level
 * indicators) fall back to 'mid' as the default/unknown bucket. Consequently, configuring
 * `skip_tiers: [mid]` in portals.yml will exclude most unmatched/ordinary listings, not
 * just explicit mid-level roles.
 *
 * @param {string} title - The job title to classify.
 * @returns {'intern' | 'entry' | 'mid' | 'senior'}
 */
export function classifyTier(title) {
  if (typeof title !== 'string') {
    return 'mid';
  }

  // Preprocess title to avoid false positives with common acronyms
  let cleanTitle = title
    .replace(/\bA\.I\./ig, 'AI')
    .replace(/\bA\.I\b/ig, 'AI')
    .replace(/\bA\.\s+I\b/ig, 'AI')
    .replace(/\bI\.T\./ig, 'IT')
    .replace(/\bI\.T\b/ig, 'IT')
    .replace(/\bI\.\s+T\b/ig, 'IT')
    .replace(/\bi\/o\b/ig, 'IO');

  // Define matchers with tier and weight (higher weight wins)
  const matchers = [
    // Senior Tier (weight 4)
    { pattern: /\bchief\b/i, tier: 'senior', weight: 4 },
    { pattern: /\bvp\b/i, tier: 'senior', weight: 4 },
    { pattern: /\bvice\s+president\b/i, tier: 'senior', weight: 4 },
    { pattern: /\bdirector\b/i, tier: 'senior', weight: 4 },
    { pattern: /\bprincipal\b/i, tier: 'senior', weight: 4 },
    { pattern: /\bstaff\b/i, tier: 'senior', weight: 4 },
    { pattern: /\blead\b/i, tier: 'senior', weight: 4 },
    { pattern: /\bsenior\b/i, tier: 'senior', weight: 4 },
    { pattern: /\bsr\b/i, tier: 'senior', weight: 4 },
    { pattern: /\bsr\./i, tier: 'senior', weight: 4 },
    { pattern: /\bhead\s+of\b/i, tier: 'senior', weight: 4 },
    { pattern: /\b[a-z]{2,}[\s-](iii|iv|v)\b/i, tier: 'senior', weight: 4 },

    // Mid Tier (weight 3)
    { pattern: /\bmid-level\b/i, tier: 'mid', weight: 3 },
    { pattern: /\bmid\b/i, tier: 'mid', weight: 3 },
    { pattern: /\b[a-z]{2,}[\s-](ii)\b/i, tier: 'mid', weight: 3 },
    { pattern: /\b(l4|l5)\b/i, tier: 'mid', weight: 3 },

    // Entry Tier (weight 2)
    { pattern: /\bentry-level\b/i, tier: 'entry', weight: 2 },
    { pattern: /\bentry\b/i, tier: 'entry', weight: 2 },
    { pattern: /\bassociate\b/i, tier: 'entry', weight: 2 },
    { pattern: /\bjunior\b/i, tier: 'entry', weight: 2 },
    { pattern: /\b[a-z]{2,}[\s-](i)\b/i, tier: 'entry', weight: 2 },
    { pattern: /\b(l1|l2)\b/i, tier: 'entry', weight: 2 },

    // Intern Tier (weight 1)
    { pattern: /\binternship\b/i, tier: 'intern', weight: 1 },
    { pattern: /\bintern\b/i, tier: 'intern', weight: 1 },
    { pattern: /\btrainee\b/i, tier: 'intern', weight: 1 },
    { pattern: /\bco-op\b/i, tier: 'intern', weight: 1 },
    {
      pattern: {
        test: (t) => /\bgraduate\b/i.test(t) && /\b(program|scheme)\b/i.test(t)
      },
      tier: 'intern',
      weight: 1
    }
  ];

  let bestMatch = null;

  for (const matcher of matchers) {
    if (matcher.pattern.test(cleanTitle)) {
      if (!bestMatch || matcher.weight > bestMatch.weight) {
        bestMatch = matcher;
      }
    }
  }

  return bestMatch ? bestMatch.tier : 'mid';
}

export default classifyTier;

// CLI and inline test mode
const isDirect = process.argv[1] &&
  (path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)));

if (isDirect) {
  const args = process.argv.slice(2);
  if (args.includes('--test')) {
    runTests();
  } else if (args.length > 0) {
    console.log(classifyTier(args[0]));
  } else {
    console.log('Usage:');
    console.log('  node classify-tier.mjs "<job-title>"');
    console.log('  node classify-tier.mjs --test');
  }
}

function runTests() {
  const testCases = [
    { title: "Software Engineer Intern", expected: "intern" },
    { title: "Junior Software Engineer", expected: "entry" },
    { title: "Software Engineer I", expected: "entry" },
    { title: "Software Engineer II", expected: "mid" },
    { title: "Senior Software Engineer", expected: "senior" },
    { title: "Staff Engineer", expected: "senior" },
    { title: "Principal Engineer", expected: "senior" },
    { title: "VP of Engineering", expected: "senior" },
    { title: "Engineering Intern Program", expected: "intern" },
    { title: "Software Engineer", expected: "mid" },
    { title: "Senior Intern Coordinator", expected: "senior" },
    // additional checks to verify our regex logic
    { title: "Graduate Engineer", expected: "mid" },
    { title: "Graduate Engineer Program", expected: "intern" },
    { title: "A.I. Researcher", expected: "mid" },
    { title: "I.T. Specialist II", expected: "mid" }
  ];

  let failed = 0;
  console.log("Running classify-tier.mjs tests...");
  for (const { title, expected } of testCases) {
    const result = classifyTier(title);
    if (result === expected) {
      console.log(`✅ [PASS] "${title}" -> ${result}`);
    } else {
      console.error(`❌ [FAIL] "${title}": expected ${expected}, got ${result}`);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\nTest run failed: ${failed} failure(s)`);
    process.exit(1);
  } else {
    console.log("\nAll tests passed successfully!");
    process.exit(0);
  }
}
