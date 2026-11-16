// tests/cv-template-slot-warnings.test.mjs — a populated section the chosen
// template cannot render is reported, never dropped in silence.
//
// UNRENDERED_SECTIONS (lib/cv-payload-schema.mjs) is keyed by FORMAT, and for
// html it is empty. But whether a section renders is a property of the
// TEMPLATE: build-cv-html fills only the slots it finds. Of the shipped HTML
// templates only cv-template.html has an interests slot, and the ATS and
// zh-minimal templates have no consent slot, so interests (and the
// GDPR/RODO consent clause some markets expect on a CV) vanished with
// warnings: [] and valid: true. The Markdown output drops them the same way.
//
// So for every shipped template, in both outputs: each populated section
// either appears in the output or is named in a warning, never neither, and
// never a warning for one that rendered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTree } from '../lib/walk-tree.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// A marker per section, so "rendered" is a substring check on the output.
const MARKERS = {
  interests: 'Zzinterestmarker',
  consent: 'Zzconsentmarker',
  summary: 'Zzsummarymarker',
  competencies: 'Zzcompetencymarker',
};

const payload = {
  lang: 'en',
  page_format: 'a4',
  candidate: { name: 'Test Candidate', email: 't@example.com' },
  summary: `Backend engineer ${MARKERS.summary}.`,
  competencies: [MARKERS.competencies],
  projects: [], education: [], certifications: [], awards: [],
  skills: [{ category: 'Languages', items: ['Go'] }],
  interests: [MARKERS.interests, 'Chess'],
  consent: `I consent to the processing of my data ${MARKERS.consent}.`,
  experience: [{ company: 'Acme', role: 'Engineer', dates: '2024', bullets: ['Did a thing'] }],
};

const templates = listTree(join(ROOT, 'templates'), { match: /cv-template[^/\\]*\.html$/ })
  .map((abs) => relative(ROOT, abs));

function build(template, markdown) {
  const dir = mkdtempSync(join(tmpdir(), 'cv-slot-'));
  try {
    const input = join(dir, 'p.json');
    const out = join(dir, markdown ? 'out.md' : 'out.html');
    writeFileSync(input, JSON.stringify(payload));
    const args = markdown
      ? [join(ROOT, 'build-cv-html.mjs'), input, '--markdown', out, join(ROOT, template)]
      : [join(ROOT, 'build-cv-html.mjs'), input, out, join(ROOT, template)];
    const report = JSON.parse(execFileSync(process.execPath, args, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    }));
    return { output: readFileSync(out, 'utf-8'), warnings: report.warnings || [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('premise: the shipped templates include one with an interests slot and one without', () => {
  assert.ok(templates.length >= 2, `found only ${templates.join(', ')}`);
  const withSlot = templates.filter((t) => readFileSync(join(ROOT, t), 'utf-8').includes('{{INTERESTS}}'));
  assert.ok(withSlot.length > 0 && withSlot.length < templates.length, `interests slots: ${withSlot.join(', ')}`);
});

for (const markdown of [false, true]) {
  const kind = markdown ? 'markdown' : 'html';
  test(`${kind}: every populated section either renders or is named in a warning, for every shipped template`, () => {
    const problems = [];
    for (const template of templates) {
      const { output, warnings } = build(template, markdown);
      for (const [section, marker] of Object.entries(MARKERS)) {
        const rendered = output.includes(marker);
        const warned = warnings.some((w) => w.startsWith(`${section}: `));
        if (!rendered && !warned) problems.push(`${template}: ${section} dropped with no warning`);
        if (rendered && warned) problems.push(`${template}: ${section} rendered but was warned about`);
      }
    }
    assert.deepEqual(problems, []);
  });
}

test('the ATS template names both sections it drops', () => {
  const { warnings } = build('templates/ats/cv-template.ats.html', false);
  assert.ok(warnings.some((w) => /^interests: cv-template\.ats\.html has no interests section — 2 entries will not appear/.test(w)), warnings.join('\n'));
  assert.ok(warnings.some((w) => /^consent: cv-template\.ats\.html has no consent section/.test(w)), warnings.join('\n'));
});
