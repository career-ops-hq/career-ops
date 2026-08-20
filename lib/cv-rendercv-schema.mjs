/**
 * cv-rendercv-schema.mjs — Converter from career-ops JSON payload to RenderCV YAML
 *
 * RenderCV requires a specific YAML schema. This helper translates career-ops'
 * standardized JSON payload into a RenderCV-compliant YAML data structure.
 */

import yaml from 'js-yaml';

/**
 * Sanitize text to remove control characters problematic for YAML/LaTeX
 */
function cleanText(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

/**
 * Convert dates or date ranges into start_date and end_date for RenderCV
 */
function parseDates(dateStr) {
  if (!dateStr) return { start_date: '', end_date: '' };
  const str = cleanText(dateStr);
  const parts = str.split(/\s*[\u2013\u2014\-]|to\s*/i).map(p => p.trim());
  if (parts.length >= 2) {
    return {
      start_date: parts[0],
      end_date: parts[1].toLowerCase() === 'present' ? 'present' : parts[1]
    };
  }
  return { start_date: str, end_date: '' };
}

/**
 * Translate career-ops JSON payload into RenderCV data object
 */
export function convertJsonToRenderCvData(payload, options = {}) {
  const p = payload || {};
  const contact = p.contact || {};

  const cvData = {
    name: cleanText(p.name || 'Candidate Name'),
    sections: {}
  };

  const headline = cleanText(p.headline || p.target_role || '');
  if (headline) cvData.headline = headline;

  const location = cleanText(contact.location || p.location || '');
  if (location) cvData.location = location;

  const email = cleanText(contact.email || p.email || '');
  if (email) cvData.email = email;

  const phone = cleanText(contact.phone || p.phone || '');
  if (phone) cvData.phone = phone;

  const website = cleanText(contact.website || contact.portfolio || p.website || '');
  if (website) {
    let formattedWebsite = website;
    if (!/^https?:\/\//i.test(formattedWebsite)) {
      formattedWebsite = 'https://' + formattedWebsite;
    }
    cvData.website = formattedWebsite;
  }

  const social_networks = [];

  if (contact.linkedin) {
    let username = contact.linkedin.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//i, '').replace(/\/$/, '');
    social_networks.push({ network: 'LinkedIn', username });
  }

  if (contact.github) {
    let username = contact.github.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\/$/, '');
    social_networks.push({ network: 'GitHub', username });
  }

  if (social_networks.length > 0) {
    cvData.social_networks = social_networks;
  }

  const sections = {};

  // Summary
  if (p.summary) {
    const summaryText = Array.isArray(p.summary) ? p.summary.join(' ') : String(p.summary);
    if (summaryText.trim()) {
      sections.summary = [summaryText.trim()];
    }
  }

  // Work Experience
  if (Array.isArray(p.experience) && p.experience.length > 0) {
    sections.experience = p.experience.map(e => {
      const dates = parseDates(e.dates || e.period);
      const entry = {
        company: cleanText(e.company),
        position: cleanText(e.role || e.position || e.title),
        location: cleanText(e.location || ''),
      };
      if (dates.start_date) entry.start_date = dates.start_date;
      if (dates.end_date) entry.end_date = dates.end_date;
      if (Array.isArray(e.bullets) && e.bullets.length > 0) {
        entry.highlights = e.bullets.map(b => cleanText(b)).filter(Boolean);
      }
      return entry;
    });
  }

  // Education
  if (Array.isArray(p.education) && p.education.length > 0) {
    sections.education = p.education.map(ed => {
      const dates = parseDates(ed.dates || ed.period || ed.year);
      const entry = {
        institution: cleanText(ed.institution || ed.school || ed.university),
        degree: cleanText(ed.degree),
        area: cleanText(ed.area || ed.major || ed.field_of_study || ''),
        location: cleanText(ed.location || ''),
      };
      if (dates.start_date) entry.start_date = dates.start_date;
      if (dates.end_date) entry.end_date = dates.end_date;
      if (Array.isArray(ed.coursework) && ed.coursework.length > 0) {
        entry.highlights = [`Coursework: ${ed.coursework.join(', ')}`];
      }
      return entry;
    });
  }

  // Projects
  if (Array.isArray(p.projects) && p.projects.length > 0) {
    sections.projects = p.projects.map(proj => {
      const dates = parseDates(proj.dates || proj.period);
      const entry = {
        name: cleanText(proj.name || proj.title),
      };
      if (dates.start_date) entry.start_date = dates.start_date;
      if (dates.end_date) entry.end_date = dates.end_date;
      if (Array.isArray(proj.bullets) && proj.bullets.length > 0) {
        entry.highlights = proj.bullets.map(b => cleanText(b)).filter(Boolean);
      } else if (proj.context || proj.description) {
        entry.highlights = [cleanText(proj.context || proj.description)];
      }
      return entry;
    });
  }

  // Skills
  if (Array.isArray(p.skills) && p.skills.length > 0) {
    sections.skills = p.skills.map(s => {
      if (typeof s === 'string') {
        return { label: 'Skills', details: s };
      }
      return {
        label: cleanText(s.category || s.label || s.name || 'Skills'),
        details: Array.isArray(s.items) ? s.items.join(', ') : cleanText(s.details || s.skills)
      };
    });
  }

  cvData.sections = sections;

  const themeName = options.theme || 'classic';
  const designObj = {
    theme: themeName
  };

  if (options.font) designObj.font = options.font;
  if (options.font_size) designObj.font_size = options.font_size;
  if (options.page_size) designObj.page_size = options.page_size;
  if (options.primary_color) designObj.primary_color = options.primary_color;

  return {
    cv: cvData,
    design: designObj
  };
}

/**
 * Generate YAML string from JSON payload
 */
export function convertJsonToRenderCvYaml(payload, options = {}) {
  const data = convertJsonToRenderCvData(payload, options);
  return yaml.dump(data, { indent: 2, lineWidth: -1 });
}
