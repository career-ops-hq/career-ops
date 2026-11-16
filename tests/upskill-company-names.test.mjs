// tests/upskill-company-names.test.mjs — a company the user has evaluated must
// never be reported as a skill they are missing.
//
// The bug, observed on a real marketing-operations corpus: the gap map's
// top-ranked entry was a data-platform vendor's name, and every occurrence came
// from PROVENANCE prose inside other reports' gap notes. Reports log a recurring
// gap by naming the sibling companies where it was logged before, in asides
// shaped like:
//
//   "RECURRING GAP, third+ occurrence (<company> logged it; <company> earlier)"
//   "a recurring gap (4th log: <company>, <company>, now here)"
//
// Those vendors are legitimate tokens in SKILL_TOKENS, so the extractor matched
// them correctly; what it could not know is that in that corpus the words named
// companies in the user's OWN pipeline, quoted while logging a different gap
// entirely. The tool then ranked "learn <vendor>" above every real gap —
// including the one those very sentences were recording.
//
// The exclusion is deliberately narrow: a token only drops out if it matches a
// company in the user's own tracker. And it is REPORTED, never silent. The
// module's own hard-won lesson (see upskill.mjs's known-skills header) is that
// "suppressed because known" being indistinguishable from "never appeared" is
// what made the original suppression bug expensive. An engineer who genuinely
// needs Snowflake-the-tool and once applied to Snowflake-the-company sees it
// listed under excludedAsCompanyName rather than losing it without a trace.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nupskill.mjs company-name exclusion (a tracked employer is not a skill gap)');

try {
  const { aggregateGaps, extractSkills, knownSkillsText } =
    await import(pathToFileURL(join(ROOT, 'upskill.mjs')).href);

  // ── the reported bug, reproduced in the shape reports actually write ──────
  {
    const reports = [
      {
        num: 34,
        score: 4.5,
        gapText: "ABM program ownership named ('martech ecosystem to support ABM') — "
          + 'RECURRING GAP, third+ occurrence (Acme logged it; Snowflake earlier). '
          + 'Demandbase in cv.md skills is the honest adjacent',
      },
      {
        num: 35,
        score: 4.1,
        gapText: "ABM: 'Building a world-class Account-Based Marketing capability' is a "
          + 'CORE REMIT — a recurring gap (4th log: Snowflake, Acme, Globex, now here)',
      },
    ];
    const companyNames = new Set(['snowflake', 'acme', 'globex', 'initech']);
    const { gaps, excludedAsCompanyName } = aggregateGaps(reports, new Set(), companyNames);
    const names = gaps.map(g => g.skill);

    if (!names.includes('Snowflake')) {
      pass('a company from the user\'s own tracker is not reported as a skill gap');
    } else {
      fail(`Snowflake still reported as a skill gap => ${names.join(',')}`);
    }

    if (excludedAsCompanyName?.some(e => e.skill === 'Snowflake' && e.reports === 2)) {
      pass('the excluded company name is REPORTED (2 reports), not silently dropped');
    } else {
      fail(`excludedAsCompanyName => ${JSON.stringify(excludedAsCompanyName)}`);
    }

    // The gap those sentences were actually recording must now be the one that
    // surfaces — this is the whole point of the fix.
    const abm = gaps.find(g => g.skill === 'ABM');
    if (abm && abm.reports === 2) {
      pass('ABM surfaces from the same two sentences that used to yield only the vendor name');
    } else {
      fail(`ABM not aggregated => ${JSON.stringify(gaps.map(g => [g.skill, g.reports]))}`);
    }
  }

  // ── matching is case- and whitespace-insensitive ──────────────────────────
  {
    const { gaps } = aggregateGaps(
      [{ num: 1, score: 3.0, gapText: 'No exposure to Snowflake or Kubernetes' }],
      new Set(),
      new Set(['  SNOWFLAKE  ']),
    );
    const names = gaps.map(g => g.skill);
    if (!names.includes('Snowflake') && names.includes('Kubernetes')) {
      pass('company matching is case/whitespace-insensitive and excludes only the company');
    } else {
      fail(`case-insensitive company match => ${names.join(',')}`);
    }
  }

  // ── known-skill exclusion still wins, and stays in its own bucket ─────────
  // A company that is ALSO a genuine known skill must be reported as known, not
  // as a company — the two buckets answer different questions ("you have this"
  // vs "this is an employer you looked at") and collapsing them loses the first.
  {
    const { excludedAsKnown, excludedAsCompanyName } = aggregateGaps(
      [{ num: 1, score: 3.0, gapText: 'Needs Salesforce administration' }],
      new Set(['Salesforce']),
      new Set(['salesforce']),
    );
    if (excludedAsKnown.some(e => e.skill === 'Salesforce')
        && !excludedAsCompanyName.some(e => e.skill === 'Salesforce')) {
      pass('known-skill exclusion takes precedence over company-name exclusion');
    } else {
      fail(`bucket precedence => known=${JSON.stringify(excludedAsKnown)} company=${JSON.stringify(excludedAsCompanyName)}`);
    }
  }

  // ── an empty/absent company set changes nothing ──────────────────────────
  // Callers that pass two arguments must behave exactly as before.
  {
    const reports = [{ num: 1, score: 3.0, gapText: 'Needs Snowflake and Kubernetes' }];
    const legacy = aggregateGaps(reports, new Set());
    const explicit = aggregateGaps(reports, new Set(), new Set());
    if (legacy.gaps.map(g => g.skill).includes('Snowflake')
        && JSON.stringify(legacy.gaps) === JSON.stringify(explicit.gaps)) {
      pass('aggregateGaps stays backward-compatible when no company set is supplied');
    } else {
      fail(`backward compatibility => legacy=${JSON.stringify(legacy.gaps.map(g => g.skill))}`);
    }
  }

  // ── the Demandbase trap, end to end ──────────────────────────────────────
  // Demandbase is an ABM PLATFORM. If the vocabulary ever aliases the tool to
  // the discipline, the CV line below puts ABM into the known-skills set and the
  // gap disappears again — this time reading as "no gap found", which is
  // strictly worse than the silence being fixed here.
  {
    const knownText = knownSkillsText('## Marketing platforms\n**Paid:** Google Ads, Demandbase\n', '');
    const known = extractSkills(knownText);
    const { gaps, excludedAsKnown } = aggregateGaps(
      [{ num: 1, score: 4.1, gapText: 'ABM program ownership not claimed (Demandbase tooling listed)' }],
      known,
    );
    const names = gaps.map(g => g.skill);
    if (names.includes('ABM') && excludedAsKnown.some(e => e.skill === 'Demandbase')) {
      pass('Demandbase on the CV is excluded as known WITHOUT suppressing the ABM gap');
    } else {
      fail(`Demandbase/ABM end to end => gaps=${names.join(',')} known=${excludedAsKnown.map(e => e.skill).join(',')}`);
    }
  }
} catch (e) {
  fail(`upskill company-name tests crashed: ${e.stack || e.message}`);
}
