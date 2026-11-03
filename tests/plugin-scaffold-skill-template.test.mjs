// tests/plugin-scaffold-skill-template.test.mjs — the plugin template must not
// look like a real skill to skill catalogs, and `plugins.mjs new` must still
// give the scaffolded plugin the skill.md its manifest points at.
//
// Skill catalogs index any skill.md/SKILL.md with a frontmatter `name:`, so a
// plugins/_template/skill.md was listed as an installable skill named
// career-ops-plugin-{{NAME}}. The template now ships skill.md.template and
// scaffoldNew renames it on copy.
//
// HERMETIC: scaffolds into a temp root that holds only a copy of the template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldNew } from '../plugin-install.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATE = join(ROOT, 'plugins', '_template');

test('the plugin template ships no file a skill catalog would index', () => {
  const indexable = readdirSync(TEMPLATE).filter((f) => /^skill\.md$/i.test(f));
  assert.deepEqual(indexable, [], `plugins/_template has ${indexable.join(', ')}: catalogs list it as a skill`);
  assert.ok(existsSync(join(TEMPLATE, 'skill.md.template')), 'plugins/_template/skill.md.template is missing');
});

test('scaffoldNew turns skill.md.template into the skill.md the manifest names', () => {
  const root = mkdtempSync(join(tmpdir(), 'co-scaffold-'));
  try {
    cpSync(TEMPLATE, join(root, 'plugins', '_template'), { recursive: true });
    const dest = scaffoldNew(root, 'my-plugin');
    const manifest = JSON.parse(readFileSync(join(dest, 'manifest.json'), 'utf8'));
    assert.equal(manifest.skill, 'skill.md');
    assert.ok(existsSync(join(dest, 'skill.md')), 'scaffolded plugin has no skill.md');
    assert.ok(!existsSync(join(dest, 'skill.md.template')), 'scaffolded plugin kept skill.md.template');
    const skill = readFileSync(join(dest, 'skill.md'), 'utf8');
    assert.match(skill, /^name: career-ops-plugin-my-plugin$/m);
    assert.doesNotMatch(skill, /\{\{NAME\}\}/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
