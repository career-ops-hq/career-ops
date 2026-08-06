// tests/cv-alignment-fallbacks.test.mjs -- the certification and award partials
// declare EMPTY fallbacks so a row missing an org or a year still emits an
// empty <span>, keeping the table columns aligned.
//
// #2486: those fallbacks never fired. parsePartial() derives a block's base
// name with `name.slice(0, -6)`, stripping the literal "_EMPTY" suffix, so
// <!--ORG_EMPTY--> resolved to base "ORG" -- an orphan -- while the renderer
// looks up "ORG_BLOCK". Renaming the markers to ORG_BLOCK_EMPTY /
// YEAR_BLOCK_EMPTY makes the derived base match.
//
// The bug survived a self-test that claimed to cover this case, because the
// assertion was `includes('class="cert-org"')` and the fixture's *other* row
// has an org. This test asserts on the empty span itself, and on the span
// COUNT, so it fails if either row stops rendering.
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, ROOT, NODE, run, lastRunFailure } from './helpers.mjs';

console.log('\nbuild-cv-html.mjs -- absent org/year still emit an aligned empty span');

const SECTIONS = [
  { key: 'certifications', cls: 'cert' },
  { key: 'awards', cls: 'award' },
];

const dir = mkdtempSync(join(tmpdir(), 'cv-align-'));
const src = join(dir, 'profile.json');
const out = join(dir, 'cv.html');

// One row missing org+year, one row with both: the mixed case from the issue.
writeFileSync(src, JSON.stringify({
  name: 'Alignment Probe',
  title: 'Engineer',
  certifications: [{ title: 'No Org Cert' }, { title: 'With Org', org: 'CNCF', year: '2025' }],
  awards: [{ title: 'No Org Award' }, { title: 'With Org Award', org: 'ACM', year: '2024' }],
}));

// run() returns the child's stdout on success and null on failure.
const r = run(NODE, ['build-cv-html.mjs', src, out], { cwd: ROOT });
if (r === null) {
  const d = lastRunFailure();
  fail(`build-cv-html.mjs crashed (status ${d?.status}): ${(d?.stderr || '').trim().slice(0, 200)}`);
} else {
  const html = readFileSync(out, 'utf-8');
  for (const { key, cls } of SECTIONS) {
    for (const field of ['org', 'year']) {
      const span = `${cls}-${field}`;
      const total = (html.match(new RegExp(`class="${span}"`, 'g')) || []).length;
      const empty = (html.match(new RegExp(`<span class="${span}"></span>`, 'g')) || []).length;
      if (total === 2 && empty === 1) {
        pass(`${key}: both rows emit a ${span} span, one of them the empty fallback`);
      } else {
        fail(`${key}: expected 2 ${span} spans with 1 empty, got ${total} spans / ${empty} empty`);
      }
    }
  }
}

rmSync(dir, { recursive: true, force: true });
