import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoleForDedup } from '../scan.mjs';

test('dotted country tags and workplace suffixes match the bare title', () => {
  const bare = normalizeRoleForDedup('Software Engineer');
  for (const title of [
    'Software Engineer (U.S.)',
    'Software Engineer (U.S.A.)',
    'Software Engineer (Hybrid)',
    'Software Engineer (WFH)',
    'Software Engineer (work from home)',
    'Software Engineer - Remote',
    'Software Engineer, Remote',
    'Software Engineer - On-site',
    'Software Engineer, Work-from-home',
  ]) {
    assert.equal(normalizeRoleForDedup(title), bare, title);
  }
});

test('a seniority or team tag stays in the key', () => {
  assert.notEqual(normalizeRoleForDedup('Software Engineer (Senior)'), normalizeRoleForDedup('Software Engineer'));
  assert.notEqual(normalizeRoleForDedup('Engineering Manager | Payments'), normalizeRoleForDedup('Engineering Manager'));
  assert.notEqual(normalizeRoleForDedup('Engineer - Platform'), normalizeRoleForDedup('Engineer'));
});

test('only the last workplace suffix is removed', () => {
  const platform = normalizeRoleForDedup('Engineer - Platform');
  assert.equal(normalizeRoleForDedup('Engineer - Platform - Remote'), platform);
  assert.equal(normalizeRoleForDedup('Engineer - Platform, Remote'), platform);
  assert.equal(normalizeRoleForDedup('Engineer - Platform — On-site'), platform);
  assert.notEqual(platform, normalizeRoleForDedup('Engineer'));
  assert.equal(normalizeRoleForDedup('Engineer - Remote - On-site'), normalizeRoleForDedup('Engineer'));
});
