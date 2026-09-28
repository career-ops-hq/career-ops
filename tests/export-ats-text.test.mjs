import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAtsText, sanitizeAtsText, parseCvMarkdown, normalizeProfile, loadProfile } from '../scripts/export-ats-text.mjs';

test('importing export-ats-text.mjs does not parse process.argv or throw on unknown flags', () => {
  assert.equal(typeof formatAtsText, 'function');
  assert.equal(typeof sanitizeAtsText, 'function');
  assert.equal(typeof parseCvMarkdown, 'function');
  assert.equal(typeof normalizeProfile, 'function');
  assert.equal(typeof loadProfile, 'function');
});

test('sanitizeAtsText cleans bullets, dashes, smart quotes, non-breaking spaces, and emojis', () => {
  const dirty = '• Bullet item – with en-dash & em-dash — “smart quotes” & ‘single’ \u00A0 and emoji 🚀';
  const clean = sanitizeAtsText(dirty);
  assert.equal(clean, '- Bullet item - with en-dash & em-dash - "smart quotes" & \'single\'   and emoji');
});

test('parseCvMarkdown extracts experience, education, skills, and contact info from markdown CV', () => {
  const cvMarkdown = `
# CV -- Alex Chen

**Location:** Austin, TX
**Email:** alex@example.com
**LinkedIn:** linkedin.com/in/alexchen

## Professional Summary

Full-stack AI engineer with 6 years building production ML systems.

## Work Experience

### TechFin Corp -- Austin, TX

**Senior ML Engineer / ML Platform Lead**
2020-2024

- Led ML platform team (3 engineers), built internal MLOps tooling
- Designed real-time fraud detection pipeline: 99.7% precision

## Education

- MS Computer Science, UT Austin (2018)
- BS Computer Science, UC Berkeley (2016)

## Skills

- **ML/AI:** PyTorch, TensorFlow, LangChain
- **Languages:** Python, Go, TypeScript
`;

  const parsed = parseCvMarkdown(cvMarkdown);
  assert.equal(parsed.name, 'Alex Chen');
  assert.equal(parsed.email, 'alex@example.com');
  assert.equal(parsed.location, 'Austin, TX');
  assert.equal(parsed.linkedin, 'linkedin.com/in/alexchen');
  assert.match(parsed.summary, /Full-stack AI engineer/);
  assert.equal(parsed.experience.length, 1);
  assert.equal(parsed.experience[0].company, 'TechFin Corp -- Austin, TX');
  assert.equal(parsed.experience[0].role, 'Senior ML Engineer / ML Platform Lead');
  assert.equal(parsed.experience[0].duration, '2020-2024');
  assert.equal(parsed.experience[0].bullets.length, 2);
  assert.equal(parsed.education.length, 2);
  assert.equal(parsed.education[0].degree, 'MS Computer Science');
  assert.equal(parsed.education[0].institution, 'UT Austin');
  assert.equal(parsed.education[0].year, '2018');
  assert.deepEqual(parsed.skills, ['PyTorch', 'TensorFlow', 'LangChain', 'Python', 'Go', 'TypeScript']);
});

test('normalizeProfile merges profile.yml and cv.md data correctly', () => {
  const profileRaw = {
    candidate: {
      full_name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+1-555-0199',
      location: 'San Francisco, CA',
      linkedin: 'linkedin.com/in/janedoe',
    },
    narrative: {
      headline: 'Senior AI Engineer',
      exit_story: 'Built autonomous pipelines.',
      superpowers: ['End-to-end ML', 'Fast prototyping'],
    },
  };

  const cvData = {
    experience: [
      {
        company: 'AI Systems Inc',
        role: 'Lead Engineer',
        duration: '2022-Present',
        bullets: ['Deployed agent loops', 'Reduced latency by 40%'],
      },
    ],
    education: [
      { degree: 'B.S. Computer Science', institution: 'Tech University', year: '2020' },
    ],
  };

  const normalized = normalizeProfile(profileRaw, cvData);
  assert.equal(normalized.name, 'Jane Doe');
  assert.equal(normalized.email, 'jane@example.com');
  assert.equal(normalized.phone, '+1-555-0199');
  assert.equal(normalized.location, 'San Francisco, CA');
  assert.equal(normalized.linkedin, 'linkedin.com/in/janedoe');
  assert.equal(normalized.summary, 'Senior AI Engineer. Built autonomous pipelines.');
  assert.deepEqual(normalized.skills, ['End-to-end ML', 'Fast prototyping']);
  assert.equal(normalized.experience.length, 1);
  assert.equal(normalized.experience[0].company, 'AI Systems Inc');
  assert.equal(normalized.education.length, 1);
  assert.equal(normalized.education[0].institution, 'Tech University');
});

test('formatAtsText formats full profile and CV data into clean ATS text', () => {
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

test('formatAtsText safely handles non-object or null entries in experience and education', () => {
  const profile = {
    name: 'Test Candidate',
    experience: [null, undefined, 'invalid entry', { role: 'Engineer', company: 'Corp' }],
    education: [null, undefined, 42, { degree: 'B.S.', institution: 'College', year: '2021' }],
  };

  const text = formatAtsText(profile);
  assert.match(text, /Engineer at Corp/);
  assert.match(text, /B\.S\. - College \(2021\)/);
});

test('formatAtsText supports section filtering', () => {
  const profile = {
    name: 'Jane Doe',
    summary: 'Experienced ML Engineer.',
    skills: ['Python', 'Go'],
    experience: [{ role: 'Developer', company: 'Dev Co', bullets: ['Wrote code'] }],
  };

  const summaryOnly = formatAtsText(profile, { section: 'summary' });
  assert.equal(summaryOnly, '--- SUMMARY ---\nExperienced ML Engineer.');

  const skillsOnly = formatAtsText(profile, { section: 'skills' });
  assert.equal(skillsOnly, '--- KEY SKILLS ---\nPython, Go');

  const expOnly = formatAtsText(profile, { section: 'experience' });
  assert.match(expOnly, /--- EXPERIENCE ---\nDeveloper at Dev Co\n- Wrote code/);
});

test('loadProfile fails closed when profile.yml is missing', () => {
  assert.throws(
    () => loadProfile('non_existent_profile_path.yml'),
    /Profile configuration file not found at/
  );
});

test('loadProfile throws actionable error on missing or invalid custom cv path', () => {
  assert.throws(
    () => loadProfile('config/profile.example.yml', 'non_existent_cv_file.md'),
    /CV file not found at/
  );
});

test('loadProfile loads valid profile fixture and cv fixture correctly', () => {
  const profile = loadProfile('config/profile.example.yml', 'examples/cv-example.md');
  assert.equal(profile.name, 'Jane Smith');
  assert.equal(profile.email, 'jane@example.com');
  assert.ok(profile.skills.length > 0);
  assert.equal(profile.experience.length, 2);
  assert.equal(profile.experience[0].role, 'Senior ML Engineer / ML Platform Lead');
  assert.equal(profile.education.length, 2);
  assert.equal(profile.education[0].institution, 'UT Austin');
});
