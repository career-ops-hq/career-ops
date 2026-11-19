// Internal subprocess entrypoint. Reuse the complete upstream CLI validation
// pipeline, with an explicitly sandboxed browser and machine-readable result.
import fs from 'node:fs/promises';
import path from 'node:path';
import { generatePDF, launchChromium, extractSourceSectionOrder, extractRenderedSectionOrder, CV_SECTION_KEYS } from '../generate-pdf.mjs';
import { stripEmptyRenderedSections } from '../cv-sections-core.mjs';

try {
  const source = await fs.readFile(path.join(process.env.CAREER_OPS_ROOT, 'cv.md'), 'utf8');
  const html = await fs.readFile(process.argv[2], 'utf8');
  const known = new Set(CV_SECTION_KEYS);
  const required = extractSourceSectionOrder(source).filter(section => known.has(section.key));
  const found = new Set(extractRenderedSectionOrder(stripEmptyRenderedSections(html)).map(section => section.key));
  // Core ordering compares surviving sections; hosted publication also refuses
  // to silently lose a recognized source section, including a single section.
  if (required.some(section => !found.has(section.key))) throw new Error('Source section omitted');
  let browserVersion;
  const result = await generatePDF({ launchBrowser: async options => {
    const browser = await launchChromium({ ...options, chromiumSandbox: true });
    browserVersion = browser.version();
    return browser;
  } });
  console.log(`HOSTED_RENDER_RESULT=${JSON.stringify({ pageCount: result.pageCount, size: result.size, browserVersion })}`);
} catch {
  console.error('Hosted PDF validation or rendering failed.');
  process.exitCode = 1;
}
