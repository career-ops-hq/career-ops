import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

// #6370: each of these used to return the base template silently, so the
// letter rendered without the candidate's chosen layout and nobody was told.
test('resolveCoverTemplatePath: a configured template that does not exist throws', () => {
  const { dir, profile } = coverFixture('nonexistent');
  assert.throws(
    () => resolveCoverTemplatePath({}, { dir, profilePath: profile }),
    /Template not found for kind=cover name=nonexistent/,
  );
});

test('resolveCoverTemplatePath: an explicit payload.template that does not exist throws', () => {
  const { dir, profile } = coverFixture(null);
  assert.throws(
    () => resolveCoverTemplatePath({ template: 'nope' }, { dir, profilePath: profile }),
    /Template not found for kind=cover name=nope/,
  );
});

test('resolveCoverTemplatePath: a malformed profile throws and names the file', () => {
  const { dir, profile } = coverFixture(null);
  writeFileSync(profile, 'cover_letter:\n  template: [unclosed\n');
  assert.throws(
    () => resolveCoverTemplatePath({}, { dir, profilePath: profile }),
    (err) => err.message.includes('Failed to parse profile YAML') && err.message.includes(profile),
  );
});

test('resolveCoverTemplatePath: a template missing required placeholders throws', () => {
  const { dir, profile } = coverFixture('broken');
  writeFileSync(
    join(dir, 'cover-letter-template.broken.html'),
    '<!-- career-ops-template\nname: Broken\nversion: 1.0.0\n-->\n{{NAME}}',
  );
  assert.throws(
    () => resolveCoverTemplatePath({}, { dir, profilePath: profile }),
    /missing required placeholders/,
  );
});

test('resolveCoverTemplatePath: a missing profile still resolves the base template', () => {
  const { dir } = coverFixture(null);
  const p = resolveCoverTemplatePath({}, { dir, profilePath: join(dir, 'absent.yml') });
  assert.equal(basename(p), 'cover-letter-template.html');
});

test('resolveCoverTemplatePath: fallback: true still resolves the base template for a missing name', () => {
  const { dir, profile } = coverFixture('nonexistent');
  const p = resolveCoverTemplatePath({}, { dir, profilePath: profile, fallback: true });
  assert.equal(basename(p), 'cover-letter-template.html');
});

// The fallback opt-in is narrow on purpose: it answers "that name does not
// exist", never "the profile or the template is broken" (CodeRabbit on #6383).
test('resolveCoverTemplatePath: fallback: true does not hide a malformed profile', () => {
  const { dir, profile } = coverFixture(null);
  writeFileSync(profile, 'cover_letter:\n  template: [unclosed\n');
  assert.throws(
    () => resolveCoverTemplatePath({}, { dir, profilePath: profile, fallback: true }),
    /Failed to parse profile YAML/,
  );
});

test('resolveCoverTemplatePath: fallback: true does not hide an invalid template', () => {
  const { dir, profile } = coverFixture('broken');
  writeFileSync(
    join(dir, 'cover-letter-template.broken.html'),
    '<!-- career-ops-template\nname: Broken\nversion: 1.0.0\n-->\n{{NAME}}',
  );
  assert.throws(
    () => resolveCoverTemplatePath({}, { dir, profilePath: profile, fallback: true }),
    /missing required placeholders/,
  );
});

test('resolveCoverTemplatePath: a malformed profile is reported even with an explicit payload.template', () => {
  const { dir, profile } = coverFixture(null);
  writeFileSync(profile, 'cover_letter:\n  template: [unclosed\n');
  assert.throws(
    () => resolveCoverTemplatePath({ template: 'Formal' }, { dir, profilePath: profile }),
    /Failed to parse profile YAML/,
  );
});

// CodeRabbit on #6383: existsSync() answers false for a profile that exists but
// cannot be read, so strict resolution must not treat "unreadable" as "absent".
test('resolveCoverTemplatePath: a profile path that cannot be read as a file throws', () => {
  const { dir } = coverFixture(null);
  const profileDir = join(dir, 'profile-is-a-dir.yml');
  mkdirSync(profileDir);
  assert.throws(
    () => resolveCoverTemplatePath({}, { dir, profilePath: profileDir }),
    (err) => err.message.includes('Failed to read profile') && err.message.includes(profileDir),
  );
});

const canDropPermissions = process.platform !== 'win32' && process.getuid?.() !== 0;
test('resolveCoverTemplatePath: a profile in an unsearchable directory throws, not falls back', { skip: !canDropPermissions && 'needs a non-root POSIX user' }, () => {
  const { dir } = coverFixture(null);
  const locked = join(dir, 'locked');
  mkdirSync(locked);
  const profile = join(locked, 'profile.yml');
  writeFileSync(profile, 'cover_letter:\n  template: formal\n');
  chmodSync(locked, 0o000);
  try {
    assert.throws(
      () => resolveCoverTemplatePath({}, { dir, profilePath: profile }),
      /Failed to read profile/,
    );
  } finally {
    chmodSync(locked, 0o700);
  }
});
