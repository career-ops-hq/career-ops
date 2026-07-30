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
    const sections = [...realReport(), s('Verdict')];
    assert.equal(pickLeadSection(sections).heading, 'Verdict');
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

  test('pickLeadSection: matching is case- and decoration-insensitive', () => {
    assert.equal(pickLeadSection([s('RECOMMENDATION')]).heading, 'RECOMMENDATION');
    assert.equal(pickLeadSection([s('  Recommendation  ')]).heading, '  Recommendation  ');
  });

  test('pickLeadSection: does not mutate the input array', () => {
    const sections = realReport();
    const before = sections.map((x) => x.heading).join('|');
    pickLeadSection(sections);
    assert.equal(sections.map((x) => x.heading).join('|'), before);
  });
}
