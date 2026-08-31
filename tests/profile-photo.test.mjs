import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(ROOT, 'templates', 'cv-template.html');
const ONE_PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function payload(photo = '', photo_style = 'rounded') {
  return {
    lang: 'en', page_format: 'a4',
    candidate: { name: 'Test Candidate', email: 'test@example.com', photo, photo_style },
    summary: 'Test summary', competencies: ['Testing'],
    experience: [{ company: 'Test Co', role: 'Engineer', dates: '2026', bullets: ['Built tests.'] }],
    projects: [], education: [{ title: 'BSc', org: 'Test University', year: '2025' }],
    certifications: [], skills: [{ category: 'Tools', items: ['Node.js'] }],
  };
}

function render(inputPayload, { preview = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'photo-cv-'));
  const input = join(dir, 'input.json');
  const output = join(dir, 'output.html');
  writeFileSync(input, JSON.stringify(inputPayload));
  const args = preview
    ? ['build-cv-html.mjs', '--preview', input, TEMPLATE]
    : ['build-cv-html.mjs', input, output, TEMPLATE];
  const stdout = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  return { html: readFileSync(preview ? join(ROOT, 'output', 'cv-preview.html') : output, 'utf8'), stdout, output };
}

test('no photo emits no img and reserves no photo markup', () => {
  const { html } = render(payload());
  assert.doesNotMatch(html, /<img[^>]*cv-photo/);
});

test('absolute local image is validated and inlined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'photo-source-'));
  const photo = join(dir, 'headshot.png');
  writeFileSync(photo, ONE_PIXEL_PNG);
  const { html } = render(payload(photo, 'circle'));
  assert.match(html, /class="cv-photo cv-photo--circle"/);
  assert.match(html, /src="data:image\/png;base64,/);
});

test('project-relative image is validated and inlined', () => {
  const { html } = render(payload('docs/logo.png', 'square'));
  assert.match(html, /class="cv-photo cv-photo--square"/);
  assert.match(html, /src="data:image\/png;base64,/);
});

test('single-letter Windows drive paths reach local file handling', () => {
  const dir = mkdtempSync(join(tmpdir(), 'photo-windows-path-'));
  const input = join(dir, 'input.json');
  const output = join(dir, 'output.html');
  writeFileSync(input, JSON.stringify(payload('Z:\\does-not-exist\\candidate\\headshot.png')));
  const result = spawnSync(process.execPath, ['build-cv-html.mjs', input, output, TEMPLATE], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /Unsupported profile photo URL scheme/);
  assert.match(result.stderr, /not found or unreadable/);
});

test('square photo styles enforce equal dimensions in both templates', () => {
  for (const name of ['cv-template.html', 'resume-template.html']) {
    const html = readFileSync(join(ROOT, 'templates', name), 'utf8');
    assert.match(html, /\.cv-photo--square\s*\{[^}]*aspect-ratio:\s*1;[^}]*height:\s*80px;/s);
  }
});

test('valid data URL remains supported', () => {
  const dataUrl = `data:image/png;base64,${ONE_PIXEL_PNG.toString('base64')}`;
  const { html } = render(payload(dataUrl));
  assert.match(html, /class="cv-photo cv-photo--rounded"/);
  assert.match(html, /src="data:image\/png;base64,/);
});

test('missing, unsupported, and invalid-style photos fail clearly', () => {
  const cases = [
    [payload('does-not-exist.png'), /not found or unreadable/],
    [payload('docs/roadmap-phases.jpg', 'hexagon'), /Unsupported profile photo style/],
    [payload('docs/file.svg'), /Unsupported profile photo format/],
  ];
  for (const [value, expected] of cases) {
    const dir = mkdtempSync(join(tmpdir(), 'photo-fail-'));
    const input = join(dir, 'input.json');
    const output = join(dir, 'output.html');
    writeFileSync(input, JSON.stringify(value));
    const result = spawnSync(process.execPath, ['build-cv-html.mjs', input, output, TEMPLATE], { cwd: ROOT, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
    assert.equal(existsSync(output), false);
  }
});

test('--preview writes a browser-openable local HTML artifact', () => {
  const { html, stdout } = render(payload('', 'rounded'), { preview: true });
  assert.match(stdout, /"status": "preview-ready"/);
  assert.match(html, /<!DOCTYPE html>/);
});
