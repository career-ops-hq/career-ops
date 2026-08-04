// tests/cv-partial-empty-fallbacks.test.mjs — the _EMPTY fallbacks in the
// certifications and awards partials must actually render (#2486).
//
// Both partials define <!--ORG_EMPTY--> / <!--YEAR_EMPTY--> so a row missing an
// org or a year still emits an empty <span> and the columns stay aligned.
// parsePartial resolved the fallback name by stripping _EMPTY, which keyed it
// under ORG instead of ORG_BLOCK where the renderer looks, so the fallback was
// collected and then never used: a mixed-row CV rendered rows with two spans
// next to rows with three, and the columns drifted.
//
// End-to-end through the real builder and the shipped partials on purpose.
// build-cv-html.mjs exports nothing, and the bug lived in the seam between the
// partial's block names and the builder's lookup — a unit test of either half
// alone would have passed.
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, run, NODE, ROOT, lastRunFailure } from './helpers.mjs';

console.log('\nbuild-cv-html.mjs — partial _EMPTY fallbacks render for mixed rows');

const PAYLOAD = {
  lang: 'en',
  page_format: 'letter',
  candidate: { name: 'Mixed Rows', email: 'mixed@example.com' },
  summary: 'Summary.',
  competencies: ['Competency'],
  experience: [{ company: 'Corp', role: 'Engineer', dates: '2024 - Present', bullets: ['Did a thing'] }],
  certifications: [
    { title: 'Cert both', org: 'Issuer', year: '2024' },
    { title: 'Cert no org', year: '2023' },
    { title: 'Cert no year', org: 'Issuer' },
    { title: 'Cert neither' },
  ],
  awards: [
    { title: 'Award both', org: 'Body', year: '2022' },
    { title: 'Award no org', year: '2021' },
    { title: 'Award no year', org: 'Body' },
  ],
  // A block with no _EMPTY sibling: absent must render nothing at all. This is
  // the other half of the same switch, and it shares the parsePartial change.
  skills: [
    { category: 'Languages', items: ['JavaScript'] },
    { items: ['Uncategorized skill'] },
  ],
};

// Every row must carry both spans, present-or-empty, so each section renders a
// constant number of cells per row. That is the alignment property; asserting
// the exact markup also pins which variant was chosen.
const EXPECTED = {
  cert: [
    ['Cert both', '<span class="cert-org">Issuer</span>', '<span class="cert-year">2024</span>'],
    ['Cert no org', '<span class="cert-org"></span>', '<span class="cert-year">2023</span>'],
    ['Cert no year', '<span class="cert-org">Issuer</span>', '<span class="cert-year"></span>'],
    ['Cert neither', '<span class="cert-org"></span>', '<span class="cert-year"></span>'],
  ],
  award: [
    ['Award both', '<span class="award-org">Body</span>', '<span class="award-year">2022</span>'],
    ['Award no org', '<span class="award-org"></span>', '<span class="award-year">2021</span>'],
    ['Award no year', '<span class="award-org">Body</span>', '<span class="award-year"></span>'],
  ],
};

const dir = mkdtempSync(join(tmpdir(), 'cv-2486-'));
try {
  const input = join(dir, 'mixed.json');
  const output = join(dir, 'mixed.html');
  writeFileSync(input, JSON.stringify(PAYLOAD));

  // Default template, so the shipped templates/sections/ partials are the ones
  // under test rather than a fixture copy.
  const built = run(NODE, [join(ROOT, 'build-cv-html.mjs'), input, output]);
  if (built === null) {
    const f = lastRunFailure();
    fail(`build-cv-html.mjs crashed (exit ${f?.status}) — ${(f?.stderr || '').trim().split('\n').pop()}`);
  } else {
    const html = readFileSync(output, 'utf-8');

    for (const [kind, rows] of Object.entries(EXPECTED)) {
      const found = [...html.matchAll(new RegExp(`<div class="${kind}-item">([\\s\\S]*?)</div>`, 'g'))]
        .map(m => m[1].replace(/\s+/g, ' ').trim());

      if (found.length !== rows.length) {
        fail(`${kind}: expected ${rows.length} rows, found ${found.length}`);
        continue;
      }

      rows.forEach(([title, org, year], i) => {
        const row = found[i];
        const expected = `<span class="${kind}-title">${title}</span> ${org} ${year}`;
        if (row === expected) pass(`${kind}: ${title} renders both cells`);
        else fail(`${kind}: ${title} — expected \`${expected}\`, got \`${row}\``);
      });

      // The alignment property itself, independent of the markup above: every
      // row carries the same number of spans.
      const counts = new Set(found.map(row => (row.match(/<span/g) || []).length));
      if (counts.size === 1) pass(`${kind}: every row has the same cell count (${[...counts][0]})`);
      else fail(`${kind}: rows have differing cell counts (${[...counts].sort().join(', ')}) — columns misalign`);
    }

    // skills.html defines CATEGORY_BLOCK with no _EMPTY sibling, so an absent
    // category must collapse to nothing rather than to an empty label. Guards
    // the shared present/absent switch this fix reaches through.
    const skillRows = [...html.matchAll(/<div class="skill-item">([\s\S]*?)<\/div>/g)]
      .map(m => m[1].replace(/\s+/g, ' ').trim());
    const labelled = '<span class="skill-category">Languages: </span>JavaScript';
    if (skillRows[0] === labelled) pass('skills: a category renders its label');
    else fail(`skills: expected \`${labelled}\`, got \`${skillRows[0]}\``);
    if (skillRows[1] === 'Uncategorized skill') pass('skills: no category renders no label');
    else fail(`skills: expected a bare row, got \`${skillRows[1]}\``);
  }
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}
