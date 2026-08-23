// tests/i18n-drift.test.mjs — structural drift checker unit tests (#3168)
//
// Discovered suites run IN-PROCESS inside test-all.mjs: they must report via
// the shared pass/fail counters from helpers.mjs and must never terminate the
// process themselves.
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pass, fail, ROOT } from './helpers.mjs';
import {
  extractHeadings,
  extractSections,
  compareStructure,
  parseReadmeMapping,
  resolveCanonical,
  discoverLangs,
  checkLang,
  toJSON,
  formatReport,
} from '../i18n-drift.mjs';

console.log('\ni18n-drift — structural drift checker (#3168)');

function check(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

// ---------------------------------------------------------------------------
// extractHeadings
// ---------------------------------------------------------------------------

{
  const headings = extractHeadings(`
# Title

Some text.

## First section

### Nested section

## Second section
`);

  check(headings.length === 4, 'extractHeadings: extracts all 4 headings');
  check(
    JSON.stringify(headings.map(h => h.level)) === JSON.stringify([1, 2, 3, 2]),
    'extractHeadings: preserves heading levels'
  );
  check(headings[1].text === 'First section', 'extractHeadings: preserves heading text');
  check(
    !headings.some(h => h.text === 'Some text.'),
    'extractHeadings: ignores normal text'
  );
  check(
    headings.every(h => typeof h.line === 'number'),
    'extractHeadings: records line numbers'
  );
}

// CRLF tolerance
{
  const headings = extractHeadings('# Heading\r\n\r\n## Sub\r\n');
  check(headings.length === 2, 'extractHeadings: handles CRLF line endings');
}

// ---------------------------------------------------------------------------
// extractSections
// ---------------------------------------------------------------------------

{
  const sections = extractSections(`
# Title

intro

## First

content

## Second

more content
`);

  check(sections.length === 3, 'extractSections: extracts sections');
  check(
    JSON.stringify(sections.map(s => s.level)) === JSON.stringify([1, 2, 2]),
    'extractSections: records section levels'
  );
  check(
    sections.every(s => s.lineCount > 0),
    'extractSections: records positive line counts'
  );
  check(
    sections[0].startLine < sections[1].startLine,
    'extractSections: sections are in document order'
  );
}

// Duplicate headings
{
  const sections = extractSections(`
# Introduction

First intro.

## Details

First details.

## Details

Second details.
`);

  check(
    sections[1].startLine !== sections[2].startLine,
    'extractSections: handles duplicate heading text (distinct startLines)'
  );
  check(
    sections[1].startLine < sections[2].startLine,
    'extractSections: preserves order for duplicates'
  );
}

// ---------------------------------------------------------------------------
// compareStructure
// ---------------------------------------------------------------------------

{
  const comparison = compareStructure(
    `
# English
## One
## Two
### Three
`,
    `
# Turkish
## Bir
## Iki
`
  );

  check(
    comparison.covered === 3 && comparison.total === 4,
    'compareStructure: counts covered sections by level-ordinal matching'
  );
  check(comparison.coverage === 0.75, 'compareStructure: calculates coverage ratio');
  check(comparison.missing.length === 1, 'compareStructure: reports missing sections');
  check(
    comparison.missing[0].text === 'Three',
    'compareStructure: names the missing canonical section'
  );
  check(
    comparison.missing[0].level === 3,
    'compareStructure: reports the missing section level'
  );
}

// Empty canonical
{
  const r = compareStructure('', '# Translation');
  check(
    r.covered === 0 && r.total === 0 && r.coverage === 1,
    'compareStructure: treats empty canonical as 100% (nothing to cover)'
  );
}

// Perfect match
{
  const same = `# A\n## B\n## C\n`;
  const r = compareStructure(same, same);
  check(r.coverage === 1, 'compareStructure: 100% coverage for identical structure');
  check(r.missing.length === 0, 'compareStructure: no missing sections for identical structure');
}

// All missing
{
  const r = compareStructure('# A\n## B\n', '');
  check(r.covered === 0, 'compareStructure: covered=0 when translation is empty');
  check(r.missing.length === 2, 'compareStructure: reports all sections as missing for empty translation');
}

// Extra sections in translation don't inflate coverage
{
  const r = compareStructure('# A\n## B\n', '# X\n## Y\n## Z\n### Q\n');
  check(r.covered === 2 && r.total === 2, 'compareStructure: extra translated headings do not inflate covered count');
}

// ---------------------------------------------------------------------------
// parseReadmeMapping
// ---------------------------------------------------------------------------

{
  const tmp = mkdtempSync(join(tmpdir(), 'i18n-drift-test-'));
  const readmePath = join(tmp, 'README.md');
  writeFileSync(readmePath, `# Lang modes

| File | Source | Purpose |
|------|--------|---------|
| \`is-ilani.md\` | \`modes/oferta.md\` (ES) | Full evaluation |
| \`basvuru.md\` | \`modes/apply.md\` (EN) | Application assistant |
| \`pipeline.md\` | \`modes/pipeline.md\` (ES) | Pipeline |
| \`_shared.md\` | \`modes/_shared.md\` (EN) | Shared context |
`);

  const map = parseReadmeMapping(readmePath);
  check(map.get('is-ilani.md') === 'oferta.md', 'parseReadmeMapping: resolves localized name → canonical');
  check(map.get('basvuru.md') === 'apply.md', 'parseReadmeMapping: resolves second entry');
  check(map.get('pipeline.md') === 'pipeline.md', 'parseReadmeMapping: same-name entry is handled');
  check(map.get('_shared.md') === '_shared.md', 'parseReadmeMapping: _shared.md entry is handled');
  check(!map.has('README.md'), 'parseReadmeMapping: skips README.md entries');
}

// Missing README
{
  const map = parseReadmeMapping('/nonexistent/path/README.md');
  check(map.size === 0, 'parseReadmeMapping: returns empty map when README does not exist');
}

// ---------------------------------------------------------------------------
// resolveCanonical
// ---------------------------------------------------------------------------

{
  const tmp = mkdtempSync(join(tmpdir(), 'i18n-resolve-test-'));
  // We cannot easily mock the ROOT filesystem in-process, so we test the
  // README-map branch directly:
  const fakeMap = new Map([
    ['is-ilani.md', 'oferta.md'],
    ['pipeline.md', 'pipeline.md'],
  ]);

  check(
    resolveCanonical('is-ilani.md', fakeMap) === 'oferta.md',
    'resolveCanonical: uses README mapping'
  );
  check(
    resolveCanonical('pipeline.md', fakeMap) === 'pipeline.md',
    'resolveCanonical: same-name mapping'
  );
  check(
    resolveCanonical('README.md', fakeMap) === null,
    'resolveCanonical: returns null for README.md'
  );
  // File not in map and not in canonical root (fabricated name)
  check(
    resolveCanonical('fabricated-XYZ.md', new Map()) === null,
    'resolveCanonical: returns null when no mapping and no canonical file found'
  );
  // File not in map but exists in canonical root
  check(
    resolveCanonical('_shared.md', new Map()) === '_shared.md',
    'resolveCanonical: falls back to filename identity for same-name canonical files'
  );
}

// ---------------------------------------------------------------------------
// discoverLangs
// ---------------------------------------------------------------------------

{
  const langs = discoverLangs();
  check(Array.isArray(langs), 'discoverLangs: returns an array');
  check(langs.length > 0, 'discoverLangs: finds at least one language directory');
  check(langs.includes('tr'), 'discoverLangs: includes Turkish (tr)');
  check(langs.includes('de'), 'discoverLangs: includes German (de)');
  check(langs.includes('fr'), 'discoverLangs: includes French (fr)');
  check(!langs.includes('heuristics'), 'discoverLangs: excludes heuristics (non-lang dir)');
  check(!langs.includes('interview'), 'discoverLangs: excludes interview (non-lang dir)');
  check(!langs.includes('pdf'), 'discoverLangs: excludes pdf (non-lang dir)');
  check(!langs.includes('regional'), 'discoverLangs: excludes regional (non-lang dir)');
  // Result must be sorted
  const sorted = [...langs].sort();
  check(
    JSON.stringify(langs) === JSON.stringify(sorted),
    'discoverLangs: returns languages in sorted order'
  );
}

// ---------------------------------------------------------------------------
// checkLang (integration — uses real modes/ files)
// ---------------------------------------------------------------------------

{
  const result = checkLang('tr');
  check(result.lang === 'tr', 'checkLang(tr): result.lang is "tr"');
  check(Array.isArray(result.files), 'checkLang(tr): result.files is an array');

  const checkedFiles = result.files.filter(f => !f.skipped);
  check(checkedFiles.length > 0, 'checkLang(tr): at least one file is checked (not all skipped)');

  for (const f of checkedFiles) {
    check(
      typeof f.result.covered === 'number',
      `checkLang(tr) ${f.translated}: result.covered is a number`
    );
    check(
      f.result.coverage >= 0 && f.result.coverage <= 1,
      `checkLang(tr) ${f.translated}: coverage is between 0 and 1`
    );
  }

  // _shared.md should map to _shared.md (same filename, exists in canonical root)
  const sharedEntry = result.files.find(f => f.translated === '_shared.md');
  if (sharedEntry) {
    check(
      sharedEntry.canonical === '_shared.md',
      'checkLang(tr): _shared.md maps to canonical _shared.md'
    );
    check(!sharedEntry.skipped, 'checkLang(tr): _shared.md is not skipped');
  }
}

// Verify German too
{
  const result = checkLang('de');
  const checked = result.files.filter(f => !f.skipped);
  check(checked.length > 0, 'checkLang(de): at least one file is checked');
  check(
    checked.every(f => f.result && typeof f.result.coverage === 'number'),
    'checkLang(de): all checked files have numeric coverage'
  );
}

// ---------------------------------------------------------------------------
// toJSON
// ---------------------------------------------------------------------------

{
  const fakeResults = [
    {
      lang: 'xx',
      files: [
        {
          translated: 'foo.md',
          canonical: 'bar.md',
          skipped: false,
          result: { covered: 3, total: 4, coverage: 0.75, missing: [{ text: 'M', level: 2 }] },
        },
        {
          translated: 'baz.md',
          canonical: null,
          skipped: true,
          skipReason: 'no canonical mapping found',
          result: null,
        },
      ],
    },
  ];

  const json = toJSON(fakeResults);
  check(Array.isArray(json), 'toJSON: returns array');
  check(json[0].lang === 'xx', 'toJSON: preserves lang');
  check(json[0].files[0].coveragePct === 75, 'toJSON: converts coverage to percentage');
  check(json[0].files[0].missing[0].text === 'M', 'toJSON: includes missing sections');
  check(json[0].files[1].skipped === true, 'toJSON: marks skipped files');
  check(json[0].files[1].coveragePct === null, 'toJSON: null coveragePct for skipped files');
  check(json[0].summary.sectionsTotal === 4, 'toJSON: summary sectionsTotal');
  check(json[0].summary.sectionsCovered === 3, 'toJSON: summary sectionsCovered');
  check(json[0].summary.coveragePct === 75, 'toJSON: summary coveragePct');
  check(json[0].summary.filesChecked === 1, 'toJSON: summary filesChecked counts non-skipped');
}

// ---------------------------------------------------------------------------
// formatReport
// ---------------------------------------------------------------------------

{
  const fakeResults = [
    {
      lang: 'xx',
      files: [
        {
          translated: 'test.md',
          canonical: 'source.md',
          skipped: false,
          result: {
            covered: 2,
            total: 4,
            coverage: 0.5,
            missing: [{ text: 'Section A', level: 2 }, { text: 'Section B', level: 3 }],
          },
        },
      ],
    },
  ];

  const report = formatReport(fakeResults, { threshold: 0.8 });
  check(typeof report === 'string', 'formatReport: returns a string');
  check(report.includes('XX'), 'formatReport: includes language code');
  check(report.includes('2/4'), 'formatReport: shows covered/total');
  check(report.includes('50%'), 'formatReport: shows percentage');
  check(report.includes('Section A'), 'formatReport: lists missing section names');
  check(report.includes('Section B'), 'formatReport: lists all missing sections');
  check(report.includes('✗'), 'formatReport: marks files below threshold with ✗');

  // Above threshold → ✓
  const report2 = formatReport([
    {
      lang: 'yy',
      files: [{
        translated: 'ok.md',
        canonical: 'ok.md',
        skipped: false,
        result: { covered: 4, total: 4, coverage: 1, missing: [] },
      }],
    },
  ], { threshold: 0.8 });
  check(report2.includes('✓'), 'formatReport: marks files above threshold with ✓');
}
