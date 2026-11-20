// tests/jd-years.test.mjs — the years-of-experience filter (jd-years.mjs):
// the parser over real JD phrasings, the band verdict, the config switch, the
// fetch-failure path, and the `yrs:` pipeline segment.
//
// The property every section protects: a posting is dropped only for a clear,
// required, overall bar above the band. Unknown, ambiguous, preferred-only,
// skill-only and unread JDs are kept.
import { pass, fail, warn, ROOT } from './helpers.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert';
import {
  parseYearsRequirement,
  classifyYears,
  formatYearsSegment,
  resolveExperienceFilter,
  applyExperienceFilter,
  fetchJdText,
} from '../jd-years.mjs';
import { formatPipelineOffer, loadCandidateYears } from '../scan.mjs';
import { extractLabels } from '../sync-batch-input.mjs';

const ok = async (name, fn) => {
  try { await fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); }
};

console.log('\njd-years — stated years of experience');

// [JD text, status, gating min, confident, display]
const PARSE_CASES = [
  // Plain required bars
  ['5+ years of experience in product management', 'stated', 5, true, '5+'],
  ['Minimum of five (5) years of relevant experience', 'stated', 5, true, '5+'],
  ['A minimum of 6 years’ experience in management consulting', 'stated', 6, true, '6+'],
  ['5 or more years of experience', 'stated', 5, true, '5+'],
  ['At least two years in investment banking or consulting', 'stated', 2, true, '2+'],
  ['3+ yrs exp in data analytics', 'stated', 3, true, '3+'],
  ['10-plus years of software engineering experience', 'stated', 10, true, '10+'],
  ['Seven plus years of experience leading teams', 'stated', 7, true, '7+'],
  ['Experience: 3+ years.', 'stated', 3, true, '3+'],
  ['3 years of experience required.', 'stated', 3, true, '3+'],
  ['At least 1 year of experience in a fast-paced environment', 'stated', 1, true, '1+'],
  ['18 months of experience in a customer-facing role', 'stated', 1.5, true, '1.5+'],
  ['5+ years of Python experience', 'stated', 5, true, '5+'],
  // Ranges count by their floor
  ['3-5 years experience in finance', 'stated', 3, true, '3-5'],
  ['Typically requires 2–4 years of related experience', 'stated', 2, true, '2-4'],
  ['Between 3 and 6 years of experience in consulting', 'stated', 3, true, '3-6'],
  ['4 to 8 years of experience in corporate development', 'stated', 4, true, '4-8'],
  ['<ul><li>4-8 years of experience in corporate development</li><li>MBA preferred</li></ul>', 'stated', 4, true, '4-8'],
  ['0-2 years of professional experience', 'stated', 0, true, '0-2'],
  // Degree-conditional alternatives: the lowest bar gates
  ['Bachelor degree with 7 years of experience, or a Master degree with 5 years of experience.', 'stated', 5, true, '5/7+ by degree'],
  ['10 or more years with a Bachelor’s Degree, or at least 8 years with an Advanced Degree, or 2 years with a PhD', 'stated', 2, true, '2/8/10+ by degree'],
  ['BS in Computer Science + 7 years of experience / MS + 5 years', 'stated', 5, true, '5/7+ by degree'],
  // Years instead of a degree bind only candidates without it: shown, never a
  // gate, and never `none stated`, which is kept for a JD that names no figure
  ['Bachelor’s degree or 4 years of equivalent experience.', 'substitute-only', null, false, 'degree or 4+'],
  ['Bachelor\'s degree and 5+ years of experience, or equivalent', 'stated', 5, true, '5+'],
  // Required vs preferred
  ['Ideally 4+ years in a strategy role', 'preferred-only', null, false, 'pref 4+'],
  ['Preferred qualifications:\n- 8 years of experience in strategy', 'preferred-only', null, false, 'pref 8+'],
  ['Minimum qualifications:\n- 5 years of experience in finance\nPreferred qualifications:\n- 8 years of experience in strategy', 'stated', 5, true, '5+'],
  // The same lists with each item's text on a new line (`<li>\n<p>`), as many
  // Greenhouse and Lever descriptions write them: every bar stays under its heading
  ['<p>Preferred qualifications</p><ul><li>\n<p>8 years of experience in strategy</p>\n</li></ul>', 'preferred-only', null, false, 'pref 8+'],
  ['<p>Minimum qualifications</p><ul><li>\n<p>5 years of experience in finance</p>\n</li></ul><p>Preferred qualifications</p><ul><li>\n<p>8 years of experience in strategy</p>\n</li></ul>', 'stated', 5, true, '5+'],
  // An empty item leaves the same bare marker, and the heading above it still holds
  ['<p>Preferred qualifications</p><ul><li></li><li>8 years of experience in strategy</li></ul>', 'preferred-only', null, false, 'pref 8+'],
  ['<p>Minimum qualifications</p><ul><li></li><li>5 years of experience in finance</li></ul>', 'stated', 5, true, '5+'],
  ['Preferred qualifications:\n*\n8 years of experience in strategy', 'preferred-only', null, false, 'pref 8+'],
  // A marker ends at a space or the end of the line, so this "1." is part of the figure
  ['1.5 years of experience in finance', 'stated', 1.5, true, '1.5+'],
  ['Required: 3+ years in FP&A. Preferred: 5+ years in strategy.', 'stated', 3, true, '3+'],
  ['5+ years of experience is a plus', 'preferred-only', null, false, 'pref 5+'],
  ['Nice to have\n- 3 years of experience in fintech', 'preferred-only', null, false, 'pref 3+'],
  ['Minimum of 2 years of frontend engineering experience preferred', 'preferred-only', null, false, 'pref 2+'],
  // Live Ashby posting: two required bars
  ['- Minimum 5 years of experience building software\n- Minimum 3 years of experience building in AWS (with Terraform)', 'stated', 3, true, '3/5+'],
  // Skill-specific figures do not gate
  ['2+ years of experience with SQL', 'skill-only', null, false, 'skill 2+'],
  ['3+ years of hands-on experience with Kubernetes', 'skill-only', null, false, 'skill 3+'],
  // Sub-requirements do not lower the overall bar
  ['7+ years of experience, including 2 years managing people', 'stated', 7, true, '7+'],
  // Several required bars: all shown, the lowest gates
  ['3+ years of experience in strategy; 6+ years in finance', 'stated', 3, true, '3/6+'],
  ['- 5+ years of professional software development experience\n- 2+ years of experience as a mentor or tech lead', 'stated', 2, true, '2/5+'],
  // Phrasings seen on live boards
  ['- 8+ years practicing employment law', 'stated', 8, true, '8+'],
  ['What We Require:\n- 3+ years of experience in finance within a US multi-national company', 'stated', 3, true, '3+'],
  ['- Extensive security experience (3+ years) in at least one major platform', 'stated', 3, true, '3+'],
  ['- 2+ years technical engineering experience', 'stated', 2, true, '2+'],
  ['- 4+ years of experience with Linux system administration', 'skill-only', null, false, 'skill 4+'],
  // "No experience required" is a stated zero
  ['No prior experience required', 'stated', 0, true, '0+'],
  // Not about the candidate's experience
  ['We have over 20 years of experience serving clients.', 'none', null, false, 'none stated'],
  ['Our team brings 15 years of combined experience to every engagement.', 'none', null, false, 'none stated'],
  ['Four-year degree required.', 'none', null, false, 'none stated'],
  ['A 4-year degree in economics', 'none', null, false, 'none stated'],
  ['Must be 18 years of age or older', 'none', null, false, 'none stated'],
  ['Our company was founded 12 years ago', 'none', null, false, 'none stated'],
  ['Equity vests over 4 years', 'none', null, false, 'none stated'],
  ['Within 2 years you will lead the team.', 'none', null, false, 'none stated'],
  ['Over the past 10 years, Acme has grown to 5,000 employees.', 'none', null, false, 'none stated'],
  ['This is a 12-month contract', 'none', null, false, 'none stated'],
  ['Revenue grew 40% year-over-year for 3 years', 'none', null, false, 'none stated'],
  ['', 'none', null, false, 'none stated'],
  // False-drop guards found in review
  ['This is a year-long rotational program for new graduates', 'none', null, false, 'none stated'],
  ['Pay is about $100K a year, depending on experience.', 'none', null, false, 'none stated'],
  ['Join our 3-year rotational program; prior experience welcome', 'none', null, false, 'none stated'],
  ["You'll work alongside engineers with 10+ years of experience", 'none', null, false, 'none stated'],
  ['Learn from mentors who have 15 years in the industry.', 'none', null, false, 'none stated'],
  ['Even better if you have:\n- 8+ years of experience in strategy', 'preferred-only', null, false, 'pref 8+'],
  ['Bonus points:\n- 6 years in fintech', 'preferred-only', null, false, 'pref 6+'],
  ['5+ years of experience, or an equivalent combination of education and experience', 'stated', 5, false, '5+ or equivalent'],
  ['- 5+ years of relevant experience\n- Or an equivalent combination of education and experience', 'stated', 5, false, '5+ or equivalent'],
  ['A year of experience in customer support', 'stated', 1, true, '1+'],
  // 2026-11-20 audit of 58 `none stated` rows whose full JD was read: the real
  // sentences behind each miss. "in business" read as company history
  // ("been in business for 30 years") hid every "experience in business ..." bar
  ['- 3+ years of experience in business operations, strategy & operations, management consulting', 'stated', 3, true, '3+'],
  ["- 4+ years of experience and a bachelor's degree in Business, Economics, Statistics, or a related field.", 'stated', 4, true, '4+'],
  ['- Minimum 3 years of relevant experience in business operations, controls, governance, strategy', 'stated', 3, true, '3+'],
  ['10+ years of professional experience, including significant experience in business strategy consulting', 'stated', 10, true, '10+'],
  ['5+ years of diverse problem solving experience in business, finance or strategy', 'stated', 5, true, '5+'],
  ['We have been in business for 30 years.', 'none', null, false, 'none stated'],
  // Spelled-out numbers, "approximately", "X-Y+" ranges, spaced dashes
  ['- At least three years of relevant experience in business management, finance, investment banking', 'stated', 3, true, '3+'],
  ['Approximately 1–3+ years of experience in strategy', 'stated', 1, true, '1-3'],
  ['3-5+ years of overall experience', 'stated', 3, true, '3-5'],
  ['1 – 3 years of work experience', 'stated', 1, true, '1-3'],
  ['4+ years of professional work experience', 'stated', 4, true, '4+'],
  ['7+ years experience in business planning and analysis', 'stated', 7, true, '7+'],
  // A field list between the figure and "experience"
  ['8+ years finance, consulting, or strategy experience required', 'stated', 8, true, '8+'],
  ["- Bachelor's Degree in Business, Marketing, or related field AND 5+ years integrated marketing (e.g., digital, relationship, social media, campaign), event management, or related work experience OR equivalent experience.", 'stated', 5, true, '5+'],
  ['This is envisioned as a two- to three-year role. Success will position you for growth, building experience.', 'none', null, false, 'none stated'],
  // A bare figure that is its own item under a required heading
  ['Requirements:\n- 5+ years', 'stated', 5, true, '5+'],
  // Degree-conditional bars joined by OR (Walmart, Google): the lowest gates
  ["Minimum Qualifications: Bachelor's degree in Business, Statistics, or related field and 7 years' experience in retail merchandising, operations management, or related area OR 9 years' experience in retail merchandising, operations management, or related area. 3 years' supervisory experience.", 'stated', 7, true, '7/9+ by degree'],
  ['- 4 years of experience in business development, partnerships, management consulting, or investment banking, or 2 years with advanced degree.', 'stated', 2, true, '2/4+ by degree'],
  // "Option 1: ... Option 2: ..." (Walmart): each option is one way in
  ["Option 1: Bachelor's degree in Business, Engineering, or related field and 4 years' experience in data analysis. Option 2: Master's degree in Business or related field and 2 years' experience in data analysis. Option 3: 6 years' experience in data analysis.", 'stated', 2, true, '2/4/6+ by degree'],
  ["• Option 1: Bachelor's degree in computer science or related area and 8 years' experience in engineering program management.\n• Option 2: 10 years' experience in engineering program management.", 'stated', 8, true, '8/10+ by degree'],
  // The same bar wrapped onto a second line, and an OR item continuing the one above
  ["Minimum Qualifications...\nBachelor's degree in Business, Marketing, Communications, or related field and 3 years' experience in marketing or related field OR 7 years'\nexperience in marketing or related field.", 'stated', 3, true, '3/7+ by degree'],
  ["- Master's Degree in Business Administration or related field AND 3+ years strategy, business planning, consulting, or finance experience\n- OR Bachelor's Degree in Business, Finance, or related field AND 4+ years strategy, business planning, consulting, or finance experience\n- OR equivalent experience", 'stated', 3, true, '3/4+ by degree'],
  // Apostrophe shapes
  ["1 yearʼs experience in marketing", 'stated', 1, true, '1+'],
  ['5 years´ experience in finance', 'stated', 5, true, '5+'],
  // Supervisory years are part of the overall bar, never the bar itself
  ["Bachelor's degree and 4 years' experience in operations. 2 years' supervisory experience.", 'stated', 4, true, '4+'],
  ['- 10+ years of relevant experience across strategy and operations\n- 6+ years of people leadership experience', 'stated', 10, true, '10+'],
  ["3 years' supervisory experience.", 'skill-only', null, false, 'skill 3+'],
];

await ok(`parser reads ${PARSE_CASES.length} real phrasings`, () => {
  const misses = [];
  for (const [text, status, min, confident, display] of PARSE_CASES) {
    const r = parseYearsRequirement(text);
    const got = { status: r.status, min: r.min, confident: r.confident, display: r.display };
    const want = { status, min, confident, display };
    if (JSON.stringify(got) !== JSON.stringify(want)) misses.push(`${JSON.stringify(text)}: got ${JSON.stringify(got)}`);
  }
  assert.deepStrictEqual(misses, []);
});

// Pre-landing review (2026-10-28): each of these was read as a confident bar
// above a 3-year band (years 3, stretch 1), so `action: drop` removed the very
// early-career postings the filter exists to keep.
const NEVER_OUT = [
  // A ceiling is not a floor.
  'Up to 10 years of experience in finance.',
  'Less than 8 years of professional experience',
  'No more than 6 years of experience',
  '5 years of experience maximum.',
  'Requirements:\n- 6 years of experience or less',
  // Someone else's experience.
  "You'll join a team that averages 12 years of industry experience.",
  'Manage a team of analysts with 5-8 years of experience.',
  'Responsibilities:\n- Support clients with 10+ years of experience in the market.',
  'Experience hiring candidates with 10+ years of experience.',
  // A heading the parser does not know is not a required section.
  'Requirements:\n- 2+ years of experience with SQL\nWhat we\'d love to see\n- 8+ years of experience in fintech',
  'Requirements:\n- 2+ years of experience with SQL\nAdditional Qualifications\n- 8+ years of experience in fintech',
  'Requirements:\n- 2+ years of experience with SQL\nPreferred Qualifications (any 2 of the following)\n- 7+ years of experience in fintech',
  'Requirements:\n- 2+ years of experience with SQL\nIt would be great if you also have the following things\n- 7+ years of experience in fintech',
  // A list item holding a heading word does not start a required section.
  'Requirements:\n- 2+ years of experience with SQL\nPreferred qualifications\n- Excellent communication skills\n- 8+ years of experience in fintech',
  'Requirements:\n- 2+ years of experience with SQL\nNice to have\n- Experience in fintech\n- 8+ years of experience in payments',
  'Requirements:\n- 2+ years of experience with SQL\nBonus points\n- Startup experience\n- 7+ years of experience with data platforms',
  '<p>Requirements:</p><ul><li>2+ years of experience with SQL</li></ul><p>Preferred qualifications</p><ul><li>Strong analytical skills</li><li>8+ years of experience in fintech</li></ul>',
  // The same two lines with no list markers, as a pasted JD arrives.
  'Requirements:\n2+ years of experience with SQL\nPreferred qualifications\nExperience in fintech\n8+ years of experience in payments',
  // An item whose text starts the line after its marker, as `<li>\n<p>text`
  // converts, is still an item.
  '<p>Requirements:</p><ul><li>2+ years of experience with SQL</li></ul><p>Preferred qualifications</p><ul><li>\n<p>Strong analytical skills</p></li><li><p>8+ years of experience in fintech</p></li></ul>',
  'Requirements:\n- 2+ years of experience with SQL\nPreferred qualifications\n-\nStrong analytical skills\n- 8+ years of experience in fintech',
  'Requirements:\n- 2+ years of experience with SQL\nPreferred qualifications\n-\n\nExcellent communication skills\n- 8+ years of experience in fintech',
  // "Experience in fintech:" introduces the items after it, not a section.
  'Requirements:\n- 2+ years of experience with SQL\nPreferred qualifications\nExperience in fintech:\n- 8+ years of experience in payments',
  'Requirements:\n- 2+ years of experience with SQL\nNice to have\n- Experience with:\n- 8+ years of Kafka',
];

await ok(`review regressions: ${NEVER_OUT.length} ceilings, third parties and unknown headings never read as out`, () => {
  const bad = NEVER_OUT
    .map(jd => ({ jd, req: parseYearsRequirement(jd) }))
    .filter(({ req }) => classifyYears(req, { years: 3, stretchYears: 1 }) === 'out')
    .map(({ jd, req }) => `${JSON.stringify(jd)} → ${req.display}`);
  assert.deepStrictEqual(bad, []);
});

await ok('a bar under an unknown heading still gates when the sentence speaks to the candidate', () => {
  const req = parseYearsRequirement('About the role\n- You have 8+ years of experience in fintech.');
  assert.strictEqual(classifyYears(req, { years: 3, stretchYears: 1 }), 'out');
  // A short bullet with a figure in parentheses is not a heading, so it does
  // not end the required section it sits in (a live Lever JD).
  const travel = parseYearsRequirement('What We Require\n- Ability to travel (50%+) per business needs\n- 10+ years of outbound sales experience');
  assert.strictEqual(classifyYears(travel, { years: 3, stretchYears: 1 }), 'out');
});

await ok('a real required heading still gates, as a bare word, in a list or after a preferred section', () => {
  const out = (jd) => classifyYears(parseYearsRequirement(jd), { years: 3, stretchYears: 1 });
  assert.strictEqual(out('Experience\n- 8+ years of Python'), 'out');
  assert.strictEqual(out('Experience:\n- 8+ years of Python'), 'out');
  assert.strictEqual(out('Skills & Experience\n- 8+ years of Python'), 'out');
  assert.strictEqual(out('- Requirements:\n- 8+ years of Python'), 'out');
  assert.strictEqual(out('Nice to have\n- Kubernetes\nRequirements\n- 8+ years of experience in Python'), 'out');
  assert.strictEqual(out('Minimum qualifications\n- Experience in fintech\n- 8+ years of experience in payments'), 'out');
});

await ok('pathological whitespace and tag-like input parse in well under a second', () => {
  for (const jd of [`5+ years${' '.repeat(60_000)}of experience. Next`, '<a'.repeat(30_000)]) {
    const t = performance.now();
    parseYearsRequirement(jd);
    assert.ok(performance.now() - t < 500, `${Math.round(performance.now() - t)}ms`);
  }
});

await ok('a full multi-section JD gates on its required section only', () => {
  const jd = [
    'About Acme',
    'Founded 25 years ago, we have served customers for over 20 years.',
    'What you will do',
    '- Own the quarterly planning cycle',
    'Minimum Qualifications:',
    '- Bachelor’s degree in Finance, Economics, or a related field.',
    '- 4+ years of experience in corporate strategy, consulting, or investment banking.',
    '- 2+ years of experience with SQL.',
    'Preferred Qualifications:',
    '- 7+ years of experience in strategy.',
    'Benefits',
    '- 401(k) match after 1 year of service',
  ].join('\n');
  const r = parseYearsRequirement(jd);
  assert.strictEqual(r.status, 'stated');
  assert.strictEqual(r.min, 4);
  assert.strictEqual(r.confident, true);
  assert.ok(r.mentions.some(m => m.kind === 'preferred' && m.floor === 7));
  assert.ok(r.mentions.some(m => m.scope === 'skill' && m.floor === 2));
});

console.log('\njd-years — band verdict');

const band = { years: 3, stretchYears: 0 };
await ok('a floor at or below years + stretch is in band; ranges count by their floor', () => {
  assert.strictEqual(classifyYears(parseYearsRequirement('3+ years of experience'), band), 'in');
  assert.strictEqual(classifyYears(parseYearsRequirement('2-4 years of experience'), band), 'in');
  assert.strictEqual(classifyYears(parseYearsRequirement('3-5 years of experience'), band), 'in');
  assert.strictEqual(classifyYears(parseYearsRequirement('4+ years of experience'), band), 'out');
  assert.strictEqual(classifyYears(parseYearsRequirement('5-7 years of experience'), band), 'out');
  assert.strictEqual(classifyYears(parseYearsRequirement('4+ years of experience'), { years: 3, stretchYears: 1 }), 'in');
});

await ok('degree alternatives gate on the lowest bar', () => {
  const r = parseYearsRequirement('7 years of experience with a Bachelor’s degree, or 3 years with a Master’s degree');
  assert.strictEqual(classifyYears(r, band), 'in');
});

await ok('several bars: in when the lowest is in reach, out only when every one is above', () => {
  assert.strictEqual(classifyYears(parseYearsRequirement('5+ years of experience; 2+ years leading a team'), band), 'in');
  assert.strictEqual(classifyYears(parseYearsRequirement('5+ years of experience in strategy; 9+ years in finance'), band), 'out');
});

await ok('an "equivalent combination" route keeps a bar above the band', () => {
  const r = parseYearsRequirement('7+ years of experience, or an equivalent combination of education and experience');
  assert.strictEqual(classifyYears(r, band), 'unknown');
});

await ok('unknown, preferred-only, skill-only and unread are never out', () => {
  for (const text of [
    'No years mentioned anywhere.',
    'Ideally 10+ years in a strategy role',
    '8+ years of experience with Kubernetes',
  ]) {
    assert.strictEqual(classifyYears(parseYearsRequirement(text), band), 'unknown', text);
  }
  assert.strictEqual(classifyYears(null, band), 'unknown');
});

console.log('\njd-years — config');

await ok('off unless experience_filter is present and not disabled', () => {
  assert.deepStrictEqual(resolveExperienceFilter(undefined, 5), { enabled: false });
  assert.deepStrictEqual(resolveExperienceFilter(null, 5), { enabled: false });
  assert.deepStrictEqual(resolveExperienceFilter({ enabled: false }, 5), { enabled: false });
  // A string is not a switch: `enabled: "false"` must not turn the filter on.
  assert.strictEqual(resolveExperienceFilter({ enabled: 'false' }, 5).enabled, false);
  assert.match(String(resolveExperienceFilter({ enabled: 'yes' }, 5).reason), /true or false/);
});

await ok('on with profile years and defaults (action defaults to label)', () => {
  assert.deepStrictEqual(resolveExperienceFilter({ enabled: true }, 5),
    { enabled: true, years: 5, stretchYears: 1, action: 'label', concurrency: 4 });
  assert.strictEqual(resolveExperienceFilter({ action: 'drop' }, 5).action, 'drop');
  // Only an explicit `drop` removes rows: a typo or any other value labels.
  assert.strictEqual(resolveExperienceFilter({ action: 'Drop' }, 5).action, 'label');
  assert.strictEqual(resolveExperienceFilter({ action: true }, 5).action, 'label');
  assert.deepStrictEqual(resolveExperienceFilter({ years: 3, stretch_years: 0, action: 'label', concurrency: 2 }, 9),
    { enabled: true, years: 3, stretchYears: 0, action: 'label', concurrency: 2 });
});

await ok('profile years: absent is silent, a non-number or unreadable profile says so', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'jd-years-profile-'));
  const warned = [];
  const realWarn = console.warn;
  console.warn = (msg) => warned.push(String(msg));
  try {
    const at = (name, text) => { const f = join(dir, name); writeFileSync(f, text); return f; };
    assert.strictEqual(loadCandidateYears(at('ok.yml', 'candidate:\n  years_of_experience: 4.5\n')), 4.5);
    assert.strictEqual(loadCandidateYears(at('absent.yml', 'candidate:\n  full_name: x\n')), undefined);
    assert.deepStrictEqual(warned, []);
    assert.strictEqual(loadCandidateYears(at('quoted.yml', 'candidate:\n  years_of_experience: "four"\n')), undefined);
    assert.match(warned.join('\n'), /years_of_experience.*must be a number.*"four"/);
    assert.strictEqual(loadCandidateYears(at('broken.yml', 'candidate:\n\tyears: [\n')), undefined);
    assert.match(warned.at(-1) ?? '', /could not read/);
  } finally {
    console.warn = realWarn;
    rmSync(dir, { recursive: true, force: true });
  }
});

await ok('on without any years stays off and says why', () => {
  const r = resolveExperienceFilter({ enabled: true }, undefined);
  assert.strictEqual(r.enabled, false);
  assert.match(String(r.reason), /years_of_experience/);
});

console.log('\njd-years — scan step');

const filter = { years: 3, stretchYears: 0, action: /** @type {'drop'} */ ('drop'), concurrency: 2 };
const JDS = {
  'https://boards.greenhouse.io/acme/jobs/1': 'Requirements: 2-4 years of experience in strategy.',
  'https://boards.greenhouse.io/acme/jobs/2': 'Requirements: 6+ years of experience in strategy.',
  'https://boards.greenhouse.io/acme/jobs/3': 'Requirements: 5+ years of experience; 2+ years leading a team.',
  'https://boards.greenhouse.io/acme/jobs/4': 'A great team. No figure here.',
};
const offer = (n, extra = {}) => ({ url: `https://boards.greenhouse.io/acme/jobs/${n}`, company: 'Acme', title: `Role ${n}`, ...extra });

await ok('drops only the confident out-of-band offer; keeps order and labels the rest', async () => {
  const fetched = [];
  const { kept, dropped } = await applyExperienceFilter([offer(1), offer(2), offer(3), offer(4)], filter, {
    fetchJd: async (url) => { fetched.push(url); return JDS[url]; },
  });
  assert.deepStrictEqual(dropped.map(o => o.title), ['Role 2']);
  assert.deepStrictEqual(kept.map(o => [o.title, o.years.label, o.years.verdict]), [
    ['Role 1', '2-4', 'in'],
    ['Role 3', '2/5+', 'in'],
    ['Role 4', 'none stated', 'unknown'],
  ]);
  assert.strictEqual(fetched.length, 4);
});

await ok('a failed or unsupported fetch keeps the offer as unread', async () => {
  const { kept, dropped } = await applyExperienceFilter([offer(5), offer(6)], filter, {
    fetchJd: async (url) => { if (url.endsWith('/5')) throw new Error('HTTP 503'); return null; },
  });
  assert.strictEqual(dropped.length, 0);
  assert.deepStrictEqual(kept.map(o => o.years.label), ['unread', 'unread']);
  assert.strictEqual(kept[0].years.error, 'HTTP 503');
});

await ok('the full JD wins over the listing teaser', async () => {
  const { kept, dropped } = await applyExperienceFilter([offer(7, { description: '8+ years of experience required.' })], filter, {
    fetchJd: async () => 'Requirements: 2+ years of experience.',
  });
  assert.strictEqual(dropped.length, 0);
  assert.strictEqual(kept[0].years.label, '2+');
  assert.strictEqual(kept[0].years.source, 'ats');
});

await ok('a reading from the listing alone is shown but never drops', async () => {
  for (const fetchJd of [async () => null, async () => { throw new Error('timeout'); }]) {
    const { kept, dropped } = await applyExperienceFilter([offer(8, { description: '8+ years of experience required.' })], filter, { fetchJd });
    assert.strictEqual(dropped.length, 0);
    assert.strictEqual(kept[0].years.verdict, 'unknown');
    assert.strictEqual(kept[0].years.label, '8+');
    assert.strictEqual(kept[0].years.source, 'listing');
  }
});

await ok('a listing excerpt that names no figure is labelled as listing-only, not as the JD', async () => {
  const { kept } = await applyExperienceFilter([offer(9, { description: 'Join our strategy team. Apply today.' })], filter, {
    fetchJd: async () => null,
  });
  assert.strictEqual(kept[0].years.source, 'listing');
  assert.strictEqual(kept[0].years.label, 'none stated (listing only)');
  // The full JD saying nothing is still plain `none stated`.
  const full = await applyExperienceFilter([offer(10)], filter, { fetchJd: async () => 'Join our strategy team.' });
  assert.strictEqual(full.kept[0].years.label, 'none stated');
  assert.strictEqual(formatYearsSegment(parseYearsRequirement('Apply today.'), 'unknown', 'listing'), 'yrs: none stated (listing only)');
  assert.strictEqual(formatYearsSegment(parseYearsRequirement('Apply today.'), 'unknown'), 'yrs: none stated');
});

await ok('progress is reported once per offer', async () => {
  const seen = [];
  await applyExperienceFilter([offer(1), offer(4)], filter, {
    fetchJd: async (url) => JDS[url],
    onProgress: (done, total) => seen.push(`${done}/${total}`),
  });
  assert.deepStrictEqual(seen.sort(), ['1/2', '2/2']);
});

console.log('\njd-years — JD fetch');

/** A transport stub: records each URL, answers from a map, throws for an Error value. */
const stubCtx = (answers) => {
  const calls = [];
  return {
    calls,
    ctx: {
      fetchJson: async (url) => {
        calls.push(url);
        const a = answers[url];
        if (a instanceof Error) throw Object.assign(a, { status: /** @type {any} */ (a).status ?? 404 });
        if (a === undefined) throw Object.assign(new Error(`unexpected ${url}`), { status: 404 });
        return a;
      },
      sleep: async () => {},
    },
  };
};

await ok('Greenhouse asks for the content and returns the JD text', async () => {
  const api = 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/123?content=true';
  const { ctx, calls } = stubCtx({ [api]: { title: 'Analyst', content: '&lt;p&gt;4+ years of experience&lt;/p&gt;' } });
  const text = await fetchJdText('https://boards.greenhouse.io/acme/jobs/123', { ctx });
  assert.deepStrictEqual(calls, [api]);
  assert.match(String(text), /4\+ years of experience/);
});

await ok('Ashby reads the board once for every posting on it, and does not re-read a failed board', async () => {
  const api = 'https://api.ashbyhq.com/posting-api/job-board/acme';
  const board = { jobs: [
    { id: 'aaaaaaaa-0000-0000-0000-000000000001', title: 'A', descriptionPlain: '3+ years of experience' },
    { id: 'aaaaaaaa-0000-0000-0000-000000000002', title: 'B', descriptionPlain: '6+ years of experience' },
  ] };
  const boardCache = new Map();
  const { ctx, calls } = stubCtx({ [api]: board });
  const a = await fetchJdText('https://jobs.ashbyhq.com/acme/aaaaaaaa-0000-0000-0000-000000000001', { ctx, boardCache });
  const b = await fetchJdText('https://jobs.ashbyhq.com/acme/aaaaaaaa-0000-0000-0000-000000000002', { ctx, boardCache });
  assert.strictEqual(calls.length, 1);
  assert.match(String(a), /3\+ years/);
  assert.match(String(b), /6\+ years/);

  const failing = new Map();
  // A board that is down (a 503 after the retries), not one that 404s: that
  // falls through to the posting page (the next test).
  const bad = stubCtx({ [api]: Object.assign(new Error('down'), { status: 503 }) });
  await assert.rejects(fetchJdText('https://jobs.ashbyhq.com/acme/aaaaaaaa-0000-0000-0000-000000000001', { ctx: bad.ctx, boardCache: failing }));
  const afterFirst = bad.calls.length;
  // A board that failed after its retries stays failed for the run: every
  // other posting on it reads `unread` (kept) without hitting it again.
  await assert.rejects(fetchJdText('https://jobs.ashbyhq.com/acme/aaaaaaaa-0000-0000-0000-000000000002', { ctx: bad.ctx, boardCache: failing }));
  assert.strictEqual(bad.calls.length, afterFirst, 'a failed board is not requested again');
});

await ok('an embed-only Ashby board whose API 404s is read from the posting page, not left unread', async () => {
  // Whatnot (2026-11-20): api.ashbyhq.com/posting-api/job-board/whatnot answers
  // 404 while jobs.ashbyhq.com/whatnot/{id} carries the full JobPosting JSON-LD.
  const api = 'https://api.ashbyhq.com/posting-api/job-board/whatnot';
  const url = 'https://jobs.ashbyhq.com/whatnot/3a0e0253-554f-4735-a8ea-9e3cae87044c';
  const { ctx, calls } = stubCtx({ [api]: Object.assign(new Error('HTTP 404'), { status: 404 }) });
  const pages = [];
  const fetchPage = async (u) => { pages.push(u); return { text: 'Strategy lead. 5+ years of experience in strategy.' }; };
  const boardCache = new Map();
  const text = await fetchJdText(url, { ctx, boardCache, fetchPage });
  assert.deepStrictEqual(calls, [api]);
  assert.deepStrictEqual(pages, [url]);
  assert.strictEqual(parseYearsRequirement(String(text)).display, '5+');
  // The second posting on the board reuses the cached 404 and goes straight to its page.
  await fetchJdText('https://jobs.ashbyhq.com/whatnot/54868b38-559e-44be-a0c9-c6adb073f385', { ctx, boardCache, fetchPage });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(pages.length, 2);
  // A page with no posting stays null (unread), and a closed page still throws.
  assert.strictEqual(await fetchJdText(url, { ctx, fetchPage: async () => null }), null);
  await assert.rejects(fetchJdText(url, { ctx, fetchPage: async () => ({ closed: true, evidence: 'validThrough' }) }), /closed/);
  // An authoritative 404 (Greenhouse) is still a failed read, never a page read.
  const gh = stubCtx({ 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/9?content=true': Object.assign(new Error('HTTP 404'), { status: 404 }) });
  await assert.rejects(fetchJdText('https://boards.greenhouse.io/acme/jobs/9', { ctx: gh.ctx, fetchPage: async () => { throw new Error('page reader must not run'); } }), /404/);
});

await ok('a host with no JD API or host reader falls to the page reader, and makes no API request', async () => {
  const { ctx, calls } = stubCtx({});
  const pages = [];
  const fetchPage = async (url) => { pages.push(url); return null; };
  assert.strictEqual(await fetchJdText('https://careers.example.com/jobs/42', { ctx, fetchPage }), null);
  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual(pages, ['https://careers.example.com/jobs/42']);
  // The page's own JobPosting is the JD when there is one.
  const text = await fetchJdText('https://careers.example.com/jobs/43', { ctx, fetchPage: async () => ({ text: '5+ years of experience' }) });
  assert.strictEqual(text, '5+ years of experience');
  // A page that calls itself closed is a failed read (unread), never a JD.
  await assert.rejects(fetchJdText('https://careers.example.com/jobs/44', { ctx, fetchPage: async () => ({ closed: true, evidence: 'validThrough' }) }), /closed/);
});

await ok('a host reader serves the JD before the page reader is asked', async () => {
  const api = 'https://acme.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%2242%22,siteNumber=CX_1';
  const { ctx, calls } = stubCtx({ [api]: { items: [{ Id: '42', Title: 'Analyst', ExternalDescriptionStr: '<p>About</p>', ExternalQualificationsStr: '<ul><li>4+ years of experience</li></ul>' }] } });
  const fetchPage = async () => { throw new Error('page reader must not run'); };
  const text = await fetchJdText('https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/42', { ctx, fetchPage });
  assert.deepStrictEqual(calls, [api]);
  assert.match(String(text), /4\+ years of experience/);
});

await ok('action: label keeps an out-of-band offer and marks it', async () => {
  const { kept, dropped } = await applyExperienceFilter([offer(2)], { ...filter, action: 'label' }, {
    fetchJd: async (url) => JDS[url],
  });
  assert.strictEqual(dropped.length, 0);
  assert.strictEqual(kept[0].years.label, '6+ above band');
});

await ok('a block with no action keeps out-of-band offers (label is the default)', async () => {
  const resolved = resolveExperienceFilter({ enabled: true, stretch_years: 0 }, 3);
  if (!resolved.enabled) throw new Error('filter should be on');
  const { kept, dropped } = await applyExperienceFilter([offer(1), offer(2)], resolved, {
    fetchJd: async (url) => JDS[url],
  });
  assert.strictEqual(dropped.length, 0);
  assert.deepStrictEqual(kept.map(o => o.years.label), ['2-4', '6+ above band']);
});

console.log('\njd-years — pipeline row');

await ok('`yrs:` rides after trust:, before note:, and is absent when the filter is off', () => {
  const base = { url: 'https://x/1', company: 'Acme', title: 'Analyst', postedAt: Date.UTC(2026, 9, 1) };
  assert.strictEqual(formatPipelineOffer(base), '- [ ] https://x/1 | Acme | Analyst | posted: 2026-10-01');
  assert.strictEqual(
    formatPipelineOffer({ ...base, trustScore: 80, years: { label: '3-5' }, note: 'curated' }),
    '- [ ] https://x/1 | Acme | Analyst | posted: 2026-10-01 | trust: 80 | yrs: 3-5 | note: curated',
  );
  assert.strictEqual(formatYearsSegment(null, 'unknown'), 'yrs: unread');
});

await ok('a hostile label cannot add a column or a checkbox', () => {
  const row = formatPipelineOffer({ url: 'https://x/2', company: 'Acme', title: 'Analyst', years: { label: '5+ | x\n- [ ] https://evil/1' } });
  assert.ok(!row.includes('\n'));
  assert.strictEqual(row.split('|').length, 4);
  assert.ok(row.endsWith('| yrs: 5+ / x - \\[ \\] https://evil/1'), row);
});

await ok('pipeline readers treat `yrs:` as a label, not a location', async () => {
  const line = '- [ ] https://x/3 | Acme | Analyst | yrs: 3-5 | note: keep';
  assert.deepStrictEqual(extractLabels(line.slice(6)), { yrs: '3-5', note: 'keep' });
  // web/ is optional in a checkout (#3269), so its reader is loaded only when present.
  const webReader = join(ROOT, 'web', 'src', 'lib', 'pipeline-table.mjs');
  if (!existsSync(join(ROOT, 'web', 'src'))) {
    warn('web/ not present in this checkout — skipping the web pipeline reader check');
    return;
  }
  const { parseInbox } = await import(pathToFileURL(webReader).href);
  const [row] = parseInbox(`${line}\n`);
  assert.strictEqual(row.location, undefined);
  assert.strictEqual(row.company, 'Acme');
});

console.log('\njd-years — portals.yml validation');

await ok('validate-portals rejects a malformed experience_filter and accepts the documented one', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { ROOT, NODE } = await import('./helpers.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'jd-years-portals-'));
  try {
    const bad = join(dir, 'bad.yml');
    const good = join(dir, 'good.yml');
    writeFileSync(bad, 'tracked_companies: []\nexperience_filter:\n  enabled: "yes"\n  stretch_years: -1\n  action: skip\n');
    writeFileSync(good, 'tracked_companies: []\nexperience_filter:\n  enabled: true\n  stretch_years: 1\n  action: drop\n');
    const run = f => spawnSync(NODE, [join(ROOT, 'validate-portals.mjs'), '--file', f], { encoding: 'utf8' }).stdout;
    const badOut = run(bad);
    assert.match(badOut, /experience_filter\.enabled/);
    assert.match(badOut, /experience_filter\.stretch_years/);
    assert.match(badOut, /experience_filter\.action/);
    assert.match(run(good), /0 errors/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
