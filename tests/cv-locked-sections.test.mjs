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

  // Numeric and named HTML entity normalization (e.g. &#39; for apostrophe)
  const apostropheCv = "# Education\n* Bachelor's degree & Master's in CS\n* Don't alter this text\n";
  const apostropheHtml = `
    <h2 class="section-title">Education</h2>
    <ul>
      <li>Bachelor&#39;s degree &amp; Master&#39;s in CS</li>
      <li>Don&#39;t alter this text</li>
    </ul>
  `;
  let threwEntity = false;
  try {
    validateLockedSections(apostropheHtml, apostropheCv, ['education']);
  } catch {
    threwEntity = true;
  }
  if (!threwEntity) {
    pass('validateLockedSections normalizes numeric entities like &#39; cleanly');
  } else {
    fail('validateLockedSections should match content containing numeric entities like &#39;');
  }

  // Subheadings in source Markdown (### inside ## section) do not truncate section
  const subheadingCv = `## Work Experience
### Staff AI Engineer — Acme Corp (2022 - Present)
* Built LLM agent pipelines
### Senior ML Engineer — Beta Inc (2020 - 2022)
* Scaled inference platform

## Education
### University of Oxford
* M.Sc. Computer Science
`;
  const subheadingHtml = `
    <h2 class="section-title">Work Experience</h2>
    <div class="job">
      <h3>Staff AI Engineer — Acme Corp (2022 - Present)</h3>
      <p>Built LLM agent pipelines</p>
    </div>
    <div class="job">
      <h3>Senior ML Engineer — Beta Inc (2020 - 2022)</h3>
      <p>Scaled inference platform</p>
    </div>
    <h2 class="section-title">Education</h2>
    <h3>University of Oxford</h3>
    <p>M.Sc. Computer Science</p>
  `;
  let threwSubheading = false;
  try {
    validateLockedSections(subheadingHtml, subheadingCv, ['experience']);
  } catch (e) {
    threwSubheading = true;
    fail(`validateLockedSections threw for subheadings inside section: ${e.message}`);
  }
  if (!threwSubheading) {
    pass('validateLockedSections preserves subheadings inside sections without truncating');
  }

  // A cv.md that opens with an H1 title (as examples/cv-example.md does) keeps
  // its ## sections addressable: the title must not swallow them.
  const titledCv = `# Jane Doe
jane@example.com

## Work Experience
### Staff AI Engineer — Acme Corp (2022 - Present)
* Built LLM agent pipelines

## Education
### University of Oxford
* M.Sc. Computer Science
`;
  let threwTitled = false;
  try {
    validateLockedSections(subheadingHtml, titledCv, ['education']);
  } catch (e) {
    threwTitled = true;
    fail(`validateLockedSections lost a ## section under an H1 title: ${e.message}`);
  }
  if (!threwTitled) {
    pass('validateLockedSections finds ## sections in a cv.md that opens with an H1 title');
  }

  let threwTitledChanged = false;
  try {
    validateLockedSections(subheadingHtml.replace('M.Sc.', 'Ph.D.'), titledCv, ['education']);
  } catch (e) {
    threwTitledChanged = e.message.includes("Locked section 'education' was modified during tailoring");
    if (!threwTitledChanged) fail(`validateLockedSections threw wrong error under an H1 title: ${e.message}`);
  }
  if (threwTitledChanged) {
    pass('validateLockedSections still rejects a changed ## section under an H1 title');
  } else {
    fail('validateLockedSections must reject a changed ## section under an H1 title');
  }

} catch (e) {
  fail(`validateLockedSections tests crashed: ${e.message}`);
}
