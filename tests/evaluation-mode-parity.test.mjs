import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { ROOT, rmSync } from './helpers.mjs';
import { FROZEN_EVALUATION_MODES, KNOWN_EVALUATION_MODES, discoverEvaluationModes, keywordCoverageGaps, readModeText, reportSectionTitles, structuralGaps } from './evaluation-mode-parity-helpers.mjs';

const REPORT = `# 評価: {Company} — {Role}

**Date:** {date}
**URL:** {url}
**Archetype:** {archetype}
**Score:** {score}
**Legitimacy:** {tier}
**PDF:** {pdf}

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
## Machine Summary
{machine fields}
`;
const mode = (body = REPORT, fence = '```') => `# Mode instructions\n\n${fence}markdown\n${body}${fence}\n`;

function sandbox(t) {
  const parent = mkdtempSync(join(tmpdir(), 'career-ops-parity-'));
  const root = join(parent, 'repo');
  mkdirSync(join(root, 'modes', 'xx'), { recursive: true });
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, root };
}

test('canonical and re-synced locales retain their real fenced templates', () => {
  const synced = KNOWN_EVALUATION_MODES.filter(file => !FROZEN_EVALUATION_MODES.has(file));
  for (const file of ['oferta.md', ...synced]) {
    assert.deepEqual(structuralGaps(readModeText(ROOT, `modes/${file}`)), [], file);
  }
});

test('frozen locales still require report-format resync', () => {
  for (const file of FROZEN_EVALUATION_MODES) {
    assert.ok(structuralGaps(readModeText(ROOT, `modes/${file}`)).length > 0,
      `${file}: remove from FROZEN_EVALUATION_MODES in tests/evaluation-mode-parity-helpers.mjs`);
  }
});

// A frozen file may still miss blocks, but not the posting URL: verify-pipeline,
// merge-tracker --backfill-urls and the dashboard all match `**URL:**` exactly.
test('every evaluation mode, frozen ones included, writes the exact **URL:** label', () => {
  for (const file of ['oferta.md', ...discoverEvaluationModes(ROOT)]) {
    assert.ok(!structuralGaps(readModeText(ROOT, `modes/${file}`)).includes('**URL:** in report header'), file);
  }
});

// keyword-match.mjs reads every locale's keyword heading; a mode without the
// block and its step never asks for the coverage check at all.
test('canonical and re-synced locales embed ## Keyword Coverage and run keyword-match', () => {
  const synced = discoverEvaluationModes(ROOT).filter(file => !FROZEN_EVALUATION_MODES.has(file));
  for (const file of ['oferta.md', ...synced]) {
    assert.deepEqual(keywordCoverageGaps(readModeText(ROOT, `modes/${file}`)), [], file);
  }
});

test('keyword coverage: the template placeholder, prose and comments cannot stand in', () => {
  const step = '\n```bash\nnode --input-type=module -e \'const args = ["keyword-match.mjs", p.report];\' {json-file}\n```\n';
  const block = '## Keyword Coverage\n(from `keyword-match.mjs` (1b))\n';
  assert.deepEqual(keywordCoverageGaps(mode(REPORT + block) + step), []);
  assert.deepEqual(keywordCoverageGaps(mode(REPORT + block)), ['keyword-match.mjs step']);
  // The report template is output, so a command written only there is no step.
  assert.deepEqual(keywordCoverageGaps(mode(REPORT + block + step.replace(/```(bash)?/g, ''))), ['keyword-match.mjs step']);
  // The command's text quoted in prose is not a runnable step.
  assert.deepEqual(keywordCoverageGaps(
    `${mode(REPORT + block)}\nThe command builds \`["keyword-match.mjs", p.report]\`.\n`), ['keyword-match.mjs step']);
  // The old form, a report path typed into the command line, is not the step (#5853).
  assert.deepEqual(keywordCoverageGaps(
    `${mode(REPORT + block)}\nRun \`node keyword-match.mjs reports/{###}-{slug}-{date}.md\`.\n`), ['keyword-match.mjs step']);
  assert.deepEqual(keywordCoverageGaps(mode(REPORT) + step), ['## Keyword Coverage']);
  assert.deepEqual(keywordCoverageGaps(`${mode(REPORT)}\n${block}${step}`), ['## Keyword Coverage']);
  assert.deepEqual(keywordCoverageGaps(mode(REPORT + block + block) + step), ['duplicate ## Keyword Coverage']);
  assert.deepEqual(keywordCoverageGaps(mode(`${REPORT}<!-- ${block} -->\n`) + `<!-- ${step} -->`),
    ['## Keyword Coverage', 'keyword-match.mjs step']);
});

test('a Machine Summary ahead of any other report section is reported', () => {
  const machine = '## Machine Summary\n{machine fields}\n';
  const atTop = REPORT.replace(machine, '').replace('## A) Role Summary', `${machine}## A) Role Summary`);
  assert.ok(structuralGaps(mode(atTop)).includes('## Machine Summary is not the last report section'));
  const beforeKeywords = `${REPORT}## Keyword Coverage\n{coverage}\n`;
  assert.ok(structuralGaps(mode(beforeKeywords)).includes('## Machine Summary is not the last report section'));
});

test('a template with no Machine Summary, or two, is reported', () => {
  const machine = '## Machine Summary\n{machine fields}\n';
  assert.deepEqual(structuralGaps(mode(REPORT.replace(machine, ''))), ['## Machine Summary']);
  // A heading outside the template, or a comment, is not a section the report carries.
  const prose = `${mode(REPORT.replace(machine, ''))}\n${machine}`;
  assert.deepEqual(structuralGaps(prose), ['## Machine Summary']);
  assert.deepEqual(structuralGaps(mode(REPORT.replace(machine, `<!-- ${machine} -->\n`))), ['## Machine Summary']);
  assert.deepEqual(structuralGaps(mode(REPORT + machine)), ['duplicate ## Machine Summary']);
});

// The batch worker writes its report from batch/batch-prompt.md, not a mode file.
test('batch/batch-prompt.md writes the Machine Summary as the last report section', () => {
  const prompt = readModeText(ROOT, 'batch/batch-prompt.md');
  const step3 = prompt.slice(prompt.indexOf('### Step 3'), prompt.indexOf('### Step 4'));
  const template = step3.slice(step3.indexOf('Report header:'), step3.indexOf('`**Decision:**` is Machine Summary'));
  const sections = template.split('\n').filter(line => /^##[ \t]+/.test(line));
  assert.equal(sections.at(-1), '## Machine Summary', `template sections: ${sections.join(' | ')}`);
  const list = step3.slice(step3.indexOf("The report's sections, in this order:"));
  const items = list.split('\n\n')[1].split('\n').filter(line => line.startsWith('- `## '));
  assert.ok(items.at(-1).startsWith('- `## Machine Summary`'), `last listed section: ${items.at(-1)}`);
});

// The archived JD runs to hundreds of lines, so both templates put it after the
// sections written for people, not between the header and A) (#6159).
test('batch/batch-prompt.md puts the archived JD where modes/oferta.md does', () => {
  const JD = 'Job Description (archived verbatim)';
  const prompt = readModeText(ROOT, 'batch/batch-prompt.md');
  const step3 = prompt.slice(prompt.indexOf('### Step 3'), prompt.indexOf('### Step 4'));
  const template = step3.slice(step3.indexOf('Report header:'), step3.indexOf('`**Decision:**` is Machine Summary'));
  const PLACEHOLDER = '{the sections listed below, from `## A) Role Summary` to `## Keyword Coverage`';
  assert.equal(template.split(PLACEHOLDER).length - 1, 1, 'one template placeholder for A) to Keyword Coverage');
  const placeholder = template.indexOf(PLACEHOLDER);
  assert.ok(placeholder < template.indexOf(`## ${JD}`), 'template puts the JD after A) to Keyword Coverage');
  const list = step3.slice(step3.indexOf("The report's sections, in this order:"));
  const listed = list.split('\n\n')[1].split('\n')
    .map(line => line.match(/^- `## ([^`]+)`/)?.[1]).filter(Boolean);
  const oferta = reportSectionTitles(readModeText(ROOT, 'modes/oferta.md'));
  const tail = titles => titles.slice(titles.indexOf('Keyword Coverage'));
  assert.deepEqual(tail(oferta), ['Keyword Coverage', JD, 'Machine Summary']);
  assert.deepEqual(tail(listed), tail(oferta), `listed sections: ${listed.join(' | ')}`);
  assert.equal(listed.indexOf(JD), listed.length - 2);
});

test('a missing H answers section is reported', () => {
  assert.ok(structuralGaps(mode(REPORT.replace('## H) Answers\n{answers}\n', ''))).includes('## H)'));
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
