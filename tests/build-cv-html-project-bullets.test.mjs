import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('build-cv-html renders project bullets as list items', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-project-bullets-'));
  try {
    const input = join(dir, 'payload.json');
    const output = join(dir, 'cv.html');
    writeFileSync(input, JSON.stringify({
      lang: 'en',
      page_format: 'letter',
      candidate: { name: 'Test Candidate', email: 'test@example.com' },
      summary: 'Test summary',
      competencies: [],
      experience: [],
      projects: [{
        name: 'Agent Core',
        bullets: ['Designed the event pipeline', 'Reduced setup time'],
        tech: 'TypeScript',
      }],
      education: [],
      certifications: [],
      awards: [],
      skills: [],
    }));

    execFileSync(process.execPath, [
      'build-cv-html.mjs',
      input,
      output,
      'templates/cv-template.jake.html',
    ], { cwd: process.cwd(), encoding: 'utf8' });

    const html = readFileSync(output, 'utf8');
    assert.match(html, /<ul class="project-bullets">/);
    assert.match(html, /<li>Designed the event pipeline<\/li>/);
    assert.match(html, /<li>Reduced setup time<\/li>/);
    assert.doesNotMatch(html, /<div class="project-desc">Designed the event pipeline Reduced setup time<\/div>/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
