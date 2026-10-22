/** #5494: exercise the opt-in CLI, actual HTML builder and existing CV gates. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';
import { prepareCvSelection, selectionDigest } from '../lib/profile-cv-selection.mjs';

const fixture = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/profile-cv-selection.json'), 'utf8'));
const sourceFiles = ['cv.md', 'data/career-profile.yml', 'base.json', 'selection.json', 'prepared.json', 'config/cv-facts.json', 'config/profile.yml'];
const PDF = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
  + '2 0 obj\n<< /Type /Pages /Count 1 >>\nendobj\n%%EOF';

function check(name, run) {
  try { run(); pass(`profile generation: ${name}`); }
  catch (error) { fail(`profile generation: ${name}: ${error.stack}`); }
}

function withFixture(run) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'profile generation data ')));
  const paths = { html: join(root, 'output/cv-v1.html'), pdf: join(root, 'output/cv-v1.pdf'),
    capture: join(root, 'rendered.html'), launch: join(root, 'browser-launched'), network: join(root, 'network-attempt') };
  const save = (file, value) => writeFileSync(join(root, file), JSON.stringify(value, null, 2));
  const state = { profile: structuredClone(fixture.profile), basePayload: structuredClone(fixture.base_payload) };
  function prepare() {
    state.selection = {
      schema: 'profile-selection.v1', base_payload_sha256: selectionDigest(state.basePayload),
      bindings: [{ profile_entry_id: 'exp-acme-recent',
        target: { experience_index: 0, entry_sha256: selectionDigest(state.basePayload.experience[0]) },
        fact_ids: ['fact-chinese', 'fact-team'] }],
    };
    state.prepared = prepareCvSelection(state);
    persist();
  }
  function persist() {
    save('data/career-profile.yml', state.profile);
    save('base.json', state.basePayload);
    save('selection.json', state.selection);
    save('prepared.json', state.prepared);
  }
  const snapshot = () => sourceFiles.map(file => {
    const path = join(root, file);
    return existsSync(path) ? readFileSync(path) : null;
  });
  function cli(extra = [], overrides = {}, destinations = {}) {
    const before = snapshot();
    const result = spawnSync(NODE, [join(ROOT, 'career-profile.mjs'), 'generate-cv',
      '--payload', 'base.json', '--selection', 'selection.json', '--prepared', 'prepared.json',
      '--html', destinations.html || 'output/cv-v1.html', '--pdf', destinations.pdf || 'output/cv-v1.pdf', ...extra], {
      cwd: root, encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: '', CAREER_OPS_PROFILE: '',
        NODE_OPTIONS: `--import=${pathToFileURL(join(root, 'offline-browser.mjs')).href}`,
        PROFILE_TEST_ROOT: root, ...overrides },
    });
    const after = snapshot();
    if (overrides.PROFILE_TEST_DELETE_CV === '1') {
      // One regression deliberately deletes this source in the PDF child's
      // preload. Every other input must still remain byte-for-byte identical.
      assert.equal(after[0], null, 'the PDF-child fixture must remove cv.md');
      before[0] = null;
    }
    assert.deepEqual(after, before, 'generation must preserve its sources and selection inputs');
    assert.equal(existsSync(paths.network), false, 'no network/model request is permitted');
    return result;
  }
  function rejects(extra = [], overrides = {}, pattern) {
    const result = cli(extra, overrides);
    assert.equal(result.status, 1, describeSpawn(result));
    if (pattern) assert.match(result.stderr + result.stdout, pattern);
    assert.equal(existsSync(paths.pdf), false, 'a failed generation cannot publish a PDF');
    assert.equal(existsSync(paths.launch), false, 'invalid inputs must stop before Chromium');
    return result;
  }
  try {
    for (const dir of ['data', 'config', 'output']) mkdirSync(join(root, dir));
    writeFileSync(join(root, 'cv.md'), fixture.primary_cv);
    save('config/cv-facts.json', { allow_metrics: [], allow_facts: [], forbidden_phrases: [], warn_phrases: [] });
    prepare();
    // Keep every workflow component real except the final browser. The double
    // records page.goto's actual file, after PDF normalization and fact gates.
    writeFileSync(join(root, 'offline-browser.mjs'), `
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { isMainModule } from ${JSON.stringify(pathToFileURL(join(ROOT, 'lib/is-main-module.mjs')).href)};
const root = process.env.PROFILE_TEST_ROOT;
const args = process.argv.slice(2);
const builder = isMainModule(${JSON.stringify(pathToFileURL(join(ROOT, 'build-cv-html.mjs')).href)});
if (builder && process.env.PROFILE_TEST_RACE_HTML) {
  if (process.env.PROFILE_TEST_RACE_HTML === 'file') writeFileSync(args[1], 'competing HTML', { flag: 'wx' });
  else {
    writeFileSync(root + '/race-target.html', 'competing HTML target');
    symlinkSync(root + '/race-target.html', args[1]);
  }
  writeFileSync(root + '/html-race-created', 'yes');
}
if (builder && process.env.PROFILE_TEST_RACE_PARENT) {
  renameSync(root + '/output', root + '/output-original');
  symlinkSync(process.env.PROFILE_TEST_RACE_PARENT, root + '/output', process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(root + '/output-parent-swapped', 'yes');
}
// generate-cv and its title/structure/builder children lack this PDF-only
// flag. Delete after their checks, before generate-pdf's module evaluates.
if (process.env.PROFILE_TEST_DELETE_CV === '1' && args.includes('--require-cv-source')) {
  rmSync(root + '/cv.md');
  writeFileSync(root + '/primary-source-deleted', 'yes');
}
const blocked = () => { writeFileSync(root + '/network-attempt', 'blocked'); throw new Error('Unexpected network access'); };
globalThis.fetch = blocked;
http.request = http.get = https.request = https.get = net.connect = net.createConnection = tls.connect = blocked;
syncBuiltinESMExports();
const { chromium } = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'node_modules/playwright/index.mjs')).href)});
chromium.launch = async () => {
  writeFileSync(root + '/browser-launched', 'yes');
  return { async newPage() { return {
    async goto(url) { writeFileSync(root + '/rendered.html', readFileSync(fileURLToPath(url))); },
    async evaluate() {}, async pdf() {
      if (process.env.PROFILE_TEST_RACE_PDF === '1') {
        writeFileSync(root + '/output/cv-v1.pdf', 'competing PDF', { flag: 'wx' });
        writeFileSync(root + '/pdf-race-created', 'yes');
      }
      return Buffer.from(${JSON.stringify(PDF)});
    }
  }; }, async close() {} };
};
`);
    run({ root, paths, state, save, prepare, persist, cli, rejects });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

check('real offline flow preserves literal ordered facts, distinct experiences and public manifest paths', () => withFixture(f => {
  const result = f.cli(['--report', '123']);
  assert.equal(result.status, 0, describeSpawn(result));
  assert.equal(readFileSync(f.paths.pdf, 'utf8'), PDF);
  for (const file of [f.paths.html, f.paths.capture]) {
    const html = readFileSync(file, 'utf8');
    assert.ok(html.includes('维护 A&amp;B &lt;组件&gt; 的告警规则。'));
    assert.ok(html.indexOf('维护 A&amp;B') < html.indexOf('Managed 20 people.'));
    const dates = html.replaceAll('–', '-'); // Existing PDF ATS normalization.
    assert.ok(dates.includes('2022-2024') && dates.includes('2020-2021'));
    assert.ok(html.includes('Maintained release notes.') && html.includes('Documentation'));
    assert.equal(html.includes('Old selected-entry wording.'), false);
    assert.equal(html.includes('An unreviewed fixture claim.'), false);
  }
  const rows = readFileSync(join(f.root, 'data/pdf-index.tsv'), 'utf8').split('\n').filter(line => line && !line.startsWith('#'));
  assert.equal(rows.length, 1);
  const fields = rows[0].split('\t');
  assert.deepEqual(fields.slice(0, 4), ['123', 'output/cv-v1.pdf', 'output/cv-v1.html', 'a4']);
  assert.equal(fields[5], 'cv');
}));

check('a symlinked Data Root preserves its path spelling through all generation CLIs', () => withFixture(f => {
  const aliases = realpathSync(mkdtempSync(join(tmpdir(), 'profile root aliases ')));
  const alias = join(aliases, 'candidate data');
  try {
    symlinkSync(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(realpathSync(alias), f.root);
    // An existing tracker is canonicalized by resolveTrackerPath; the
    // downstream output guards must still accept the Data Root's alias.
    writeFileSync(join(f.root, 'data/applications.md'), '');
    const result = f.cli(['--report', '456'], { CAREER_OPS_ROOT: alias });
    assert.equal(result.status, 0, describeSpawn(result));
    assert.equal(readFileSync(f.paths.pdf, 'utf8'), PDF);
    assert.ok(readFileSync(f.paths.capture, 'utf8').includes('维护 A&amp;B &lt;组件&gt; 的告警规则。'));
    const row = readFileSync(join(f.root, 'data/pdf-index.tsv'), 'utf8').split('\n')
      .find(line => line.startsWith('456\t'));
    assert.ok(row, 'the aliased generation must publish its manifest row');
    assert.deepEqual(row.split('\t').slice(0, 4), ['456', 'output/cv-v1.pdf', 'output/cv-v1.html', 'a4']);
    assert.equal(readFileSync(join(f.root, 'data/applications.md'), 'utf8'), '');
  } finally { rmSync(aliases, { recursive: true, force: true }); }
}));

check('a Data Root alias and canonical tracker share the required primary source', () => withFixture(f => {
  const aliases = realpathSync(mkdtempSync(join(tmpdir(), 'profile tracker aliases ')));
  try {
    const alias = join(aliases, 'candidate data');
    symlinkSync(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const tracker = join(f.root, 'data/applications.md');
    writeFileSync(tracker, '');
    const result = f.cli([], { CAREER_OPS_ROOT: alias, CAREER_OPS_TRACKER: tracker }, f.paths);
    assert.equal(result.status, 0, describeSpawn(result));
    assert.equal(readFileSync(f.paths.pdf, 'utf8'), PDF);
    assert.equal(readFileSync(tracker, 'utf8'), '');
  } finally { rmSync(aliases, { recursive: true, force: true }); }
}));

for (const [name, mutate] of [
  ['selected text', f => { f.state.profile.experiences[0].facts[0].text = 'Changed after preparation.'; }],
  ['revoked review', f => { f.state.profile.experiences[0].facts[0].review_status = 'needs_review'; }],
  ['binding', f => { f.state.selection.bindings[0].target.experience_index = 1; }],
  ['original base', f => { f.state.basePayload.experience[1].role = 'Changed title'; }],
  ['mapping', f => { f.state.prepared.mapping.bullets[0].fact_id = 'fact-earlier'; }],
  ['resealed unselected payload', f => {
    f.state.prepared.payload.experience[1].role = 'Edited after preparation';
    f.state.prepared.mapping.payload_sha256 = selectionDigest(f.state.prepared.payload);
  }],
]) check(`generation rejects stale ${name} before writing either artifact`, () => withFixture(f => {
  mutate(f); f.persist(); f.rejects();
  assert.equal(existsSync(f.paths.html), false);
}));

check('missing and blank primary CVs cannot silently skip fact checking', () => {
  for (const cv of [null, ' \n\t']) withFixture(f => {
    if (cv === null) rmSync(join(f.root, 'cv.md'));
    else writeFileSync(join(f.root, 'cv.md'), cv);
    f.rejects([], {}, /cv\.md/i);
    assert.equal(existsSync(f.paths.html), false);
  });
});

check('verified Profile claims unsupported by primary sources fail the actual PDF fact gate', () => withFixture(f => {
  f.state.profile.experiences[0].facts[0].text = 'Managed 999 people.';
  f.prepare(); // Current mapping is valid: review status is not source truth.
  f.rejects([], {}, /Fact check failed[\s\S]*999 people/);
}));

check('a primary CV removed after preparation cannot make the PDF child skip its fact gate', () => withFixture(f => {
  f.rejects([], { PROFILE_TEST_DELETE_CV: '1' }, /(?:require[^\n]*cv\.md|cv\.md[^\n]*(?:require|missing|source))/i);
  assert.equal(readFileSync(join(f.root, 'primary-source-deleted'), 'utf8'), 'yes');
  assert.equal(existsSync(f.paths.html), true, 'the HTML draft precedes the PDF-child source deletion');
  assert.equal(existsSync(join(f.root, 'data/pdf-index.tsv')), false);
}));

check('PDF source enforcement rejects fact-check bypass and unsupported batch combinations', () => {
  for (const [args, message] of [
    [['--require-cv-source', '--skip-fact-check'], /require-cv-source cannot be combined with --skip-fact-check/],
    [['--batch=absent.json', '--require-cv-source'], /supported only for single-file generation/],
    [['--batch=absent.json', '--no-clobber'], /supported only for single-file generation/],
  ]) withFixture(f => {
    const result = spawnSync(NODE, [join(ROOT, 'generate-pdf.mjs'), ...args], {
      cwd: f.root, encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, CAREER_OPS_ROOT: f.root, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: '', CAREER_OPS_PROFILE: '',
        NODE_OPTIONS: `--import=${pathToFileURL(join(f.root, 'offline-browser.mjs')).href}`, PROFILE_TEST_ROOT: f.root },
    });
    assert.equal(result.status, 1, describeSpawn(result));
    assert.match(result.stderr + result.stdout, message);
    assert.equal(existsSync(f.paths.pdf), false);
    assert.equal(existsSync(f.paths.launch), false);
    assert.equal(existsSync(f.paths.network), false);
  });
});

check('title drift and descriptor loss still warn while allowing completed comparisons', () => withFixture(f => {
  f.state.basePayload.experience[0].role = 'Principal Software Engineer';
  f.prepare();
  writeFileSync(join(f.root, 'cv.md'), fixture.primary_cv.replace('### Acme — Fixture City', '### Acme — Fixture City · Fixture descriptor'));
  const result = f.cli();
  assert.equal(result.status, 0, describeSpawn(result));
  assert.match(result.stderr + result.stdout, /Principal Software Engineer/);
  assert.match(result.stderr + result.stdout, /missing its cv\.md descriptor "Fixture descriptor"/);
  assert.equal(existsSync(f.paths.pdf), true);
}));

check('a title check unable to compare missing dates stops before HTML rendering', () => withFixture(f => {
  delete f.state.basePayload.experience[0].dates;
  f.prepare();
  f.rejects([], {}, /experience\[0\].*missing dates/);
  assert.equal(existsSync(f.paths.html), false);
}));

check('a tracker in another workspace fails preflight instead of checking one CV and rendering another', () => withFixture(f => {
  const other = realpathSync(mkdtempSync(join(tmpdir(), 'profile other workspace ')));
  try {
    mkdirSync(join(other, 'data'));
    writeFileSync(join(other, 'data/applications.md'), '');
    f.rejects([], { CAREER_OPS_TRACKER: join(other, 'data/applications.md') }, /workspace|Data Root/i);
    assert.equal(existsSync(f.paths.html), false);
    assert.equal(existsSync(join(other, 'output/cv-v1.pdf')), false);
  } finally { rmSync(other, { recursive: true, force: true }); }
}));

check('existing HTML cannot bypass selection verification or be overwritten', () => withFixture(f => {
  const html = '<html><body>previous unverified artifact</body></html>';
  writeFileSync(f.paths.html, html);
  f.rejects([], {}, /exist|overwrite/i);
  assert.equal(readFileSync(f.paths.html, 'utf8'), html);
}));

check('an existing PDF, dangling symlink or hard link is never overwritten', () => {
  for (const kind of ['pdf', 'dangling-html', 'hardlink-html']) withFixture(f => {
    const base = readFileSync(join(f.root, 'base.json'));
    if (kind === 'pdf') writeFileSync(f.paths.pdf, 'previous good PDF');
    if (kind === 'dangling-html') symlinkSync(join(f.root, 'absent.html'), f.paths.html);
    if (kind === 'hardlink-html') linkSync(join(f.root, 'base.json'), f.paths.html);
    const result = f.cli();
    assert.equal(result.status, 1, describeSpawn(result));
    assert.equal(existsSync(f.paths.launch), false);
    assert.deepEqual(readFileSync(join(f.root, 'base.json')), base);
    if (kind === 'pdf') {
      assert.equal(readFileSync(f.paths.pdf, 'utf8'), 'previous good PDF');
      assert.equal(existsSync(f.paths.html), false);
    } else {
      assert.equal(existsSync(f.paths.pdf), false);
      if (kind === 'dangling-html') assert.equal(lstatSync(f.paths.html).isSymbolicLink(), true);
    }
  });
});

check('an HTML file or symlink created after wrapper preflight survives the builder write', () => {
  for (const kind of ['file', 'symlink']) withFixture(f => {
    f.rejects([], { PROFILE_TEST_RACE_HTML: kind }, /EEXIST|already exists/i);
    assert.equal(readFileSync(join(f.root, 'html-race-created'), 'utf8'), 'yes');
    if (kind === 'file') assert.equal(readFileSync(f.paths.html, 'utf8'), 'competing HTML');
    else {
      assert.equal(lstatSync(f.paths.html).isSymbolicLink(), true);
      assert.equal(readFileSync(join(f.root, 'race-target.html'), 'utf8'), 'competing HTML target');
    }
    assert.equal(existsSync(join(f.root, 'data/pdf-index.tsv')), false);
  });
});

check('a PDF created during browser rendering survives publication and leaves the manifest unchanged', () => withFixture(f => {
  const manifest = '# existing manifest\n42\toutput/earlier.pdf\toutput/earlier.html\ta4\t2026-01-01\tcv\n';
  writeFileSync(join(f.root, 'data/pdf-index.tsv'), manifest);
  const result = f.cli(['--report', '123'], { PROFILE_TEST_RACE_PDF: '1' });
  assert.equal(result.status, 1, describeSpawn(result));
  assert.match(result.stderr + result.stdout, /EEXIST|already exists/i);
  assert.equal(existsSync(f.paths.launch), true, 'the race happens after Chromium starts');
  assert.equal(readFileSync(join(f.root, 'pdf-race-created'), 'utf8'), 'yes');
  assert.equal(readFileSync(f.paths.pdf, 'utf8'), 'competing PDF');
  assert.equal(readFileSync(join(f.root, 'data/pdf-index.tsv'), 'utf8'), manifest);
}));

check('an output parent swapped after wrapper preflight is rechecked before the HTML write', () => withFixture(f => {
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'profile late output escape ')));
  try {
    f.rejects([], { PROFILE_TEST_RACE_PARENT: outside }, /outside|inside.*workspace|escape/i);
    assert.equal(readFileSync(join(f.root, 'output-parent-swapped'), 'utf8'), 'yes');
    assert.equal(lstatSync(join(f.root, 'output')).isSymbolicLink(), true);
    assert.equal(existsSync(join(outside, 'cv-v1.html')), false);
    assert.equal(existsSync(join(outside, 'cv-v1.pdf')), false);
  } finally { rmSync(outside, { recursive: true, force: true }); }
}));

check('a custom template cannot silently drop the selected experience section', () => withFixture(f => {
  writeFileSync(join(f.root, 'empty.html'), '<!doctype html><html><body>No experience placeholder</body></html>');
  f.rejects(['--template', 'empty.html'], {}, /EXPERIENCE/);
  assert.equal(existsSync(f.paths.html), false);
}));

check('an experience token mentioned only inside a template comment does not count as rendering', () => withFixture(f => {
  writeFileSync(join(f.root, 'commented.html'), '<!doctype html><html><body><!-- {{EXPERIENCE}} --></body></html>');
  f.rejects(['--template', 'commented.html'], {}, /EXPERIENCE.*outside comments/);
  assert.equal(existsSync(f.paths.html), false);
}));

check('bullet tokens outside ENTRY, in comments or only in unused block definitions do not count', () => {
  for (const partial of [
    '<!--ENTRY--><div>{{COMPANY}}</div><!--/ENTRY-->\n{{BULLETS}}',
    '<!--ENTRY--><div>{{COMPANY}}</div><!-- Documentation: {{BULLETS}} --><!--/ENTRY-->',
    '<!--ENTRY--><div>{{COMPANY}}</div><!--CONTEXT_BLOCK-->{{BULLETS}}<!--/CONTEXT_BLOCK--><!--/ENTRY-->',
  ]) withFixture(f => {
    writeFileSync(join(f.root, 'partial.html'), '<!doctype html><html><body>{{EXPERIENCE}}</body></html>');
    mkdirSync(join(f.root, 'sections'));
    writeFileSync(join(f.root, 'sections/experience.html'), partial);
    f.rejects(['--template', 'partial.html'], {}, /BULLETS.*directly in its ENTRY/);
    assert.equal(existsSync(f.paths.html), false);
  });
});

check('the configured ATS template and its experience partial are used by actual generation', () => withFixture(f => {
  f.save('config/profile.yml', { cv: { template: 'ats' } });
  const result = f.cli();
  assert.equal(result.status, 0, describeSpawn(result));
  const html = readFileSync(f.paths.html, 'utf8');
  // The ATS pack puts role before company; the standard template reverses
  // those fields and uses a span for company, so this pins actual pack use.
  assert.match(html, /<div class="job-role">Software Engineer<\/div>\s*<div class="job-company">Acme<\/div>/);
  assert.equal(existsSync(f.paths.pdf), true);
}));

check('an HTML output ancestor symlink cannot escape the Data Root', () => withFixture(f => {
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'profile output outside ')));
  try {
    symlinkSync(outside, join(f.root, 'output/escaped'), 'dir');
    const result = f.cli([], {}, { html: 'output/escaped/cv.html' });
    assert.equal(result.status, 1, describeSpawn(result));
    assert.match(result.stderr + result.stdout, /inside the tracker workspace/);
    assert.equal(existsSync(join(outside, 'cv.html')), false);
    assert.equal(existsSync(f.paths.pdf), false);
    assert.equal(existsSync(f.paths.launch), false);
  } finally { rmSync(outside, { recursive: true, force: true }); }
}));

check('custom template content also passes through the real primary-source fact gate', () => withFixture(f => {
  writeFileSync(join(f.root, 'injected.html'), '<!doctype html><html><body><p>Managed 999 people.</p>{{EXPERIENCE}}</body></html>');
  f.rejects(['--template', 'injected.html'], {}, /Fact check failed[\s\S]*999 people/);
}));
