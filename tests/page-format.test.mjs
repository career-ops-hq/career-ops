/**
 * page-format.test.mjs — paper size has one owner (lib/page-format.mjs).
 *
 * The size a document is laid out at and the size of the sheet it prints on used
 * to be decided in five separate places, and they disagreed. build-cv-html.mjs
 * fell back to letter's 8.5in body width; generate-pdf.mjs and
 * generate-cover-letter.mjs each fell back to a4. A payload declaring
 * `page_format: "letter"` therefore rendered a letter-width CV onto an A4 sheet,
 * and modes/pdf.md had to instruct the user to "Pass the SAME value" twice by
 * hand.
 *
 * The seams: the module's own constants, the exported @page injector, the three
 * renderer CLIs, and the resolver itself. The last test is a source check,
 * because "no renderer keeps its own fallback" is the property that stops the
 * drift coming back and no behavioural assertion can express it.
 *
 * Expected page sizes are written out as literals. An assertion that reads its
 * expected value back out of the module it pins compares that module to itself
 * and stays green whatever the module becomes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, realpathSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, NODE, linkRepoPackage } from './helpers.mjs';
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

test('the owner pins its own values', () => {
  // Written out, never read back from the module. Reading the expected width
  // out of PAGE_WIDTHS compares the map to itself: with a4 and letter swapped
  // every test here stayed green, and a payload declaring letter then rendered
  // a 210mm body onto an 8.5in sheet. That IS the defect this file exists for.
  assert.deepEqual([...PAGE_FORMATS].sort(), ['a4', 'letter']);
  assert.deepEqual(PAGE_WIDTHS, { a4: '210mm', letter: '8.5in' });
  assert.deepEqual(PAGE_CSS_SIZE, { a4: 'A4', letter: 'Letter' });
  // The project default, as a literal, in the one place no environment can
  // reach it. Everything below ranks it against whatever profile the machine
  // carries, so this line is what stops it drifting back to a4.
  assert.equal(DEFAULT_PAGE_FORMAT, 'letter');
});

test('the web agrees with the CLI about the sheet', async (t) => {
  // web/src/lib/page-formats.mjs keeps its own copy of these two constants, and
  // wiring it to this module means loading it at runtime, so it stays out of
  // scope here. The two agree today and nothing says they still will, which is
  // the drift this file exists to stop, one boundary out. It costs two lines.
  const webOwner = join(ROOT, 'web', 'src', 'lib', 'page-formats.mjs');
  if (!existsSync(webOwner)) return t.skip('this checkout carries no web/');
  const web = await import(pathToFileURL(webOwner).href);
  assert.equal(web.DEFAULT_PAGE_FORMAT, DEFAULT_PAGE_FORMAT);
  assert.deepEqual([...web.PAGE_FORMATS].sort(), [...PAGE_FORMATS].sort());
});

// --- the four consumers -------------------------------------------------

test('injectPrintPageCss: the flagless sheet comes from the profile', () => {
  // A child process, because injectPrintPageCss anchors the profile to
  // workspaceRoot and generate-pdf.mjs fixes that at import. In-process the
  // anchor is this checkout, so the assertion computed its expected value the
  // way the code does. It then agreed with itself: dropping the profilePath
  // option left it green on any machine carrying no config/profile.yml.
  // Both directions, for the same reason the CLI test below runs both. The a4
  // case alone passed against the old hardcoded `format = 'a4'`.
  for (const declared of ['letter', 'a4']) {
    const dir = workspace(declared);
    const probe = join(dir, 'probe.mjs');
    writeFileSync(probe, [
      `import { injectPrintPageCss } from ${JSON.stringify(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href)};`,
      "process.stdout.write(injectPrintPageCss('<html><head></head><body></body></html>'));",
      '',
    ].join('\n'));
    const res = spawnSync(NODE, [probe], { env: workspaceEnv(dir), encoding: 'utf-8' });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`@page \\{ size: ${PAGE_CSS_SIZE[declared]};`), res.stdout + res.stderr);
  }
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

test('build-cv-html: a payload stating its own page_format outranks the profile', () => {
  // The width test above states only the profile tier. Reading a constant in
  // place of payload.page_format ignored payload and profile alike and stayed
  // green, so every CV body went out 210mm while generate-pdf printed the sheet
  // the user asked for. That is the mismatch this PR exists to remove.
  const dir = workspace('a4');
  const payloadPath = join(dir, 'payload.json');
  writeFileSync(payloadPath, JSON.stringify({ ...PAYLOAD, page_format: 'letter' }));
  const out = join(dir, 'output', 'cv.html');
  const res = spawnSync(NODE, [join(ROOT, 'build-cv-html.mjs'), payloadPath, out], {
    env: workspaceEnv(dir),
    encoding: 'utf-8',
  });
  assert.equal(res.status, 0, res.stderr);
  const html = readFileSync(out, 'utf-8');
  assert.ok(html.includes(PAGE_WIDTHS.letter), `expected the letter body width ${PAGE_WIDTHS.letter}\n${res.stdout}`);
  assert.ok(!html.includes(PAGE_WIDTHS.a4), 'the a4 body width leaked into a letter render');
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

/**
 * A throwaway checkout of generate-cover-letter.mjs and its import closure,
 * with generate-pdf.mjs replaced by a recorder.
 *
 * The cover letter imports the renderer lazily, and that import is the one seam
 * where its page-size decision becomes observable without Chromium. CI installs
 * with --ignore-scripts and never downloads a browser, so this suite cannot
 * render a real sheet and read its MediaBox.
 */
function coverSandbox() {
  // realpathSync, not the raw mkdtemp path: isMainModule compares a realpathed
  // import.meta.url against argv[1], and a spawned copy that fails that check
  // exits 0 having done nothing (#3165).
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-cover-format-')));
  mkdirSync(join(dir, 'lib'), { recursive: true });
  mkdirSync(join(dir, 'templates'), { recursive: true });
  mkdirSync(join(dir, 'output'), { recursive: true });
  for (const f of ['generate-cover-letter.mjs', 'verify-cv-facts.mjs', 'cv-templates.mjs', 'path-resolver.mjs']) {
    copyFileSync(join(ROOT, f), join(dir, f));
  }
  copyFileSync(join(ROOT, 'lib', 'is-main-module.mjs'), join(dir, 'lib', 'is-main-module.mjs'));
  // The resolver is here so a cover letter that starts calling it fails on the
  // assertion below and not on a missing module. Resolving early is the quiet
  // form of this bug: it reads no profile path, so every letter gets the
  // project default while its CV keeps the user's configured size.
  copyFileSync(join(ROOT, 'lib', 'page-format.mjs'), join(dir, 'lib', 'page-format.mjs'));
  copyFileSync(
    join(ROOT, 'templates', 'cover-letter-template.html'),
    join(dir, 'templates', 'cover-letter-template.html'),
  );
  // cv-templates.mjs imports js-yaml, which resolves by walking up from the
  // sandbox's realpath and never reaches the repo's node_modules.
  linkRepoPackage(dir, 'js-yaml');
  writeFileSync(join(dir, 'generate-pdf.mjs'), [
    "import { writeFileSync } from 'node:fs';",
    "import { dirname, join } from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    'export async function renderHtmlToPdf(html, outputPath, opts = {}) {',
    "  const here = dirname(fileURLToPath(import.meta.url));",
    "  writeFileSync(join(here, 'render-opts.json'), JSON.stringify({ format: opts.format ?? null }));",
    '  return { outputPath, pageCount: 1, size: 0 };',
    '}',
    '',
  ].join('\n'));
  writeFileSync(join(dir, 'payload.json'), JSON.stringify({
    candidate: { name: 'Test Candidate' },
    letter: {
      role_title: 'Test Engineer',
      opening: 'Opening sentence.',
      profile_intro: 'Profile intro.',
    },
    output_path: 'output/cover.pdf',
  }));
  return dir;
}

test('generate-cover-letter: the sheet is the renderer\'s to choose', () => {
  const dir = coverSandbox();
  const run = (...extra) => {
    const res = spawnSync(
      NODE,
      [join(dir, 'generate-cover-letter.mjs'), '--payload', join(dir, 'payload.json'), ...extra],
      { cwd: dir, encoding: 'utf-8' },
    );
    assert.equal(res.status, 0, res.stdout + res.stderr);
    return JSON.parse(readFileSync(join(dir, 'render-opts.json'), 'utf-8'));
  };
  // Flagless, the CLI states no size, so the letter resolves the same profile
  // its CV did and lands on the same paper. A fallback of its own here is what
  // printed the two on different sheets.
  assert.equal(run().format, null, 'the cover letter chose a paper size of its own');
  // A flag travels unresolved, for the renderer to rank against the profile.
  assert.equal(run('--format', 'a4').format, 'a4');
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
