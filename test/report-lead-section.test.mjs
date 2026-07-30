/**
 * report-lead-section.test.mjs — regression tests for pickLeadSection()
 * (web/src/lib/core/report-lead.mjs).
 *
 * The report view used to lead with section F as the "verdict" callout, but
 * modes/oferta.md defines Block F as the INTERVIEW PLAN. There is no `Verdict`
 * block in the report contract at all; the decision-bearing block is
 * `## Recommendation`. So the most prominent element on the page answered "how
 * do I prepare for an interview" while the recommendation that drives "should I
 * apply" sat collapsed.
 *
 * web/ lives deliberately OUTSIDE the auto-updater's world, so a core-only
 * install has no web/ tree and this suite skips instead of failing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MOD = join(ROOT, 'web', 'src', 'lib', 'core', 'report-lead.mjs');
const HAS_WEB = existsSync(MOD);

if (!HAS_WEB) {
  test('report-lead-section: skipped — web/ not present (core-only install)', () => {});
} else {
  const { pickLeadSection } = await import(pathToFileURL(MOD).href);

  const s = (heading, letter = null, content = 'body') => ({ heading, letter, content });

  // The real shape oferta mode emits.
  const realReport = () => [
    s('Machine Summary'),
    s('Role Summary', 'A'),
    s('Match with CV', 'B'),
    s('Level and Strategy', 'C'),
    s('Comp and Demand', 'D'),
    s('Customization Plan', 'E'),
    s('Interview Plan', 'F'),
    s('Posting Legitimacy', 'G'),
    s('Risk Summary'),
    s('Recommendation'),
  ];

  test('pickLeadSection: leads with Recommendation, not the Interview Plan', () => {
    const lead = pickLeadSection(realReport());
    assert.equal(lead.heading, 'Recommendation');
  });

  test('pickLeadSection: never returns the interview plan as the lead', () => {
    const lead = pickLeadSection(realReport());
    assert.notEqual(lead.letter, 'F');
    assert.ok(!/interview/i.test(lead.heading), `lead must not be the interview plan, got ${lead.heading}`);
  });

  test('pickLeadSection: falls back to Risk Summary when there is no Recommendation', () => {
    const sections = realReport().filter((x) => x.heading !== 'Recommendation');
    assert.equal(pickLeadSection(sections).heading, 'Risk Summary');
  });

  test('pickLeadSection: honors an explicit Verdict block if one is ever emitted', () => {
    const sections = realReport().filter((x) => x.heading !== 'Recommendation');
    sections.push(s('Verdict'));
    assert.equal(pickLeadSection(sections).heading, 'Verdict');
  });

  // The preference order is Recommendation, then Verdict, then Risk Summary.
  // Every other ordering test uses a report carrying exactly one candidate, so
  // a wrong order is invisible to them: only a report holding two candidates at
  // once can tell the stated order from the implemented one.
  test('pickLeadSection: prefers Recommendation over Verdict when a report has both', () => {
    const sections = [...realReport(), s('Verdict')];
    assert.equal(pickLeadSection(sections).heading, 'Recommendation');
  });

  test('pickLeadSection: prefers Verdict over Risk Summary when a report has both', () => {
    const sections = realReport().filter((x) => x.heading !== 'Recommendation');
    sections.push(s('Verdict'));
    assert.equal(pickLeadSection(sections).heading, 'Verdict');
    assert.ok(sections.some((x) => x.heading === 'Risk Summary'), 'fixture must contain Risk Summary for this to mean anything');
  });

  test('pickLeadSection: returns null rather than guessing when no decision block exists', () => {
    const sections = [s('Role Summary', 'A'), s('Interview Plan', 'F')];
    assert.equal(pickLeadSection(sections), null);
  });

  test('pickLeadSection: tolerates empty and malformed input', () => {
    assert.equal(pickLeadSection([]), null);
    assert.equal(pickLeadSection(undefined), null);
    assert.doesNotThrow(() => pickLeadSection([{}]));
  });

  test('pickLeadSection: matching is case-insensitive and ignores surrounding space', () => {
    assert.equal(pickLeadSection([s('RECOMMENDATION')]).heading, 'RECOMMENDATION');
    assert.equal(pickLeadSection([s('  Recommendation  ')]).heading, '  Recommendation  ');
  });

  // splitSections() keeps the author-letter ON the heading ("A) Role Summary")
  // and reports the letter separately; cleanHeading() strips it for display.
  // A matcher reading the raw heading therefore misses any lettered variant.
  // No report in the current corpus writes one, so this is hardening against a
  // shape the parser already accepts rather than a fix for a live report.
  test('pickLeadSection: finds a lead behind an author-letter prefix', () => {
    assert.equal(pickLeadSection([s('H) Recommendation', 'H')]).heading, 'H) Recommendation');
    assert.equal(pickLeadSection([s('F. Verdict', 'F')]).heading, 'F. Verdict');
    assert.equal(pickLeadSection([s('Block G: Risk Summary', 'G')]).heading, 'Block G: Risk Summary');
  });

  test('pickLeadSection: letter-prefix stripping does not break the preference order', () => {
    const sections = [s('G) Risk Summary', 'G'), s('H) Recommendation', 'H')];
    assert.equal(pickLeadSection(sections).heading, 'H) Recommendation');
  });

  // Guard against over-eager prefix stripping: a heading that merely starts
  // with a letter-like word must not be mistaken for a decorated lead.
  test('pickLeadSection: does not treat an ordinary heading as a decorated lead', () => {
    assert.equal(pickLeadSection([s('Additional Recommendation Notes')]), null);
    assert.equal(pickLeadSection([s('A Recommendation Was Requested')]), null);
  });

  // A prefix match promotes any heading that merely STARTS with a candidate
  // word, so "Recommendation Was Requested" would lead the page. The earlier
  // negative test only covered letter-prefixed decoration, which left the
  // direct-prefix case unexercised.
  test('pickLeadSection: a heading that only starts with a candidate word is not a lead', () => {
    assert.equal(pickLeadSection([s('Recommendation Was Requested')]), null);
    assert.equal(pickLeadSection([s('Risk Summary Notes')]), null);
    assert.equal(pickLeadSection([s('Verdict Analysis and Rationale')]), null);
  });

  // Bounding the match must not reject the forms reports actually use. The
  // renderer already strips a trailing "(lead)"/"(verdict)" for display, so a
  // parenthetical qualifier is an expected shape, not an oddity.
  test('pickLeadSection: accepts a trailing parenthetical qualifier', () => {
    assert.equal(pickLeadSection([s('Recommendation (lead)')]).heading, 'Recommendation (lead)');
    assert.equal(pickLeadSection([s('Risk Summary (detailed)')]).heading, 'Risk Summary (detailed)');
  });

  // The helper advertises plural support, so it has to hold for every candidate
  // rather than only the ones whose plural is formed by appending an s. No
  // report in the corpus uses a plural today; the defect is that the rule
  // applied inconsistently, which is the kind of gap that reads as working.
  test('pickLeadSection: accepts the plural form of a candidate heading', () => {
    assert.equal(pickLeadSection([s('Recommendations')]).heading, 'Recommendations');
    assert.equal(pickLeadSection([s('Verdicts')]).heading, 'Verdicts');
    assert.equal(pickLeadSection([s('Risk Summaries')]).heading, 'Risk Summaries');
  });

  test('pickLeadSection: a plural still loses to a singular higher in the order', () => {
    assert.equal(pickLeadSection([s('Risk Summaries'), s('Recommendation')]).heading, 'Recommendation');
  });

  test('pickLeadSection: does not mutate the input array', () => {
    const sections = realReport();
    const before = sections.map((x) => x.heading).join('|');
    pickLeadSection(sections);
    assert.equal(sections.map((x) => x.heading).join('|'), before);
  });
}
