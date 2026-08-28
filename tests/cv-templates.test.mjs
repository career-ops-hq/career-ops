import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
