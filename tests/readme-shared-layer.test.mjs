// The English README project tree used to say modes/_shared.md was the file
// to customize. That file is a system file. A local edit is kept unless
// update-system.mjs apply --force. Personal archetypes belong in
// modes/_profile.md (docs/CUSTOMIZATION.md, DATA_CONTRACT.md).
//
// Run: node --test tests/readme-shared-layer.test.mjs

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

function projectTree() {
  const start = readme.indexOf('## Project Structure');
  assert.ok(start >= 0, 'README has a Project Structure section');
  const fence = readme.slice(start).match(/```\n([\s\S]*?)```/);
  assert.ok(fence, 'Project Structure contains a tree');
  return fence[1];
}

test('the README project tree sends customization to modes/_profile.md', () => {
  const tree = projectTree();
  const shared = tree.split('\n').find((line) => line.includes('_shared.md'));
  assert.ok(shared, 'project tree lists modes/_shared.md');
  assert.doesNotMatch(shared, /customize this/i);
  assert.match(shared, /system file/);
  assert.match(shared, /local edit kept unless apply --force/);
  assert.doesNotMatch(shared, /replaced on update/);

  const profile = tree.split('\n').find((line) => line.includes('_profile.md'));
  assert.ok(profile, 'project tree lists modes/_profile.md');
  assert.match(profile, /customize this/i);
});
