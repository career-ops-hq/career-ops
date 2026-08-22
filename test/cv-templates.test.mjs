import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
  prettify,
  kebab,
  KINDS,
  listTemplates,
  parseMeta,
  validateTemplate,
  resolveTemplate,
  loadProfileDefault,
} from '../cv-templates.mjs';

test('prettify: kebab to Title Case', () => {
  assert.equal(prettify('executive-authority'), 'Executive Authority');
  assert.equal(prettify('standard'), 'Standard');
});

test('kebab: display name to kebab', () => {
  assert.equal(kebab('Executive Authority'), 'executive-authority');
  assert.equal(kebab('  Modern CV!  '), 'modern-cv');
});

test('KINDS defines cv and cover', () => {
  assert.ok(KINDS.cv && KINDS.cover);
  assert.equal(KINDS.cv.prefix, 'cv-template');
  assert.equal(KINDS.cover.prefix, 'cover-letter-template');
});

function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cvt-'));
  writeFileSync(join(dir, 'cv-template.html'), '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}');
  writeFileSync(
    join(dir, 'cv-template.executive-authority.html'),
    '<!-- career-ops-template\nname: Executive Authority\nversion: 1.0.0\n-->\n{{NAME}}{{EXPERIENCE}}{{EDUCATION}}'
  );
  writeFileSync(join(dir, 'cv-template.tex'), '{{NAME}}');
  writeFileSync(join(dir, 'cover-letter-template.html'), '{{NAME}}{{ROLE_TITLE}}{{OPENING}}');
  writeFileSync(
    join(dir, 'cover-letter-template.formal.html'),
    '<!-- career-ops-template\nname: Formal\nversion: 1.0.0\n-->\n{{NAME}}{{ROLE_TITLE}}{{OPENING}}'
  );
  writeFileSync(join(dir, 'unrelated.html'), 'nope');
  return dir;
}

test('listTemplates: finds base (standard) + named html only', () => {
  const dir = fixtureDir();
  const cvs = listTemplates('cv', { dir });
  const names = cvs.map((t) => t.name).sort();
  assert.deepEqual(names, ['executive-authority', 'standard']);
});

test('listTemplates: displayName prefers meta name, else prettified filename', () => {
  const dir = fixtureDir();
  const cvs = listTemplates('cv', { dir });
  assert.equal(cvs.find((t) => t.name === 'executive-authority').displayName, 'Executive Authority');
  assert.equal(cvs.find((t) => t.name === 'standard').displayName, 'Standard');
});

test('listTemplates: format filter (tex) is separate from html', () => {
  const dir = fixtureDir();
  const tex = listTemplates('cv', { dir, format: 'tex' });
  assert.deepEqual(tex.map((t) => t.name), ['standard']);
});

test('listTemplates: returns [] when the templates dir is absent', () => {
  const dir = join(tmpdir(), 'cvt-does-not-exist-38f2a1');
  assert.deepEqual(listTemplates('cv', { dir }), []);
});

test('listTemplates: cover kind uses the cover-letter-template prefix', () => {
  const dir = fixtureDir();
  const covers = listTemplates('cover', { dir });
  const names = covers.map((t) => t.name).sort();
  assert.deepEqual(names, ['formal', 'standard']);
});

test('parseMeta: reads header key/value, empty when absent', () => {
  const dir = fixtureDir();
  assert.equal(parseMeta(join(dir, 'cv-template.executive-authority.html')).name, 'Executive Authority');
  assert.deepEqual(parseMeta(join(dir, 'cv-template.html')), {});
});

test('validateTemplate: ok when required placeholders present', () => {
  const dir = fixtureDir();
  const r = validateTemplate(join(dir, 'cv-template.html'), 'cv');
  assert.deepEqual(r, { ok: true, missing: [] });
});

test('validateTemplate: reports missing placeholders', () => {
  const dir = fixtureDir();
  writeFileSync(join(dir, 'cv-template.broken.html'), '{{NAME}} only');
  const r = validateTemplate(join(dir, 'cv-template.broken.html'), 'cv');
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.sort(), ['EDUCATION', 'EXPERIENCE']);
});

test('validateTemplate: cover ok when cover placeholders present', () => {
  const dir = fixtureDir();
  const r = validateTemplate(join(dir, 'cover-letter-template.html'), 'cover');
  assert.deepEqual(r, { ok: true, missing: [] });
});

test('validateTemplate: cover reports missing cover placeholders', () => {
  const dir = fixtureDir();
  writeFileSync(join(dir, 'cover-letter-template.broken.html'), '{{NAME}} only');
  const r = validateTemplate(join(dir, 'cover-letter-template.broken.html'), 'cover');
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.sort(), ['OPENING', 'ROLE_TITLE']);
});

function fixtureWithProfile(templateValue) {
  const dir = fixtureDir();
  const profile = join(dir, 'profile.yml');
  writeFileSync(profile, templateValue == null ? 'cv: {}\n' : `cv:\n  template: ${templateValue}\n`);
  return { dir, profile };
}

test('resolveTemplate: explicit name wins, kebab-normalized', () => {
  const { dir, profile } = fixtureWithProfile(null);
  const p = resolveTemplate('cv', 'Executive Authority', { dir, profilePath: profile });
  assert.ok(p.endsWith('cv-template.executive-authority.html'));
});

test('resolveTemplate: falls back to profile default when no name', () => {
  const { dir, profile } = fixtureWithProfile('executive-authority');
  const p = resolveTemplate('cv', undefined, { dir, profilePath: profile });
  assert.ok(p.endsWith('cv-template.executive-authority.html'));
});

test('resolveTemplate: profile default is kebab-normalized (parity with explicit name)', () => {
  const { dir, profile } = fixtureWithProfile('Executive Authority');
  const p = resolveTemplate('cv', undefined, { dir, profilePath: profile });
  assert.ok(p.endsWith('cv-template.executive-authority.html'));
});

test('resolveTemplate: base standard when nothing set (backward-compatible)', () => {
  const { dir, profile } = fixtureWithProfile(null);
  const p = resolveTemplate('cv', undefined, { dir, profilePath: profile });
  assert.ok(p.endsWith('cv-template.html'));
});

test('resolveTemplate: missing named template throws (fail loud)', () => {
  const { dir, profile } = fixtureWithProfile(null);
  assert.throws(() => resolveTemplate('cv', 'nope', { dir, profilePath: profile }), /not found/);
});

test('resolveTemplate: fallback=true drops missing name to standard', () => {
  const { dir, profile } = fixtureWithProfile(null);
  const p = resolveTemplate('cv', 'nope', { dir, profilePath: profile, format: 'tex', fallback: true });
  assert.ok(p.endsWith('cv-template.tex'));
});

test('resolveTemplate: rejects a path-traversal format (allowlist guard)', () => {
  const { dir, profile } = fixtureWithProfile(null);
  assert.throws(
    () => resolveTemplate('cv', undefined, { dir, profilePath: profile, format: '../../../../etc/passwd' }),
    /Unsupported template format/
  );
});

test('listTemplates: rejects a path-traversal format (allowlist guard)', () => {
  const dir = fixtureDir();
  assert.throws(() => listTemplates('cv', { dir, format: '../../etc' }), /Unsupported template format/);
});

test('resolveTemplate: html validation failure throws', () => {
  const { dir, profile } = fixtureWithProfile(null);
  writeFileSync(join(dir, 'cv-template.broken.html'), '{{NAME}} only');
  assert.throws(() => resolveTemplate('cv', 'broken', { dir, profilePath: profile }), /missing required placeholders/);
});

test('resolveTemplate: cover explicit name selects the named cover template', () => {
  const { dir, profile } = fixtureWithProfile(null);
  const p = resolveTemplate('cover', 'Formal', { dir, profilePath: profile });
  assert.ok(p.endsWith('cover-letter-template.formal.html'));
});

test('resolveTemplate: cover base standard when nothing set', () => {
  const { dir, profile } = fixtureWithProfile(null);
  const p = resolveTemplate('cover', undefined, { dir, profilePath: profile });
  assert.ok(p.endsWith('cover-letter-template.html'));
});

test('loadProfileDefault: reads nested key, null when unset/missing', () => {
  const { dir, profile } = fixtureWithProfile('executive-authority');
  assert.equal(loadProfileDefault('cv', { profilePath: profile }), 'executive-authority');
  assert.equal(loadProfileDefault('cv', { profilePath: join(dir, 'nope.yml') }), null);
});

// ── Template Pack Discovery Tests ──

function fixtureDirWithPack() {
  const dir = mkdtempSync(join(tmpdir(), 'cvt-pack-'));
  // Root templates
  writeFileSync(join(dir, 'cv-template.html'), '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}');
  writeFileSync(
    join(dir, 'cv-template.compact.html'),
    '<!-- career-ops-template\nname: Compact\n-->\n{{NAME}}{{EXPERIENCE}}{{EDUCATION}}'
  );
  writeFileSync(join(dir, 'cv-template.tex'), '{{NAME}}');
  // Pack directory: templates/ats/
  const atsDir = join(dir, 'ats');
  mkdirSync(atsDir, { recursive: true });
  writeFileSync(
    join(atsDir, 'cv-template.ats.html'),
    '<!-- career-ops-template\nname: ATS Friendly\n-->\n{{NAME}}{{EXPERIENCE}}{{EDUCATION}}'
  );
  // Shared sections/ directory (should NOT be scanned as a template)
  const sectionsDir = join(dir, 'sections');
  mkdirSync(sectionsDir, { recursive: true });
  writeFileSync(join(sectionsDir, 'cv-template.not-a-template.html'), '{{NAME}}');
  // Deeper nested directory (should NOT be scanned)
  const deepDir = join(dir, 'ats', 'deep');
  mkdirSync(deepDir, { recursive: true });
  writeFileSync(join(deepDir, 'cv-template.deep.html'), '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}');
  // Another pack at same level
  const modernDir = join(dir, 'modern');
  mkdirSync(modernDir, { recursive: true });
  writeFileSync(join(modernDir, 'cv-template.modern.html'), '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}');
  return dir;
}

function hasPackedPath(path, packName) {
  // Cross-platform check: path contains packName + path separator + cv-template.packName.html
  return path.includes(`${packName}${sep}cv-template.${packName}.html`);
}

test('listTemplates: existing flat templates remain discoverable', () => {
  const dir = fixtureDirWithPack();
  const cvs = listTemplates('cv', { dir });
  const names = cvs.map((t) => t.name).sort();
  assert.deepEqual(names, ['ats', 'compact', 'modern', 'standard']);
});

test('listTemplates: one-level pack cv-template.ats.html discovered as "ats"', () => {
  const dir = fixtureDirWithPack();
  const cvs = listTemplates('cv', { dir });
  const ats = cvs.find((t) => t.name === 'ats');
  assert.ok(ats, 'ats template should be discovered');
  assert.equal(ats.displayName, 'ATS Friendly');
  assert.ok(hasPackedPath(ats.path, 'ats'), `path should point to packed template, got ${ats.path}`);
});

test('listTemplates: returned path points to the packed template', () => {
  const dir = fixtureDirWithPack();
  const cvs = listTemplates('cv', { dir });
  const ats = cvs.find((t) => t.name === 'ats');
  assert.ok(hasPackedPath(ats.path, 'ats'));
});

test('listTemplates: sections/ is not treated as a template', () => {
  const dir = fixtureDirWithPack();
  const cvs = listTemplates('cv', { dir });
  const names = cvs.map((t) => t.name);
  assert.equal(names.includes('not-a-template'), false);
});

test('listTemplates: deeper nested directories are not discovered', () => {
  const dir = fixtureDirWithPack();
  const cvs = listTemplates('cv', { dir });
  const names = cvs.map((t) => t.name);
  assert.equal(names.includes('deep'), false);
});

test('resolveTemplate: resolves packed template by name', () => {
  const dir = fixtureDirWithPack();
  const profile = join(dir, 'profile.yml');
  writeFileSync(profile, 'cv: {}\n');
  const p = resolveTemplate('cv', 'ats', { dir, profilePath: profile });
  assert.ok(hasPackedPath(p, 'ats'), `expected packed path, got ${p}`);
});

test('resolveTemplate: explicit name prefers discovered packed template', () => {
  const dir = fixtureDirWithPack();
  const profile = join(dir, 'profile.yml');
  writeFileSync(profile, 'cv: {}\n');
  const p = resolveTemplate('cv', 'ats', { dir, profilePath: profile });
  assert.ok(hasPackedPath(p, 'ats'));
});

test('resolveTemplate: existing flat template resolution unchanged', () => {
  const dir = fixtureDirWithPack();
  const profile = join(dir, 'profile.yml');
  writeFileSync(profile, 'cv: {}\n');
  const p = resolveTemplate('cv', 'compact', { dir, profilePath: profile });
  assert.ok(p.endsWith('cv-template.compact.html'));
});

test('resolveTemplate: root template preferred over same-name pack (collision)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cvt-collision-'));
  writeFileSync(join(dir, 'cv-template.html'), '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}');
  writeFileSync(join(dir, 'cv-template.collision.html'), '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}');
  const packDir = join(dir, 'pack');
  mkdirSync(packDir, { recursive: true });
  writeFileSync(join(packDir, 'cv-template.collision.html'), '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}');
  const profile = join(dir, 'profile.yml');
  writeFileSync(profile, 'cv: {}\n');
  // Root template should win
  const p = resolveTemplate('cv', 'collision', { dir, profilePath: profile });
  assert.ok(p.endsWith('cv-template.collision.html'), `root should win, got ${p}`);
  // But listTemplates should only return one 'collision' entry (root)
  const cvs = listTemplates('cv', { dir });
  const collisions = cvs.filter((t) => t.name === 'collision');
  assert.equal(collisions.length, 1);
  assert.ok(collisions[0].path.endsWith('cv-template.collision.html'));
});

test('resolveTemplate: profile default resolves packed template', () => {
  const dir = fixtureDirWithPack();
  const profile = join(dir, 'profile.yml');
  writeFileSync(profile, 'cv:\n  template: ats\n');
  const p = resolveTemplate('cv', undefined, { dir, profilePath: profile });
  assert.ok(hasPackedPath(p, 'ats'));
});

test('resolveTemplate: fallback still works for undiscovered names', () => {
  const dir = fixtureDirWithPack();
  const profile = join(dir, 'profile.yml');
  writeFileSync(profile, 'cv: {}\n');
  // 'nonexistent' not in discovered, fallback to standard
  const p = resolveTemplate('cv', 'nonexistent', { dir, profilePath: profile, fallback: true });
  assert.ok(p.endsWith('cv-template.html'));
});
