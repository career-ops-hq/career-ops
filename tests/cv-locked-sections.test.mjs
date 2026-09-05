// tests/cv-locked-sections.test.mjs — unit coverage for cv.locked_sections enforcement (#2053)
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\ncv-locked-sections (#2053)');

try {
  const { validateLockedSections } = await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);

  // validateLockedSections tests
  const cvMarkdown = '# Education\n* Bachelor of Science\n* Foo University\n\n# Work Experience\n* Software Engineer\n';
  
  // Identical content, just different formatting
  const matchingHtml = `
    <h2 class="section-title">Education</h2>
    <ul>
      <li>Bachelor of Science</li>
      <li>Foo University</li>
    </ul>
    <h2 class="section-title">Work Experience</h2>
    <p>Software Engineer</p>
  `;
  
  // Paraphrased content
  const changedHtml = `
    <h2 class="section-title">Education</h2>
    <ul>
      <li>B.S.</li>
      <li>Foo Univ</li>
    </ul>
  `;

  // Missing section in HTML (section removed during tailoring)
  const missingSectionHtml = `
    <h2 class="section-title">Work Experience</h2>
    <p>Software Engineer</p>
  `;

  let threwMatch = false;
  try {
    validateLockedSections(matchingHtml, cvMarkdown, ['education']);
  } catch {
    threwMatch = true;
  }
  if (!threwMatch) {
    pass('validateLockedSections permits a locked section when content matches ignoring formatting');
  } else {
    fail('validateLockedSections should not throw when a locked section content is equivalent');
  }

  let threwChanged = false;
  try {
    validateLockedSections(changedHtml, cvMarkdown, ['education']);
  } catch {
    threwChanged = true;
  }
  if (threwChanged) {
    pass('validateLockedSections throws loudly when a locked section is modified');
  } else {
    fail('validateLockedSections must throw when locked section content differs');
  }

  let threwOmission = false;
  try {
    validateLockedSections(missingSectionHtml, cvMarkdown, ['education']);
  } catch (e) {
    if (e.message.includes("Locked section 'education' was modified during tailoring")) {
      threwOmission = true;
    } else {
      fail(`validateLockedSections threw wrong error for omitted locked section: ${e.message}`);
    }
  }
  if (threwOmission) {
    pass('validateLockedSections throws when a locked section is omitted from the HTML');
  } else {
    fail('validateLockedSections must throw when a locked section is omitted from the HTML');
  }

  // Not locked
  let threwNotLocked = false;
  try {
    validateLockedSections(changedHtml, cvMarkdown, []);
  } catch {
    threwNotLocked = true;
  }
  if (!threwNotLocked) {
    pass('validateLockedSections ignores modifications to unlocked sections');
  } else {
    fail('validateLockedSections threw for an unlocked section');
  }

  // Missing locked section in source
  let threwMissing = false;
  try {
    validateLockedSections(matchingHtml, cvMarkdown, ['skills']);
  } catch (e) {
    if (e.message.includes("Available sections: 'education', 'experience'")) {
      threwMissing = true;
    } else {
      fail(`validateLockedSections threw wrong error for missing locked section: ${e.message}`);
    }
  }
  if (threwMissing) {
    pass('validateLockedSections throws when a locked section is missing from the source');
  } else {
    fail('validateLockedSections must throw when a locked section does not exist in the source');
  }

  // Unicode-aware comparison test
  const unicodeCv = '# Education\n* Bachelor of Science (École Polytechnique, Zürich)\n* Über-cool café & résumé\n';
  const matchingUnicodeHtml = `
    <h2 class="section-title">Education</h2>
    <ul>
      <li>Bachelor of Science (École Polytechnique, Zürich)</li>
      <li>Über-cool café & résumé</li>
    </ul>
  `;
  let threwUnicode = false;
  try {
    validateLockedSections(matchingUnicodeHtml, unicodeCv, ['education']);
  } catch {
    threwUnicode = true;
  }
  if (!threwUnicode) {
    pass('validateLockedSections normalizes Unicode characters preserving letters with diacritics');
  } else {
    fail('validateLockedSections should match Unicode content cleanly');
  }

} catch (e) {
  fail(`validateLockedSections tests crashed: ${e.message}`);
}
