/** Check profile selection, validation and frozen batch search terms. */
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { profileTargetKeywords, resolveProfileKeywords, providerKeywords } from '../../adapters/node/providers/_profile-keywords.mjs';

assert.deepEqual(profileTargetKeywords({ target_roles: { search_keywords: ['AI', ' ai ', '智能体'] } }), ['ai', '智能体']);
for (const words of [undefined, [], '', ['AI', null], ['AI', ' ']]) {
  assert.throws(() => profileTargetKeywords({ target_roles: { search_keywords: words } }), /search_keywords/);
}
const directory = mkdtempSync(join(tmpdir(), 'career-keywords-'));
try {
  const file = join(directory, 'profile.yml');
  writeFileSync(file, 'target_roles:\n  search_keywords: [Engineer]\n');
  const frozen = resolveProfileKeywords(file);
  writeFileSync(file, 'target_roles:\n  search_keywords: [智能体]\n');
  assert.deepEqual(providerKeywords({ searchKeywords: frozen }), ['Engineer']);
  assert.deepEqual(resolveProfileKeywords(file), ['智能体']);
  assert.throws(() => providerKeywords({ searchKeywords: [] }), /search_keywords/);
} finally { rmSync(directory, { recursive: true, force: true }); }
console.log('Shared profile keywords passed');
