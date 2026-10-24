/**
 * page-format-auto.test.mjs — `page_format: auto` picks the sheet from the
 * employer's country (#5099).
 *
 * Expected values are literals, never read back out of lib/page-format.mjs: an
 * assertion that reads its answer from the module it pins compares the module to
 * itself and stays green whatever the module becomes (see page-format.test.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, NODE } from './helpers.mjs';
import { toolRequired } from './required-tools.mjs';
import {
  LETTER_COUNTRIES,
  PAGE_FORMATS,
  pageFormatForCountry,
  resolvePageFormat,
} from '../lib/page-format.mjs';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

function workspace(pageFormat) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-page-format-auto-'));
  for (const sub of ['config', 'data', 'output']) mkdirSync(join(dir, sub), { recursive: true });
  writeFileSync(
    join(dir, 'config', 'profile.yml'),
    pageFormat == null ? 'name: Test Candidate\n' : `name: Test Candidate\npage_format: ${pageFormat}\n`,
  );
  return dir;
}

const profileOf = (dir) => join(dir, 'config', 'profile.yml');

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
    company: 'Test Corp', role: 'Test Engineer', location: 'Remote',
    dates: 'June 2024 - Present', bullets: ['Built automated testing pipelines'],
  }],
  education: [{ title: 'BSc Computer Science', org: 'Test University', year: '2024' }],
  skills: [{ category: 'Languages', items: 'Python' }],
};

test('the Letter table is the CLDR paperSize list, pinned', () => {
  // Unicode CLDR common/supplemental/supplementalData.xml, <paperSize
  // type="US-Letter">, read at unicode-org/cldr 86be3214. Written out so a
  // silent edit to the table fails here.
  assert.deepEqual(
    [...LETTER_COUNTRIES].sort(),
    ['BZ', 'CA', 'CL', 'CO', 'CR', 'GT', 'MX', 'NI', 'PA', 'PH', 'PR', 'SV', 'US', 'VE'],
  );
});

test('auto is not a sheet: PAGE_FORMATS still holds only a4 and letter', () => {
  assert.deepEqual([...PAGE_FORMATS].sort(), ['a4', 'letter']);
});

test('pageFormatForCountry: a Letter country maps to letter, any other to a4', () => {
  for (const code of ['US', 'CA', 'MX', 'PH', 'VE']) assert.equal(pageFormatForCountry(code), 'letter', code);
  for (const code of ['DE', 'GB', 'FR', 'JP', 'AU', 'BR', 'IN']) assert.equal(pageFormatForCountry(code), 'a4', code);
});

test('pageFormatForCountry: forgives case and padding', () => {
  assert.equal(pageFormatForCountry(' us '), 'letter');
  assert.equal(pageFormatForCountry('de'), 'a4');
});

test('pageFormatForCountry: an unusable country is null, not a guess', () => {
  for (const bad of [undefined, null, '', 'U', 'USA', 'Germany', 'U1', 42, {}]) {
    assert.equal(pageFormatForCountry(bad), null, String(bad));
  }
});

test('resolvePageFormat: profile auto follows the country', () => {
  const p = profileOf(workspace('auto'));
  assert.equal(resolvePageFormat(undefined, { profilePath: p, country: 'DE' }), 'a4');
  assert.equal(resolvePageFormat(undefined, { profilePath: p, country: 'US' }), 'letter');
  assert.equal(resolvePageFormat(undefined, { profilePath: p, country: 'mx' }), 'letter');
});

test('resolvePageFormat: profile auto with an unknown country takes the project default', () => {
  const p = profileOf(workspace(' Auto '));
  assert.equal(resolvePageFormat(undefined, { profilePath: p }), 'letter');
  assert.equal(resolvePageFormat(undefined, { profilePath: p, country: 'Germany' }), 'letter');
});

test('resolvePageFormat: an explicit sheet outranks auto', () => {
  const p = profileOf(workspace('auto'));
  assert.equal(resolvePageFormat('a4', { profilePath: p, country: 'US' }), 'a4');
  assert.equal(resolvePageFormat('letter', { profilePath: p, country: 'DE' }), 'letter');
});

test('resolvePageFormat: an explicit auto outranks a concrete profile', () => {
  const p = profileOf(workspace('letter'));
  assert.equal(resolvePageFormat('auto', { profilePath: p, country: 'DE' }), 'a4');
});

test('resolvePageFormat: a country changes nothing unless auto is asked for', () => {
  const a4 = profileOf(workspace('a4'));
  assert.equal(resolvePageFormat(undefined, { profilePath: a4, country: 'US' }), 'a4');
  const none = profileOf(workspace(null));
  assert.equal(resolvePageFormat(undefined, { profilePath: none, country: 'DE' }), 'letter');
});

test('injectPrintPageCss: auto picks the sheet from the country', () => {
  const cases = [['DE', 'A4'], ['US', 'Letter'], [undefined, 'Letter']];
  for (const [country, sheet] of cases) {
    const dir = workspace('auto');
    const probe = join(dir, 'probe.mjs');
    writeFileSync(probe, [
      `import { injectPrintPageCss } from ${JSON.stringify(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href)};`,
      `process.stdout.write(injectPrintPageCss('<html><head></head><body></body></html>', undefined, ${JSON.stringify(country)}));`,
      '',
    ].join('\n'));
    const res = spawnSync(NODE, [probe], { env: workspaceEnv(dir), encoding: 'utf-8' });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`@page \\{ size: ${sheet};`), `${country}: ${res.stdout}${res.stderr}`);
  }
});

test('build-cv-html: country is a known payload key, not a typo to warn about', () => {
  const dir = workspace('auto');
  const payloadPath = join(dir, 'payload.json');
  writeFileSync(payloadPath, JSON.stringify({ ...PAYLOAD, country: 'DE' }));
  const res = spawnSync(NODE, [join(ROOT, 'build-cv-html.mjs'), payloadPath, join(dir, 'output', 'cv.html')], {
    env: workspaceEnv(dir), encoding: 'utf-8',
  });
  assert.equal(res.status, 0, res.stderr);
  assert.doesNotMatch(res.stderr + res.stdout, /country/i);
});

function buildHtml(dir, payload) {
  const payloadPath = join(dir, 'payload.json');
  writeFileSync(payloadPath, JSON.stringify(payload));
  const out = join(dir, 'output', 'cv.html');
  const res = spawnSync(NODE, [join(ROOT, 'build-cv-html.mjs'), payloadPath, out], {
    env: workspaceEnv(dir), encoding: 'utf-8',
  });
  assert.equal(res.status, 0, res.stderr);
  return readFileSync(out, 'utf-8');
}

test('build-cv-html: under auto, the payload country sets the body width', () => {
  const de = buildHtml(workspace('auto'), { ...PAYLOAD, country: 'DE' });
  assert.ok(de.includes('210mm'), 'expected the a4 body width');
  assert.ok(!de.includes('8.5in'), 'the letter width leaked into a DE render');
  const us = buildHtml(workspace('auto'), { ...PAYLOAD, country: 'US' });
  assert.ok(us.includes('8.5in'), 'expected the letter body width');
  assert.ok(!us.includes('210mm'), 'the a4 width leaked into a US render');
});

test('build-cv-html: a payload country is ignored when the profile states a sheet', () => {
  const html = buildHtml(workspace('letter'), { ...PAYLOAD, country: 'DE' });
  assert.ok(html.includes('8.5in'));
  assert.ok(!html.includes('210mm'));
});

function runPdf(dir, ...flags) {
  return spawnSync(NODE, [join(ROOT, 'generate-pdf.mjs'), join(dir, 'absent.html'), join(dir, 'output', 'cv.pdf'), ...flags], {
    env: workspaceEnv(dir), encoding: 'utf-8',
  });
}

test('generate-pdf: --country feeds auto', () => {
  const de = runPdf(workspace('auto'), '--country=DE');
  assert.match(de.stdout, /📏 Format: A4/, de.stdout + de.stderr);
  const us = runPdf(workspace('auto'), '--country=us');
  assert.match(us.stdout, /📏 Format: LETTER/, us.stdout + us.stderr);
});

test('generate-pdf: --format still outranks auto and --country', () => {
  const res = runPdf(workspace('auto'), '--country=DE', '--format=letter');
  assert.match(res.stdout, /📏 Format: LETTER/, res.stdout + res.stderr);
});

test('generate-pdf: a bare --country with no value fails instead of being dropped', () => {
  const res = runPdf(workspace('auto'), '--country');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Invalid country ""/);
});

test('generate-pdf: a malformed --country fails loudly, like a bad --format', () => {
  const res = runPdf(workspace('auto'), '--country=Germany');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Invalid country "Germany"/);
});

// --- renders ------------------------------------------------------------

const HTML = '<html><head></head><body><p>Hello</p></body></html>';

test('renderHtmlToPdf: auto records the sheet the country calls for', () => {
  // A stub browser, because the CI test job installs no Chromium. The real
  // resolver, the @page injection and the manifest write all run; the manifest
  // row's format column is where the chosen sheet is observable.
  for (const [country, sheet] of [['DE', 'a4'], ['US', 'letter'], [undefined, 'letter']]) {
    const dir = workspace('auto');
    const probe = join(dir, 'probe.mjs');
    writeFileSync(probe, `
      import { renderHtmlToPdf } from ${JSON.stringify(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href)};
      const stub = async () => ({
        async newPage() {
          return {
            async goto() {}, async evaluate() {},
            async pdf() {
              return Buffer.from('%PDF-1.7\\n1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj\\n'
                + '2 0 obj\\n<< /Type /Pages /Count 1 >>\\nendobj\\n%%EOF');
            },
          };
        },
        async close() {},
      });
      await renderHtmlToPdf(${JSON.stringify(HTML)}, ${JSON.stringify(join(dir, 'output', 'out.pdf'))},
        { country: ${JSON.stringify(country)}, kind: 'cover', inputPath: ${JSON.stringify(join(dir, 'p.json'))}, launchBrowser: stub });
    `);
    const res = spawnSync(NODE, [probe], { env: workspaceEnv(dir), encoding: 'utf-8' });
    assert.equal(res.status, 0, res.stderr + res.stdout);
    const rows = readFileSync(join(dir, 'data', 'pdf-index.tsv'), 'utf-8').split('\n').filter((l) => l && !l.startsWith('#'));
    assert.equal(rows.length, 1, rows.join('\n'));
    assert.equal(rows[0].split('\t')[3], sheet, `${country}: ${rows[0]}`);
  }
});

// The batch CLI cannot take a stub browser, so these need a real Chromium and
// skip where none is installed, except where the browser is required
// (`test-all.mjs --needs browser`). The sheet is the PDF's MediaBox: 595x842pt
// is A4, 612x792pt is Letter.
const chromiumReady = (() => {
  const res = spawnSync(NODE, ['-e',
    "import('playwright').then(async ({chromium})=>{const b=await chromium.launch();await b.close();console.log('READY')}).catch(()=>{})",
  ], { cwd: ROOT, encoding: 'utf-8' });
  return res.stdout.includes('READY');
})();
const browserSkip = !toolRequired('browser') && !chromiumReady && 'no Chromium';

function mediaBox(pdfPath) {
  const m = readFileSync(pdfPath, 'latin1').match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  assert.ok(m, `no MediaBox in ${pdfPath}`);
  return `${Math.round(Number(m[1]))}x${Math.round(Number(m[2]))}`;
}

function runBatch(dir, entries) {
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(entries));
  return spawnSync(NODE, [join(ROOT, 'generate-pdf.mjs'), `--batch=${join(dir, 'manifest.json')}`], {
    env: workspaceEnv(dir), encoding: 'utf-8',
  });
}

function runBatchWithFlags(dir, entries, ...flags) {
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(entries));
  return spawnSync(NODE, [join(ROOT, 'generate-pdf.mjs'), `--batch=${join(dir, 'manifest.json')}`, ...flags], {
    env: workspaceEnv(dir), encoding: 'utf-8',
  });
}

function entry(dir, name, extra = {}) {
  writeFileSync(join(dir, `${name}.html`), HTML);
  return { input: join(dir, `${name}.html`), output: join(dir, 'output', `${name}.pdf`), kind: 'cover', ...extra };
}

test('generate-pdf --batch: each entry takes its own country under auto', { skip: browserSkip }, () => {
  const dir = workspace('auto');
  const res = runBatch(dir, [entry(dir, 'de', { country: 'DE' }), entry(dir, 'us', { country: 'US' }), entry(dir, 'none')]);
  assert.equal(res.status, 0, res.stderr + res.stdout);
  assert.equal(mediaBox(join(dir, 'output', 'de.pdf')), '595x842');
  assert.equal(mediaBox(join(dir, 'output', 'us.pdf')), '612x792');
  assert.equal(mediaBox(join(dir, 'output', 'none.pdf')), '612x792');
});

test('generate-pdf --batch: a malformed entry country fails that entry only', { skip: browserSkip }, () => {
  const dir = workspace('auto');
  const res = runBatch(dir, [entry(dir, 'a', { country: 'Germany' }), entry(dir, 'b', { country: 'DE' })]);
  assert.ok(exitedNonZero(res), describeSpawn(res, 'expected a non-zero exit'));
  assert.match(res.stderr + res.stdout, /invalid country "Germany"/);
  assert.equal(mediaBox(join(dir, 'output', 'b.pdf')), '595x842');
});

test('generate-cover-letter: the payload country steers auto, and --country outranks it', { skip: browserSkip }, () => {
  const letter = {
    role_title: 'Head of Marketing', opening: 'Opening line.', profile_intro: 'Profile intro.',
    company: 'Example Corp', city: 'Berlin', date: 'September 8, 2026',
  };
  const cases = [
    { payloadCountry: 'DE', flag: [], box: '595x842' },
    { payloadCountry: 'US', flag: [], box: '612x792' },
    { payloadCountry: 'DE', flag: ['--country=US'], box: '612x792' },
  ];
  cases.forEach(({ payloadCountry, flag, box }, i) => {
    const dir = workspace('auto');
    const payloadPath = join(dir, 'payload.json');
    writeFileSync(payloadPath, JSON.stringify({
      candidate: { name: 'A Candidate' }, letter, country: payloadCountry, output_path: `output/cover-${i}.pdf`,
    }));
    const res = spawnSync(NODE, [join(ROOT, 'generate-cover-letter.mjs'), '--payload', payloadPath, ...flag], {
      env: workspaceEnv(dir), encoding: 'utf-8',
    });
    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.equal(mediaBox(join(dir, 'output', `cover-${i}.pdf`)), box, `${payloadCountry} ${flag}`);
  });
});

test('generate-pdf: --country keeps everything after the prefix, so DE=US is rejected', () => {
  const res = runPdf(workspace('auto'), '--country=DE=US');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Invalid country "DE=US"/);
});

function runCover(flags) {
  const dir = workspace('auto');
  const payloadPath = join(dir, 'payload.json');
  writeFileSync(payloadPath, JSON.stringify({
    candidate: { name: 'A Candidate' },
    letter: { role_title: 'Head of Marketing', opening: 'Opening line.', profile_intro: 'Profile intro.', company: 'Example Corp', city: 'Berlin', date: 'September 8, 2026' },
    country: 'DE', output_path: 'output/cover.pdf',
  }));
  return spawnSync(NODE, [join(ROOT, 'generate-cover-letter.mjs'), '--payload', payloadPath, ...flags], {
    env: workspaceEnv(dir), encoding: 'utf-8',
  });
}

test('generate-cover-letter: a malformed or empty --country fails loudly', () => {
  for (const flag of ['--country=Germany', '--country=DE=US', '--country=']) {
    const res = runCover([flag]);
    assert.equal(res.status, 1, flag + res.stdout);
    assert.match(res.stderr, /Invalid country/, flag);
  }
});

test('generate-cover-letter: --format takes only a4 or letter, never auto', () => {
  for (const flag of ['--format=auto', '--format=legal']) {
    const res = runCover([flag]);
    assert.equal(res.status, 1, flag + res.stdout);
    assert.match(res.stderr, /Invalid format/, flag);
  }
});

test('generate-pdf --batch: a global --country covers an entry with none, and an entry format still wins', { skip: browserSkip }, () => {
  const dir = workspace('auto');
  const res = runBatchWithFlags(dir, [
    entry(dir, 'bare'),
    entry(dir, 'own', { country: 'US' }),
    entry(dir, 'fmt', { format: 'letter' }),
  ], '--country=DE');
  assert.equal(res.status, 0, res.stderr + res.stdout);
  assert.equal(mediaBox(join(dir, 'output', 'bare.pdf')), '595x842');
  assert.equal(mediaBox(join(dir, 'output', 'own.pdf')), '612x792');
  assert.equal(mediaBox(join(dir, 'output', 'fmt.pdf')), '612x792');
});

test('generate-pdf: the usage text names --country', () => {
  const res = spawnSync(NODE, [join(ROOT, 'generate-pdf.mjs')], { env: workspaceEnv(workspace(null)), encoding: 'utf-8' });
  assert.match(res.stderr, /--country=XX/);
  assert.match(res.stderr, /country\?/);
});
