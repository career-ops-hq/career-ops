import { test } from 'node:test';
import assert from 'node:assert/strict';

import { capabilityCard } from '../plugins.mjs';

const manifest = {
  id: 'commute',
  description: 'Drive time through a local router.',
  hooks: ['ingest'],
  requiredEnv: [],
  allowedHosts: ['nominatim.openstreetmap.org', 'localhost'],
  allowsLocalhost: true,
  skill: 'skill.md',
};

test('capability card does not list an allowed loopback host twice', () => {
  const card = capabilityCard(manifest, 'approved');
  assert.match(card, /Network:\s+nominatim\.openstreetmap\.org, localhost/);
  assert.doesNotMatch(card, /localhost\s+\+ localhost/);
});

test('capability card retains the localhost capability when not explicit in allowedHosts', () => {
  const card = capabilityCard({ ...manifest, allowedHosts: ['api.example.com'] }, 'approved');
  assert.match(card, /Network:\s+api\.example\.com\s+\+ localhost/);
});
