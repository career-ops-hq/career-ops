/**
 * A factual audit surface for the bundled LaTeX builder's structured records.
 * This is never rendered. Reusing the HTML field vocabulary lets one gate
 * compare source records without reverse-parsing TeX macros. The compiler's
 * final-text gate still checks template text and non-record content.
 */
import { hasRequiredFields } from './cv-payload-schema.mjs';

// Keep TeX control syntax literal too: the verifier also accepts raw .tex,
// and must not interpret payload text as a document boundary or subheading.
const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/\\/g, '&#92;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const field = (cls, value) => `<div class="${cls}">${escape(value)}</div>`;
const entries = (payload, section) => Array.isArray(payload[section])
  ? payload[section].filter(entry => hasRequiredFields(entry, section, 'tex')) : [];

/**
 * Project only records whose slots exist in the selected bundled template.
 * Ignore unsupported/unrendered payload keys, as the LaTeX builder does.
 * @param {object} payload validated LaTeX payload
 * @param {string} template template after empty sections have been removed
 * @returns {string} escaped, non-rendered fact-gate input
 */
export function latexPayloadFactHtml(payload, template) {
  const records = [];
  if (template.includes('{{EXPERIENCE}}')) {
    for (const entry of entries(payload, 'experience')) {
      const bullets = Array.isArray(entry.bullets) ? entry.bullets.map(b => `<li>${escape(b)}</li>`).join('') : '';
      records.push(`<div class="job">${field('job-company', entry.company)}${field('job-role', entry.role)}${field('job-period', entry.dates)}<ul>${bullets}</ul></div>`);
    }
  }
  if (template.includes('{{EDUCATION}}')) {
    for (const entry of entries(payload, 'education')) {
      records.push(`<div class="edu-item">${field('edu-title', entry.degree)}${field('edu-org', entry.institution)}${field('edu-year', entry.dates)}</div>`);
    }
  }
  if (template.includes('{{AWARDS}}')) {
    for (const entry of entries(payload, 'awards')) records.push(field('award-title', entry.title));
  }
  return records.join('\n');
}
