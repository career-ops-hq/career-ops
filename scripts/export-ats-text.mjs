#!/usr/bin/env node
/**
 * ATS Form Plain-Text Exporter (#2887)
 * Formats profile and experience data for seamless copy-pasting into ATS forms.
 */

import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    section: { type: 'string' },
    out: { type: 'string' },
  },
  allowPositionals: true,
});

export function formatAtsText(profile = {}) {
  const sections = [];

  if (profile.name || profile.email || profile.phone) {
    sections.push(`--- PERSONAL INFORMATION ---\nName: ${profile.name || ''}\nEmail: ${profile.email || ''}\nPhone: ${profile.phone || ''}`);
  }

  if (profile.summary) {
    sections.push(`--- SUMMARY ---\n${profile.summary}`);
  }

  if (Array.isArray(profile.experience)) {
    const expText = profile.experience
      .map(e => `${e.role || ''} at ${e.company || ''} (${e.duration || ''})\n${(e.bullets || []).map(b => `- ${b}`).join('\n')}`)
      .join('\n\n');
    sections.push(`--- EXPERIENCE ---\n${expText}`);
  }

  return sections.join('\n\n');
}

if (process.argv[1] && process.argv[1].endsWith('export-ats-text.mjs')) {
  const text = formatAtsText({
    name: 'Candidate',
    email: 'candidate@example.com',
    summary: 'Experienced Software Engineer with full-stack track record.',
    experience: [{ role: 'Senior Engineer', company: 'Tech Corp', duration: '2022-Present', bullets: ['Led frontend migration', 'Optimized APIs'] }],
  });
  console.log(text);
}
