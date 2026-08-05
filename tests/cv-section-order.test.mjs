// tests/cv-section-order.test.mjs — behavioural coverage for user-configurable CV
// section order (#2533): reading `cv.sections` from config/profile.yml, permuting
// the named sections among the slots they already occupy, and the end-to-end
// promise that a CV whose order differs from the shipped template stops tripping
// validateCvSectionOrder().
//
// Assertions run against rendered HTML rather than source patterns: the reorder
// has to survive nested markup, comments, absent optional sections and a second
// application, and none of that is observable from the source text.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nCV section order from config/profile.yml (#2533)');

// Section titles the builders render for each key, mirroring
// DEFAULT_SECTION_TITLES in build-cv-html.mjs. Used to turn the shipped
// template into a realistic rendered document.
const RENDERED_TITLES = {
  SECTION_SUMMARY: 'Professional Summary',
  SECTION_COMPETENCIES: 'Core Competencies',
  SECTION_EXPERIENCE: 'Work Experience',
  SECTION_PROJECTS: 'Projects',
  SECTION_EDUCATION: 'Education',
  SECTION_CERTIFICATIONS: 'Certifications',
  SECTION_AWARDS: 'Awards & Honors',
  SECTION_SKILLS: 'Skills',
};

// A compact stand-in for a rendered CV: marker comments, nested markup inside a
// section, and a comment whose text contains a tag (which must not be mistaken
// for real markup while finding where a section ends).
const FIXTURE = `<!DOCTYPE html>
<html lang="en">
<head><title>Test</title></head>
<body>
<div class="cv">
  <!-- HEADER -->
  <div class="header">
    <h1>Test Candidate</h1>
    <img src="x.png" alt="">
  </div>

  <!-- PROFESSIONAL SUMMARY -->
  <div class="section">
    <div class="section-title">Professional Summary</div>
    <div class="summary-text">Summary body.</div>
  </div>

  <!-- WORK EXPERIENCE -->
  <div class="section">
    <div class="section-title">Work Experience</div>
    <div class="job">
      <div class="job-header"><span class="job-company">Acme</span></div>
      <ul><li>Did the thing<br>and another</li></ul>
    </div>
  </div>

  <!-- PROJECTS -->
  <div class="section">
    <div class="section-title">Projects</div>
    <!-- a comment mentioning <div class="section"> must not confuse the scanner -->
    <div class="project">P</div>
  </div>

  <!-- EDUCATION -->
  <div class="section">
    <div class="section-title">Education</div>
    <div class="edu-item">E</div>
  </div>

  <!-- CERTIFICATIONS -->
  <div class="section">
    <div class="section-title">Certifications</div>
    <div class="cert-table">C</div>
  </div>

  <!-- SKILLS -->
  <div class="section">
    <div class="section-title">Skills</div>
    <div class="skills-grid">K</div>
  </div>
</div>
</body>
</html>
`;

// Read back the order a document actually renders, independent of the
// implementation's own extraction.
function renderedTitles(html) {
  return [...html.matchAll(/class="section-title">([^<]*)</g)].map(m => m[1].trim());
}

// Swallow the implementation's warnings while asserting on them.
function captureWarnings(fn) {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(' '));
  try {
    return { value: fn(), warnings: lines };
  } finally {
    console.warn = original;
  }
}

try {
  const { cvSectionOrderFrom, readCvSectionOrder } =
    await import(pathToFileURL(join(ROOT, 'theme-style.mjs')).href);
  const { reorderCvSections, CV_SECTION_KEYS, validateCvSectionOrder } =
    await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);

  // ── Reading the config ────────────────────────────────────────────────────

  const parsed = cvSectionOrderFrom({ sections: [' Skills ', 'EDUCATION', 42, '', null] });
  if (JSON.stringify(parsed) === JSON.stringify(['skills', 'education'])) {
    pass('cvSectionOrderFrom trims + lowercases entries and drops non-strings');
  } else {
    fail(`cvSectionOrderFrom => ${JSON.stringify(parsed)}`);
  }
  if (cvSectionOrderFrom(undefined).length === 0 && cvSectionOrderFrom({}).length === 0
      && cvSectionOrderFrom({ sections: 'skills' }).length === 0
      && cvSectionOrderFrom({ sections: {} }).length === 0) {
    pass('cvSectionOrderFrom returns [] for an absent, scalar or mapping `sections`');
  } else {
    fail('cvSectionOrderFrom should return [] unless `sections` is a list');
  }

  const dir = mkdtempSync(join(tmpdir(), 'career-ops-sections-'));
  try {
    const profile = join(dir, 'profile.yml');
    writeFileSync(profile, 'candidate:\n  full_name: X\ncv:\n  output_format: html\n  sections: [skills, education]\n');
    if (JSON.stringify(readCvSectionOrder(profile)) === JSON.stringify(['skills', 'education'])) {
      pass('readCvSectionOrder reads cv.sections from a profile file');
    } else {
      fail(`readCvSectionOrder => ${JSON.stringify(readCvSectionOrder(profile))}`);
    }
    const noCv = join(dir, 'nocv.yml');
    writeFileSync(noCv, 'candidate:\n  full_name: X\n');
    const broken = join(dir, 'broken.yml');
    writeFileSync(broken, 'cv:\n  sections: [unclosed\n');
    if (readCvSectionOrder(join(dir, 'missing.yml')).length === 0
        && readCvSectionOrder(noCv).length === 0
        && readCvSectionOrder(broken).length === 0) {
      pass('readCvSectionOrder returns [] for a missing, cv-less or unparseable profile');
    } else {
      fail('readCvSectionOrder should return [] for a missing, cv-less or unparseable profile');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // ── The no-op contract ────────────────────────────────────────────────────

  if (reorderCvSections(FIXTURE, []) === FIXTURE
      && reorderCvSections(FIXTURE, undefined) === FIXTURE
      && reorderCvSections(FIXTURE, ['skills']) === FIXTURE) {
    pass('reorderCvSections is byte-identical with no order, an empty order, or a single name');
  } else {
    fail('reorderCvSections should be a no-op without at least two named sections');
  }

  const alreadyInOrder = reorderCvSections(FIXTURE, ['education', 'skills']);
  if (alreadyInOrder === FIXTURE) {
    pass('reorderCvSections is byte-identical when the configured order already holds');
  } else {
    fail('reorderCvSections changed a document that already matched the configured order');
  }

  // ── The permutation ───────────────────────────────────────────────────────

  const swapped = reorderCvSections(FIXTURE, ['skills', 'education']);
  const order = renderedTitles(swapped);
  const expected = ['Professional Summary', 'Work Experience', 'Projects', 'Skills', 'Certifications', 'Education'];
  if (JSON.stringify(order) === JSON.stringify(expected)) {
    pass('named sections swap into each other\'s slots; unnamed sections never move');
  } else {
    fail(`reordered => ${JSON.stringify(order)}, expected ${JSON.stringify(expected)}`);
  }

  // Certifications sat between Education and Skills and was not named: it must
  // still be exactly where it was, not carried along with a moving neighbour.
  if (order[4] === 'Certifications' && renderedTitles(FIXTURE)[4] === 'Certifications') {
    pass('an unnamed section between two moved ones keeps its slot');
  } else {
    fail('an unnamed section between two moved ones did not keep its slot');
  }

  // Nothing may be lost or duplicated: every section body survives exactly once.
  const bodies = ['Summary body.', 'class="job-company">Acme', 'class="project">P', 'class="edu-item">E', 'class="cert-table">C', 'class="skills-grid">K'];
  const intact = bodies.every(b => swapped.split(b).length === 2)
    && swapped.includes('<h1>Test Candidate</h1>')
    && swapped.trimEnd().endsWith('</html>');
  if (intact) {
    pass('reordering preserves every section body exactly once, plus header and document tail');
  } else {
    fail('reordering lost, duplicated or truncated document content');
  }

  // A three-way rotation, to prove the mapping is a real permutation rather
  // than a pairwise swap that happens to work for two entries. Slots 2/3/5
  // (Projects, Education, Skills) receive the named sections in the order given.
  const rotated = renderedTitles(reorderCvSections(FIXTURE, ['skills', 'projects', 'education']));
  const expectedRotation = ['Professional Summary', 'Work Experience', 'Skills', 'Projects', 'Certifications', 'Education'];
  if (JSON.stringify(rotated) === JSON.stringify(expectedRotation)) {
    pass('a three-section order rotates all three through their own slots');
  } else {
    fail(`three-way => ${JSON.stringify(rotated)}, expected ${JSON.stringify(expectedRotation)}`);
  }

  if (reorderCvSections(swapped, ['skills', 'education']) === swapped) {
    pass('reorderCvSections is idempotent — a second pass changes nothing');
  } else {
    fail('reorderCvSections is not idempotent');
  }

  // ── Names that do not resolve ─────────────────────────────────────────────

  const typo = captureWarnings(() => reorderCvSections(FIXTURE, ['sklls', 'skills', 'education']));
  const typoOrder = renderedTitles(typo.value);
  if (JSON.stringify(typoOrder) === JSON.stringify(expected)
      && typo.warnings.some(w => w.includes('sklls'))) {
    pass('an unrecognized section name warns by name and is skipped, leaving the rest applied');
  } else {
    fail(`unrecognized name: order=${JSON.stringify(typoOrder)} warnings=${JSON.stringify(typo.warnings)}`);
  }

  // Asserted against a written-out vocabulary, not against CV_SECTION_KEYS:
  // checking the message with the same list the message is built from would
  // pass however many sections the implementation actually knows about.
  const EXPECTED_KEYS = ['summary', 'competencies', 'experience', 'projects', 'education', 'certifications', 'awards', 'skills'];
  if (typo.warnings.some(w => EXPECTED_KEYS.every(k => w.includes(k)))) {
    pass('the unrecognized-name warning lists all eight recognized section keys');
  } else {
    fail(`the warning should list the recognized keys: ${JSON.stringify(typo.warnings)}`);
  }
  if (EXPECTED_KEYS.every(k => CV_SECTION_KEYS.includes(k)) && CV_SECTION_KEYS.length === EXPECTED_KEYS.length) {
    pass('CV_SECTION_KEYS is exactly the eight canonical sections the alias table produces');
  } else {
    fail(`CV_SECTION_KEYS => ${JSON.stringify(CV_SECTION_KEYS)}`);
  }

  const dup = captureWarnings(() => reorderCvSections(FIXTURE, ['skills', 'education', 'skills']));
  if (JSON.stringify(renderedTitles(dup.value)) === JSON.stringify(expected)
      && dup.warnings.some(w => w.toLowerCase().includes('skills'))) {
    pass('a repeated section name warns and keeps only its first position');
  } else {
    fail(`duplicate name: order=${JSON.stringify(renderedTitles(dup.value))} warnings=${JSON.stringify(dup.warnings)}`);
  }

  // A recognized section the CV does not carry (awards is stripped when empty)
  // is ordinary, not a misconfiguration: no warning, and the rest still applies.
  const absent = captureWarnings(() => reorderCvSections(FIXTURE, ['skills', 'awards', 'education']));
  if (JSON.stringify(renderedTitles(absent.value)) === JSON.stringify(expected)
      && absent.warnings.length === 0) {
    pass('a recognized section absent from this CV is skipped silently');
  } else {
    fail(`absent section: order=${JSON.stringify(renderedTitles(absent.value))} warnings=${JSON.stringify(absent.warnings)}`);
  }

  // Malformed markup must not be guessed at. A stray closing tag between the
  // marker and the section element makes the section's extent unknowable: the
  // depth scan can be pushed negative and then "balance" in the middle of the
  // section, which would move a truncated fragment and mangle the CV. Such a
  // section is not extractable, so it takes no part in the reorder.
  const malformed = FIXTURE.replace(
    '  <!-- SKILLS -->\n',
    '  <!-- SKILLS -->\n  </span>\n',
  );
  const malformedRun = captureWarnings(() => reorderCvSections(malformed, ['skills', 'education']));
  if (malformedRun.value === malformed && malformedRun.warnings.some(w => w.includes('skills'))) {
    pass('a section whose extent cannot be determined is left out of the reorder, not truncated, and is reported');
  } else {
    fail(`a malformed section was reordered anyway, or went unreported: ${JSON.stringify(malformedRun.warnings)}`);
  }

  // A template may mark a section with a bare heading and leave the body as a
  // sibling — nothing requires a wrapper element. Because a section's extent is
  // taken from its markers rather than by pairing tags, the heading and its body
  // move together. The failure this guards against is the heading travelling
  // alone: the order guard compares headings only, so a CV whose Skills heading
  // is followed by a degree would be reported as correctly ordered and pass.
  const unwrapped = `<html><body><div class="cv">
  <!-- EDUCATION -->
  <h2 class="section-title">Education</h2>
  <div class="edu-item">BSc Computer Science</div>

  <!-- SKILLS -->
  <h2 class="section-title">Skills</h2>
  <div class="skills-grid">Node.js, Python</div>
</div></body></html>`;
  const unwrappedRun = captureWarnings(() => reorderCvSections(unwrapped, ['skills', 'education']));
  const pairedCorrectly = /Skills<\/h2>\s*<div class="skills-grid">Node\.js, Python<\/div>/.test(unwrappedRun.value)
    && /Education<\/h2>\s*<div class="edu-item">BSc Computer Science<\/div>/.test(unwrappedRun.value);
  if (pairedCorrectly && unwrappedRun.value.indexOf('Skills') < unwrappedRun.value.indexOf('Education')) {
    pass('a heading-marked section moves together with its sibling body, in the requested order');
  } else {
    fail(`a heading-only section was separated from its body:\n${unwrappedRun.value}`);
  }
  if (unwrappedRun.warnings.length === 0) {
    pass('a heading-marked template needs no warning — it is supported, not merely tolerated');
  } else {
    fail(`unexpected warnings for a heading-marked template: ${JSON.stringify(unwrappedRun.warnings)}`);
  }

  // Raw text is not markup. A `</div>` inside <style> or <script> closes
  // nothing, and treating it as a close tag ends the section early: the section
  // moves as a fragment, its real closing tag stays behind, and whatever follows
  // is swallowed into the broken wrapper. Nothing here reads as "lost" — the
  // characters are all still present — which is what makes it worth pinning.
  const rawText = `<html><body><div class="cv">
  <!-- EDUCATION -->
  <div class="section"><div class="section-title">Education</div><div class="edu-item">BSc</div></div>

  <!-- SKILLS -->
  <div class="section"><div class="section-title">Skills</div><style>/* </div> */</style></div>
</div></body></html>`;
  const rawOut = reorderCvSections(rawText, ['skills', 'education']);
  const sorted = (s) => s.split('').sort().join('');
  if (sorted(rawOut) === sorted(rawText)
      && rawOut.includes('<style>/* </div> */</style>')
      && /<!-- SKILLS -->[\s\S]*?Skills[\s\S]*?<\/style><\/div>/.test(rawOut)
      && /<!-- EDUCATION -->[\s\S]*?Education[\s\S]*?edu-item">BSc/.test(rawOut)
      && rawOut.indexOf('SKILLS') < rawOut.indexOf('EDUCATION')) {
    pass('a </div> inside <style> does not truncate its section: both move whole, output is a permutation of the input');
  } else {
    fail(`raw-text handling corrupted the document:\n${rawOut}`);
  }

  // A section may sit inside a container of its own. Swapping it with a section
  // outside that container loses nothing — both bodies survive — but relocates
  // one into markup that was never meant to hold it, which is invisible in the
  // section order and shows up only in the rendered layout.
  const containered = `<html><body><div class="cv">
  <div class="education-layout">
  <!-- EDUCATION -->
  <div class="section"><div class="section-title">Education</div><div class="edu-item">BSc</div></div>
  </div>

  <!-- SKILLS -->
  <div class="section"><div class="section-title">Skills</div><div class="skills-grid">Node.js</div></div>
</div></body></html>`;
  const containeredRun = captureWarnings(() => reorderCvSections(containered, ['skills', 'education']));
  if (containeredRun.value === containered
      && containeredRun.warnings.some(w => w.includes('education'))) {
    pass('a section wrapped in a container of its own is left alone and reported, not swapped out of it');
  } else {
    fail(`a section was moved into another section's container:\n${containeredRun.value}\n${JSON.stringify(containeredRun.warnings)}`);
  }

  // The markup scan runs over every candidate section, so no template should be
  // able to stall a render through it. Both shapes below defeated an earlier
  // regex-based scanner: a run of complete comments made it exponential (4.4s at
  // 28 repetitions), and a run of unterminated ones made it quadratic (728ms at
  // 32k). Thresholds are set so a regression is reported rather than hanging the
  // suite, since a scan that never returns produces no failure at all.
  for (const [label, filler] of [
    ['complete comments', '<!-- x --> '.repeat(28) + 'y'],
    ['unterminated comments', '<!--'.repeat(32000)],
  ]) {
    const noisy = FIXTURE.replace('  <!-- EDUCATION -->', `  ${filler}\n  <!-- EDUCATION -->`);
    const started = Date.now();
    reorderCvSections(noisy, ['skills', 'education']);
    const elapsed = Date.now() - started;
    if (elapsed < 500) {
      pass(`a run of ${label} is scanned linearly (${elapsed}ms)`);
    } else {
      fail(`scanning a run of ${label} took ${elapsed}ms — superlinear scanning is back`);
    }
  }

  // `>` is legal inside an attribute value, so a tag scan that stops at the
  // first `>` reads one tag as several. The extra "tags" can be chosen to make
  // an unbalanced slice look balanced, which is worse than a parse failure: the
  // section passes validation and is then moved out of its container. The
  // output stays a permutation and stays well-formed — only the meaning is wrong.
  const quotedAngle = `<html><body><div class="cv"><div class="education-layout">
<!-- EDUCATION -->
<h2 class="section-title">Education</h2><span data-x="> <div>">BSc</span>
</div>
<!-- SKILLS -->
<div class="section"><h2 class="section-title">Skills</h2>Node.js</div>
</div></body></html>`;
  if (reorderCvSections(quotedAngle, ['skills', 'education']) === quotedAngle) {
    pass('a `>` inside an attribute value cannot forge a balanced slice');
  } else {
    fail(`attribute-quoted markup forged a balance and a section was relocated:\n${reorderCvSections(quotedAngle, ['skills', 'education'])}`);
  }

  // Marker comments quoted inside a script are text. A search that starts at the
  // marker has no way to know that, so raw-text ranges have to be established
  // from the start of the document — otherwise part of a script body is treated
  // as a CV section and moved across the page.
  const markerInScript = `<html><head><script>const fixture = '<!-- EDUCATION --><div class="section-title">Education</div><!-- SKILLS --><div class="section-title">Skills</div><div><div>';</script></head><body><div class="cv"><p>Actual body</p></div></body></html>`;
  if (reorderCvSections(markerInScript, ['skills', 'education']) === markerInScript) {
    pass('marker comments quoted inside a script are text, not section boundaries');
  } else {
    fail(`a script body was reordered as if it were CV sections:\n${reorderCvSections(markerInScript, ['skills', 'education'])}`);
  }

  // The same reasoning applies to titles, not just markers: a heading quoted
  // inside a script names nothing, and taking it would label a block from
  // markup that only looks like a heading — applying the user's ordering to the
  // wrong section.
  const fakeTitle = `<html><body><div class="cv">
<!-- EDUCATION -->
<div class="section"><script>var t = '<x class="section-title">Education</x>';</script><div class="edu-item">BSc</div></div>
<!-- SKILLS -->
<div class="section"><div class="section-title">Skills</div>Node.js</div>
</div></body></html>`;
  if (reorderCvSections(fakeTitle, ['skills', 'education']) === fakeTitle) {
    pass('a section title quoted inside a script does not name a section');
  } else {
    fail('a script-quoted title was used to identify a section');
  }

  // Raw text is not only <script> and <style>. A parser builds no elements from
  // <xmp>, <iframe>, <noembed>, <noframes> or <plaintext> either, so leaving one
  // off the list means markup-shaped text inside it passes for structure.
  // `<script/>` belongs here too: trailing-slash syntax does nothing to an HTML
  // element, so it opens raw text rather than standing alone.
  //
  // Both fixtures put the sample markup at the end of the container, so that
  // dropping the element from the raw-text list leaves two *balanced* fake
  // sections that do get reordered — otherwise they'd be refused for unrelated
  // reasons and the assertion would hold either way.
  const fakeSections = '<!-- EDUCATION --><div class="section-title">Education</div><!-- SKILLS --><div class="section-title">Skills</div>';
  const rawTextHosts = ['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes'];
  const leaked = rawTextHosts.filter((tag) => {
    const doc = `<html><body><div class="cv">\n<p>Real body</p>\n<${tag}>${fakeSections}</${tag}>\n</div></body></html>`;
    return reorderCvSections(doc, ['skills', 'education']) !== doc;
  });
  // <plaintext> is checked separately, and with the sample placed *after* a
  // literal `</plaintext>`: it has no end tag in HTML, so everything from the
  // opening tag onwards is text to the end of the document. A fixture with the
  // sample inside would pass either way, since an implementation that wrongly
  // honours the literal close still covers that span.
  const plaintextDoc = `<html><body><div class="cv">\n<p>Real body</p>\n<plaintext>still text</plaintext>${fakeSections}\n</div></body></html>`;
  if (leaked.length === 0 && reorderCvSections(plaintextDoc, ['skills', 'education']) === plaintextDoc) {
    pass(`markup-shaped text stays out of the structure in all ${rawTextHosts.length + 1} raw-text elements`);
  } else {
    fail(`raw-text contents were reordered as CV sections in: ${leaked.join(', ') || 'plaintext'}`);
  }

  const selfClosedScript = `<html><body><div class="cv">
<p>Real body</p>
<script/><!-- EDUCATION --><div class="section-title">Education</div><!-- SKILLS --><div class="section-title">Skills</div></script>
</div></body></html>`;
  if (reorderCvSections(selfClosedScript, ['skills', 'education']) === selfClosedScript) {
    pass('<script/> opens raw text rather than standing alone, so its contents stay out of the structure');
  } else {
    fail(`<script/> contents were reordered as CV sections:\n${reorderCvSections(selfClosedScript, ['skills', 'education'])}`);
  }

  // Establishing raw-text ranges is one pass, but consulting them is a lookup
  // per marker and per candidate title, so both quantities have to grow
  // together for the cost to show: 16k ranges against two markers is only four
  // lookups, which a linear scan answers comfortably. Interleaving them makes
  // it 16k x 16k if the lookup is a scan — 619ms before this became a search,
  // against 13ms after.
  {
    const many = '<script></script><!-- EXPERIENCE -->'.repeat(16000)
      + '<div class="cv"><!-- EDUCATION --><div class="section"><div class="section-title">Education</div>E</div>'
      + '<!-- SKILLS --><div class="section"><div class="section-title">Skills</div>K</div></div>';
    const started = Date.now();
    const shuffled = reorderCvSections(many, ['skills', 'education']);
    const elapsed = Date.now() - started;
    if (elapsed < 500 && shuffled.indexOf('Skills') < shuffled.indexOf('Education')) {
      pass(`raw-text ranges are consulted by search, not by scan (16k ranges and markers in ${elapsed}ms)`);
    } else if (elapsed >= 500) {
      fail(`16k interleaved ranges and markers took ${elapsed}ms — a lookup is linear again`);
    } else {
      fail('the scaling fixture stopped reordering, so it no longer measures the lookup path');
    }
  }

  // A cover letter has no sections at all — the same call must leave it alone.
  const letter = '<html><body><p>Dear hiring manager,</p><p>Regards</p></body></html>';
  if (reorderCvSections(letter, ['skills', 'education']) === letter) {
    pass('a document with no CV sections (e.g. a cover letter) is returned unchanged');
  } else {
    fail('reorderCvSections modified a document that has no CV sections');
  }

  // ── The shipped template ──────────────────────────────────────────────────

  // Render the real template's section titles so the structural contract this
  // feature depends on (marker comment + .section-title per section) is guarded
  // against future template edits, not just against the fixture above.
  const renderTemplate = (file) => {
    let html = readFileSync(join(ROOT, 'templates', file), 'utf-8');
    for (const [placeholder, title] of Object.entries(RENDERED_TITLES)) {
      html = html.replaceAll(`{{${placeholder}}}`, title);
    }
    return html;
  };

  // Every section the template carries must be movable — checked by reversing
  // all of them at once, so a section the extractor silently can't reach shows
  // up as one that stayed put. Asserting only the Skills/Education pair would
  // pass with the other six unreachable.
  const rendered = renderTemplate('cv-template.html');
  const shippedOrder = renderedTitles(rendered);
  const allKeys = ['summary', 'competencies', 'experience', 'projects', 'education', 'certifications', 'awards', 'skills'];
  const reversed = renderedTitles(reorderCvSections(rendered, [...allKeys].reverse()));
  if (shippedOrder.length === 8 && JSON.stringify(reversed) === JSON.stringify([...shippedOrder].reverse())) {
    pass('every one of the shipped template\'s eight sections is movable (full reversal)');
  } else {
    fail(`shipped template reversal: before=${JSON.stringify(shippedOrder)} after=${JSON.stringify(reversed)}`);
  }

  // The documented worked example, against each template that ships with a
  // Skills and an Education section — including one with no Certifications at
  // all, which exercises the "named but absent" path end to end.
  for (const file of ['cv-template.html', 'cv-template.zh-minimal.html', 'resume-template.html']) {
    const html = renderTemplate(file);
    const after = renderedTitles(reorderCvSections(html, ['skills', 'education', 'certifications', 'awards']));
    const skillsAt = after.indexOf('Skills');
    const eduAt = after.indexOf('Education');
    if (skillsAt !== -1 && eduAt !== -1 && skillsAt < eduAt
        && after.length === renderedTitles(html).length) {
      pass(`${file}: the documented cv.sections example puts Skills before Education`);
    } else {
      fail(`${file}: ${JSON.stringify(after)}`);
    }
  }

  // ── The point of the whole exercise ───────────────────────────────────────

  // A cv.md ordered Skills-before-Education fails the guard against the shipped
  // template, and passes once the profile declares the same order. This is the
  // behaviour #2533 asks for; without the reorder the second call throws too.
  //
  // Moving Skills up past two sections is a rotation, not a swap: the sections
  // it displaces are named too, in the order they should end up in. That is the
  // shape the shipped template needs (`[skills, education, certifications,
  // awards]`), so the end-to-end case exercises it rather than the 2-cycle.
  const cvMarkdown = [
    '# Candidate', '', '## Professional Summary', 'x', '', '## Work Experience', 'x', '',
    '## Projects', 'x', '', '## Skills', 'x', '', '## Education', 'x', '', '## Certifications', 'x', '',
  ].join('\n');

  let threwBefore = false;
  try {
    validateCvSectionOrder(FIXTURE, cvMarkdown);
  } catch {
    threwBefore = true;
  }
  let threwAfter = false;
  try {
    validateCvSectionOrder(reorderCvSections(FIXTURE, ['skills', 'education', 'certifications']), cvMarkdown);
  } catch (e) {
    threwAfter = true;
    fail(`the guard still rejected the reordered CV: ${e.message}`);
  }
  if (threwBefore && !threwAfter) {
    pass('a cv.md ordered Skills-before-Education fails the guard untouched and passes once cv.sections declares it');
  } else if (!threwBefore) {
    fail('the fixture no longer diverges from cv.md — the end-to-end assertion proves nothing');
  }
} catch (e) {
  fail(`cv-section-order tests crashed: ${e.message}`);
}
