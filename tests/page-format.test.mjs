/**
 * page-format.test.mjs — paper size has one owner (lib/page-format.mjs).
 *
 * The size a document is laid out at and the size of the sheet it prints on used
 * to be decided in four separate places, and they disagreed. build-cv-html.mjs
 * fell back to letter's 8.5in body width; generate-pdf.mjs and
 * generate-cover-letter.mjs each fell back to a4. A payload declaring
 * `page_format: "letter"` therefore rendered a letter-width CV onto an A4 sheet,
 * and modes/pdf.md had to instruct the user to "Pass the SAME value" twice by
 * hand.
 *
 * Every test here observes a real seam: the exported @page injector, the two
 * renderer CLIs, and the resolver itself. The last one is a source check,
 * because "no renderer keeps its own fallback" is the property that stops the
 * drift coming back and no behavioural assertion can express it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, NODE } from './helpers.mjs';
import { injectPrintPageCss } from '../generate-pdf.mjs';
import {
  DEFAULT_PAGE_FORMAT,
  PAGE_CSS_SIZE,
  PAGE_FORMATS,
  PAGE_WIDTHS,
  normalizePageFormat,
  resolvePageFormat,
} from '../lib/page-format.mjs';

/** A throwaway workspace whose config/profile.yml states `pageFormat`, or none. */
function workspace(pageFormat) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-page-format-'));
  mkdirSync(join(dir, 'config'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'output'), { recursive: true });
  writeFileSync(
    join(dir, 'config', 'profile.yml'),
    pageFormat == null ? 'name: Test Candidate\n' : `name: Test Candidate\npage_format: ${pageFormat}\n`,
  );
  return dir;
}

function workspaceEnv(dir) {
  return {
    ...process.env,
    CAREER_OPS_ROOT: dir,
    CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md'),
  };
}

const PAYLOAD = {
  lang: 'en',
  candidate: { name: 'Test Candidate', email: 'test@example.com', location: 'City, State' },
  summary: 'Backend engineer with a focus on cost-efficient systems.',
  competencies: ['Cloud Architecture'],
  experience: [{
    company: 'Test Corp',
    role: 'Test Engineer',
    location: 'Remote',
    dates: 'June 2024 - Present',
    bullets: ['Built automated testing pipelines'],
  }],
  education: [{ title: 'BSc Computer Science', org: 'Test University', year: '2024' }],
  skills: [{ category: 'Languages', items: 'Python' }],
};

// --- the owner itself ---------------------------------------------------

test('resolvePageFormat: an explicit choice outranks the profile', () => {
  const dir = workspace('a4');
  assert.equal(resolvePageFormat('letter', { profilePath: join(dir, 'config', 'profile.yml') }), 'letter');
});

test('resolvePageFormat: the profile outranks the project default', () => {
  const dir = workspace('a4');
  assert.equal(resolvePageFormat(undefined, { profilePath: join(dir, 'config', 'profile.yml') }), 'a4');
});

test('resolvePageFormat: nothing stated falls through to the project default', () => {
  const dir = workspace(null);
  assert.equal(resolvePageFormat(undefined, { profilePath: join(dir, 'config', 'profile.yml') }), DEFAULT_PAGE_FORMAT);
});

test('resolvePageFormat: a missing profile never fails a render', () => {
  assert.equal(resolvePageFormat(undefined, { profilePath: join(tmpdir(), 'career-ops-absent.yml') }), DEFAULT_PAGE_FORMAT);
});

test('resolvePageFormat: an unusable profile value falls through, it does not stick', () => {
  const dir = workspace('foolscap');
  assert.equal(resolvePageFormat(undefined, { profilePath: join(dir, 'config', 'profile.yml') }), DEFAULT_PAGE_FORMAT);
});

test('normalizePageFormat: forgives case and padding, rejects everything else', () => {
  assert.equal(normalizePageFormat(' A4 '), 'a4');
  assert.equal(normalizePageFormat('Letter'), 'letter');
  assert.equal(normalizePageFormat('legal'), null);
  assert.equal(normalizePageFormat(4), null);
  assert.equal(normalizePageFormat(undefined), null);
});

test('every accepted format has a body width and a @page keyword', () => {
  for (const format of PAGE_FORMATS) {
    assert.ok(PAGE_WIDTHS[format], `no PAGE_WIDTHS entry for ${format}`);
    assert.ok(PAGE_CSS_SIZE[format], `no PAGE_CSS_SIZE entry for ${format}`);
  }
  assert.ok(PAGE_FORMATS.has(DEFAULT_PAGE_FORMAT));
});

// --- the four consumers -------------------------------------------------

test('injectPrintPageCss: the flagless sheet comes from the resolver', () => {
  // injectPrintPageCss anchors the profile to the tracker workspace, which is
  // this checkout. Asserting DEFAULT_PAGE_FORMAT outright would fail for anyone
  // whose own config/profile.yml sets a4, so expect what the resolver answers
  // for that same file.
  const expected = resolvePageFormat(undefined, { profilePath: join(ROOT, 'config', 'profile.yml') });
  const html = injectPrintPageCss('<html><head></head><body></body></html>');
  assert.match(html, new RegExp(`@page \\{ size: ${PAGE_CSS_SIZE[expected]};`));
});

test('injectPrintPageCss: an explicit format still wins', () => {
  assert.match(injectPrintPageCss('<html><head></head></html>', 'a4'), /@page \{ size: A4;/);
  assert.match(injectPrintPageCss('<html><head></head></html>', 'letter'), /@page \{ size: Letter;/);
});

test('build-cv-html: a payload with no page_format takes the profile width', () => {
  const dir = workspace('a4');
  const payloadPath = join(dir, 'payload.json');
  writeFileSync(payloadPath, JSON.stringify(PAYLOAD));
  const out = join(dir, 'output', 'cv.html');
  const res = spawnSync(NODE, [join(ROOT, 'build-cv-html.mjs'), payloadPath, out], {
    env: workspaceEnv(dir),
    encoding: 'utf-8',
  });
  assert.equal(res.status, 0, res.stderr);
  const html = readFileSync(out, 'utf-8');
  assert.ok(html.includes(PAGE_WIDTHS.a4), `expected the a4 body width ${PAGE_WIDTHS.a4}\n${res.stdout}`);
  assert.ok(!html.includes(PAGE_WIDTHS.letter), 'the letter body width leaked into an a4 render');
});

test('generate-pdf: the flagless CLI takes the profile format', () => {
  // Both directions on purpose. Asserting only the a4 case would pass against
  // the old hardcoded `format = 'a4'` and prove nothing.
  for (const declared of ['letter', 'a4']) {
    const dir = workspace(declared);
    const res = spawnSync(NODE, [join(ROOT, 'generate-pdf.mjs'), join(dir, 'absent.html'), join(dir, 'output', 'cv.pdf')], {
      env: workspaceEnv(dir),
      encoding: 'utf-8',
    });
    assert.match(res.stdout, new RegExp(`📏 Format: ${declared.toUpperCase()}`), res.stdout + res.stderr);
  }
});

test('generate-pdf: an explicit --format still outranks the profile', () => {
  const dir = workspace('a4');
  const res = spawnSync(NODE, [join(ROOT, 'generate-pdf.mjs'), join(dir, 'absent.html'), join(dir, 'output', 'cv.pdf'), '--format=letter'], {
    env: workspaceEnv(dir),
    encoding: 'utf-8',
  });
  assert.match(res.stdout, /📏 Format: LETTER/, res.stdout + res.stderr);
});

test('generate-pdf: an unrecognized --format is still a hard error', () => {
  const dir = workspace(null);
  const res = spawnSync(NODE, [join(ROOT, 'generate-pdf.mjs'), join(dir, 'absent.html'), join(dir, 'output', 'cv.pdf'), '--format=legal'], {
    env: workspaceEnv(dir),
    encoding: 'utf-8',
  });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /Invalid format "legal"/);
});

test('no renderer keeps a page-size fallback of its own', () => {
  const offenders = [];
  for (const file of ['generate-pdf.mjs', 'generate-cover-letter.mjs', 'build-cv-html.mjs']) {
    const src = readFileSync(join(ROOT, file), 'utf-8');
    for (const [i, line] of src.split('\n').entries()) {
      if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue;
      if (/(=|\?\?|\|\|)\s*(['"])(a4|letter)\2/i.test(line) || /PAGE_WIDTHS\.(a4|letter)/.test(line)) {
        offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `page size belongs to lib/page-format.mjs:\n${offenders.join('\n')}`);
});
