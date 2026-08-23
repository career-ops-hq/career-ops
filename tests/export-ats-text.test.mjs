import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { formatAtsText, sanitizeAtsText, loadProfile } from '../scripts/export-ats-text.mjs';

test('importing export-ats-text.mjs does not parse process.argv or throw on unknown flags', () => {
  assert.equal(typeof formatAtsText, 'function');
  assert.equal(typeof sanitizeAtsText, 'function');
  assert.equal(typeof loadProfile, 'function');
});

test('sanitizeAtsText cleans bullets, dashes, smart quotes, and emojis', () => {
  const dirty = '• Bullet item – with en-dash & em-dash — “smart quotes” & ‘single’ \u00A0 and emoji 🚀';
  const clean = sanitizeAtsText(dirty);
  assert.equal(clean, '- Bullet item - with en-dash & em-dash - "smart quotes" & \'single\'   and emoji');
});

test('formatAtsText formats full profile object', () => {
  const profile = {
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '+1-555-0199',
    summary: 'Experienced ML Engineer.',
    skills: ['Python', 'TensorFlow', 'System Architecture'],
    experience: [
      { role: 'Staff Engineer', company: 'AI Corp', duration: '2023-Present', bullets: ['• Built latency pipeline', '– Reduced memory footprint'] },
    ],
    education: [
      { degree: 'B.S. Computer Science', institution: 'Tech University', year: '2020' },
    ],
  };

  const text = formatAtsText(profile);
  assert.match(text, /--- PERSONAL INFORMATION ---/);
  assert.match(text, /Name: Jane Doe/);
  assert.match(text, /--- SUMMARY ---/);
  assert.match(text, /Experienced ML Engineer\./);
  assert.match(text, /--- KEY SKILLS ---/);
  assert.match(text, /Python, TensorFlow, System Architecture/);
  assert.match(text, /--- EXPERIENCE ---/);
  assert.match(text, /Staff Engineer at AI Corp \(2023-Present\)/);
  assert.match(text, /- Built latency pipeline/);
  assert.match(text, /- Reduced memory footprint/);
  assert.match(text, /--- EDUCATION ---/);
  assert.match(text, /B\.S\. Computer Science - Tech University \(2020\)/);
});

test('formatAtsText supports section filtering', () => {
  const profile = {
    name: 'Jane Doe',
    summary: 'Experienced ML Engineer.',
    skills: ['Python', 'Go'],
  };

  const summaryOnly = formatAtsText(profile, { section: 'summary' });
  assert.equal(summaryOnly, '--- SUMMARY ---\nExperienced ML Engineer.');

  const skillsOnly = formatAtsText(profile, { section: 'skills' });
  assert.equal(skillsOnly, '--- KEY SKILLS ---\nPython, Go');
});

test('loadProfile falls back cleanly to profile.example.yml when profile.yml is absent', () => {
  const profile = loadProfile();
  assert.ok(profile);
  assert.ok(profile.name);
});
