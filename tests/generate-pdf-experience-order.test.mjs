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

import { existsSync, readFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { validateCvExperienceOrder } from '../cv-experience-order.mjs';
import { listTemplates } from '../cv-templates.mjs';
import { pass, fail, ROOT } from './helpers.mjs';

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

{
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    expectOk('downgrades to a warning when allowNonChronological is set', () =>
      validateCvExperienceOrder(html(['2010 – 2014', '2020 – 2024']), { allowNonChronological: true }));
  } finally {
    console.warn = originalWarn;
  }
  if (warnings.length === 1 && /reverse-chronological/.test(warnings[0]) && /--allow-nonchronological/.test(warnings[0])) {
    pass('the escape hatch warns once, naming the inversion and the flag');
  } else {
    fail(`the escape hatch should warn exactly once, got ${warnings.length}: ${JSON.stringify(warnings)}`);
  }
}

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

// --- Month names the parser cannot read -------------------------------------
// MONTHS only knows English. A month it cannot read (Spanish "Ago", German
// "Dez") or no month at all must not count as January: a correctly ordered CV
// then failed as soon as a role started later in the same year than a role
// whose month the parser could read.

expectOk('does not guess an unreadable month (Spanish) within the same year', () =>
  validateCvExperienceOrder(html(['Ago 2021 – Presente', 'Feb 2021 – Jul 2021'])));

expectOk('does not guess an unreadable month (German) within the same year', () =>
  validateCvExperienceOrder(html(['Dez 2022 – heute', 'Apr 2022 – Nov 2022'])));

expectOk('does not guess a missing month against a dated role in the same year', () =>
  validateCvExperienceOrder(html(['2021 – Present', 'Mar 2021 – Dec 2021'])));

expectThrows('an unreadable month still loses to a later year', () =>
  validateCvExperienceOrder(html(['Ago 2019 – Dic 2020', 'Feb 2021 – Presente'])));

// --- Markup the parser must still read ---------------------------------------

expectThrows('reads a single-quoted job-period class', () =>
  validateCvExperienceOrder(
    "<span class='job-period'>2015 – 2018</span><span class='job-period'>2019 – 2022</span>"));

expectThrows('reads a job-period class with whitespace around the equals sign', () =>
  validateCvExperienceOrder(
    '<span class = "job-period">2015 – 2018</span><span class = "job-period">2019 – 2022</span>'));

expectThrows('reads a job-period class with leading whitespace inside the quotes', () =>
  validateCvExperienceOrder(
    '<span class=" job-period">2015 – 2018</span><span class=" job-period">2019 – 2022</span>'));

expectThrows('reads an unquoted job-period class', () =>
  validateCvExperienceOrder(
    '<span class=job-period>2015 – 2018</span><span class=job-period>2019 – 2022</span>'));

expectOk('does not read an unquoted class that only starts with job-period', () =>
  validateCvExperienceOrder(
    '<span class=job-periods>2015 – 2018</span><span class=job-periods>2019 – 2022</span>'));

expectThrows('decodes a decimal entity between month and year before reading the month', () =>
  validateCvExperienceOrder(html(['Jan&#160;2021 – Dec 2021', 'Feb 2021 – Present'])));

expectThrows('decodes a hex entity between month and year before reading the month', () =>
  validateCvExperienceOrder(html(['Jan&#xA0;2021 – Dec 2021', 'Feb 2021 – Present'])));

// --- Quoting a period back to the terminal -----------------------------------
// The period comes out of the CV and the message goes to a terminal or a log:
// an ANSI escape or a bidi override in it could repaint the operator's
// console. The date is still parsed from the original text.

const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/;

function thrownMessage(fn) {
  try { fn(); } catch (err) { return err && err.message; }
  return null;
}

{
  const message = thrownMessage(() =>
    validateCvExperienceOrder(html(['2015\u001b[2K\u001b[1G – 2018‮', '2019 – 2022'])));
  if (message && /chronolog/i.test(message) && !CONTROL_OR_BIDI.test(message)) {
    pass('strips terminal controls and bidi overrides from the periods an error quotes');
  } else {
    fail(`the error should name the inversion without control or bidi characters: ${JSON.stringify(message)}`);
  }
}

{
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    expectOk('still proceeds under the escape hatch when a quoted period carries terminal controls', () =>
      validateCvExperienceOrder(html(['2015 – 2018\u001b]0;pwned\u0007', '2019 – 2022']), { allowNonChronological: true }));
  } finally {
    console.warn = originalWarn;
  }
  if (warnings.length === 1 && !CONTROL_OR_BIDI.test(warnings[0].replace(/^⚠️\s+/, ''))) {
    pass('strips terminal controls from the periods the escape-hatch warning quotes');
  } else {
    fail(`the warning should quote the periods without control characters: ${JSON.stringify(warnings)}`);
  }
}

{
  const message = thrownMessage(() =>
    validateCvExperienceOrder(html([`2015 – 2018 ${'x'.repeat(5000)}`, '2019 – 2022'])));
  if (message && /chronolog/i.test(message) && message.length < 600) {
    pass('caps a long period quoted in the error, so it cannot bury the message');
  } else {
    fail(`a 5000-character period should be truncated in the error (length ${message && message.length})`);
  }
}

// --- Every shipped template pack --------------------------------------------
// Template packs may change tag names inside the ENTRY zone of their
// sections/experience.html partial: the ATS pack renders the period in a
// <div>, the default pack in a <span>. A guard that reads only one of them
// silently no-ops for every CV built from the other.

/** Fill a shipped experience partial with the given periods, one entry each. */
function fromPartial(path, periods) {
  const entry = readFileSync(path, 'utf-8')
    .match(/<!--ENTRY-->([\s\S]*?)<!--\/ENTRY-->/)[1]
    .replace(/<!--LOCATION_BLOCK-->[\s\S]*?<!--\/LOCATION_BLOCK-->/, '');
  const fields = { COMPANY: 'Example Corp', ROLE: 'Engineer', LOCATION_BLOCK: '', BULLETS: '<li>Shipped it</li>' };
  const jobs = periods.map(period =>
    entry.replace(/\{\{(\w+)\}\}/g, (_, key) => (key === 'PERIOD' ? period : fields[key] ?? '')));
  return `<html><body><h2>Work Experience</h2>${jobs.join('\n')}</body></html>`;
}

// The sections/experience.html beside each CV template, where build-cv-html.mjs
// looks for it.
let partials = [];
try {
  partials = [...new Set(listTemplates('cv')
    .map(t => join(dirname(t.path), 'sections', 'experience.html'))
    .filter(existsSync))];
} catch (err) {
  fail(`could not list the CV templates: ${err.message}`);
}
if (partials.length >= 2) pass(`found ${partials.length} shipped experience partials`);
else fail(`expected at least the default and ATS experience partials, found ${partials.length}`);

for (const path of partials) {
  expectThrows(`reads the job periods rendered by ${relative(ROOT, path)}`, () =>
    validateCvExperienceOrder(fromPartial(path, ['2015 – 2018', '2019 – 2022'])));
}
