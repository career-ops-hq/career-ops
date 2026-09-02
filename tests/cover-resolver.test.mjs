import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { resolveCoverTemplatePath } from '../generate-cover-letter.mjs';

function coverFixture(templateValue) {
  const dir = mkdtempSync(join(tmpdir(), 'cover-'));
  writeFileSync(join(dir, 'cover-letter-template.html'), '{{NAME}}{{ROLE_TITLE}}{{OPENING}}');
  writeFileSync(
    join(dir, 'cover-letter-template.formal.html'),
    '<!-- career-ops-template\nname: Formal\nversion: 1.0.0\n-->\n{{NAME}}{{ROLE_TITLE}}{{OPENING}}'
  );
  const profile = join(dir, 'profile.yml');
  writeFileSync(
    profile,
    templateValue == null ? 'cover_letter: {}\n' : `cover_letter:\n  template: ${templateValue}\n`
  );
  return { dir, profile };
}

test('resolveCoverTemplatePath: honors the cover_letter.template profile default', () => {
  const { dir, profile } = coverFixture('formal');
  const p = resolveCoverTemplatePath({}, { dir, profilePath: profile });
  assert.equal(basename(p), 'cover-letter-template.formal.html');
});

test('resolveCoverTemplatePath: explicit payload.template wins, kebab-normalized', () => {
  const { dir, profile } = coverFixture(null);
  const p = resolveCoverTemplatePath({ template: 'Formal' }, { dir, profilePath: profile });
  assert.equal(basename(p), 'cover-letter-template.formal.html');
});

test('resolveCoverTemplatePath: base template when nothing configured (backward-compatible)', () => {
  const { dir, profile } = coverFixture(null);
  const p = resolveCoverTemplatePath({}, { dir, profilePath: profile });
  assert.equal(basename(p), 'cover-letter-template.html');
});

test('resolveCoverTemplatePath: falls back to base when the configured template is missing', () => {
  const { dir, profile } = coverFixture('nonexistent');
  const p = resolveCoverTemplatePath({}, { dir, profilePath: profile });
  assert.equal(basename(p), 'cover-letter-template.html');
});
