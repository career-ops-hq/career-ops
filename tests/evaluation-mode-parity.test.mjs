import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { ROOT, rmSync } from './helpers.mjs';
import { discoverEvaluationModes, readModeText, structuralGaps } from './evaluation-mode-parity-helpers.mjs';

const REPORT = `# 評価: {Company} — {Role}

**Date:** {date}
**URL:** {url}
**Archetype:** {archetype}
**Score:** {score}
**Legitimacy:** {tier}
**PDF:** {pdf}

## Machine Summary
{machine fields}
## A) Role Summary
{role}
## B) Match
{match}
## C) Level
{level}
## D) Compensation
{compensation}
## E) Customization
{customization}
## F) Interview
{interview}
## G) Legitimacy
{legitimacy}
## Risk Summary
{risks}
## H) Answers
{answers}
`;
const mode = (body = REPORT, fence = '```') => `# Mode instructions\n\n${fence}markdown\n${body}${fence}\n`;

function sandbox(t) {
  const parent = mkdtempSync(join(tmpdir(), 'career-ops-parity-'));
  const root = join(parent, 'repo');
  mkdirSync(join(root, 'modes', 'xx'), { recursive: true });
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, root };
}

test('canonical and all five re-synced locales retain their real fenced templates', () => {
  for (const file of ['modes/oferta.md', 'modes/ar/fursah.md', 'modes/ja/kyujin.md',
    'modes/ru/oferta.md', 'modes/zh/oferta.md', 'modes/zh-TW/oferta.md']) {
    assert.deepEqual(structuralGaps(readModeText(ROOT, file)), [], file);
  }
  assert.ok(structuralGaps(readModeText(ROOT, 'modes/de/angebot.md')).includes('## H)'));
});

test('a localized H1, CRLF and either Markdown fence spelling remain valid', () => {
  assert.deepEqual(structuralGaps(mode()), []);
  assert.deepEqual(structuralGaps(mode(REPORT, '~~~~').replace(/\n/g, '\r\n')), []);
  assert.deepEqual(structuralGaps(mode(REPORT.replace('## B) Match', '##\tB)\tMatch'))), []);
});

test('an H3 cannot stand in for a required report H2', () => {
  assert.ok(structuralGaps(mode(REPORT.replace('## B) Match', '### B) Match'))).includes('## B)'));
});

test('HTML comments cannot supply a heading or an entire report template', () => {
  assert.ok(structuralGaps(mode(REPORT.replace('## B) Match', '<!-- ## B) Match -->'))).includes('## B)'));
  assert.deepEqual(structuralGaps(`<!--\n${mode()}\n-->`), ['expected one fenced report template, found 0']);
});

test('missing header labels cannot be rescued by prose or the report body', () => {
  const missing = REPORT.replace('**PDF:** {pdf}\n', '');
  assert.ok(structuralGaps(`${mode(missing)}\nDocumentation mentions **PDF:**\n`).includes('**PDF:** in report header'));
  assert.ok(structuralGaps(mode(missing + '\n**PDF:** body note\n')).includes('**PDF:** in report header'));
  const afterMachineSummary = missing.replace('## Machine Summary\n', '## Machine Summary\n**PDF:** too late\n');
  assert.ok(structuralGaps(mode(afterMachineSummary)).includes('**PDF:** in report header'));
});

test('commented and inline-code labels do not count as header fields', () => {
  for (const replacement of ['<!-- **PDF:** {pdf} -->', '`**PDF:** {pdf}`']) {
    assert.ok(structuralGaps(mode(REPORT.replace('**PDF:** {pdf}', replacement))).includes('**PDF:** in report header'));
  }
});

test('examples nested inside the report template cannot supply headings or labels', () => {
  const hiddenHeading = REPORT.replace('## B) Match', '```markdown\n## B) Match\n```');
  assert.ok(structuralGaps(mode(hiddenHeading, '````')).includes('## B)'));
  const hiddenLabel = REPORT.replace('**PDF:** {pdf}', '```text\n**PDF:** {pdf}\n```');
  assert.ok(structuralGaps(mode(hiddenLabel, '````')).includes('**PDF:** in report header'));
});

test('later corrected literals cannot hide duplicated or misordered sections', () => {
  const misordered = REPORT.replace('## G) Legitimacy\n{legitimacy}\n## Risk Summary\n{risks}',
    '## Risk Summary\n{risks}\n## G) Legitimacy\n{legitimacy}');
  assert.ok(structuralGaps(mode(misordered)).some(gap => gap.startsWith('report section order')));
  const appended = misordered + '\n## G) Legitimacy\n## Risk Summary\n## H) Answers\n';
  assert.ok(structuralGaps(mode(appended)).includes('duplicate ## G)'));
  const swapped = REPORT.replace('## C) Level', '## D) Level').replace('## D) Compensation', '## C) Compensation');
  assert.ok(structuralGaps(mode(swapped)).some(gap => gap.startsWith('report section order')));
});

test('prose, a separate example and ambiguous report fences cannot fill the template', () => {
  assert.deepEqual(structuralGaps(REPORT), ['expected one fenced report template, found 0']);
  assert.deepEqual(structuralGaps(`${mode()}\n${mode()}`), ['expected one fenced report template, found 2']);
  assert.ok(structuralGaps(mode(REPORT.replace('## B) Match', '')) + '\n```markdown\n## B) Match\n```')
    .includes('## B)'));
  assert.deepEqual(structuralGaps(mode().replace(/```\n$/, '')), ['expected one fenced report template, found 0']);
});

test('regular files and legal in-root one-line pointers read the same mode', t => {
  const { root } = sandbox(t);
  writeFileSync(join(root, 'modes', 'template.md'), mode());
  writeFileSync(join(root, 'modes', 'xx', 'angebot.md'), '../template.md\r\n');
  assert.equal(readModeText(root, 'modes/xx/angebot.md'), mode());
  assert.deepEqual(structuralGaps(readModeText(root, 'modes/xx/angebot.md')), []);
  assert.equal(readModeText(root, 'modes/template.md'), mode());
  assert.deepEqual(discoverEvaluationModes(root), ['xx/angebot.md']);
});

test('discovery follows report content, including a new market-specific filename', t => {
  const { root } = sandbox(t);
  mkdirSync(join(root, 'modes', 'yy'));
  writeFileSync(join(root, 'modes', 'xx', 'angebot.md'), mode());
  writeFileSync(join(root, 'modes', 'yy', 'new-market-name.md'), mode());
  writeFileSync(join(root, 'modes', 'xx', 'apply.md'), '# Apply instructions\n');
  assert.deepEqual(discoverEvaluationModes(root), ['xx/angebot.md', 'yy/new-market-name.md']);
});

test('discovery and parity agree on indented and tab-separated A headings', t => {
  const { root } = sandbox(t);
  const template = mode(REPORT.replace('## A) Role Summary', '  ##\tA)\tRole Summary'));
  const path = 'modes/xx/new-market-name.md';
  writeFileSync(join(root, path), template);
  writeFileSync(join(root, 'modes/xx/not-evaluation.md'), template.replace('  ##\tA)', '  ###\tA)'));
  assert.deepEqual(structuralGaps(template), []);
  assert.deepEqual(discoverEvaluationModes(root), ['xx/new-market-name.md']);

  // An unknown filename must remain visible when another report section drifts.
  writeFileSync(join(root, path), template.replace('## H) Answers', '### H) Answers'));
  assert.deepEqual(discoverEvaluationModes(root), ['xx/new-market-name.md']);
  assert.ok(structuralGaps(readModeText(root, path)).includes('## H)'));
});

test('nested checkout markers exclude another tree before any mode is read', t => {
  const { root } = sandbox(t);
  // The repository root can itself be a worktree; only nested roots are skipped.
  writeFileSync(join(root, '.git'), 'gitdir: fictional-root\n');
  writeFileSync(join(root, 'modes', 'xx', 'angebot.md'), mode());
  for (const type of ['worktree', 'clone']) {
    const nested = join(root, 'modes', type);
    mkdirSync(nested);
    if (type === 'worktree') writeFileSync(join(nested, '.git'), 'gitdir: fictional-child\n');
    else mkdirSync(join(nested, '.git'));
    writeFileSync(join(nested, 'README.md'), mode());
    // A wrong traversal would try to follow this before parity could classify it.
    writeFileSync(join(nested, 'pointer.md'), '../../../outside.md\n');
  }
  assert.deepEqual(discoverEvaluationModes(root), ['xx/angebot.md']);
});

test('an outside-root regular-file pointer is rejected before it can supply a report', t => {
  const { parent, root } = sandbox(t);
  const outside = join(parent, 'outside.md');
  writeFileSync(outside, mode());
  writeFileSync(join(root, 'modes', 'xx', 'angebot.md'), '../../../outside.md\n');
  assert.throws(() => readModeText(root, 'modes/xx/angebot.md'), /leaves the repository root/);
  assert.throws(() => discoverEvaluationModes(root), /leaves the repository root/);
  assert.throws(() => readModeText(root, '../outside.md'), /leaves the repository root/);
  // Changing the outside target cannot change this into ENOENT or a read error:
  // lexical rejection happens before probing the target's existence.
  rmSync(outside);
  assert.throws(() => readModeText(root, 'modes/xx/angebot.md'), /leaves the repository root/);
});

test('directory targets and missing in-root pointers fail loudly', t => {
  const { root } = sandbox(t);
  writeFileSync(join(root, 'modes', 'xx', 'directory.md'), '..\n');
  assert.throws(() => readModeText(root, 'modes/xx/directory.md'), /not a regular file/);
  writeFileSync(join(root, 'modes', 'xx', 'missing.md'), '../missing.md\n');
  assert.throws(() => readModeText(root, 'modes/xx/missing.md'), { code: 'ENOENT' });
});

test('real symlinks preserve legal mode aliases and cannot bypass root containment', t => {
  const { parent, root } = sandbox(t);
  writeFileSync(join(root, 'modes', 'template.md'), mode());
  writeFileSync(join(parent, 'outside.md'), mode());
  try {
    symlinkSync('../template.md', join(root, 'modes', 'xx', 'inside.md'), 'file');
    symlinkSync('../../../outside.md', join(root, 'modes', 'xx', 'outside.md'), 'file');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('Windows file symlink creation requires developer mode or administrator rights');
      return;
    }
    throw error;
  }
  assert.equal(readModeText(root, 'modes/xx/inside.md'), mode());
  assert.throws(() => readModeText(root, 'modes/xx/outside.md'), /leaves the repository root/);
  writeFileSync(join(root, 'modes', 'xx', 'via-link.md'), '../xx/outside.md\n');
  assert.throws(() => readModeText(root, 'modes/xx/via-link.md'), /leaves the repository root/);
});
