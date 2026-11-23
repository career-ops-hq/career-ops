// tests/validate-template-pack.test.mjs — the structural gate for a template
// pack (#5949). It reuses validateTemplate, atsLint and renderLint, so these
// tests cover the pack-level checks and that each of those three is wired in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validatePack } from '../validate-template-pack.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const CV = '<html><body><h1>{{NAME}}</h1><h2>{{SECTION_EXPERIENCE}}</h2>{{EXPERIENCE}}<h2>{{SECTION_EDUCATION}}</h2>{{EDUCATION}}</body></html>';
const COVER = '<html><body><h1>{{NAME}}</h1><p>{{ROLE_TITLE}}</p>{{OPENING}}</body></html>';

const baseEntry = (over = {}) => ({
  id: 'plain',
  displayName: 'Plain',
  kind: 'both',
  ats: true,
  atsRisk: 'none',
  files: { cv: 'templates/cv-template.plain.html', cover: 'templates/cover-letter-template.plain.html' },
  previews: { cv: 'previews/plain-cv.png', cover: 'previews/plain-cover.png' },
  ...over,
});
const basePack = (over = {}) => ({
  packVersion: 1,
  id: 'demo',
  name: 'career-ops-template-demo',
  displayName: 'Demo',
  description: 'A demo pack.',
  author: 'someone',
  license: 'MIT',
  version: '0.1.0',
  templates: [baseEntry()],
  ...over,
});

const dirs = [];
// Builds a pack on disk. `files` overrides or adds files by relative path; a
// null value removes the default.
function pack(manifest = basePack(), files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tpl-pack-'));
  dirs.push(dir);
  const all = {
    'pack.json': typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    'templates/cv-template.plain.html': CV,
    'templates/cover-letter-template.plain.html': COVER,
    'previews/plain-cv.png': 'png',
    'previews/plain-cover.png': 'png',
    ...files,
  };
  for (const [rel, body] of Object.entries(all)) {
    if (body === null) continue;
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const has = (problems, re) => assert.ok(problems.some((p) => re.test(p)), `expected ${re} in ${JSON.stringify(problems)}`);

test('a well-formed pack has no problems', () => {
  assert.deepEqual(validatePack(pack()), []);
});

test('a missing or invalid pack.json is reported', () => {
  has(validatePack(pack(basePack(), { 'pack.json': null })), /pack\.json/);
  has(validatePack(pack('{ nope')), /pack\.json.*invalid JSON/);
});

const MANIFEST_CASES = [
  ['an unsupported packVersion', { packVersion: 2 }, /packVersion/],
  ['an invalid id', { id: 'Demo', name: 'career-ops-template-Demo' }, /invalid pack id/],
  ['an id given as an array', { id: ['demo'] }, /invalid pack id/],
  ['a numeric id', { id: 123, name: 'career-ops-template-123' }, /invalid pack id/],
  ['a name that does not match the id', { name: 'career-ops-template-other' }, /name must equal/],
  ['an empty description', { description: '  ' }, /description/],
  ['a missing author', { author: undefined }, /author/],
  ['a missing license', { license: undefined }, /license/],
  ['a missing version', { version: undefined }, /version/],
  ['no templates', { templates: [] }, /templates must be a non-empty array/],
];
for (const [label, over, re] of MANIFEST_CASES) {
  test(`rejects ${label}`, () => has(validatePack(pack(basePack(over))), re));
}

const ENTRY_CASES = [
  ['an invalid template id', { id: 'Plain' }, /invalid template id/],
  ['a template id given as an array', { id: ['plain'] }, /invalid template id/],
  ['an unknown kind', { kind: 'tex' }, /invalid kind/],
  ['a non-boolean ats', { ats: 'yes' }, /ats must be a boolean/],
  ['an unknown atsRisk', { atsRisk: 'high' }, /invalid atsRisk/],
  ['design-forward without a note', { atsRisk: 'design-forward' }, /atsRiskNote is required/],
  ['a cv file with the wrong name', { files: { cv: 'templates/resume.html', cover: 'templates/cover-letter-template.plain.html' } }, /does not match the filename convention/],
  ['a file path that escapes the pack', { files: { cv: '../outside/cv-template.plain.html', cover: 'templates/cover-letter-template.plain.html' } }, /outside the pack/],
  ['a file path with a .. segment that resolves inside the pack', { files: { cv: 'nested/../cv-template.plain.html', cover: 'templates/cover-letter-template.plain.html' } }, /files\.cv .* contains a `\.\.` segment/],
  ['a file path with a backslash .. segment', { files: { cv: 'templates\\..\\templates/cv-template.plain.html', cover: 'templates/cover-letter-template.plain.html' } }, /files\.cv .* contains a `\.\.` segment/],
  ['a preview path with a .. segment', { previews: { cv: 'previews/../previews/plain-cv.png', cover: 'previews/plain-cover.png' } }, /previews\.cv .* contains a `\.\.` segment/],
  ['an absolute file path', { files: { cv: '/etc/cv-template.plain.html', cover: 'templates/cover-letter-template.plain.html' } }, /outside the pack/],
  ['a missing files entry for the kind', { files: { cv: 'templates/cv-template.plain.html' } }, /files\.cover missing/],
  ['a missing preview entry', { previews: { cv: 'previews/plain-cv.png' } }, /previews\.cover/],
];
for (const [label, over, re] of ENTRY_CASES) {
  test(`rejects ${label}`, () => has(validatePack(pack(basePack({ templates: [baseEntry(over)] }))), re));
}

test('design-forward with a note is valid and skips the ATS lint', () => {
  const spaced = '<html><body><h1>{{NAME}}</h1><h2>Career Timeline</h2>{{EXPERIENCE}}{{EDUCATION}}</body></html>';
  const p = pack(
    basePack({ templates: [baseEntry({ ats: false, atsRisk: 'design-forward', atsRiskNote: 'two-column header', kind: 'cv', files: { cv: 'templates/cv-template.plain.html' }, previews: { cv: 'previews/plain-cv.png' } })] }),
    { 'templates/cv-template.plain.html': spaced },
  );
  assert.deepEqual(validatePack(p), []);
});

test('duplicate template ids are reported', () => {
  has(validatePack(pack(basePack({ templates: [baseEntry(), baseEntry()] }))), /duplicate template id/);
});

test('a declared file that does not exist is reported', () => {
  has(validatePack(pack(basePack(), { 'templates/cv-template.plain.html': null })), /missing file/);
});

test('a declared preview that does not exist is reported', () => {
  has(validatePack(pack(basePack(), { 'previews/plain-cover.png': null })), /previews\.cover.*not found/);
});

test('a preview that is a directory is rejected', () => {
  const dir = pack(basePack(), { 'previews/plain-cv.png': null });
  mkdirSync(join(dir, 'previews/plain-cv.png'));
  has(validatePack(dir), /previews\.cv.*not a file/);
});

// Symlinks need privileges on some platforms (Windows without developer mode).
// Skip only on a permission error; any other failure is a real failure.
function trySymlink(t, target, link) {
  try {
    symlinkSync(target, link);
    return true;
  } catch (err) {
    if (err?.code === 'EPERM' || err?.code === 'EACCES') { t.skip(`cannot create symlinks here: ${err.code}`); return false; }
    throw err;
  }
}

test('a preview symlink that points outside the pack is rejected', (t) => {
  const outside = mkdtempSync(join(tmpdir(), 'tpl-out-'));
  dirs.push(outside);
  writeFileSync(join(outside, 'p.png'), 'png');
  const dir = pack(basePack(), { 'previews/plain-cv.png': null });
  if (!trySymlink(t, join(outside, 'p.png'), join(dir, 'previews/plain-cv.png'))) return;
  has(validatePack(dir), /previews\.cv.*outside the pack/);
});

test('a symlink that points outside the pack is rejected', (t) => {
  const outside = mkdtempSync(join(tmpdir(), 'tpl-out-'));
  dirs.push(outside);
  writeFileSync(join(outside, 'cv.html'), CV);
  const dir = pack(basePack(), { 'templates/cv-template.plain.html': null });
  if (!trySymlink(t, join(outside, 'cv.html'), join(dir, 'templates/cv-template.plain.html'))) return;
  has(validatePack(dir), /outside the pack/);
});

test('a template missing a required placeholder is reported', () => {
  has(validatePack(pack(basePack(), { 'templates/cv-template.plain.html': '<h1>{{NAME}}</h1>' })), /missing placeholder.*EXPERIENCE/);
});

test('renderLint findings fail a pack', () => {
  const bad = CV.replace('<body>', '<body><script>x()</script><img src="https://example.com/a.png">');
  const problems = validatePack(pack(basePack(), { 'templates/cv-template.plain.html': bad }));
  has(problems, /script-element/);
  has(problems, /remote-subresource/);
});

test('atsLint findings fail a pack that claims ats true', () => {
  const nested = '<html><body><h1>{{NAME}}</h1><table><tr><td><table><tr><td>{{EXPERIENCE}}{{EDUCATION}}</td></tr></table></td></tr></table></body></html>';
  has(validatePack(pack(basePack(), { 'templates/cv-template.plain.html': nested })), /nested-table/);
});

test('atsLint is not applied to a pack that does not claim ats', () => {
  const nested = '<html><body><h1>{{NAME}}</h1><table><tr><td><table><tr><td>{{EXPERIENCE}}{{EDUCATION}}</td></tr></table></td></tr></table></body></html>';
  const p = pack(
    basePack({ templates: [baseEntry({ ats: false, atsRisk: 'design-forward', atsRiskNote: 'nested layout', kind: 'cv', files: { cv: 'templates/cv-template.plain.html' }, previews: { cv: 'previews/plain-cv.png' } })] }),
    { 'templates/cv-template.plain.html': nested },
  );
  assert.deepEqual(validatePack(p), []);
});

test('the CLI exits 0 on a valid pack and 1 with problems on a bad one', () => {
  const ok = spawnSync('node', ['validate-template-pack.mjs', pack()], { cwd: ROOT, encoding: 'utf-8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /template pack is valid/);
  const bad = spawnSync('node', ['validate-template-pack.mjs', pack(basePack({ packVersion: 9 }))], { cwd: ROOT, encoding: 'utf-8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /packVersion/);
});

test('the CLI escapes control characters in a printed problem', () => {
  const m = basePack({ templates: [baseEntry({ files: { cv: 'templates/a\nb\u001b[31m.html', cover: 'templates/cover-letter-template.plain.html' } })] });
  const r = spawnSync('node', ['validate-template-pack.mjs', pack(m)], { cwd: ROOT, encoding: 'utf-8' });
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stderr, /[\u001b\u007f]/);
  for (const line of r.stderr.trimEnd().split('\n')) assert.match(line, /^✗ /, `unprefixed line: ${line}`);
  assert.match(r.stderr, /a\\x0ab\\x1b\[31m/);
});

test('the CLI exits 2 with usage when given no directory', () => {
  const r = spawnSync('node', ['validate-template-pack.mjs'], { cwd: ROOT, encoding: 'utf-8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage: node validate-template-pack\.mjs/);
});

test('--help prints usage and does not validate', () => {
  const r = spawnSync('node', ['validate-template-pack.mjs', '--help'], { cwd: ROOT, encoding: 'utf-8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: node validate-template-pack\.mjs/);
  assert.doesNotMatch(r.stdout, /✓/);
});
