// tests/cv-section-order.test.mjs — behavioural coverage for user-configurable CV
// section order (#2533): reading `cv.sections` from config/profile.yml, permuting
// the named sections among the slots they already occupy, and the end-to-end
// promise that a CV whose order differs from the shipped template stops tripping
// validateCvSectionOrder().
//
// Assertions run against rendered HTML rather than source patterns: the reorder
// has to survive nested markup, comments, absent optional sections and a second
// application, and none of that is observable from the source text.
import { pass, fail, linkRepoPackage, ROOT, NODE } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nCV section order from config/profile.yml (#2533)');

// Wall-clock budget for the scan-complexity assertions below. Deliberately far
// above what the linear scans cost (single-digit ms) so a loaded CI runner
// can't trip it, and far below what the superlinear implementations they
// replaced cost on the fixtures used (several seconds each).
const TIME_BUDGET_MS = 2000;

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

  const single = captureWarnings(() => reorderCvSections(FIXTURE, ['skills']));
  if (reorderCvSections(FIXTURE, []) === FIXTURE
      && reorderCvSections(FIXTURE, undefined) === FIXTURE
      && single.value === FIXTURE) {
    pass('reorderCvSections is byte-identical with no order, an empty order, or a single name');
  } else {
    fail('reorderCvSections should be a no-op without at least two named sections');
  }
  // A single name is a no-op that looks like a setting, so it says so. An empty
  // or absent list is not a statement at all, so it stays quiet.
  if (single.warnings.some(w => w.includes('skills'))
      && captureWarnings(() => reorderCvSections(FIXTURE, [])).warnings.length === 0) {
    pass('a one-name order reports that it states no relationship; an empty one is silent');
  } else {
    fail(`single-name handling: ${JSON.stringify(single.warnings)}`);
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
  // regex-based scanner: a run of complete comments made it exponential, and a
  // run of unterminated ones made it quadratic.
  //
  // On the bound: it has to sit far enough above the linear cost that a loaded
  // CI runner can't cross it, and far enough below the regressed cost to still
  // fail. Those pull in opposite directions, so the *fixtures* are sized rather
  // than the threshold loosened — each one is large enough that the regressed
  // implementation needs several seconds, while the linear scan stays in
  // single-digit milliseconds. Sizing them any larger would make a regression
  // hang the suite instead of reporting, and a scan that never returns produces
  // no failure at all.
  for (const [label, filler] of [
    ['complete comments', '<!-- x --> '.repeat(30) + 'y'],
    ['unterminated comments', '<!--'.repeat(96000)],
  ]) {
    const noisy = FIXTURE.replace('  <!-- EDUCATION -->', `  ${filler}\n  <!-- EDUCATION -->`);
    const started = Date.now();
    reorderCvSections(noisy, ['skills', 'education']);
    const elapsed = Date.now() - started;
    if (elapsed < TIME_BUDGET_MS) {
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
    const many = '<script></script><!-- EXPERIENCE -->'.repeat(48000)
      + '<div class="cv"><!-- EDUCATION --><div class="section"><div class="section-title">Education</div>E</div>'
      + '<!-- SKILLS --><div class="section"><div class="section-title">Skills</div>K</div></div>';
    const started = Date.now();
    const shuffled = reorderCvSections(many, ['skills', 'education']);
    const elapsed = Date.now() - started;
    if (elapsed < TIME_BUDGET_MS && shuffled.indexOf('Skills') < shuffled.indexOf('Education')) {
      pass(`raw-text ranges are consulted by search, not by scan (48k ranges and markers in ${elapsed}ms)`);
    } else if (elapsed >= TIME_BUDGET_MS) {
      fail(`48k interleaved ranges and markers took ${elapsed}ms — a lookup is linear again`);
    } else {
      fail('the scaling fixture stopped reordering, so it no longer measures the lookup path');
    }
  }

  // sectionKey() falls back to the normalized title when SECTION_ALIASES has no
  // entry for it, so a CV rendered with titles outside that table produces
  // blocks that are real and movable but can never match a configured name.
  // Without a warning that is indistinguishable, from the user's side, from a
  // setting that does nothing — the failure this feature exists to remove.
  const unknownTitles = `<html><body><div class="cv">
  <!-- EDUCATION -->
  <div class="section"><div class="section-title">Ausbildung</div><div>Uni</div></div>

  <!-- SKILLS -->
  <div class="section"><div class="section-title">Kenntnisse</div><div>Node.js</div></div>
</div></body></html>`;
  const unknownRun = captureWarnings(() => reorderCvSections(unknownTitles, ['skills', 'education']));
  if (unknownRun.value === unknownTitles
      && unknownRun.warnings.some(w => w.includes('Ausbildung') && w.includes('Kenntnisse'))) {
    pass('a CV whose titles are outside the alias table says so, instead of quietly doing nothing');
  } else {
    fail(`unrecognized rendered titles went unreported: ${JSON.stringify(unknownRun.warnings)}`);
  }

  // The report has to key on which names failed to resolve, not on how many
  // sections were placed: here two of three names resolve, the two that do are
  // already in the requested order, so nothing changes and a count-based check
  // would see a successful reorder and stay silent.
  const partial = `<html><body><div class="cv">
  <!-- PROJECTS -->
  <div class="section"><div class="section-title">Projects</div><div>P</div></div>
  <!-- EDUCATION -->
  <div class="section"><div class="section-title">Education</div><div>E</div></div>
  <!-- SKILLS -->
  <div class="section"><div class="section-title">Kenntnisse</div><div>K</div></div>
</div></body></html>`;
  const partialRun = captureWarnings(() => reorderCvSections(partial, ['skills', 'projects', 'education']));
  if (partialRun.value === partial
      && partialRun.warnings.some(w => w.includes('"skills"') && w.includes('Kenntnisse'))) {
    pass('a partly-resolving order that changes nothing still names what it could not resolve');
  } else {
    fail(`partial resolution went unreported: ${JSON.stringify(partialRun.warnings)}`);
  }

  // The title is quoted back into a terminal, so it is untrusted output: an
  // escape sequence would let a CV repaint the console or forge a line of it,
  // and an unbounded title would bury the warning it belongs to.
  const ESC = String.fromCharCode(27);
  const hostileTitle = unknownTitles
    .replace('Ausbildung', `${ESC}[31mFAKE ERROR${ESC}[0m`)
    .replace('Kenntnisse', 'X'.repeat(500));
  const hostileRun = captureWarnings(() => reorderCvSections(hostileTitle, ['skills', 'education']));
  const emitted = hostileRun.warnings.join('\n');
  if (emitted.includes(ESC)) {
    fail('control characters from a rendered title survived into a warning');
  } else if (emitted.length >= 700) {
    fail(`a 500-character title produced a ${emitted.length}-character warning — it is not being truncated`);
  } else {
    pass('a rendered title is stripped of control characters and truncated before it reaches a warning');
  }

  // A control character is not the only way text rewrites a terminal line:
  // U+202E reverses what follows, so a title can be made to read as output the
  // tool produced. And truncating by UTF-16 unit can cut a surrogate pair in
  // half, emitting a lone surrogate into the log.
  const RTL_OVERRIDE = '‮';
  const bidiAndAstral = unknownTitles
    .replace('Ausbildung', `${RTL_OVERRIDE}gnudlibsuA`)
    .replace('Kenntnisse', '😀'.repeat(80));
  const bidiRun = captureWarnings(() => reorderCvSections(bidiAndAstral, ['skills', 'education']));
  const bidiText = bidiRun.warnings.join('\n');
  const hasLoneSurrogate = [...bidiText].some(ch => {
    const code = ch.charCodeAt(0);
    return code >= 0xd800 && code <= 0xdfff && ch.length === 1;
  });
  if (!bidiText.includes(RTL_OVERRIDE) && !hasLoneSurrogate) {
    pass('bidi overrides are stripped and truncation never splits a surrogate pair');
  } else {
    fail(`title sanitization leaked ${bidiText.includes(RTL_OVERRIDE) ? 'a bidi override' : 'a lone surrogate'}`);
  }

  // The report is per-name, not per-render, and says only what can be checked.
  // Whether an unresolved name is an absent optional section or the section
  // under an unidentifiable heading is not knowable here, so the message states
  // both facts and draws no conclusion. It must not depend on whether the
  // document changed: an order that was already satisfied changes no bytes and
  // is a success, while a partly-resolving order can change none and be a
  // failure — the byte count distinguishes neither.
  const alreadySatisfied = FIXTURE.replace('>Certifications<', '>Portfolio<');
  const satisfiedRun = captureWarnings(() => reorderCvSections(alreadySatisfied, ['education', 'skills', 'awards']));
  const swapRun = captureWarnings(() => reorderCvSections(alreadySatisfied, ['skills', 'education', 'awards']));
  const namesAwardsAndPortfolio = (w) => w.includes('"awards"') && w.includes('Portfolio') && !w.includes('changed nothing');
  // Byte-for-byte equality of the emitted warnings, not merely "both mention
  // awards" — the claim is that the report does not vary with the outcome, and
  // a weaker check would hold even if the wording differed between the paths.
  if (satisfiedRun.value === alreadySatisfied && swapRun.value !== alreadySatisfied
      && JSON.stringify(satisfiedRun.warnings) === JSON.stringify(swapRun.warnings)
      && satisfiedRun.warnings.some(namesAwardsAndPortfolio)) {
    pass('the unresolved-name report is identical whether the order was already satisfied or had to be applied');
  } else {
    fail(`report depends on whether bytes changed: satisfied=${JSON.stringify(satisfiedRun.warnings)} swapped=${JSON.stringify(swapRun.warnings)}`);
  }

  // And it stays quiet when every configured name resolved, however many
  // unidentifiable headings the CV carries elsewhere.
  const allResolved = captureWarnings(() => reorderCvSections(alreadySatisfied, ['skills', 'education']));
  if (allResolved.warnings.length === 0) {
    pass('no report when every configured name resolved, whatever else the CV renders');
  } else {
    fail(`spurious report when all names resolved: ${JSON.stringify(allResolved.warnings)}`);
  }

  // The same must not fire when the setting simply had nothing to do: an
  // English CV missing an optional section is ordinary, not a misconfiguration.
  const quiet = captureWarnings(() => reorderCvSections(FIXTURE, ['skills', 'awards']));
  if (quiet.warnings.length === 0) {
    pass('a recognized-but-absent section still warns about nothing');
  } else {
    fail(`unexpected warning for an ordinary absent section: ${JSON.stringify(quiet.warnings)}`);
  }

  // Nor when the reorder worked. A custom heading elsewhere in the CV is the
  // user's business; the warning is about the setting failing, not about the
  // alias table being incomplete in the abstract.
  const mixed = FIXTURE.replace('>Certifications<', '>Auszeichnungen<');
  const mixedRun = captureWarnings(() => reorderCvSections(mixed, ['skills', 'education']));
  if (JSON.stringify(renderedTitles(mixedRun.value)) === JSON.stringify(
        ['Professional Summary', 'Work Experience', 'Projects', 'Skills', 'Auszeichnungen', 'Education'])
      && mixedRun.warnings.length === 0) {
    pass('an unrecognized title elsewhere is silent when the configured sections did resolve');
  } else {
    fail(`spurious warning or wrong order with a mixed-language CV: ${JSON.stringify(mixedRun.warnings)} ${JSON.stringify(renderedTitles(mixedRun.value))}`);
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


// ── batch mode applies the declared order too (#2747 added a second render path) ──
//    reorderCvSections() sits in the single-render path. --batch (#2384, reworked
//    by #2747 to reuse one Chromium) prepares each entry on its own code path, and
//    that path called validateCvSectionOrder() WITHOUT calling reorderCvSections()
//    first. The result was not a crash: cv.sections simply did nothing in batch
//    mode, which is precisely the silent no-op this feature exists to remove — the
//    user configures an order, N CVs render, and nothing says the setting was
//    ignored.
//
//    Driven through the CLI because runBatchFromManifest() is not exported. The
//    playwright stub embeds the HTML it was handed into the PDF it returns (the
//    shape tests/generate-pdf-batch.test.mjs uses), so the assertion reads the
//    order that was actually about to be PRINTED, not the order of the input file.
{
  const outputRoot = join(ROOT, 'output');
  mkdirSync(outputRoot, { recursive: true });
  // realpathSync: see tests/generate-pdf-page-budget.test.mjs -- argv[1] keeps the
  // caller's spelling while import.meta.url is realpathed, so a symlinked
  // output/ makes generate-pdf.mjs's isMain guard false and the spawn a no-op (#3165).
  const sandbox = realpathSync(mkdtempSync(join(outputRoot, 'section-order-batch-')));
  try {
    const script = join(sandbox, 'generate-pdf.mjs');
    for (const f of [
      'generate-pdf.mjs', 'theme-style.mjs', 'tracker-utils.mjs',
      'tracker-parse.mjs', 'tracker-aliases.json', 'pipeline-lock.mjs',
    ]) {
      copyFileSync(join(ROOT, f), join(sandbox, f));
    }

    // theme-style.mjs and tracker-utils.mjs both `import * as yaml from
    // 'js-yaml'`, resolved by walking up into the repo's node_modules -- from
    // the sandbox's REALPATH, so a checkout with a symlinked output/ never
    // reaches it and the spawned generate-pdf dies before parsing argv (#3165).
    linkRepoPackage(sandbox, 'js-yaml');
    mkdirSync(join(sandbox, 'data'), { recursive: true });
    writeFileSync(join(sandbox, 'data', 'pdf-index.tsv'), '', 'utf-8');

    // readCvSectionOrder() anchors to the SCRIPT's dirname, not the cwd, so the
    // profile has to live beside the copied script for the batch run to see it.
    mkdirSync(join(sandbox, 'config'), { recursive: true });
    writeFileSync(
      join(sandbox, 'config', 'profile.yml'),
      'cv:\n  sections:\n    - education\n    - experience\n',
      'utf-8',
    );

    const playwrightStub = join(sandbox, 'node_modules', 'playwright');
    mkdirSync(playwrightStub, { recursive: true });
    writeFileSync(join(playwrightStub, 'package.json'), JSON.stringify({
      name: 'playwright', type: 'module', exports: './index.js',
    }), 'utf-8');
    writeFileSync(join(playwrightStub, 'index.js'), `
import { readFile } from 'fs/promises';
function twoPagePdf(markerText) {
  const marker = Buffer.from(markerText, 'utf-8').toString('base64');
  return Buffer.from(\`%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Marker (\${marker}) >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R >>
endobj
%%EOF\`, 'latin1');
}
function makePage() {
  let rendered = '';
  return {
    async goto(url) { rendered = await readFile(new URL(url), 'utf-8'); },
    async evaluate() {},
    async pdf() { return twoPagePdf(rendered); },
    async close() {},
  };
}
export const chromium = {
  async launch() {
    return {
      async newContext() {
        return { async newPage() { return makePage(); }, async close() {} };
      },
      async newPage() { return makePage(); },
      async close() {},
    };
  },
};
`, 'utf-8');

    writeFileSync(join(sandbox, 'in.html'), FIXTURE, 'utf-8');
    const manifest = join(sandbox, 'batch.json');
    writeFileSync(manifest, JSON.stringify([{ input: 'in.html', output: 'out/in.pdf' }]), 'utf-8');

    const run = spawnSync(NODE, [script, `--batch=${manifest}`], {
      cwd: sandbox, encoding: 'utf-8', timeout: 60_000,
    });
    const outPdf = join(sandbox, 'out', 'in.pdf');

    if (!existsSync(outPdf)) {
      fail(`batch render produced no PDF: ${(run.stdout || '') + (run.stderr || '')}`);
    } else {
      // Recover the HTML the stub was actually handed, so the order asserted is
      // the printed one rather than the input file's.
      const pdf = readFileSync(outPdf).toString('latin1');
      const m = pdf.match(/\/Marker \(([^)]*)\)/);
      const printed = m ? Buffer.from(m[1], 'base64').toString('utf-8') : '';
      const titles = renderedTitles(printed);
      const iEdu = titles.indexOf('Education');
      const iExp = titles.indexOf('Work Experience');
      const inputTitles = renderedTitles(FIXTURE);

      if (inputTitles.indexOf('Education') < inputTitles.indexOf('Work Experience')) {
        fail('fixture already renders Education before Work Experience — the batch assertion would pass without any reordering');
      } else if (iEdu === -1 || iExp === -1) {
        fail(`could not read both section titles back out of the batch PDF (got ${titles.join(' -> ') || 'nothing'})`);
      } else if (iEdu < iExp) {
        pass('--batch applies cv.sections: Education renders before Work Experience in the printed document');
      } else {
        fail(`--batch ignored cv.sections: printed order was ${titles.join(' -> ')}`);
      }
    }
  } catch (e) {
    fail(`batch section-order test crashed: ${e.message}`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}


// ── cv.sections is read from the WORKSPACE profile, like every other setting ──
//    readStyleTokens() resolves config/profile.yml against workspaceRoot. This
//    read was anchored to __dirname instead, so with CAREER_OPS_TRACKER pointing
//    at a workspace outside the checkout the two settings came from two
//    DIFFERENT files of the same name: style tokens from the workspace, section
//    order from the repo. cv.md is read from workspaceRoot too, so the guard was
//    judging the workspace's CV against the repo's declared order (CodeRabbit).
//
//    The fixture puts the profile ONLY in the external workspace, so an
//    __dirname-anchored read finds nothing and silently applies no order.
{
  const outputRoot = join(ROOT, 'output');
  mkdirSync(outputRoot, { recursive: true });
  // realpathSync: see tests/generate-pdf-page-budget.test.mjs -- argv[1] keeps the
  // caller's spelling while import.meta.url is realpathed, so a symlinked
  // output/ makes generate-pdf.mjs's isMain guard false and the spawn a no-op (#3165).
  const sandbox = realpathSync(mkdtempSync(join(outputRoot, 'section-order-anchor-')));
  try {
    const script = join(sandbox, 'generate-pdf.mjs');
    for (const f of [
      'generate-pdf.mjs', 'theme-style.mjs', 'tracker-utils.mjs',
      'tracker-parse.mjs', 'tracker-aliases.json', 'pipeline-lock.mjs',
    ]) {
      copyFileSync(join(ROOT, f), join(sandbox, f));
    }

    // theme-style.mjs and tracker-utils.mjs both `import * as yaml from
    // 'js-yaml'`, resolved by walking up into the repo's node_modules -- from
    // the sandbox's REALPATH, so a checkout with a symlinked output/ never
    // reaches it and the spawned generate-pdf dies before parsing argv (#3165).
    linkRepoPackage(sandbox, 'js-yaml');

    // The external workspace: tracker, profile, CV and documents all live here,
    // and NOT beside the script. This is the shape CAREER_OPS_TRACKER creates.
    const ws = join(sandbox, 'ws');
    mkdirSync(join(ws, 'data'), { recursive: true });
    mkdirSync(join(ws, 'config'), { recursive: true });
    writeFileSync(join(ws, 'data', 'applications.md'), '# Applications Tracker\n', 'utf-8');
    writeFileSync(join(ws, 'data', 'pdf-index.tsv'), '', 'utf-8');
    writeFileSync(
      join(ws, 'config', 'profile.yml'),
      'cv:\n  sections:\n    - education\n    - experience\n',
      'utf-8',
    );
    writeFileSync(join(ws, 'in.html'), FIXTURE, 'utf-8');

    const playwrightStub = join(sandbox, 'node_modules', 'playwright');
    mkdirSync(playwrightStub, { recursive: true });
    writeFileSync(join(playwrightStub, 'package.json'), JSON.stringify({
      name: 'playwright', type: 'module', exports: './index.js',
    }), 'utf-8');
    writeFileSync(join(playwrightStub, 'index.js'), `
import { readFile } from 'fs/promises';
function twoPagePdf(markerText) {
  const marker = Buffer.from(markerText, 'utf-8').toString('base64');
  return Buffer.from(\`%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Marker (\${marker}) >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R >>
endobj
%%EOF\`, 'latin1');
}
function makePage() {
  let rendered = '';
  return {
    async goto(url) { rendered = await readFile(new URL(url), 'utf-8'); },
    async evaluate() {},
    async pdf() { return twoPagePdf(rendered); },
    async close() {},
  };
}
export const chromium = {
  async launch() {
    return {
      async newContext() {
        return { async newPage() { return makePage(); }, async close() {} };
      },
      async newPage() { return makePage(); },
      async close() {},
    };
  },
};
`, 'utf-8');

    const manifest = join(ws, 'batch.json');
    writeFileSync(manifest, JSON.stringify([{ input: 'in.html', output: 'out/in.pdf' }]), 'utf-8');

    const run = spawnSync(NODE, [script, `--batch=${manifest}`], {
      cwd: sandbox,
      encoding: 'utf-8',
      timeout: 60_000,
      env: { ...process.env, CAREER_OPS_TRACKER: join(ws, 'data', 'applications.md') },
    });
    const outPdf = join(ws, 'out', 'in.pdf');

    if (!existsSync(outPdf)) {
      fail(`workspace-anchored render produced no PDF: ${(run.stdout || '') + (run.stderr || '')}`);
    } else {
      const pdf = readFileSync(outPdf).toString('latin1');
      const m = pdf.match(/\/Marker \(([^)]*)\)/);
      const printed = m ? Buffer.from(m[1], 'base64').toString('utf-8') : '';
      const titles = renderedTitles(printed);
      const iEdu = titles.indexOf('Education');
      const iExp = titles.indexOf('Work Experience');
      if (existsSync(join(sandbox, 'config', 'profile.yml'))) {
        fail('a profile exists beside the script — the __dirname anchor would find it and the assertion would prove nothing');
      } else if (iEdu === -1 || iExp === -1) {
        fail(`could not read both section titles back out (got ${titles.join(' -> ') || 'nothing'})`);
      } else if (iEdu < iExp) {
        pass('cv.sections is read from the workspace profile when CAREER_OPS_TRACKER moves the workspace off __dirname');
      } else {
        fail(`the workspace profile was ignored: printed order was ${titles.join(' -> ')}`);
      }
    }
  } catch (e) {
    fail(`workspace-anchor test crashed: ${e.message}`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}


// -- configured names reach the terminal, so they get displayTitle() too --
//    The rendered-title warning already sanitizes, because these strings land in
//    a terminal or a run log. The names from config/profile.yml did not: an ESC
//    sequence repaints the line so a warning can appear to say something the
//    tool never printed, U+202E reverses what follows, and an unbounded name
//    buries the message it is attached to (CodeRabbit).
//
//    Every warning site an arbitrary name can REACH is exercised, not just one.
//    Covering a single site let a dropped displayTitle() elsewhere pass: with
//    only the not-a-section case here, reverting the duplicate-name site scored
//    0 failures (CodeRabbit's follow-up, confirmed by mutation before fixing).
//
//    The two remaining sites -- the ambiguous-markup warning and the unresolved
//    report -- are deliberately absent. Both sit after CV_SECTION_KEYS.includes(name)
//    has passed, so `name` there is a canonical key like "skills" and no config
//    string can reach them. A hostile-input case for those would assert nothing.
//    displayTitle() stays on them as defence in depth, in case a later change
//    widens what arrives.
//
//    The hostile names are BUILT at runtime rather than written as literals, so
//    this file stays safe to cat and safe to paste into a review.
{
  const { reorderCvSections: reorder } =
    await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);

  const esc = String.fromCharCode(0x1b);
  const ESC = esc + '[31mFAKE-ERROR' + esc + '[0m';
  const RTL = 'testing' + String.fromCharCode(0x202e);
  const LONG = 'z'.repeat(200);
  // Same, but carrying a double quote: displayTitle() leaves quotes alone, so
  // this is the shape that defeats a lazy extractor.
  const QLONG = 'aa"' + 'z'.repeat(200);

  const CONTROLS = new RegExp('[\u0000-\u001f\u007f-\u009f]');
  const BIDI = new RegExp('[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]');
  // Mirrors DISPLAY_TITLE_MAX in generate-pdf.mjs. Asserted rather than just
  // described: "the full 200-char name is absent" is satisfied by ANY
  // truncation, so on its own it still passed with the cap widened to 150
  // (CodeRabbit; confirmed by mutation). Measuring the quoted name pins the
  // documented bound instead.
  const NAME_MAX = 60;
  // Every warning quotes the configured name as `lists "X"` or `lists only "X"`.
  const quotedName = (w) => {
    // GREEDY to the last quote, not lazy to the first. displayTitle() does not
    // strip double quotes, so a name carrying one truncates a lazy capture at
    // that character: `lists "aa"zzz..."` measured 2 code points instead of 60,
    // which would let an overlong name pass the bound. Each site below quotes
    // the name exactly once, so the last quote is its closing one.
    const m = w.match(/lists (?:only )?"(.*)"/);
    return m ? [...m[1]] : null;   // spread: code points, not UTF-16 units
  };

  // One entry per reachable site, each with the shape that actually lands there.
  const sites = [
    // order.length < 2 returns early through its own warning, before the loop.
    { site: 'single-name', order: [ESC] },
    // The second occurrence hits `seen.has(name)`; the first spends itself on
    // the not-a-section branch, so both sites fire from this one call.
    { site: 'duplicate-name', order: ['skills', ESC, ESC] },
    { site: 'not-a-CV-section', order: ['skills', ESC, RTL, LONG, QLONG] },
  ];

  const failures = [];
  for (const { site, order } of sites) {
    const { warnings } = captureWarnings(() => reorder(FIXTURE, order));
    if (warnings.length === 0) {
      failures.push(site + ' emitted no warning (nothing was asserted)');
      continue;
    }
    // Each warning on its own: joining them first splices in a newline, which is
    // itself inside the C0 range below, so the control check would report a leak
    // no matter how the code behaved. That is how the first version of this
    // assertion "failed" against correct code.
    const leaks = [];
    if (warnings.some(w => CONTROLS.test(w))) leaks.push('C0/C1 control');
    if (warnings.some(w => BIDI.test(w))) leaks.push('bidi override');
    if (warnings.some(w => w.includes(LONG))) leaks.push('untruncated name');

    // The bound itself. A site whose warnings quote no name at all would make
    // this assert nothing, so that counts as a failure rather than a pass.
    const quoted = warnings.map(quotedName).filter(Boolean);
    if (quoted.length === 0) {
      leaks.push('no quoted name found (length bound asserted nothing)');
    } else {
      const over = quoted.map(cp => cp.length).filter(n => n > NAME_MAX);
      if (over.length > 0) leaks.push('name over ' + NAME_MAX + ' code points (' + over.join(', ') + ')');
    }
    if (leaks.length > 0) failures.push(site + ': ' + leaks.join(', '));
  }

  if (failures.length === 0) {
    pass('cv.sections names are sanitized and length-bounded at every warning site a config string can reach');
  } else {
    fail('configured name reached a warning unsanitized -- ' + failures.join(' | '));
  }
}
