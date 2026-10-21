import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { extractHeadings, compareStructure, discoverLangs, checkLang, formatReport, toJSON } from '../i18n-drift.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function fixture(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'i18n-drift-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function linkForTest(t, target, path, directory = false) {
  try {
    symlinkSync(target, path, directory ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file');
    return true;
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(error.code)) throw error;
    t.skip(`symbolic links unavailable on this machine (${error.code})`);
    return false;
  }
}

function installCLI(root) {
  copyFileSync(join(ROOT, 'i18n-drift.mjs'), join(root, 'i18n-drift.mjs'));
  mkdirSync(join(root, 'lib'), { recursive: true });
  for (const name of ['is-main-module.mjs', 'mjs-files.mjs', 'scratch-dirs.mjs', 'walk-tree.mjs']) {
    const source = join(ROOT, 'lib', name);
    if (existsSync(source)) copyFileSync(source, join(root, 'lib', name));
  }
}

function runCLI(root, args, cwd = root) {
  const result = spawnSync(process.execPath, [join(root, 'i18n-drift.mjs'), ...args], {
    cwd, encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, 'CLI must finish without a timeout or signal');
  return result;
}

const headings = (text) => extractHeadings(text);
const compare = compareStructure;

test('extracts ATX and setext headings with source lines and ignores code and comments', () => {
  const markdown = [
    '# Evaluation #',
    '',
    '```markdown',
    '## Example, not a section',
    '```',
    '~~~',
    '### Another example',
    '~~~',
    '<!--',
    '# Hidden heading',
    '-->',
    '    ## Indented code',
    '\t## Tab-indented code',
    '',
    '中文标题',
    '------',
    '',
    'العنوان',
    '======',
    '',
    '   ### Evidence ###',
    '##No separating space',
    '####### Not a heading',
  ].join('\n');
  assert.deepEqual(headings(markdown), [
    { level: 1, text: 'Evaluation', line: 1 },
    { level: 2, text: '中文标题', line: 15 },
    { level: 1, text: 'العنوان', line: 18 },
    { level: 3, text: 'Evidence', line: 21 },
  ]);
});

test('shorter and different fences inside a code example do not expose headings', () => {
  const markdown = '# Real\n````markdown\n```\n## Hidden\n~~~\n### Hidden too\n````\n## Visible';
  assert.deepEqual(headings(markdown).map(({ text }) => text), ['Real', 'Visible']);
});

test('literal comment openers in inline code, escaped text and fence info do not hide later headings', () => {
  for (const literal of ['`<!--` is literal', '\\<!-- is escaped', '```text <!--\n# Example\n```']) {
    const markdown = `# Root\n\n${literal}\n\n## Visible`;
    assert.deepEqual(headings(markdown).map(({ text }) => text), ['Root', 'Visible'], literal);
  }
});

test('normal Chinese and Arabic translations preserve structure regardless of heading text', () => {
  const canonical = '# Evaluate\n## Context\n### Evidence\n## Action';
  for (const translated of [
    '# 职位评估\n## 背景资料\n### 事实依据\n## 下一步',
    '# تقييم الوظيفة\n## السياق\n### الأدلة\n## الخطوة التالية',
  ]) {
    const result = compare(canonical, translated);
    assert.equal(result.covered, 4);
    assert.equal(result.total, 4);
    assert.equal(result.coverage, 1);
    assert.equal(result.missingCount, 0);
    assert.equal(result.extraCount, 0);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.candidates, []);
  }
});

test('a missing middle block is reported at its canonical line', () => {
  const result = compare('# Evaluate\n## Context\n### Evidence\n#### Required proof\n## Action',
    '# 评估\n## 背景\n## 下一步');
  assert.equal(result.covered, 3);
  assert.equal(result.total, 5);
  assert.equal(result.coverage, 0.6);
  assert.equal(result.missingCount, 2);
  assert.equal(result.extraCount, 0);
  assert.deepEqual(result.missing, [
    { level: 3, text: 'Evidence', line: 3 },
    { level: 4, text: 'Required proof', line: 4 },
  ]);
  assert.deepEqual(result.candidates, []);
});

test('the same heading counts in a different order still signal structural drift', () => {
  const result = compare('# Evaluate\n## Context\n### Evidence\n## Action',
    '# 评估\n### 依据\n## 背景\n## 下一步');
  assert.equal(result.canonicalCount, 4);
  assert.equal(result.translatedCount, 4);
  assert.equal(result.covered, 3);
  assert.equal(result.missingCount, 1);
  assert.equal(result.extraCount, 1);
});

test('ambiguous same-level omissions list candidates instead of inventing a missing title', () => {
  const result = compare('# Evaluate\n## Context\n## Evidence\n## Action',
    '# 评估\n## 背景\n## 下一步');
  assert.equal(result.missingCount, 1);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.candidates.map(({ text }) => text), ['Context', 'Evidence', 'Action']);
});

test('extra translated sections and empty documents have meaningful coverage', () => {
  const extra = compare('# Evaluate\n## Context', '# 评估\n## 背景\n### 地区说明');
  assert.equal(extra.coverage, 1);
  assert.equal(extra.missingCount, 0);
  assert.equal(extra.extraCount, 1);
  const emptyTranslation = compare('# Evaluate\n## Context', 'Only a paragraph.');
  assert.equal(emptyTranslation.coverage, 0);
  assert.equal(emptyTranslation.missingCount, 2);
  assert.equal(emptyTranslation.missing.length, 2);
  assert.equal(compare('', '').coverage, 1);
});

test('discovers language directories without treating mode groups or checkouts as languages', (t) => {
  const root = fixture(t, {
    'modes/zh/oferta.md': '# 评估',
    'modes/ar/fursah.md': '# تقييم',
    'modes/interview/plan.md': '# Plan',
    'modes/pdf/hm-audit.md': '# Audit',
    'modes/fr/.git/HEAD': 'ref: refs/heads/main',
    'modes/fr/offre.md': '# Offre',
    'modes/de/.git': 'gitdir: /some/other/checkout',
    'modes/de/angebot.md': '# Angebot',
  });
  assert.deepEqual(discoverLangs(root), ['ar', 'zh']);
});

test('does not discover a language through a linked directory', (t) => {
  const root = fixture(t, { 'modes/zh/oferta.md': '# 评估' });
  if (!linkForTest(t, join(root, 'modes/zh'), join(root, 'modes/ja'), true)) return;
  assert.deepEqual(discoverLangs(root), ['zh']);
});

test('resolves translated filenames through README mappings to the root canonical source', (t) => {
  const root = fixture(t, {
    'modes/oferta.md': '# Evaluate\n## Context\n### Proof\n## Action',
    'modes/fr/README.md': '| Fichier | Traduit depuis | Role |\n|---|---|---|\n| `offre.md` | `modes/oferta.md` (ES) | Evaluation |',
    'modes/fr/offre.md': '# Offre\n## Contexte',
    'modes/nl/README.md': '| Bestand | Vertaald uit | Rol |\n|---|---|---|\n| `vacature.md` | `modes/fr/offre.md` (FR) | Evaluatie |',
    'modes/nl/vacature.md': '# Vacature\n## Context\n### Bewijs\n## Actie',
  });
  const result = checkLang('nl', root);
  assert.equal(result.lang, 'nl');
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].canonical, 'oferta.md');
  assert.equal(result.files[0].result.coverage, 1,
    'compare against the current root canonical file, not an already stale intermediate translation');
});

test('checks nested modes and reports a declared but missing translation without requiring every canonical mode', (t) => {
  const root = fixture(t, {
    'modes/oferta.md': '# Evaluate\n## Evidence',
    'modes/apply.md': '# Apply\n## Form',
    'modes/interview/plan.md': '# Plan\n## Steps',
    'modes/zh/README.md': '| 文件 | 来源 |\n|---|---|\n| `oferta.md` | `modes/oferta.md` |',
    'modes/zh/interview/plan.md': '# 计划\n## 步骤',
    'modes/zh/_profile.md': '# Private profile',
    'modes/zh/_custom.md': '# Private rules',
  });
  const { files } = checkLang('zh', root);
  assert.equal(files.length, 2, 'README, personal files and untranslated canonical modes are not checked');
  const nested = files.find((file) => file.canonical === 'interview/plan.md');
  assert.equal(nested?.result.coverage, 1);
  const missing = files.find((file) => file.canonical === 'oferta.md');
  assert.equal(missing?.missingFile, true);
  assert.equal(missing?.result.missingCount, 2);
});

test('unmapped translations are explicit skips', (t) => {
  const root = fixture(t, {
    'modes/oferta.md': '# Evaluate',
    'modes/zh/local-only.md': '# 本地指导',
  });
  const { files } = checkLang('zh', root);
  assert.equal(files.length, 1);
  assert.equal(files[0].skipped, true);
  assert.ok(files[0].skipReason);
});

test('does not read a translated file through a symbolic link', (t) => {
  const root = fixture(t, {
    'modes/oferta.md': '# Evaluate',
    'modes/zh/local-only.md': '# 本地指导',
    'outside.md': '# Outside\n## Private content',
  });
  if (!linkForTest(t, join(root, 'outside.md'), join(root, 'modes/zh/oferta.md'))) return;
  assert.deepEqual(checkLang('zh', root).files.map(file => file.translated), ['local-only.md']);
});

test('does not traverse a linked mode subdirectory', (t) => {
  const root = fixture(t, {
    'modes/interview/plan.md': '# Plan',
    'modes/zh/local-only.md': '# 本地指导',
    'outside/plan.md': '# Outside plan',
  });
  if (!linkForTest(t, join(root, 'outside'), join(root, 'modes/zh/interview'), true)) return;
  assert.deepEqual(checkLang('zh', root).files.map(file => file.translated), ['local-only.md']);
});

test('cyclic and out-of-tree README mappings cannot read another source', (t) => {
  const root = fixture(t, {
    'modes/fr/README.md': '| File | Source |\n|---|---|\n| `offre.md` | `modes/nl/vacature.md` |',
    'modes/fr/offre.md': '# Offre',
    'modes/nl/README.md': '| File | Source |\n|---|---|\n| `vacature.md` | `modes/fr/offre.md` |',
    'modes/nl/vacature.md': '# Vacature',
    'modes/zh/README.md': '| File | Source |\n|---|---|\n| `local.md` | `modes/../outside.md` |',
    'modes/zh/local.md': '# 本地',
    'outside.md': '# Outside source that must never enter the report',
  });
  const cyclic = checkLang('nl', root).files;
  assert.equal(cyclic.length, 1);
  assert.equal(cyclic[0].skipped, true);
  assert.match(cyclic[0].skipReason, /cyclic|cycle/i);
  const external = checkLang('zh', root).files;
  assert.equal(external.length, 1);
  assert.equal(external[0].skipped, true);
  assert.equal(external[0].result, null);
});

test('JSON summaries retain actionable file details and aggregate drift', (t) => {
  const root = fixture(t, {
    'modes/oferta.md': '# Evaluate\n## Context\n### Evidence',
    'modes/zh/oferta.md': '# 评估\n## 背景',
    'modes/zh/local-only.md': '# Local guidance',
  });
  const results = [checkLang('zh', root)];
  const json = toJSON(results);
  assert.equal(json.length, 1);
  assert.equal(json[0].lang, 'zh');
  assert.deepEqual(json[0].files, results[0].files);
  assert.equal(json[0].summary.filesChecked, 1);
  assert.equal(json[0].summary.filesSkipped, 1);
  assert.equal(json[0].summary.sectionsCovered, 2);
  assert.equal(json[0].summary.sectionsTotal, 3);
  assert.equal(json[0].summary.missingCount, 1);
  assert.equal(json[0].summary.extraCount, 0);
  const report = formatReport(results);
  assert.match(report, /zh/);
  assert.match(report, /oferta\.md/);
  assert.match(report, /Evidence/);
  assert.match(formatReport(results, { summary: true }), /zh/);
});

test('table cells escape existing backslashes before Markdown separators', () => {
  const report = formatReport([{ lang: 'zh', files: [{
    translated: 'local.md', canonical: null, result: null,
    skipped: true, skipReason: 'unmapped \\| name\nnext line',
  }] }]);
  assert.ok(report.includes('skipped: unmapped ' + '\\'.repeat(3) + '| name next line |'));
});

test('CLI is advisory, accepts repeated language selection, and resolves modes outside the current directory', (t) => {
  const root = fixture(t, {
    'modes/oferta.md': '# Evaluate\n## Context\n### Evidence',
    'modes/zh/oferta.md': '# 评估\n## 背景',
    'modes/ar/oferta.md': '# تقييم\n## السياق\n### الأدلة',
    'modes/fr/oferta.md': '# Offre',
    'elsewhere/placeholder': '',
  });
  installCLI(root);
  const result = runCLI(root, ['--lang', 'zh', '--lang=ar', '--json'], join(root, 'elsewhere'));
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.map(({ lang }) => lang).sort(), ['ar', 'zh']);
  assert.equal(output.find(({ lang }) => lang === 'zh').summary.missingCount, 1);
  assert.equal(output.find(({ lang }) => lang === 'ar').summary.missingCount, 0);
  const summary = runCLI(root, ['--lang', 'zh', '--summary']);
  assert.equal(summary.status, 0, summary.stderr);
  assert.match(summary.stdout, /zh/);
});

test('CLI rejects invalid flags, missing operands and unknown languages before printing a report', (t) => {
  const root = fixture(t, { 'modes/zh/oferta.md': '# 评估', 'modes/oferta.md': '# Evaluate' });
  installCLI(root);
  for (const args of [
    ['--bogus'], ['--help', '--bogus'], ['--lang'], ['--lang='],
    ['--lang', '--json'], ['--lang', 'unknown-language'], ['--lang', 'zz'], ['unexpected-argument'],
    ['--root', root], ['--threshold', '80'],
  ]) {
    const result = runCLI(root, args);
    assert.equal(result.status, 1, `${args.join(' ')}: ${result.stderr}`);
    assert.ok(result.stderr.trim(), 'usage errors explain the invalid argument');
    assert.equal(result.stdout, '');
  }
});

test('CLI help works without a modes directory, while a normal run reports the missing directory', (t) => {
  const root = fixture(t);
  installCLI(root);
  const help = runCLI(root, ['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /i18n-drift\.mjs/);
  assert.match(help.stdout, /--lang/);
  const result = runCLI(root, []);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /modes/i);
});
