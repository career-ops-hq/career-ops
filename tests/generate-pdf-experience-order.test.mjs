// tests/generate-pdf-experience-order.test.mjs
//
// Guards the reverse-chronological ordering of Work Experience entries in a
// rendered CV (companion to the existing section-order guard, #1646).
//
// Why this exists: when an agent tailors a CV toward a JD, a tempting move is
// to promote "the most relevant role" to the top of Work Experience. That is a
// functional-resume technique and it actively hurts the candidate — it buries
// the most recent senior title, and ATS parsers plus human recruiters both
// expect newest-first, so deviation reads as concealment. Tailoring belongs in
// the summary, the competencies block, and bullet selection within each role.

import { validateCvExperienceOrder } from '../cv-experience-order.mjs';
import { pass, fail, finish } from './helpers.mjs';

console.log('\n📄 generate-pdf: experience ordering guard');

/** Build a minimal rendered-CV fragment with the given job periods. */
function html(periods) {
  const jobs = periods.map(p => `
  <div class="job">
    <div class="job-header">
      <span class="job-company">Example Corp</span>
      <span class="job-period">${p}</span>
    </div>
    <div class="job-role">Engineer</div>
  </div>`).join('\n');
  return `<html><body><h2>Work Experience</h2>${jobs}</body></html>`;
}

function expectThrows(label, fn) {
  try {
    fn();
    fail(`${label} — expected a thrown error, none was raised`);
  } catch (err) {
    if (err && /chronolog/i.test(err.message)) pass(`${label} — ${err.message.slice(0, 72)}…`);
    else fail(`${label} — threw the wrong error: ${err && err.message}`);
  }
}

function expectOk(label, fn) {
  try { fn(); pass(label); }
  catch (err) { fail(`${label} — unexpected throw: ${err && err.message}`); }
}

// --- Ordering violations -----------------------------------------------------

expectThrows('rejects an older role promoted above a newer one', () =>
  validateCvExperienceOrder(html([
    'Jul 2008 – Nov 2014',
    'Jan 2021 – Apr 2022',
    'Jun 2017 – Jan 2021',
  ])));

expectThrows('rejects a simple two-entry inversion', () =>
  validateCvExperienceOrder(html(['2015 – 2018', '2019 – 2022'])));

expectThrows('rejects an out-of-order Present role', () =>
  validateCvExperienceOrder(html(['Jan 2020 – Dec 2021', 'Mar 2024 – Present'])));

// --- Valid orderings ---------------------------------------------------------

expectOk('accepts strict reverse-chronological order', () =>
  validateCvExperienceOrder(html([
    'Jan 2025 – Present',
    'Feb 2023 – May 2026',
    'Jan 2021 – Apr 2022',
    'Jun 2017 – Jan 2021',
    'Jul 2008 – Nov 2014',
    'Sep 2005 – Jun 2008',
  ])));

expectOk('accepts year-only periods in descending order', () =>
  validateCvExperienceOrder(html(['2019 – 2022', '2015 – 2018', '2005 – 2008'])));

expectOk('accepts concurrent roles sharing a start month', () =>
  validateCvExperienceOrder(html(['Jan 2021 – Present', 'Jan 2021 – Apr 2022'])));

// --- Escape hatch ------------------------------------------------------------

expectOk('downgrades to a warning when allowNonChronological is set', () =>
  validateCvExperienceOrder(html(['2010 – 2014', '2020 – 2024']), { allowNonChronological: true }));

// --- Don't-penalize-missing-data discipline ---------------------------------

expectOk('no-ops on a single experience entry', () =>
  validateCvExperienceOrder(html(['Jan 2021 – Apr 2022'])));

expectOk('no-ops when the document has no job entries', () =>
  validateCvExperienceOrder('<html><body><h2>Skills</h2></body></html>'));

expectOk('no-ops when periods are unparseable', () =>
  validateCvExperienceOrder(html(['sometime', 'later on'])));

expectOk('ignores unparseable entries but still checks parseable neighbours', () =>
  validateCvExperienceOrder(html(['Jan 2025 – Present', 'ongoing', 'Jan 2021 – Apr 2022'])));

expectThrows('still catches an inversion around an unparseable entry', () =>
  validateCvExperienceOrder(html(['Jan 2015 – Dec 2016', 'ongoing', 'Jan 2022 – Present'])));

finish();
