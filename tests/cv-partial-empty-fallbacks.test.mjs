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
import { mkdtempSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from 'fs';
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

// Build the payload through the given template and return the HTML, or null
// when the build failed (already reported).
function build(label, templateArg) {
  const input = join(dir, 'mixed.json');
  const output = join(dir, `${label}.html`);
  writeFileSync(input, JSON.stringify(PAYLOAD));

  const args = [join(ROOT, 'build-cv-html.mjs'), input, output];
  if (templateArg) args.push(templateArg);

  if (run(NODE, args) === null) {
    const f = lastRunFailure();
    fail(`${label}: build-cv-html.mjs crashed (exit ${f?.status}) - ${(f?.stderr || '').trim().split('\n').pop()}`);
    return null;
  }
  // A zero exit with no file would otherwise surface as a bare ENOENT.
  if (!existsSync(output)) {
    fail(`${label}: build-cv-html.mjs exited 0 but wrote no output file`);
    return null;
  }
  return readFileSync(output, 'utf-8');
}

// Assert the alignment property and the exact chosen variant for every row.
function checkRows(label, html) {
  for (const [kind, rows] of Object.entries(EXPECTED)) {
    const found = [...html.matchAll(new RegExp(`<div class="${kind}-item">([\\s\\S]*?)</div>`, 'g'))]
      .map(m => m[1].replace(/\s+/g, ' ').trim());

    if (found.length !== rows.length) {
      fail(`${label} ${kind}: expected ${rows.length} rows, found ${found.length}`);
      continue;
    }

    rows.forEach(([title, org, year], i) => {
      const row = found[i];
      const expected = `<span class="${kind}-title">${title}</span> ${org} ${year}`;
      if (row === expected) pass(`${label} ${kind}: ${title} renders both cells`);
      else fail(`${label} ${kind}: ${title} - expected \`${expected}\`, got \`${row}\``);
    });

    // The alignment property itself, independent of the markup above: every
    // row carries the same number of spans.
    const counts = new Set(found.map(row => (row.match(/<span/g) || []).length));
    if (counts.size === 1) pass(`${label} ${kind}: every row has the same cell count (${[...counts][0]})`);
    else fail(`${label} ${kind}: rows have differing cell counts (${[...counts].sort().join(', ')}) - columns misalign`);
  }
}

// A template pack whose fallbacks use the block-suffixed spelling. The issue
// offered renaming the fallbacks to ORG_BLOCK_EMPTY/YEAR_BLOCK_EMPTY as the
// alternative fix; parsePartial accepts both, so a pack that took that route
// renders identically to the shipped one. Only the two partials under test are
// rewritten, so the spelling is the single variable.
function blockSuffixedTemplate() {
  const packDir = join(dir, 'pack');
  cpSync(join(ROOT, 'templates'), packDir, { recursive: true });

  for (const [section, prefix] of [['certifications', 'cert'], ['awards', 'award']]) {
    const file = join(packDir, 'sections', `${section}.html`);
    const renamed = readFileSync(file, 'utf-8')
      .replaceAll('ORG_EMPTY', 'ORG_BLOCK_EMPTY')
      .replaceAll('YEAR_EMPTY', 'YEAR_BLOCK_EMPTY');
    for (const [field, cell] of [['ORG', 'org'], ['YEAR', 'year']]) {
      if (!renamed.includes(`<!--${field}_BLOCK_EMPTY--><span class="${prefix}-${cell}">`)) {
        fail(`${section}.html no longer defines the ${field}_EMPTY fallback this fixture renames`);
      }
    }
    writeFileSync(file, renamed);
  }

  return join(packDir, 'cv-template.html');
}

try {
  // Default template, so the shipped templates/sections/ partials are the ones
  // under test rather than a fixture copy.
  const shipped = build('shipped', null);
  if (shipped) {
    checkRows('shipped:', shipped);

    // skills.html defines CATEGORY_BLOCK with no _EMPTY sibling, so an absent
    // category must collapse to nothing rather than to an empty label. Guards
    // the shared present/absent switch this fix reaches through.
    const skillRows = [...shipped.matchAll(/<div class="skill-item">([\s\S]*?)<\/div>/g)]
      .map(m => m[1].replace(/\s+/g, ' ').trim());
    const labelled = '<span class="skill-category">Languages: </span>JavaScript';
    if (skillRows[0] === labelled) pass('skills: a category renders its label');
    else fail(`skills: expected \`${labelled}\`, got \`${skillRows[0]}\``);
    if (skillRows[1] === 'Uncategorized skill') pass('skills: no category renders no label');
    else fail(`skills: expected a bare row, got \`${skillRows[1]}\``);
  }

  const suffixed = build('block-suffixed', blockSuffixedTemplate());
  if (suffixed) checkRows('_BLOCK_EMPTY:', suffixed);
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}
