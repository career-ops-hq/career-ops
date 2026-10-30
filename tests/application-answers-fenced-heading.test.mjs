import assert from 'node:assert/strict';
import { pass, fail } from './helpers.mjs';
import { formatApplicationAnswersSection, parseApplicationAnswersSection, upsertApplicationAnswersSection } from '../application-answers.mjs';

function check(label, run) {
  try { run(); pass(label); } catch (error) { fail(`${label}: ${error.message}`); process.exitCode = 1; }
}

const example = { date: '2026-01-01', files: [{ field: 'CV', path: 'output/example.pdf' }] };
const actual = { date: '2026-02-02', files: [{ field: 'CV', path: 'output/actual.pdf' }] };
const replacement = { date: '2026-03-03', files: [{ field: 'CV', path: 'output/updated.pdf' }] };

for (const [open, close] of [['```markdown', '```'], ['~~~markdown', '~~~'], ['````markdown', '````']]) {
  const archived = `# Evaluation\n\n## Archived job description\n\nKeep this verbatim example:\n${open}\n${formatApplicationAnswersSection(example)}${open.startsWith('````') ? '\n```\n' : ''}\n${close}\n\nKeep the remaining job description.\n`;

  check(`read ignores the ${open} example before the actual answers`, () => {
    const report = `${archived}\n${formatApplicationAnswersSection(actual)}\n## Notes\nKeep notes.\n`;
    assert.deepEqual(parseApplicationAnswersSection(report, { strict: true }), {
      date: actual.date, state: 'filled', freeText: [], selections: [], fieldValues: [], files: actual.files,
    });
  });

  check(`update preserves the archived ${open} example and following notes`, () => {
    const report = `${archived}\n${formatApplicationAnswersSection(actual)}\n## Notes\nKeep notes.\n`;
    const updated = upsertApplicationAnswersSection(report, replacement);
    assert.ok(updated.startsWith(archived), updated);
    assert.ok(updated.endsWith('## Notes\nKeep notes.\n'), updated);
    assert.deepEqual(parseApplicationAnswersSection(updated, { strict: true }).files, replacement.files);
    assert.ok(!updated.includes('output/actual.pdf'));
  });

  check(`a ${open} example alone is not a saved application snapshot`, () => {
    assert.equal(parseApplicationAnswersSection(archived), null);
    const updated = upsertApplicationAnswersSection(archived, replacement);
    assert.ok(updated.startsWith(archived), updated);
    assert.deepEqual(parseApplicationAnswersSection(updated, { strict: true }).files, replacement.files);
  });
}

check('an unclosed example fence is never rewritten as saved answers', () => {
  const report = `# Evaluation\n\n\`\`\`markdown\n${formatApplicationAnswersSection(example)}`;
  assert.equal(parseApplicationAnswersSection(report), null);
});
