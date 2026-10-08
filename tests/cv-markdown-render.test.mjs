import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const payload = {
  lang: 'en',
  page_format: 'a4',
  candidate: {
    name: 'Test Candidate', title: 'Senior Engineer', email: 'test@example.com',
    phone: '+1 234 567 8900', location: 'Remote',
    github: { url: 'https://github.com/test', display: 'github.com/test' },
  },
  sections: { experience: 'Experiencia' },
  summary: 'Builds things.',
  competencies: ['Testing', 'Design'],
  experience: [
    { company: 'Acme Corp', role: 'Senior Engineer', location: 'Remote', dates: '2021 – Present', bullets: ['Cut **R&D** cost <10%.', ''] },
  ],
  projects: [],
  education: [{ title: 'BSc', org: 'Test University', year: '2015' }],
  certifications: [{ title: 'Cert A', org: 'Body', year: '2020' }],
  awards: [],
  interests: ['Chess', 'Hiking'],
  skills: [{ category: 'Tools', items: ['Node.js', 'SQL'] }],
};

function run(input) {
  const dir = mkdtempSync(join(tmpdir(), 'cv-md-'));
  const inPath = join(dir, 'in.json');
  const outPath = join(dir, 'nested', 'out.md');
  writeFileSync(inPath, JSON.stringify(input));
  const r = spawnSync(process.execPath, ['build-cv-html.mjs', inPath, '--markdown', outPath], { cwd: ROOT, encoding: 'utf8' });
  return { r, outPath };
}

test('--markdown renders the payload with resolved titles in builder order', () => {
  const { r, outPath } = run(payload);
  assert.equal(r.status, 0, r.stderr);
  const md = readFileSync(outPath, 'utf8');
  assert.match(md, /^# Test Candidate\n\nSenior Engineer\n\n\+1 234 567 8900 \| test@example\.com \| github\.com\/test \| Remote\n/);
  assert.deepEqual(md.match(/^## .+$/gm), [
    '## Professional Summary', '## Core Competencies', '## Experiencia',
    '## Education', '## Certifications', '## Interests', '## Skills',
  ]);
  assert.match(md, /### Acme Corp — Senior Engineer\n\n\*Remote · 2021 – Present\*\n\n- Cut \*\*R&D\*\* cost <10%\.\n/);
  assert.match(md, /\*\*BSc — Test University\*\* · 2015/);
  assert.match(md, /- \*\*Cert A\*\* — Body · 2020/);
  assert.match(md, /Chess, hiking/);
  assert.match(md, /- \*\*Tools:\*\* Node\.js, SQL\n$/);
});

test('--markdown rejects an invalid payload and writes nothing', () => {
  const { r, outPath } = run({ ...payload, education: [{ institution: 'X', degree: 'Y' }] });
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(outPath), false);
});

test('--markdown without an output path fails with usage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cv-md-'));
  const inPath = join(dir, 'in.json');
  writeFileSync(inPath, JSON.stringify(payload));
  const r = spawnSync(process.execPath, ['build-cv-html.mjs', inPath, '--markdown'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--markdown <output\.md>/);
});
