// Named templates in the data root (#5777): data/templates/ under the data root is
// the user layer, searched alongside the checkout's templates/. A name found in
// both resolves to the user's file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_USER_TEMPLATES_DIR,
  listTemplates,
  resolveTemplate,
} from '../cv-templates.mjs';

const CV = '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}';

function layers() {
  const root = mkdtempSync(join(tmpdir(), 'cvt-data-'));
  const system = join(root, 'system');
  const user = join(root, 'user');
  mkdirSync(system);
  mkdirSync(user);
  writeFileSync(join(system, 'cv-template.html'), CV);
  writeFileSync(join(system, 'cv-template.modern.html'), CV);
  return { system, user };
}

test('the default user directory is data/templates under the data root', () => {
  const prior = process.env.CAREER_OPS_ROOT;
  // An absolute path on this platform: a bare '/tmp/...' gains a drive letter on Windows.
  const root = join(tmpdir(), 'some-data-root');
  process.env.CAREER_OPS_ROOT = root;
  try {
    assert.equal(DEFAULT_USER_TEMPLATES_DIR(), join(root, 'data', 'templates'));
  } finally {
    if (prior === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prior;
  }
});

test('a template only in the user directory is listed and resolves, tagged as the user layer', () => {
  const { system, user } = layers();
  writeFileSync(join(user, 'cv-template.mine.html'), CV);

  const listed = listTemplates('cv', { dir: system, userDir: user });

  assert.deepEqual(listed.map((t) => t.name), ['mine', 'modern', 'standard']);
  assert.deepEqual(listed.map((t) => t.layer), ['user', 'system', 'system']);
  assert.equal(resolveTemplate('cv', 'mine', { dir: system, userDir: user }), join(user, 'cv-template.mine.html'));
});

test('on a name clash the user file wins and nothing throws', () => {
  const { system, user } = layers();
  writeFileSync(join(user, 'cv-template.modern.html'), `<!-- career-ops-template\nname: My Modern\n-->\n${CV}`);

  const listed = listTemplates('cv', { dir: system, userDir: user });

  const modern = listed.filter((t) => t.name === 'modern');
  assert.equal(modern.length, 1);
  assert.equal(modern[0].layer, 'user');
  assert.equal(modern[0].displayName, 'My Modern');
  assert.equal(resolveTemplate('cv', 'modern', { dir: system, userDir: user }), join(user, 'cv-template.modern.html'));
});

test('a name claimed twice inside the user directory still throws', () => {
  const { system, user } = layers();
  writeFileSync(join(user, 'cv-template.dup.html'), CV);
  mkdirSync(join(user, 'pack'));
  writeFileSync(join(user, 'pack', 'cv-template.dup.html'), CV);

  assert.throws(() => listTemplates('cv', { dir: system, userDir: user }), /claimed by two files/);
});

test('a missing user directory is not an error', () => {
  const { system } = layers();

  const listed = listTemplates('cv', { dir: system, userDir: join(system, 'nope') });

  assert.deepEqual(listed.map((t) => t.name), ['modern', 'standard']);
});

test('naming only dir keeps the old behaviour: no user layer is read', () => {
  const { system } = layers();
  const prior = process.env.CAREER_OPS_ROOT;
  const data = mkdtempSync(join(tmpdir(), 'cvt-env-'));
  mkdirSync(join(data, 'data', 'templates'), { recursive: true });
  writeFileSync(join(data, 'data', 'templates', 'cv-template.leak.html'), CV);
  process.env.CAREER_OPS_ROOT = data;
  try {
    assert.ok(!listTemplates('cv', { dir: system }).some((t) => t.name === 'leak'));
  } finally {
    if (prior === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prior;
  }
});

test('with no dir given, the data root user directory is searched', () => {
  const data = mkdtempSync(join(tmpdir(), 'cvt-env-'));
  mkdirSync(join(data, 'data', 'templates'), { recursive: true });
  writeFileSync(join(data, 'data', 'templates', 'cv-template.fromdata.html'), CV);
  const prior = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = data;
  try {
    assert.ok(listTemplates('cv').some((t) => t.name === 'fromdata' && t.layer === 'user'));
  } finally {
    if (prior === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prior;
  }
});

test('a user template that is missing required placeholders fails to resolve, naming the file', () => {
  const { system, user } = layers();
  writeFileSync(join(user, 'cv-template.broken.html'), '{{NAME}}');

  assert.throws(() => resolveTemplate('cv', 'broken', { dir: system, userDir: user }), /cv-template\.broken\.html.*missing required placeholders/);
});
