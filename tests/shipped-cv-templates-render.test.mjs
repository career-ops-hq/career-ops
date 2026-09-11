import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTemplates } from '../cv-templates.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'cv-shipped-templates-'));
const input = join(dir, 'payload.json');

writeFileSync(input, JSON.stringify({
  lang: 'en',
  page_format: 'a4',
  candidate: {
    name: 'Jane Smith',
    phone: '+1 555 0100',
    email: 'jane@example.com',
    linkedin: {
      url: 'https://linkedin.com/in/janesmith',
      display: 'linkedin.com/in/janesmith',
    },
    portfolio: {
      url: 'https://janesmith.dev',
      display: 'janesmith.dev',
    },
    location: 'Berlin, Germany',
  },
  summary: 'Platform engineer who ships verification tooling.',
  competencies: ['Platform engineering', 'Distributed systems'],
  experience: [{
    company: 'Example GmbH',
    role: 'Staff Engineer',
    location: 'Berlin',
    dates: '2023 - Present',
    bullets: ['Cut deploy time from 40 minutes to 4.'],
  }],
  projects: [{ name: 'Open Source Thing', description: 'A tool people use.' }],
  education: [{ title: 'BSc Computer Science', org: 'Example University', year: '2018' }],
  certifications: [],
  awards: [],
  skills: [{ category: 'Languages', items: ['Go', 'TypeScript'] }],
}));

const templates = listTemplates('cv');

test('the shipped template list includes a pack', () => {
  assert.ok(templates.some((template) => template.pack));
});

for (const template of templates) {
  test(`${template.name}: renders the full contact row`, () => {
    const output = join(dir, `${template.name}.html`);
    execFileSync(process.execPath, ['build-cv-html.mjs', input, output, template.path], {
      cwd: ROOT,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    const html = readFileSync(output, 'utf-8');
    assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
    assert.match(html, /mailto:jane@example\.com/);
    assert.match(html, /linkedin\.com\/in\/janesmith/);
    assert.match(html, /janesmith\.dev/);
    assert.match(html, /Berlin, Germany/);
  });
}
