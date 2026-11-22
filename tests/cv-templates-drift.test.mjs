// Advisory audit of the user's own templates (#5777, item 2): a template in
// data/templates/ that no longer resolves, or that lost a slot every shipped
// variant keeps, is reported. Nothing here ever blocks a render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditUserTemplates } from '../cv-templates.mjs';

const BASE = '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}{{SKILLS}}{{INTERESTS}}';

function layers({ variants = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cvt-drift-'));
  const system = join(root, 'system');
  const user = join(root, 'user');
  mkdirSync(system);
  mkdirSync(user);
  writeFileSync(join(system, 'cv-template.html'), BASE);
  if (variants) {
    // Both shipped variants drop {{INTERESTS}} on purpose, so it is optional.
    writeFileSync(join(system, 'cv-template.modern.html'), '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}{{SKILLS}}');
    writeFileSync(join(system, 'cv-template.compact.html'), '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}{{SKILLS}}');
  }
  writeFileSync(join(system, 'cover-letter-template.html'), '{{NAME}}{{ROLE_TITLE}}{{OPENING}}{{CLOSING_BLOCK}}');
  return { system, user };
}

const audit = (l) => auditUserTemplates({ dir: l.system, userDir: l.user });

test('a healthy user template reports nothing', () => {
  const l = layers();
  writeFileSync(join(l.user, 'cv-template.mine.html'), '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}{{SKILLS}}');

  assert.deepEqual(audit(l), []);
});

test('a user template missing a required placeholder is reported as invalid, naming the file', () => {
  const l = layers();
  writeFileSync(join(l.user, 'cv-template.broken.html'), '{{NAME}}{{SKILLS}}');

  const [finding] = audit(l);

  assert.equal(finding.kind, 'cv');
  assert.equal(finding.name, 'broken');
  assert.equal(finding.path, join(l.user, 'cv-template.broken.html'));
  assert.equal(finding.problems[0].type, 'invalid');
  assert.match(finding.problems[0].detail, /EXPERIENCE/);
});

test('a slot every shipped variant keeps, missing from a user template, is reported as drift', () => {
  const l = layers();
  writeFileSync(join(l.user, 'cv-template.old.html'), '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}');

  const [finding] = audit(l);

  assert.deepEqual(finding.problems, [{ type: 'drifted', missing: ['SKILLS'] }]);
});

test('a slot the shipped variants themselves drop is not drift', () => {
  const l = layers();
  writeFileSync(join(l.user, 'cv-template.lean.html'), '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}{{SKILLS}}');

  assert.deepEqual(audit(l), []);
});

test('with no shipped variant to compare against, drift is not judged', () => {
  const l = layers({ variants: false });
  writeFileSync(join(l.user, 'cv-template.thin.html'), '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}');

  assert.deepEqual(audit(l), []);
});

test('cover-letter templates are audited too', () => {
  const l = layers();
  writeFileSync(join(l.user, 'cover-letter-template.broken.html'), '{{NAME}}');

  const [finding] = audit(l);

  assert.equal(finding.kind, 'cover');
  assert.equal(finding.problems[0].type, 'invalid');
});

test('a missing user directory yields no findings', () => {
  const l = layers();

  assert.deepEqual(auditUserTemplates({ dir: l.system, userDir: join(l.user, 'nope') }), []);
});

test('a file whose name is not kebab-case is reported for its name, with the name to use', () => {
  const l = layers();
  writeFileSync(join(l.user, 'cv-template.a--b.html'), '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}{{SKILLS}}');

  const [finding] = audit(l);

  assert.equal(finding.name, 'a--b');
  assert.equal(finding.problems.length, 1);
  assert.equal(finding.problems[0].type, 'name');
  assert.match(finding.problems[0].detail, /cv-template\.a-b\.html/);
});
