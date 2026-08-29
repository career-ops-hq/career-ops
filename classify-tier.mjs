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

import { validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

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
        test: (t) => /\bgraduate\b/i.test(t) && /\b(program|scheme)\b/i.test(t),
        // Position of the level word itself, not of the "program" qualifier.
        // Deliberately NOT named `search`: overloading a String.prototype method
        // name on a matcher object makes `pattern.search(title)` read as the
        // built-in, which coerces its argument to a RegExp — CodeQL flagged it
        // as regex injection on the CLI's argv-derived title. The regex here is
        // a literal and nothing is compiled from input, but the name was the
        // problem, for a reader as much as for the analyzer.
        levelWordIndex: (t) => t.search(/\bgraduate\b/i)
      },
      tier: 'intern',
      weight: 1
    }
  ];

  // Guard (a): "Associate <senior noun>" resolves to senior. The `associate`
  // prefix qualifies the seniority band of a senior role; it does not demote it
  // to entry-level. Checked before the position loop because `associate` always
  // precedes the senior noun, so the leftmost-marker rule would fire on
  // `associate` at index 0 and return entry.
  //
  // The noun list is CLOSED, and has to stay that way: in plenty of fields
  // `associate` genuinely does mark the junior variant, and those must keep
  // resolving to entry — Associate Attorney, Associate Editor, Associate
  // Producer, Associate Manager, Associate Consultant. A generic "associate
  // never demotes" rule breaks every one of them.
  //
  // The academic ranks are on the list because `associate` names a RANK there
  // rather than a junior variant: Associate Professor is the rung above
  // Assistant Professor, and Dean/Provost/Chancellor/Superintendent head an
  // institution (#3178). The criterion is institution-level head, not
  // office-level deputy — which is why Registrar, Bursar and Librarian stay
  // off, along with Rector (a parish `associate rector` IS the junior one).
  const associateAt = cleanTitle.search(/\bassociate\b/i);
  if (associateAt >= 0) {
    // A junior marker that LEADS the title still decides it. "Intern, Associate
    // Dean of Student Life" is an internship in a dean's office, not a
    // deanship — the same doctrine the position loop below applies to
    // "Summer Intern, Director of Product". Without this the guard returns
    // early and inverts the very harm #3178 is about, on the same board.
    const juniorAt = cleanTitle.search(/\b(?:intern(?:ship)?|trainee|co-op|graduate|junior|entry(?:-level)?)\b/i);
    if (juniorAt < 0 || juniorAt > associateAt) {
      const afterAssociate = cleanTitle.slice(associateAt + 'associate'.length);
      // WHITESPACE only, and at most two words of gap. Both bounds carry
      // weight. Any comma or dash after `associate` means `associate` is the
      // role and what follows is a separate clause: "Research Associate -
      // Professor Smith Laboratory" and "Administrative Associate, Office of
      // the Dean" are junior roles that a to-end-of-string search reads as
      // senior. The two-word cap then stops "Office of the Dean" and real
      // employers named for a noun on this list — Dean & Company (whose entry
      // title is literally "Associate Consultant"), Dean Foods, Dean Witter,
      // Provost Umphrey. It also keeps the legal pair honest: bare `counsel`
      // is off the list because a firm's associate IS the junior lawyer, and
      // without the bound "Associate Counsel, Office of the General Counsel"
      // would match `general counsel` from the department name.
      if (/^\s+(?:[a-z]+\s+){0,2}(director|vice\s+president|vp|principal|partner|chief|head\s+of|professor|dean|provost|chancellor|superintendent|general\s+counsel)\b/i.test(afterAssociate)) {
        return 'senior';
      }
    }
  }

  // Guard (b): [intern/entry marker] + [programme bridge noun] + [senior role noun]
  // resolves to senior. "Intern Program Director" manages an intern programme; it is
  // not itself an internship. The bridge-noun set is a closed list — a generic
  // adjacency rule breaks "Junior Staff Accountant" (staff is a senior matcher but
  // not a bridge word for this construction).
  const programBridge = /\b(?:intern(?:ship)?|trainee|co-op|graduate|junior|entry(?:-level)?)\s+(?:program|scheme|talent|cohort)\b/i;
  if (programBridge.test(cleanTitle)) {
    const afterBridge = cleanTitle.replace(programBridge, ' ').trim();
    if (/\b(chief|vp|vice\s+president|director|principal|staff|lead|senior|sr\.?|head\s+of|partner)\b/i.test(afterBridge)) {
      return 'senior';
    }
  }

  // POSITION decides, not seniority rank. Ranking by weight meant any senior
  // word anywhere outranked an explicit programme marker, and in real titles
  // that word is usually naming the team, office or person the role sits beside
  // — "Summer Intern, Director of Product" is an internship. English job titles
  // put the level first, so the LEFTMOST marker is the role's own level. That
  // still reads "Senior Intern Coordinator" as senior: there the senior word
  // genuinely leads the title.
  //
  // This is not cosmetic: scan.mjs drops a posting whose tier is in
  // `skip_tiers` without naming it, so a junior candidate skipping `senior`
  // silently lost the internships they were scanning for.
  //
  // Weight survives only as the tie-break for two markers at the same offset,
  // which keeps the longer, more specific pattern of an overlapping pair
  // (`mid-level` over `mid`, `entry-level` over `entry`).
  let bestMatch = null;
  let bestIndex = Infinity;

  for (const matcher of matchers) {
    // Match first: the graduate matcher is a COMPOUND condition (graduate AND
    // program/scheme), so its position alone would fire on a bare "Graduate
    // Engineer" that the condition itself rejects.
    if (!matcher.pattern.test(cleanTitle)) continue;
    const index = typeof matcher.pattern.levelWordIndex === 'function'
      ? matcher.pattern.levelWordIndex(cleanTitle)
      : cleanTitle.search(matcher.pattern);
    if (index < 0) continue;
    if (index < bestIndex || (index === bestIndex && matcher.weight > bestMatch.weight)) {
      bestMatch = matcher;
      bestIndex = index;
    }
  }

  return bestMatch ? bestMatch.tier : 'mid';
}

export default classifyTier;

// CLI and inline test mode
const isDirect = isMainModule(import.meta.url);

// The title is the only positional, so `--help` was classified as a job title
// and answered `mid` at exit 0 (#2852). Validated up front via
// lib/cli-flags.mjs's validateFlags() (#2775), which also rejects unrecognized
// flags before --help so `--help --bogus` still errors.
const KNOWN_FLAGS = ['--test', '--help', '-h'];

const USAGE = `Usage:
  node classify-tier.mjs "<job-title>"   # print the seniority tier
  node classify-tier.mjs --test          # run the inline test cases
  node classify-tier.mjs --help          # show this message

Tiers: intern, entry, mid, senior. Defaults to mid when no keyword matches.`;

if (isDirect) {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE);
  if (args.includes('--test')) {
    runTests();
  } else if (args.length > 0) {
    console.log(classifyTier(args[0]));
  } else {
    console.log(USAGE);
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
