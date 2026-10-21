import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
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

// A local photo path is honoured only when config/profile.yml names it (#5094).
function writeProfile(root, photo) {
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'config', 'profile.yml'), `candidate:\n  photo: ${JSON.stringify(photo)}\n`);
}

function buildWith(inputPayload, profilePhoto) {
  const dir = mkdtempSync(join(tmpdir(), 'photo-guard-'));
  const root = join(dir, 'data-root');
  mkdirSync(join(root, 'output'), { recursive: true });
  if (profilePhoto !== undefined) writeProfile(root, profilePhoto);
  const input = join(dir, 'input.json');
  const output = join(dir, 'output.html');
  writeFileSync(input, JSON.stringify(inputPayload));
  const result = spawnSync(process.execPath, ['build-cv-html.mjs', input, output, TEMPLATE], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, CAREER_OPS_ROOT: root },
  });
  return { result, output };
}

function render(inputPayload, { preview = false, profilePhoto } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'photo-cv-'));
  const input = join(dir, 'input.json');
  const output = join(dir, 'output.html');
  writeFileSync(input, JSON.stringify(inputPayload));
  const args = preview
    ? ['build-cv-html.mjs', '--preview', input, TEMPLATE]
    : ['build-cv-html.mjs', input, output, TEMPLATE];

  // --preview ignores the output argument and resolves its destination from the
  // DATA ROOT (build-cv-html.mjs's only use of it), which is the candidate's own
  // output/ -- not the checkout. Unqualified, this test drops a "Test Candidate"
  // fixture into a real user's CV output directory on every run, from any
  // checkout, and then reads it back from the CHECKOUT's output/. Those two
  // paths are the same file only on a layout where the data root is the repo,
  // so the assertion passes by luck and the write escapes the sandbox.
  // Point the data root at this render's own temp dir: the preview lands there,
  // is read back from there, and nothing outside the sandbox is touched.
  const env = { ...process.env };
  let previewRoot;
  if (preview || profilePhoto !== undefined) {
    previewRoot = join(dir, 'data-root');
    mkdirSync(join(previewRoot, 'output'), { recursive: true });
    env.CAREER_OPS_ROOT = previewRoot;
  }
  if (profilePhoto !== undefined) writeProfile(previewRoot, profilePhoto);

  const stdout = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env });
  return { html: readFileSync(preview ? join(previewRoot, 'output', 'cv-preview.html') : output, 'utf8'), stdout, output };
}

test('no photo emits no img and reserves no photo markup', () => {
  const { html } = render(payload());
  assert.doesNotMatch(html, /<img[^>]*cv-photo/);
});

test('absolute local image is validated and inlined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'photo-source-'));
  const photo = join(dir, 'headshot.png');
  writeFileSync(photo, ONE_PIXEL_PNG);
  const { html } = render(payload(photo, 'circle'), { profilePhoto: photo });
  assert.match(html, /class="cv-photo cv-photo--circle"/);
  assert.match(html, /src="data:image\/png;base64,/);
});

test('project-relative image is validated and inlined', () => {
  const { html } = render(payload('docs/logo.png', 'square'), { profilePhoto: 'docs/logo.png' });
  assert.match(html, /class="cv-photo cv-photo--square"/);
  assert.match(html, /src="data:image\/png;base64,/);
});

test('single-letter Windows drive paths reach local file handling', () => {
  const dir = mkdtempSync(join(tmpdir(), 'photo-windows-path-'));
  const input = join(dir, 'input.json');
  const output = join(dir, 'output.html');
  const winPath = 'Z:\\does-not-exist\\candidate\\headshot.png';
  writeFileSync(input, JSON.stringify(payload(winPath)));
  const root = mkdtempSync(join(tmpdir(), 'photo-windows-root-'));
  writeProfile(root, winPath);
  const result = spawnSync(process.execPath, ['build-cv-html.mjs', input, output, TEMPLATE], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CAREER_OPS_ROOT: root } });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /Unsupported profile photo URL scheme/);
  assert.match(result.stderr, /not found or unreadable/);
});

test('a payload photo path that config/profile.yml does not name is refused (#5094)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'photo-secret-'));
  const secret = join(dir, 'private.png');
  writeFileSync(secret, ONE_PIXEL_PNG);
  const cases = [
    ['profile has no photo', undefined],
    ['profile names a different photo', 'docs/logo.png'],
  ];
  for (const [label, profilePhoto] of cases) {
    const { result, output } = buildWith(payload(secret), profilePhoto);
    assert.notEqual(result.status, 0, label);
    assert.match(result.stderr, /does not match candidate\.photo in config\/profile\.yml/, label);
    assert.equal(existsSync(output), false, label);
  }
});

test('a relative path that climbs out of the project is refused unless the profile names it (#5094)', () => {
  const { result, output } = buildWith(payload('../../../../etc/hosts.png'), 'docs/logo.png');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match candidate\.photo in config\/profile\.yml/);
  assert.equal(existsSync(output), false);
});

test('http(s) photo URLs do not need the profile (#5094)', () => {
  const { result, output } = buildWith(payload('https://example.com/me.png'), undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(output), true);
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
    const root = mkdtempSync(join(tmpdir(), 'photo-fail-root-'));
    writeProfile(root, value.candidate.photo);
    const result = spawnSync(process.execPath, ['build-cv-html.mjs', input, output, TEMPLATE], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CAREER_OPS_ROOT: root } });
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
