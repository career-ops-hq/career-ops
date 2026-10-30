import { pass, fail } from './helpers.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { formatApplicationAnswersSection, parseApplicationAnswersSection, upsertApplicationAnswersSection } from '../application-answers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

function check(label, run) {
  try {
    run();
    pass(label);
  } catch (error) {
    fail(`${label}: ${error.message}`);
  }
}

console.log('\napplication-answers — preserve following Markdown sections');

const snapshot = { date: '2026-01-01', state: 'filled', freeText: [{ question: 'Why?', answer: 'Original.' }] };
const nextBody = '\n1. **Attachment:** output/other.pdf\nKeep this unrelated report section.\n';

for (const heading of ['##\tInterview Notes', '  ## Interview Notes', '##', '# Interview Notes']) {
  check(`read and CLI update preserve the next Markdown section ${JSON.stringify(heading)}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'answers-boundary-'));
    try {
      const section = formatApplicationAnswersSection(snapshot);
      const reportText = `# Evaluation\n\n${section}\n${heading}${nextBody}`;
      const report = join(root, 'report.md');
      const input = join(root, 'answers.json');
      writeFileSync(report, reportText);
      writeFileSync(input, JSON.stringify({ ...snapshot, freeText: [{ question: 'Why?', answer: 'Updated.' }] }));
      const run = spawnSync(process.execPath, ['application-answers.mjs', '--report', report, '--input', input], {
        cwd: new URL('..', import.meta.url), encoding: 'utf8',
        env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: '' },
      });
      assert.equal(run.status, 0, describeSpawn(run));
      const updated = readFileSync(report, 'utf8');
      assert.ok(updated.includes(`${heading}${nextBody}`), updated);
      assert.deepEqual(parseApplicationAnswersSection(reportText, { strict: true }).files, []);
      assert.equal(parseApplicationAnswersSection(updated).freeText[0].answer, 'Updated.');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

check('three hashes remain an answers subgroup, and quoted headings remain answer text', () => {
  const text = formatApplicationAnswersSection({ ...snapshot, freeText: [{ question: 'Why?', answer: '## Example\nAnswer body.' }] });
  const parsed = parseApplicationAnswersSection(text, { strict: true });
  assert.equal(parsed.freeText[0].answer, '## Example\nAnswer body.');
});

for (const fence of ['```', '~~~', '````']) {
  check(`headings inside ${fence} do not leave stale code behind on update`, () => {
    const section = formatApplicationAnswersSection(snapshot);
    const stale = `${fence}\n##\tExample only\n  ## Still code\n${fence === '````' ? '```\n## Still fenced\n' : ''}${fence}\n`;
    const text = `${section}\n${stale}\n1. **Portfolio:** output/portfolio.pdf\n\n## Real Notes\nKeep real notes.\n`;
    // The permissive reader must reach the actual file after the fence. The
    // strict reader rejects the non-formatter code rather than hiding it.
    assert.deepEqual(parseApplicationAnswersSection(text).files, [{ field: 'Portfolio', path: 'output/portfolio.pdf' }]);
    assert.throws(() => parseApplicationAnswersSection(text, { strict: true }), /unreadable/);
    const updated = upsertApplicationAnswersSection(text, snapshot);
    assert.ok(!updated.includes('Example only'));
    assert.ok(!updated.includes('portfolio.pdf'));
    assert.ok(updated.includes('## Real Notes\nKeep real notes.'));
  });
}

check('repeated answer updates preserve following sections without adding trailing blank lines', () => {
  for (const ending of ['', '\n', '\n\n']) {
    const following = `  ## Interview Notes\nKeep real notes.${ending}`;
    const report = `${formatApplicationAnswersSection(snapshot)}\n${following}`;
    const once = upsertApplicationAnswersSection(report, snapshot);
    assert.ok(once.endsWith(following + (ending ? '' : '\n')));
    let repeated = once;
    for (let update = 0; update < 3; update++) {
      repeated = upsertApplicationAnswersSection(repeated, snapshot);
      assert.equal(repeated, once);
    }
  }
});
