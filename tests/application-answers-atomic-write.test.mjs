import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ROOT, pass, fail } from './helpers.mjs';
import { formatApplicationAnswersSection, parseApplicationAnswersSection } from '../application-answers.mjs';

const original = '# Evaluation\n\n## Recommendation\nKeep this evaluation and archived posting.\n\n'
  + formatApplicationAnswersSection({ date: '2026-01-01', freeText: [{ question: 'Why?', answer: 'Previously saved answer.' }] })
  + '\n## Interview Notes\nKeep these notes too.\n';

function check(label, run) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'answers-atomic-')));
  try {
    const report = join(root, 'report.md');
    const input = join(root, 'answers.json');
    writeFileSync(report, original);
    writeFileSync(input, JSON.stringify({ date: '2026-02-02', freeText: [{ question: 'Why?', answer: 'New fictional answer.' }] }));
    run({ root, report, input });
    pass(label);
  } catch (error) {
    fail(`${label}: ${error.message}`);
    process.exitCode = 1;
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10 });
  }
}

function save(report, input, extra = {}) {
  return spawnSync(process.execPath, [...(extra.hook ? ['--import', pathToFileURL(extra.hook).href] : []),
    'application-answers.mjs', '--report', report, '--input', input], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, TEST_REPORT: report, TEST_FAILURE: extra.failure ?? '' },
  });
}

for (const failure of ['write', 'rename']) {
  check(`a failed ${failure} preserves the entire report and removes staging files`, ({ root, report, input }) => {
    const hook = join(root, 'fail-write.mjs');
    writeFileSync(hook, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const write = fs.writeFileSync, rename = fs.renameSync;
fs.writeFileSync = (path, content, ...args) => {
  if (process.env.TEST_FAILURE === 'write' && String(content).includes('New fictional answer.')) {
    write(path, String(content).slice(0, 20), ...args);
    throw Object.assign(new Error('injected disk full'), { code: 'ENOSPC' });
  }
  return write(path, content, ...args);
};
fs.renameSync = (from, to) => {
  if (process.env.TEST_FAILURE === 'rename' && String(to) === process.env.TEST_REPORT) {
    throw Object.assign(new Error('injected rename failure'), { code: 'EIO' });
  }
  return rename(from, to);
};
syncBuiltinESMExports();\n`);
    const result = save(report, input, { hook, failure });
    assert.notEqual(result.status, 0, 'failed persistence must not report success');
    assert.match(result.stderr, failure === 'write' ? /injected disk full/ : /injected rename failure/);
    assert.equal(readFileSync(report, 'utf8'), original, 'the saved evaluation was truncated or replaced');
    assert.deepEqual(readdirSync(root).sort(), ['answers.json', 'fail-write.mjs', 'report.md']);
  });
}

check('a successful save preserves report permissions and unrelated sections', ({ report, input }) => {
  chmodSync(report, 0o600);
  const result = save(report, input);
  assert.equal(result.status, 0, result.stderr);
  const updated = readFileSync(report, 'utf8');
  assert.equal(parseApplicationAnswersSection(updated).freeText[0].answer, 'New fictional answer.');
  assert.ok(updated.startsWith('# Evaluation\n\n## Recommendation\nKeep this evaluation and archived posting.\n'));
  assert.ok(updated.endsWith('## Interview Notes\nKeep these notes too.\n'));
  if (process.platform !== 'win32') assert.equal(statSync(report).mode & 0o777, 0o600);
});

// Windows symlink creation requires privileges not needed by the writer.
if (process.platform !== 'win32') {
  check('saving through a report symlink updates its target without replacing the link', ({ root, report, input }) => {
    const alias = join(root, 'report-link.md');
    symlinkSync(report, alias);
    const result = save(alias, input);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(lstatSync(alias).isSymbolicLink(), true);
    assert.equal(parseApplicationAnswersSection(readFileSync(report, 'utf8')).freeText[0].answer, 'New fictional answer.');
  });
}
